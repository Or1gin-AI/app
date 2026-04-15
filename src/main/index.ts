import { app, shell, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { net } from 'electron'
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'node:fs'
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, onSidecarCrash, setSystemProxy, clearSystemProxy, clearShellProxy, setShellProxy, killOrphanedSidecar, updateOutboundPassword, checkSystemProxy, getLocalPort, startHelper, stopHelper, killOrphanedHelper } from './sidecar'

const API_BASE = process.env.ORIGINAI_API_BASE || process.env.API_BASE || 'https://dev.originai.cc'
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
})

// Telemetry disable flag (--no-telemetry)
const TELEMETRY_DISABLED = process.argv.includes('--no-telemetry')

// ── App settings (remember password, auto-login, auto-launch) ──

interface AppSettings {
  rememberPassword: boolean
  autoLogin: boolean
  autoLaunch: boolean
  savedEmail: string
  savedPassword: string
}

const DEFAULT_SETTINGS: AppSettings = {
  rememberPassword: false,
  autoLogin: false,
  autoLaunch: false,
  savedEmail: '',
  savedPassword: '',
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'app-settings.json')
}

function loadSettings(): AppSettings {
  try {
    const p = getSettingsPath()
    if (existsSync(p)) return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(p, 'utf-8')) }
  } catch { /* ignore corrupt file */ }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(settings: AppSettings): void {
  writeFileSync(getSettingsPath(), JSON.stringify(settings))
}

// Persistent session storage
function getSessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

interface StoredSession {
  cookies: string[]
  token?: string
  user?: { email: string; name: string }
}

interface AuthSessionPayload {
  user?: {
    email: string
    name?: string
    username?: string
  }
  session?: {
    token?: string
  }
}

function loadSession(): StoredSession {
  try {
    const p = getSessionPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* ignore corrupt file */ }
  return { cookies: [] }
}

function saveSession(cookies: string[], user?: { email: string; name: string }, token?: string | null): void {
  writeFileSync(getSessionPath(), JSON.stringify({ cookies, user, token: token ?? undefined }))
}

function clearSession(): void {
  try { writeFileSync(getSessionPath(), JSON.stringify({ cookies: [] })) } catch { /* */ }
}

let sessionCookies: string[] = []
let sessionToken: string | null = null
let sessionUser: { email: string; name: string } | undefined

function captureSession(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const payload = data as AuthSessionPayload
  if (payload.session?.token) {
    sessionToken = payload.session.token
  }
  if (payload.user?.email) {
    sessionUser = {
      email: payload.user.email,
      name: payload.user.name ?? payload.user.username ?? sessionUser?.name ?? '',
    }
  }
  if (sessionCookies.length > 0 || sessionToken || sessionUser) {
    saveSession(sessionCookies, sessionUser, sessionToken)
  }
}

async function authFetch(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Origin': API_BASE
  }
  if (sessionCookies.length > 0) {
    headers['Cookie'] = sessionCookies.join('; ')
  }

  const resp = await net.fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  })

  // Capture set-cookie headers
  const setCookie = resp.headers.getSetCookie?.() ?? []
  if (setCookie.length > 0) {
    sessionCookies = setCookie.map((c) => c.split(';')[0])
    saveSession(sessionCookies, sessionUser)
  }

  const text = await resp.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  captureSession(data)
  return { status: resp.status, data }
}

