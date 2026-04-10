import { app, shell, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { net } from 'electron'
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from 'node:fs'
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, onSidecarCrash, setSystemProxy, clearSystemProxy, clearShellProxy, setShellProxy, killOrphanedSidecar, updateOutboundPassword, checkSystemProxy, probePreProxy, getLocalPort, startHelper, stopHelper, scanLocalPorts } from './sidecar'

const API_BASE = 'https://dev.originai.cc'

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

function loadSession(): { cookies: string[]; user?: { email: string; name: string } } {
  try {
    const p = getSessionPath()
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* ignore corrupt file */ }
  return { cookies: [] }
}

function saveSession(cookies: string[], user?: { email: string; name: string }): void {
  writeFileSync(getSessionPath(), JSON.stringify({ cookies, user }))
}

function clearSession(): void {
  try { writeFileSync(getSessionPath(), JSON.stringify({ cookies: [] })) } catch { /* */ }
}

let sessionCookies: string[] = []
let sessionUser: { email: string; name: string } | undefined

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
    // Serve via localhost so Turnstile works (file:// has null origin, Cloudflare rejects it)
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

/** Direct IP fetch (no proxy) — used for initial network detection before Xray starts */
function fetchExitIpDirect(): Promise<string | null> {
  const { execFile } = require('child_process') as typeof import('child_process')
  return new Promise((resolve) => {
    // checkip.amazonaws.com is NOT in Xray routing rules, so even if system proxy is set it goes direct
    execFile('curl', ['-4', '-s', '--noproxy', '*', '--max-time', '10', 'https://checkip.amazonaws.com'], (err, stdout) => {
      if (err) { resolve(null); return }
      resolve(stdout.trim() || null)
    })
  })
}

/** Fetch exit IP through proxy: ipify.org is whitelisted in Xray routing → goes through Trojan tunnel */
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

// Full IP check: always direct (used by NetworkSetupPage initial detection)
ipcMain.handle('check-ip', async () => {
  try {
    const rawIp = await fetchExitIpDirect()
    if (!rawIp) throw new Error('Cannot reach proxy endpoint')

    const fields = [
      'status', 'message', 'query', 'country', 'countryCode',
      'regionName', 'city', 'isp', 'org', 'as', 'proxy', 'hosting', 'mobile'
    ].join(',')

    const infoResp = await net.fetch(
      `http://ip-api.com/json/${rawIp}?fields=${fields}&lang=zh-CN`
    )
    const data = await infoResp.json()
    if (data.status === 'fail') throw new Error(data.message)

    return {
      ip: rawIp,
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      city: data.city,
      isp: data.isp,
      org: data.org,
      as: data.as,
      isProxy: data.proxy,
      isHosting: data.hosting,
      isMobile: data.mobile,
      isChina: data.countryCode === 'CN',
    }
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
let healthNotified = false // only notify once per outage

function startHealthCheck(): void {
  if (healthInterval) return
  healthRunning = true
  healthNotified = false
  healthInterval = setInterval(async () => {
    if (!healthRunning) return
    // Only OK if sidecar is running AND proxy exit IP is reachable
    const running = isSidecarRunning()
    const ip = running ? await fetchExitIpViaProxy() : null
    const ok = running && ip !== null
    // Push to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('network-health', { ok, ip })
      }
    }
    if (ok) {
      healthNotified = false // reset so next outage triggers notification
    }
  }, 60_000)
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

function startSessionCheck(): void {
  if (sessionCheckInterval) return
  sessionCheckInterval = setInterval(async () => {
    // Only check if we have an active session
    if (sessionCookies.length === 0) return
    try {
      const res = await authFetch('GET', '/api/auth/get-session')
      if (res.status === 401 || res.status === 403) {
        console.log('[session] Session invalidated (status:', res.status, ') — forcing logout')
        // Clear local session
        sessionCookies = []
        sessionUser = undefined
        clearSession()
        // Notify renderer
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('session:expired')
          }
        }
        stopSessionCheck()
      }
    } catch {
      // Network error — don't logout, just skip
    }
  }, 30_000) // Check every 30 seconds
}

function stopSessionCheck(): void {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval)
    sessionCheckInterval = null
  }
}

ipcMain.handle('session:start-check', () => { startSessionCheck(); return { ok: true } })
ipcMain.handle('session:stop-check', () => { stopSessionCheck(); return { ok: true } })

