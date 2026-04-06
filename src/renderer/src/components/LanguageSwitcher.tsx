import { useLocale } from '@/i18n/context'

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale()

  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-text-muted">
      <button
        onClick={() => setLocale('zh')}
        className={`cursor-pointer transition-colors ${locale === 'zh' ? 'text-brand font-semibold' : 'hover:text-text-secondary'}`}
      >
        中
      </button>
      <span>/</span>
      <button
        onClick={() => setLocale('en')}
        className={`cursor-pointer transition-colors ${locale === 'en' ? 'text-brand font-semibold' : 'hover:text-text-secondary'}`}
      >
        EN
      </button>
    </div>
  )
}
