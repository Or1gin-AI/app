import { useCallback, useState } from 'react'
import { useLocale } from '@/i18n/context'

type PlanId = 'free' | 'pro' | '5x' | '20x'

interface PlanPageProps {
  currentPlan: PlanId
  expiresAt: string
  claudeAccountId: string
  accountStatus: string
  networkOk: boolean
  onBack?: () => void
  onRefresh: () => Promise<unknown>
}

type Notice = { type: 'success' | 'error'; message: string } | null

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'FREE',
  pro: 'PRO',
  '5x': 'X5',
  '20x': 'X20',
}

export function PlanPage({
  currentPlan,
  expiresAt,
  claudeAccountId,
  onBack,
  onRefresh,
}: PlanPageProps) {
  const { t } = useLocale()
  const [notice, setNotice] = useState<Notice>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)

  const hasAccount = Boolean(claudeAccountId)
  const hasPaidPlan = currentPlan !== 'free'

  const showNotice = useCallback((type: Notice['type'], message: string) => {
    setNotice({ type, message })
  }, [])

  const handleRedeemSubmit = useCallback(async () => {
    if (!hasAccount) {
      showNotice('error', t.plan.redeemCodeMissingAccount)
      return
    }

    const code = redeemCode.trim()
    if (!code) return

    setRedeemLoading(true)
    setNotice(null)
    try {
      const res = await window.electronAPI.payment.redeemCode(code, claudeAccountId)
      if (res.status >= 200 && res.status < 300) {
        const data = res.data as { productType?: string; expireAt?: string }
        await onRefresh()
        setRedeemCode('')
        showNotice(
          'success',
          t.plan.redeemCodeSuccessDesc
            .replace('{plan}', t.plan.productTypes[data.productType || PLAN_LABELS[currentPlan]] || data.productType || PLAN_LABELS[currentPlan])
            .replace('{date}', (data.expireAt || new Date().toISOString()).split('T')[0]),
        )
        return
      }

      const errData = res.data as { message?: string } | undefined
      showNotice(
        'error',
        typeof errData === 'object' && errData?.message ? errData.message : t.plan.errorTitle,
      )
    } catch {
      showNotice('error', t.plan.errorTitle)
    } finally {
      setRedeemLoading(false)
    }
  }, [claudeAccountId, currentPlan, hasAccount, onRefresh, redeemCode, showNotice, t])

  const currentPlanLabel = currentPlan === 'free' ? t.plan.free : t.plan.plans[currentPlan]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-6 py-8">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-6 border-none bg-transparent text-[13px] text-text-muted cursor-pointer hover:text-text-secondary"
          >
            {t.plan.back}
          </button>
        )}

        <header className="mb-8">
          <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.18em] text-text-faint">{t.plan.title}</p>
          <h1 className="mb-2 font-serif text-2xl text-text">{t.plan.title}</h1>
          <p className="max-w-[680px] text-sm leading-6 text-text-muted">{t.plan.subtitle}</p>
        </header>

        {notice && (
          <div
            className={`mb-6 rounded-xl border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {notice.message}
          </div>
        )}

        {!hasPaidPlan ? (
          <section className="rounded-2xl border border-border bg-bg-card p-6">
            <div className="max-w-[620px]">
              <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.16em] text-text-faint">{t.plan.redeemCodeTitle}</p>
              <h2 className="mb-2 font-serif text-lg text-text">{t.plan.redeemCodeTitle}</h2>
              <p className="mb-5 text-sm leading-6 text-text-muted">{t.plan.redeemCodeDesc}</p>

              <div className="mb-5 rounded-xl border border-dashed border-border-strong p-4">
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    value={redeemCode}
                    onChange={(event) => setRedeemCode(event.target.value.toUpperCase())}
                    placeholder={t.plan.redeemCodePlaceholder}
                    className="flex-1 rounded-lg border border-border bg-bg px-3 py-2.5 text-[13px] text-text font-mono uppercase outline-none transition-colors focus:border-brand"
                  />
                  <button
                    onClick={handleRedeemSubmit}
                    disabled={redeemLoading || !redeemCode.trim()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm text-white cursor-pointer transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {redeemLoading ? t.plan.redeemCodeSubmitting : t.plan.redeemCodeSubmit}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-bg p-4">
                <p className="mb-2 text-xs font-mono text-text-faint">{t.plan.afterRedeemTitle}</p>
                <p className="text-sm leading-6 text-text-muted">{t.plan.afterRedeemDesc}</p>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-border bg-bg-card p-5">
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-[11px] font-mono uppercase tracking-[0.16em] text-text-faint">{t.plan.planSummaryTitle}</p>
                <h2 className="mb-2 font-serif text-lg text-text">{t.plan.planSummaryTitle}</h2>
                <p className="text-sm leading-6 text-text-muted">{t.plan.planSummaryDesc}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-border bg-bg p-4">
                  <p className="mb-2 text-xs font-mono text-text-faint">{t.plan.currentPlan}</p>
                  <p className="text-sm font-medium text-text">{currentPlanLabel}</p>
                </div>
                <div className="rounded-xl border border-border bg-bg p-4">
                  <p className="mb-2 text-xs font-mono text-text-faint">{t.plan.expiresAt}</p>
                  <p className="text-sm font-medium text-text">{expiresAt || '—'}</p>
                </div>
                <div className="rounded-xl border border-border bg-bg p-4">
                  <p className="mb-2 text-xs font-mono text-text-faint">{t.plan.status}</p>
                  <p className="text-sm font-medium text-green-600">{t.plan.planUnlocked}</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export type { PlanId }
