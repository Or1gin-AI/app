import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { spawn, ChildProcess, execFile } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'

const LOCAL_HTTP_PORT = 8080
const LOCAL_SOCKS_PORT = 1080
const LOCAL_PORT = LOCAL_HTTP_PORT // used externally for PAC / proxy config
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

  const outbounds: Record<string, unknown>[] = [proxyOutbound]
  if (usePreProxy) {
    outbounds.push({
      tag: 'pre-proxy',
      protocol: 'http',
      settings: {
        servers: [{ address: preProxyHost, port: preProxyPort }],
      },
    })
  }
  outbounds.push(
    { tag: 'direct', protocol: 'freedom' },
    { tag: 'block', protocol: 'blackhole' },
  )

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
      domainStrategy: 'IPIfNonMatch',
      rules: [
        {
          type: 'field',
          outboundTag: 'direct',
          domain: ['geosite:cn'],
        },
        {
          type: 'field',
          outboundTag: 'direct',
          ip: ['geoip:cn', 'geoip:private'],
        },
        {
          type: 'field',
          outboundTag: 'proxy',
          network: 'tcp,udp',
        },
      ],
    },
  }
}

export function generatePacScript(): string {
  return `function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.claude.ai") || shExpMatch(host, "*.anthropic.com") || shExpMatch(host, "claude.ai") || shExpMatch(host, "anthropic.com")) {
    return "PROXY 127.0.0.1:${LOCAL_PORT}";
  }
  if (host === "icanhazip.com" || host === "ipv4.icanhazip.com" || host === "ipinfo.io" || host === "api.ipify.org") {
    return "PROXY 127.0.0.1:${LOCAL_PORT}";
  }
  return "DIRECT";
}`
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
        } else {
          sidecarProcess = null
          onCrashCallback?.(`Xray error: ${err.message}`)
        }
      })
      sidecarProcess.on('exit', (code) => {
        sidecarProcess = null
        if (!resolved) {
          done({ ok: false, error: `Xray exited with code ${code}` })
        } else {
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
  // Try multiple IP check services with generous timeout
  const endpoints = ['https://icanhazip.com', 'https://api.ipify.org', 'https://ipv4.icanhazip.com']
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
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/IM', 'xray.exe'], () => {})
    } else {
      execFile('pkill', ['-f', 'xray'], () => {})
    }
  } catch { /* best effort */ }
}

export function getLocalPort(): number {
  return LOCAL_PORT
}

// ── System proxy management ──

function getPacFilePath(): string {
  return join(getConfigDir(), 'proxy.pac')
}

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
  const pacContent = generatePacScript()
  const pacPath = getPacFilePath()
  writeFileSync(pacPath, pacContent)

  if (process.platform === 'darwin') {
    const pacUrl = `file://${pacPath}`
    const services = await getMacNetworkServices()
    for (const svc of services) {
      try {
        await run('networksetup', ['-setautoproxyurl', svc, pacUrl])
        await run('networksetup', ['-setautoproxystate', svc, 'on'])
      } catch { /* service may not support proxy, skip */ }
    }
  } else if (process.platform === 'win32') {
    const pacUrl = `file:///${pacPath.replace(/\\/g, '/')}`
    await run('reg', [
      'add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', pacUrl, '/f'
    ])
  }
}

export async function clearSystemProxy(): Promise<void> {
  if (process.platform === 'darwin') {
    const services = await getMacNetworkServices()
    for (const svc of services) {
      try {
        await run('networksetup', ['-setautoproxystate', svc, 'off'])
      } catch { /* skip */ }
    }
  } else if (process.platform === 'win32') {
    await run('reg', [
      'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
      '/v', 'AutoConfigURL', '/f'
    ]).catch(() => { /* key may not exist */ })
  }
  clearShellProxy()
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

function getShellProfiles(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [join(home, '.zshenv')]
  } else if (process.platform === 'win32') {
    return []
  }
  return [join(home, '.bashrc')]
}

export function setShellProxy(): void {
  if (process.platform === 'win32') {
    try {
      execFile('setx', ['http_proxy', PROXY_URL], () => {})
      execFile('setx', ['https_proxy', PROXY_URL], () => {})
      execFile('setx', ['HTTP_PROXY', PROXY_URL], () => {})
      execFile('setx', ['HTTPS_PROXY', PROXY_URL], () => {})
    } catch { /* */ }
    return
  }

  for (const profile of getShellProfiles()) {
    try {
      let content = ''
      if (existsSync(profile)) {
        content = readFileSync(profile, 'utf-8')
      }
      const re = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
      content = content.replace(re, '\n')
      content = content.trimEnd() + '\n' + PROXY_SNIPPET + '\n'
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
