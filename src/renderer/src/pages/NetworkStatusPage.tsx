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
  const [pacOk, setPacOk] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const [directRes, proxyRes, pacRes] = await Promise.all([
        window.electronAPI.checkLocalIp(),
        window.electronAPI.checkProxyIp(),
        window.electronAPI.sidecar.pacStatus()
      ])

      if (cancelled) return
      setLocalIp(directRes.ip)
      setProxyIp(proxyRes.ip)
      setProxyOk(proxyRes.ok)
      setPacOk(pacRes.running)
      setLoading(false)
    }

    check()
    return () => { cancelled = true }
  }, [])

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
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${proxyOk ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        {proxyOk ? <PiCheckCircleBold size={24} className="text-green-500" /> : <PiWarningBold size={24} className="text-red-500" />}
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">
        {proxyOk ? t.networkStatus.title : t.networkStatus.titleError}
      </h2>
      <p className="text-[13px] text-text-muted mb-6 text-center">
        {proxyOk ? t.networkStatus.desc : t.networkStatus.descError}
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
            <span className="text-text-faint text-[11px]">{t.networkStatus.pacStatus}</span>
            <span className={pacOk ? 'text-green-600' : 'text-red-500'}>
              {pacOk ? t.networkStatus.running : t.networkStatus.stopped}
            </span>
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.localIp}</span>
            <span className="text-text-secondary">{localIp || '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-faint text-[11px]">{t.networkStatus.proxyIp}</span>
            <span className={proxyOk ? 'text-green-600' : 'text-red-500'}>{proxyIp || '—'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {proxyOk ? (
          <>
            <button
              onClick={onBack}
              className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
            >
              {t.networkStatus.back}
            </button>
            <button
              onClick={onReconfigure}
              className="px-6 py-2.5 bg-bg-card border border-border text-text-secondary rounded-lg text-sm cursor-pointer hover:border-brand/40 transition-colors"
            >
              {t.networkStatus.reconfigure}
            </button>
          </>
        ) : (
          <button
            onClick={onReconfigure}
            className="px-6 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity"
          >
            {t.networkStatus.reconfigure}
          </button>
        )}
      </div>
    </div>
  )
}
