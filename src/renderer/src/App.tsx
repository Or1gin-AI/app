import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LocaleProvider } from '@/i18n/context'
import { Titlebar } from '@/components/Titlebar'
import { LoginPage } from '@/pages/LoginPage'
import { NetworkSetupPage } from '@/pages/NetworkSetupPage'
import { MainPage } from '@/pages/MainPage'
import { PlanPage } from '@/pages/PlanPage'
import { NetworkStatusPage } from '@/pages/NetworkStatusPage'
import { useLocale } from '@/i18n/context'
import type { PlanId } from '@/pages/PlanPage'

type Page = 'loading' | 'login' | 'network' | 'network-status' | 'main' | 'plan'

const PRODUCT_TO_PLAN: Record<string, PlanId> = { FREE: 'free', PRO: 'pro', X5: '5x', X20: '20x' }

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.35 },
}

function UpdateOverlay({ status, version, percent }: { status: string; version: string; percent: number }): React.JSX.Element {
  const { t } = useLocale()
  const isReady = status === 'downloaded'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 text-center">
        {isReady ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t.updater.ready.replace('{version}', version)}
            </h3>
            <p className="text-sm text-gray-500 mb-6">{t.updater.readyDesc}</p>
            <button
              onClick={() => window.electronAPI.updater.install()}
              className="w-full py-2.5 rounded-lg bg-brand text-white font-medium hover:opacity-90 transition-opacity"
            >
              {t.updater.restart}
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t.updater.downloading.replace('{version}', version)}
            </h3>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-brand h-2 rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-sm text-gray-400">{percent}%</p>
          </>
        )}
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('loading')
  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('')
  const [userPlan, setUserPlan] = useState<PlanId>('free')
  const [planExpires, setPlanExpires] = useState('')
  const [claudeAccountId, setClaudeAccountId] = useState('')
  const [networkOk, setNetworkOk] = useState(true)
  const [exitIp, setExitIp] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Auto-update state
  const [updateStatus, setUpdateStatus] = useState<string>('')
  const [updateVersion, setUpdateVersion] = useState<string>('')
  const [updatePercent, setUpdatePercent] = useState<number>(0)

  // Listen for auto-update events
  useEffect(() => {
    const cleanup = window.electronAPI.updater.onStatus((data) => {
      setUpdateStatus(data.status)
      if (data.version) setUpdateVersion(data.version)
      if (data.percent !== undefined) setUpdatePercent(data.percent)
    })
    return cleanup
  }, [])

  // Fetch subscription status from claude-account/list — returns resolved plan
  const fetchSubscription = useCallback(async (): Promise<PlanId> => {
    try {
      const res = await window.electronAPI.claudeAccount.list()
      if (res.status === 200) {
        const accounts = res.data as Array<{
          id: string
          subscriptionType: string
          expireAt: string
        }>
        if (accounts.length > 0) {
          const acct = accounts[0]
          setClaudeAccountId(acct.id)
          const plan = PRODUCT_TO_PLAN[acct.subscriptionType] || 'free'
          setUserPlan(plan)
          setPlanExpires(
            acct.subscriptionType !== 'FREE' && acct.expireAt
              ? acct.expireAt.split('T')[0]
              : ''
          )
          return plan
        }
      }
    } catch { /* */ }
    return 'free'
  }, [])

  // Try to restore session on startup
  useEffect(() => {
    window.electronAPI.auth.restoreSession().then(async (res) => {
      if (res.ok && res.user) {
        setUserEmail(res.user.email)
        setUserName(res.user.name ?? '')
        const plan = await fetchSubscription()
        setPage(plan === 'free' ? 'plan' : 'network')
      } else {
        setPage('login')
      }
    }).catch(() => {
      setPage('login')
    })
  }, [fetchSubscription])

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

  // Health check: only for paid plans, not on login/loading
  const healthStarted = useRef(false)
  useEffect(() => {
    if (page === 'login' || page === 'loading') return

    // Free plan: no health check needed
    if (userPlan === 'free') {
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
    const plan = await fetchSubscription()
    setPage(plan === 'free' ? 'plan' : 'network')
  }, [fetchSubscription])

  const handleNetworkComplete = useCallback(async () => {
    setNetworkOk(true)
    setPage('main')
    // Immediately refresh exit IP after optimization
    const res = await window.electronAPI.checkIpQuick()
    setNetworkOk(res.ok)
    setExitIp(res.ip)
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await window.electronAPI.auth.signOut()
    } catch {
      // proceed anyway
    }
    // Disable auto-login on manual logout
    try {
      const s = await window.electronAPI.settings.get()
      if (s.autoLogin) {
        await window.electronAPI.settings.set({ ...s, autoLogin: false })
      }
    } catch { /* */ }
    // Stop health check + sidecar
    window.electronAPI.health.stop()
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
    healthStarted.current = false
    await window.electronAPI.sidecar.stop().catch(() => {})
    setUserEmail('')
    setUserPlan('free')
    setNetworkOk(true)
    setExitIp(null)
    setPage('login')
  }, [])

  const handlePlanClick = useCallback(() => {
    fetchSubscription()
    setPage('plan')
  }, [fetchSubscription])

  const handlePlanBack = useCallback(() => {
    if (userPlan === 'free') return
    setPage('main')
  }, [userPlan])

  const handleNetworkClick = useCallback(() => {
    setPage('network-status')
  }, [])

  const handleNetworkStatusBack = useCallback(() => {
    if (userPlan === 'free') {
      setPage('plan')
    } else {
      setPage('main')
    }
  }, [userPlan])

  const showUpdateOverlay = updateStatus === 'downloading' || updateStatus === 'downloaded'

  return (
    <LocaleProvider>
      <div className="h-full flex flex-col bg-bg">
        {showUpdateOverlay && <UpdateOverlay status={updateStatus} version={updateVersion} percent={updatePercent} />}
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
              <MainPage userName={userName} />
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
                networkOk={networkOk}
                onBack={userPlan !== 'free' ? handlePlanBack : undefined}
                onRefresh={fetchSubscription}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LocaleProvider>
  )
}

export default App
