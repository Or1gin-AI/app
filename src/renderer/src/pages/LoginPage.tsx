import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import logoImg from '@/assets/icon-transparent.png'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback'?: () => void
        'error-callback'?: () => void
        theme?: 'light' | 'dark' | 'auto'
        size?: 'normal' | 'compact'
      }) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
  }
}

const TURNSTILE_SITE_KEY = '0x4AAAAAAC2Lw36H3wTiNN0w'

type AuthView = 'login' | 'register' | 'otp' | 'reset'

interface LoginPageProps {
  onLogin: (user: { email: string; name: string }) => void
}

/* ── Validation helpers ── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_RE = /^[A-Za-z0-9_]+$/

function usePasswordChecks(password: string) {
  return useMemo(
    () => ({
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    }),
    [password],
  )
}

/* ── Validation indicator ── */

function Check({ ok, label, error }: { ok: boolean; label: string; error?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 text-[11px] transition-colors ${
        ok ? 'text-green-500' : error ? 'text-red-500' : 'text-text-faint'
      }`}
    >
      <span className="text-[10px]">{ok ? '\u2713' : error ? '\u2717' : '\u2022'}</span>
      {label}
    </span>
  )
}

/* ── 6-digit OTP input ── */

function OtpInput({
  value,
  onChange,
  onComplete,
}: {
  value: string
  onChange: (v: string) => void
  onComplete: () => void
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')

  const set = useCallback(
    (i: number, char: string) => {
      const next = [...digits]
      next[i] = char
      const joined = next.join('')
      onChange(joined.replace(/[^0-9]/g, ''))
    },
    [digits, onChange],
  )

  const handleKey = useCallback(
    (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        e.preventDefault()
        if (digits[i]) {
          set(i, '')
        } else if (i > 0) {
          set(i - 1, '')
          refs.current[i - 1]?.focus()
        }
      } else if (e.key === 'ArrowLeft' && i > 0) {
        refs.current[i - 1]?.focus()
      } else if (e.key === 'ArrowRight' && i < 5) {
        refs.current[i + 1]?.focus()
      } else if (e.key === 'Enter') {
        if (value.replace(/[^0-9]/g, '').length === 6) onComplete()
      }
    },
    [digits, set, value, onComplete],
  )

  const handleInput = useCallback(
    (i: number, e: React.FormEvent<HTMLInputElement>) => {
      const raw = (e.nativeEvent as InputEvent).data
      if (!raw) return
      // Handle paste of full code
      const pasted = raw.replace(/[^0-9]/g, '')
      if (pasted.length > 1) {
        const full = pasted.slice(0, 6)
        onChange(full)
        refs.current[Math.min(full.length, 5)]?.focus()
        if (full.length === 6) onComplete()
        return
      }
      if (pasted.length === 1) {
        set(i, pasted)
        if (i < 5) refs.current[i + 1]?.focus()
        // Check completion after state update
        const nextVal = [...digits]
        nextVal[i] = pasted
        if (nextVal.join('').replace(/[^0-9]/g, '').length === 6) {
          setTimeout(onComplete, 0)
        }
      }
    },
    [digits, set, onChange, onComplete],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6)
      if (pasted) {
        onChange(pasted)
        refs.current[Math.min(pasted.length, 5)]?.focus()
        if (pasted.length === 6) setTimeout(onComplete, 0)
      }
    },
    [onChange, onComplete],
  )

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onKeyDown={(e) => handleKey(i, e)}
          onInput={(e) => handleInput(i, e)}
          onFocus={(e) => e.target.select()}
          className="w-10 h-12 text-center text-lg font-mono border border-border-strong rounded-lg bg-bg-card text-text outline-none focus:border-brand transition-colors"
        />
      ))}
    </div>
  )
}

/* ── Turnstile widget ── */

function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    const mount = () => {
      if (!containerRef.current || !window.turnstile || widgetIdRef.current) return
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
          theme: 'light',
        })
      } catch {
        // Turnstile may fail in file:// protocol (production builds)
        // Allow login without captcha in this case
        console.warn('[Turnstile] render failed, skipping captcha')
        onToken('skip')
      }
    }

    // turnstile script might not be loaded yet
    if (window.turnstile) {
      mount()
    } else {
      // If script doesn't load within 5s (e.g. file:// or offline), skip
      let elapsed = 0
      const interval = setInterval(() => {
        elapsed += 200
        if (window.turnstile) { clearInterval(interval); mount() }
        else if (elapsed >= 5000) { clearInterval(interval); onToken('skip') }
      }, 200)
      return () => clearInterval(interval)
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* */ }
        widgetIdRef.current = null
      }
    }
  }, [onToken])

  return <div ref={containerRef} className="flex justify-center mb-4" />
}

/* ── Main component ── */

export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useLocale()
  const [view, setView] = useState<AuthView>('login')

  // Form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  // Track which fields are focused (show hints) vs blurred-dirty (show red border only)
  const [focused, setFocused] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const focus = (field: string) => setFocused((p) => ({ ...p, [field]: true }))
  const blur = (field: string) => {
    setFocused((p) => ({ ...p, [field]: false }))
    setDirty((p) => ({ ...p, [field]: true }))
  }

  // Login options
  const [rememberPassword, setRememberPassword] = useState(false)
  const [autoLogin, setAutoLogin] = useState(false)
  const [autoLaunch, setAutoLaunch] = useState(false)
  const pendingAutoLogin = useRef(false)

  // Load saved settings on mount
  useEffect(() => {
    window.electronAPI.settings.get().then((s) => {
      setRememberPassword(s.rememberPassword)
      setAutoLogin(s.autoLogin)
      setAutoLaunch(s.autoLaunch)
      if (s.rememberPassword && s.savedEmail) {
        setEmail(s.savedEmail)
        setPassword(s.savedPassword)
        if (s.autoLogin) pendingAutoLogin.current = true
      }
    })
  }, [])

  // Turnstile
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const handleTurnstileToken = useCallback((token: string | null) => setTurnstileToken(token), [])

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const pwdChecks = usePasswordChecks(password)
  const allPwdOk = pwdChecks.length && pwdChecks.upper && pwdChecks.lower && pwdChecks.number && pwdChecks.special

  const newPwdChecks = usePasswordChecks(newPassword)
  const allNewPwdOk = newPwdChecks.length && newPwdChecks.upper && newPwdChecks.lower && newPwdChecks.number && newPwdChecks.special
  const newConfirmMatch = confirmNewPassword.length > 0 && newPassword === confirmNewPassword
  const resetReady = otp.replace(/[^0-9]/g, '').length === 6 && allNewPwdOk && newConfirmMatch

  // Username availability check (debounced)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const nameFormatOk = name.length >= 2 && name.length <= 20 && NAME_RE.test(name)
    if (!nameFormatOk) {
      setUsernameAvailable(null)
      return
    }
    setCheckingUsername(true)
    if (usernameTimer.current) clearTimeout(usernameTimer.current)
    usernameTimer.current = setTimeout(async () => {
      try {
        const res = await window.electronAPI.auth.checkUsername(name)
        if (res.status === 200) {
          const data = res.data as { available?: boolean } | null
          // If body has explicit `available` field, use it; otherwise 200 = available
          setUsernameAvailable(data && typeof data.available === 'boolean' ? data.available : true)
        } else if (res.status === 409) {
          setUsernameAvailable(false)
        } else {
          // 404 etc — API not deployed yet, assume available based on format
          setUsernameAvailable(null)
        }
      } catch {
        setUsernameAvailable(null)
      }
      setCheckingUsername(false)
    }, 500)
    return () => { if (usernameTimer.current) clearTimeout(usernameTimer.current) }
  }, [name])

  // Derived validations
  const nameFormatValid = name.length >= 2 && name.length <= 20 && NAME_RE.test(name)
  const nameValid = nameFormatValid && usernameAvailable !== false
  const emailValid = EMAIL_RE.test(email)
  const confirmMatch = confirmPassword.length > 0 && password === confirmPassword
  const registerReady = nameValid && emailValid && allPwdOk && confirmMatch

  const clearMessages = () => {
    setError('')
    setMessage('')
  }

  /* ── Handlers ── */

  const persistSettings = useCallback(
    (rp: boolean, al: boolean, launch: boolean, em: string, pw: string) => {
      window.electronAPI.settings.set({
        rememberPassword: rp,
        autoLogin: al,
        autoLaunch: launch,
        savedEmail: rp ? em : '',
        savedPassword: rp ? pw : '',
      })
    },
    [],
  )

  const doSignIn = async (token?: string) => {
    if (!email || !password) {
      setError(t.login.errorFieldsRequired)
      return
    }
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.signIn(email, password, token)
      if (res.status === 200) {
        persistSettings(rememberPassword, autoLogin, autoLaunch, email, password)
        const data = res.data as { user?: { email: string; name: string } }
        onLogin({ email: data.user?.email ?? email, name: data.user?.name ?? '' })
      } else if (res.status === 403) {
        const errData = res.data as { message?: string; code?: string } | undefined
        const msg = typeof errData === 'object' && errData?.message ? errData.message.toLowerCase() : ''
        if (msg.includes('email') && msg.includes('verif')) {
          // Genuinely unverified email — don't auto-send OTP here,
          // Turnstile token is spent. User can resend after new Turnstile loads on OTP page.
          setError(t.login.errorEmailNotVerified)
          setTurnstileToken(null)
          setOtpSent(false)
          setView('otp')
        } else {
          // Turnstile failure or other 403
          setError(typeof errData === 'object' && errData?.message ? errData.message : t.login.errorSignInFailed)
        }
      } else {
        setError(t.login.errorSignInFailed)
      }
    } catch {
      setError(t.login.errorSignInFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleSignIn = async () => {
    clearMessages()
    await doSignIn(turnstileToken || undefined)
  }

  const handleForgetPassword = async () => {
    clearMessages()
    if (!email || !EMAIL_RE.test(email)) {
      setError(t.login.forgetNeedEmail)
      return
    }
    setLoading(true)
    try {
      const otpRes = await window.electronAPI.auth.sendOtp(email, 'forget-password', turnstileToken || undefined)
      if (otpRes.status >= 400) {
        const otpErr = otpRes.data as { message?: string } | undefined
        setError(typeof otpErr === 'object' && otpErr?.message ? otpErr.message : t.login.forgetFailed)
        return
      }
      setMessage(t.login.forgetSent)
      setOtp('')
      setNewPassword('')
      setConfirmNewPassword('')
      setView('reset')
    } catch {
      setError(t.login.forgetFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    clearMessages()
    const code = otp.replace(/[^0-9]/g, '')
    if (code.length !== 6) return
    if (!newPassword || newPassword !== confirmNewPassword) {
      setError(t.login.errorPasswordMismatch)
      return
    }
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.resetPassword(email, code, newPassword)
      if (res.status === 200) {
        setMessage(t.login.resetSuccess)
        setPassword(newPassword)
        setView('login')
      } else {
        setError(t.login.resetFailed)
      }
    } catch {
      setError(t.login.resetFailed)
    } finally {
      setLoading(false)
    }
  }

  // Auto-login: trigger once after settings load populates credentials
  useEffect(() => {
    if (pendingAutoLogin.current && email && password && view === 'login') {
      pendingAutoLogin.current = false
      doSignIn()
    }
  }) // intentionally no deps — fires after state settles from settings load

  const handleSignUp = async () => {
    clearMessages()
    if (!registerReady) return
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.signUp(name, email, password, turnstileToken || undefined)
      if (res.status === 200) {
        // Backend already sends OTP on sign-up, no need to call sendOtp again
        setMessage(t.login.registerSuccess)
        setTurnstileToken(null)
        setOtpSent(true) // backend already sent OTP on sign-up
        setView('otp')
      } else {
        const data = res.data as { message?: string }
        setError(data?.message ?? t.login.errorSignUpFailed)
      }
    } catch {
      setError(t.login.errorSignUpFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    clearMessages()
    const code = otp.replace(/[^0-9]/g, '')
    if (code.length !== 6) return
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.verifyEmail(email, code, turnstileToken || undefined)
      if (res.status === 200) {
        setMessage(t.login.otpSuccess)
        setOtp('')
        setView('login')
      } else {
        setError(t.login.errorOtpFailed)
      }
    } catch {
      setError(t.login.errorOtpFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    clearMessages()
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.sendOtp(email, 'email-verification', turnstileToken || undefined)
      if (res.status >= 400) {
        const errData = res.data as { message?: string } | undefined
        setError(typeof errData === 'object' && errData?.message ? errData.message : t.login.errorOtpFailed)
      } else {
        setMessage(t.login.otpResent)
      }
    } catch {
      setError(t.login.errorOtpFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleSendInitialOtp = async () => {
    clearMessages()
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.sendOtp(email, 'email-verification', turnstileToken || undefined)
      if (res.status >= 400) {
        const errData = res.data as { message?: string } | undefined
        setError(typeof errData === 'object' && errData?.message ? errData.message : t.login.errorOtpFailed)
      } else {
        setMessage(t.login.otpResent)
        setOtpSent(true)
        setTurnstileToken(null) // reset for verify step
      }
    } catch {
      setError(t.login.errorOtpFailed)
    } finally {
      setLoading(false)
    }
  }

  const switchToRegister = () => {
    clearMessages()
    setFocused({})
    setDirty({})
    setTurnstileToken(null)
    setView('register')
  }

  const switchToLogin = () => {
    clearMessages()
    setFocused({})
    setDirty({})
    setTurnstileToken(null)
    setView('login')
  }

  /* ── Input class helper ── */
  const inputCls = (invalid?: boolean) =>
    `w-full px-3.5 py-2.5 border rounded-lg text-sm bg-bg-card text-text outline-none transition-colors ${
      invalid ? 'border-red-300 focus:border-red-400' : 'border-border-strong focus:border-brand'
    }`

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: Branding */}
      <div className="flex-1 flex flex-col items-center justify-center p-10 bg-gradient-to-br from-bg-alt to-bg">
        <img src={logoImg} alt="OriginAI" className="w-[120px] h-[120px] mb-6" />
        <h1 className="font-serif text-[28px] text-brand tracking-wider mb-2">{t.brand.name}</h1>
        <p className="font-serif text-[13px] text-text-muted tracking-wide">{t.brand.taglineCn}</p>
        <p className="font-mono text-[11px] text-text-faint mt-1 tracking-wide">{t.brand.taglineEn}</p>
      </div>

      {/* Right: Auth Form */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Scrollable form area */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center">
          <div className="w-full max-w-[280px] py-10 px-1 my-auto">
            {/* Error / Message */}
            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
                {error}
              </div>
            )}
            {message && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-600 text-xs">
                {message}
              </div>
            )}

          {/* ===== LOGIN ===== */}
          {view === 'login' && (
            <>
              <h2 className="font-serif text-xl text-text mb-1.5">{t.login.welcome}</h2>
              <p className="text-[13px] text-text-muted mb-7">{t.login.subtitle}</p>

              <div className="mb-4">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.email}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className={inputCls()}
                  onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
                />
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-text-secondary font-mono">{t.login.password}</label>
                  <button
                    onClick={handleForgetPassword}
                    className="text-[11px] text-text-faint hover:text-text-muted cursor-pointer bg-transparent border-none transition-colors"
                  >
                    {t.login.forgetPassword}
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls()}
                  onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
                />
              </div>

              {/* Login options */}
              <div className="flex items-center justify-between mb-5 text-[12px] text-text-muted select-none">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberPassword}
                    onChange={(e) => {
                      setRememberPassword(e.target.checked)
                      if (!e.target.checked) setAutoLogin(false)
                    }}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none border border-border-strong rounded bg-bg-card checked:bg-brand checked:border-brand transition-colors relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                  />
                  {t.login.rememberPassword}
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoLogin}
                    onChange={(e) => {
                      setAutoLogin(e.target.checked)
                      if (e.target.checked) setRememberPassword(true)
                    }}
                    className="w-3.5 h-3.5 cursor-pointer appearance-none border border-border-strong rounded bg-bg-card checked:bg-brand checked:border-brand transition-colors relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
                  />
                  {t.login.autoLogin}
                </label>
              </div>

              <Turnstile onToken={handleTurnstileToken} />

              <button
                onClick={handleSignIn}
                disabled={loading || !turnstileToken}
                className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : t.login.submit}
              </button>

              <p className="text-center text-[13px] text-text-muted">
                {t.login.noAccount}
                <button
                  onClick={switchToRegister}
                  className="text-brand underline ml-1 cursor-pointer bg-transparent border-none text-[13px]"
                >
                  {t.login.register}
                </button>
              </p>
            </>
          )}

          {/* ===== REGISTER ===== */}
          {view === 'register' && (
            <>
              <h2 className="font-serif text-xl text-text mb-1.5">{t.login.registerTitle}</h2>
              <p className="text-[13px] text-text-muted mb-6">{t.login.registerSubtitle}</p>

              {/* Name */}
              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.name}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => focus('name')}
                  onBlur={() => blur('name')}
                  placeholder="your_name"
                  className={inputCls(dirty.name && !nameFormatValid && name.length > 0)}
                />
                <p className="text-[11px] text-text-faint mt-1.5 font-mono">
                  {t.login.futureAccount}
                </p>
                {focused.name && name.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <Check ok={name.length >= 2 && name.length <= 20} label={t.login.validNameLength} />
                    <Check ok={NAME_RE.test(name)} label={t.login.validNameChars} />
                    {nameFormatValid && checkingUsername && (
                      <span className="text-[11px] text-text-faint">{t.login.validNameChecking}</span>
                    )}
                    {nameFormatValid && !checkingUsername && usernameAvailable === true && (
                      <Check ok={true} label={t.login.validNameAvailable} />
                    )}
                    {nameFormatValid && !checkingUsername && usernameAvailable === false && (
                      <Check ok={false} error label={t.login.validNameTaken} />
                    )}
                  </div>
                )}
              </div>

              {/* Email */}
              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.email}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => blur('email')}
                  placeholder="user@example.com"
                  className={inputCls(dirty.email && !emailValid && email.length > 0)}
                />
              </div>

              {/* Password */}
              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.password}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => focus('password')}
                  onBlur={() => blur('password')}
                  placeholder="••••••••"
                  className={inputCls(dirty.password && !allPwdOk && password.length > 0)}
                />
                {focused.password && password.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    <Check ok={pwdChecks.length} label={t.login.validPwdLength} />
                    <Check ok={pwdChecks.upper} label={t.login.validPwdUpper} />
                    <Check ok={pwdChecks.lower} label={t.login.validPwdLower} />
                    <Check ok={pwdChecks.number} label={t.login.validPwdNumber} />
                    <Check ok={pwdChecks.special} label={t.login.validPwdSpecial} />
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className="mb-5">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">
                  {t.login.confirmPassword}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => blur('confirm')}
                  placeholder="••••••••"
                  className={inputCls(dirty.confirm && !confirmMatch && confirmPassword.length > 0)}
                  onKeyDown={(e) => e.key === 'Enter' && registerReady && handleSignUp()}
                />
              </div>

              <Turnstile onToken={handleTurnstileToken} />

              <button
                onClick={handleSignUp}
                disabled={loading || !registerReady || !turnstileToken}
                className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : t.login.registerSubmit}
              </button>

              <p className="text-center text-[13px] text-text-muted">
                {t.login.hasAccount}
                <button
                  onClick={switchToLogin}
                  className="text-brand underline ml-1 cursor-pointer bg-transparent border-none text-[13px]"
                >
                  {t.login.backToLogin}
                </button>
              </p>
            </>
          )}

          {/* ===== OTP ===== */}
          {view === 'otp' && (
            <>
              <h2 className="font-serif text-xl text-text mb-1.5">{t.login.otpTitle}</h2>
              <p className="text-[13px] text-text-muted mb-7">
                {t.login.otpSubtitle} <span className="text-brand">{email}</span>
              </p>

              {!otpSent ? (
                <>
                  {/* Phase 1: Turnstile + send button */}
                  <Turnstile onToken={handleTurnstileToken} />

                  <button
                    onClick={handleSendInitialOtp}
                    disabled={loading || !turnstileToken}
                    className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? '...' : t.login.otpSend}
                  </button>
                </>
              ) : (
                <>
                  {/* Phase 2: OTP input + verify */}
                  <div className="mb-6">
                    <OtpInput value={otp} onChange={setOtp} onComplete={handleVerifyOtp} />
                  </div>

                  <Turnstile onToken={handleTurnstileToken} />

                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading || otp.replace(/[^0-9]/g, '').length !== 6 || !turnstileToken}
                    className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? '...' : t.login.otpSubmit}
                  </button>

                  <button
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="text-brand underline cursor-pointer bg-transparent border-none text-[13px] disabled:opacity-50"
                  >
                    {t.login.otpResend}
                  </button>
                </>
              )}

              <div className="mt-4 text-center">
                <button
                  onClick={switchToLogin}
                  className="text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none text-[13px]"
                >
                  {t.login.backToLogin}
                </button>
              </div>
            </>
          )}

          {/* ===== RESET PASSWORD ===== */}
          {view === 'reset' && (
            <>
              <h2 className="font-serif text-xl text-text mb-1.5">{t.login.resetTitle}</h2>
              <p className="text-[13px] text-text-muted mb-7">
                {t.login.resetSubtitle} <span className="text-brand">{email}</span>
              </p>

              <div className="mb-4">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.resetCode}</label>
                <OtpInput value={otp} onChange={setOtp} onComplete={() => {}} />
              </div>

              <div className="mb-3">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.resetNewPassword}</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onFocus={() => focus('newPwd')}
                  onBlur={() => blur('newPwd')}
                  placeholder="••••••••"
                  className={inputCls(dirty.newPwd && !allNewPwdOk && newPassword.length > 0)}
                />
                {focused.newPwd && newPassword.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    <Check ok={newPwdChecks.length} label={t.login.validPwdLength} />
                    <Check ok={newPwdChecks.upper} label={t.login.validPwdUpper} />
                    <Check ok={newPwdChecks.lower} label={t.login.validPwdLower} />
                    <Check ok={newPwdChecks.number} label={t.login.validPwdNumber} />
                    <Check ok={newPwdChecks.special} label={t.login.validPwdSpecial} />
                  </div>
                )}
              </div>

              <div className="mb-5">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.confirmPassword}</label>
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  onBlur={() => blur('newConfirm')}
                  placeholder="••••••••"
                  className={inputCls(dirty.newConfirm && !newConfirmMatch && confirmNewPassword.length > 0)}
                  onKeyDown={(e) => e.key === 'Enter' && resetReady && handleResetPassword()}
                />
                {confirmNewPassword.length > 0 && (
                  <div className="mt-1.5">
                    <Check ok={newConfirmMatch} label={t.login.validPwdMatch} error={!newConfirmMatch && dirty.newConfirm} />
                  </div>
                )}
              </div>

              <Turnstile onToken={handleTurnstileToken} />

              <button
                onClick={handleResetPassword}
                disabled={loading || !resetReady || !turnstileToken}
                className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : t.login.resetSubmit}
              </button>

              <button
                onClick={switchToLogin}
                className="w-full text-center text-[13px] text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none"
              >
                {t.login.backToLogin}
              </button>
            </>
          )}
          </div>
        </div>

        {/* Bottom bar: auto-launch + language switcher */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0">
          <label className="flex items-center gap-1.5 text-[12px] text-text-muted select-none cursor-pointer">
            <input
              type="checkbox"
              checked={autoLaunch}
              onChange={(e) => {
                setAutoLaunch(e.target.checked)
                window.electronAPI.settings.get().then((s) => {
                  window.electronAPI.settings.set({ ...s, autoLaunch: e.target.checked })
                })
              }}
              className="w-3.5 h-3.5 cursor-pointer appearance-none border border-border-strong rounded bg-bg-card checked:bg-brand checked:border-brand transition-colors relative checked:after:content-['✓'] checked:after:text-white checked:after:text-[10px] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center"
            />
            {t.login.autoLaunch}
          </label>
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