// Forward main process logs to renderer DevTools
const origLog = console.log
const origErr = console.error
const origWarn = console.warn
function sendToRenderer(level: string, ...args: unknown[]) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.executeJavaScript(
        `console.${level}('[main]', ${JSON.stringify(msg)})`
      ).catch(() => { })
    }
  }
}
console.log = (...args: unknown[]) => { origLog(...args); sendToRenderer('log', ...args) }
console.error = (...args: unknown[]) => { origErr(...args); sendToRenderer('error', ...args) }
console.warn = (...args: unknown[]) => { origWarn(...args); sendToRenderer('warn', ...args) }

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : {
      titleBarOverlay: {
        color: 'rgba(0,0,0,0)',
        symbolColor: '#6b6560',
        height: 36
      }
    }),
    trafficLightPosition: isMac ? { x: 16, y: 10 } : undefined,
    backgroundColor: '#faf8f5',
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Set CSP — only inject on our own pages (localhost), not on external API responses
  mainWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ['http://localhost:*/*', 'http://127.0.0.1:*/*'] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://*.posthog.com; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data:; " +
            "frame-src https://challenges.cloudflare.com; " +
            "connect-src * https: wss:;"
          ]
        }
      })
    }
  )

  mainWindow.on('close', (e) => {
    // Auto-update install is already confirmed by the user — don't block it
    if (updaterInstallInProgress) return
    // Only warn when the proxy is actively running
    if (!isSidecarRunning()) return

    e.preventDefault()
    const isChinese = app.getLocale().startsWith('zh')
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: [isChinese ? '退出' : 'Quit', isChinese ? '取消' : 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'OriginAI',
      message: isChinese ? '代理仍在运行' : 'Proxy is still running',
      detail: isChinese
        ? '请先断开代理连接再退出，否则系统代理设置可能残留。'
        : 'Please disconnect the proxy before quitting to avoid leftover system proxy settings.',
    }).then(({ response }) => {
      if (response === 0) {
        mainWindow.destroy()
      }
    })
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Allow DevTools via Cmd+Shift+I / Ctrl+Shift+I in all builds
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const isMac = process.platform === 'darwin'
    if ((isMac ? input.meta : input.control) && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Serve via localhost (file:// has null origin, some APIs reject it)
    const rendererDir = join(__dirname, '../renderer')
    const { extname: pathExt } = require('path') as typeof import('path')
    const MIME: Record<string, string> = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
      '.ico': 'image/x-icon', '.webp': 'image/webp',
    }
    const srv = http.createServer((req, res) => {
      const raw = (req.url || '/').split('?')[0]
      const decoded = decodeURIComponent(raw)
      let filePath = join(rendererDir, decoded === '/' ? 'index.html' : decoded)

      if (!existsSync(filePath)) {
        // Assets with extension → 404; routes without extension → SPA fallback
        if (pathExt(decoded)) {
          res.writeHead(404); res.end(); return
        }
        filePath = join(rendererDir, 'index.html')
      }

      const ext = pathExt(filePath).toLowerCase()
      const contentType = MIME[ext] || 'application/octet-stream'
      const stat = statSync(filePath)
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size })
      createReadStream(filePath).pipe(res)
    })
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as import('net').AddressInfo).port
      console.log(`[renderer] serving on http://localhost:${port}`)
      mainWindow.loadURL(`http://localhost:${port}`)
    })
  }
}

// --- IP detection helpers ---

/** Check if a string looks like an IPv4 address */
function isValidIp(s: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function fetchTextDirect(urlString: string, timeoutMs = 5_000): Promise<string | null> {
  const { request: httpRequest } = require('node:http') as typeof import('node:http')
  const { request: httpsRequest } = require('node:https') as typeof import('node:https')
  const url = new URL(urlString)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': `OriginAI/${app.getVersion()}`,
          'Accept': 'text/plain, application/json;q=0.9, */*;q=0.8',
        },
      },
      (res) => {
        if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          void fetchTextDirect(next, timeoutMs).then(resolve)
          return
        }

        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { data += chunk })
        res.on('end', () => resolve(data.trim() || null))
      }
    )

    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

