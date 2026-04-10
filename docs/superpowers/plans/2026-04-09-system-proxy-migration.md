# System Proxy Migration: PAC → Direct HTTP Proxy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PAC-based proxy injection with direct system HTTP proxy (`127.0.0.1:21911`), add upstream outbound for non-Claude traffic, add system proxy monitoring with conflict alerts, add pre-proxy latency test, and add crash recovery cleanup.

**Architecture:** All traffic flows through Xray on port 21911. Xray routing sends Claude domains through Trojan tunnel (US exit), and everything else through an `upstream` outbound to the user's existing proxy (Clash/V2Ray) or `direct` if none. System proxy monitor polls every 3 seconds (only when optimization is active) and alerts the user if another app overwrites our proxy settings.

**Tech Stack:** Electron, Xray, TypeScript, React

**Port change:** `8080` → `21911` (HTTP), `1080` → `21910` (SOCKS5) to avoid conflicts with common software.

---

### Task 1: Update ports and Xray config with upstream outbound

**Files:**
- Modify: `src/main/sidecar.ts`

- [ ] **Step 1: Update port constants**

```typescript
const LOCAL_HTTP_PORT = 21911
const LOCAL_SOCKS_PORT = 21910
const LOCAL_PORT = LOCAL_HTTP_PORT
```

- [ ] **Step 2: Rewrite `generateConfig` to add upstream outbound**

