import { useLocale } from '@/i18n/context'
import { VscGlobe } from 'react-icons/vsc'

export function MainPage() {
  const { t } = useLocale()

  return (
    <div className="flex flex-1 min-h-0 items-center">
      {/* Left: Claude Web */}
      <div className="flex-1 flex flex-col items-center justify-center p-10 border-r border-border">
        <div className="text-center">
          <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-3">
            {t.main.claudeWeb.label}
          </div>
          <h2 className="font-serif text-lg text-text mb-2">{t.main.claudeWeb.title}</h2>
          <p className="text-[13px] text-text-muted mb-8 leading-relaxed">
            {t.main.claudeWeb.desc}
            <br />
            {t.main.claudeWeb.descLine2}
          </p>

          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bg-alt to-[#e8e2da] mx-auto mb-7 flex items-center justify-center">
            <VscGlobe size={28} className="text-brand" />
          </div>

          <button className="px-7 py-2.5 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity">
            {t.main.claudeWeb.button}
          </button>
        </div>
      </div>

      {/* Right: Claude Code */}
      <div className="flex-1 flex flex-col items-center justify-center p-10">
        <div className="max-w-[280px] w-full">
          <div className="text-center">
            <div className="font-mono text-[11px] text-text-faint tracking-[2px] uppercase mb-3">
              {t.main.claudeCode.label}
            </div>
            <h2 className="font-serif text-lg text-text mb-2">{t.main.claudeCode.title}</h2>
            <p className="text-[13px] text-text-muted mb-6 leading-relaxed">
              {t.main.claudeCode.desc}
              <br />
              {t.main.claudeCode.descLine2}
            </p>
          </div>

          <div className="text-[13px] text-text-secondary leading-relaxed">
            {[
              <>{t.main.claudeCode.step1} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">claude login</code></>,
              <>{t.main.claudeCode.step2} <code className="bg-bg-alt px-1.5 py-0.5 rounded text-xs text-brand">{t.main.claudeCode.step2method}</code> {t.main.claudeCode.step2suffix}</>,
              <>{t.main.claudeCode.step3}</>,
              <>{t.main.claudeCode.step4}</>,
            ].map((content, i) => (
              <div key={i} className="flex gap-2.5 mb-3.5 items-start">
                <div className="min-w-[22px] h-[22px] rounded-full bg-bg-alt text-brand flex items-center justify-center text-[11px] font-semibold font-mono shrink-0">
                  {i + 1}
                </div>
                <div>{content}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
