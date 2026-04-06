import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LocaleProvider } from '@/i18n/context'
import { Titlebar } from '@/components/Titlebar'
import { LoginPage } from '@/pages/LoginPage'
import { NetworkSetupPage } from '@/pages/NetworkSetupPage'
import { MainPage } from '@/pages/MainPage'

type Page = 'login' | 'network' | 'main'

// Mock: toggle this to test network setup flow
const MOCK_NETWORK_OK = true

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.35 },
}

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('login')

  const handleLogin = useCallback(() => {
    if (MOCK_NETWORK_OK) {
      setPage('main')
    } else {
      setPage('network')
    }
  }, [])

  const handleNetworkComplete = useCallback(() => {
    setPage('main')
  }, [])

  const handleLogout = useCallback(() => {
    setPage('login')
  }, [])

  return (
    <LocaleProvider>
      <div className="h-full flex flex-col bg-bg">
        <Titlebar
          showAccount={page !== 'login'}
          showIndicator={page === 'main'}
          networkOk={true}
          onLogout={handleLogout}
        />

        <AnimatePresence mode="wait">
          {page === 'login' && (
            <motion.div key="login" className="flex-1 flex flex-col" {...pageTransition}>
              <LoginPage onLogin={handleLogin} />
            </motion.div>
          )}
          {page === 'network' && (
            <motion.div key="network" className="flex-1 flex flex-col" {...pageTransition}>
              <NetworkSetupPage onComplete={handleNetworkComplete} />
            </motion.div>
          )}
          {page === 'main' && (
            <motion.div key="main" className="flex-1 flex flex-col" {...pageTransition}>
              <MainPage />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LocaleProvider>
  )
}

export default App
