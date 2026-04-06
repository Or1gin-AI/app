import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { zh } from './zh'
import { en } from './en'

export type Locale = 'en' | 'zh'

const translations = { en, zh } as const

export type Translations = typeof zh

interface LocaleContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translations
}

const LocaleContext = createContext<LocaleContextType>({
  locale: 'zh',
  setLocale: () => {},
  t: zh,
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh')

  useEffect(() => {
    const saved = localStorage.getItem('locale') as Locale | null
    if (saved === 'en' || saved === 'zh') {
      setLocale(saved)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('locale', locale)
  }, [locale])

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
