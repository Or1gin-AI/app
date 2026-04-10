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
      checkLocalIp: () => Promise<{ ok: boolean; ip: string | null }>
      checkProxyIp: () => Promise<{ ok: boolean; ip: string | null }>
      detectSystemProxy: () => Promise<{ found: boolean; host?: string; port?: string }>
      auth: {
        signUp: (username: string, email: string, password: string, turnstileToken?: string) => Promise<AuthResponse>
        checkUsername: (username: string) => Promise<AuthResponse>
        signIn: (email: string, password: string, turnstileToken?: string) => Promise<AuthResponse>
        sendOtp: (email: string, type: string, turnstileToken?: string) => Promise<AuthResponse>
        verifyEmail: (email: string, otp: string, turnstileToken?: string) => Promise<AuthResponse>
        getSession: () => Promise<AuthResponse>
        getNewuser: () => Promise<AuthResponse>
        setNewuser: (value: number) => Promise<AuthResponse>
        resetPassword: (email: string, otp: string, newPassword: string) => Promise<AuthResponse>
        profile: () => Promise<AuthResponse>
        signOut: () => Promise<AuthResponse>
        restoreSession: () => Promise<{ ok: boolean; user?: { email: string; name: string } }>
      }
      settings: {
        get: () => Promise<{
          rememberPassword: boolean
          autoLogin: boolean
          autoLaunch: boolean
          savedEmail: string
          savedPassword: string
        }>
        set: (settings: {
          rememberPassword: boolean
          autoLogin: boolean
          autoLaunch: boolean
          savedEmail: string
          savedPassword: string
        }) => Promise<{ ok: boolean }>
      }
      proxyAuth: {
        login: () => Promise<AuthResponse>
      }
      sms: {
        requestNumber: () => Promise<AuthResponse>
        phoneNumber: () => Promise<AuthResponse>
        status: () => Promise<AuthResponse>
        refreshNumber: () => Promise<AuthResponse>
        refund: () => Promise<AuthResponse>
      }
      payment: {
        checkout: (productType: string, provider?: string, claudeAccountId?: string) => Promise<AuthResponse>
        openCheckout: (url: string) => Promise<{ ok: boolean }>
        onCheckoutClosed: (cb: () => void) => () => void
        orders: (page?: number, limit?: number) => Promise<AuthResponse>
      }
      claudeAccount: {
        create: () => Promise<AuthResponse>
        list: () => Promise<AuthResponse>
        listenEmail: (email?: string) => Promise<AuthResponse>
      }
      ticket: {
        list: (userId: string, userName: string, params: string) => Promise<AuthResponse>
        detail: (userId: string, userName: string, ticketId: string) => Promise<AuthResponse>
        create: (userId: string, userName: string, body: Record<string, unknown>) => Promise<AuthResponse>
        timeline: (userId: string, userName: string, ticketId: string) => Promise<AuthResponse>
        comment: (userId: string, userName: string, ticketId: string, content: string) => Promise<AuthResponse>
      }
      sidecar: {
        start: (preProxy?: string) => Promise<{ ok: boolean; error?: string }>
        stop: () => Promise<{ ok: boolean }>
        status: () => Promise<{ running: boolean }>
        verify: () => Promise<{ ok: boolean; ip?: string; error?: string }>
        proxyStatus: () => Promise<{ running: boolean; port: number }>
        probePreProxy: (host: string, port: number) => Promise<{ ok: boolean; latency?: number; error?: string }>
      }
      session: {
        startCheck: () => Promise<{ ok: boolean }>
        stopCheck: () => Promise<{ ok: boolean }>
        onExpired: (cb: () => void) => () => void
      }
      health: {
        start: () => Promise<{ ok: boolean }>
        stop: () => Promise<{ ok: boolean }>
        onStatus: (cb: (data: { ok: boolean; ip: string | null }) => void) => () => void
      }
      proxy: {
        hadStaleCleanup: () => Promise<boolean>
        onConflict: (cb: (data: { hijacked: boolean }) => void) => () => void
      }
      updater: {
        install: () => Promise<void>
        check: () => Promise<void>
        onStatus: (cb: (data: {
          status: string
          version?: string
          percent?: number
          message?: string
        }) => void) => () => void
      }
    }
  }
}

export {}
