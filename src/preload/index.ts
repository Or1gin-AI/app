import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  appVersion: process.env.npm_package_version || require('../../package.json').version as string,
  checkIp: () => ipcRenderer.invoke('check-ip'),
  checkIpQuick: () => ipcRenderer.invoke('check-ip-quick'),
  checkLocalIp: () => ipcRenderer.invoke('check-local-ip'),
  checkProxyIp: () => ipcRenderer.invoke('check-proxy-ip'),
  detectSystemProxy: () => ipcRenderer.invoke('detect-system-proxy'),
  auth: {
    signUp: (username: string, email: string, password: string, turnstileToken?: string) =>
      ipcRenderer.invoke('auth:sign-up', username, email, password, turnstileToken),
    checkUsername: (username: string) =>
      ipcRenderer.invoke('auth:check-username', username),
    signIn: (email: string, password: string, turnstileToken?: string) =>
      ipcRenderer.invoke('auth:sign-in', email, password, turnstileToken),
    sendOtp: (email: string, type: string, turnstileToken?: string) =>
      ipcRenderer.invoke('auth:send-otp', email, type, turnstileToken),
    verifyEmail: (email: string, otp: string, turnstileToken?: string) =>
      ipcRenderer.invoke('auth:verify-email', email, otp, turnstileToken),
    getSession: () => ipcRenderer.invoke('auth:get-session'),
    getNewuser: () => ipcRenderer.invoke('auth:get-newuser'),
    setNewuser: (value: number) => ipcRenderer.invoke('auth:set-newuser', value),
    resetPassword: (email: string, otp: string, newPassword: string) =>
      ipcRenderer.invoke('auth:reset-password', email, otp, newPassword),
    profile: () => ipcRenderer.invoke('auth:profile'),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
    restoreSession: () => ipcRenderer.invoke('auth:restore-session')
  },
  proxyAuth: {
    login: () => ipcRenderer.invoke('proxy-auth:login'),
  },
  sms: {
    requestNumber: () => ipcRenderer.invoke('sms:request-number'),
    phoneNumber: () => ipcRenderer.invoke('sms:phone-number'),
    status: () => ipcRenderer.invoke('sms:status'),
    refreshNumber: () => ipcRenderer.invoke('sms:refresh-number'),
    refund: () => ipcRenderer.invoke('sms:refund'),
  },
  payment: {
    checkout: (productType: string, provider?: string, claudeAccountId?: string) =>
      ipcRenderer.invoke('payment:checkout', productType, provider, claudeAccountId),
    openCheckout: (url: string) => ipcRenderer.invoke('payment:open-checkout', url),
    onCheckoutClosed: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('payment:checkout-closed', handler)
      return () => ipcRenderer.removeListener('payment:checkout-closed', handler)
    },
    orders: (page?: number, limit?: number) =>
      ipcRenderer.invoke('payment:orders', page, limit),
  },
  claudeAccount: {
    create: () => ipcRenderer.invoke('claude-account:create'),
    list: () => ipcRenderer.invoke('claude-account:list'),
    listenEmail: (email?: string) => ipcRenderer.invoke('claude-account:listen-email', email),
  },
  ticket: {
    list: (userId: string, userName: string, params: string) =>
      ipcRenderer.invoke('ticket:list', userId, userName, params),
    detail: (userId: string, userName: string, ticketId: string) =>
      ipcRenderer.invoke('ticket:detail', userId, userName, ticketId),
    create: (userId: string, userName: string, body: Record<string, unknown>) =>
      ipcRenderer.invoke('ticket:create', userId, userName, body),
    timeline: (userId: string, userName: string, ticketId: string) =>
      ipcRenderer.invoke('ticket:timeline', userId, userName, ticketId),
    comment: (userId: string, userName: string, ticketId: string, content: string) =>
      ipcRenderer.invoke('ticket:comment', userId, userName, ticketId, content),
  },
  sidecar: {
    start: (preProxy?: string) => ipcRenderer.invoke('sidecar:start', preProxy),
    stop: () => ipcRenderer.invoke('sidecar:stop'),
    status: () => ipcRenderer.invoke('sidecar:status'),
    verify: () => ipcRenderer.invoke('sidecar:verify'),
    proxyStatus: () => ipcRenderer.invoke('sidecar:proxy-status'),
    probePreProxy: (host: string, port: number) => ipcRenderer.invoke('sidecar:probe-pre-proxy', host, port)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: {
      rememberPassword: boolean
      autoLogin: boolean
      autoLaunch: boolean
      savedEmail: string
      savedPassword: string
    }) => ipcRenderer.invoke('settings:set', settings),
  },
  session: {
    startCheck: () => ipcRenderer.invoke('session:start-check'),
    stopCheck: () => ipcRenderer.invoke('session:stop-check'),
    onExpired: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('session:expired', handler)
      return () => ipcRenderer.removeListener('session:expired', handler)
    },
  },
  health: {
    start: () => ipcRenderer.invoke('health:start'),
    stop: () => ipcRenderer.invoke('health:stop'),
    onStatus: (cb: (data: { ok: boolean; ip: string | null }) => void) => {
      const handler = (_: unknown, data: { ok: boolean; ip: string | null }) => cb(data)
      ipcRenderer.on('network-health', handler)
      return () => ipcRenderer.removeListener('network-health', handler)
    }
  },
  proxy: {
    onConflict: (cb: (data: { hijacked: boolean }) => void) => {
      const handler = (_: unknown, data: { hijacked: boolean }) => cb(data)
      ipcRenderer.on('proxy:conflict', handler)
      return () => ipcRenderer.removeListener('proxy:conflict', handler)
    },
  },
  updater: {
    install: () => ipcRenderer.invoke('updater:install'),
    check: () => ipcRenderer.invoke('updater:check'),
    onStatus: (cb: (data: { status: string; version?: string; percent?: number; message?: string }) => void) => {
      const handler = (_: unknown, data: { status: string; version?: string; percent?: number; message?: string }) => cb(data)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  }
})
