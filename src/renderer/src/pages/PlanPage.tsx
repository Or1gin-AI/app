import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useLocale } from '@/i18n/context'
import { TicketPanel } from '@/components/TicketPanel'
import { track, EVENTS } from '@/lib/telemetry'

type PlanId = 'free' | 'standard' | 'pro' | 'enterprise'

interface PlanPageProps {
  currentPlan: PlanId
  expiresAt: string
  userEmail: string
  claudeAccountId: string
  accountStatus: string
  networkOk: boolean
  onBack?: () => void
  onRefresh: () => Promise<unknown>
}

const PLAN_TIERS: Record<PlanId, number> = { free: 0, standard: 1, pro: 2, enterprise: 3 }

const PLAN_PRICES: Record<PlanId, number> = { free: 0, standard: 10, pro: 10, enterprise: 25 }

const PLAN_TO_PRODUCT: Record<PlanId, string> = {
  free: 'FREE',
  standard: 'STANDARD',
  pro: 'PRO',
  enterprise: 'ENTERPRISE',
}

const PLAN_ORDER: PlanId[] = ['standard']

const PLAN_FEATURES: Record<Exclude<PlanId, 'free'>, { ipKey: string; ipDescKey: string; activations: number; devices: number }> = {
  standard: { ipKey: 'ipApartment', ipDescKey: 'ipApartmentDesc', activations: 1, devices: 1 },
  pro: { ipKey: 'ipVilla', ipDescKey: 'ipVillaDesc', activations: 3, devices: 3 },
  enterprise: { ipKey: 'ipPremiumVilla', ipDescKey: 'ipPremiumVillaDesc', activations: 10, devices: 10 },
}

const CURRENCY = '$'

const LDXP_PAYMENT_URL = 'https://pay.ldxp.cn/item/nzcb52'

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
  | { step: 'redeem'; target: PaymentTarget }
  | { step: 'redeem-success'; productType: string; expireAt: string }
  | { step: 'waiting'; afterClose?: { type: 'redeem'; target: PaymentTarget } }
  | { step: 'upgrade-success'; previousPlan: string; newPlan: string; proratedPrice: number }
  | { step: 'activate-confirm' }
  | { step: 'activate'; phase: 'loading' | 'polling' | 'done' | 'error'; sms: SmsData; errorMsg?: string }
  | { step: 'error'; message: string }

