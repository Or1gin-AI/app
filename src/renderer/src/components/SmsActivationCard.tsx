import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/context'
import { track, EVENTS } from '@/lib/telemetry'

interface SmsActivationCardProps {
  claudeAccountId: string
  hasPaidPlan: boolean
  networkOk: boolean
}

type Notice = { type: 'success' | 'error'; message: string } | null

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
  | { step: 'activate-confirm' }
  | { step: 'activate'; phase: 'loading' | 'polling' | 'done' | 'error'; sms: SmsData; errorMsg?: string }

export function SmsActivationCard({
  claudeAccountId,
  hasPaidPlan,
  networkOk,
}: SmsActivationCardProps): React.JSX.Element | null {
  const { t } = useLocale()
  const [notice, setNotice] = useState<Notice>(null)
  const [activationBalance, setActivationBalance] = useState<number | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [smsCooldownEnd, setSmsCooldownEnd] = useState(0)
  const [smsCooldown, setSmsCooldown] = useState(0)
  const smsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const smsCooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const hasAccount = Boolean(claudeAccountId)

  const showNotice = useCallback((type: Notice['type'], message: string) => {
    setNotice({ type, message })
  }, [])

  const refreshBalance = useCallback(() => {
    if (!hasPaidPlan) {
      setActivationBalance(0)
      return
    }

    window.electronAPI.auth.profile()
      .then((res) => {
        if (res.status >= 200 && res.status < 300) {
          const data = res.data as { smsVerificationBalance?: number }
          setActivationBalance(data.smsVerificationBalance ?? 0)
        }
      })
      .catch(() => {})
  }, [hasPaidPlan])

  useEffect(() => {
    refreshBalance()
  }, [refreshBalance])

  const stopSmsPoll = useCallback(() => {
    if (smsPollRef.current) {
      clearInterval(smsPollRef.current)
      smsPollRef.current = null
    }
  }, [])

  useEffect(() => () => stopSmsPoll(), [stopSmsPoll])

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
      if (smsCooldownTimerRef.current) {
        clearInterval(smsCooldownTimerRef.current)
        smsCooldownTimerRef.current = null
      }
    }
  }, [smsCooldownEnd])

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
      } catch {
        // Keep polling in background.
      }
    }, 10_000)
  }, [stopSmsPoll, t])

  const handleActivateEntry = useCallback(async () => {
    setNotice(null)

    if (!hasAccount) {
      showNotice('error', t.plan.activationNeedAccount)
      return
    }
    if (!hasPaidPlan) {
      showNotice('error', t.plan.activationNeedPlan)
      return
    }
    if (!networkOk) {
      showNotice('error', t.plan.activateNeedNetwork)
      return
    }

    try {
      const existing = await window.electronAPI.sms.phoneNumber()
      if (existing.status >= 200 && existing.status < 300) {
        const sms = existing.data as SmsData
        setModal({ step: 'activate', phase: 'polling', sms })
        startSmsPoll()
        return
      }
    } catch {
      // Ignore and continue to confirmation.
    }

    setModal({ step: 'activate-confirm' })
  }, [hasAccount, hasPaidPlan, networkOk, showNotice, startSmsPoll, t])

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
          setModal({
            step: 'activate',
            phase: 'error',
            sms: {},
            errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError,
          })
          return
        }
        sms = res.data as SmsData
        isNew = true
      }

      setModal({ step: 'activate', phase: 'polling', sms })
      if (isNew) {
        setSmsCooldownEnd(Date.now() + 120_000)
      }
      startSmsPoll()
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [startSmsPoll, t])

  const handleRefreshNumber = useCallback(async () => {
    track(EVENTS.SMS_NUMBER_REFRESHED)
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
          step: 'activate',
          phase: 'error',
          sms: {},
          errorMsg: typeof errData === 'object' && errData?.message ? errData.message : t.plan.activateError,
        })
      }
    } catch {
      setModal({ step: 'activate', phase: 'error', sms: {}, errorMsg: t.plan.activateError })
    }
  }, [startSmsPoll, stopSmsPoll, t])

  const handleRefundNumber = useCallback(async () => {
    track(EVENTS.SMS_REFUNDED)
    stopSmsPoll()
    await window.electronAPI.sms.refund().catch(() => {})
    setSmsCooldownEnd(0)
    refreshBalance()
    setModal(null)
  }, [refreshBalance, stopSmsPoll])

  const handleActivateClose = useCallback(() => {
    refreshBalance()
    setModal(null)
  }, [refreshBalance])

  if (!hasPaidPlan) return null

  return (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-card/95 px-4 py-2.5 shadow-sm backdrop-blur-sm">
        <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-faint">
          {t.plan.activationSectionTitle}
        </span>
        <span className="text-sm font-semibold text-text font-mono">
          {activationBalance ?? '—'}
        </span>
        <button
          onClick={handleActivateEntry}
          disabled={!hasAccount || !activationBalance || activationBalance <= 0}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.plan.activationActivate}
        </button>
        {notice && (
          <span className={`text-[11px] ${notice.type === 'error' ? 'text-red-500' : 'text-green-600'}`}>
            {notice.message}
          </span>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-[340px] rounded-xl border border-border bg-bg p-6 shadow-lg">
            {modal.step === 'activate-confirm' && (
              <>
                <h3 className="mb-2 font-serif text-base text-text">{t.plan.activateConfirmTitle}</h3>
                <p className="mb-5 text-sm text-text-muted">{t.plan.activateConfirmDesc}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setModal(null)}
                    className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-text-secondary transition-colors hover:bg-black/[0.03]"
                  >
                    {t.plan.cancel}
                  </button>
                  <button
                    onClick={handleActivateConfirm}
                    className="flex-1 rounded-lg bg-brand py-2 text-sm text-white transition-opacity hover:opacity-90"
                  >
                    {t.plan.confirm}
                  </button>
                </div>
              </>
            )}

            {modal.step === 'activate' && (
              <>
                <h3 className="mb-4 font-serif text-base text-text">{t.plan.activateTitle}</h3>

                {modal.phase === 'loading' && (
                  <div className="flex flex-col items-center py-6">
                    <div className="mb-3 h-5 w-5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
                    <p className="text-sm text-text-muted">{t.plan.activateRequesting}</p>
                  </div>
                )}

                {modal.phase === 'polling' && (
                  <div>
                    <div className="mb-4 rounded-lg border border-border bg-bg-alt p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-mono text-text-faint">{t.plan.activatePhone}</span>
                        <span className="text-sm font-semibold text-text font-mono">
                          +{modal.sms.countryCode} {modal.sms.number}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-text-faint">{t.plan.activateStatus}</span>
                        <span className="flex items-center gap-1.5 text-xs text-amber-500">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                          {t.plan.activateWaiting}
                          {smsCooldown > 0 && (
                            <span className="ml-1 text-text-faint">
                              ({Math.floor(smsCooldown / 60)}:{(smsCooldown % 60).toString().padStart(2, '0')})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleRefreshNumber}
                        disabled={smsCooldown > 0}
                        className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-text-secondary transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t.plan.activateRefresh}
                      </button>
                      <button
                        onClick={handleRefundNumber}
                        disabled={smsCooldown > 0}
                        className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-text-muted transition-colors hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t.plan.activateRefund}
                      </button>
                    </div>
                  </div>
                )}

                {modal.phase === 'done' && (
                  <div>
                    <div className="mb-4 rounded-lg border border-border bg-bg-alt p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-mono text-text-faint">{t.plan.activatePhone}</span>
                        <span className="text-sm font-semibold text-text font-mono">
                          +{modal.sms.countryCode} {modal.sms.number}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-text-faint">{t.plan.activateCode}</span>
                        <span className="text-lg font-bold tracking-wider text-brand font-mono">{modal.sms.code}</span>
                      </div>
                    </div>
                    <button
                      onClick={handleActivateClose}
                      className="w-full rounded-lg bg-brand py-2 text-sm text-white transition-opacity hover:opacity-90"
                    >
                      {t.plan.ok}
                    </button>
                  </div>
                )}

                {modal.phase === 'error' && (
                  <div>
                    <p className="mb-4 text-sm text-red-500">{modal.errorMsg}</p>
                    <button
                      onClick={handleActivateClose}
                      className="w-full rounded-lg bg-brand py-2 text-sm text-white transition-opacity hover:opacity-90"
                    >
                      {t.plan.ok}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
