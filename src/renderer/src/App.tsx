import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePostHog } from '@posthog/react'
import { track, identify, reset as resetTelemetry, disableTelemetry, EVENTS } from '@/lib/telemetry'
import { LocaleProvider } from '@/i18n/context'
import { Titlebar } from '@/components/Titlebar'
import { LoginPage } from '@/pages/LoginPage'
import { NetworkSetupPage } from '@/pages/NetworkSetupPage'
import { MainPage } from '@/pages/MainPage'
import { PlanPage } from '@/pages/PlanPage'
import { NetworkStatusPage } from '@/pages/NetworkStatusPage'
import { useLocale } from '@/i18n/context'
import { OnboardingModal } from '@/components/OnboardingModal'
import type { PlanId } from '@/pages/PlanPage'

type Page = 'loading' | 'login' | 'network' | 'network-status' | 'main' | 'plan'

const PRODUCT_TO_PLAN: Record<string, PlanId> = { FREE: 'free', STANDARD: 'standard', PRO: 'pro', ENTERPRISE: 'enterprise' }

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.35 },
}

function UpdateOverlay({ status, errorMessage }: { status: string; errorMessage: string }): React.JSX.Element {
  const { t } = useLocale()
  const isInstalling = status === 'installing'
  const isError = status === 'error'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 text-center">
        {isInstalling ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.updater.installing}</h3>
            <p className="text-sm text-gray-500">{t.updater.installingDesc}</p>
          </>
        ) : isError ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.updater.errorTitle}</h3>
            <p className="text-sm text-gray-500 mb-1">{t.updater.errorDesc}</p>
            {errorMessage && <p className="text-xs text-gray-400 mb-5 break-all">{errorMessage}</p>}
            <button
              onClick={() => window.electronAPI.updater.check()}
              className="w-full py-2.5 rounded-lg bg-brand text-white font-medium hover:opacity-90 transition-opacity"
            >
              {t.updater.retry}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function UpdatePill({ status, version, percent, onDismiss }: { status: string; version: string; percent: number; onDismiss: () => void }): React.JSX.Element | null {
  const { t } = useLocale()
  if (status !== 'downloading' && status !== 'downloaded') return null
  const isReady = status === 'downloaded'
  const text = isReady
    ? t.updater.pillReady.replace('{version}', version)
    : t.updater.pillDownloading.replace('{version}', version)
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="fixed bottom-4 right-4 z-[9998] max-w-xs rounded-xl border border-border bg-bg-card shadow-lg px-3.5 py-2.5 flex items-center gap-3"
    >
      <div className="flex-shrink-0">
        {isReady ? (
          <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center">
            <span className="text-[10px] font-mono text-brand">{percent}%</span>
          </div>
        )}
      </div>
      <span className="text-[12px] text-text-secondary leading-snug flex-1">{text}</span>
      {isReady && (
        <button
          onClick={onDismiss}
          className="text-text-faint hover:text-text-secondary transition-colors cursor-pointer bg-transparent border-none text-[11px] shrink-0"
          aria-label={t.updater.pillDismiss}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.div>
  )
}

function KickedDialog({ graceMs, onAcknowledge }: { graceMs: number; onAcknowledge: () => void }): React.JSX.Element {
  const { t } = useLocale()
  const [remaining, setRemaining] = useState(graceMs)

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - start
      const left = Math.max(graceMs - elapsed, 0)
      setRemaining(left)
    }, 1000)
    return () => clearInterval(timer)
  }, [graceMs])

  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 text-center"
      >
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{t.sessionKicked.title}</h3>
        <p className="text-sm text-gray-500 mb-4">{t.sessionKicked.message}</p>
        <div className="text-[13px] text-text-muted mb-5">
          {t.sessionKicked.countdown}: <span className="font-mono font-semibold text-amber-600 text-base">{timeStr}</span>
        </div>
        <button
          onClick={onAcknowledge}
          className="w-full py-2.5 rounded-lg bg-brand text-white font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          {t.sessionKicked.ok}
        </button>
      </motion.div>
    </div>
  )
}

