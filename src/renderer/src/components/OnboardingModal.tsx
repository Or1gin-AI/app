import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocale } from '@/i18n/context'
import logoImg from '@/assets/icon-transparent.png'
import step1Img from '@/assets/onboarding/step1-network.png'
import step2Img from '@/assets/onboarding/step2-claude.png'
import step3aImg from '@/assets/onboarding/step3-login1.png'
import step3bImg from '@/assets/onboarding/step3-login2.png'
import step4aImg from '@/assets/onboarding/step4-activate1.png'
import step4bImg from '@/assets/onboarding/step4-activate2.png'
import step5Img from '@/assets/onboarding/step5-success.png'

const STEP_IMAGES: (string | string[])[] = [
  step1Img,
  step2Img,
  [step3aImg, step3bImg],
  [step4aImg, step4bImg],
  step5Img,
]

interface OnboardingModalProps {
  onComplete: () => void
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 cursor-pointer"
      onClick={onClose}
    >
      <img
        src={src}
        className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl object-contain"
      />
    </div>
  )
}

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const { t } = useLocale()
  const [step, setStep] = useState(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const TOTAL_STEPS = 2

  // Page 2 gating: scroll to bottom, then 10s countdown
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const scrollRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start 10s countdown when entering page 2
  useEffect(() => {
    if (step === 1) {
      setScrolledToBottom(false)
      setCountdown(10)
      countdownRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
            return 0
          }
          return c - 1
        })
      }, 1000)
    }
    return () => { if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null } }
  }, [step])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 20) {
      setScrolledToBottom(true)
    }
  }, [])

  // If content is short enough, no scrolling needed
  useEffect(() => {
    if (step === 1 && scrollRef.current) {
      const el = scrollRef.current
      if (el.scrollHeight <= el.clientHeight + 20) {
        setScrolledToBottom(true)
      }
    }
  }, [step])

  const canFinish = scrolledToBottom && countdown <= 0

  const handleFinish = async () => {
    if (!canFinish) return
    await window.electronAPI.auth.setNewuser(0).catch(() => {})
    onComplete()
  }

  return (
    <>
    {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-bg rounded-2xl border border-border shadow-2xl w-[640px] max-h-[85vh] flex flex-col overflow-hidden">

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col">
          {step === 0 && (
            <div className="flex-1 flex flex-col px-8 py-6 overflow-y-auto">
              <div className="flex items-center gap-3 mb-4 shrink-0">
                <img src={logoImg} alt="OriginAI" className="w-[40px] h-[40px]" />
                <h2 className="font-serif text-xl text-text">{t.onboarding.welcomeTitle}</h2>
              </div>
              <p className="text-[13px] text-text-muted leading-relaxed whitespace-pre-line mb-4">
                {t.onboarding.welcomeGreeting}
              </p>
              <p className="text-[13px] text-text-muted leading-relaxed whitespace-pre-line flex-1">
                {t.onboarding.welcomeBody.split('{telegram}').map((part: string, i: number, arr: string[]) => (
                  <span key={i}>
                    {part}
                    {i < arr.length - 1 && (
                      <a
                        href="https://t.me/origin_ai_2026"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        Telegram {t.onboarding.telegramLabel}
                      </a>
                    )}
                  </span>
                ))}
              </p>
              <p className="text-[13px] text-text-muted text-right mt-4 shrink-0">
                {t.onboarding.welcomeSignature}
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col min-h-0 px-8 pt-6 pb-4">
              <h2 className="font-serif text-lg text-text mb-4 shrink-0">{t.onboarding.guideTitle}</h2>
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 min-h-0 overflow-y-auto pr-2 text-[13px] text-text-secondary leading-relaxed"
              >
                {t.onboarding.steps.map((s: { title: string; desc: string; warn?: string }, i: number) => {
                  const imgs = STEP_IMAGES[i]
                  return (
                    <div key={i} className="mb-6">
                      <div className="flex gap-3">
                        <div className="min-w-[24px] h-[24px] rounded-full bg-brand/10 text-brand flex items-center justify-center text-[12px] font-semibold font-mono shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <div>
                          <p className="font-medium text-text mb-0.5">{s.title}</p>
                          <p className="text-text-muted">{s.desc}</p>
                          {s.warn && <p className="text-red-500 text-[12px] mt-1">{s.warn}</p>}
                        </div>
                      </div>
                      {imgs && (
                        <div className="mt-3 ml-9 flex gap-2">
                          {(Array.isArray(imgs) ? imgs : [imgs]).map((src, j) => (
                            <img
                              key={j}
                              src={src}
                              onClick={() => setLightboxSrc(src)}
                              className="rounded-lg border border-border shadow-sm max-h-[160px] object-contain cursor-pointer hover:opacity-80 transition-opacity"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                <div className="border-t border-border pt-4 mt-2 mb-2">
                  <p className="text-[12px] text-text-faint leading-relaxed">
                    {t.onboarding.footer}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar: progress + navigation */}
        <div className="shrink-0 px-8 py-4 border-t border-border flex items-center gap-4">
          {/* Progress dots */}
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-brand' : 'bg-border-strong'
                }`}
              />
            ))}
          </div>

          {/* Progress bar */}
          <div className="flex-1 h-[3px] bg-bg-alt rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>

          {/* Navigation */}
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-1.5 text-sm border border-border-strong text-text-secondary rounded-lg cursor-pointer hover:bg-black/[0.03] transition-colors"
              >
                {t.onboarding.prev}
              </button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-4 py-1.5 text-sm bg-brand text-white rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
              >
                {t.onboarding.next}
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={!canFinish}
                className="px-4 py-1.5 text-sm bg-brand text-white rounded-lg cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed min-w-[100px]"
              >
                {!scrolledToBottom
                  ? t.onboarding.finish
                  : countdown > 0
                    ? `${t.onboarding.finish} (${countdown}s)`
                    : t.onboarding.finish}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
