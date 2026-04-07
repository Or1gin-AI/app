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

// Mock plan data — backend not ready yet
const MOCK_PLAN: PlanId = '20x'
const MOCK_EXPIRES = '2026-05-07'
const MOCK_BALANCE = 166.50

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
  const [userPlan] = useState<PlanId>(MOCK_PLAN)
  const [networkOk, setNetworkOk] = useState(true)
  const [exitIp, setExitIp] = useState<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Try to restore session on startup
  useEffect(() => {
    window.electronAPI.auth.restoreSession().then((res) => {
      if (res.ok && res.user) {
        setUserEmail(res.user.email)
        setUserName(res.user.name ?? '')
        setPage('network')
      } else {
        setPage('login')
      }
    }).catch(() => {
      setPage('login')
    })
  }, [])

  // Health check: start once logged in, listen forever
  const healthStarted = useRef(false)
  useEffect(() => {
    if (page === 'login' || page === 'loading') return
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
        setPage('network')
      }
    })
  }, [page])

  const handleLogin = useCallback((user: { email: string; name: string }) => {
    setUserEmail(user.email)
    setUserName(user.name)
    setPage('network')
  }, [])

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
    // Stop health check
    window.electronAPI.health.stop()
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
    healthStarted.current = false
    setUserEmail('')
    setPage('login')
  }, [])

  const handlePlanClick = useCallback(() => {
    setPage('plan')
  }, [])

  const handlePlanBack = useCallback(() => {
    setPage('main')
  }, [])

  const handleNetworkClick = useCallback(() => {
    setPage('network-status')
  }, [])

  const handleNetworkStatusBack = useCallback(() => {
    setPage('main')
  }, [])

  return (
    <LocaleProvider>
      <div className="h-full flex flex-col bg-bg">
        <Titlebar
          showAccount={page !== 'login' && page !== 'loading'}
          showIndicator={page === 'main' || page === 'plan' || page === 'network-status'}
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
                expiresAt={MOCK_EXPIRES}
                userEmail={userEmail}
                balance={MOCK_BALANCE}
                onBack={handlePlanBack}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LocaleProvider>
  )
}

export default App
