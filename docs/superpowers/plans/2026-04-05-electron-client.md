# OriginAI Electron Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished Electron desktop client for OriginAI with login, conditional network setup, and main page — all mocked, matching the originai-web design language.

**Architecture:** electron-vite + React + TypeScript renderer in a frameless BrowserWindow (800×540). Three pages managed via React state + Framer Motion AnimatePresence for fade transitions. Custom titlebar adapts layout based on platform (macOS vs Windows). i18n via React Context + localStorage.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, Tailwind CSS 4, Framer Motion, react-icons

---

## File Structure

```
originai-app/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── tailwind.config.ts          # Tailwind 4 config (if needed beyond CSS)
├── resources/
│   ├── icon.png                # Copied from ../originai-assets
│   └── icon-transparent.png
├── src/
│   ├── main/
│   │   └── index.ts            # Electron main process
│   ├── preload/
│   │   └── index.ts            # Context bridge (platform info)
│   └── renderer/
│       ├── index.html
│       ├── main.tsx             # React entry
│       ├── App.tsx              # Root: page state + AnimatePresence
│       ├── globals.css          # Tailwind + design tokens (from originai-web)
│       ├── assets/
│       │   └── logo.png         # Copied from ../originai-assets
│       ├── i18n/
│       │   ├── context.tsx      # LocaleProvider + useLocale
│       │   ├── zh.ts
│       │   └── en.ts
│       ├── components/
│       │   ├── Titlebar.tsx     # Custom titlebar (platform-aware)
│       │   └── LanguageSwitcher.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── NetworkSetupPage.tsx
│           └── MainPage.tsx
```

---

### Task 1: Scaffold project and install dependencies

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`

- [ ] **Step 1: Scaffold with create electron-vite**

```bash
cd /Users/clck/Desktop/Workspace
pnpm create @quick-start/electron@latest originai-app-scaffold -- --template react-ts
```

- [ ] **Step 2: Copy scaffold into our repo**

Copy the generated scaffold files into `/Users/clck/Desktop/Workspace/originai-app/`, overwriting any existing files. Do NOT copy `.git/` or `node_modules/`. The key files to bring over:
- `package.json`
- `electron.vite.config.ts`
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- `src/main/index.ts`
- `src/preload/index.ts`, `src/preload/index.d.ts`
- `src/renderer/index.html`
- `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`
- `src/renderer/src/env.d.ts`
- `.gitignore`

Note: electron-vite's react-ts template uses `src/renderer/src/` as the renderer source root. We will restructure in Task 2.

- [ ] **Step 3: Install additional dependencies**

```bash
cd /Users/clck/Desktop/Workspace/originai-app
pnpm add framer-motion react-icons
pnpm add -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 4: Verify the scaffold runs**

```bash
cd /Users/clck/Desktop/Workspace/originai-app
pnpm dev
```

Expected: An Electron window opens showing the default template. Close it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite react-ts project with dependencies"
```

---

### Task 2: Configure Tailwind, design tokens, and restructure renderer

**Files:**
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/src/globals.css`
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: Add Tailwind plugin to electron-vite config**

In `electron.vite.config.ts`, add the Tailwind Vite plugin to the renderer config:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
```

- [ ] **Step 2: Create globals.css with design tokens**

Create `src/renderer/src/globals.css` matching originai-web:

```css
@import "tailwindcss";

@theme {
  --color-bg: #faf8f5;
  --color-bg-card: #ffffff;
  --color-bg-alt: #f3f0eb;
  --color-border: rgba(0, 0, 0, 0.06);
  --color-border-strong: rgba(0, 0, 0, 0.10);
  --color-brand: #9b7b5a;
  --color-brand-light: rgba(155, 123, 90, 0.08);
  --color-text: #2c2c2c;
  --color-text-secondary: #6b6560;
  --color-text-muted: #9a9490;
  --color-text-faint: #b8b2aa;
  --color-dark: #2c2520;
  --font-serif: 'Noto Serif SC', Georgia, serif;
  --font-sans: -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif;
  --font-mono: 'IBM Plex Mono', Menlo, monospace;
}

html, body, #root {
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background: rgba(155, 123, 90, 0.15);
}
```

- [ ] **Step 3: Update index.html to load Google Fonts**

In `src/renderer/index.html`, add font links in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 4: Update main.tsx to import globals.css**

Replace the existing CSS import in `src/renderer/src/main.tsx`:

```tsx
import './globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 5: Clean up scaffold files**

