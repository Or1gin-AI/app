import { useState, useEffect, useCallback } from 'react'
import { useLocale } from '@/i18n/context'
import { VscGlobe, VscSettingsGear, VscArrowRight, VscLoading } from 'react-icons/vsc'
import { PiWarningBold, PiCheckCircleBold, PiWifiHighBold } from 'react-icons/pi'

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

type View = 'detecting' | 'result' | 'proxy-mode' | 'proxy-manual' | 'optimizing'

function getPurity(info: IpInfo): 'clean' | 'proxy' | 'datacenter' {
  if (info.isProxy) return 'proxy'
  if (info.isHosting) return 'datacenter'
  return 'clean'
}

export function NetworkSetupPage({ onComplete }: NetworkSetupPageProps) {
  const { t } = useLocale()
  const [view, setView] = useState<View>('detecting')
  const [ipInfo, setIpInfo] = useState<IpInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState(0)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)

  // Pre-proxy state
  const [preProxyHost, setPreProxyHost] = useState('127.0.0.1')
  const [preProxyPort, setPreProxyPort] = useState('7890')
  const [_lastProxyAddr, setLastProxyAddr] = useState('')

  // Detect IP on mount
  useEffect(() => {
    let cancelled = false
    window.electronAPI.checkIp().then((res) => {
      if (cancelled) return
      if (res.error) {
        setError(res.error)
        setView('result')
      } else {
        setIpInfo(res as IpInfo)
        setView('result')
      }
    })
    return () => { cancelled = true }
  }, [])

  const startOptimize = useCallback(async (proxyAddr: string) => {
    setLastProxyAddr(proxyAddr)
    setView('optimizing')
    setProgress(0)
    setStep(0)
    setOptimizeError(null)

    // Step 0: detect (already done)
    setStep(0)
    setProgress(15)

    // Step 1: start xray
    setStep(1)
    setProgress(30)
    const startResult = await window.electronAPI.sidecar.start(proxyAddr)
    if (!startResult.ok) {
      setOptimizeError(startResult.error || 'Failed to start proxy')
      return
    }
    setProgress(60)

    // Step 2: verify connection through proxy
    setStep(2)
    setProgress(70)
    const verifyResult = await window.electronAPI.sidecar.verify()
    console.log('*************************************8')
    console.log(verifyResult)
    if (!verifyResult.ok) {
      setOptimizeError(verifyResult.error || 'Connection verification failed')
      return
    }
    setProgress(90)

    // Step 3: done
    setStep(3)
    setProgress(100)
  }, [])

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

  // --- Handlers for proxy modes ---

  const handleAutoProxy = useCallback(async () => {
    const sys = await window.electronAPI.detectSystemProxy()
    if (sys.found && sys.host && sys.port) {
      startOptimize(`${sys.host}:${sys.port}`)
    } else {
      // No system proxy found — if overseas, use direct; otherwise go manual
      if (ipInfo && !ipInfo.isChina) {
        startOptimize('direct')
      } else {
        setPreProxyHost('127.0.0.1')
        setPreProxyPort('7890')
        setView('proxy-manual')
      }
    }
  }, [ipInfo, startOptimize])

  const handleDirect = useCallback(() => {
    startOptimize('direct')
  }, [startOptimize])

  const handleManualSubmit = useCallback(() => {
    startOptimize(`${preProxyHost}:${preProxyPort}`)
  }, [preProxyHost, preProxyPort, startOptimize])

  // ============================================================
  // VIEWS
  // ============================================================

  // --- Detecting ---
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

  // --- Result ---
  if (view === 'result') {
    if (error || !ipInfo) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
          <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mb-5">
            <PiWarningBold size={24} className="text-yellow-500" />
          </div>
          <h2 className="font-serif text-xl text-text mb-1.5">{t.network.detectFailed}</h2>
          <p className="text-[13px] text-text-muted mb-5">{error || 'Unknown error'}</p>
          <button
            onClick={() => {
              setView('detecting')
              setError(null)
              window.electronAPI.checkIp().then((res) => {
                if (res.error) { setError(res.error); setView('result') }
                else { setIpInfo(res as IpInfo); setView('result') }
              })
            }}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.network.retry}
          </button>
        </div>
      )
    }

    const isChina = ipInfo.isChina
    const purity = getPurity(ipInfo)
    const locationStr = `${ipInfo.country} \u00B7 ${ipInfo.city}`

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${
            isChina ? 'bg-red-500/10' : 'bg-green-500/10'
          }`}
        >
          <VscGlobe size={24} className={isChina ? 'text-red-500' : 'text-green-500'} />
        </div>

        <h2 className="font-serif text-xl text-text mb-1.5">
          {isChina ? t.network.titleChina : t.network.titleOverseas}
        </h2>
        <p className="text-[13px] text-text-muted mb-5 text-center leading-relaxed">
          {isChina ? t.network.descChina : t.network.descOverseas}
        </p>

        {/* IP info card */}
        <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] text-text-faint font-mono mb-0.5">{t.network.exitIp}</div>
              <div className="text-[15px] text-text font-mono font-medium">{ipInfo.ip}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-text-faint font-mono mb-0.5">{t.network.location}</div>
              <div className="flex items-center gap-1.5">
                <div className={`w-[7px] h-[7px] rounded-full ${
                  isChina ? 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]' : 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
                }`} />
                <span className="text-[13px] text-text-secondary font-mono">{locationStr}</span>
              </div>
            </div>
          </div>
          <div className="border-t border-border mb-3" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] font-mono">
            <div><span className="text-text-faint">ISP </span><span className="text-text-secondary">{ipInfo.isp}</span></div>
            <div><span className="text-text-faint">ASN </span><span className="text-text-secondary">{ipInfo.as?.split(' ')[0]}</span></div>
            <div><span className="text-text-faint">{t.network.org} </span><span className="text-text-secondary">{ipInfo.org || '-'}</span></div>
            <div><span className="text-text-faint">{t.network.type} </span><span className="text-text-secondary">{ipInfo.isMobile ? t.network.typeMobile : t.network.typeFixed}</span></div>
          </div>
          <div className="border-t border-border mt-3 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-faint font-mono">{t.network.purity}</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-[7px] h-[7px] rounded-full ${
                  purity === 'clean' ? 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
                    : purity === 'proxy' ? 'bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.4)]'
                    : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]'
                }`} />
                <span className={`text-[12px] font-mono font-medium ${
                  purity === 'clean' ? 'text-green-600' : purity === 'proxy' ? 'text-yellow-600' : 'text-red-500'
                }`}>
                  {purity === 'clean' ? t.network.purityClean : purity === 'proxy' ? t.network.purityProxy : t.network.purityDC}
                </span>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => setView('proxy-mode')}
          className="px-8 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity flex items-center gap-2"
        >
          <VscArrowRight size={15} />
          {t.network.startOptimize}
        </button>
      </div>
    )
  }

  // --- Proxy mode selection (3 cards) ---
  if (view === 'proxy-mode') {
    const options = [
      {
        key: 'auto',
        label: t.network.proxyAuto,
        desc: t.network.proxyAutoDesc,
        icon: <VscArrowRight size={16} className="text-brand" />,
        onClick: handleAutoProxy,
      },
      {
        key: 'manual',
        label: t.network.proxyManual,
        desc: t.network.proxyManualDesc,
        icon: <VscSettingsGear size={16} className="text-brand" />,
        onClick: () => setView('proxy-manual'),
      },
      {
        key: 'direct',
        label: t.network.proxyDirect,
        desc: t.network.proxyDirectDesc,
        icon: <PiWifiHighBold size={16} className="text-brand" />,
        onClick: handleDirect,
      },
    ]

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center mb-5">
          <VscSettingsGear size={24} className="text-brand" />
        </div>

        <h2 className="font-serif text-xl text-text mb-1.5">{t.network.proxyTitle}</h2>
        <p className="text-[13px] text-text-muted mb-6 text-center leading-relaxed">
          {t.network.proxySubtitle}
        </p>

        <div className="w-full max-w-[380px] flex flex-col gap-2.5">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={opt.onClick}
              className="w-full flex items-center gap-3.5 p-3.5 bg-bg-card rounded-xl border border-border hover:border-brand/40 transition-colors cursor-pointer text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-bg-alt flex items-center justify-center shrink-0">
                {opt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text font-medium">{opt.label}</div>
                <div className="text-[11px] text-text-muted mt-0.5">{opt.desc}</div>
              </div>
              <VscArrowRight size={14} className="text-text-faint shrink-0" />
            </button>
          ))}
        </div>

        <button
          onClick={() => setView('result')}
          className="mt-4 text-[12px] text-text-faint hover:text-text-muted transition-colors cursor-pointer"
        >
          {t.network.back}
        </button>
      </div>
    )
  }

  // --- Manual proxy input ---
  if (view === 'proxy-manual') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center mb-5">
          <VscSettingsGear size={24} className="text-brand" />
        </div>

        <h2 className="font-serif text-xl text-text mb-1.5">{t.network.manualTitle}</h2>
        <p className="text-[13px] text-text-muted mb-6 text-center">{t.network.manualSubtitle}</p>

        <div className="w-full max-w-[340px]">
          <label className="block text-xs text-text-secondary mb-1.5 font-mono">{t.network.preProxy}</label>
          <div className="flex gap-2.5 mb-2">
            <div className="flex-1">
              <input
                type="text"
                value={preProxyHost}
                onChange={(e) => setPreProxyHost(e.target.value)}
                placeholder="127.0.0.1"
                className="w-full px-3.5 py-2.5 border border-border-strong rounded-lg text-sm bg-bg-card text-text outline-none focus:border-brand transition-colors font-mono"
              />
            </div>
            <div className="w-[100px]">
              <input
                type="text"
                value={preProxyPort}
                onChange={(e) => setPreProxyPort(e.target.value.replace(/\D/g, ''))}
                placeholder="7890"
                className="w-full px-3.5 py-2.5 border border-border-strong rounded-lg text-sm bg-bg-card text-text outline-none focus:border-brand transition-colors font-mono"
              />
            </div>
          </div>
          <p className="text-[11px] text-text-faint mb-5">{t.network.preProxyHint}</p>

          <button
            onClick={handleManualSubmit}
            className="w-full py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.network.manualConnect}
          </button>

          <button
            onClick={() => setView('proxy-mode')}
            className="w-full mt-3 text-[12px] text-text-faint hover:text-text-muted transition-colors cursor-pointer text-center"
          >
            {t.network.back}
          </button>
        </div>
      </div>
    )
  }

  // --- Optimizing ---
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

      {!optimizeError && (
        <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-5 mb-4">
          <div className="mb-3.5">
            <div className="flex justify-between text-[11px] text-text-muted mb-1.5 font-mono">
              <span>{t.network.configuring}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-[3px] bg-bg-alt rounded-full overflow-hidden">
              <div className="h-full bg-brand rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="text-[11px] text-text-faint font-mono leading-[1.8]">
            {steps.map((label, i) => (
              <div key={i}>{stepIcon(i)} {label}</div>
            ))}
          </div>
        </div>
      )}

      {optimizeError ? (
        <button
          onClick={() => setView('proxy-mode')}
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