The `generateConfig` function must now accept a boolean `hasUpstream` to decide the default outbound. When the user has a pre-proxy (Clash), non-whitelisted traffic should go to `upstream` (the user's Clash port). When no pre-proxy (direct mode), non-whitelisted traffic goes `direct`.

```typescript
function generateConfig(proxyPassword: string, preProxyHost?: string, preProxyPort?: number): object {
  const usePreProxy = preProxyHost && preProxyPort

  const proxyOutbound: Record<string, unknown> = {
    tag: 'proxy',
    protocol: 'trojan',
    settings: {
      servers: [
        {
          address: REMOTE.address,
          port: REMOTE.port,
          password: proxyPassword,
          level: 0,
        },
      ],
    },
    streamSettings: {
      network: 'tcp',
      security: 'reality',
      realitySettings: {
        serverName: 'pan.baidu.com',
        fingerprint: 'chrome',
        publicKey: 'U2T3fs72Gsg1lRLRGZ1TJ5gsLt8sARj_nGfoGBgm4FY',
        shortId: '79153c2f47ee11f5',
      },
    },
  }

  if (usePreProxy) {
    proxyOutbound.proxySettings = { tag: 'pre-proxy' }
  }

  // When upstream (Clash) exists: default outbound is upstream (non-Claude → Clash)
  // When no upstream: default outbound is direct (non-Claude → freedom)
  const outbounds: Record<string, unknown>[] = []

  if (usePreProxy) {
    // Default: upstream sends non-Claude traffic back to Clash
    outbounds.push({
      tag: 'upstream',
      protocol: 'http',
      settings: {
        servers: [{ address: preProxyHost, port: preProxyPort }],
      },
    })
  } else {
    // Default: direct for users without pre-proxy
    outbounds.push({ tag: 'direct', protocol: 'freedom' })
  }

  outbounds.push(proxyOutbound)

  if (usePreProxy) {
    outbounds.push({
      tag: 'pre-proxy',
      protocol: 'http',
      settings: {
        servers: [{ address: preProxyHost, port: preProxyPort }],
      },
    })
    // Still need direct for private IPs
    outbounds.push({ tag: 'direct', protocol: 'freedom' })
  }

  outbounds.push({ tag: 'block', protocol: 'blackhole' })

  const rules: Record<string, unknown>[] = []

  // Private IPs always go direct (localhost, LAN, etc.)
  if (usePreProxy) {
    rules.push({
      type: 'field',
      outboundTag: 'direct',
      ip: ['geoip:private'],
    })
  }

  // Claude whitelist → proxy (Trojan tunnel)
  rules.push({
    type: 'field',
    outboundTag: 'proxy',
    domain: [
      // Core services
      'domain:anthropic.com',
      'domain:anthropic.co',
      'domain:claude.ai',
      'domain:claude.com',
      'domain:claudeusercontent.com',
      'domain:storage.googleapis.com',
      // Telemetry / analytics
      'domain:datadoghq.com',
      'domain:datadog.com',
      'domain:ddog-gov.com',
      'domain:datadoghq.eu',
      'domain:browser-intake-us5-datadoghq.com',
      'domain:browser-intake-datadoghq.com',
      'domain:browser-intake-us3-datadoghq.com',
      'domain:browser-intake-us1-datadoghq.com',
      'domain:sentry.io',
      'domain:statsigapi.net',
      'domain:statsig.com',
      'domain:segment.io',
      'domain:growthbook.io',
      'domain:split.io',
      'domain:intellimize.co',
      // Wildcard patterns
      'regexp:.*anthropic.*',
      'regexp:.*claude.*',
      'regexp:.*datadog.*',
      'regexp:.*ddog.*',
      'regexp:.*sentry.*',
      'regexp:.*statsig.*',
      'regexp:.*intercom.*',
      // Third-party integrations
      'domain:intercom.io',
      'domain:intercomcdn.com',
      'domain:facebook.net',
      // IP check (whitelisted, verifies tunnel works)
      'domain:ipify.org',
    ],
  })

  // Everything else → first outbound (upstream or direct, depending on config)

  return {
    log: { loglevel: 'info' },
    inbounds: [
      {
        tag: 'socks-in',
        port: LOCAL_SOCKS_PORT,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { udp: true },
      },
      {
        tag: 'http-in',
        port: LOCAL_HTTP_PORT,
        listen: '127.0.0.1',
        protocol: 'http',
      },
    ],
    outbounds,
    routing: {
      domainStrategy: 'AsIs',
      rules,
    },
  }
}
```

- [ ] **Step 3: Delete `generatePacScript` function entirely (lines 168-194)**

This function is no longer needed. Remove it completely.

- [ ] **Step 4: Delete all PAC server code**

Remove:
- `let pacServer` and `let pacServerPort` variables (lines 392-393)
- `ensurePacServer()` function (lines 395-414)
- `stopPacServer()` function (lines 417-418)
- `isPacServerRunning()` function (lines 421-423)
- `getPacFilePath()` function (lines 425-427)
- The `import http from 'node:http'` line (line 6) — no longer needed in sidecar.ts

- [ ] **Step 5: Rewrite `setSystemProxy` to set direct HTTP proxy**

```typescript
export async function setSystemProxy(): Promise<void> {
  const proxyAddr = `127.0.0.1:${LOCAL_PORT}`
  console.log('[proxy] setting system proxy to', proxyAddr)

  if (process.platform === 'darwin') {
    const services = await getMacNetworkServices()
    for (const svc of services) {
      try {
        await run('networksetup', ['-setwebproxy', svc, '127.0.0.1', String(LOCAL_PORT)])
        await run('networksetup', ['-setwebproxystate', svc, 'on'])
        await run('networksetup', ['-setsecurewebproxy', svc, '127.0.0.1', String(LOCAL_PORT)])
        await run('networksetup', ['-setsecurewebproxystate', svc, 'on'])
        // Disable auto-proxy (PAC) in case it was set before
        await run('networksetup', ['-setautoproxystate', svc, 'off'])
        console.log(`[proxy] HTTP+HTTPS proxy set on: ${svc}`)
      } catch (err) {
        console.warn(`[proxy] failed on ${svc}:`, err)
      }
    }
  } else if (process.platform === 'win32') {
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'
    ])
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxyAddr, '/f'
    ])
    // Remove PAC URL if it was set before
    await run('reg', [
      'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'AutoConfigURL', '/f'
    ]).catch(() => {})
  } else if (process.platform === 'linux') {
    await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', String(LOCAL_PORT)]).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', String(LOCAL_PORT)]).catch(() => {})
  }
}
```

- [ ] **Step 6: Rewrite `clearSystemProxy` to clear HTTP proxy**

```typescript
export async function clearSystemProxy(): Promise<void> {
  console.log('[proxy] clearing system proxy')
  if (process.platform === 'darwin') {
    const services = await getMacNetworkServices()
    for (const svc of services) {
      try {
        await run('networksetup', ['-setwebproxystate', svc, 'off'])
        await run('networksetup', ['-setsecurewebproxystate', svc, 'off'])
      } catch { /* skip */ }
    }
  } else if (process.platform === 'win32') {
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'
    ]).catch(() => {})
    await run('reg', [
      'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer', '/f'
    ]).catch(() => {})
  } else if (process.platform === 'linux') {
    await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']).catch(() => {})
  }
  clearShellProxy()
}
```

- [ ] **Step 7: Add `checkSystemProxy` function to detect if our proxy is still active**

```typescript
/** Check if system proxy still points to our port. Returns true if ours, false if changed. */
export function checkSystemProxy(): Promise<boolean> {
  const expected = String(LOCAL_PORT)
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('scutil', ['--proxy'], (err, stdout) => {
        if (err) { resolve(false); return }
        const httpEnabled = /HTTPEnable\s*:\s*1/.test(stdout)
        const portMatch = stdout.match(/HTTPPort\s*:\s*(\d+)/)
        resolve(httpEnabled && portMatch?.[1] === expected)
      })
    } else if (process.platform === 'win32') {
      execFile('reg', [
        'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v', 'ProxyServer'
      ], (err, stdout) => {
        if (err) { resolve(false); return }
        const match = stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/)
        resolve(match?.[1]?.trim() === `127.0.0.1:${expected}`)
      })
    } else {
      // Linux — best effort
      resolve(true)
    }
  })
}
```

- [ ] **Step 8: Add `probePreProxy` function to test upstream latency**

```typescript
/** Probe pre-proxy connectivity and measure latency (ms). Returns latency or error. */
export function probePreProxy(host: string, port: number): Promise<{ ok: boolean; latency?: number; error?: string }> {
  const net = require('node:net') as typeof import('node:net')
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = net.createConnection({ host, port }, () => {
      const latency = Date.now() - start
      sock.destroy()
      resolve({ ok: true, latency })
    })
    sock.on('error', (err) => resolve({ ok: false, error: err.message }))
    sock.setTimeout(5000, () => { sock.destroy(); resolve({ ok: false, error: 'Timeout' }) })
  })
}
```

- [ ] **Step 9: Update exports**

Make sure the module exports are updated. Remove `generatePacScript`, `isPacServerRunning`. Add `checkSystemProxy`, `probePreProxy`.

- [ ] **Step 10: Update shell proxy URL to use new port**

The `PROXY_URL` constant on line 508 already references `LOCAL_PORT`, so it will auto-update to `21911`. No code change needed, just verify.

- [ ] **Step 11: Commit**

```bash
git add src/main/sidecar.ts
git commit -m "refactor: replace PAC with direct system proxy, add upstream outbound, port 21911"
```

---

### Task 2: Update main process (index.ts)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, generatePacScript, onSidecarCrash, setSystemProxy, clearSystemProxy, setShellProxy, killOrphanedSidecar, updateOutboundPassword, isPacServerRunning } from './sidecar'
```
With:
```typescript
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, onSidecarCrash, setSystemProxy, clearSystemProxy, setShellProxy, killOrphanedSidecar, updateOutboundPassword, checkSystemProxy, probePreProxy, getLocalPort } from './sidecar'
```

- [ ] **Step 2: Update `fetchExitIpViaProxy` to use new port**

```typescript
function fetchExitIpViaProxy(): Promise<string | null> {
  const { execFile } = require('child_process') as typeof import('child_process')
  const port = getLocalPort()
  return new Promise((resolve) => {
    execFile('curl', ['-4', '-s', '--max-time', '20', '-x', `http://127.0.0.1:${port}`, 'https://api.ipify.org'],
      (err, stdout) => {
        if (err) { resolve(null); return }
        resolve(stdout.trim() || null)
      }
    )
  })
}
```

- [ ] **Step 3: Update `check-local-ip` handler to use new port**

```typescript
ipcMain.handle('check-local-ip', async () => {
  const { execFile } = require('child_process') as typeof import('child_process')
  const port = getLocalPort()
  return new Promise<{ ok: boolean; ip: string | null }>((resolve) => {
    const args = isSidecarRunning()
      ? ['-4', '-s', '--max-time', '10', '-x', `http://127.0.0.1:${port}`, 'https://checkip.amazonaws.com']
      : ['-4', '-s', '--noproxy', '*', '--max-time', '10', 'https://checkip.amazonaws.com']
    execFile('curl', args, (err, stdout) => {
      const ip = err ? null : stdout.trim() || null
      resolve({ ok: ip !== null, ip })
    })
  })
})
```

- [ ] **Step 4: Rewrite `sidecar:start` handler — remove PAC, use direct proxy**

```typescript
ipcMain.handle('sidecar:start', async (_e, preProxy?: string) => {
  // Fetch proxy credentials first
  const authRes = await authFetch('GET', '/api/proxy-auth/login')
  if (authRes.status !== 200) {
    const errData = authRes.data as { message?: string } | undefined
    return {
      ok: false,
      error: typeof errData === 'object' && errData?.message
        ? errData.message
        : 'Failed to get proxy credentials'
    }
  }
  const creds = authRes.data as { username: string; password: string; expireAt: string }
  proxyCredentials = creds
  console.log('[proxy-auth] got credentials, expires:', creds.expireAt)

  const result = await startSidecar('123456', preProxy) // TODO: restore creds.password after server gRPC is fixed
  if (result.ok) {
    // Set Electron session proxy (direct proxy, not PAC)
    const port = getLocalPort()
    for (const win of BrowserWindow.getAllWindows()) {
      await win.webContents.session.setProxy({
        proxyRules: `http://127.0.0.1:${port}`
      })
    }
    await setSystemProxy().catch(() => { /* non-fatal */ })
    setShellProxy()
    scheduleProxyRefresh()
    startProxyMonitor()
  }
  return result
})
```

- [ ] **Step 5: Update `sidecar:stop` handler — stop proxy monitor**

```typescript
ipcMain.handle('sidecar:stop', async () => {
  if (proxyRefreshTimer) { clearTimeout(proxyRefreshTimer); proxyRefreshTimer = null }
  proxyCredentials = null
  stopProxyMonitor()
  await stopSidecar()

  for (const win of BrowserWindow.getAllWindows()) {
    await win.webContents.session.setProxy({ mode: 'direct' })
  }
  await clearSystemProxy().catch(() => { /* non-fatal */ })
  return { ok: true }
})
```

- [ ] **Step 6: Replace `sidecar:pac-status` with `sidecar:proxy-status`**

```typescript
ipcMain.handle('sidecar:proxy-status', () => {
  return { running: isSidecarRunning(), port: getLocalPort() }
})
```

Remove the old `sidecar:pac-status` handler.

- [ ] **Step 7: Add `sidecar:probe-pre-proxy` IPC handler**

```typescript
ipcMain.handle('sidecar:probe-pre-proxy', async (_e, host: string, port: number) => {
  return probePreProxy(host, port)
})
```

- [ ] **Step 8: Add system proxy monitor**

```typescript
let proxyMonitorInterval: ReturnType<typeof setInterval> | null = null