async function fetchJsonDirect(url: string, timeoutMs = 5_000): Promise<Record<string, unknown> | null> {
  const text = await fetchTextDirect(url, timeoutMs)
  if (!text) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Fetch IP directly, bypassing any in-app proxy logic. */
async function fetchExitIpDirect(): Promise<string | null> {
  const candidates = [
    'https://api.ipify.org',
    'https://api4.ipify.org',
    'https://checkip.amazonaws.com',
    'https://ipv4.icanhazip.com',
  ]

  for (const url of candidates) {
    const raw = await fetchTextDirect(url, 5_000)
    const ip = raw?.trim() || ''
    if (isValidIp(ip)) return ip
  }

  return null
}

interface DirectIpInfo {
  ip: string
  country: string
  countryCode: string
  region: string
  city: string
  isp: string
  org: string
  as: string
  isProxy: boolean
  isHosting: boolean
  isMobile: boolean
  isChina: boolean
}

function normalizeIpApi(rawIp: string, data: Record<string, unknown>): DirectIpInfo | null {
  if (data.status !== 'success' || typeof data.countryCode !== 'string') return null
  const countryCode = String(data.countryCode || '')
  return {
    ip: rawIp,
    country: String(data.country || 'Unknown'),
    countryCode,
    region: String(data.regionName || ''),
    city: String(data.city || ''),
    isp: String(data.isp || ''),
    org: String(data.org || ''),
    as: String(data.as || ''),
    isProxy: Boolean(data.proxy),
    isHosting: Boolean(data.hosting),
    isMobile: Boolean(data.mobile),
    isChina: countryCode === 'CN',
  }
}

function normalizeIpApiCo(rawIp: string, data: Record<string, unknown>): DirectIpInfo | null {
  const countryCode = String(data.country_code || '')
  if (!countryCode || data.error) return null
  return {
    ip: rawIp,
    country: String(data.country_name || data.country || 'Unknown'),
    countryCode,
    region: String(data.region || ''),
    city: String(data.city || ''),
    isp: String(data.org || ''),
    org: String(data.org || ''),
    as: String(data.asn || ''),
    isProxy: false,
    isHosting: false,
    isMobile: false,
    isChina: countryCode === 'CN',
  }
}

async function lookupDirectIpInfo(rawIp: string): Promise<DirectIpInfo | null> {
  const fields = [
    'status', 'message', 'query', 'country', 'countryCode',
    'regionName', 'city', 'isp', 'org', 'as', 'proxy', 'hosting', 'mobile'
  ].join(',')

  const providers: Array<() => Promise<DirectIpInfo | null>> = [
    async () => {
      const data = await fetchJsonDirect(`http://ip-api.com/json/${rawIp}?fields=${fields}&lang=zh-CN`, 5_000)
      return data ? normalizeIpApi(rawIp, data) : null
    },
    async () => {
      const data = await fetchJsonDirect(`https://ipapi.co/${rawIp}/json/`, 5_000)
      return data ? normalizeIpApiCo(rawIp, data) : null
    },
  ]

  for (const provider of providers) {
    const result = await provider()
    if (result) return result
  }

  return null
}

/** Fetch exit IP through proxy: ipify.org is whitelisted in Xray routing → goes through Trojan tunnel */
async function fetchExitIpViaProxy(): Promise<string | null> {
  const port = getLocalPort()
  const http = require('node:http') as typeof import('node:http')

  for (const host of ['api.ipify.org', 'api4.ipify.org']) {
    const raw = await new Promise<string | null>((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: `http://${host}/`,
        method: 'GET',
        headers: { Host: host },
      }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => resolve(data.trim() || null))
      })
      req.on('error', () => resolve(null))
      req.setTimeout(15_000, () => { req.destroy(); resolve(null) })
      req.end()
    })
    if (raw && isValidIp(raw)) return raw
  }
  return null
}

// Full IP check: always direct (used by NetworkSetupPage initial detection)
ipcMain.handle('check-ip', async () => {
  try {
    const rawIp = await withTimeout(fetchExitIpDirect(), 12_000, 'exit IP detection')
    if (!rawIp) throw new Error('Could not determine exit IP')

    const info = await withTimeout(lookupDirectIpInfo(rawIp), 12_000, 'IP geolocation')
    if (!info) throw new Error('Could not determine IP location')

    return info
  } catch (err) {
    return { error: String(err) }
  }
})

// Quick IP ping (renderer can call this for lightweight checks)
ipcMain.handle('check-ip-quick', async () => {
  const running = isSidecarRunning()
  const ip = running ? await fetchExitIpViaProxy() : null
  return { ok: running && ip !== null, ip }
})

// Local IP: checkip.amazonaws.com is NOT in Xray routing rules → Xray sends it direct → local IP
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

// Proxy IP: curl through proxy
ipcMain.handle('check-proxy-ip', async () => {
  const ip = await fetchExitIpViaProxy()
  return { ok: ip !== null, ip }
})

// --- Periodic health check (every 60s) ---
let healthInterval: ReturnType<typeof setInterval> | null = null
let healthRunning = false

function startHealthCheck(): void {
  if (healthInterval) return
  healthRunning = true
  healthInterval = setInterval(async () => {
    if (!healthRunning) return
    const running = isSidecarRunning()
    const ip = running ? await fetchExitIpViaProxy() : null
    const ok = running && ip !== null
    broadcast('network-health', { ok, ip })
  }, 10_000)
}

function stopHealthCheck(): void {
  healthRunning = false
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
}

