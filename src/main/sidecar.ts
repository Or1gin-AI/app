import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { spawn, ChildProcess, execFile } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'

const LOCAL_HTTP_PORT = 21911
const LOCAL_SOCKS_PORT = 21910
const LOCAL_PORT = LOCAL_HTTP_PORT
const DEFAULT_PRE_PROXY = '127.0.0.1:7890'

// Callback for when sidecar crashes after successful start
let onCrashCallback: ((reason: string) => void) | null = null
export function onSidecarCrash(cb: (reason: string) => void): void {
  onCrashCallback = cb
}

const REMOTE = {
  address: '13.113.99.64',
  port: 8443,
}

let sidecarProcess: ChildProcess | null = null
let sidecarStopping = false // true when intentionally stopping

function getSidecarBinary(): string {
  const isPackaged = app.isPackaged
  const platform = process.platform // 'darwin' | 'win32'
  const binaryName = platform === 'win32' ? 'xray.exe' : 'xray'

  if (isPackaged) {
    return join(process.resourcesPath, 'sidecar', binaryName)
  }

  // In dev: resources/sidecar/{platform}-{arch}/xray
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return join(app.getAppPath(), 'resources', 'sidecar', `${platform}-${arch}`, binaryName)
}

function getConfigDir(): string {
  const dir = join(app.getPath('userData'), 'xray')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

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

  // The first outbound is the default for unmatched traffic.
  // With pre-proxy: upstream (forwards non-Claude traffic to Clash)
  // Without pre-proxy: direct (freedom)
  const outbounds: Record<string, unknown>[] = []

  if (usePreProxy) {
    outbounds.push(
      {
        tag: 'upstream',
        protocol: 'http',
        settings: {
          servers: [{ address: preProxyHost, port: preProxyPort }],
        },
      },
      proxyOutbound,
      {
        tag: 'pre-proxy',
        protocol: 'http',
        settings: {
          servers: [{ address: preProxyHost, port: preProxyPort }],
        },
      },
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
    )
  } else {
    outbounds.push(
      { tag: 'direct', protocol: 'freedom' },
      proxyOutbound,
      { tag: 'block', protocol: 'blackhole' },
    )
  }

  const routingRules: Record<string, unknown>[] = [
    {
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
        // IP check: ipify is whitelisted (proxy tunnel), checkip.amazonaws is NOT (direct)
        'domain:ipify.org',
      ],
    },
  ]

  // When upstream exists, route private/LAN IPs directly (skip Clash)
  if (usePreProxy) {
    routingRules.push({
      type: 'field',
      outboundTag: 'direct',
      ip: ['geoip:private'],
    })
  }

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
      rules: routingRules,
    },
  }
}

/** Try connecting to a port to check if it's listening */
function probePort(port: number): Promise<boolean> {
  const net = require('node:net') as typeof import('node:net')
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.destroy()
      resolve(true)
    })
    sock.on('error', () => resolve(false))
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false) })
  })
}

