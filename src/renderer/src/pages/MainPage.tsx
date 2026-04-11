import { useCallback, useState } from 'react'
import { useLocale } from '@/i18n/context'
import { track, EVENTS } from '@/lib/telemetry'
import { SmsActivationCard } from '@/components/SmsActivationCard'

interface MainPageProps {
  accountMode: string
  registered: boolean
  claudeAccountId: string
  hasPaidPlan: boolean
  networkOk: boolean
  onRefresh: () => Promise<unknown>
}

type Notice = { type: 'success' | 'error'; message: string } | null

const SELF_SERVICE_MODE = 'SELF_SERVICE_GMAIL'

export function MainPage({ accountMode, registered, claudeAccountId, hasPaidPlan, networkOk, onRefresh }: MainPageProps) {
  const { t } = useLocale()
  const [notice, setNotice] = useState<Notice>(null)
  const [completeLoading, setCompleteLoading] = useState(false)

  const canCompleteRegistration = accountMode === SELF_SERVICE_MODE

  const handleOpenClaude = useCallback(() => {
    window.open('https://claude.ai', '_blank')
  }, [])

  const handleCompleteRegistration = useCallback(async () => {
    if (!canCompleteRegistration || registered) return

    setCompleteLoading(true)
    setNotice(null)
    try {
      const res = await window.electronAPI.claudeAccount.completeSelfServiceRegistration()
      if (res.status >= 200 && res.status < 300) {
        track(EVENTS.USER_REGISTERED)
        await onRefresh()
        setNotice({ type: 'success', message: t.main.claudeWeb.completeRegistrationSuccess })
        return
      }

      const errData = res.data as { message?: string } | undefined
      setNotice({
        type: 'error',
        message: typeof errData === 'object' && errData?.message ? errData.message : t.main.claudeWeb.completeRegistrationError,
      })
    } catch {
      setNotice({ type: 'error', message: t.main.claudeWeb.completeRegistrationError })
    } finally {
      setCompleteLoading(false)
    }
  }, [canCompleteRegistration, onRefresh, registered, t])

  const webSteps = [
    <>{t.main.claudeWeb.step1}</>,
    <>{t.main.claudeWeb.step2}</>,
    <>{t.main.claudeWeb.step3}</>,
    <>{t.main.claudeWeb.step4}</>,
  ]

  return (
    <div className="relative flex flex-1 min-h-0 items-center overflow-y-auto">
      <div className="absolute right-8 top-8 z-10">
        <SmsActivationCard
          claudeAccountId={claudeAccountId}
          hasPaidPlan={hasPaidPlan}
          networkOk={networkOk}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-10 border-r border-border">
        <div className="max-w-[320px] w-full">
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

          <div className="text-[13px] text-text-secondary leading-relaxed mb-6">
            {webSteps.map((content, index) => (
              <div key={index} className="flex gap-2.5 mb-3.5 items-start">
                <div className="min-w-[22px] h-[22px] rounded-full bg-bg-alt text-brand flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                  {index + 1}
                </div>
                <div>{content}</div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-bg-card p-4 mb-5">
            <p className="text-xs font-mono text-text-faint mb-2">{t.main.claudeWeb.statusLabel}</p>
            <p className={`text-sm font-medium mb-2 ${registered ? 'text-green-600' : 'text-amber-600'}`}>
              {registered ? t.main.claudeWeb.statusDone : t.main.claudeWeb.statusPending}
            </p>
            <p className="text-xs text-text-muted leading-5">
              {registered ? t.main.claudeWeb.statusHintDone : t.main.claudeWeb.statusHintPending}
            </p>
          </div>

          {notice && (
            <div
              className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                notice.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {notice.message}
            </div>
          )}

          <div className="text-center">
            <div className="flex flex-col gap-3">
              <button
                onClick={handleOpenClaude}
                className="w-full py-2.5 rounded-lg text-sm font-medium bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
              >
                {t.main.claudeWeb.openClaude}
              </button>
              <button
                onClick={handleCompleteRegistration}
                disabled={!canCompleteRegistration || registered || completeLoading}
                className="w-full py-2.5 rounded-lg text-sm font-medium border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {completeLoading ? t.main.claudeWeb.completingRegistration : registered ? t.main.claudeWeb.statusDone : t.main.claudeWeb.completeRegistration}
              </button>
            </div>
            <p className="text-xs text-text-faint mt-3 leading-5">{t.main.claudeWeb.supportNote}</p>
          </div>
        </div>
      </div>

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

          <p className="text-[12px] text-red-500 mb-4 leading-relaxed">{t.main.claudeCode.newTerminalWarning}</p>

          <div className="text-[13px] text-text-secondary leading-relaxed">
            {[
              <>{t.main.claudeCode.step1} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">claude login</code></>,
              <>{t.main.claudeCode.step2} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">{t.main.claudeCode.step2method}</code> {t.main.claudeCode.step2suffix}</>,
              <>{t.main.claudeCode.step3}</>,
              <>{t.main.claudeCode.step4}</>,
            ].map((content, index) => (
              <div key={index} className="flex gap-2.5 mb-3.5 items-start">
                <div className="min-w-[22px] h-[22px] rounded-full bg-bg-alt text-brand flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                  {index + 1}
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
