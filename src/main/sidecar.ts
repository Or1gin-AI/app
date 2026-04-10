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
        // IP check: whitelisted (proxy tunnel); checkip.amazonaws is NOT (direct)
        'domain:ipify.org',
        'domain:ifconfig.me',
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
    // Safety: reject if upstream points to our own port (would cause infinite loop)
    if (port === LOCAL_PORT) {
      return { ok: false, error: `Upstream proxy port ${port} conflicts with local proxy port` }
    }
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
    req.setTimeout(20_000, () => { req.destroy(); resolve(null) })
    req.end()
  })
}

/** Verify proxy works: try curl first, fallback to Node.js http (for Windows compatibility) */
export async function verifySidecar(): Promise<{ ok: boolean; ip?: string; error?: string }> {
  const { execFile: exec } = require('child_process') as typeof import('child_process')

  // Try curl first (most reliable on macOS/Linux)
  const curlResult = await new Promise<string | null>((resolve) => {
    exec('curl', ['-4', '-s', '--max-time', '20', '-x', `http://127.0.0.1:${LOCAL_HTTP_PORT}`, 'https://api.ipify.org'],
      { windowsHide: true },
      (err, stdout) => {
        const ip = !err && stdout ? stdout.trim() : ''
        resolve(isValidIp(ip) ? ip : null)
      }
    )
  })

  if (curlResult) {
    return { ok: true, ip: curlResult }
  }

  // Fallback: Node.js http through proxy (works on Windows without curl issues)
  const httpResult = await verifyViaHttp('api.ipify.org') || await verifyViaHttp('api4.ipify.org') || await verifyViaHttp('ifconfig.me')

  if (httpResult) {
    return { ok: true, ip: httpResult }
  }

  return { ok: false, error: 'All verification methods failed' }
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

// ── Port scanning for auto-detect ──

interface PortScanResult {
  port: number
  label: string
  ok: boolean
  latency?: number
}

interface ScanResult {
  proxies: PortScanResult[]
  direct: { ok: boolean; latency?: number }
}

const KNOWN_PORTS: { port: number; label: string }[] = [
  { port: 7890, label: 'Clash' },
  { port: 7897, label: 'Clash Verge' },
  { port: 7891, label: 'Clash (SOCKS)' },
  { port: 1087, label: 'ClashX' },
  { port: 1080, label: 'V2RayN / Shadowsocks' },
  { port: 10808, label: 'V2RayN (HTTP)' },
  { port: 10809, label: 'V2RayN' },
  { port: 8888, label: 'Surge' },
  { port: 6152, label: 'Surge (Enhanced)' },
  { port: 20171, label: 'Qv2ray' },
]

export async function scanLocalPorts(): Promise<ScanResult> {
  // Scan all known ports + VPS direct in parallel
  const probeResults = await Promise.all(
    KNOWN_PORTS.map(async ({ port, label }) => {
      const result = await probePreProxy('127.0.0.1', port)
      return { port, label, ok: result.ok, latency: result.latency }
    })
  )

  // Also probe VPS directly for the "direct" option
  const directResult = await probePreProxy(REMOTE.address, REMOTE.port)

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
