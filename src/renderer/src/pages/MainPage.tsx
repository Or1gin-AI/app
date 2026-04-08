import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from '@/i18n/context'

interface MainPageProps {
  userName: string
}

type RequestStatus = 'idle' | 'polling' | 'success' | 'no-email' | 'error'

type EmailItem = { from: string; subject: string; body: string; date: string }

export function MainPage({ userName }: MainPageProps) {
  const { t } = useLocale()
  const [showModal, setShowModal] = useState(false)
  const [cooldown, setCooldown] = useState(0) // seconds remaining
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const busyRef = useRef(false)

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopPolling(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [stopPolling])

  // Countdown ticker
  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // When cooldown expires during polling → no email received
  useEffect(() => {
    if (cooldown <= 0 && requestStatus === 'polling') {
      stopPolling()
      setRequestStatus('no-email')
    }
  }, [cooldown, requestStatus, stopPolling])

  /** Single poll attempt — returns true if login link found */
  const pollOnce = useCallback(async (): Promise<boolean> => {
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

      const emails = res.data as EmailItem[]
      if (!emails || emails.length === 0) return false

      // Dedicated Claude inbox — take the most recent email directly
      const latest = emails[0]

      // Extract the magic-link URL from body
      const urls = latest.body.match(/https?:\/\/[^\s<>"')\]]+/g) || []
      const magicLink = urls.find((u) => u.includes('magic-link')) || urls[0]
      if (!magicLink) return false

      window.open(magicLink, '_blank')
      setRequestStatus('success')
      setStatusMessage('')

      stopPolling()
      setCooldown(0)
      return true
    } catch {
      return false // silent, keep polling
    } finally {
      busyRef.current = false
    }
  }, [stopPolling])

  const handleRequestLogin = useCallback(() => {
    setShowModal(true)
  }, [])

  const handleModalConfirm = useCallback(async () => {
    setShowModal(false)
    setRequestStatus('polling')
    setStatusMessage('')
    setCooldown(120)

    // Immediate first poll
    const found = await pollOnce()
    if (found) return

    // Poll every 10s for the remaining duration
    pollRef.current = setInterval(() => { pollOnce() }, 10_000)
  }, [pollOnce])

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
            <button
              onClick={handleRequestLogin}
              disabled={requestStatus === 'polling'}
              className={`px-7 py-2.5 rounded-lg text-sm font-medium transition-opacity ${
                requestStatus === 'polling'
                  ? 'bg-brand/40 text-white/60 cursor-not-allowed'
                  : 'bg-brand text-white cursor-pointer hover:opacity-90'
              }`}
            >
              {requestStatus === 'polling' ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t.main.claudeWeb.requesting}
                </span>
              ) : (
                t.main.claudeWeb.button
              )}
            </button>

            {requestStatus === 'polling' && cooldown > 0 && (
              <p className="text-xs text-text-faint mt-2">
                {t.main.claudeWeb.retryAfter.replace('{time}', formatTime(cooldown))}
              </p>
            )}
            {requestStatus === 'success' && (
              <p className="text-xs text-green-600 mt-2">
                {statusMessage || t.main.claudeWeb.success}
              </p>
            )}
            {requestStatus === 'no-email' && (
              <p className="text-xs text-amber-600 mt-2">
                {t.main.claudeWeb.noEmail}
              </p>
            )}
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

      {/* Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-bg rounded-xl border border-border shadow-lg w-[360px] p-6">
            <h3 className="font-serif text-base text-text mb-2">{t.main.claudeWeb.modalTitle}</h3>
            <p className="text-sm text-text-muted mb-4">{t.main.claudeWeb.modalDesc}</p>
            <ul className="text-sm text-text-secondary mb-5 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-brand mt-0.5">✓</span>
                <span>{t.main.claudeWeb.modalCheck1}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand mt-0.5">✓</span>
                <span>{t.main.claudeWeb.modalCheck2}</span>
              </li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors"
              >
                {t.main.claudeWeb.modalCancel}
              </button>
              <button
                onClick={handleModalConfirm}
                className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
              >
                {t.main.claudeWeb.modalConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
