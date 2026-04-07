import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import logoImg from '@/assets/icon-transparent.png'

type AuthView = 'login' | 'register' | 'otp'

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

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-1 text-[11px] transition-colors ${ok ? 'text-green-500' : 'text-text-faint'}`}
    >
      <span className="text-[10px]">{ok ? '\u2713' : '\u2022'}</span>
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

  // Track which fields are focused (show hints) vs blurred-dirty (show red border only)
  const [focused, setFocused] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const focus = (field: string) => setFocused((p) => ({ ...p, [field]: true }))
  const blur = (field: string) => {
    setFocused((p) => ({ ...p, [field]: false }))
    setDirty((p) => ({ ...p, [field]: true }))
  }

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const pwdChecks = usePasswordChecks(password)
  const allPwdOk = pwdChecks.length && pwdChecks.upper && pwdChecks.lower && pwdChecks.number && pwdChecks.special

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

  const handleSignIn = async () => {
    clearMessages()
    if (!email || !password) {
      setError(t.login.errorFieldsRequired)
      return
    }
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.signIn(email, password)
      if (res.status === 200) {
        const data = res.data as { user?: { email: string; name: string } }
        onLogin({ email: data.user?.email ?? email, name: data.user?.name ?? '' })
      } else if (res.status === 403) {
        setError(t.login.errorEmailNotVerified)
        setView('otp')
        await window.electronAPI.auth.sendOtp(email, 'email-verification')
      } else {
        setError(t.login.errorSignInFailed)
      }
    } catch {
      setError(t.login.errorSignInFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async () => {
    clearMessages()
    if (!registerReady) return
    setLoading(true)
    try {
      const res = await window.electronAPI.auth.signUp(name, email, password)
      if (res.status === 200) {
        await window.electronAPI.auth.sendOtp(email, 'email-verification')
        setMessage(t.login.registerSuccess)
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
      const res = await window.electronAPI.auth.verifyEmail(email, code)
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
      await window.electronAPI.auth.sendOtp(email, 'email-verification')
      setMessage(t.login.otpResent)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  const switchToRegister = () => {
    clearMessages()
    setFocused({})
    setDirty({})
    setView('register')
  }

  const switchToLogin = () => {
    clearMessages()
    setFocused({})
    setDirty({})
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

              <div className="mb-6">
                <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.login.password}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputCls()}
                  onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
                />
              </div>

              <button
                onClick={handleSignIn}
                disabled={loading}
                className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50"
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
                  <span className="text-text-secondary">{name || '···'}</span>
                  @teams.originai.cc
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
                      <Check ok={false} label={t.login.validNameTaken} />
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

              <button
                onClick={handleSignUp}
                disabled={loading || !registerReady}
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

              <div className="mb-6">
                <OtpInput value={otp} onChange={setOtp} onComplete={handleVerifyOtp} />
              </div>

              <button
                onClick={handleVerifyOtp}
                disabled={loading || otp.replace(/[^0-9]/g, '').length !== 6}
                className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : t.login.otpSubmit}
              </button>

              <div className="flex justify-between items-center text-[13px]">
                <button
                  onClick={switchToLogin}
                  className="text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none text-[13px]"
                >
                  {t.login.backToLogin}
                </button>
                <button
                  onClick={handleResendOtp}
                  disabled={loading}
                  className="text-brand underline cursor-pointer bg-transparent border-none text-[13px] disabled:opacity-50"
                >
                  {t.login.otpResend}
                </button>
              </div>
            </>
          )}
          </div>
        </div>

        {/* Language Switcher — fixed outside scroll area */}
        <div className="flex justify-end px-5 py-3 shrink-0">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
