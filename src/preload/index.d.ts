interface AuthResponse {
  status: number
  data: unknown
}

declare global {
  interface Window {
    electronAPI: {
      platform: string
      checkIp: () => Promise<{
        ip?: string
        country?: string
        countryCode?: string
        region?: string
        city?: string
        isp?: string
        org?: string
        as?: string
        isProxy?: boolean
        isHosting?: boolean
        isMobile?: boolean
        isChina?: boolean
        error?: string
      }>
      checkIpQuick: () => Promise<{ ok: boolean; ip: string | null }>
      detectSystemProxy: () => Promise<{ found: boolean; host?: string; port?: string }>
      auth: {
        signUp: (username: string, email: string, password: string) => Promise<AuthResponse>
        checkUsername: (username: string) => Promise<AuthResponse>
        signIn: (email: string, password: string) => Promise<AuthResponse>
        sendOtp: (email: string, type: string) => Promise<AuthResponse>
        verifyEmail: (email: string, otp: string) => Promise<AuthResponse>
        getSession: () => Promise<AuthResponse>
        signOut: () => Promise<AuthResponse>
        restoreSession: () => Promise<{ ok: boolean; user?: { email: string; name: string } }>
      }
      sidecar: {
        start: (preProxy?: string) => Promise<{ ok: boolean; error?: string }>
        stop: () => Promise<{ ok: boolean }>
        status: () => Promise<{ running: boolean }>
        verify: () => Promise<{ ok: boolean; ip?: string; error?: string }>
      }
      health: {
        start: () => Promise<{ ok: boolean }>
        stop: () => Promise<{ ok: boolean }>
        onStatus: (cb: (data: { ok: boolean; ip: string | null }) => void) => () => void
      }
    }
  }
}

export {}
