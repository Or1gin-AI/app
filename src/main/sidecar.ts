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
  address: 'p.originai.cc',
  port: 443,
  serverName: 'p.originai.cc',
  wsPath: '/update',
  method: 'aes-256-gcm',
}

type UpstreamProtocol = 'http' | 'socks'

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

function generateConfig(
  proxyPassword: string,
  preProxyHost?: string,
  preProxyPort?: number,
  preProxyProtocol: UpstreamProtocol = 'http'
): object {
  const usePreProxy = preProxyHost && preProxyPort
  const preProxySettings = usePreProxy
    ? {
        servers: [
          {
            address: preProxyHost,
            port: preProxyPort,
          },
        ],
      }
    : undefined

  const proxyOutbound: Record<string, unknown> = {
    tag: 'proxy',
    protocol: 'shadowsocks',
    settings: {
      servers: [
        {
          address: REMOTE.address,
          port: REMOTE.port,
          method: REMOTE.method,
          password: proxyPassword,
        },
      ],
    },
    streamSettings: {
      network: 'ws',
      security: 'tls',
      tlsSettings: {
        serverName: REMOTE.serverName,
        fingerprint: 'chrome',
      },
      wsSettings: {
        path: REMOTE.wsPath,
      },
    },
  }

  if (usePreProxy) {
    proxyOutbound.proxySettings = { tag: 'pre-proxy' }
  }

  const outbounds: Record<string, unknown>[] = []

  if (usePreProxy) {
    outbounds.push(
      { tag: 'direct', protocol: 'freedom' },
      proxyOutbound,
      {
        tag: 'pre-proxy',
        protocol: preProxyProtocol,
        settings: preProxySettings,
      },
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
    // Claude / Anthropic domains → proxy
    {
      type: 'field',
      outboundTag: 'proxy',
      domain: [
        // --- Core Anthropic & Claude ---
        'domain:anthropic.com',
        'domain:anthropic.co',
        'domain:claude.ai',
        'domain:claude.com',
        'domain:clau.de',
        'domain:claudemcpclient.com',
        'domain:claudeusercontent.com',
        // --- CDN & Infrastructure ---
        'domain:cdn.anthropic.com',
        'domain:anthropic.com.cdn.cloudflare.net',
        'domain:servd-anthropic-website.b-cdn.net',
        // --- Authentication ---
        'domain:anthropic.auth0.com',
        // --- Google Storage (model assets) ---
        'domain:storage.googleapis.com',
        // --- Monitoring: Datadog ---
        'domain:datadoghq.com',
        'domain:datadog.com',
        'domain:ddog-gov.com',
        'domain:datadoghq.eu',
        'domain:browser-intake-us5-datadoghq.com',
        'domain:browser-intake-datadoghq.com',
        'domain:browser-intake-us3-datadoghq.com',
        'domain:browser-intake-us1-datadoghq.com',
        // --- Monitoring: Sentry ---
        'domain:sentry.io',
        // --- Analytics & Feature Flags ---
        'domain:statsigapi.net',
        'domain:statsig.com',
        'domain:segment.io',
        'domain:growthbook.io',
        'domain:split.io',
        'domain:intellimize.co',
        'domain:cdn.usefathom.com',
        // --- Customer Support ---
        'domain:intercom.io',
        'domain:intercomcdn.com',
        // --- Misc ---
        'domain:facebook.net',
        'domain:ipify.org',
        // --- Regex fallback ---
        'regexp:.*anthropic.*',
        'regexp:.*claude.*',
        'regexp:.*datadog.*',
        'regexp:.*ddog.*',
        'regexp:.*sentry.*',
        'regexp:.*statsig.*',
        'regexp:.*intercom.*',
      ],
    },
    // Anthropic IP range fallback (when domain doesn't match, resolved IP may hit this)
    {
      type: 'field',
      outboundTag: 'proxy',
      ip: ['160.79.104.0/21'],
    },
    // Block QUIC (UDP 443) to force browsers to fall back to TCP (HTTP/2),
    // ensuring proxy sniffing can read SNI for proper domain matching
    {
      type: 'field',
      outboundTag: 'block',
      port: '443',
      network: 'udp',
    },
  ]

  return {
    log: { loglevel: 'info' },
    dns: {
      queryStrategy: 'UseIPv4',
      servers: [
        {
          address: 'https://1.1.1.1/dns-query',
          skipFallback: true,
        },
        'localhost',
      ],
    },
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
      domainStrategy: 'IPIfNonMatch',
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

export async function startSidecar(proxyPassword: string, _preProxy?: string): Promise<{ ok: boolean; error?: string }> {
  await stopSidecar()
  sidecarStopping = false

  const config = generateConfig(proxyPassword)
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

function isValidIp(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)
}

/** Verify via Node.js http module through local proxy (cross-platform, no curl dependency) */
function verifyViaHttp(targetHost: string): Promise<string | null> {
  const http = require('node:http') as typeof import('node:http')
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: LOCAL_HTTP_PORT,
      path: `http://${targetHost}/`,
      method: 'GET',
      headers: { Host: targetHost },
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        const ip = data.trim()
        resolve(isValidIp(ip) ? ip : null)
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(8_000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

/** Verify proxy works: try curl first, fallback to Node.js http (for Windows compatibility) */
export async function verifySidecar(): Promise<{ ok: boolean; ip?: string; error?: string }> {
  const { execFile: exec } = require('child_process') as typeof import('child_process')
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  let lastError = 'All verification methods failed'

  // Windows + upstream HTTP proxy is more stable with a short warm-up + low-level checks.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const curlResult = await new Promise<string | null>((resolve) => {
      exec('curl', ['-4', '-s', '--max-time', '8', '-x', `http://127.0.0.1:${LOCAL_HTTP_PORT}`, 'https://api.ipify.org'],
        { windowsHide: true },
        (err, stdout, stderr) => {
          const ip = !err && stdout ? stdout.trim() : ''
          if (err && stderr?.trim()) lastError = stderr.trim()
          resolve(isValidIp(ip) ? ip : null)
        }
      )
    })

    if (curlResult) {
      return { ok: true, ip: curlResult }
    }

    const httpResult = await verifyViaHttp('api.ipify.org') || await verifyViaHttp('api4.ipify.org')
    if (httpResult) {
      return { ok: true, ip: httpResult }
    }

    if (attempt < 3) {
      await sleep(1200)
    }
  }

  return { ok: false, error: lastError }
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

  console.log('[xray] updating password, restarting...')
  return startSidecar(password)
}

/** Kill any orphaned xray processes left from a previous crash */
export function killOrphanedSidecar(): void {
  try {
    const binary = getSidecarBinary()
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/IM', 'xray.exe'], { windowsHide: true }, () => {})
    } else {
      execFile('pkill', ['-f', binary], () => {})
    }
  } catch { /* best effort */ }
}

export function getLocalPort(): number {
  return LOCAL_PORT
}

// ── Helper (watchdog) process management ──

let helperProcess: ChildProcess | null = null

function getHelperBinary(): string {
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'originai-helper.exe' : 'originai-helper'

  if (app.isPackaged) {
    return join(process.resourcesPath, 'sidecar', binaryName)
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return join(app.getAppPath(), 'resources', 'sidecar', `${platform}-${arch}`, binaryName)
}

export function startHelper(): void {
  stopHelper()
  const xrayPid = sidecarProcess?.pid
  if (!xrayPid) return

  const binary = getHelperBinary()
  if (!existsSync(binary)) {
    console.warn('[helper] binary not found:', binary)
    return
  }

  // Detect system language for helper dialog i18n
  const sysLang = app.getLocale().startsWith('zh') ? 'zh' : 'en'

  const args = [
    '--pid', String(process.pid),
    '--port', String(LOCAL_PORT),
    '--xray-pid', String(xrayPid),
    '--lang', sysLang,
  ]

  console.log('[helper] starting:', binary, args.join(' '))
  try {
    helperProcess = spawn(binary, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    })

    helperProcess.on('error', (err) => {
      console.error('[helper] spawn error:', err.message)
      helperProcess = null
    })

    console.log('[helper] spawned pid:', helperProcess.pid)

    // Unref so helper doesn't prevent Electron from exiting
    helperProcess.unref()
  } catch (err) {
    console.error('[helper] failed to spawn:', err)
    helperProcess = null
  }
}

export function stopHelper(): void {
  if (helperProcess) {
    const proc = helperProcess
    helperProcess = null
    if (process.platform === 'win32' && proc.pid) {
      execFile('taskkill', ['/F', '/PID', String(proc.pid)], { windowsHide: true }, () => {})
    } else {
      try { proc.kill('SIGTERM') } catch { /* already dead */ }
    }
  }
}

/** Kill any orphaned helper processes (startup cleanup). Returns a promise so caller can await. */
export function killOrphanedHelper(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/F', '/IM', 'originai-helper.exe'], { windowsHide: true }, () => resolve())
      } else {
        const binary = getHelperBinary()
        execFile('pkill', ['-f', binary], () => resolve())
      }
    } catch { resolve() }
    // Safety timeout — don't block startup forever
    setTimeout(resolve, 3000)
  })
}

