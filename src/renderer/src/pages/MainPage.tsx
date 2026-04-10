import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from '@/i18n/context'

interface MainPageProps {
  userName: string
}

// idle       → show "获取登录链接"
// checking   → polling every 10s, "暂未收到登录链接"
// has-email  → email found, show link + copy + open
// requesting → opening link
// success    → link opened
type EmailPhase = 'idle' | 'checking' | 'has-email' | 'requesting' | 'success'

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

/** Extract magic link from email body */
function extractMagicLink(body: string): string | null {
  const urls = body.match(/https?:\/\/[^\s<>"')\]]+/g) || []
  return urls.find((u) => u.includes('magic-link')) || urls[0] || null
}

/** Truncate URL for display */
function truncateUrl(url: string, maxLen = 40): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen) + '...'
}

export function MainPage({ userName }: MainPageProps) {
  const { t } = useLocale()
  const [phase, setPhase] = useState<EmailPhase>('idle')
  const [latestEmail, setLatestEmail] = useState<EmailItem | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [pollFailed, setPollFailed] = useState(false)
  const [, setTick] = useState(0)
  const busyRef = useRef(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ageTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
      if (ageTickRef.current) clearInterval(ageTickRef.current)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
  }, [])

  // Tick every 15s to update relative time when has-email
  useEffect(() => {
    if (!(phase === 'has-email' && latestEmail)) return
    ageTickRef.current = setInterval(() => {
      const diffMin = (Date.now() - new Date(latestEmail.date).getTime()) / 60_000
      if (diffMin >= 5) {
        setLatestEmail(null)
        setMagicLink(null)
        setPhase('idle')
      }
      setTick((n) => n + 1)
    }, 15_000)
    return () => { if (ageTickRef.current) { clearInterval(ageTickRef.current); ageTickRef.current = null } }
  }, [phase, latestEmail])

  /** Single fetch attempt — returns true if email found */
  const tryFetchEmail = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false
    busyRef.current = true

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

      if (res.status < 200 || res.status >= 300) return false

      // Handle both array and { emails: [...] } wrapper formats
      let emails: EmailItem[]
      if (Array.isArray(res.data)) {
        emails = res.data as EmailItem[]
      } else if (res.data && typeof res.data === 'object' && 'emails' in (res.data as Record<string, unknown>)) {
        emails = (res.data as { emails: EmailItem[] }).emails || []
      } else {
        emails = []
      }

      if (emails.length === 0) return false

      const latest = emails[0]
      const diffMin = (Date.now() - new Date(latest.date).getTime()) / 60_000
      if (diffMin >= 5) return false

      const link = extractMagicLink(latest.body)
      setLatestEmail(latest)
      setMagicLink(link)
      setPhase('has-email')
      stopPolling()
      return true
    } catch {
      return false
    } finally {
      busyRef.current = false
    }
  }, [stopPolling])

  /** Start polling: check once immediately, then every 10s, give up after 60s */
  const startPolling = useCallback(async () => {
    stopPolling()
    setPhase('checking')
    setPollFailed(false)

    // First attempt immediately
    const found = await tryFetchEmail()
    if (found) return

    // Poll every 10s
    pollRef.current = setInterval(async () => {
      await tryFetchEmail()
    }, 10_000)

    // Give up after 60s
    pollTimeoutRef.current = setTimeout(() => {
      stopPolling()
      setPhase('idle')
      setPollFailed(true)
    }, 60_000)
  }, [tryFetchEmail, stopPolling])

  const handleOpenLink = useCallback(() => {
    if (!magicLink) return
    window.open(magicLink, '_blank')
    setPhase('success')
  }, [magicLink])

  const handleCopyLink = useCallback(() => {
    if (!magicLink) return
    navigator.clipboard.writeText(magicLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1500)
  }, [magicLink])

  const handleRefetch = useCallback(() => {
    setLatestEmail(null)
    setMagicLink(null)
    startPolling()
  }, [startPolling])

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
          <>
            <button
              onClick={startPolling}
              className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.main.claudeWeb.fetchEmail}
            </button>
            {pollFailed && (
              <p className="text-xs text-amber-600 mt-2">{t.main.claudeWeb.noEmail}</p>
            )}
          </>
        )

      case 'checking':
        return (
          <>
            <button
              disabled
              className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand/40 text-white/60 cursor-not-allowed"
            >
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t.main.claudeWeb.fetchingEmail}
              </span>
            </button>
            <p className="text-xs text-text-faint mt-2">{t.main.claudeWeb.noEmailYet}</p>
          </>
        )

      case 'has-email': {
        const age = latestEmail ? getEmailAge(latestEmail.date, t.main.claudeWeb) : null
        return (
          <>
            {/* Link display with copy */}
            {magicLink ? (
              <div className="w-full mb-3">
                <div className="flex items-center gap-1.5 bg-bg-alt rounded-lg px-3 py-2 border border-border">
                  <span className="flex-1 text-xs text-text-secondary font-mono truncate" title={magicLink}>
                    {truncateUrl(magicLink)}
                  </span>
                  <button
                    onClick={handleCopyLink}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-brand hover:bg-bg-card transition-colors cursor-pointer"
                  >
                    {linkCopied ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-green-600">{t.main.claudeWeb.copiedLink}</span>
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>{t.main.claudeWeb.copyLink}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-600 mb-3">{t.main.claudeWeb.noLink}</p>
            )}

            {/* Primary: Open Link / Secondary: Re-fetch */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleOpenLink}
                disabled={!magicLink}
                className="px-7 py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.main.claudeWeb.requestLogin}
              </button>
              <button
                onClick={handleRefetch}
                className="px-4 py-2.5 rounded-lg text-sm border border-border text-text-secondary cursor-pointer hover:border-brand/40 transition-colors"
              >
                {t.main.claudeWeb.refetch}
              </button>
            </div>

            {age && (
              <p className={`text-xs mt-2 ${age.color}`}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-70 mr-1 align-middle" />
                {t.main.claudeWeb.emailReceived} · {age.label}
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
              onClick={() => { setPhase('idle'); setLatestEmail(null); setMagicLink(null); stopPolling() }}
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
