import { useLocale } from '@/i18n/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import logoImg from '@/assets/icon-transparent.png'

interface LoginPageProps {
  onLogin: () => void
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useLocale()

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: Branding */}
      <div className="flex-1 flex flex-col items-center justify-center p-10 bg-gradient-to-br from-bg-alt to-bg">
        <img src={logoImg} alt="OriginAI" className="w-[120px] h-[120px] mb-6" />
        <h1 className="font-serif text-[28px] text-brand tracking-wider mb-2">
          {t.brand.name}
        </h1>
        <p className="font-serif text-[13px] text-text-muted tracking-wide">
          {t.brand.taglineCn}
        </p>
        <p className="font-mono text-[11px] text-text-faint mt-1 tracking-wide">
          {t.brand.taglineEn}
        </p>
      </div>

      {/* Right: Auth Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-10 relative">
        <div className="w-full max-w-[280px]">
          <h2 className="font-serif text-xl text-text mb-1.5">
            {t.login.welcome}
          </h2>
          <p className="text-[13px] text-text-muted mb-7">
            {t.login.subtitle}
          </p>

          {/* Email */}
          <div className="mb-4">
            <label className="block text-xs text-text-secondary mb-1.5 font-mono">
              {t.login.email}
            </label>
            <input
              type="email"
              placeholder="user@example.com"
              className="w-full px-3.5 py-2.5 border border-border-strong rounded-lg text-sm bg-bg-card text-text outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* Password */}
          <div className="mb-6">
            <label className="block text-xs text-text-secondary mb-1.5 font-mono">
              {t.login.password}
            </label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 border border-border-strong rounded-lg text-sm bg-bg-card text-text outline-none focus:border-brand transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            onClick={onLogin}
            className="w-full py-3 bg-brand text-white rounded-lg text-sm font-medium cursor-pointer hover:opacity-90 transition-opacity mb-4"
          >
            {t.login.submit}
          </button>

          {/* Register link */}
          <p className="text-center text-[13px] text-text-muted">
            {t.login.noAccount}
            <a
              href="https://wt.ls/origin-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline ml-1 cursor-pointer"
            >
              {t.login.register}
            </a>
          </p>
        </div>

        {/* Language Switcher */}
        <div className="absolute bottom-4 right-5">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