export function PlanPage({ currentPlan, expiresAt, userEmail, claudeAccountId, accountStatus, networkOk, onBack, onRefresh }: PlanPageProps) {
  const { t } = useLocale()
  const [modal, setModal] = useState<ModalState>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<'stripe' | 'crypto' | null>(null)
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)
  const [showTickets, setShowTickets] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const refreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

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

  const clearRefreshTimers = useCallback(() => {
    for (const timer of refreshTimersRef.current) clearTimeout(timer)
    refreshTimersRef.current = []
  }, [])

  const refreshPlanState = useCallback(() => {
    refreshBalance()
    void onRefresh()
  }, [onRefresh, refreshBalance])

  useEffect(() => {
    refreshPlanState()
    const interval = setInterval(() => { refreshPlanState() }, 3000)
    return () => clearInterval(interval)
  }, [refreshPlanState])

  // SMS activation
  const smsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [smsCooldownEnd, setSmsCooldownEnd] = useState(0)
  const [smsCooldown, setSmsCooldown] = useState(0)
  const smsCooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (smsCooldownEnd <= Date.now()) { setSmsCooldown(0); return }
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
    return () => { if (smsCooldownTimerRef.current) { clearInterval(smsCooldownTimerRef.current); smsCooldownTimerRef.current = null } }
  }, [smsCooldownEnd])

  const stopSmsPoll = useCallback(() => {
    if (smsPollRef.current) { clearInterval(smsPollRef.current); smsPollRef.current = null }
  }, [])

  useEffect(() => () => stopSmsPoll(), [stopSmsPoll])
  useEffect(() => () => clearRefreshTimers(), [clearRefreshTimers])

  const startSmsPoll = useCallback(() => {
    stopSmsPoll()
    smsPollRef.current = setInterval(async () => {
      try {
        const statusRes = await window.electronAPI.sms.status()
        if (statusRes.status >= 200 && statusRes.status < 300) {
          const data = statusRes.data as { status: string; code?: string }
          if (data.status === 'CODE_RECEIVED' && data.code) {
            track(EVENTS.SMS_CODE_RECEIVED)
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

  const handleActivateClick = useCallback(() => {
    if (!networkOk) { setModal({ step: 'error', message: t.plan.activateNeedNetwork }); return }
    setModal({ step: 'activate-confirm' })
  }, [networkOk, t])

  const handleActivateConfirm = useCallback(async () => {
    track(EVENTS.SMS_NUMBER_REQUESTED)
    setModal({ step: 'activate', phase: 'loading', sms: {} })
    try {
      const existing = await window.electronAPI.sms.phoneNumber()
      let sms: SmsData
      let isNew = false
      if (existing.status >= 200 && existing.status < 300) {
        sms = existing.data as SmsData
      } else {
        const res = await window.electronAPI.sms.requestNumber()
        if (res.status < 200 || res.status >= 300) {
          const errData = res.data as { message?: string } | undefined
          setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError })
          return
        }
        sms = res.data as SmsData
        isNew = true
      }
      setModal({ step: 'activate', phase: 'polling', sms })
      if (isNew) setSmsCooldownEnd(Date.now() + 120_000)
      startSmsPoll()
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [t, startSmsPoll])

  const handleActivateReopen = useCallback(async () => {
    if (!networkOk) { setModal({ step: 'error', message: t.plan.activateNeedNetwork }); return }
    setModal({ step: 'activate', phase: 'loading', sms: {} })
    try {
      const existing = await window.electronAPI.sms.phoneNumber()
      if (existing.status >= 200 && existing.status < 300) {
        setModal({ step: 'activate', phase: 'polling', sms: existing.data as SmsData })
        startSmsPoll()
      } else {
        setModal({ step: 'activate-confirm' })
      }
    } catch {
      setModal({ step: 'activate-confirm' })
    }
  }, [networkOk, t, startSmsPoll])

  const handleRefreshNumber = useCallback(async () => {
    track(EVENTS.SMS_NUMBER_REFRESHED)
    stopSmsPoll()
    setModal({ step: 'activate', phase: 'loading', sms: {} })
    try {
      const res = await window.electronAPI.sms.refreshNumber()
      if (res.status >= 200 && res.status < 300) {
        setModal({ step: 'activate', phase: 'polling', sms: res.data as SmsData })
        setSmsCooldownEnd(Date.now() + 120_000)
        startSmsPoll()
      } else {
        const errData = res.data as { message?: string } | undefined
        setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError })
      }
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [t, stopSmsPoll, startSmsPoll])

  const handleRefundNumber = useCallback(async () => {
    track(EVENTS.SMS_REFUNDED)
    stopSmsPoll()
    await window.electronAPI.sms.refund().catch(() => {})
    setSmsCooldownEnd(0)
    refreshBalance()
    setModal(null)
  }, [stopSmsPoll, refreshBalance])

  const handleActivateClose = useCallback(() => {
    refreshBalance()
    setModal(null)
  }, [refreshBalance])

  // Order history
  type Order = { id: string; productType: string; orderType: string; price: number; currency: string; status: string; paymentProvider: string; createdAt: string }
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

  // Listen for checkout window close
  useEffect(() => {
    cleanupRef.current = window.electronAPI.payment.onCheckoutClosed(() => {
      setModal((prev) => {
        if (prev && prev.step === 'waiting' && prev.afterClose?.type === 'redeem') {
          return { step: 'redeem', target: prev.afterClose.target }
        }
        return null
      })
      refreshPlanState()
      clearRefreshTimers()
      for (const delay of [1500, 4000, 8000]) {
        refreshTimersRef.current.push(setTimeout(() => { refreshPlanState() }, delay))
      }
    })
    return () => {
      clearRefreshTimers()
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [clearRefreshTimers, refreshPlanState])

  const currentIdx = PLAN_ORDER.indexOf(currentPlan)

  const handleContinuePayment = useCallback(async (plan: PlanId, provider: string) => {
    setCheckoutLoading(provider === 'HELIO' ? 'crypto' : 'stripe')
    try {
      const productType = PLAN_TO_PRODUCT[plan]
      const res = await window.electronAPI.payment.checkout(productType, provider, claudeAccountId || undefined)
      if ((res.status === 200 || res.status === 201) && (res.data as any)?.checkoutUrl) {
        const data = res.data as { checkoutUrl: string }
        setModal({ step: 'waiting' })
        await window.electronAPI.payment.openCheckout(data.checkoutUrl)
      } else {
        setModal({ step: 'error', message: t.plan.checkoutError })
      }
    } catch {
      setModal({ step: 'error', message: t.plan.checkoutError })
    } finally {
      setCheckoutLoading(null)
    }
  }, [claudeAccountId, t])

  const handleSelect = (plan: PlanId) => {
    if (plan === currentPlan) return
    if (PLAN_ORDER.indexOf(plan) > currentIdx) {
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

  const handleOverrideConfirm = async () => {
    if (!modal || modal.step !== 'override') return
    const productType = PLAN_TO_PRODUCT[modal.target as PlanId]
    setCheckoutLoading('stripe')
    try {
      const res = await window.electronAPI.payment.checkout(productType, undefined, claudeAccountId || undefined)
      if (res.status === 200 || res.status === 201) {
        const data = res.data as { checkoutUrl?: string; instant?: boolean; success?: boolean; previousPlan?: string; newPlan?: string; proratedPrice?: number }
        if (data.success && !data.checkoutUrl && (data.instant || data.proratedPrice === 0)) {
          track(EVENTS.SUBSCRIPTION_UPGRADED, { from: data.previousPlan, to: data.newPlan, instant: true })
          setModal({ step: 'upgrade-success', previousPlan: data.previousPlan || '', newPlan: data.newPlan || '', proratedPrice: data.proratedPrice || 0 })
          onRefresh()
          return
        }
        if (data.checkoutUrl) {
          track(EVENTS.CHECKOUT_CREATED, { provider: 'upgrade', productType })
          onRefresh()
          setModal({ step: 'waiting' })
          await window.electronAPI.payment.openCheckout(data.checkoutUrl)
        } else {
          setModal({ step: 'error', message: t.plan.checkoutError })
        }
      } else {
        const errData = res.data as { message?: string } | undefined
        setModal({ step: 'error', message: typeof errData === 'object' && errData?.message ? errData.message : t.plan.checkoutError })
      }
    } catch {
      setModal({ step: 'error', message: t.plan.checkoutError })
    } finally {
      setCheckoutLoading(null)
    }
  }

  const handlePaymentSelect = useCallback(async (method: 'stripe' | 'crypto') => {
    if (!modal || modal.step !== 'payment') return
    track(EVENTS.PAYMENT_METHOD_SELECTED, { method, target: modal.target })

    if (method === 'stripe') {
      const target = modal.target
      setCheckoutLoading('stripe')
      try {
        setRedeemCode('')
        setModal({ step: 'waiting', afterClose: { type: 'redeem', target } })
        await window.electronAPI.payment.openCheckout(LDXP_PAYMENT_URL)
      } catch {
        setModal({ step: 'error', message: t.plan.checkoutError })
      } finally {
        setCheckoutLoading(null)
      }
      return
    }

    const provider = 'HELIO'
    const productType = modal.target === 'activation' ? 'AI_ACTIVATION' : PLAN_TO_PRODUCT[modal.target as PlanId]
    setCheckoutLoading(method)
    try {
      const res = await window.electronAPI.payment.checkout(productType, provider, claudeAccountId || undefined)
      if (res.status === 200 || res.status === 201) {
        const data = res.data as { checkoutUrl?: string; instant?: boolean; success?: boolean; existing?: boolean; previousPlan?: string; newPlan?: string; proratedPrice?: number }
        if (data.success && !data.checkoutUrl && (data.instant || data.proratedPrice === 0)) {
          track(EVENTS.SUBSCRIPTION_UPGRADED, { from: data.previousPlan, to: data.newPlan, instant: true })
          setModal({ step: 'upgrade-success', previousPlan: data.previousPlan || '', newPlan: data.newPlan || '', proratedPrice: data.proratedPrice || 0 })
          onRefresh()
          return
        }
        if (data.checkoutUrl) {
          track(EVENTS.CHECKOUT_CREATED, { provider, productType, existing: !!data.existing })
          onRefresh()
          window.open(data.checkoutUrl, '_blank')
          setModal(null)
        } else {
          setModal({ step: 'error', message: t.plan.checkoutError })
        }
      } else {
        const errData = res.data as { message?: string } | undefined
        setModal({ step: 'error', message: typeof errData === 'object' && errData?.message ? errData.message : t.plan.checkoutError })
      }
    } catch {
      setModal({ step: 'error', message: t.plan.checkoutError })
    } finally {
      setCheckoutLoading(null)
    }
  }, [modal, claudeAccountId, t, onRefresh])

  const handleRedeemSubmit = useCallback(async () => {
    if (!claudeAccountId) { setModal({ step: 'error', message: t.plan.redeemCodeMissingAccount }); return }
    const code = redeemCode.trim()
    if (!code) return
    setRedeemLoading(true)
    try {
      const res = await window.electronAPI.payment.redeemCode(code, claudeAccountId)
      if (res.status >= 200 && res.status < 300) {
        const data = res.data as { productType?: string; expireAt?: string }
        await onRefresh()
        setRedeemCode('')
        setModal({ step: 'redeem-success', productType: data.productType || 'STANDARD', expireAt: data.expireAt || new Date().toISOString() })
      } else {
        const errData = res.data as { message?: string } | undefined
        setModal({ step: 'error', message: typeof errData === 'object' && errData?.message ? errData.message : t.plan.checkoutError })
      }
    } catch {
      setModal({ step: 'error', message: t.plan.checkoutError })
    } finally {
      setRedeemLoading(false)
    }
  }, [claudeAccountId, onRefresh, redeemCode, t])

  const handleOpenRedeem = useCallback((target: PaymentTarget) => {
    if (!claudeAccountId) { setModal({ step: 'error', message: t.plan.redeemCodeMissingAccount }); return }
    setRedeemCode('')
    setModal({ step: 'redeem', target })
  }, [claudeAccountId, t])

  const handleBuyActivation = () => { setModal({ step: 'payment', target: 'activation' as PlanId }) }

  const planLabel = (id: PlanId) => t.plan.plans[id]
  const hasPaidPlan = currentPlan !== 'free'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="max-w-[560px] w-full mx-auto py-8 px-6">
        {/* Back */}
        {onBack && (
          <button onClick={onBack} className="text-[13px] text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none mb-6">
            {t.plan.back}
          </button>
        )}

        {/* Account Info (paid users) */}
        {hasPaidPlan && (
          <div className="rounded-xl border border-border bg-bg-card p-5 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg text-text">{t.plan.currentPlan}</h2>
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
                <p className="text-text-secondary truncate" title={userEmail}>{userEmail}</p>
              </div>
              <div className="shrink-0">
                <p className="text-text-faint text-xs font-mono mb-1">{t.plan.currentPlan}</p>
                <p className="text-brand font-medium">{planLabel(currentPlan)}</p>
              </div>
              <div className="shrink-0">
                <p className="text-text-faint text-xs font-mono mb-1">{t.plan.expiresAt}</p>
                <p className="text-text-secondary">{expiresAt || '—'}</p>
              </div>
            </div>

            {/* Activation row */}
            <div className="border-t border-border mt-4 pt-4 flex items-center gap-6">
              <h3 className="text-sm font-medium text-text shrink-0">{t.plan.activationTitle}</h3>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-text-faint text-xs font-mono">{t.plan.activationRemaining}</span>
                <span className="text-brand font-semibold">{activationBalance ?? '—'}</span>
              </div>
              <button onClick={handleBuyActivation} className="text-xs px-3 py-1.5 rounded-lg bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
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
            </div>
          </div>
        )}

        {/* Plan Cards */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-serif text-lg text-text">{t.plan.choosePlan}</h2>
          {!hasPaidPlan && (
            <button
              onClick={() => setShowTickets(true)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-border-strong text-text-muted hover:text-brand hover:border-brand/40 cursor-pointer transition-colors bg-transparent"
            >
              {t.ticket.button}
            </button>
          )}
        </div>
        <div className="flex justify-center">
          {PLAN_ORDER.map((id) => {
            const isCurrent = id === currentPlan
            const price = PLAN_PRICES[id]
            const features = PLAN_FEATURES[id]
            const targetTier = PLAN_TIERS[id]
            const currentTier = PLAN_TIERS[currentPlan]
            const isHigher = targetTier > currentTier
            const isLower = targetTier < currentTier

            const isPaying = accountStatus === 'WAIT_FOR_USER_PAYING'
            const pendingOrder = isPaying ? orders.find(o => o.status === 'PENDING' && o.productType === PLAN_TO_PRODUCT[id]) : null
            const disableAll = isPaying && !pendingOrder

            return (
              <div
                key={id}
                className={`rounded-xl border p-4 flex flex-col transition-colors max-w-xs w-full ${
                  isCurrent ? 'border-brand bg-brand/[0.04]' : 'border-border bg-bg-card hover:border-brand/40'
                }`}
              >
                <p className="text-xs font-mono text-text-faint mb-1 text-center">{planLabel(id)}</p>
                <div className="flex items-center justify-center gap-2 mb-0.5">
                  <span className="text-sm text-text-faint line-through">{CURRENCY}20</span>
                  <span className="text-2xl font-semibold text-text">{CURRENCY}{price}</span>
                  <span className="text-[10px] bg-brand/10 text-brand px-1.5 py-0.5 rounded-full font-medium">-50%</span>
                </div>
                <p className="text-[10px] text-text-faint text-center mb-3">{t.plan.serviceFee}</p>

                {/* Features */}
                <div className="space-y-1.5 mb-4 text-[11px] text-text-muted">
                  <div className="flex justify-between">
                    <span className="text-text-faint">{t.plan.ipType}</span>
                    <span>{(t.plan as any)[features.ipKey]}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-faint">{t.plan.activations}</span>
                    <span>{features.activations}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-faint">{t.plan.devices}</span>
                    <span>{features.devices}</span>
                  </div>
                </div>

                {/* Action button */}
                <div className="mt-auto">
                  {isCurrent ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="text-xs text-brand font-medium">{t.plan.current}</span>
                      <button
                        onClick={() => setModal({ step: 'payment', target: id })}
                        className="w-full py-1.5 rounded-lg text-[11px] font-medium cursor-pointer transition-opacity hover:opacity-90 bg-brand text-white"
                      >
                        {t.plan.renewSubscription}
                      </button>
                    </div>
                  ) : isCurrent ? (
                    <span className="text-xs text-brand font-medium py-1.5 block text-center">{t.plan.current}</span>
                  ) : isPaying && pendingOrder ? (
                    <button
                      onClick={() => handleContinuePayment(id, pendingOrder.paymentProvider)}
                      disabled={!!checkoutLoading}
                      className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 bg-amber-500 text-white disabled:opacity-50"
                    >
                      {checkoutLoading ? '...' : t.plan.continuePaying}
                    </button>
                  ) : isHigher && !disableAll ? (
                    <button
                      onClick={() => handleSelect(id)}
                      className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 bg-brand text-white"
                    >
                      {t.plan.upgrade}
                    </button>
                  ) : isLower || disableAll ? (
                    <span className="w-full py-2 rounded-lg text-xs font-medium text-center text-text-faint opacity-40 block">
                      {isLower ? '—' : t.plan.upgrade}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSelect(id)}
                      className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 bg-brand text-white"
                    >
                      {t.plan.upgrade}
                    </button>
                  )}
                </div>
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
                      <td className="py-2.5 px-4 text-text-secondary">{order.createdAt.split('T')[0]}</td>
                      <td className="py-2.5 px-4 text-text">{t.plan.productTypes[order.productType] || order.productType}</td>
                      <td className="py-2.5 px-4 text-text text-right">${(order.price / 100).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-text-secondary text-[12px]">{
                        order.paymentProvider === 'LEMONSQUEEZY' ? 'Stripe' :
                        order.paymentProvider === 'HELIO' ? 'Crypto' :
                        order.paymentProvider === 'REDEEM_CODE' ? t.plan.payRedeem :
                        order.paymentProvider
                      }</td>
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

      {/* Ticket Panel */}
      <AnimatePresence>
        {showTickets && <TicketPanel onClose={() => setShowTickets(false)} />}
      </AnimatePresence>

      {/* Modals */}
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
                    .replace('{price}', String(PLAN_PRICES[modal.target]))}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors">
                    {t.plan.cancel}
                  </button>
                  <button onClick={handleConfirm} className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
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
                  <button onClick={() => setModal(null)} disabled={!!checkoutLoading} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-50">
                    {t.plan.cancel}
                  </button>
                  <button onClick={handleOverrideConfirm} disabled={!!checkoutLoading} className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50">
                    {checkoutLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t.plan.confirmOverride}
                      </span>
                    ) : t.plan.confirmOverride}
                  </button>
                </div>
              </>
            )}

            {/* Payment method selection (3 options: Stripe, Crypto, Redeem) */}
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
                  <button
                    onClick={() => handleOpenRedeem(modal.target)}
                    disabled={!!checkoutLoading}
                    className="w-full py-3 rounded-lg text-sm border border-border-strong cursor-pointer hover:border-brand/40 hover:bg-brand/[0.03] transition-colors text-left px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="font-medium text-text">{t.plan.payRedeem}</span>
                    <br />
                    <span className="text-[11px] text-text-faint">{t.plan.payRedeemDesc}</span>
                  </button>
                </div>
                <button onClick={() => setModal(null)} disabled={!!checkoutLoading} className="w-full py-2 rounded-lg text-sm text-text-muted cursor-pointer hover:text-text-secondary transition-colors disabled:opacity-50">
                  {t.plan.cancel}
                </button>
              </>
            )}

            {/* Redeem code */}
            {modal.step === 'redeem' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.redeemCodeTitle}</h3>
                <p className="text-sm text-text-muted mb-5">{t.plan.redeemCodeDesc}</p>
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                  placeholder={t.plan.redeemCodePlaceholder}
                  className="w-full px-3 py-2.5 border border-border rounded-lg text-[13px] bg-bg-card text-text outline-none focus:border-brand transition-colors font-mono uppercase"
                />
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setModal(null)} disabled={redeemLoading} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-50">
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleRedeemSubmit}
                    disabled={redeemLoading || !redeemCode.trim() || !claudeAccountId}
                    className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {redeemLoading ? t.plan.redeemCodeSubmitting : t.plan.redeemCodeSubmit}
                  </button>
                </div>
              </>
            )}

            {/* Redeem success */}
            {modal.step === 'redeem-success' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.redeemCodeSuccessTitle}</h3>
                <p className="text-sm text-text-muted mb-5">
                  {t.plan.redeemCodeSuccessDesc
                    .replace('{plan}', t.plan.productTypes[modal.productType] || modal.productType)
                    .replace('{date}', modal.expireAt.split('T')[0])}
                </p>
                <button onClick={() => setModal(null)} className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
                  {t.plan.ok}
                </button>
              </>
            )}

            {/* Waiting for checkout */}
            {modal.step === 'waiting' && (
              <div className="flex flex-col items-center py-4">
                <div className="w-6 h-6 border-2 border-brand/30 border-t-brand rounded-full animate-spin mb-4" />
                <h3 className="font-serif text-base text-text mb-2">{t.plan.waitingTitle}</h3>
                <p className="text-sm text-text-muted text-center">{t.plan.waitingDesc}</p>
              </div>
            )}

            {/* Upgrade success */}
            {modal.step === 'upgrade-success' && (
              <div className="flex flex-col items-center py-4">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.upgradeSuccessTitle}</h3>
                <p className="text-sm text-text-muted text-center mb-1">
                  {t.plan.upgradeSuccessDesc
                    .replace('{from}', t.plan.productTypes[modal.previousPlan] || modal.previousPlan)
                    .replace('{to}', t.plan.productTypes[modal.newPlan] || modal.newPlan)}
                </p>
                {modal.proratedPrice > 0 && (
                  <p className="text-xs text-text-faint mb-4">
                    {t.plan.upgradeProrated.replace('{amount}', `$${(modal.proratedPrice / 100).toFixed(2)}`)}
                  </p>
                )}
                <button onClick={() => { setModal(null); onRefresh() }} className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity mt-2">
                  {t.plan.ok}
                </button>
              </div>
            )}

            {/* Activation confirm */}
            {modal.step === 'activate-confirm' && (
              <>
                <h3 className="font-serif text-base text-text mb-2">{t.plan.activateConfirmTitle}</h3>
                <p className="text-sm text-text-muted mb-5">{t.plan.activateConfirmDesc}</p>
                <div className="flex gap-3">
                  <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors">
                    {t.plan.cancel}
                  </button>
                  <button onClick={handleActivateConfirm} className="flex-1 py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
                    {t.plan.confirm}
                  </button>
                </div>
              </>
            )}

            {/* Activation flow */}
            {modal.step === 'activate' && (
              <>
                <h3 className="font-serif text-base text-text mb-4">{t.plan.activateTitle}</h3>

                {modal.phase === 'loading' && (
                  <div className="flex flex-col items-center py-6">
                    <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin mb-3" />
                    <p className="text-sm text-text-muted">{t.plan.activateRequesting}</p>
                  </div>
                )}

                {modal.phase === 'polling' && (
                  <div>
                    <div className="rounded-lg border border-border bg-bg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activatePhone}</span>
                        <span className="text-sm text-text font-semibold font-mono">+{modal.sms.countryCode} {modal.sms.number}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activateStatus}</span>
                        <span className="flex items-center gap-1.5 text-xs text-amber-500">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          {t.plan.activateWaiting}
                          {smsCooldown > 0 && (
                            <span className="text-text-faint ml-1">({Math.floor(smsCooldown / 60)}:{(smsCooldown % 60).toString().padStart(2, '0')})</span>
                          )}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-text-faint mb-4 text-center">{t.plan.activateWaitingDesc}</p>
                    <div className="flex gap-3">
                      <button onClick={handleRefreshNumber} disabled={smsCooldown > 0} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-secondary cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {t.plan.activateRefresh}
                      </button>
                      <button onClick={handleRefundNumber} disabled={smsCooldown > 0} className="flex-1 py-2 rounded-lg text-sm border border-border-strong text-text-muted cursor-pointer hover:bg-black/[0.03] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {t.plan.activateRefund}
                      </button>
                    </div>
                  </div>
                )}

                {modal.phase === 'done' && (
                  <div>
                    <div className="rounded-lg border border-border bg-bg p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activatePhone}</span>
                        <span className="text-sm text-text font-semibold font-mono">+{modal.sms.countryCode} {modal.sms.number}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-faint font-mono">{t.plan.activateCode}</span>
                        <span className="text-lg text-brand font-bold font-mono tracking-wider">{modal.sms.code}</span>
                      </div>
                    </div>
                    <button onClick={handleActivateClose} className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
                      {t.plan.ok}
                    </button>
                  </div>
                )}

                {modal.phase === 'error' && (
                  <div>
                    <p className="text-sm text-red-500 mb-4">{modal.errorMsg}</p>
                    <button onClick={handleActivateClose} className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
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
                <button onClick={() => setModal(null)} className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity">
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