// ── System proxy management ──

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve()))
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
  // Clear shell profiles FIRST (sync, instant) — before-quit may not await the rest
  clearShellProxy()
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
}

export function checkSystemProxy(): Promise<boolean> {
  const expected = String(LOCAL_PORT)
  const opts = { windowsHide: true }
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('scutil', ['--proxy'], opts, (err, stdout) => {
        if (err) { resolve(false); return }
        const httpEnabled = /HTTPEnable\s*:\s*1/.test(stdout)
        const portMatch = stdout.match(/HTTPPort\s*:\s*(\d+)/)
        resolve(httpEnabled && portMatch?.[1] === expected)
      })
    } else if (process.platform === 'win32') {
      execFile('reg', [
        'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
        '/v', 'ProxyServer'
      ], opts, (err, stdout) => {
        if (err) { resolve(false); return }
        const match = stdout.match(/ProxyServer\s+REG_SZ\s+(.+)/)
        resolve(match?.[1]?.trim() === `127.0.0.1:${expected}`)
      })
    } else {
      resolve(true)
    }
  })
}

interface PreProxyProbeResult {
  ok: boolean
  latency?: number
  protocol?: UpstreamProtocol
  error?: string
}

function probeTcpEndpoint(host: string, port: number): Promise<{ ok: boolean; latency?: number; error?: string }> {
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

function probeHttpProxy(host: string, port: number): Promise<PreProxyProbeResult> {
  const net = require('node:net') as typeof import('node:net')
  return new Promise((resolve) => {
    const start = Date.now()
    let settled = false
    let buf = ''
    const done = (result: PreProxyProbeResult) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(result)
    }

    const sock = net.createConnection({ host, port }, () => {
      const req = [
        'CONNECT api.ipify.org:443 HTTP/1.1',
        'Host: api.ipify.org:443',
        'Proxy-Connection: Keep-Alive',
        '',
        '',
      ].join('\r\n')
      sock.write(req)
    })

    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1')
      if (!buf.includes('\r\n')) return
      const line = buf.split('\r\n', 1)[0] || ''
      if (/^HTTP\/1\.[01] 200\b/i.test(line) || /^HTTP\/1\.[01] 407\b/i.test(line)) {
        done({ ok: true, latency: Date.now() - start, protocol: 'http' })
        return
      }
      done({ ok: false, error: `Unexpected HTTP proxy response: ${line || 'empty'}` })
    })
    sock.on('error', (err) => done({ ok: false, error: err.message }))
    sock.setTimeout(5000, () => done({ ok: false, error: 'Timeout' }))
  })
}