// Detect system HTTP proxy
ipcMain.handle('detect-system-proxy', async () => {
  const { execSync } = await import('child_process')
  const ourPort = String(getLocalPort())
  try {
    if (process.platform === 'darwin') {
      const out = execSync('scutil --proxy', { encoding: 'utf-8' })
      const httpEnabled = /HTTPEnable\s*:\s*1/.test(out)
      if (!httpEnabled) return { found: false }
      const hostMatch = out.match(/HTTPProxy\s*:\s*(.+)/)
      const portMatch = out.match(/HTTPPort\s*:\s*(\d+)/)
      if (hostMatch && portMatch) {
        // Ignore our own proxy — don't feed it back as upstream (causes loop)
        if (portMatch[1].trim() === ourPort) return { found: false }
        return { found: true, host: hostMatch[1].trim(), port: portMatch[1].trim() }
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
        const val = match[1].trim()
        const [host, port] = val.includes(':') ? val.split(':') : [val, '80']
        if (port === ourPort) return { found: false }
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
  if (saved.cookies.length === 0) return { ok: false }

  sessionCookies = saved.cookies
  sessionUser = saved.user

  // Verify session is still valid
  const res = await authFetch('GET', '/api/auth/get-session')
  if (res.status === 200) {
    const data = res.data as { user?: { email: string; name: string } }
    if (data?.user) {
      sessionUser = { email: data.user.email, name: data.user.name }
      saveSession(sessionCookies, sessionUser)
    }
    return { ok: true, user: sessionUser }
  }

  // Session expired
  sessionCookies = []
  sessionUser = undefined
  clearSession()
  return { ok: false }
})

ipcMain.handle('auth:sign-up', async (_e, username: string, email: string, password: string, turnstileToken?: string) => {
  return authFetch('POST', '/api/auth/sign-up/email', { name: username, username, email, password, turnstileToken })
})

ipcMain.handle('auth:check-username', async (_e, username: string) => {
  return authFetch('GET', `/api/auth/is-username-available?username=${encodeURIComponent(username)}`)
})

ipcMain.handle('auth:sign-in', async (_e, email: string, password: string, turnstileToken?: string) => {
  // Clear old session to avoid stale emailVerified state
  sessionCookies = []
  sessionUser = undefined
  const res = await authFetch('POST', '/api/auth/sign-in/email', { email, password, turnstileToken })
  if (res.status === 200) {
    const data = res.data as { user?: { email: string; name: string } }
    if (data?.user) {
      sessionUser = { email: data.user.email, name: data.user.name }
      saveSession(sessionCookies, sessionUser)
    }
  }
  return res
})

ipcMain.handle('auth:send-otp', async (_e, email: string, type: string, turnstileToken?: string) => {
  return authFetch('POST', '/api/auth/email-otp/send-verification-otp', { email, type, turnstileToken })
})

ipcMain.handle('auth:verify-email', async (_e, email: string, otp: string, turnstileToken?: string) => {
  return authFetch('POST', '/api/auth/email-otp/verify-email', { email, otp, turnstileToken })
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

  // After checkout page loads, close window if redirected to callback URL (payment done)
  checkoutWin.webContents.once('did-finish-load', () => {
    checkoutWin.webContents.on('did-navigate', (_event, navUrl) => {
      const isCheckout =
        navUrl.includes('lemonsqueezy.com') ||
        navUrl.includes('stripe.com') ||
        navUrl.includes('helio') ||
        navUrl.includes('moonpay.com')
      if (!isCheckout && !checkoutWin.isDestroyed()) {
        checkoutWin.close()
      }
    })
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

ipcMain.handle('payment:orders', async (_e, page?: number, limit?: number) => {
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))
  const query = params.toString()
  return authFetch('GET', `/api/payment/orders${query ? `?${query}` : ''}`)
})

// Claude Account IPC handlers
ipcMain.handle('claude-account:create', async () => {
  return authFetch('POST', '/api/claude-account/create')
})

ipcMain.handle('claude-account:list', async () => {
  return authFetch('GET', '/api/claude-account/list')
})

ipcMain.handle('claude-account:listen-email', async (_e, email?: string) => {
  const res = await authFetch('POST', '/api/claude-account/listen-email', email ? { email } : {})
  console.log('[listen-email] status:', res.status, 'data:', JSON.stringify(res.data, null, 2))
  return res
})

// Ticket system IPC handlers
const TICKET_API = process.env.TICKET_API_BASE || 'https://api-ticket.originai.cc'

async function ticketFetch(
  method: string,
  path: string,
  userId: string,
  userName: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const url = `${TICKET_API}${path}`
  console.log(`[ticket] ${method} ${url}`)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
    'X-User-Name': encodeURIComponent(userName || 'Anonymous'),
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

ipcMain.handle('ticket:list', async (_e, userId: string, userName: string, params: string) => {
  return ticketFetch('GET', `/api/tickets?${params}`, userId, userName)
})

ipcMain.handle('ticket:detail', async (_e, userId: string, userName: string, ticketId: string) => {
  return ticketFetch('GET', `/api/tickets/${ticketId}`, userId, userName)
})

ipcMain.handle('ticket:create', async (_e, userId: string, userName: string, body: Record<string, unknown>) => {
  return ticketFetch('POST', '/api/tickets', userId, userName, body)
})

ipcMain.handle('ticket:timeline', async (_e, userId: string, userName: string, ticketId: string) => {
  return ticketFetch('GET', `/api/tickets/${ticketId}/timeline`, userId, userName)
})

ipcMain.handle('ticket:comment', async (_e, userId: string, userName: string, ticketId: string, content: string) => {
  return ticketFetch('POST', `/api/tickets/${ticketId}/comments`, userId, userName, { content })
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

ipcMain.handle('sidecar:start', async (_e, preProxy?: string) => {
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
  console.log('[proxy-auth] got credentials, expires:', creds.expireAt)

  currentPreProxy = (preProxy && preProxy !== 'direct') ? preProxy : null
  const result = await startSidecar(creds.password, preProxy)
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

ipcMain.handle('sidecar:scan-ports', async () => {
  return scanLocalPorts()
})

ipcMain.handle('sidecar:probe-pre-proxy', async (_e, host: string, port: number) => {
  return probePreProxy(host, port)
})

ipcMain.handle('sidecar:verify', async () => {
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
    broadcast('updater:status', { status: 'error', message: String(err) })
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

ipcMain.handle('updater:install', async () => {
  // Clean up proxy before restarting — before-quit may not complete during quitAndInstall
  stopProxyMonitor()
  clearShellProxy()
  await clearSystemProxy().catch(() => {})
  await stopSidecar()
  autoUpdater.quitAndInstall(false, true)
})

ipcMain.handle('updater:check', () => {
  autoUpdater.checkForUpdates().catch(() => { })
})

app.whenReady().then(async () => {
  // Clean up any sing-box left by a previous crash
  killOrphanedSidecar()

  // Crash recovery: if system proxy points to our port but Xray isn't running, clean up
  // MUST complete before creating window — stale proxy breaks Cloudflare Turnstile loading
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
