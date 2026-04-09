import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from '@/i18n/context'

interface MainPageProps {
  userName: string
}

// idle       → show "接收邮件"
// checking   → loading spinner, fetching emails
// no-email   → no valid email, 60s cooldown then back to idle
// has-email  → email found (<5min), show "请求登录" + age + refresh
// requesting → extracting magic link
// success    → link opened
type EmailPhase = 'idle' | 'checking' | 'no-email' | 'has-email' | 'requesting' | 'success'

type EmailItem = { from: string; subject: string; body: string; date: string }

/** Relative time label + color for the email age badge */
function getEmailAge(
  emailDate: string,
  t: { emailJustNow: string; emailAgo: string }
): { label: string; color: string } {
  const diffMin = (Date.now() - new Date(emailDate).getTime()) / 60_000

  if (diffMin < 1) return { label: t.emailJustNow, color: 'text-green-500' }
  if (diffMin < 2) return { label: t.emailAgo.replace('{n}', '1'), color: 'text-green-500' }
  if (diffMin < 3) return { label: t.emailAgo.replace('{n}', '2'), color: 'text-green-600' }
  if (diffMin < 5) return { label: t.emailAgo.replace('{n}', '3'), color: 'text-lime-600' }
  return { label: t.emailAgo.replace('{n}', String(Math.floor(diffMin))), color: 'text-yellow-500' }
}

