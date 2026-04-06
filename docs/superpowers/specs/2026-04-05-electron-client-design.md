# OriginAI Electron Client — Design Spec

## Overview

OriginAI 桌面客户端，为用户提供 Claude Web 和 Claude Code 的网络优化与登录引导。当前阶段为 UI 壳子，所有功能（auth、网络优化、登录）使用 mock 数据。

## Tech Stack

- **Electron** — 桌面应用框架
- **electron-vite** — 构建工具（Vite 驱动，快速 HMR）
- **React** — UI 框架（与 originai-web 一致）
- **TypeScript** — 类型安全
- **Tailwind CSS** — 样式（复用 originai-web 设计 token）
- **Framer Motion** — 页面过渡动画（fade in/out）
- **react-icons** — 图标库

## Window

- **尺寸**: 800 × 540，固定大小，不可调整
- **外观**: 无边框窗口（frameless），自定义标题栏
- **标题栏**:
  - macOS：左侧红绿灯窗口控件；Windows：右侧窗口控件
  - 窗口控件旁（主页面）：网络状态指示灯（绿/红圆点）+ 灰色小字状态文本
  - 对侧：账户信息（邮箱 · Plan · 登出图标）— 登录后显示
- **拖拽区域**: 标题栏整体可拖拽

## Design Language

与 originai-web 保持一致：

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| bg | `#faf8f5` | 主背景 |
| bg-card | `#ffffff` | 卡片背景 |
| bg-alt | `#f3f0eb` | 次要背景、渐变起点 |
| border | `rgba(0,0,0,0.06)` | 细分割线 |
| border-strong | `rgba(0,0,0,0.10)` | 输入框边框 |
| brand | `#9b7b5a` | 品牌色（按钮、强调） |
| brand-light | `rgba(155,123,90,0.08)` | 品牌色低透明度 |
| text | `#2c2c2c` | 主文本 |
| text-secondary | `#6b6560` | 次要文本 |
| text-muted | `#9a9490` | 弱文本 |
| text-faint | `#b8b2aa` | 最弱文本 |
| dark | `#2c2520` | 深色背景 |

### Typography
- **衬线**: `'Noto Serif SC', Georgia, serif` — 标题、品牌文字
- **无衬线**: `-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif` — 正文
- **等宽**: `'IBM Plex Mono', Menlo, monospace` — 标签、代码、状态文字

### Styling
- 圆角: 8px（按钮、输入框）、12px（卡片）、50%（圆形图标）
- 阴影: 极简，几乎不使用
- 过渡: Framer Motion fade，300-500ms

## Assets

从 `../originai-assets` 引用：
- `logo.png` (750×750) — 登录页左侧品牌展示
- `icon.png` (500×500) — 应用图标
- `icon-transparent.png` (500×500) — 透明背景图标
- `favicon/` — 各平台图标集

## i18n

- 支持语言：简体中文（zh）、English（en）
- 切换位置：登录页右下角 `中 / EN` 切换器
- 持久化：localStorage，全局生效
- 实现方式：React Context（与 originai-web 一致的 i18n 架构）
- 翻译键结构按页面组织：`login.*`、`network.*`、`main.*`、`titlebar.*`

## Pages

### Page 1: Login（登录页）

**布局**: 左右分栏，各占 50%

**左半屏 — 品牌展示**:
- 渐变背景 `linear-gradient(135deg, #f3f0eb, #faf8f5)`
- `logo.png` 图片居中
- "OriginAI" 品牌名（衬线，28px，品牌色）
- "享受极致的AI体验" 中文宣传语（衬线，13px，muted）
- "THE ULTIMATE AI EXPERIENCE" 英文宣传语（等宽，11px，faint）

**右半屏 — Auth 表单**（mock）:
- 标题 "欢迎回来"（衬线，20px）
- 副标题 "登录以继续使用 OriginAI"（13px，muted）
- 邮箱输入框（mock）
- 密码输入框（mock）
- "登录" 按钮（品牌色背景，白色文字，8px 圆角）
- "还没有账户？前往官网注册" — 注册为链接，跳转官网

**标题栏**: 仅窗口控件，无 indicator，无账户信息

**右下角**: 语言切换器 `中 / EN`

### Page 2: Network Setup（网络优化，条件性）

**触发条件**: 登录后检测网络，异常时强制显示；正常时跳过直接进主页面

**布局**: 居中单栏

**内容**:
- 警告图标（黄色圆形背景 + 三角警告 SVG）
- 标题 "网络环境需要优化"（衬线，20px）
- 说明文字（检测到无法访问 Claude，需要配置）
- 配置卡片（白色背景，12px 圆角）:
  - 锁图标 + "系统权限请求" + 说明
  - 进度条（品牌色）+ 百分比
  - 步骤状态列表：✓ 完成 / ◎ 进行中 / ○ 等待