ipcMain.handle('health:start', () => { startHealthCheck(); return { ok: true } })
ipcMain.handle('health:stop', () => { stopHealthCheck(); return { ok: true } })

// ── Session validity check (detect kicked-out sessions) ──

let sessionCheckInterval: ReturnType<typeof setInterval> | null = null
let sessionCheckInFlight = false

function expireSession(reason: string): void {
  console.log(`[session] ${reason} — forcing logout`)
  sessionCookies = []
  sessionToken = null
  sessionUser = undefined
  clearSession()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('session:expired')
    }
  }
  stopSessionCheck()
}

async function runSessionCheck(): Promise<void> {
  if (sessionCheckInFlight) return
  if (sessionCookies.length === 0 && !sessionToken) return

  sessionCheckInFlight = true
  try {
    const res = await withTimeout(authFetch('GET', '/api/auth/get-session'), 8_000, 'session check')
    if (res.status === 401 || res.status === 403) {
      expireSession(`Session invalidated (status: ${res.status})`)
    }
  } catch {
    // Network error / timeout — keep the local session and try again later.
  } finally {
    sessionCheckInFlight = false
  }
}

function startSessionCheck(): void {
  if (sessionCheckInterval) return
  void runSessionCheck()
  sessionCheckInterval = setInterval(() => {
    void runSessionCheck()
  }, 10_000)
}

function stopSessionCheck(): void {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval)
    sessionCheckInterval = null
  }
  sessionCheckInFlight = false
}

ipcMain.handle('session:start-check', () => { startSessionCheck(); return { ok: true } })
ipcMain.handle('session:stop-check', () => { stopSessionCheck(); return { ok: true } })

// Detect system HTTP proxy
function parseWindowsProxyServer(value: string): { host: string; port: string } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const segments = trimmed.split(';').map((item) => item.trim()).filter(Boolean)

  for (const prefix of ['https=', 'http=', 'socks=']) {
    const match = segments.find((item) => item.toLowerCase().startsWith(prefix))
    if (match) {
      const proxy = match.slice(prefix.length)
      const [host, port] = proxy.includes(':') ? proxy.split(':') : [proxy, '80']
      return host ? { host, port } : null
    }
  }

  const [host, port] = trimmed.includes(':') ? trimmed.split(':') : [trimmed, '80']
  return host ? { host, port } : null
}

ipcMain.handle('detect-system-proxy', async () => {
  const { execSync } = await import('child_process')
  const ourPort = String(getLocalPort())
  try {
    if (process.platform === 'darwin') {
      const out = execSync('scutil --proxy', { encoding: 'utf-8' })
      const candidates = [
        { enabled: /HTTPEnable\s*:\s*1/.test(out), host: out.match(/HTTPProxy\s*:\s*(.+)/), port: out.match(/HTTPPort\s*:\s*(\d+)/) },
        { enabled: /HTTPSEnable\s*:\s*1/.test(out), host: out.match(/HTTPSProxy\s*:\s*(.+)/), port: out.match(/HTTPSPort\s*:\s*(\d+)/) },
        { enabled: /SOCKSEnable\s*:\s*1/.test(out), host: out.match(/SOCKSProxy\s*:\s*(.+)/), port: out.match(/SOCKSPort\s*:\s*(\d+)/) },
      ]
      for (const candidate of candidates) {
        if (!candidate.enabled || !candidate.host || !candidate.port) continue
        const host = candidate.host[1].trim()
        const port = candidate.port[1].trim()
        if (port === ourPort && host === '127.0.0.1') return { found: false }
        return { found: true, host, port }
      }
    } else if (process.platform === 'win32') {
      const enableOut = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
        { encoding: 'utf-8' }
      )
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x0*1/.test(enableOut)
      if (!enabled) return { found: false }
      const out = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
        { encoding: 'utf-8' }
      )
      const match = out.match(/ProxyServer\s+REG_SZ\s+(.+)/)
      if (match) {
        const parsed = parseWindowsProxyServer(match[1])
        if (!parsed) return { found: false }
        if (parsed.port === ourPort && parsed.host === '127.0.0.1') return { found: false }
        return { found: true, host: parsed.host, port: parsed.port }
      }
    } else if (process.platform === 'linux') {
      const mode = execSync('gsettings get org.gnome.system.proxy mode', { encoding: 'utf-8' }).trim().replace(/'/g, '')
      if (mode !== 'manual') return { found: false }
      const host = execSync('gsettings get org.gnome.system.proxy.http host', { encoding: 'utf-8' }).trim().replace(/'/g, '')
      const port = execSync('gsettings get org.gnome.system.proxy.http port', { encoding: 'utf-8' }).trim()
      if (host && !(host === '127.0.0.1' && port === ourPort)) {
        return { found: true, host, port }
      }
    }
  } catch { /* no proxy */ }
  return { found: false }
})