export async function startSidecar(proxyPassword: string, preProxy?: string): Promise<{ ok: boolean; error?: string }> {
  await stopSidecar()
  sidecarStopping = false

  let config: object
  if (preProxy === 'direct') {
    config = generateConfig(proxyPassword)
  } else {
    const proxy = preProxy || DEFAULT_PRE_PROXY
    const [host, portStr] = proxy.split(':')
    const port = parseInt(portStr, 10) || 7890
    config = generateConfig(proxyPassword, host, port)
  }
  const configDir = getConfigDir()
  const configPath = join(configDir, 'config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  const binary = getSidecarBinary()
  if (!existsSync(binary)) {
    return { ok: false, error: `Xray binary not found: ${binary}` }
  }

  return new Promise((resolve) => {
    try {
      const binaryDir = join(binary, '..')
      console.log('[xray] binary:', binary)
      console.log('[xray] cwd:', binaryDir)
      console.log('[xray] config:', configPath)
      sidecarProcess = spawn(binary, ['run', '-c', configPath], {
        cwd: binaryDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      let resolved = false
      const done = (result: { ok: boolean; error?: string }) => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        clearInterval(probeInterval)
        resolve(result)
      }

      const timer = setTimeout(() => done({ ok: false, error: 'Xray start timeout' }), 10000)

      // Watch stderr for Xray log output (Xray logs to stderr)
      let logBuf = ''
      const onData = (data: Buffer) => {
        const chunk = data.toString()
        console.log('[xray]', chunk.trimEnd())
        logBuf += chunk
        // Xray prints "Xray x.x.x started" on successful start
        if (/started/i.test(logBuf)) {
          done({ ok: true })
        }
        if (/failed to start|fatal|panic/i.test(logBuf)) {
          done({ ok: false, error: logBuf.trim().split('\n').pop() || 'Xray fatal error' })
        }
      }
      sidecarProcess.stdout?.on('data', onData)
      sidecarProcess.stderr?.on('data', onData)

      // Fallback: poll port every 500ms
      const probeInterval = setInterval(async () => {
        if (await probePort(LOCAL_PORT)) {
          done({ ok: true })
        }
      }, 500)

      sidecarProcess.on('error', (err) => {
        if (!resolved) {
          done({ ok: false, error: err.message })
        } else if (!sidecarStopping) {
          sidecarProcess = null
          onCrashCallback?.(`Xray error: ${err.message}`)
        }
      })
      sidecarProcess.on('exit', (code) => {
        if (!resolved) {
          sidecarProcess = null
          done({ ok: false, error: `Xray exited with code ${code}` })
        } else if (!sidecarStopping) {
          sidecarProcess = null
          onCrashCallback?.(`Xray exited with code ${code}`)
        }
      })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

/** Verify proxy works: curl through local proxy to check exit IP */
export function verifySidecar(): Promise<{ ok: boolean; ip?: string; error?: string }> {
  const { execFile: exec } = require('child_process') as typeof import('child_process')
  // Only use whitelisted IP services — these go through Trojan tunnel, same path as anthropic.com
  const endpoints = ['https://api.ipify.org', 'https://api4.ipify.org']
  return new Promise((resolve) => {
    let resolved = false
    let remaining = endpoints.length

    for (const url of endpoints) {
      exec('curl', ['-4', '-s', '--max-time', '20', '-x', `http://127.0.0.1:${LOCAL_HTTP_PORT}`, url],
        (err, stdout) => {
          if (resolved) return
          remaining--
          const ip = !err && stdout ? stdout.trim() : ''
          if (ip) {
            resolved = true
            resolve({ ok: true, ip })
          } else if (remaining <= 0) {
            resolve({ ok: false, error: err?.message || 'All IP check endpoints failed' })
          }
        }
      )
    }
  })
}

export async function stopSidecar(): Promise<void> {
  if (sidecarProcess) {
    sidecarStopping = true
    const proc = sidecarProcess
    sidecarProcess = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve()
      }, 3000)
      proc.on('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }
}

export function isSidecarRunning(): boolean {
  return sidecarProcess !== null && !sidecarProcess.killed
}

/** Hot-update the proxy password: rewrite config + restart Xray (~1s, seamless) */
export async function updateOutboundPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSidecarRunning()) return { ok: false, error: 'Xray not running' }

  const configDir = getConfigDir()
  const configPath = join(configDir, 'config.json')

  // Read current config to preserve preProxy settings
  let preProxy: string | undefined
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
    const preProxyOut = cfg.outbounds?.find((o: { tag: string }) => o.tag === 'pre-proxy')
    if (preProxyOut?.settings?.servers?.[0]) {
      const s = preProxyOut.settings.servers[0]
      preProxy = `${s.address}:${s.port}`
    }
  } catch { /* use direct */ }

  console.log('[xray] updating password, restarting...')
  return startSidecar(password, preProxy || 'direct')
}

/** Kill any orphaned xray processes left from a previous crash */
export function killOrphanedSidecar(): void {
  try {
    const binary = getSidecarBinary()
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/IM', 'xray.exe'], () => {})
    } else {
      // Only kill our specific xray binary, not other processes
      execFile('pkill', ['-f', binary], () => {})
    }
  } catch { /* best effort */ }
}

export function getLocalPort(): number {
  return LOCAL_PORT
}

// ── System proxy management ──

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
  })
}

/** Get all network service names (macOS) */
async function getMacNetworkServices(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('networksetup', ['-listallnetworkservices'], (err, stdout) => {
      if (err) { resolve(['Wi-Fi', 'Ethernet']); return }
      const services = stdout
        .split('\n')
        .slice(1)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('*'))
      resolve(services.length > 0 ? services : ['Wi-Fi', 'Ethernet'])
    })
  })
}

export async function setSystemProxy(): Promise<void> {
  const port = String(LOCAL_PORT)
  console.log(`[proxy] setting system HTTP proxy to 127.0.0.1:${port}`)

  if (process.platform === 'darwin') {
    const services = await getMacNetworkServices()
    console.log('[proxy] setting HTTP proxy on services:', services.join(', '))
    for (const svc of services) {
      try {
        await run('networksetup', ['-setwebproxy', svc, '127.0.0.1', port])
        await run('networksetup', ['-setwebproxystate', svc, 'on'])
        await run('networksetup', ['-setsecurewebproxy', svc, '127.0.0.1', port])
        await run('networksetup', ['-setsecurewebproxystate', svc, 'on'])
        await run('networksetup', ['-setautoproxystate', svc, 'off'])
        console.log(`[proxy] HTTP proxy enabled on: ${svc}`)
      } catch (err) {
        console.warn(`[proxy] HTTP proxy failed on ${svc}:`, err)
      }
    }
  } else if (process.platform === 'win32') {
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'
    ])
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${port}`, '/f'
    ])
    await run('reg', [
      'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'AutoConfigURL', '/f'
    ]).catch(() => { /* key may not exist */ })
  } else if (process.platform === 'linux') {
    await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'host', '127.0.0.1']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.http', 'port', port]).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'host', '127.0.0.1']).catch(() => {})
    await run('gsettings', ['set', 'org.gnome.system.proxy.https', 'port', port]).catch(() => {})
  }
}

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
    ]).catch(() => { /* key may not exist */ })
  } else if (process.platform === 'linux') {
    await run('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none']).catch(() => {})
  }
  clearShellProxy()
}

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
      resolve(true)
    }
  })
}

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

// ── Terminal proxy via shell env ──

const PROXY_URL = `http://127.0.0.1:${LOCAL_PORT}`
const MARKER = '# >>> OriginAI Proxy >>>'
const MARKER_END = '# <<< OriginAI Proxy <<<'
const PROXY_SNIPPET = `${MARKER}
export http_proxy="${PROXY_URL}"
export https_proxy="${PROXY_URL}"
export HTTP_PROXY="${PROXY_URL}"
export HTTPS_PROXY="${PROXY_URL}"
${MARKER_END}`

