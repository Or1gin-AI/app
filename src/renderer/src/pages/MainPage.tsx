import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocale } from '@/i18n/context'
import { SmsActivationCard } from '@/components/SmsActivationCard'

interface MainPageProps {
  accountMode: string
  registered: boolean
  claudeAccountId: string
  hasPaidPlan: boolean
  networkOk: boolean
  onRefresh: () => Promise<unknown>
}

const tabTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2 },
}

export function MainPage({ claudeAccountId, hasPaidPlan, networkOk }: MainPageProps) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<'web' | 'code'>('web')

  const webSteps = [
    <>{t.main.claudeWeb.step1}</>,
    <>{t.main.claudeWeb.step2Prefix}<strong className="font-semibold text-text">{t.main.claudeWeb.step2Bold}</strong>{t.main.claudeWeb.step2Suffix}</>,
    <>{t.main.claudeWeb.step3}</>,
    <>{t.main.claudeWeb.step4}</>,
  ]

  const handleGetGmail = () => {
    window.electronAPI.payment.openCheckout('https://pay.ldxp.cn/item/4p0oqt').catch(() => {})
  }

  const codeSteps = [
    <>{t.main.claudeCode.step1} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">claude login</code></>,
    <>{t.main.claudeCode.step2} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">{t.main.claudeCode.step2method}</code> {t.main.claudeCode.step2suffix}</>,
    <>{t.main.claudeCode.step3}</>,
    <>{t.main.claudeCode.step4}</>,
  ]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-8 pt-5 pb-2">
        <div className="flex items-center gap-1 rounded-lg bg-bg-alt p-1">
          <button
            onClick={() => setActiveTab('web')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all cursor-pointer ${
              activeTab === 'web'
                ? 'bg-bg-card text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.main.claudeWeb.title}
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-all cursor-pointer ${
              activeTab === 'code'
                ? 'bg-bg-card text-text shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.main.claudeCode.title}
          </button>
        </div>

        <SmsActivationCard
          claudeAccountId={claudeAccountId}
          hasPaidPlan={hasPaidPlan}
          networkOk={networkOk}
        />
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center overflow-y-auto px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'web' ? (
            <motion.div key="web" {...tabTransition} className="max-w-[420px] w-full">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-2">
                  {t.main.claudeWeb.label}
                </div>
                <h2 className="font-serif text-xl text-text mb-2">{t.main.claudeWeb.title}</h2>
                <p className="text-[13px] text-text-muted leading-relaxed">
                  {t.main.claudeWeb.desc} {t.main.claudeWeb.descLine2}
                </p>
              </div>

              {/* Steps */}
              <div className="text-[13px] text-text-secondary leading-relaxed mb-4 space-y-2.5">
                {webSteps.map((content, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-brand font-mono text-[12px] mt-[1px] shrink-0">{i + 1}.</span>
                    <span>{content}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleGetGmail}
                className="w-full py-2 rounded-lg text-[12px] font-medium border border-brand/30 text-brand bg-brand/[0.04] hover:bg-brand/[0.08] cursor-pointer transition-colors"
              >
                {t.main.claudeWeb.noGmailButton}
              </button>

            </motion.div>
          ) : (
            <motion.div key="code" {...tabTransition} className="max-w-[420px] w-full">
              {/* Header */}
              <div className="text-center mb-8">
                <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-2">
                  {t.main.claudeCode.label}
                </div>
                <h2 className="font-serif text-xl text-text mb-2">{t.main.claudeCode.title}</h2>
                <p className="text-[13px] text-text-muted leading-relaxed">
                  {t.main.claudeCode.desc} {t.main.claudeCode.descLine2}
                </p>
              </div>

              {/* Terminal warning */}
              <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-2.5 mb-6">
                <p className="text-[12px] text-red-500 leading-relaxed">{t.main.claudeCode.newTerminalWarning}</p>
              </div>

              {/* Steps */}
              <div className="text-[13px] text-text-secondary leading-relaxed space-y-2.5">
                {codeSteps.map((content, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-brand font-mono text-[12px] mt-[1px] shrink-0">{i + 1}.</span>
                    <span>{content}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