// Auth IPC handlers

// Restore session from disk — called on app start
ipcMain.handle('auth:restore-session', async () => {
  const saved = loadSession()
  sessionCookies = saved.cookies
  sessionToken = saved.token ?? null
  sessionUser = saved.user

  // Verify session is still valid
  const res = await authFetch('GET', '/api/auth/get-session')
  if (res.status === 200) {
    captureSession(res.data)
    return { ok: true, user: sessionUser }
  }

  // Session expired
  sessionCookies = []
  sessionToken = null
  sessionUser = undefined
  clearSession()
  return { ok: false }
})

ipcMain.handle('auth:sign-up', async (_e, username: string, email: string, password: string) => {
  return authFetch('POST', '/api/auth/sign-up/email', { name: username, username, email, password })
})

ipcMain.handle('auth:check-username', async (_e, username: string) => {
  return authFetch('GET', `/api/auth/is-username-available?username=${encodeURIComponent(username)}`)
})

ipcMain.handle('auth:sign-in', async (_e, email: string, password: string) => {
  // Clear old session to avoid stale emailVerified state
  sessionCookies = []
  sessionToken = null
  sessionUser = undefined
  const res = await authFetch('POST', '/api/auth/sign-in/email', { email, password })
  if (res.status === 200) {
    captureSession(res.data)
  }
  return res
})

ipcMain.handle('auth:send-otp', async (_e, email: string, type: string) => {
  return authFetch('POST', '/api/auth/email-otp/send-verification-otp', { email, type })
})

ipcMain.handle('auth:verify-email', async (_e, email: string, otp: string) => {
  return authFetch('POST', '/api/auth/email-otp/verify-email', { email, otp })
})

ipcMain.handle('auth:get-session', async () => {
  return authFetch('GET', '/api/auth/get-session')
})

ipcMain.handle('auth:get-newuser', async () => {
  return authFetch('GET', '/api/auth/is-newuser')
})

ipcMain.handle('auth:set-newuser', async (_e, value: number) => {
  return authFetch('POST', '/api/auth/is-newuser', { value })
})

ipcMain.handle('auth:reset-password', async (_e, email: string, otp: string, newPassword: string) => {
  return authFetch('POST', '/api/auth/email-otp/reset-password', { email, otp, newPassword })
})

ipcMain.handle('auth:profile', async () => {
  const res = await authFetch('GET', '/api/auth/profile')
  console.log('[auth:profile] status:', res.status, 'data:', JSON.stringify(res.data, null, 2))
  return res
})

ipcMain.handle('auth:sign-out', async () => {
  const result = await authFetch('POST', '/api/auth/sign-out')
  sessionCookies = []
  sessionToken = null
  sessionUser = undefined
  clearSession()
  return result
})

// Proxy auth IPC handler
ipcMain.handle('proxy-auth:login', async () => {
  return authFetch('GET', '/api/proxy-auth/login')
})

// SMS activation IPC handlers
ipcMain.handle('sms:request-number', async () => {
  return authFetch('POST', '/api/sms/request-number')
})

ipcMain.handle('sms:phone-number', async () => {
  return authFetch('GET', '/api/sms/phone-number')
})

ipcMain.handle('sms:status', async () => {
  return authFetch('GET', '/api/sms/status')
})

ipcMain.handle('sms:refresh-number', async () => {
  return authFetch('POST', '/api/sms/refresh-number')
})

ipcMain.handle('sms:refund', async () => {
  return authFetch('POST', '/api/sms/refund')
})

