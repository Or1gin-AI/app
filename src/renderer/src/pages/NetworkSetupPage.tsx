import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/context'
import { VscLock } from 'react-icons/vsc'
import { PiWarningBold } from 'react-icons/pi'

interface NetworkSetupPageProps {
  onComplete: () => void
}

export function NetworkSetupPage({ onComplete }: NetworkSetupPageProps) {
  const { t } = useLocale()
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setTimeout(onComplete, 500)
          return 100
        }
        return prev + 2
      })
    }, 60)
    return () => clearInterval(interval)
  }, [onComplete])

  useEffect(() => {
    if (progress < 25) setStep(0)
    else if (progress < 50) setStep(1)
    else if (progress < 80) setStep(2)
    else setStep(3)
  }, [progress])

  const steps = [
    t.network.stepDetect,
    t.network.stepFetch,
    t.network.stepApply,
    t.network.stepVerify,
  ]

  const stepIcon = (i: number) => {
    if (i < step) return '✓'
    if (i === step) return '◎'
    return '○'
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mb-5">
        <PiWarningBold size={24} className="text-yellow-500" />
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">{t.network.title}</h2>
      <p className="text-[13px] text-text-muted mb-7 text-center leading-relaxed">
        {t.network.subtitle}
        <br />
        {t.network.subtitleLine2}
      </p>

      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-5 mb-4">
        <div className="flex items-center gap-3 mb-3.5">
          <div className="w-8 h-8 rounded-lg bg-bg-alt flex items-center justify-center shrink-0">
            <VscLock size={16} className="text-brand" />
          </div>
          <div>
            <div className="text-[13px] text-text font-medium">{t.network.permissionTitle}</div>
            <div className="text-[11px] text-text-muted">{t.network.permissionDesc}</div>
          </div>
        </div>

        <div className="mb-3.5">
          <div className="flex justify-between text-[11px] text-text-muted mb-1.5 font-mono">
            <span>{t.network.configuring}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-[3px] bg-bg-alt rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="text-[11px] text-text-faint font-mono leading-[1.8]">
          {steps.map((label, i) => (
            <div key={i}>
              {stepIcon(i)} {label}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-text-faint">{t.network.autoRedirect}</p>
    </div>
  )
}