export function MainPage({ userName }: MainPageProps) {
  const { t } = useLocale()
  const [phase, setPhase] = useState<EmailPhase>('idle')
  const [cooldown, setCooldown] = useState(0)
  const [latestEmail, setLatestEmail] = useState<EmailItem | null>(null)
  const [copied, setCopied] = useState(false)
  const [, setTick] = useState(0)
  const busyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const ageTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (ageTickRef.current) clearInterval(ageTickRef.current)
    }
  }, [])

  // Countdown ticker
  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      return
    }
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // When cooldown expires → no-email goes back to idle; has-email auto re-fetches
  useEffect(() => {
    if (cooldown > 0) return
    if (phase === 'no-email') {
      setPhase('idle')
    } else if (phase === 'has-email') {
      fetchEmails()
    }
  }, [cooldown, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tick every 15s to update relative time when has-email
  useEffect(() => {
    if (!(phase === 'has-email' && latestEmail)) return
    ageTickRef.current = setInterval(() => {
      // If email is now older than 5 min, expire it
      const diffMin = (Date.now() - new Date(latestEmail.date).getTime()) / 60_000
      if (diffMin >= 5) {
        setLatestEmail(null)
        setPhase('idle')
      }
      setTick((n) => n + 1)
    }, 15_000)
    return () => { if (ageTickRef.current) { clearInterval(ageTickRef.current); ageTickRef.current = null } }
  }, [phase, latestEmail])

  /** Fetch emails from backend */
  const fetchEmails = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setPhase('checking')

    try {
      let res = await window.electronAPI.claudeAccount.listenEmail()

      // Auto-create account if needed
      if (res.status === 400) {
        const errData = res.data as { message?: string } | undefined
        const msg = typeof errData === 'object' && errData?.message ? errData.message : ''
        if (msg.toLowerCase().includes('no') && msg.toLowerCase().includes('account')) {
          await window.electronAPI.claudeAccount.create()
          res = await window.electronAPI.claudeAccount.listenEmail()
        }
      }

      if (res.status < 200 || res.status >= 300) {
        setPhase('no-email')
        setCooldown(60)
        return
      }

      const emails = res.data as EmailItem[]
      if (!emails || emails.length === 0) {
        setPhase('no-email')
        setCooldown(60)
        return
      }

      const latest = emails[0]
      const diffMin = (Date.now() - new Date(latest.date).getTime()) / 60_000

      if (diffMin >= 5) {
        // Too old, treat as no email
        setPhase('no-email')
        setCooldown(60)
        return
      }

      setLatestEmail(latest)
      setPhase('has-email')
    } catch {
      setPhase('no-email')
      setCooldown(60)
    } finally {
      busyRef.current = false
    }
  }, [])

  /** Refresh: stay in has-email but start cooldown, then auto re-fetch */
  const handleRefresh = useCallback(() => {
    setCooldown(60)
  }, [])

  /** Request login: extract magic link from the stored email */
  const handleRequestLogin = useCallback(async () => {
    if (!latestEmail) return
    setPhase('requesting')

    const urls = latestEmail.body.match(/https?:\/\/[^\s<>"')\]]+/g) || []
    const magicLink = urls.find((u) => u.includes('magic-link')) || urls[0]

    if (!magicLink) {
      setPhase('has-email')
      return
    }

    window.open(magicLink, '_blank')
    setPhase('success')
  }, [latestEmail])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const claudeEmail = t.main.claudeWeb.step2email.replace('{name}', userName || '···')

  const handleCopyEmail = useCallback(() => {
    navigator.clipboard.writeText(claudeEmail)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [claudeEmail])

  const webSteps = [
    <>{t.main.claudeWeb.step1}</>,
    <>
      {t.main.claudeWeb.step2pre}{' '}
      <span className="inline-flex items-center gap-1">
        <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">
          {claudeEmail}
        </code>
        <button
          onClick={handleCopyEmail}
          className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-bg-alt transition-colors cursor-pointer"
          title="Copy"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </span>
      {t.main.claudeWeb.step2post && <>{' '}{t.main.claudeWeb.step2post}</>}
    </>,
    <>{t.main.claudeWeb.step3}</>,
  ]

  // ── Render the action area based on phase ──

  const renderActionArea = () => {
    switch (phase) {
      case 'idle':
        return (
          <button
            onClick={fetchEmails}
            className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.main.claudeWeb.fetchEmail}
          </button>
        )

      case 'checking':
        return (
          <button
            disabled
            className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand/40 text-white/60 cursor-not-allowed"
          >
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t.main.claudeWeb.fetchingEmail}
            </span>
          </button>
        )

      case 'no-email':
        return (
          <>
            <button
              disabled
              className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand/40 text-white/60 cursor-not-allowed"
            >
              {t.main.claudeWeb.fetchEmail}
            </button>
            <p className="text-xs text-amber-600 mt-2">{t.main.claudeWeb.noEmail}</p>
            {cooldown > 0 && (
              <p className="text-xs text-text-faint mt-1">
                {t.main.claudeWeb.retryAfter.replace('{time}', formatTime(cooldown))}
              </p>
            )}
          </>
        )

      case 'has-email': {
        const age = latestEmail ? getEmailAge(latestEmail.date, t.main.claudeWeb) : null
        const refreshing = cooldown > 0
        return (
          <>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleRequestLogin}
                className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
              >
                {t.main.claudeWeb.requestLogin}
              </button>
              {/* Refresh button */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className={`w-9 h-9 rounded-lg border border-border-strong flex items-center justify-center transition-colors ${
                  refreshing ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-bg-alt'
                }`}
                title="Refresh"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
            {age && (
              <p className={`text-xs mt-2 ${age.color}`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70 mr-1 align-middle" />
                {t.main.claudeWeb.emailReceived} · {age.label}
              </p>
            )}
            {refreshing && (
              <p className="text-xs text-text-faint mt-1">
                {t.main.claudeWeb.refreshWait.replace('{time}', formatTime(cooldown))}
              </p>
            )}
          </>
        )
      }

      case 'requesting':
        return (
          <button
            disabled
            className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand/40 text-white/60 cursor-not-allowed"
          >
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t.main.claudeWeb.requesting}
            </span>
          </button>
        )

      case 'success':
        return (
          <>
            <button
              onClick={() => { setPhase('idle'); setLatestEmail(null) }}
              className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.main.claudeWeb.fetchEmail}
            </button>
            <p className="text-xs text-green-600 mt-2">{t.main.claudeWeb.success}</p>
          </>
        )
    }
  }

  return (
    <div className="flex flex-1 min-h-0 items-center">
      {/* Left: Claude Web / Desktop */}
      <div className="flex-1 flex flex-col items-center justify-center p-10 border-r border-border">
        <div className="max-w-[280px] w-full">
          <div className="text-center">
            <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-3">
              {t.main.claudeWeb.label}
            </div>
            <h2 className="font-serif text-lg text-text mb-2">{t.main.claudeWeb.title}</h2>
            <p className="text-[13px] text-text-muted mb-6 leading-relaxed">
              {t.main.claudeWeb.desc}
              <br />
              {t.main.claudeWeb.descLine2}
            </p>
          </div>

          <div className="text-[13px] text-text-secondary leading-relaxed mb-7">
            {webSteps.map((content, i) => (
              <div key={i} className="flex gap-2.5 mb-3.5 items-start">
                <div className="min-w-[22px] h-[22px] rounded-full bg-bg-alt text-brand flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                  {i + 1}
                </div>
                <div>{content}</div>
              </div>
            ))}
          </div>

          <div className="text-center">
            {renderActionArea()}
          </div>
        </div>
      </div>

      {/* Right: Claude Code */}
      <div className="flex-1 flex flex-col items-center justify-center p-10">
        <div className="max-w-[280px] w-full">
          <div className="text-center">
            <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-3">
              {t.main.claudeCode.label}
            </div>
            <h2 className="font-serif text-lg text-text mb-2">{t.main.claudeCode.title}</h2>
            <p className="text-[13px] text-text-muted mb-6 leading-relaxed">
              {t.main.claudeCode.desc}
              <br />
              {t.main.claudeCode.descLine2}
            </p>
          </div>

          <div className="text-[13px] text-text-secondary leading-relaxed">
            {[
              <>{t.main.claudeCode.step1} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">claude login</code></>,
              <>{t.main.claudeCode.step2} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">{t.main.claudeCode.step2method}</code> {t.main.claudeCode.step2suffix}</>,
              <>{t.main.claudeCode.step3}</>,
              <>{t.main.claudeCode.step4}</>,
            ].map((content, i) => (
              <div key={i} className="flex gap-2.5 mb-3.5 items-start">
                <div className="min-w-[22px] h-[22px] rounded-full bg-bg-alt text-brand flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                  {i + 1}
                </div>
                <div>{content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
