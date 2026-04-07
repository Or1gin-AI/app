import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  checkIp: () => ipcRenderer.invoke('check-ip'),
  checkIpQuick: () => ipcRenderer.invoke('check-ip-quick'),
  checkLocalIp: () => ipcRenderer.invoke('check-local-ip'),
  checkProxyIp: () => ipcRenderer.invoke('check-proxy-ip'),
  detectSystemProxy: () => ipcRenderer.invoke('detect-system-proxy'),
  auth: {
    signUp: (username: string, email: string, password: string) =>
      ipcRenderer.invoke('auth:sign-up', username, email, password),
    checkUsername: (username: string) =>
      ipcRenderer.invoke('auth:check-username', username),
    signIn: (email: string, password: string) =>
      ipcRenderer.invoke('auth:sign-in', email, password),
    sendOtp: (email: string, type: string) =>
      ipcRenderer.invoke('auth:send-otp', email, type),
    verifyEmail: (email: string, otp: string) =>
      ipcRenderer.invoke('auth:verify-email', email, otp),
    getSession: () => ipcRenderer.invoke('auth:get-session'),
    signOut: () => ipcRenderer.invoke('auth:sign-out'),
    restoreSession: () => ipcRenderer.invoke('auth:restore-session')
  },
  sidecar: {
    start: (preProxy?: string) => ipcRenderer.invoke('sidecar:start', preProxy),
    stop: () => ipcRenderer.invoke('sidecar:stop'),
    status: () => ipcRenderer.invoke('sidecar:status'),
    verify: () => ipcRenderer.invoke('sidecar:verify')
  },
  health: {
    start: () => ipcRenderer.invoke('health:start'),
    stop: () => ipcRenderer.invoke('health:stop'),
    onStatus: (cb: (data: { ok: boolean; ip: string | null }) => void) => {
      const handler = (_: unknown, data: { ok: boolean; ip: string | null }) => cb(data)
      ipcRenderer.on('network-health', handler)
      return () => ipcRenderer.removeListener('network-health', handler)
    }
  }
})