function probeSocksProxy(host: string, port: number): Promise<PreProxyProbeResult> {
  const net = require('node:net') as typeof import('node:net')
  return new Promise((resolve) => {
    const start = Date.now()
    let settled = false
    const done = (result: PreProxyProbeResult) => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(result)
    }

    const sock = net.createConnection({ host, port }, () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00]))
    })

    sock.on('data', (chunk: Buffer) => {
      if (chunk.length < 2) return
      if (chunk[0] !== 0x05) {
        done({ ok: false, error: 'Unexpected SOCKS proxy response' })
        return
      }
      if (chunk[1] === 0x00 || chunk[1] === 0x02) {
        done({ ok: true, latency: Date.now() - start, protocol: 'socks' })
        return
      }
      done({ ok: false, error: `SOCKS auth method rejected: 0x${chunk[1].toString(16)}` })
    })
    sock.on('error', (err) => done({ ok: false, error: err.message }))
    sock.setTimeout(5000, () => done({ ok: false, error: 'Timeout' }))
  })
}

interface KnownPortInfo {
  port: number
  label: string
  preferredProtocols: UpstreamProtocol[]
}

const KNOWN_PORTS: KnownPortInfo[] = [
  { port: 7890, label: 'Clash', preferredProtocols: ['socks', 'http'] },
  { port: 7897, label: 'Clash Verge', preferredProtocols: ['socks', 'http'] },
  { port: 7891, label: 'Clash (SOCKS)', preferredProtocols: ['socks'] },
  { port: 1087, label: 'ClashX', preferredProtocols: ['socks', 'http'] },
  { port: 1080, label: 'V2RayN / Shadowsocks', preferredProtocols: ['socks'] },
  { port: 10808, label: 'V2RayN (HTTP)', preferredProtocols: ['http'] },
  { port: 10809, label: 'V2RayN', preferredProtocols: ['socks'] },
  { port: 8888, label: 'Surge', preferredProtocols: ['http'] },
  { port: 6152, label: 'Surge (Enhanced)', preferredProtocols: ['http'] },
  { port: 20171, label: 'Qv2ray', preferredProtocols: ['socks'] },
]

