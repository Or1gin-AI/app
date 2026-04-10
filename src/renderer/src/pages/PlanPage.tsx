import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useLocale } from '@/i18n/context'
import { TicketPanel } from '@/components/TicketPanel'

type PlanId = 'free' | 'pro' | '5x' | '20x'

interface PlanPageProps {
  currentPlan: PlanId
  expiresAt: string
  userEmail: string
  claudeAccountId: string
  networkOk: boolean
  onBack?: () => void
  onRefresh: () => void
}

const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  pro: 20,
  '5x': 100,
  '20x': 200,
}

const PLAN_TO_PRODUCT: Record<PlanId, string> = {
  free: 'FREE',
  pro: 'PRO',
  '5x': 'X5',
  '20x': 'X20',
}

const CURRENCY = '$'
const PLAN_ORDER: PlanId[] = ['free', 'pro', '5x', '20x']

type PaymentTarget = PlanId | 'activation'

type SmsData = {
  activationId?: string
  countryCode?: string
  number?: string
  fullNumber?: string
  status?: string
  code?: string
}

type ModalState =
  | null
  | { step: 'confirm'; target: PlanId }
  | { step: 'override'; target: PlanId }
  | { step: 'payment'; target: PaymentTarget }
  | { step: 'waiting' }
  | { step: 'cancel-confirm' }
  | { step: 'activate-confirm' }
  | { step: 'activate'; phase: 'loading' | 'polling' | 'done' | 'error'; sms: SmsData; errorMsg?: string }
  | { step: 'error'; message: string }

