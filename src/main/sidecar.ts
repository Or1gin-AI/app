import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { spawn, ChildProcess, execFile } from 'child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import http from 'node:http'

const LOCAL_PORT = 12345
const DEFAULT_PRE_PROXY = '127.0.0.1:7890'

// Callback for when sidecar crashes after successful start
let onCrashCallback: ((reason: string) => void) | null = null
export function onSidecarCrash(cb: (reason: string) => void): void {
  onCrashCallback = cb
}

const REMOTE = {
  type: 'shadowsocks' as const,
  server: '13.113.99.64',
  server_port: 10080,
  method: '2022-blake3-aes-128-gcm',
  password: 'eV1LpahsWRbRphp5dUSYrQ=='
}

let sidecarProcess: ChildProcess | null = null

function getSidecarBinary(): string {
  const isPackaged = app.isPackaged
  const platform = process.platform // 'darwin' | 'win32'
  const binaryName = platform === 'win32' ? 'sing-box.exe' : 'sing-box'

  if (isPackaged) {
    // In packaged app: resources/sidecar/sing-box
    return join(process.resourcesPath, 'sidecar', binaryName)
  }

  // In dev: resources/sidecar/{platform}-{arch}/sing-box
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return join(app.getAppPath(), 'resources', 'sidecar', `${platform}-${arch}`, binaryName)
}

function getConfigDir(): string {
  const dir = join(app.getPath('userData'), 'singbox')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function generateConfig(preProxyHost?: string, preProxyPort?: number): object {
  const usePreProxy = preProxyHost && preProxyPort

  const proxyOut: Record<string, unknown> = {
    type: REMOTE.type,
    tag: 'proxy-out',
    server: REMOTE.server,
    server_port: REMOTE.server_port,
    method: REMOTE.method,
    password: REMOTE.password,
  }
  if (usePreProxy) {
    proxyOut.detour = 'pre-proxy'
  }

  const outbounds: Record<string, unknown>[] = [proxyOut]
  if (usePreProxy) {
    outbounds.push({
      type: 'http',
      tag: 'pre-proxy',
      server: preProxyHost,
      server_port: preProxyPort
    })
  }
  outbounds.push({ type: 'direct', tag: 'direct' })

  return {
    log: { level: 'warn' },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: '127.0.0.1',
        listen_port: LOCAL_PORT
      }
    ],
    outbounds,
    route: {
      rules: [
        {
          domain_suffix: ['.claude.ai', '.anthropic.com'],
          outbound: 'proxy-out'
        },
        {
          // IP check services — needed for proxy verification only
          domain: ['icanhazip.com', 'ipv4.icanhazip.com', 'ipinfo.io', 'api.ipify.org'],
          outbound: 'proxy-out'
        }
      ],
      final: 'direct'
    }
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

export async function startSidecar(preProxy?: string): Promise<{ ok: boolean; error?: string }> {
  await stopSidecar()

  let config: object
  if (preProxy === 'direct') {
    config = generateConfig()
  } else {
    const proxy = preProxy || DEFAULT_PRE_PROXY
    const [host, portStr] = proxy.split(':')
    const port = parseInt(portStr, 10) || 7890
    config = generateConfig(host, port)
  }
  const configDir = getConfigDir()
  const configPath = join(configDir, 'config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  const binary = getSidecarBinary()
  if (!existsSync(binary)) {
    return { ok: false, error: `Sing-box binary not found: ${binary}` }
  }

  return new Promise((resolve) => {
    try {
      sidecarProcess = spawn(binary, ['run', '-c', configPath], {
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

      const timer = setTimeout(() => done({ ok: false, error: 'Sing-box start timeout' }), 10000)

      // Watch both stdout and stderr for log output
      let logBuf = ''
      const onData = (data: Buffer) => {
        logBuf += data.toString()
        if (logBuf.includes('sing-box started')) {
          done({ ok: true })
        }
        if (/fatal|FATAL/.test(logBuf)) {
          done({ ok: false, error: logBuf.trim().split('\n').pop() || 'Sing-box fatal error' })
        }
      }
      sidecarProcess.stdout?.on('data', onData)
      sidecarProcess.stderr?.on('data', onData)

      // Fallback: poll port every 500ms in case log detection fails
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
          onCrashCallback?.(`Sing-box error: ${err.message}`)
        }
      })
      sidecarProcess.on('exit', (code) => {
        sidecarProcess = null
        if (!resolved) {
          done({ ok: false, error: `Sing-box exited with code ${code}` })
        } else {
          onCrashCallback?.(`Sing-box exited with code ${code}`)
        }
      })
    } catch (err) {
      resolve({ ok: false, error: String(err) })
    }
  })
}

/** Verify proxy works: check sing-box is listening + VPS is reachable via SNI method */
export function verifySidecar(): Promise<{ ok: boolean; ip?: string; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'Verify timeout' }), 15000)

    // Verify by connecting directly to VPS with SNI spoofing
    const req = http.request(
      {
        hostname: '13.113.99.64',
        port: 80,
        path: '/ip',
        method: 'GET',
        headers: { Host: 'anthropic.com' },
        timeout: 14000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          clearTimeout(timer)
          const ip = body.trim()
          resolve(ip ? { ok: true, ip } : { ok: false, error: 'Empty response' })
        })
      }
    )
    req.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }) })
    req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve({ ok: false, error: 'Connection timeout' }) })
    req.end()
  })
}

export async function stopSidecar(): Promise<void> {
  if (sidecarProcess) {
    const proc = sidecarProcess
    sidecarProcess = null
    proc.kill('SIGTERM')
    // Wait for exit
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

/** Kill any orphaned sing-box processes left from a previous crash */
export function killOrphanedSidecar(): void {
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/F', '/IM', 'sing-box.exe'], () => {})
    } else {
      execFile('pkill', ['-f', 'sing-box'], () => {})
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
        .slice(1) // skip header line
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
  // Also clean terminal env
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
    // .zshenv is sourced by ALL zsh instances (interactive + non-interactive)
    return [join(home, '.zshenv')]
  } else if (process.platform === 'win32') {
    return [] // Windows terminal uses system env vars, handled separately
  }
  return [join(home, '.bashrc')]
}

export function setShellProxy(): void {
  if (process.platform === 'win32') {
    // Set user-level env vars on Windows
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
      // Remove old snippet if present
      const re = new RegExp(`\\n?${MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g')
      content = content.replace(re, '\n')
      // Append new snippet
      content = content.trimEnd() + '\n' + PROXY_SNIPPET + '\n'
      writeFileSync(profile, content)
    } catch { /* skip if no permission */ }
  }
}

export function clearShellProxy(): void {
  if (process.platform === 'win32') {
    // Remove user-level env vars on Windows (set to empty)
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