function startProxyMonitor(): void {
  if (proxyMonitorInterval) return
  proxyMonitorInterval = setInterval(async () => {
    if (!isSidecarRunning()) return
    const ours = await checkSystemProxy()
    if (!ours) {
      broadcast('proxy:conflict', { hijacked: true })
    }
  }, 3000)
}

function stopProxyMonitor(): void {
  if (proxyMonitorInterval) {
    clearInterval(proxyMonitorInterval)
    proxyMonitorInterval = null
  }
}
```

- [ ] **Step 9: Add crash recovery in `app.whenReady`**

After `killOrphanedSidecar()`, add:

```typescript
// Crash recovery: if system proxy points to our port but Xray isn't running, clean up
checkSystemProxy().then((ours) => {
  if (ours && !isSidecarRunning()) {
    console.log('[proxy] stale system proxy detected from previous crash, cleaning up')
    clearSystemProxy().catch(() => {})
  }
})
```

- [ ] **Step 10: Commit**

```bash
git add src/main/index.ts
git commit -m "refactor: update main process for direct system proxy, add monitor and crash recovery"
```

---

### Task 3: Update preload and type definitions

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] **Step 1: Update preload/index.ts sidecar section**

Replace `pacStatus` with `proxyStatus` and add `probePreProxy`:

```typescript
sidecar: {
  start: (preProxy?: string) => ipcRenderer.invoke('sidecar:start', preProxy),
  stop: () => ipcRenderer.invoke('sidecar:stop'),
  status: () => ipcRenderer.invoke('sidecar:status'),
  verify: () => ipcRenderer.invoke('sidecar:verify'),
  proxyStatus: () => ipcRenderer.invoke('sidecar:proxy-status'),
  probePreProxy: (host: string, port: number) => ipcRenderer.invoke('sidecar:probe-pre-proxy', host, port),
},
```

Add proxy conflict listener:

```typescript
proxy: {
  onConflict: (cb: (data: { hijacked: boolean }) => void) => {
    const handler = (_: unknown, data: { hijacked: boolean }) => cb(data)
    ipcRenderer.on('proxy:conflict', handler)
    return () => ipcRenderer.removeListener('proxy:conflict', handler)
  },
},
```

- [ ] **Step 2: Update preload/index.d.ts types**

In the `sidecar` section, replace `pacStatus` line with:

```typescript
proxyStatus: () => Promise<{ running: boolean; port: number }>
probePreProxy: (host: string, port: number) => Promise<{ ok: boolean; latency?: number; error?: string }>
```

Add proxy section after sidecar:

```typescript
proxy: {
  onConflict: (cb: (data: { hijacked: boolean }) => void) => () => void
}
```

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts
git commit -m "refactor: update preload API for system proxy, add probePreProxy and conflict listener"
```

