import { useState, useEffect } from 'react'
import { useLocale } from '@/i18n/context'
import { PiCheckCircleBold, PiWarningBold } from 'react-icons/pi'

interface NetworkStatusPageProps {
  networkOk: boolean
  exitIp: string | null
  onBack: () => void
  onReconfigure: () => void
}

export function NetworkStatusPage({ networkOk, exitIp, onBack, onReconfigure }: NetworkStatusPageProps) {
  const { t } = useLocale()
  const [sidecarRunning, setSidecarRunning] = useState(false)

  useEffect(() => {
    window.electronAPI.sidecar.status().then((s) => setSidecarRunning(s.running))
  }, [])

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-5 ${networkOk ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        {networkOk ? <PiCheckCircleBold size={24} className="text-green-500" /> : <PiWarningBold size={24} className="text-red-500" />}
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">
        {networkOk ? t.networkStatus.title : t.networkStatus.titleError}
      </h2>
      <p className="text-[13px] text-text-muted mb-6 text-center">
        {networkOk ? t.networkStatus.desc : t.networkStatus.descError}
      </p>

      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-4 mb-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12px] font-mono">
          <div>
            <p className="text-text-faint text-[11px] mb-0.5">{t.networkStatus.proxyStatus}</p>
            <p className={sidecarRunning ? 'text-green-600' : 'text-red-500'}>
              {sidecarRunning ? t.networkStatus.running : t.networkStatus.stopped}
            </p>
          </div>
          <div>
            <p className="text-text-faint text-[11px] mb-0.5">{t.networkStatus.exitIp}</p>
            <p className="text-text-secondary">{exitIp || '—'}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
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
      </div>
    </div>
  )
}