export function PlanPage({ currentPlan, expiresAt, userEmail, claudeAccountId, networkOk, onBack, onRefresh }: PlanPageProps) {
  const { t } = useLocale()
  const [modal, setModal] = useState<ModalState>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<'stripe' | 'crypto' | null>(null)
  const [showTickets, setShowTickets] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Activation balance
  const [activationBalance, setActivationBalance] = useState<number | null>(null)

  const refreshBalance = useCallback(() => {
    window.electronAPI.auth.profile().then((res) => {
      if (res.status >= 200 && res.status < 300) {
        const data = res.data as { smsVerificationBalance?: number }
        setActivationBalance(data.smsVerificationBalance ?? 0)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { refreshBalance() }, [refreshBalance])

  const handleBuyActivation = () => {
    setModal({ step: 'payment', target: 'activation' as PlanId })
  }

  // SMS activation — cooldown persists at component level (survives modal close/reopen)
  const smsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [smsCooldownEnd, setSmsCooldownEnd] = useState(0)
  const [smsCooldown, setSmsCooldown] = useState(0)
  const smsCooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cooldown ticker — runs at component level regardless of modal state
  useEffect(() => {
    if (smsCooldownEnd <= Date.now()) {
      setSmsCooldown(0)
      return
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((smsCooldownEnd - Date.now()) / 1000))
      setSmsCooldown(remaining)
      if (remaining <= 0 && smsCooldownTimerRef.current) {
        clearInterval(smsCooldownTimerRef.current)
        smsCooldownTimerRef.current = null
      }
    }
    tick()
    smsCooldownTimerRef.current = setInterval(tick, 1000)
    return () => {
      if (smsCooldownTimerRef.current) { clearInterval(smsCooldownTimerRef.current); smsCooldownTimerRef.current = null }
    }
  }, [smsCooldownEnd])

  const stopSmsPoll = useCallback(() => {
    if (smsPollRef.current) { clearInterval(smsPollRef.current); smsPollRef.current = null }
  }, [])

  useEffect(() => () => stopSmsPoll(), [stopSmsPoll])

  const startSmsPoll = useCallback(() => {
    stopSmsPoll()
    smsPollRef.current = setInterval(async () => {
      try {
        const statusRes = await window.electronAPI.sms.status()
        if (statusRes.status >= 200 && statusRes.status < 300) {
          const data = statusRes.data as { status: string; code?: string }
          if (data.status === 'CODE_RECEIVED' && data.code) {
            stopSmsPoll()
            setModal((prev) => {
              if (!prev || prev.step !== 'activate') return prev
              return { ...prev, phase: 'done', sms: { ...prev.sms, code: data.code, status: 'CODE_RECEIVED' } }
            })
          } else if (data.status === 'EXPIRED') {
            stopSmsPoll()
            setModal((prev) => {
              if (!prev || prev.step !== 'activate') return prev
              return { ...prev, phase: 'error', errorMsg: t.plan.activateExpired }
            })
          }
        }
      } catch { /* keep polling */ }
    }, 10_000)
  }, [stopSmsPoll, t])

  // Click "Activate" button → show confirmation first
  const handleActivateClick = useCallback(() => {
    if (!networkOk) {
      setModal({ step: 'error', message: t.plan.activateNeedNetwork })
      return
    }
    setModal({ step: 'activate-confirm' })
  }, [networkOk, t])

  // After confirming → request number
  const handleActivateConfirm = useCallback(async () => {
    setModal({ step: 'activate', phase: 'loading', sms: {} })

    try {
      // Check if there's already an active number
      const existing = await window.electronAPI.sms.phoneNumber()
      let sms: SmsData
      let isNew = false

      if (existing.status >= 200 && existing.status < 300) {
        sms = existing.data as SmsData
      } else {
        const res = await window.electronAPI.sms.requestNumber()
        if (res.status < 200 || res.status >= 300) {
          const errData = res.data as { message?: string } | undefined
          setModal({
            step: 'activate', phase: 'error', sms: {},
            errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError,
          })
          return
        }
        sms = res.data as SmsData
        isNew = true
      }

      setModal({ step: 'activate', phase: 'polling', sms })

      // Start 2-min cooldown only for new numbers
      if (isNew) {
        setSmsCooldownEnd(Date.now() + 120_000)
      }

      startSmsPoll()
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [t, startSmsPoll])

  // Reopen activate modal (from activate button when already have active number)
  const handleActivateReopen = useCallback(async () => {
    if (!networkOk) {
      setModal({ step: 'error', message: t.plan.activateNeedNetwork })
      return
    }

    setModal({ step: 'activate', phase: 'loading', sms: {} })

    try {
      const existing = await window.electronAPI.sms.phoneNumber()
      if (existing.status >= 200 && existing.status < 300) {
        const sms = existing.data as SmsData
        setModal({ step: 'activate', phase: 'polling', sms })
        startSmsPoll()
      } else {
        // No active number — show confirmation
        setModal({ step: 'activate-confirm' })
      }
    } catch {
      setModal({ step: 'activate-confirm' })
    }
  }, [networkOk, t, startSmsPoll])

  const handleRefreshNumber = useCallback(async () => {
    stopSmsPoll()
    setModal({ step: 'activate', phase: 'loading', sms: {} })
    try {
      const res = await window.electronAPI.sms.refreshNumber()
      if (res.status >= 200 && res.status < 300) {
        const sms = res.data as SmsData
        setModal({ step: 'activate', phase: 'polling', sms })
        setSmsCooldownEnd(Date.now() + 120_000)
        startSmsPoll()
      } else {
        const errData = res.data as { message?: string } | undefined
        setModal({
          step: 'activate', phase: 'error', sms: {},
          errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError,
        })
      }
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [t, stopSmsPoll, startSmsPoll])

  const handleRefundNumber = useCallback(async () => {
    stopSmsPoll()
    await window.electronAPI.sms.refund().catch(() => {})
    setSmsCooldownEnd(0)
    refreshBalance()
    setModal(null)
  }, [stopSmsPoll, refreshBalance])

  const handleActivateClose = useCallback(() => {
    // Don't stop polling — let it run in background so reopening restores state
    refreshBalance()
    setModal(null)
  }, [refreshBalance])

  // Order history
  type Order = {
    id: string
    productType: string
    orderType: string
    price: number
    currency: string
    status: string
    paymentProvider: string
    createdAt: string
  }
  const [orders, setOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)

  useEffect(() => {
    setOrdersLoading(true)
    window.electronAPI.payment.orders(1, 20).then((res) => {
      if (res.status >= 200 && res.status < 300) {
        const data = res.data as { items?: Order[] }
        setOrders(data.items || [])
      }
    }).catch(() => {}).finally(() => setOrdersLoading(false))
  }, [])

  // Listen for checkout window close → refresh subscription
  useEffect(() => {
    cleanupRef.current = window.electronAPI.payment.onCheckoutClosed(() => {
      setModal(null)
      onRefresh()
      refreshBalance()
    })
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [onRefresh])

  const currentIdx = PLAN_ORDER.indexOf(currentPlan)

  const handleSelect = (plan: PlanId) => {
    if (plan === currentPlan) return
    if (plan === 'free') {
      setModal({ step: 'cancel-confirm' })
    } else if (PLAN_ORDER.indexOf(plan) > currentIdx) {
      setModal({ step: 'confirm', target: plan })
    }
  }

  const handleConfirm = () => {
    if (!modal || modal.step !== 'confirm') return
    if (currentPlan !== 'free') {
      setModal({ step: 'override', target: modal.target })
    } else {
      setModal({ step: 'payment', target: modal.target })
    }
  }

  const handleOverrideConfirm = () => {
    if (!modal || modal.step !== 'override') return
    setModal({ step: 'payment', target: modal.target })
  }

  const handlePaymentSelect = useCallback(
    async (method: 'stripe' | 'crypto') => {
      if (!modal || modal.step !== 'payment') return

      const provider = method === 'stripe' ? 'LEMONSQUEEZY' : 'HELIO'
      const productType = modal.target === 'activation' ? 'AI_ACTIVATION' : PLAN_TO_PRODUCT[modal.target as PlanId]

      setCheckoutLoading(method)
      try {
        const res = await window.electronAPI.payment.checkout(
          productType,
          provider,
          claudeAccountId || undefined
        )

        if (res.status === 200 || res.status === 201) {
          const data = res.data as { checkoutUrl?: string }
          if (data.checkoutUrl) {
            if (method === 'crypto') {
              // Crypto needs system browser for wallet extensions
              window.open(data.checkoutUrl, '_blank')
              setModal(null)
            } else {
              setModal({ step: 'waiting' })
              await window.electronAPI.payment.openCheckout(data.checkoutUrl)
            }
          } else {
            setModal({ step: 'error', message: t.plan.checkoutError })
          }
        } else {
          const errData = res.data as { message?: string } | undefined
          setModal({
            step: 'error',
            message:
              typeof errData === 'object' && errData?.message
                ? errData.message
                : t.plan.checkoutError,
          })
        }
      } catch {
        setModal({ step: 'error', message: t.plan.checkoutError })
      } finally {
        setCheckoutLoading(null)
      }
    },
    [modal, claudeAccountId, t]
  )


  const planLabel = (id: PlanId) => t.plan.plans[id]

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="max-w-[560px] w-full mx-auto py-8 px-6">
        {/* Back */}
        {onBack && (
          <button
            onClick={onBack}
            className="text-[13px] text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none mb-6"
          >
            {t.plan.back}
          </button>
        )}

        {/* Account Status & Activation */}
        <div className="rounded-xl border border-border bg-bg-card p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-lg text-text">{t.plan.accountStatus}</h2>
            <button
              onClick={() => setShowTickets(true)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-border-strong text-text-muted hover:text-brand hover:border-brand/40 cursor-pointer transition-colors bg-transparent"
            >
              {t.ticket.button}
            </button>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-text-faint text-xs font-mono mb-1">{t.plan.email}</p>
              <p className="text-text-secondary truncate" title={userEmail}>
                {userEmail}
              </p>
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

          {currentPlan !== 'free' && <div className="border-t border-border mt-4 pt-4 flex items-center gap-6">
            <h3 className="text-sm font-medium text-text shrink-0">{t.plan.activationTitle}</h3>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-text-faint text-xs font-mono">{t.plan.activationRemaining}</span>
              <span className="text-brand font-semibold">{activationBalance ?? '—'}</span>
            </div>
            <button
              onClick={handleBuyActivation}
              className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.plan.activationBuy}
            </button>
            <button
              onClick={smsCooldown > 0 ? handleActivateReopen : handleActivateClick}
              disabled={!activationBalance || activationBalance <= 0}
              className={`text-xs px-3 py-1.5 rounded-lg ml-auto transition-opacity ${
                activationBalance && activationBalance > 0
                  ? 'bg-brand text-white cursor-pointer hover:opacity-90'
                  : 'border border-border-strong text-text-faint cursor-not-allowed opacity-50'
              }`}
            >
              {t.plan.activationActivate}
            </button>
          </div>}
        </div>

        {/* Plan Cards */}
        <h2 className="font-serif text-lg text-text mb-4">{t.plan.choosePlan}</h2>
        <div className="grid grid-cols-4 gap-3">
          {PLAN_ORDER.map((id) => {
            const isCurrent = id === currentPlan
            const price = PLAN_PRICES[id]
            const targetIdx = PLAN_ORDER.indexOf(id)
            const canUpgrade = targetIdx > currentIdx
            const canCancel = id === 'free' && currentPlan !== 'free'

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
                <p className="text-[10px] text-text-faint mb-4">
                  {price > 0 ? <><span className="font-semibold">{t.plan.plusFeesBold}</span>{t.plan.plusFeesRest}</> : '\u00A0'}
                </p>
                {isCurrent ? (
                  <span className="text-xs text-brand font-medium py-1.5">{t.plan.current}</span>
                ) : canUpgrade ? (
                  <button
                    onClick={() => handleSelect(id)}
                    className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 bg-brand text-white"
                  >
                    {t.plan.upgrade}
                  </button>
                ) : canCancel ? (
                  <button
                    onClick={() => handleSelect(id)}
                    className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors bg-transparent border border-border-strong text-text-muted hover:text-text-secondary"
                  >
                    {t.plan.cancelSubscription}
                  </button>
                ) : (
                  <span className="py-1.5">&nbsp;</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Disclaimer */}
        <p className="text-[11px] text-text-faint mt-5 leading-relaxed">{t.plan.disclaimer}</p>

        {/* Order History */}
        <div className="mt-8">
          <h2 className="font-serif text-lg text-text mb-4">{t.plan.orderHistory}</h2>
          {ordersLoading ? (
            <div className="flex justify-center py-6">
              <div className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-text-faint text-center py-6">{t.plan.noOrders}</p>
          ) : (
            <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] text-text-faint font-mono">
                    <th className="text-left py-2.5 px-4 font-normal">{t.plan.orderDate}</th>
                    <th className="text-left py-2.5 px-4 font-normal">{t.plan.orderProduct}</th>
                    <th className="text-right py-2.5 px-4 font-normal">{t.plan.orderAmount}</th>
                    <th className="text-left py-2.5 px-4 font-normal">{t.plan.orderProvider}</th>
                    <th className="text-right py-2.5 px-4 font-normal">{t.plan.orderStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-b-0">
                      <td className="py-2.5 px-4 text-text-secondary">
                        {order.createdAt.split('T')[0]}
                      </td>
                      <td className="py-2.5 px-4 text-text">
                        {t.plan.productTypes[order.productType] || order.productType}
                      </td>
                      <td className="py-2.5 px-4 text-text text-right">
                        ${(order.price / 100).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-text-secondary text-[12px]">
                        {order.paymentProvider === 'LEMONSQUEEZY' ? 'Stripe' : 'Crypto'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={`text-[11px] font-medium ${
                          order.status === 'COMPLETED' ? 'text-green-600' :
                          order.status === 'PENDING' ? 'text-red-500' :
                          order.status === 'CANCELLED' ? 'text-text-faint' :
                          order.status === 'REFUNDED' ? 'text-blue-500' :
                          'text-text-muted'
                        }`}>
                          {t.plan.orderStatuses[order.status] || order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ===== Ticket Panel ===== */}
      <AnimatePresence>
        {showTickets && (
          <TicketPanel
            onClose={() => setShowTickets(false)}
          />
        )}
      </AnimatePresence>

      {/* ===== Modals ===== */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-bg rounded-xl border border-border shadow-lg w-[340px] p-6">
            {/* Confirm upgrade */}
            {modal.step === 'confirm' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.confirmTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {t.plan.confirmDesc
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

            {/* Payment method selection */}
            {modal.step === 'payment' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.paymentTitle}</h3>
                <p className="text-sm text-text-muted mb-5">{t.plan.paymentDesc}</p>
                <div className="flex flex-col gap-3 mb-4">
                  <button
                    onClick={() => handlePaymentSelect('stripe')}
                    disabled={!!checkoutLoading}
                    className="w-full py-3 rounded-lg text-sm border border-border-strong cursor-pointer hover:border-brand/40 hover:bg-brand/[0.03] transition-colors text-left px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkoutLoading === 'stripe' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                        <span className="font-medium text-text">{t.plan.payStripe}</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-medium text-text">{t.plan.payStripe}</span>
                        <br />
                        <span className="text-[11px] text-text-faint">{t.plan.payStripeDesc}</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handlePaymentSelect('crypto')}
                    disabled={!!checkoutLoading}
                    className="w-full py-3 rounded-lg text-sm border border-border-strong cursor-pointer hover:border-brand/40 hover:bg-brand/[0.03] transition-colors text-left px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkoutLoading === 'crypto' ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                        <span className="font-medium text-text">{t.plan.payCrypto}</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-medium text-text">{t.plan.payCrypto}</span>
                        <br />
                        <span className="text-[11px] text-text-faint">{t.plan.payCryptoDesc}</span>
                      </>
                    )}
                  </button>
                </div>
                <button
                  onClick={() => setModal(null)}
                  disabled={!!checkoutLoading}
                  className="w-full py-2 rounded-lg text-sm text-text-muted cursor-pointer hover:text-text-secondary transition-colors disabled:opacity-50"
                >
                  {t.plan.cancel}
                </button>
              </>
            )}

            {/* Waiting for checkout window */}
            {modal.step === 'waiting' && (
              <div className="flex flex-col items-center py-4">
                <div className="w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin mb-4" />
                <h3 className="font-serif text-base text-text mb-2">{t.plan.waitingTitle}</h3>
                <p className="text-sm text-text-muted text-center">{t.plan.waitingDesc}</p>
              </div>
            )}

            {/* Cancel subscription */}
            {modal.step === 'cancel-confirm' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.cancelTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {t.plan.cancelDesc
                    .replace('{plan}', planLabel(currentPlan))
                    .replace('{date}', expiresAt || '—')}
                </p>
                <button
                  onClick={() => setModal(null)}
                  className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                >
                  {t.plan.ok}
                </button>
              </>
            )}

            {/* Activation confirm */}
            {modal.step === 'activate-confirm' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.activateConfirmTitle}</h3>
                <p className="text-sm text-text-muted mb-5">{t.plan.activateConfirmDesc}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors"
                  >
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleActivateConfirm}
                    className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                  >
                    {t.plan.confirm}
                  </button>
                </div>
              </>
            )}

            {/* Activation */}
            {modal.step === 'activate' && (
              <>
                <h3 className="font-serif text-base text-text mb-4">{t.plan.activateTitle}</h3>

                {/* Loading */}
                {modal.phase === 'loading' && (
                  <div className="flex flex-col items-center py-6">
                    <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin mb-3" />
                    <p className="text-sm text-text-muted">{t.plan.activateRequesting}</p>
                  </div>
                )}

                {/* Polling for code */}
                {modal.phase === 'polling' && (
                  <div>
                    <div className="rounded-lg border border-border bg-bg-alt p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activatePhone}</span>
                        <span className="text-sm text-text font-semibold font-mono">
                          +{modal.sms.countryCode} {modal.sms.number}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activateStatus}</span>
                        <span className="flex items-center gap-1.5 text-xs text-amber-500">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          {t.plan.activateWaiting}
                          {smsCooldown > 0 && (
                            <span className="text-text-faint ml-1">
                              ({Math.floor(smsCooldown / 60)}:{(smsCooldown % 60).toString().padStart(2, '0')})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-text-faint mb-4 text-center">{t.plan.activateWaitingDesc}</p>
                    <div className="flex gap-3">
                      <button
                        onClick={handleRefreshNumber}
                        disabled={smsCooldown > 0}
                        className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t.plan.activateRefresh}
                      </button>
                      <button
                        onClick={handleRefundNumber}
                        disabled={smsCooldown > 0}
                        className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-muted cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t.plan.activateRefund}
                      </button>
                    </div>
                  </div>
                )}

                {/* Code received — no refresh/refund allowed */}
                {modal.phase === 'done' && (
                  <div>
                    <div className="rounded-lg border border-border bg-bg-alt p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activatePhone}</span>
                        <span className="text-sm text-text font-semibold font-mono">
                          +{modal.sms.countryCode} {modal.sms.number}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activateCode}</span>
                        <span className="text-lg text-brand font-bold font-mono tracking-wider">
                          {modal.sms.code}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={handleActivateClose}
                      className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                    >
                      {t.plan.ok}
                    </button>
                  </div>
                )}

                {/* Error */}
                {modal.phase === 'error' && (
                  <div>
                    <p className="text-sm text-red-500 mb-4">{modal.errorMsg}</p>
                    <button
                      onClick={handleActivateClose}
                      className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
                    >
                      {t.plan.ok}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Error */}
            {modal.step === 'error' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.errorTitle}</h3>
                <p className="text-sm text-text-muted mb-5">{modal.message}</p>
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
