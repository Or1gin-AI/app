import { useLocale } from '@/i18n/context'
import { VscSignOut } from 'react-icons/vsc'
import type { PlanId } from '@/pages/PlanPage'

interface TitlebarProps {
  showAccount: boolean
  showIndicator: boolean
  networkOk?: boolean
  exitIp?: string | null
  userEmail?: string
  userPlan?: PlanId
  onLogout?: () => void
  onPlanClick?: () => void
  onNetworkClick?: () => void
}

const PLAN_LABELS: Record<PlanId, string> = {
  free: 'Free',
  standard: 'Standard',
  pro: 'Pro',
  enterprise: 'Enterprise',
}

export function Titlebar({
  showAccount,
  showIndicator,
  networkOk = true,
  exitIp,
  userEmail,
  userPlan = 'pro',
  onLogout,
  onPlanClick,
  onNetworkClick,
}: TitlebarProps) {
  const { t } = useLocale()
  const isMac = window.electronAPI?.platform === 'darwin'

  const indicator = showIndicator && (
    <button
      onClick={onNetworkClick}
      className="flex items-center gap-1.5 ml-2.5 bg-transparent border-none cursor-pointer hover:opacity-70 transition-opacity"
    >
      <div
        className={`w-[7px] h-[7px] rounded-full ${
          networkOk
            ? 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
            : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]'
        }`}
      />
      <span className="text-[11px] text-text-muted font-mono">
        {networkOk ? t.titlebar.networkOk : t.titlebar.networkError}
        {networkOk && exitIp && <span className="text-text-faint ml-1">({exitIp})</span>}
      </span>
    </button>
  )

  const account = showAccount && (
    <div className="flex items-center gap-2.5 text-text-secondary text-[11px] font-mono">
      <button
        onClick={onPlanClick}
        className="hover:underline cursor-pointer bg-transparent border-none text-[11px] font-mono text-text-secondary"
      >
        {userEmail || 'user@example.com'}
      </button>
      <span className="text-text-faint">·</span>
      <button
        onClick={onPlanClick}
        className="text-brand hover:underline cursor-pointer bg-transparent border-none text-[11px] font-mono"
      >
        {PLAN_LABELS[userPlan]}
      </button>
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
      className="flex items-center justify-between px-4 h-9 bg-black/[0.02] border-b border-border select-none shrink-0"
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
