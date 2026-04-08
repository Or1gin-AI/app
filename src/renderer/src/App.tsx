import { useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LocaleProvider } from '@/i18n/context'
import { Titlebar } from '@/components/Titlebar'
import { LoginPage } from '@/pages/LoginPage'
import { NetworkSetupPage } from '@/pages/NetworkSetupPage'
import { MainPage } from '@/pages/MainPage'
import { PlanPage } from '@/pages/PlanPage'
import { NetworkStatusPage } from '@/pages/NetworkStatusPage'
import type { PlanId } from '@/pages/PlanPage'

type Page = 'loading' | 'login' | 'network' | 'network-status' | 'main' | 'plan'

const PRODUCT_TO_PLAN: Record<string, PlanId> = { FREE: 'free', PRO: 'pro', X5: '5x', X20: '20x' }

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.35 },
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
      if (!data.ok) {
        setPage('network-status')
      }
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

  return (
    <LocaleProvider>
      <div className="h-full flex flex-col bg-bg">
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
