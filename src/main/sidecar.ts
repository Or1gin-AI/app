import { app } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
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
        }
      ],
      final: 'proxy-out'
    }
  }
}

export function generatePacScript(): string {
  return `function FindProxyForURL(url, host) {
  if (shExpMatch(host, "*.claude.ai") || shExpMatch(host, "*.anthropic.com") || shExpMatch(host, "claude.ai") || shExpMatch(host, "anthropic.com")) {
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

export function getLocalPort(): number {
  return LOCAL_PORT
}