function App(): React.JSX.Element {
  const posthog = usePostHog()
  const [page, setPage] = useState<Page>('loading')
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [userPlan, setUserPlan] = useState<PlanId>('free')
  const [planExpires, setPlanExpires] = useState('')
  const [claudeAccountId, setClaudeAccountId] = useState('')
  const [claudeAccountRegistered, setClaudeAccountRegistered] = useState(false)
  const [claudeAccountMode, setClaudeAccountMode] = useState('')
  const [accountStatus, setAccountStatus] = useState('OK')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [networkOk, setNetworkOk] = useState(true)
  const [exitIp, setExitIp] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const userPlanRef = useRef<PlanId>('free')
  const prevPlanRef = useRef<PlanId>('free')
  const subscriptionRoutingRef = useRef(false)

  // Auto-update state
  const [updateStatus, setUpdateStatus] = useState<string>('')
  const [updateVersion, setUpdateVersion] = useState<string>('')
  const [updatePercent, setUpdatePercent] = useState<number>(0)
  const [updateError, setUpdateError] = useState<string>('')

  // Listen for auto-update events
  const updateLockedRef = useRef(false)
  useEffect(() => {
    const cleanup = window.electronAPI.updater.onStatus((data) => {
      // Once downloaded, keep the overlay visible across background re-checks,
      // but still allow install / error transitions to come through.
      if (updateLockedRef.current && !['downloaded', 'installing', 'error'].includes(data.status)) return
      if (data.status === 'downloaded' || data.status === 'installing') updateLockedRef.current = true
      if (data.status === 'error') updateLockedRef.current = false
      setUpdateStatus(data.status)
      if (data.version) setUpdateVersion(data.version)
      if (data.percent !== undefined) setUpdatePercent(data.percent)
      if (data.message) setUpdateError(data.message)
    })
    return cleanup
  }, [])

  // Listen for session expiry (kicked out by another login)
  const logoutRef = useRef<((skipSignOut?: boolean) => void) | null>(null)
  useEffect(() => {
    const cleanup = window.electronAPI.session.onExpired(() => {
      setKickedInfo(null)
      logoutRef.current?.(true) // skip signOut since session is already dead
    })
    return cleanup
  }, [])

  // Listen for session kicked (grace period before expiry)
  const [kickedInfo, setKickedInfo] = useState<{ graceMs: number } | null>(null)
  useEffect(() => {
    const cleanup = window.electronAPI.session.onKicked((data) => {
      setKickedInfo({ graceMs: data.graceMs })
    })
    return cleanup
  }, [])

  useEffect(() => {
    userPlanRef.current = userPlan
  }, [userPlan])

  const fetchIsNewUser = useCallback(async (): Promise<boolean> => {
    const nuRes = await window.electronAPI.auth.getNewuser().catch(() => null)
    return Boolean(
      nuRes &&
      nuRes.status === 200 &&
      (nuRes.data as { isNewuser?: number })?.isNewuser === 1
    )
  }, [])

  const routeSubscribedUser = useCallback(async () => {
    if (subscriptionRoutingRef.current) return
    subscriptionRoutingRef.current = true
    try {
      const isNew = await fetchIsNewUser()
      if (isNew) setShowOnboarding(true)
      // If sidecar is already running (e.g. window was closed and reopened on macOS),
      // go straight to the main page instead of the network setup page.
      const status = await window.electronAPI.sidecar.status()
      setPage(status.running ? 'main' : 'network')
    } finally {
      subscriptionRoutingRef.current = false
    }
  }, [fetchIsNewUser])

  // Fetch subscription status from claude-account/list — returns resolved plan
  const fetchSubscription = useCallback(async (): Promise<PlanId> => {
    const applyAccounts = (accounts: Array<{
      id: string
      accountMode?: string
      registered?: boolean
      subscriptionType: string
      expireAt: string
      status: string
      currentOrder: string | null
    }>): PlanId => {
      const selfServiceAccount = accounts.find((acct) => acct.accountMode === 'SELF_SERVICE_GMAIL') || null
      const acct = selfServiceAccount || accounts[0]
      setClaudeAccountId(selfServiceAccount?.id || acct?.id || '')
      setClaudeAccountRegistered(Boolean(selfServiceAccount?.registered ?? acct?.registered))
      setClaudeAccountMode(selfServiceAccount?.accountMode || acct?.accountMode || '')
      setAccountStatus(selfServiceAccount?.status || acct?.status || 'UNREGISTERED')
      const plan = PRODUCT_TO_PLAN[acct.subscriptionType] || 'free'
      setUserPlan(plan)
      setPlanExpires(acct.expireAt ? acct.expireAt.split('T')[0] : '')
      return plan
    }

    try {
      const res = await window.electronAPI.claudeAccount.list()
      if (res.status === 401 || res.status === 403) {
        logoutRef.current?.(true)
        return 'free'
      }
      if (res.status === 200) {
        const accounts = res.data as Array<{
          id: string
          accountMode?: string
          registered?: boolean
          subscriptionType: string
          expireAt: string
          status: string
          currentOrder: string | null
        }>
        if (accounts.length === 0) {
          const createRes = await window.electronAPI.claudeAccount.createSelfService()
          if (createRes.status >= 200 && createRes.status < 300) {
            const retryRes = await window.electronAPI.claudeAccount.list()
            if (retryRes.status === 200) {
              const retryAccounts = retryRes.data as typeof accounts
              if (retryAccounts.length > 0) return applyAccounts(retryAccounts)
            }
          }
          setClaudeAccountId('')
          setClaudeAccountRegistered(false)
          setClaudeAccountMode('')
          setAccountStatus('UNREGISTERED')
          setUserPlan('free')
          setPlanExpires('')
          return 'free'
        }
        return applyAccounts(accounts)
      }
    } catch { /* */ }
    return userPlanRef.current
  }, [])

  // Try to restore session on startup
  useEffect(() => {
    // Check telemetry disable flag
    window.electronAPI.telemetryDisabled().then((disabled: boolean) => {
      if (disabled) disableTelemetry()
    }).catch(() => {})

    track(EVENTS.APP_STARTED, { version: window.electronAPI.appVersion, platform: window.electronAPI.platform })

    window.electronAPI.auth.restoreSession().then(async (res) => {
      if (res.ok && res.user) {
        setUserEmail(res.user.email)
        setUserName(res.user.name ?? '')
        identify(res.user.email, { name: res.user.name ?? '' })
        window.electronAPI.session.startCheck()
        const plan = await fetchSubscription()
        if (plan === 'free') {
          setPage('plan')
        } else {
          prevPlanRef.current = plan
          await routeSubscribedUser()
        }
      } else {
        setPage('login')
      }
    }).catch(() => {
      setPage('login')
    })
  }, [fetchSubscription, routeSubscribedUser])

  // Track page views
  useEffect(() => {
    if (page !== 'loading') {
      track(EVENTS.PAGE_VIEW, { page })
    }
  }, [page])

  // Page access guards
  useEffect(() => {
    if (page === 'loading' || page === 'login' || page === 'plan') return
    // Priority 1: Free plan — can only access plan page
    if (userPlan === 'free') {
      setPage('plan')
      return
    }
    // Priority 2: Network down — kick off main page
    if (!networkOk && page === 'main') {
      setPage('network-status')
    }
  }, [page, userPlan, networkOk])

  // Detect plan transition from free → paid while on plan page → navigate to onboarding/network
  useEffect(() => {
    const wasFree = prevPlanRef.current === 'free'
    prevPlanRef.current = userPlan
    if (wasFree && userPlan !== 'free' && page === 'plan') {
      void routeSubscribedUser()
    }
  }, [userPlan, page, routeSubscribedUser])

  // Health check: only for paid plans, not on login/loading
  const healthStarted = useRef(false)
  useEffect(() => {
    const shouldRunHealth = page === 'main' || page === 'plan' || page === 'network-status'

    // Do not probe while the user is configuring networking. Those requests add
    // noise exactly when Xray is warming up and can interfere with final verify.
    if (!shouldRunHealth || userPlan === 'free') {
      if (healthStarted.current) {
        window.electronAPI.health.stop()
        if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
        healthStarted.current = false
      }
      return
    }

    if (healthStarted.current) return
    healthStarted.current = true

    // Initial quick check
    window.electronAPI.checkIpQuick().then((res) => {
      setNetworkOk(res.ok)
      setExitIp(res.ip)
    })

    // Start periodic checks
    window.electronAPI.health.start()
    cleanupRef.current = window.electronAPI.health.onStatus((data) => {
      setNetworkOk(data.ok)
      setExitIp(data.ip)
      // Only redirect from main page — don't interrupt network setup or other pages
    })
  }, [page, userPlan])

  const handleLogin = useCallback(async (user: { email: string; name: string }) => {
    setUserEmail(user.email)
    setUserName(user.name)
    identify(user.email, { name: user.name })
    track(EVENTS.USER_LOGGED_IN)
    window.electronAPI.session.startCheck()
    const plan = await fetchSubscription()
    if (plan === 'free') {
      setPage('plan')
    } else {
      prevPlanRef.current = plan
      await routeSubscribedUser()
    }
  }, [fetchSubscription, posthog, routeSubscribedUser])

  const handleNetworkComplete = useCallback(async () => {
    setNetworkOk(true)
    setPage('main')
    track(EVENTS.NETWORK_OPTIMIZATION_COMPLETE)
    // Immediately refresh exit IP after optimization
    const res = await window.electronAPI.checkIpQuick()
    setNetworkOk(res.ok)
    setExitIp(res.ip)
  }, [posthog])

  const handleLogout = useCallback(async (skipSignOut?: boolean) => {
    try {
      if (!skipSignOut) {
        await window.electronAPI.auth.signOut().catch(() => {})
        // Disable auto-login on manual logout
        const s = await window.electronAPI.settings.get().catch(() => null)
        if (s?.autoLogin) {
          await window.electronAPI.settings.set({ ...s, autoLogin: false }).catch(() => {})
        }
      }
      track(EVENTS.USER_LOGGED_OUT, { reason: skipSignOut ? 'session_expired' : 'manual' })
      resetTelemetry()
      // Stop session check + health check + sidecar
      try { window.electronAPI.session?.stopCheck?.() } catch { /* */ }
      window.electronAPI.health.stop().catch(() => {})
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
      healthStarted.current = false
      await window.electronAPI.sidecar.stop().catch(() => {})
    } catch { /* ensure we always reach the state reset below */ }
    setUserEmail('')
    setUserName('')
    setUserPlan('free')
    setPlanExpires('')
    setClaudeAccountId('')
    setClaudeAccountRegistered(false)
    setClaudeAccountMode('')
    setAccountStatus('OK')
    setShowOnboarding(false)
    setNetworkOk(true)
    setExitIp(null)
    prevPlanRef.current = 'free'
    subscriptionRoutingRef.current = false
    setPage('login')
  }, [])
  logoutRef.current = handleLogout

  const handlePlanClick = useCallback(() => {
    void fetchSubscription()
    setPage('plan')
  }, [fetchSubscription])

  const handlePlanBack = useCallback(() => {
    if (userPlan === 'free') return
    setPage('main')
  }, [userPlan])

  const handleNetworkClick = useCallback(async () => {
    const status = await window.electronAPI.sidecar.status()
    setPage(status.running ? 'network-status' : 'network')
  }, [])

  const handleNetworkStatusBack = useCallback(() => {
    if (userPlan === 'free') {
      setPage('plan')
    } else {
      setPage('main')
    }
  }, [userPlan])

  // Overlay is only shown while actively installing (user clicked restart)
  // or when an error needs user attention. Downloaded/downloading use the
  // non-blocking pill and let autoInstallOnAppQuit handle the actual install.
  const showUpdateOverlay = updateStatus === 'installing' || updateStatus === 'error'
  const [updatePillDismissed, setUpdatePillDismissed] = useState(false)
  useEffect(() => {
    // Reset the dismissed flag when a new version becomes available,
    // so the pill re-appears if the user downloads yet another version later.
    if (updateStatus === 'checking' || updateStatus === 'downloading') setUpdatePillDismissed(false)
  }, [updateStatus])
  const showUpdatePill = !updatePillDismissed && (updateStatus === 'downloading' || updateStatus === 'downloaded')

  return (
    <LocaleProvider>
      <div className="h-full flex flex-col bg-bg">
        {showUpdateOverlay && <UpdateOverlay status={updateStatus} errorMessage={updateError} />}
        {kickedInfo && (
          <KickedDialog
            graceMs={kickedInfo.graceMs}
            onAcknowledge={() => {
              setKickedInfo(null)
              window.electronAPI.session.acknowledgeKick().catch(() => {})
            }}
          />
        )}
        <AnimatePresence>
          {showUpdatePill && (
            <UpdatePill
              status={updateStatus}
              version={updateVersion}
              percent={updatePercent}
              onDismiss={() => setUpdatePillDismissed(true)}
            />
          )}
        </AnimatePresence>
        <Titlebar
          showAccount={page !== 'login' && page !== 'loading'}
          showIndicator={userPlan !== 'free' && (page === 'main' || page === 'plan' || page === 'network-status')}
          networkOk={networkOk}
          exitIp={exitIp}
          userEmail={userEmail}
          userPlan={userPlan}
          onLogout={handleLogout}
          onPlanClick={handlePlanClick}
          onNetworkClick={handleNetworkClick}
        />

        <AnimatePresence mode="wait">
          {page === 'loading' && (
            <motion.div key="loading" className="flex-1 flex items-center justify-center min-h-0" {...pageTransition}>
              <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
            </motion.div>
          )}
          {page === 'login' && (
            <motion.div key="login" className="flex-1 flex flex-col min-h-0" {...pageTransition}>
              <LoginPage onLogin={handleLogin} />
            </motion.div>
          )}
          {page === 'network' && (
            <motion.div key="network" className="flex-1 flex flex-col min-h-0" {...pageTransition}>
              <NetworkSetupPage onComplete={handleNetworkComplete} />
            </motion.div>
          )}
          {page === 'main' && (
            <motion.div key="main" className="flex-1 flex flex-col min-h-0" {...pageTransition}>
              <MainPage
                accountMode={claudeAccountMode}
                registered={claudeAccountRegistered}
                claudeAccountId={claudeAccountId}
                hasPaidPlan={userPlan !== 'free'}
                networkOk={networkOk}
                onRefresh={fetchSubscription}
              />
            </motion.div>
          )}
          {page === 'network-status' && (
            <motion.div key="network-status" className="flex-1 flex flex-col min-h-0" {...pageTransition}>
              <NetworkStatusPage
                onBack={handleNetworkStatusBack}
                onReconfigure={() => setPage('network')}
              />
            </motion.div>
          )}
          {page === 'plan' && (
            <motion.div key="plan" className="flex-1 flex flex-col min-h-0" {...pageTransition}>
              <PlanPage
                currentPlan={userPlan}
                expiresAt={planExpires}
                userEmail={userEmail}
                claudeAccountId={claudeAccountId}
                accountStatus={accountStatus}
                networkOk={networkOk}
                onBack={userPlan !== 'free' ? handlePlanBack : undefined}
                onRefresh={fetchSubscription}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {showOnboarding && (
          <OnboardingModal onComplete={() => setShowOnboarding(false)} />
        )}
      </div>
    </LocaleProvider>
  )
}

export default App