// Payment IPC handlers
ipcMain.handle('payment:open-checkout', async (_e, url: string) => {
  const parent = BrowserWindow.getAllWindows()[0]
  const checkoutWin = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  checkoutWin.loadURL(url)
  checkoutWin.once('ready-to-show', () => checkoutWin.show())

  // Auto-close when navigated to our redirect/success URL
  const checkAndClose = (navUrl: string): void => {
    if (checkoutWin.isDestroyed()) return
    if (navUrl.includes('/api/payment/redirect') || navUrl.includes('/payment/success')) {
      checkoutWin.close()
    }
  }

  checkoutWin.webContents.on('did-navigate', (_event, navUrl) => checkAndClose(navUrl))
  checkoutWin.webContents.on('did-navigate-in-page', (_event, navUrl) => checkAndClose(navUrl))
  checkoutWin.webContents.on('will-redirect', (_event, navUrl) => checkAndClose(navUrl))
  checkoutWin.webContents.on('did-finish-load', () => {
    if (!checkoutWin.isDestroyed()) {
      checkAndClose(checkoutWin.webContents.getURL())
    }
  })

  checkoutWin.on('closed', () => {
    if (parent && !parent.isDestroyed()) {
      parent.webContents.send('payment:checkout-closed')
    }
  })

  return { ok: true }
})

ipcMain.handle('payment:checkout', async (_e, productType: string, provider?: string, claudeAccountId?: string) => {
  const body: Record<string, unknown> = { product_type: productType }
  if (provider) body.provider = provider
  if (claudeAccountId) body.claude_account_id = claudeAccountId
  return authFetch('POST', '/api/payment/checkout', body)
})

ipcMain.handle('payment:redeem-code', async (_e, code: string, claudeAccountId: string) => {
  return authFetch('POST', '/api/payment/redeem-code', {
    code,
    claude_account_id: claudeAccountId,
  })
})

ipcMain.handle('payment:orders', async (_e, page?: number, limit?: number) => {
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))
  const query = params.toString()
  return authFetch('GET', `/api/payment/orders${query ? `?${query}` : ''}`)
})

ipcMain.handle('payment:cancel-subscription', async (_e, claudeAccountId: string) => {
  return authFetch('POST', '/api/payment/cancel-subscription', { claude_account_id: claudeAccountId })
})

// Telemetry
ipcMain.handle('telemetry:is-disabled', () => TELEMETRY_DISABLED)

// Claude Account IPC handlers
ipcMain.handle('claude-account:create-self-service', async (_e, email?: string) => {
  return authFetch('POST', '/api/claude-account/create-self-service', email ? { gmail: email } : {})
})

ipcMain.handle('claude-account:list', async () => {
  return authFetch('GET', '/api/claude-account/list')
})

ipcMain.handle('claude-account:complete-self-service-registration', async () => {
  return authFetch('POST', '/api/claude-account/complete-self-service-registration')
})

// Ticket system IPC handlers
const TICKET_API = process.env.TICKET_API_BASE || 'https://api-ticket.originai.cc'

async function ticketFetch(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const url = `${TICKET_API}${path}`
  console.log(`[ticket] ${method} ${url}`)
  const token = await getSessionToken()
  if (!token) {
    console.warn(`[ticket] ${method} ${path} skipped: missing session token`)
    return { status: 401, data: { message: 'Not authenticated' } }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }
  try {
    const resp = await net.fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const text = await resp.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text }
    console.log(`[ticket] ${method} ${path} → ${resp.status}`)
    return { status: resp.status, data }
  } catch (err) {
    console.error(`[ticket] ${method} ${path} FAILED:`, err)
    return { status: 0, data: { error: String(err) } }
  }
}

async function getSessionToken(): Promise<string | null> {
  if (sessionToken) return sessionToken

  const cookie = sessionCookies.find((item) => item.startsWith('better-auth.session_token='))
  if (cookie) {
    sessionToken = cookie.slice('better-auth.session_token='.length)
    saveSession(sessionCookies, sessionUser, sessionToken)
    return sessionToken
  }

  const res = await authFetch('GET', '/api/auth/get-session')
  if (res.status !== 200) return null

  captureSession(res.data)
  return sessionToken
}

ipcMain.handle('ticket:list', async (_e, params: string) => {
  return ticketFetch('GET', `/api/tickets?${params}`)
})

ipcMain.handle('ticket:detail', async (_e, ticketId: string) => {
  return ticketFetch('GET', `/api/tickets/${ticketId}`)
})

ipcMain.handle('ticket:create', async (_e, body: Record<string, unknown>) => {
  return ticketFetch('POST', '/api/tickets', body)
})

ipcMain.handle('ticket:timeline', async (_e, ticketId: string) => {
  return ticketFetch('GET', `/api/tickets/${ticketId}/timeline`)
})