- 底部提示 "配置完成后将自动进入主页面"

**标题栏**: 窗口控件 + 右侧账户信息（已登录），无 indicator

**行为**: 全部 mock，完成后 fade 到主页面

### Page 3: Main（主页面）

**布局**: 左右分栏，各占 50%，两栏内容垂直居中

**左栏 — Claude Web**:
- "CLAUDE WEB" 标签（等宽，11px，faint，大写）
- "网页版" 标题（衬线，18px）
- "使用浏览器访问 Claude / 完整的对话体验" 说明（13px，muted）
- 地球图标（64px 圆角方形，渐变背景）
- "登录 Claude" 按钮（品牌色，8px 圆角）
- 按钮当前为 mock，后续接浏览器插件 magic link

**右栏 — Claude Code**:
- "CLAUDE CODE" 标签（等宽，11px，faint，大写）
- "命令行版" 标题（衬线，18px）
- "通过 OAuth 使用网页版账号登录 / 真实可靠的官网原版" 说明（13px，muted）
- 步骤教程（左对齐，整体居中）:
  1. 打开终端，运行 `claude login`
  2. 选择 `Use OAuth` 登录方式
  3. 浏览器自动打开授权页面
  4. 授权完成后返回终端即可

**分割**: 左右栏之间细灰线 `rgba(0,0,0,0.06)`

**标题栏**:
- 窗口控件旁：绿色指示灯（7px，带 glow） + 灰色 "网络正常"（11px，等宽）
- 对侧：`user@example.com · Pro Plan ⏻`

## Page Flow

```
Login → [网络检测]
          ├─ 正常 → fade → Main
          └─ 异常 → fade → Network Setup → fade → Main
```

**过渡动画**: Framer Motion `AnimatePresence`，fade in/out，300ms

## Navigation Model

- 线性流程，不可回退
- 登出后回到登录页
- 无导航栏/侧边栏/路由历史

## Platform Considerations

### macOS
- 窗口控件在左上角（红绿灯）
- 网络 indicator 紧挨窗口控件右侧
- 账户信息在右上角
- 网络优化：请求系统权限（mock）

### Windows
- 窗口控件在右上角（最小化/最大化/关闭）
- 网络 indicator 紧挨窗口控件左侧
- 账户信息在左上角
- 网络优化：需要管理员权限启动（mock）

## Project Structure

```
originai-app/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── resources/              # App icons from originai-assets
│   ├── icon.png
│   └── icon-transparent.png
├── src/
│   ├── main/               # Electron main process
│   │   └── index.ts        # Window creation, IPC, platform detection
│   ├── preload/             # Preload scripts
│   │   └── index.ts         # Context bridge for IPC
│   └── renderer/            # React app
│       ├── index.html
│       ├── main.tsx         # Entry point
│       ├── App.tsx          # Root component with AnimatePresence
│       ├── assets/          # Logo images
│       ├── components/
│       │   ├── Titlebar.tsx         # Custom titlebar
│       │   ├── NetworkIndicator.tsx # Green/red dot + status text
│       │   ├── AccountInfo.tsx      # Email · Plan · Logout
│       │   ├── LanguageSwitcher.tsx # 中/EN toggle
│       │   └── StepList.tsx         # Numbered tutorial steps
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── NetworkSetupPage.tsx
│       │   └── MainPage.tsx
│       ├── i18n/
│       │   ├── context.tsx  # LocaleProvider + useLocale hook
│       │   ├── zh.ts        # 简体中文
│       │   └── en.ts        # English
│       ├── hooks/
│       │   └── usePlatform.ts  # Detect macOS/Windows for layout
│       └── styles/
│           └── globals.css  # Tailwind + design tokens
```

## Mock Strategy

当前阶段所有功能均为 mock：

| Feature | Mock Behavior |
|---------|---------------|
| Auth | 点击登录按钮 → 直接进入下一页 |
| 注册链接 | `window.open()` 跳转官网 |
| 网络检测 | 硬编码返回正常/异常（可通过变量切换） |
| 网络优化 | 模拟进度条动画，3秒后完成 |
| 系统权限 | 不实际请求，UI 展示 mock 状态 |
| 账户信息 | 硬编码 `user@example.com` / `Pro Plan` |
| 登出 | 回到登录页 |
| Claude Web 按钮 | mock，无实际行为 |
| 语言切换 | 实际工作，localStorage 持久化 |
