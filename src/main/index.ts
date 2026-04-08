import { app, shell, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { net } from 'electron'
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, generatePacScript, onSidecarCrash, setSystemProxy, clearSystemProxy, setShellProxy, killOrphanedSidecar } from './sidecar'

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

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 540,
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- IP detection helpers ---

/** Direct IP fetch via SNI spoofing to VPS — used when sidecar is NOT running */
function fetchExitIpDirect(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '13.113.99.64',
        port: 80,
        path: '/ip',
        method: 'GET',
        headers: { Host: 'anthropic.com' },
        timeout: 10000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve(body.trim() || null))
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

/** Fetch exit IP through proxy: just shell out to curl, most reliable way */
function fetchExitIpViaProxy(): Promise<string | null> {
  const { execFile } = require('child_process') as typeof import('child_process')
  return new Promise((resolve) => {
    execFile('curl', ['-4', '-s', '--max-time', '10', '-x', 'http://127.0.0.1:12345', 'https://icanhazip.com'],
      (err, stdout) => {
        if (err) { resolve(null); return }
        resolve(stdout.trim() || null)
      }
    )
  })
}

/** Get exit IP: always try proxy first, fallback to direct */
async function fetchExitIp(): Promise<string | null> {
  const proxyIp = await fetchExitIpViaProxy()
  if (proxyIp) return proxyIp
  return fetchExitIpDirect()
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

// Local IP: curl icanhazip directly, no proxy
ipcMain.handle('check-local-ip', async () => {
  const { execFile } = require('child_process') as typeof import('child_process')
  return new Promise<{ ok: boolean; ip: string | null }>((resolve) => {
    execFile('curl', ['-4', '-s', '--max-time', '5', 'https://icanhazip.com'], (err, stdout) => {
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
    // If down: show notification + bring window to front
    if (!ok) {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      const { Notification } = await import('electron')
      if (Notification.isSupported()) {
        new Notification({
          title: 'OriginAI',
          body: 'Network connection lost. Please check your proxy.',
          icon
        }).show()
      }
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

// Detect system HTTP proxy
ipcMain.handle('detect-system-proxy', async () => {
  const { execSync } = await import('child_process')
  try {
    if (process.platform === 'darwin') {
      const out = execSync('scutil --proxy', { encoding: 'utf-8' })
      const httpEnabled = /HTTPEnable\s*:\s*1/.test(out)
      if (!httpEnabled) return { found: false }
      const hostMatch = out.match(/HTTPProxy\s*:\s*(.+)/)
      const portMatch = out.match(/HTTPPort\s*:\s*(\d+)/)
      if (hostMatch && portMatch) {
        return { found: true, host: hostMatch[1].trim(), port: portMatch[1].trim() }
      }
    } else if (process.platform === 'win32') {
      const out = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
        { encoding: 'utf-8' }
      )
      const match = out.match(/ProxyServer\s+REG_SZ\s+(.+)/)
      if (match) {
        const val = match[1].trim()
        const [host, port] = val.includes(':') ? val.split(':') : [val, '80']
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

ipcMain.handle('auth:send-otp', async (_e, email: string, type: string) => {
  return authFetch('POST', '/api/auth/email-otp/send-verification-otp', { email, type })
})

ipcMain.handle('auth:verify-email', async (_e, email: string, otp: string) => {
  return authFetch('POST', '/api/auth/email-otp/verify-email', { email, otp })
})

ipcMain.handle('auth:get-session', async () => {
  return authFetch('GET', '/api/auth/get-session')
})

ipcMain.handle('auth:reset-password', async (_e, email: string, otp: string, newPassword: string) => {
  return authFetch('POST', '/api/auth/email-otp/reset-password', { email, otp, newPassword })
})

ipcMain.handle('auth:profile', async () => {
  return authFetch('GET', '/api/auth/profile')
})

ipcMain.handle('auth:sign-out', async () => {
  const result = await authFetch('POST', '/api/auth/sign-out')
  sessionCookies = []
  sessionUser = undefined
  clearSession()
  return result
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

// Sidecar IPC handlers
ipcMain.handle('sidecar:start', async (_e, preProxy?: string) => {
  const result = await startSidecar(preProxy)
  if (result.ok) {
    const pac = generatePacScript()
    for (const win of BrowserWindow.getAllWindows()) {
      await win.webContents.session.setProxy({
        pacScript: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(pac)}`
      })
    }
    // Set system proxy so browsers also use the PAC
    await setSystemProxy().catch(() => { /* non-fatal */ })
    // Set shell env so terminal tools (claude CLI etc.) also use the proxy
    setShellProxy()
  }
  return result
})

ipcMain.handle('sidecar:stop', async () => {
  await stopSidecar()

  for (const win of BrowserWindow.getAllWindows()) {
    await win.webContents.session.setProxy({ mode: 'direct' })
  }
  // Clear system proxy + shell env
  await clearSystemProxy().catch(() => { /* non-fatal */ })
  return { ok: true }
})

ipcMain.handle('sidecar:status', () => {
  return { running: isSidecarRunning() }
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

app.whenReady().then(() => {
  // Clean up any sing-box left by a previous crash
  killOrphanedSidecar()

  electronApp.setAppUserModelId('com.originai.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Set dock icon on macOS
  if (process.platform === 'darwin') {
    app.dock.setIcon(nativeImage.createFromPath(icon))
  }

  createWindow()

  // Monitor sidecar crashes — immediately notify renderer
  onSidecarCrash((reason) => {
  
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('network-health', { ok: false, ip: null })
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
    const { Notification: ElectronNotification } = require('electron')
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title: 'OriginAI',
        body: `Proxy service crashed: ${reason}`,
        icon
      }).show()
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
  await clearSystemProxy().catch(() => {})
  await stopSidecar()
})
