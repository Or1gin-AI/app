import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '@/i18n/context'
import { VscGlobe, VscArrowRight, VscLoading } from 'react-icons/vsc'
import { PiWarningBold, PiCheckCircleBold } from 'react-icons/pi'

interface NetworkSetupPageProps {
  onComplete: () => void
}

interface IpInfo {
  ip: string
  country: string
  countryCode: string
  region: string
  city: string
  isp: string
  org: string
  as: string
  isProxy: boolean
  isHosting: boolean
  isMobile: boolean
  isChina: boolean
}

interface SystemProxyInfo {
  found: boolean
  host?: string
  port?: string
}

type View = 'detecting' | 'result' | 'optimizing'

function getPurity(info: IpInfo): 'clean' | 'proxy' | 'datacenter' {
  if (info.isProxy) return 'proxy'
  if (info.isHosting) return 'datacenter'
  return 'clean'
}

function RequirementRow({
  label,
  ok,
  value,
}: {
  label: string
  ok: boolean
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-faint font-mono">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className={`w-[7px] h-[7px] rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className={`text-[12px] font-mono ${ok ? 'text-green-600' : 'text-red-500'}`}>{value}</span>
      </div>
    </div>
  )
}

export function NetworkSetupPage({ onComplete }: NetworkSetupPageProps) {
  const { t } = useLocale()
  const [view, setView] = useState<View>('detecting')
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [systemProxy, setSystemProxy] = useState<SystemProxyInfo>({ found: false })
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState(0)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  const detectEnvironment = useCallback(async () => {
    setView('detecting')
    setError(null)
    setIpInfo(null)
    setSystemProxy({ found: false })

    try {
      const [ipRes, proxyRes] = await Promise.all([
        window.electronAPI.checkIp(),
        window.electronAPI.detectSystemProxy(),
      ])

      setSystemProxy(proxyRes)
      if (ipRes.error) {
        setError(ipRes.error)
      } else {
        setIpInfo(ipRes as IpInfo)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setView('result')
    }
  }, [])

  useEffect(() => {
    void detectEnvironment()
  }, [detectEnvironment])

  const startOptimize = useCallback(async () => {
    if (!ipInfo || systemProxy.found || ipInfo.isChina) return

    setView('optimizing')
    setProgress(0)
    setStep(0)
    setOptimizeError(null)

    setStep(0)
    setProgress(15)

    setStep(1)
    setProgress(45)
    const startResult = await window.electronAPI.sidecar.start()
    if (!startResult.ok) {
      setOptimizeError(startResult.error || 'Failed to start proxy')
      return
    }

    setStep(2)
    setProgress(75)
    const verifyResult = await window.electronAPI.sidecar.verify()
    if (!verifyResult.ok) {
      await window.electronAPI.sidecar.stop().catch(() => {})
      setOptimizeError(verifyResult.error || 'Connection verification failed')
      return
    }

    setStep(3)
    setProgress(100)
  }, [ipInfo, systemProxy.found])

  const steps = [
    t.network.stepDetect,
    t.network.stepStart,
    t.network.stepVerify,
    t.network.stepDone,
  ]

  const stepIcon = (i: number) => {
    if (i < step) return '\u2713'
    if (i === step && !optimizeError) return '\u25CE'
    if (i === step && optimizeError) return '\u2717'
    return '\u25CB'
  }

  if (view === 'detecting') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center mb-5">
          <VscLoading size={24} className="text-brand animate-spin" />
        </div>
        <h2 className="font-serif text-xl text-text mb-1.5">{t.network.detecting}</h2>
        <p className="text-[13px] text-text-muted">{t.network.detectingDesc}</p>
      </div>
    )
  }

  if (view === 'result') {
    if (error || !ipInfo) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
          <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mb-5">
            <PiWarningBold size={24} className="text-yellow-500" />
          </div>
          <h2 className="font-serif text-xl text-text mb-1.5">{t.network.detectFailed}</h2>
          <p className="text-[13px] text-text-muted mb-5 text-center max-w-[380px]">
            {error || t.network.detectFailedDesc}
          </p>
          <button
            onClick={detectEnvironment}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.network.retry}
          </button>
        </div>
      )
    }

    const hasSystemProxy = systemProxy.found
    const canOptimize = !hasSystemProxy && !ipInfo.isChina
    const purity = getPurity(ipInfo)
    const locationStr = `${ipInfo.country} \u00B7 ${ipInfo.city}`
    const proxyValue = hasSystemProxy
      ? `${systemProxy.host || 'unknown'}:${systemProxy.port || 'unknown'}`
      : t.network.systemProxyOff

    let title = t.network.readyTitle
    let description = t.network.readyDesc

    if (hasSystemProxy) {
      title = t.network.systemProxyTitle
      description = ipInfo.isChina ? t.network.systemProxyTunDesc : t.network.systemProxyDesc
    } else if (ipInfo.isChina) {
      title = t.network.tunRequiredTitle
      description = t.network.tunRequiredDesc
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${
          canOptimize ? 'bg-green-500/10' : 'bg-yellow-500/10'
        }`}>
          {canOptimize ? (
            <PiCheckCircleBold size={24} className="text-green-500" />
          ) : (
            <VscGlobe size={24} className="text-yellow-500" />
          )}
        </div>

        <h2 className="font-serif text-xl text-text mb-1.5">{title}</h2>
        <p className="text-[13px] text-text-muted mb-5 text-center leading-relaxed max-w-[420px]">
          {description}
        </p>

        <div className="w-full max-w-[400px] bg-bg-card rounded-xl border border-border p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] text-text-faint font-mono mb-0.5">{t.network.exitIp}</div>
              <div className="text-[15px] text-text font-mono font-medium">{ipInfo.ip}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-text-faint font-mono mb-0.5">{t.network.location}</div>
              <div className="flex items-center gap-1.5">
                <div className={`w-[7px] h-[7px] rounded-full ${
                  ipInfo.isChina ? 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]' : 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
                }`} />
                <span className="text-[13px] text-text-secondary font-mono">{locationStr}</span>
              </div>
            </div>
          </div>

          <div className="border-t border-border mb-3" />

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-mono mb-3">
            <div><span className="text-text-faint">ISP </span><span className="text-text-secondary">{ipInfo.isp || '-'}</span></div>
            <div><span className="text-text-faint">ASN </span><span className="text-text-secondary">{ipInfo.as?.split(' ')[0] || '-'}</span></div>
            <div><span className="text-text-faint">{t.network.org} </span><span className="text-text-secondary">{ipInfo.org || '-'}</span></div>
            <div><span className="text-text-faint">{t.network.type} </span><span className="text-text-secondary">{ipInfo.isMobile ? t.network.typeMobile : t.network.typeFixed}</span></div>
          </div>

          <div className="border-t border-border pt-3 space-y-2.5">
            <RequirementRow
              label={t.network.systemProxyLabel}
              ok={!hasSystemProxy}
              value={proxyValue}
            />
            <RequirementRow
              label={t.network.directRouteLabel}
              ok={!ipInfo.isChina}
              value={ipInfo.isChina ? t.network.routeChina : t.network.routeOverseas}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-faint font-mono">{t.network.purity}</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-[7px] h-[7px] rounded-full ${
                  purity === 'clean' ? 'bg-green-500'
                    : purity === 'proxy' ? 'bg-yellow-500'
                    : 'bg-red-500'
                }`} />
                <span className={`text-[12px] font-mono ${
                  purity === 'clean' ? 'text-green-600'
                    : purity === 'proxy' ? 'text-yellow-500'
                    : 'text-red-500'
                }`}>
                  {purity === 'clean' ? t.network.purityClean : purity === 'proxy' ? t.network.purityProxy : t.network.purityDC}
                </span>
              </div>
            </div>
          </div>
        </div>

        {!canOptimize && (
          <p className="text-[12px] text-amber-600 mb-4 text-center max-w-[400px]">
            {hasSystemProxy ? t.network.systemProxyHint : t.network.tunRequiredHint}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={detectEnvironment}
            className="px-6 py-2.5 bg-bg-card border border-border text-text-secondary rounded-lg text-sm cursor-pointer hover:border-brand/40 transition-colors"
          >
            {t.network.recheck}
          </button>
          <button
            onClick={startOptimize}
            disabled={!canOptimize}
            className="px-8 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <VscArrowRight size={15} />
            {t.network.startOptimize}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center mb-5">
        {optimizeError ? (
          <PiWarningBold size={24} className="text-red-500" />
        ) : progress >= 100 ? (
          <PiCheckCircleBold size={24} className="text-green-500" />
        ) : (
          <VscLoading size={24} className="text-brand animate-spin" />
        )}
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">
        {optimizeError ? t.network.optimizeFailed : progress >= 100 ? t.network.optimizeDone : t.network.optimizing}
      </h2>
      <p className="text-[13px] text-text-muted mb-7 text-center max-w-[380px]">
        {optimizeError ? t.network.optimizeFailedDesc : progress >= 100 ? t.network.optimizeDoneDesc : t.network.optimizingDesc}
      </p>

      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-5 mb-4">
        {!optimizeError && (
          <div className="mb-3.5">
            <div className="flex justify-between text-[11px] text-text-muted mb-1.5 font-mono">
              <span>{t.network.configuring}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-[3px] bg-bg-alt rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <div className="text-[11px] text-text-faint font-mono leading-[1.8]">
          {steps.map((label, i) => (
            <div key={i}>
              {stepIcon(i)} {label}
            </div>
          ))}
        </div>
        {optimizeError && (
          <p className="text-[11px] text-red-500 mt-3 break-all">{optimizeError}</p>
        )}
      </div>

      {optimizeError ? (
        <button
          onClick={detectEnvironment}
          className="px-8 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
        >
          {t.network.retry}
        </button>
      ) : progress >= 100 ? (
        <button
          onClick={onComplete}
          className="px-8 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
        >
          {t.network.optimizeDone}
        </button>
      ) : (
        <p className="text-[11px] text-text-faint">{t.network.autoRedirect}</p>
      )}
    </div>
  )
}
