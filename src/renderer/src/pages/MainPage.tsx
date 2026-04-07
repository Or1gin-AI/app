import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocale } from '@/i18n/context'

interface MainPageProps {
  userName: string
}

export function MainPage({ userName }: MainPageProps) {
  const { t } = useLocale()
  const [showModal, setShowModal] = useState(false)
  const [cooldown, setCooldown] = useState(0) // seconds remaining
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const handleRequestLogin = useCallback(() => {
    setShowModal(true)
  }, [])

  const handleModalConfirm = useCallback(() => {
    setShowModal(false)
    setCooldown(120) // 2 minutes
    // TODO: call backend API here
  }, [])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const webSteps = [
    <>{t.main.claudeWeb.step1}</>,
    <>
      {t.main.claudeWeb.step2pre}{' '}
      <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">
        {t.main.claudeWeb.step2email.replace('{name}', userName || '···')}
      </code>{' '}
      {t.main.claudeWeb.step2post}
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
              disabled={cooldown > 0}
              className={`px-7 py-2.5 rounded-lg text-sm font-medium transition-opacity ${
                cooldown > 0
                  ? 'bg-brand/40 text-white/60 cursor-not-allowed'
                  : 'bg-brand text-white cursor-pointer hover:opacity-90'
              }`}
            >
              {t.main.claudeWeb.button}
            </button>
            {cooldown > 0 && (
              <p className="text-xs text-text-faint mt-2">
                {t.main.claudeWeb.retryAfter.replace('{time}', formatTime(cooldown))}
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