const FISH_PROXY_SNIPPET = `${MARKER}
set -gx http_proxy "${PROXY_URL}"
set -gx https_proxy "${PROXY_URL}"
set -gx HTTP_PROXY "${PROXY_URL}"
set -gx HTTPS_PROXY "${PROXY_URL}"
${MARKER_END}`

function getShellProfiles(): string[] {
  const home = homedir()
  if (process.platform === 'win32') return []
  // Cover all common Unix shells — inject into every profile that exists or is likely used
  return [
    join(home, '.zshenv'),     // zsh (loaded for every zsh session, interactive or not)
    join(home, '.zshrc'),      // zsh interactive
    join(home, '.bashrc'),     // bash interactive
    join(home, '.bash_profile'), // bash login (macOS Terminal.app uses login shell)
    join(home, '.profile'),    // sh / dash / fallback for bash login
    join(home, '.config', 'fish', 'config.fish'), // fish (needs different syntax, handled below)
  ].filter(p => p.endsWith('config.fish') || existsSync(p))
}

const PS_MARKER = '# >>> OriginAI Proxy >>>'
const PS_MARKER_END = '# <<< OriginAI Proxy <<<'
const PS_PROXY_SNIPPET = `${PS_MARKER}
$env:http_proxy = "${PROXY_URL}"
$env:https_proxy = "${PROXY_URL}"
$env:HTTP_PROXY = "${PROXY_URL}"
$env:HTTPS_PROXY = "${PROXY_URL}"
${PS_MARKER_END}`

function getWindowsPowerShellProfiles(): string[] {
  const home = homedir()
  return [
    join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),     // PowerShell 7+
    join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'), // Windows PowerShell 5
  ]
}

export function setShellProxy(): void {
  if (process.platform === 'win32') {
    try {
      execFile('setx', ['http_proxy', PROXY_URL], () => {})
      execFile('setx', ['https_proxy', PROXY_URL], () => {})
      execFile('setx', ['HTTP_PROXY', PROXY_URL], () => {})
      execFile('setx', ['HTTPS_PROXY', PROXY_URL], () => {})
    } catch { /* */ }
    // Also inject into PowerShell profiles
    for (const profile of getWindowsPowerShellProfiles()) {
      try {
        const dir = join(profile, '..')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        let content = existsSync(profile) ? readFileSync(profile, 'utf-8') : ''
        const re = new RegExp(`\\n?${PS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PS_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
        content = content.replace(re, '\n')
        content = content.trimEnd() + '\n' + PS_PROXY_SNIPPET + '\n'
        writeFileSync(profile, content)
      } catch { /* skip */ }
    }
    return
  }

  for (const profile of getShellProfiles()) {
    try {
      const isFish = profile.endsWith('config.fish')
      // Ensure parent dir exists for fish
      if (isFish) {
        const dir = join(profile, '..')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      }
      let content = ''
      if (existsSync(profile)) {
        content = readFileSync(profile, 'utf-8')
      }
      const re = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
      content = content.replace(re, '\n')
      content = content.trimEnd() + '\n' + (isFish ? FISH_PROXY_SNIPPET : PROXY_SNIPPET) + '\n'
      writeFileSync(profile, content)
    } catch { /* skip if no permission */ }
  }
}

export function clearShellProxy(): void {
  if (process.platform === 'win32') {
    try {
      execFile('setx', ['http_proxy', ''], () => {})
      execFile('setx', ['https_proxy', ''], () => {})
      execFile('setx', ['HTTP_PROXY', ''], () => {})
      execFile('setx', ['HTTPS_PROXY', ''], () => {})
    } catch { /* */ }
    // Clean PowerShell profiles
    for (const profile of getWindowsPowerShellProfiles()) {
      try {
        if (!existsSync(profile)) continue
        let content = readFileSync(profile, 'utf-8')
        const re = new RegExp(`\\n?${PS_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PS_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
        content = content.replace(re, '\n')
        writeFileSync(profile, content)
      } catch { /* skip */ }
    }
    return
  }

  for (const profile of getShellProfiles()) {
    try {
      if (!existsSync(profile)) continue
      let content = readFileSync(profile, 'utf-8')
      const re = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
      content = content.replace(re, '\n')
      writeFileSync(profile, content)
    } catch { /* skip */ }
  }
}
