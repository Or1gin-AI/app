import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import QRCode from 'qrcode'
import { useLocale } from '@/i18n/context'
import { SmsActivationCard } from '@/components/SmsActivationCard'

interface MainPageProps {
  accountMode: string
  registered: boolean
  claudeAccountId: string
  hasPaidPlan: boolean
  networkOk: boolean
  onRefresh: () => Promise<unknown>
}

const tabTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2 },
}

interface GatewayInfo {
  lanHost: string
  port: number
  user: string
  pass: string
  expiresAt: string
}

function PhoneGatewayInline() {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [gateway, setGateway] = useState<GatewayInfo | null>(null)
  const [payload, setPayload] = useState<string | null>(null)
  const [clashUrl, setClashUrl] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [clashQr, setClashQr] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.electronAPI.phoneGateway.status().then((status) => {
      setEnabled(status.enabled)
      setGateway(status.gateway ?? null)
      setPayload(status.payload ?? null)
      setClashUrl(status.clashPayload ?? null)
    }).catch(() => {})
    return window.electronAPI.phoneGateway.onExpired(() => {
      setEnabled(false)
      setGateway(null)
      setPayload(null)
      setClashUrl(null)
    })
  }, [])

  useEffect(() => {
    if (!payload) { setQr(''); return }
    QRCode.toDataURL(payload, { margin: 1, width: 240, color: { dark: '#2c2520', light: '#ffffff' } })
      .then(setQr).catch(() => setQr(''))
  }, [payload])

  useEffect(() => {
    if (!clashUrl) { setClashQr(''); return }
    QRCode.toDataURL(clashUrl, { margin: 1, width: 240, color: { dark: '#2c2520', light: '#ffffff' } })
      .then(setClashQr).catch(() => setClashQr(''))
  }, [clashUrl])

  const errorText = (code?: string) => {
    if (code === 'network-not-ready') return t.main.phoneGateway.requiresNetwork
    return t.main.phoneGateway.error
  }

  const enableGateway = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.electronAPI.phoneGateway.enable()
      if (!result.ok) {
        setError(errorText(result.error))
        return
      }
      setEnabled(true)
      setGateway(result.gateway ?? null)
      setPayload(result.payload ?? null)
      setClashUrl(result.clashPayload ?? null)
    } finally {
      setBusy(false)
    }
  }

  const disableGateway = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.electronAPI.phoneGateway.disable()
      if (!result.ok) {
        setError(errorText(result.error))
        return
      }
      setEnabled(false)
      setGateway(null)
      setPayload(null)
    } finally {
      setBusy(false)
    }
  }

  const expires = gateway?.expiresAt
    ? new Date(gateway.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  if (!enabled) {
    return (
      <div className="mt-2">
        <button
          onClick={enableGateway}
          disabled={busy}
          className="w-full py-2 rounded-lg text-[12px] font-medium border border-border text-text-secondary bg-transparent hover:text-text hover:bg-bg-alt cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default"
        >
          {busy ? t.main.phoneGateway.enabling : t.main.phoneGateway.buttonLabel}
        </button>
        {error && <div className="text-[11px] leading-snug text-red-500 mt-2">{error}</div>}
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-3 rounded-xl border border-green-200 bg-green-50/50 p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[13px] font-semibold text-text">{t.main.phoneGateway.title}</div>
          <div className="text-[11px] text-text-muted leading-snug mt-0.5">{t.main.phoneGateway.desc}</div>
        </div>
        <button
          onClick={disableGateway}
          disabled={busy}
          className="shrink-0 px-3 py-1 rounded-lg border border-border text-[12px] text-text-secondary hover:text-text hover:bg-white cursor-pointer transition-colors disabled:opacity-60"
        >
          {t.main.phoneGateway.disable}
        </button>
      </div>
      <div className="text-[11px] text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5 mb-3 leading-snug">
        {t.main.phoneGateway.lanWarning}
      </div>

      {(qr || clashQr) && (
        <div className="mb-3">
          <div className="text-[12px] font-medium text-text mb-2">{t.main.phoneGateway.scan}</div>
          <div className="flex gap-3">
            {qr && (
              <div className="flex-1 text-center">
                <div className="rounded-lg border border-border bg-white p-2 mx-auto w-[130px]">
                  <img src={qr} alt="v2ray" className="w-full block" />
                </div>
                <div className="text-[11px] text-text-muted mt-1.5 leading-snug">{t.main.phoneGateway.scanApps}</div>
              </div>
            )}
            {clashQr && (
              <div className="flex-1 text-center">
                <div className="rounded-lg border border-border bg-white p-2 mx-auto w-[130px]">
                  <img src={clashQr} alt="clash" className="w-full block" />
                </div>
                <div className="text-[11px] text-text-muted mt-1.5 leading-snug">{t.main.phoneGateway.scanAppsClash}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {gateway && (
        <>
          <div className="text-[11px] text-text-muted mb-1.5">
            {t.main.phoneGateway.orManual}
            <span className="text-text-faint ml-1">({t.main.phoneGateway.manualHint})</span>
          </div>
          <div className="space-y-1 text-[11px] text-text-secondary rounded-lg bg-bg-alt/50 p-2.5">
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">{t.main.phoneGateway.endpoint}</span>
              <span className="font-mono text-text select-all">{gateway.lanHost}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">{t.main.phoneGateway.port}</span>
              <span className="font-mono text-text select-all">{gateway.port}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">{t.main.phoneGateway.username}</span>
              <span className="font-mono text-text select-all">{gateway.user}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-muted">{t.main.phoneGateway.password}</span>
              <span className="font-mono text-text select-all">{gateway.pass}</span>
            </div>
            <div className="flex justify-between gap-3 pt-1 border-t border-border/50">
              <span className="text-text-muted">{t.main.phoneGateway.expires}</span>
              <span className="font-mono text-text">{expires}</span>
            </div>
          </div>
        </>
      )}

      {error && <div className="text-[11px] leading-snug text-red-500 mt-2">{error}</div>}
    </motion.div>
  )
}

export function MainPage({ claudeAccountId, hasPaidPlan, networkOk }: MainPageProps) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<'web' | 'code'>('web')

  const webSteps = [
    <>{t.main.claudeWeb.step1}</>,
    <>{t.main.claudeWeb.step2Prefix}<strong className="font-semibold text-text">{t.main.claudeWeb.step2Bold}</strong>{t.main.claudeWeb.step2Suffix}</>,
    <>{t.main.claudeWeb.step3}</>,
    <>{t.main.claudeWeb.step4}</>,
  ]

  const handleGetGmail = () => {
    window.electronAPI.payment.openCheckout('https://pay.ldxp.cn/item/4p0oqt').catch(() => {})
  }

  const codeSteps = [
    <>{t.main.claudeCode.step1} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">claude login</code></>,
    <>{t.main.claudeCode.step2} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">{t.main.claudeCode.step2method}</code> {t.main.claudeCode.step2suffix}</>,
    <>{t.main.claudeCode.step3}</>,
    <>{t.main.claudeCode.step4}</>,
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-8 pt-5 pb-2">
        <div className="flex items-center gap-1 rounded-lg bg-bg-alt p-1">
          <button
            onClick={() => setActiveTab('web')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all cursor-pointer ${
              activeTab === 'web'
                ? 'bg-bg-card text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.main.claudeWeb.title}
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all cursor-pointer ${
              activeTab === 'code'
                ? 'bg-bg-card text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.main.claudeCode.title}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <SmsActivationCard
            claudeAccountId={claudeAccountId}
            hasPaidPlan={hasPaidPlan}
            networkOk={networkOk}
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'web' ? (
            <motion.div key="web" {...tabTransition} className="max-w-[420px] w-full">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-2">
                  {t.main.claudeWeb.label}
                </div>
                <h2 className="font-serif text-xl text-text mb-2">{t.main.claudeWeb.title}</h2>
                <p className="text-[13px] text-text-muted leading-relaxed">
                  {t.main.claudeWeb.desc} {t.main.claudeWeb.descLine2}
                </p>
              </div>

              {/* Steps */}
              <div className="text-[13px] text-text-secondary leading-relaxed mb-4 space-y-2.5">
                {webSteps.map((content, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-brand font-mono text-[12px] mt-[1px] shrink-0">{i + 1}.</span>
                    <span>{content}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleGetGmail}
                className="w-full py-2 rounded-lg text-[12px] font-medium border border-brand/30 text-brand bg-brand/[0.04] hover:bg-brand/[0.08] cursor-pointer transition-colors"
              >
                {t.main.claudeWeb.noGmailButton}
              </button>

              <PhoneGatewayInline />

            </motion.div>
          ) : (
            <motion.div key="code" {...tabTransition} className="max-w-[420px] w-full">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-2">
                  {t.main.claudeCode.label}
                </div>
                <h2 className="font-serif text-xl text-text mb-2">{t.main.claudeCode.title}</h2>
                <p className="text-[13px] text-text-muted leading-relaxed">
                  {t.main.claudeCode.desc} {t.main.claudeCode.descLine2}
                </p>
              </div>

              {/* Terminal warning */}
              <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-2.5 mb-6">
                <p className="text-[12px] text-red-500 leading-relaxed">{t.main.claudeCode.newTerminalWarning}</p>
              </div>

              {/* Steps */}
              <div className="text-[13px] text-text-secondary leading-relaxed space-y-2.5">
                {codeSteps.map((content, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-brand font-mono text-[12px] mt-[1px] shrink-0">{i + 1}.</span>
                    <span>{content}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
