import { useState, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { PiCheckCircleBold, PiWarningBold } from 'react-icons/pi'
import { VscLoading } from 'react-icons/vsc'

interface NetworkStatusPageProps {
  onBack: () => void
  onReconfigure: () => void
}

export function NetworkStatusPage({ onBack, onReconfigure }: NetworkStatusPageProps) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [proxyIp, setProxyIp] = useState<string | null>(null)
  const [proxyOk, setProxyOk] = useState(false)
  const [proxyPort, setProxyPort] = useState<number>(0)
  const [conflict, setConflict] = useState(false)
  const [showStopModal, setShowStopModal] = useState(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      // First check if sidecar is actually running — if not, nothing to show
      const statusRes = await window.electronAPI.sidecar.proxyStatus()
      if (!statusRes.running) {
        if (!cancelled) {
          setProxyOk(false)
          setLoading(false)
        }
        return
      }

      const [directRes, proxyRes] = await Promise.all([
        window.electronAPI.checkLocalIp(),
        window.electronAPI.checkProxyIp(),
      ])

      if (cancelled) return
      setLocalIp(directRes.ip)
      setProxyIp(proxyRes.ip)
      setProxyOk(proxyRes.ok)
      setProxyPort(statusRes.port)

      setLoading(false)
    }

    check()

    const unsub = window.electronAPI.proxy.onConflict(() => {
      setConflict(true)
    })

    return () => { cancelled = true; unsub() }
  }, [])

  const handleStopConfirm = async () => {
    setStopping(true)
    await window.electronAPI.sidecar.stop()
    setStopping(false)
    setShowStopModal(false)
    onReconfigure()
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
        <VscLoading size={24} className="text-brand animate-spin mb-4" />
        <p className="text-[13px] text-text-muted">{t.network.detecting}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${proxyOk && !conflict ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        {proxyOk && !conflict ? <PiCheckCircleBold size={24} className="text-green-500" /> : <PiWarningBold size={24} className="text-red-500" />}
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">
        {conflict ? t.networkStatus.titleConflict : proxyOk ? t.networkStatus.title : t.networkStatus.titleError}
      </h2>
      <p className="text-[13px] text-text-muted mb-6 text-center max-w-[380px]">
        {conflict ? t.networkStatus.descConflict : proxyOk ? t.networkStatus.desc : t.networkStatus.descError}
      </p>

      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-4 mb-6">
        <div className="grid grid-cols-1 gap-y-3 text-[12px] font-mono">
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.proxyStatus}</span>
            <span className={proxyOk ? 'text-green-600' : 'text-red-500'}>
              {proxyOk ? t.networkStatus.running : t.networkStatus.stopped}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.systemProxy}</span>
            <span className={conflict ? 'text-red-500' : 'text-green-600'}>
              {conflict ? t.networkStatus.hijacked : `127.0.0.1:${proxyPort}`}
            </span>
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.localIp}</span>
            <span className="text-text-secondary">{localIp || '\u2014'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.proxyIp}</span>
            <span className={proxyOk ? 'text-green-600' : 'text-red-500'}>{proxyIp || '\u2014'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {proxyOk && !conflict ? (
          <>
            <button
              onClick={onBack}
              className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.networkStatus.back}
            </button>
            <button
              onClick={() => setShowStopModal(true)}
              className="px-6 py-2.5 bg-bg-card border border-border text-text-secondary rounded-lg text-sm cursor-pointer hover:border-red-400/40 hover:text-red-500 transition-colors"
            >
              {t.networkStatus.stopOptimization}
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowStopModal(true)}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.networkStatus.stopOptimization}
          </button>
        )}
      </div>

      {showStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-bg-card rounded-2xl border border-border shadow-xl w-[360px] p-6">
            <h3 className="font-serif text-lg text-text mb-2">{t.networkStatus.stopModalTitle}</h3>
            <p className="text-[13px] text-text-muted mb-6 leading-relaxed">
              {t.networkStatus.stopModalDesc}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowStopModal(false)}
                disabled={stopping}
                className="px-5 py-2 bg-bg-alt border border-border text-text-secondary rounded-lg text-sm cursor-pointer hover:border-brand/40 transition-colors disabled:opacity-50"
              >
                {t.networkStatus.stopModalCancel}
              </button>
              <button
                onClick={handleStopConfirm}
                disabled={stopping}
                className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm font-medium cursor-pointer hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {stopping && <VscLoading size={14} className="animate-spin" />}
                {t.networkStatus.stopModalConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