Delete any scaffold-generated CSS files (`assets/main.css`, etc.) and the default `App.tsx` content. Replace `App.tsx` with a placeholder:

```tsx
function App(): React.JSX.Element {
  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <h1 className="text-2xl font-serif text-brand">OriginAI</h1>
    </div>
  )
}

export default App
```

- [ ] **Step 6: Verify Tailwind + tokens work**

```bash
pnpm dev
```

Expected: Window shows "OriginAI" centered in brand color (#9b7b5a) with the serif font.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: configure Tailwind CSS with design tokens matching originai-web"
```

---

### Task 3: Electron main process — frameless window + platform detection

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Configure main process**

Replace `src/main/index.ts`:

```ts
import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? false : {
      color: 'rgba(0,0,0,0)',
      symbolColor: '#6b6560',
      height: 36
    },
    trafficLightPosition: isMac ? { x: 16, y: 12 } : undefined,
    backgroundColor: '#faf8f5',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: Configure preload script**

Replace `src/preload/index.ts`:

```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform
})
```

Update `src/preload/index.d.ts`:

```ts
declare global {
  interface Window {
    electronAPI: {
      platform: string
    }
  }
}

export {}
```

- [ ] **Step 3: Verify frameless window**

```bash
pnpm dev
```

Expected: Frameless window at 800×540, macOS traffic lights visible at top-left with `hiddenInset` style, background is #faf8f5.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: frameless window with platform detection and preload bridge"
```

---

### Task 4: Copy assets from originai-assets

**Files:**
- Create: `resources/icon.png`
- Create: `src/renderer/src/assets/logo.png`

- [ ] **Step 1: Copy assets**

```bash
cp /Users/clck/Desktop/Workspace/originai-assets/icon.png /Users/clck/Desktop/Workspace/originai-app/resources/icon.png
cp /Users/clck/Desktop/Workspace/originai-assets/icon-transparent.png /Users/clck/Desktop/Workspace/originai-app/resources/icon-transparent.png
cp /Users/clck/Desktop/Workspace/originai-assets/logo.png /Users/clck/Desktop/Workspace/originai-app/src/renderer/src/assets/logo.png
```

- [ ] **Step 2: Commit**

```bash
git add resources/ src/renderer/src/assets/logo.png
git commit -m "chore: copy brand assets from originai-assets"
```

---

### Task 5: i18n — LocaleProvider, translations, and LanguageSwitcher

**Files:**
- Create: `src/renderer/src/i18n/context.tsx`
- Create: `src/renderer/src/i18n/zh.ts`
- Create: `src/renderer/src/i18n/en.ts`
- Create: `src/renderer/src/components/LanguageSwitcher.tsx`

- [ ] **Step 1: Create zh.ts translations**

```ts
export const zh = {
  login: {
    welcome: '欢迎回来',
    subtitle: '登录以继续使用 OriginAI',
    email: '邮箱',
    password: '密码',
    submit: '登录',
    noAccount: '还没有账户？',
    register: '前往官网注册',
  },
  network: {
    title: '网络环境需要优化',
    subtitle: '检测到当前网络无法正常访问 Claude 服务',
    subtitleLine2: '需要配置网络优化后才能继续使用',
    permissionTitle: '系统权限请求',
    permissionDesc: '需要网络配置权限以优化连接',
    configuring: '正在配置...',
    stepDetect: '检测网络环境',
    stepFetch: '获取配置信息',
    stepApply: '应用网络优化...',
    stepVerify: '验证连接',
    autoRedirect: '配置完成后将自动进入主页面',
  },
  main: {
    claudeWeb: {
      label: 'CLAUDE WEB',
      title: '网页版',
      desc: '使用浏览器访问 Claude',
      descLine2: '完整的对话体验',
      button: '登录 Claude',
    },
    claudeCode: {
      label: 'CLAUDE CODE',
      title: '命令行版',
      desc: '通过 OAuth 使用网页版账号登录',
      descLine2: '真实可靠的官网原版',
      step1: '打开终端，运行',
      step2: '选择',
      step2method: 'Use OAuth',
      step2suffix: '登录方式',
      step3: '浏览器自动打开授权页面',
      step4: '授权完成后返回终端即可',
    },
  },
  titlebar: {
    networkOk: '网络正常',
    networkError: '网络异常',
    logout: '登出',
  },
  brand: {
    name: 'OriginAI',
    taglineCn: '享受极致的AI体验',
    taglineEn: 'THE ULTIMATE AI EXPERIENCE',
  },
}
```

- [ ] **Step 2: Create en.ts translations**

```ts
export const en = {
  login: {
    welcome: 'Welcome Back',
    subtitle: 'Sign in to continue with OriginAI',
    email: 'Email',
    password: 'Password',
    submit: 'Sign In',
    noAccount: "Don't have an account?",
    register: 'Register on website',
  },
  network: {
    title: 'Network Optimization Required',
    subtitle: 'Cannot access Claude services with current network.',
    subtitleLine2: 'Network optimization is required to continue.',
    permissionTitle: 'System Permission',
    permissionDesc: 'Network configuration permission required',
    configuring: 'Configuring...',
    stepDetect: 'Detect network environment',
    stepFetch: 'Fetch configuration',
    stepApply: 'Apply network optimization...',
    stepVerify: 'Verify connection',
    autoRedirect: 'Will automatically proceed when complete',
  },
  main: {
    claudeWeb: {
      label: 'CLAUDE WEB',
      title: 'Web Version',
      desc: 'Access Claude via browser',
      descLine2: 'Full conversation experience',
      button: 'Login to Claude',
    },
    claudeCode: {
      label: 'CLAUDE CODE',
      title: 'CLI Version',
      desc: 'Login with web account via OAuth',
      descLine2: 'Authentic official experience',
      step1: 'Open terminal, run',
      step2: 'Select',
      step2method: 'Use OAuth',
      step2suffix: 'login method',
      step3: 'Browser opens authorization page',
      step4: 'Return to terminal after authorization',
    },
  },
  titlebar: {
    networkOk: 'Connected',
    networkError: 'Network Error',
    logout: 'Logout',
  },
  brand: {
    name: 'OriginAI',
    taglineCn: '享受极致的AI体验',
    taglineEn: 'THE ULTIMATE AI EXPERIENCE',
  },
}
```

- [ ] **Step 3: Create i18n context**

Create `src/renderer/src/i18n/context.tsx`:

```tsx
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
```

- [ ] **Step 4: Create LanguageSwitcher component**

Create `src/renderer/src/components/LanguageSwitcher.tsx`:

```tsx
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
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: i18n with zh/en translations and language switcher"
```

---

### Task 6: Titlebar component

**Files:**
- Create: `src/renderer/src/components/Titlebar.tsx`

- [ ] **Step 1: Create Titlebar component**

```tsx
import { useLocale } from '@/i18n/context'
import { VscPower } from 'react-icons/vsc'

interface TitlebarProps {
  showAccount: boolean
  showIndicator: boolean
  networkOk?: boolean
  onLogout?: () => void
}

export function Titlebar({ showAccount, showIndicator, networkOk = true, onLogout }: TitlebarProps) {
  const { t } = useLocale()
  const isMac = window.electronAPI?.platform === 'darwin'

  const indicator = showIndicator && (
    <div className="flex items-center gap-1.5 ml-2.5">
      <div
        className={`w-[7px] h-[7px] rounded-full ${
          networkOk
            ? 'bg-green-500 shadow-[0_0_4px_rgba(40,200,64,0.4)]'
            : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]'
        }`}
      />
      <span className="text-[11px] text-text-muted font-mono">
        {networkOk ? t.titlebar.networkOk : t.titlebar.networkError}
      </span>
    </div>
  )

  const account = showAccount && (
    <div className="flex items-center gap-2.5 text-text-secondary text-[11px] font-mono">
      <span>user@example.com</span>
      <span className="text-text-faint">·</span>
      <span className="text-brand">Pro Plan</span>
      <button
        onClick={onLogout}
        className="text-text-faint hover:text-text-secondary transition-colors cursor-pointer"
        title={t.titlebar.logout}
      >
        <VscPower size={14} />
      </button>
    </div>
  )

  return (
    <div
      className="flex items-center justify-between px-4 h-9 bg-black/[0.02] border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {isMac && <div className="w-[68px]" />}
        {isMac && indicator}
        {!isMac && account}
      </div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {isMac && account}
        {!isMac && indicator}
        {!isMac && <div className="w-[138px]" />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify titlebar renders**

Temporarily use `<Titlebar showAccount showIndicator />` in App.tsx and run `pnpm dev`. Check that traffic lights don't overlap the titlebar content on macOS, and the drag area works.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: custom titlebar with platform-aware layout and network indicator"
```

---

### Task 7: LoginPage

**Files:**
- Create: `src/renderer/src/pages/LoginPage.tsx`

- [ ] **Step 1: Create LoginPage component**

```tsx
import { useLocale } from '@/i18n/context'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import logoImg from '@/assets/logo.png'

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
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: login page with branding, mock auth form, and language switcher"
```

---

### Task 8: NetworkSetupPage

**Files:**
- Create: `src/renderer/src/pages/NetworkSetupPage.tsx`

- [ ] **Step 1: Create NetworkSetupPage component**

```tsx
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/context'
import { VscLock } from 'react-icons/vsc'
import { PiWarningBold } from 'react-icons/pi'

interface NetworkSetupPageProps {
  onComplete: () => void
}

export function NetworkSetupPage({ onComplete }: NetworkSetupPageProps) {
  const { t } = useLocale()
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState(0) // 0-3

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setTimeout(onComplete, 500)
          return 100
        }
        return prev + 2
      })
    }, 60)
    return () => clearInterval(interval)
  }, [onComplete])

  useEffect(() => {
    if (progress < 25) setStep(0)
    else if (progress < 50) setStep(1)
    else if (progress < 80) setStep(2)
    else setStep(3)
  }, [progress])

  const steps = [
    t.network.stepDetect,
    t.network.stepFetch,
    t.network.stepApply,
    t.network.stepVerify,
  ]

  const stepIcon = (i: number) => {
    if (i < step) return '✓'
    if (i === step) return '◎'
    return '○'
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-12 py-8">
      {/* Warning icon */}
      <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mb-5">
        <PiWarningBold size={24} className="text-yellow-500" />
      </div>

      <h2 className="font-serif text-xl text-text mb-1.5">{t.network.title}</h2>
      <p className="text-[13px] text-text-muted mb-7 text-center leading-relaxed">
        {t.network.subtitle}
        <br />
        {t.network.subtitleLine2}
      </p>

      {/* Config card */}
      <div className="w-full max-w-[380px] bg-bg-card rounded-xl border border-border p-5 mb-4">
        <div className="flex items-center gap-3 mb-3.5">
          <div className="w-8 h-8 rounded-lg bg-bg-alt flex items-center justify-center shrink-0">
            <VscLock size={16} className="text-brand" />
          </div>
          <div>
            <div className="text-[13px] text-text font-medium">{t.network.permissionTitle}</div>
            <div className="text-[11px] text-text-muted">{t.network.permissionDesc}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-3.5">
          <div className="flex justify-between text-[11px] text-text-muted mb-1.5 font-mono">
            <span>{t.network.configuring}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-[3px] bg-bg-alt rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="text-[11px] text-text-faint font-mono leading-[1.8]">
          {steps.map((label, i) => (
            <div key={i}>
              {stepIcon(i)} {label}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-text-faint">{t.network.autoRedirect}</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: network setup page with mock progress animation"
```

---

### Task 9: MainPage

**Files:**
- Create: `src/renderer/src/pages/MainPage.tsx`

- [ ] **Step 1: Create MainPage component**

```tsx
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

          {/* Steps */}
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
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: main page with Claude Web button and Claude Code tutorial"
```

---

### Task 10: App.tsx — page routing with AnimatePresence

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Wire up all pages in App.tsx**

```tsx
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
```

- [ ] **Step 2: Update main.tsx to wrap with LocaleProvider removed (it's in App now)**

`main.tsx` should just render `<App />` — LocaleProvider is already inside App.tsx:

```tsx
import './globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 3: Full integration test**

```bash
pnpm dev
```

Test the full flow:
1. Login page loads with branding on left, form on right
2. Language switcher at bottom-right toggles zh/en, persists on reload
3. Click "登录" → fades to main page (if `MOCK_NETWORK_OK = true`)
4. Main page: titlebar shows indicator (green dot + "网络正常") and account info
5. Click logout icon → fades back to login page
6. Change `MOCK_NETWORK_OK` to `false`, click login → network setup page with progress animation → auto-proceeds to main page

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire up page routing with fade transitions and full app flow"
```

---

### Task 11: Final polish and cleanup

**Files:**
- Modify: various files as needed

- [ ] **Step 1: Add .gitignore entries**

Ensure `.gitignore` includes:

```
node_modules
out
dist
.superpowers
```

- [ ] **Step 2: Visual polish pass**

Run `pnpm dev` and verify:
- Traffic light position doesn't overlap content on macOS
- Titlebar drag area works correctly (buttons are no-drag)
- All text uses correct fonts (serif for titles, mono for labels, sans for body)
- Colors match the mockups
- Fade transitions are smooth
- Logo image loads correctly on login page

Fix any spacing, alignment, or visual issues found.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final polish and cleanup"
```