ipcMain.handle('ticket:comment', async (_e, ticketId: string, content: string) => {
  return ticketFetch('POST', `/api/tickets/${ticketId}/comments`, { content })
})

// Sidecar IPC handlers
// Track proxy credentials and current pre-proxy for auto-refresh / status display
let proxyCredentials: { username: string; password: string; expireAt: string } | null = null
let currentPreProxy: string | null = null // e.g. '127.0.0.1:7890' or null if direct
let proxyRefreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleProxyRefresh(): void {
  if (proxyRefreshTimer) clearTimeout(proxyRefreshTimer)
  if (!proxyCredentials) return

  const expireMs = new Date(proxyCredentials.expireAt).getTime() - Date.now()
  // Refresh 30 minutes before expiry
  const refreshIn = Math.max(expireMs - 30 * 60 * 1000, 60_000)

  proxyRefreshTimer = setTimeout(async () => {
    try {
      const res = await authFetch('GET', '/api/proxy-auth/login')
      if (res.status === 200) {
        const data = res.data as { username: string; password: string; expireAt: string }
        proxyCredentials = data
        console.log('[proxy-auth] credentials refreshed, new expiry:', data.expireAt)
        console.log("[proxy-auth] credentials refreshed, new password:", data.password)

        // Update xray password if running
        if (isSidecarRunning()) {
          await updateOutboundPassword(data.password)
        }
        scheduleProxyRefresh()
      }
    } catch (err) {
      console.error('[proxy-auth] refresh failed:', err)
      // Retry in 5 minutes
      proxyRefreshTimer = setTimeout(() => scheduleProxyRefresh(), 5 * 60 * 1000)
    }
  }, refreshIn)

  console.log(`[proxy-auth] next refresh in ${Math.round(refreshIn / 60000)} min`)
}

// --- System proxy monitor (only when optimization active) ---
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

ipcMain.handle('sidecar:start', async () => {
  // Clear session proxy so authFetch goes direct (in-memory, no OS network change).
  // Don't clear system proxy here — it triggers ERR_NETWORK_CHANGED.
  // System proxy will be overwritten by setSystemProxy() after Xray starts.
  for (const win of BrowserWindow.getAllWindows()) {
    await win.webContents.session.setProxy({ mode: 'direct' })
  }

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
  console.log('[proxy-auth] got credentials, expires:', creds.expireAt, 'password:', creds.password)

  currentPreProxy = null
  const result = await startSidecar(creds.password)
  if (result.ok) {
    const port = getLocalPort()
    for (const win of BrowserWindow.getAllWindows()) {
      await win.webContents.session.setProxy({
        proxyRules: `http://127.0.0.1:${port}`
      })
    }
    await setSystemProxy().catch(() => {})
    setShellProxy()
    scheduleProxyRefresh()
    startProxyMonitor()
    startHelper()
  }
  return result
})

ipcMain.handle('sidecar:stop', async () => {
  if (proxyRefreshTimer) { clearTimeout(proxyRefreshTimer); proxyRefreshTimer = null }
  proxyCredentials = null
  currentPreProxy = null
  stopProxyMonitor()
  stopHelper()
  await stopSidecar()

  for (const win of BrowserWindow.getAllWindows()) {
    await win.webContents.session.setProxy({ mode: 'direct' })
  }
  await clearSystemProxy().catch(() => {})
  return { ok: true }
})

ipcMain.handle('sidecar:status', () => {
  return { running: isSidecarRunning() }
})

ipcMain.handle('sidecar:proxy-status', () => {
  return { running: isSidecarRunning(), port: getLocalPort(), preProxy: currentPreProxy }
})

ipcMain.handle('sidecar:verify', async () => {
  // Use the sidecar's own low-level verification path instead of Chromium net.fetch.
  // This avoids Windows CONNECT/TLS edge cases when Xray itself is chained through
  // an upstream local HTTP proxy such as Clash on 127.0.0.1:7890.
  return verifySidecar()
})

// Settings IPC
ipcMain.handle('settings:get', () => loadSettings())
ipcMain.handle('settings:set', (_e, settings: AppSettings) => {
  saveSettings(settings)
  // Sync auto-launch with OS
  app.setLoginItemSettings({ openAtLogin: settings.autoLaunch })
  return { ok: true }
})