function getPreferredProtocols(port: number): UpstreamProtocol[] {
  const known = KNOWN_PORTS.find((item) => item.port === port)
  return known ? known.preferredProtocols : ['socks', 'http']
}

export async function probePreProxy(host: string, port: number): Promise<PreProxyProbeResult> {
  const attempts = getPreferredProtocols(port)
  const errors: string[] = []

  for (const protocol of attempts) {
    const result = protocol === 'http'
      ? await probeHttpProxy(host, port)
      : await probeSocksProxy(host, port)
    if (result.ok) return result
    if (result.error) errors.push(`${protocol}: ${result.error}`)
  }

  const tcp = await probeTcpEndpoint(host, port)
  if (!tcp.ok) return { ok: false, error: tcp.error }
  return {
    ok: false,
    error: errors.length > 0
      ? `Proxy port is open but did not behave like HTTP/SOCKS (${errors.join('; ')})`
      : 'Proxy port is open but protocol detection failed',
  }
}

// ── Port scanning for auto-detect ──

interface PortScanResult {
  port: number
  label: string
  ok: boolean
  latency?: number
  protocol?: UpstreamProtocol
}

interface ScanResult {
  proxies: PortScanResult[]
  direct: { ok: boolean; latency?: number }
}

export async function scanLocalPorts(): Promise<ScanResult> {
  // Scan all known ports + VPS direct in parallel
  const probeResults = await Promise.all(
    KNOWN_PORTS.map(async ({ port, label }) => {
      const result = await probePreProxy('127.0.0.1', port)
      return { port, label, ok: result.ok, latency: result.latency, protocol: result.protocol }
    })
  )

  // Also probe VPS directly for the "direct" option
  const directResult = await probeTcpEndpoint(REMOTE.address, REMOTE.port)

  return {
    proxies: probeResults,
    direct: { ok: directResult.ok, latency: directResult.latency },
  }
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
      execFile('setx', ['http_proxy', PROXY_URL], { windowsHide: true }, () => {})
      execFile('setx', ['https_proxy', PROXY_URL], { windowsHide: true }, () => {})
      execFile('setx', ['HTTP_PROXY', PROXY_URL], { windowsHide: true }, () => {})
      execFile('setx', ['HTTPS_PROXY', PROXY_URL], { windowsHide: true }, () => {})
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
      execFile('setx', ['http_proxy', ''], { windowsHide: true }, () => {})
      execFile('setx', ['https_proxy', ''], { windowsHide: true }, () => {})
      execFile('setx', ['HTTP_PROXY', ''], { windowsHide: true }, () => {})
      execFile('setx', ['HTTPS_PROXY', ''], { windowsHide: true }, () => {})
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