---

### Task 4: Update NetworkSetupPage — pre-proxy latency test

**Files:**
- Modify: `src/renderer/src/pages/NetworkSetupPage.tsx`

- [ ] **Step 1: Add latency probe to `startOptimize`**

Before starting Xray, probe the pre-proxy to show latency. Update the `startOptimize` function. Insert a new step between detect and start:

```typescript
const startOptimize = useCallback(async (proxyAddr: string) => {
  setLastProxyAddr(proxyAddr)
  setView('optimizing')
  setProgress(0)
  setStep(0)
  setOptimizeError(null)

  // Step 0: detect (already done)
  setStep(0)
  setProgress(10)

  // Step 1: probe pre-proxy latency (skip for direct mode)
  setStep(1)
  setProgress(20)
  if (proxyAddr !== 'direct') {
    const [host, portStr] = proxyAddr.split(':')
    const port = parseInt(portStr, 10) || 7890
    const probe = await window.electronAPI.sidecar.probePreProxy(host, port)
    if (!probe.ok) {
      setOptimizeError(`${t.network.probeFailedPrefix}${proxyAddr}${t.network.probeFailedSuffix}${probe.error || ''}`)
      return
    }
    setProbeLatency(probe.latency ?? null)
  }
  setProgress(30)

  // Step 2: start xray
  setStep(2)
  setProgress(45)
  const startResult = await window.electronAPI.sidecar.start(proxyAddr)
  if (!startResult.ok) {
    setOptimizeError(startResult.error || 'Failed to start proxy')
    return
  }
  setProgress(65)

  // Step 3: verify connection through proxy
  setStep(3)
  setProgress(75)
  const verifyResult = await window.electronAPI.sidecar.verify()
  if (!verifyResult.ok) {
    setOptimizeError(verifyResult.error || 'Connection verification failed')
    return
  }
  setProgress(90)

  // Step 4: done
  setStep(4)
  setProgress(100)
}, [t])
```