// ── Auto-update ──

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  const safeLog = (fn: (...a: unknown[]) => void, ...args: unknown[]) => { try { fn(...args) } catch {} }
  autoUpdater.logger = {
    info: (...args: unknown[]) => safeLog(console.log, '[updater]', ...args),
    warn: (...args: unknown[]) => safeLog(console.warn, '[updater]', ...args),
    error: (...args: unknown[]) => safeLog(console.error, '[updater]', ...args),
    debug: (...args: unknown[]) => safeLog(console.log, '[updater:debug]', ...args),
  }
  let pendingVersion = ''

  autoUpdater.on('checking-for-update', () => {
    broadcast('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    pendingVersion = info.version
    broadcast('updater:status', { status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast('updater:status', { status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcast('updater:status', {
      status: 'downloading',
      version: pendingVersion,
      percent: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    pendingVersion = info.version
    broadcast('updater:status', { status: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const msg = String(err)
    if (msg.includes('ERR_NETWORK_CHANGED')) {
      console.warn('[updater] network changed during update, retrying in 5s…')
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5_000)
      return
    }
    broadcast('updater:status', { status: 'error', message: msg })
  })

  // Check now, then every hour
  autoUpdater.checkForUpdates().catch(() => { })
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => { })
  }, 60 * 60 * 1000)
}

function broadcast(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

let updaterInstallInProgress = false

async function runUpdaterInstallCleanup(): Promise<void> {
  stopProxyMonitor()
  // Clear shell env synchronously first so a partial quit still restores the terminal.
  clearShellProxy()

  const cleanupSteps: Array<[string, Promise<unknown>]> = [
    ['clear system proxy', withTimeout(clearSystemProxy(), 4_000, 'clear system proxy')],
    ['stop sidecar', withTimeout(stopSidecar(), 4_000, 'stop sidecar')],
  ]

  const results = await Promise.allSettled(cleanupSteps.map(([, promise]) => promise))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`[updater] ${cleanupSteps[index][0]} failed:`, result.reason)
    }
  })
}

ipcMain.handle('updater:install', async () => {
  if (updaterInstallInProgress) return { ok: true }

  updaterInstallInProgress = true
  broadcast('updater:status', { status: 'installing' })
  console.log('[updater] install requested')

  await runUpdaterInstallCleanup()

  // Allow the relaunched instance to start even if the old process is still closing.
  app.releaseSingleInstanceLock()
  console.log('[updater] cleanup finished, calling quitAndInstall')

  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err) {
      updaterInstallInProgress = false
      const message = err instanceof Error ? err.message : String(err)
      console.error('[updater] quitAndInstall failed:', message)
      broadcast('updater:status', { status: 'error', message })
    }
  })

  return { ok: true }
})

ipcMain.handle('updater:check', () => {
  autoUpdater.checkForUpdates().catch(() => { })
})

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return
  // Clean up any orphaned processes left by a previous crash
  killOrphanedSidecar()
  await killOrphanedHelper()

  // Crash recovery: if system proxy points to our port but Xray isn't running, clean up
  // MUST complete before creating window — stale proxy breaks outbound requests
  const hadStaleProxy = await checkSystemProxy().then(async (ours) => {
    if (ours && !isSidecarRunning()) {
      console.log('[proxy] stale system proxy detected from previous crash, cleaning up')
      await clearSystemProxy().catch(() => {})
      return true
    }
    return false
  })

  // Expose cleanup result so renderer can show a brief notice if needed
  ipcMain.handle('proxy:had-stale-cleanup', () => hadStaleProxy)

  electronApp.setAppUserModelId('com.originai.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  createWindow()

  // Start auto-updater (skip in dev)
  if (!is.dev) {
    setupAutoUpdater()
  }

  // Monitor sidecar crashes — notify renderer (don't steal focus)
  onSidecarCrash((reason) => {
    console.log('[xray] crash:', reason)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('network-health', { ok: false, ip: null })
      }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  if (proxyRefreshTimer) { clearTimeout(proxyRefreshTimer); proxyRefreshTimer = null }
  stopProxyMonitor()
  // Don't stopHelper() here — let helper survive and self-detect:
  // after PID gone, it waits 2s, checks if proxy was already cleared.
  // Normal exit: proxy cleared → helper exits silently.
  // Crash: proxy still set → helper runs recovery + dialog.
  await clearSystemProxy().catch(() => {})
  await stopSidecar()
})
