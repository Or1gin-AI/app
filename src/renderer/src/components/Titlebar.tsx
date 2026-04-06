import { useLocale } from '@/i18n/context'
import { VscSignOut } from 'react-icons/vsc'

interface TitlebarProps {
  showAccount: boolean
  showIndicator: boolean
  networkOk?: boolean
  onLogout?: () => void
}

export function Titlebar({ showAccount, showIndicator, networkOk = true, onLogout }: TitlebarProps) {
  const { t } = useLocale()
  const isMac = window.electronAPI?.platform === 'darwin'

  const indicator = showIndicator && (
    <div className="flex items-center gap-1.5 ml-2.5">
      <div
        className={`w-[7px] h-[7px] rounded-full ${
          networkOk
            ? 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
            : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]'
        }`}
      />
      <span className="text-[11px] text-text-muted font-mono">
        {networkOk ? t.titlebar.networkOk : t.titlebar.networkError}
      </span>
    </div>
  )

  const account = showAccount && (
    <div className="flex items-center gap-2.5 text-text-secondary text-[11px] font-mono">
      <span>user@example.com</span>
      <span className="text-text-faint">·</span>
      <span className="text-brand">Pro Plan</span>
      <button
        onClick={onLogout}
        className="text-text-faint hover:text-text-secondary transition-colors cursor-pointer"
        title={t.titlebar.logout}
      >
        <VscSignOut size={14} />
      </button>
    </div>
  )

  return (
    <div
      className="flex items-center justify-between px-4 h-9 bg-black/[0.02] border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {isMac && <div className="w-[68px]" />}
        {isMac && indicator}
        {!isMac && account}
      </div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {isMac && account}
        {!isMac && indicator}
        {!isMac && <div className="w-[138px]" />}
      </div>
    </div>
  )
}
