import { useState } from 'react'
import { useLocale } from '@/i18n/context'

type PlanId = 'free' | 'pro' | '5x' | '20x'

interface PlanPageProps {
  currentPlan: PlanId
  expiresAt: string
  userEmail: string
  onBack: () => void
}

const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  pro: 30,
  '5x': 120,
  '20x': 240,
}

const CURRENCY = '$'

const PLAN_ORDER: PlanId[] = ['free', 'pro', '5x', '20x']

type ModalState =
  | null
  | { step: 'confirm'; target: PlanId }
  | { step: 'override'; target: PlanId }
  | { step: 'downgrade'; target: PlanId }
  | { step: 'done'; target: PlanId }

export function PlanPage({ currentPlan, expiresAt, userEmail, onBack }: PlanPageProps) {
  const { t } = useLocale()
  const [modal, setModal] = useState<ModalState>(null)

  const currentIdx = PLAN_ORDER.indexOf(currentPlan)

  const handleSelect = (plan: PlanId) => {
    if (plan === currentPlan) return
    setModal({ step: 'confirm', target: plan })
  }

  const handleConfirm = () => {
    if (!modal) return
    const targetIdx = PLAN_ORDER.indexOf(modal.target)
    if (modal.target === 'free') {
      setModal({ step: 'downgrade', target: modal.target })
    } else if (currentPlan !== 'free') {
      setModal({ step: 'override', target: modal.target })
    } else {
      setModal({ step: 'done', target: modal.target })
    }
  }

  const handleOverrideConfirm = () => {
    if (!modal) return
    setModal({ step: 'done', target: modal.target })
  }

  const handleDowngradeConfirm = () => {
    if (!modal) return
    setModal({ step: 'done', target: modal.target })
  }

  const planLabel = (id: PlanId) => t.plan.plans[id]
  const isDowngrade = (id: PlanId) => PLAN_ORDER.indexOf(id) < currentIdx

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="max-w-[560px] w-full mx-auto py-8 px-6">
        {/* Back */}
        <button
          onClick={onBack}
          className="text-[13px] text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none mb-6"
        >
          {t.plan.back}
        </button>

        {/* Account Status */}
        <div className="rounded-xl border border-border bg-bg-card p-5 mb-8">
          <h2 className="font-serif text-lg text-text mb-4">{t.plan.accountStatus}</h2>
          <div className="flex gap-6 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-text-faint text-xs font-mono mb-1">{t.plan.email}</p>
              <p className="text-text-secondary truncate" title={userEmail}>{userEmail}</p>
            </div>
            <div className="shrink-0">
              <p className="text-text-faint text-xs font-mono mb-1">{t.plan.currentPlan}</p>
              <p className="text-brand font-medium">{planLabel(currentPlan)}</p>
            </div>
            <div className="shrink-0">
              <p className="text-text-faint text-xs font-mono mb-1">{t.plan.expiresAt}</p>
              <p className="text-text-secondary">{currentPlan === 'free' ? '—' : expiresAt}</p>
            </div>
          </div>
        </div>

        {/* Plan Cards */}
        <h2 className="font-serif text-lg text-text mb-4">{t.plan.choosePlan}</h2>
        <div className="grid grid-cols-4 gap-3">
          {PLAN_ORDER.map((id) => {
            const isCurrent = id === currentPlan
            const price = PLAN_PRICES[id]
            return (
              <div
                key={id}
                className={`rounded-xl border p-4 flex flex-col items-center transition-colors ${
                  isCurrent
                    ? 'border-brand bg-brand/[0.04]'
                    : 'border-border bg-bg-card hover:border-brand/40'
                }`}
              >
                <p className="text-xs font-mono text-text-faint mb-1">{planLabel(id)}</p>
                <p className="text-2xl font-semibold text-text mb-0.5">
                  {price === 0 ? t.plan.free : `${CURRENCY}${price}`}
                </p>
                <p className="text-[11px] text-text-faint mb-4">{price > 0 ? t.plan.perMonth : '\u00A0'}</p>
                {isCurrent ? (
                  <span className="text-xs text-brand font-medium py-1.5">{t.plan.current}</span>
                ) : (
                  <button
                    onClick={() => handleSelect(id)}
                    className={`w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 ${
                      isDowngrade(id)
                        ? 'bg-transparent border border-border-strong text-text-secondary'
                        : 'bg-brand text-white'
                    }`}
                  >
                    {isDowngrade(id) ? t.plan.downgrade : t.plan.upgrade}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== Modals ===== */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-bg rounded-xl border border-border shadow-lg w-[340px] p-6">
            {/* Confirm purchase / downgrade */}
            {modal.step === 'confirm' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">
                  {isDowngrade(modal.target) ? t.plan.confirmDowngradeTitle : t.plan.confirmTitle}
                </h3>
                <p className="text-sm text-text-muted mb-5">
                  {isDowngrade(modal.target)
                    ? t.plan.confirmDowngradeDesc
                        .replace('{plan}', planLabel(modal.target))
                    : t.plan.confirmDesc
                        .replace('{plan}', planLabel(modal.target))
                        .replace('{price}', `${CURRENCY}${PLAN_PRICES[modal.target]}`)}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors"
                  >
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {t.plan.confirm}
                  </button>
                </div>
              </>
            )}

            {/* Override existing plan */}
            {modal.step === 'override' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.overrideTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {t.plan.overrideDesc
                    .replace('{current}', planLabel(currentPlan))
                    .replace('{target}', planLabel(modal.target))}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors"
                  >
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleOverrideConfirm}
                    className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {t.plan.confirmOverride}
                  </button>
                </div>
              </>
            )}

            {/* Downgrade to free — will take effect at end of period */}
            {modal.step === 'downgrade' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.downgradeTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {t.plan.downgradeDesc.replace('{date}', expiresAt)}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors"
                  >
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleDowngradeConfirm}
                    className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {t.plan.confirmDowngrade}
                  </button>
                </div>
              </>
            )}

            {/* Done */}
            {modal.step === 'done' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.doneTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {isDowngrade(modal.target)
                    ? t.plan.doneDowngradeDesc.replace('{date}', expiresAt)
                    : t.plan.doneDesc.replace('{plan}', planLabel(modal.target))}
                </p>
                <button
                  onClick={() => setModal(null)}
                  className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                >
                  {t.plan.ok}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export type { PlanId }