- [ ] **Step 2: Add state for latency and update steps array**

At the top of the component, add:
```typescript
const [probeLatency, setProbeLatency] = useState<number | null>(null)
```

Update the steps array to 5 items:
```typescript
const steps = [
  t.network.stepDetect,
  t.network.stepProbe,
  t.network.stepStart,
  t.network.stepVerify,
  t.network.stepDone,
]
```

- [ ] **Step 3: Show latency after probe step**

In the optimizing view's step list, after the probe step shows ✓, append the latency:

```typescript
{steps.map((label, i) => (
  <div key={i}>
    {stepIcon(i)} {label}
    {i === 1 && probeLatency !== null && step > 1 && (
      <span className="text-green-600 ml-1">({probeLatency}ms)</span>
    )}
  </div>
))}
```

- [ ] **Step 4: Also add probe to `handleAutoProxy`**

In `handleAutoProxy`, after detecting the system proxy, probe it before proceeding. The probe happens inside `startOptimize` now, so no change needed here — `startOptimize` already handles the probe step.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/NetworkSetupPage.tsx
git commit -m "feat: add pre-proxy latency probe step in optimization flow"
```

---

### Task 5: Update NetworkStatusPage — replace PAC with system proxy status, add conflict alert

**Files:**
- Modify: `src/renderer/src/pages/NetworkStatusPage.tsx`

- [ ] **Step 1: Rewrite NetworkStatusPage**

```tsx
import { useState, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { PiCheckCircleBold, PiWarningBold } from 'react-icons/pi'
import { VscLoading } from 'react-icons/vsc'

interface NetworkStatusPageProps {
  onBack: () => void
  onReconfigure: () => void
}

export function NetworkStatusPage({ onBack, onReconfigure }: NetworkStatusPageProps) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [proxyIp, setProxyIp] = useState<string | null>(null)
  const [proxyOk, setProxyOk] = useState(false)
  const [proxyPort, setProxyPort] = useState<number>(0)
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const [directRes, proxyRes, statusRes] = await Promise.all([
        window.electronAPI.checkLocalIp(),
        window.electronAPI.checkProxyIp(),
        window.electronAPI.sidecar.proxyStatus()
      ])

      if (cancelled) return
      setLocalIp(directRes.ip)
      setProxyIp(proxyRes.ip)
      setProxyOk(proxyRes.ok)
      setProxyPort(statusRes.port)
      setLoading(false)
    }

    check()

    // Listen for proxy conflict events
    const unsub = window.electronAPI.proxy.onConflict(() => {
      setConflict(true)
    })

    return () => { cancelled = true; unsub() }
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <VscLoading size={24} className="text-brand animate-spin mb-4" />
        <p className="text-[13px] text-text-muted">{t.network.detecting}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${proxyOk && !conflict ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        {proxyOk && !conflict ? <PiCheckCircleBold size={24} className="text-green-500" /> : <PiWarningBold size={24} className="text-red-500" />}
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">
        {conflict ? t.networkStatus.titleConflict : proxyOk ? t.networkStatus.title : t.networkStatus.titleError}
      </h2>
      <p className="text-[13px] text-text-muted mb-6 text-center max-w-[380px]">
        {conflict ? t.networkStatus.descConflict : proxyOk ? t.networkStatus.desc : t.networkStatus.descError}
      </p>

      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-4 mb-6">
        <div className="grid grid-cols-1 gap-y-3 text-[12px] font-mono">
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.proxyStatus}</span>
            <span className={proxyOk ? 'text-green-600' : 'text-red-500'}>
              {proxyOk ? t.networkStatus.running : t.networkStatus.stopped}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.systemProxy}</span>
            <span className={conflict ? 'text-red-500' : 'text-green-600'}>
              {conflict ? t.networkStatus.hijacked : `127.0.0.1:${proxyPort}`}
            </span>
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.localIp}</span>
            <span className="text-text-secondary">{localIp || '\u2014'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.proxyIp}</span>
            <span className={proxyOk ? 'text-green-600' : 'text-red-500'}>{proxyIp || '\u2014'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {proxyOk && !conflict ? (
          <>
            <button
              onClick={onBack}
              className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.networkStatus.back}
            </button>
            <button
              onClick={onReconfigure}
              className="px-6 py-2.5 bg-bg-card border border-border text-text-secondary rounded-lg text-sm cursor-pointer hover:border-brand/40 transition-colors"
            >
              {t.networkStatus.reconfigure}
            </button>
          </>
        ) : (
          <button
            onClick={onReconfigure}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.networkStatus.reconfigure}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/pages/NetworkStatusPage.tsx
git commit -m "feat: replace PAC status with system proxy status, add conflict alert"
```

---

### Task 6: Update i18n strings

**Files:**
- Modify: `src/renderer/src/i18n/en.ts`
- Modify: `src/renderer/src/i18n/zh.ts`

- [ ] **Step 1: Update en.ts**

In the `network` section, add after `stepDone`:
```typescript
stepProbe: 'Test upstream proxy',
probeFailedPrefix: 'Cannot reach upstream proxy at ',
probeFailedSuffix: ': ',
```

In the `networkStatus` section, replace `pacStatus` with:
```typescript
systemProxy: 'System Proxy',
hijacked: 'Overridden by other software',
titleConflict: 'Proxy Conflict',
descConflict: 'System proxy has been changed by another application. Please disable "System Proxy" in your VPN/proxy tool and keep it running in the background.',
```

- [ ] **Step 2: Update zh.ts**

In the `network` section, add after `stepDone`:
```typescript
stepProbe: '测试前置代理',
probeFailedPrefix: '无法连接前置代理 ',
probeFailedSuffix: '：',
```

In the `networkStatus` section, replace `pacStatus` with:
```typescript
systemProxy: '系统代理',
hijacked: '已被其他软件覆盖',
titleConflict: '代理冲突',
descConflict: '系统代理已被其他应用修改，请在您的加速器/代理软件中关闭「系统代理」开关，保持后台运行即可。',
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/i18n/en.ts src/renderer/src/i18n/zh.ts
git commit -m "feat: add i18n strings for system proxy status, conflict alert, and probe step"
```

---

### Task 7: Final integration and version bump

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify `detect-system-proxy` handler still works**

The existing `detect-system-proxy` handler in `index.ts` reads the current system proxy. It needs to still work so it can detect Clash's proxy BEFORE we overwrite it. Read the handler (around line 411) — it reads `HTTPProxy`/`HTTPPort` from `scutil --proxy` on macOS and `ProxyServer` from registry on Windows. This should still work because at the time of detection, Clash's proxy is still set. **No change needed.**

- [ ] **Step 2: Remove dead code**

In `index.ts`, remove the unused `fetchExitIp` function (it references `fetchExitIpDirect` and `fetchExitIpViaProxy` but is never called).

Also remove the `import http from 'node:http'` from `index.ts` if it's no longer needed (check if `http` is used elsewhere — it's used for the renderer file server, so keep it).

- [ ] **Step 3: Bump version**

```json
"version": "0.1.4"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "release: v0.1.4 — system proxy migration, upstream routing, conflict detection"
```

- [ ] **Step 5: Tag and push**

```bash
git tag -a v0.1.4 -m "v0.1.4"
git push origin main --tags
```
