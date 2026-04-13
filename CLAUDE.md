# OriginAI Desktop Client

Electron 桌面客户端，提供网络代理优化和 SMS 验证服务。

## 技术栈

Electron 35 + electron-vite + React 19 + TypeScript + Tailwind CSS 4 + Framer Motion

## 项目结构

```
src/main/          # Electron 主进程（IPC、自动更新、sidecar 管理）
src/renderer/src/  # React UI
  ├── pages/       # 页面组件（LoginPage, MainPage, PlanPage 等）
  ├── components/  # 共享组件（Titlebar, TicketPanel 等）
  ├── i18n/        # 国际化（en.ts, zh.ts）
  └── lib/         # 工具函数
src/preload/       # contextBridge，暴露 window.electronAPI
resources/         # 图标、签名配置、平台 sidecar 二进制
```

## 架构要点

- **状态驱动路由**：无 React Router，用 `Page` 类型状态 + AnimatePresence 做页面切换
- **IPC 通信**：所有后端调用通过 `window.electronAPI.*`，preload 层桥接
- **国际化**：LocaleProvider (React Context)，支持 en/zh
- **自动更新**：electron-updater，从 GitHub Releases 拉取，启动时检查 + 每小时轮询

## 开发

```bash
pnpm dev          # electron-vite dev（HMR）
pnpm build        # electron-vite build
pnpm build:mac    # 构建 macOS 安装包
```

## 发版

1. 改 `package.json` 中 version
2. `git tag -a v0.x.x -m "changelog"`
3. `git push origin main && git push origin v0.x.x`
4. GitHub Actions 自动构建三平台（Mac/Win/Linux）并发布到 GitHub Releases
5. 客户端自动更新拉取新版本

当前版本：v0.2.2
