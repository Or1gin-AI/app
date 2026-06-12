# Changelog

## v1.4.3 - 2026-06-12

### 中文

- 海外白名单用户直连：启用网络优化时，若检测到出口 IP 已在海外，则跳过日本专线网关，直接走代理，连接更快、链路更短。
- 代理环境注入优化：不再向 `.zshenv` 写入代理变量（它会被所有 zsh 进程包括非交互式脚本读取，应用关闭后易导致脚本网络中断）；不再注入 `all_proxy`/`ALL_PROXY`（Codex 等基于 reqwest 的桌面应用认 `HTTPS_PROXY` 即可路由，已实测验证）。旧版本写入的这两项会在启用、退出、启动时自动清理。

### English

- Direct routing for overseas whitelist users: when network optimization is enabled and the exit IP is detected to already be overseas, the Japan gateway is skipped and traffic goes through the proxy directly — fewer hops, faster connection.
- Proxy-env injection cleanup: stopped writing proxy variables into `.zshenv` (it is sourced by every zsh process including non-interactive scripts, which break once the app is closed); stopped injecting `all_proxy`/`ALL_PROXY` (reqwest-based desktop apps such as Codex route fine via `HTTPS_PROXY`, verified empirically). Both legacy entries are cleaned up automatically on enable, quit, and startup.

## v1.4.2 - 2026-06-05

### 中文

- 新增桌面应用代理支持：启用网络优化时，自动向 macOS 图形会话注入代理环境变量（`launchctl setenv`），使 Claude Desktop、Codex 等不读取系统代理的桌面应用也能走代理；关闭网络优化或退出应用时自动清除。
- 主界面新增提示：启用网络优化后，Claude Desktop、Codex Desktop 等桌面应用可能需要重启后才会走代理。
- 自动更新检查间隔由每小时缩短为每 2 分钟，客户端可更快获取新版本。

### English

- Added desktop-app proxy coverage: when network optimization is enabled, proxy environment variables are now injected into the macOS GUI session (`launchctl setenv`), so desktop apps that ignore the system proxy — such as Claude Desktop and Codex — also route through the proxy. They are cleared automatically when optimization is turned off or the app quits.
- Added an in-app notice that desktop apps such as Claude Desktop and Codex Desktop may need to be restarted after enabling network optimization before they use the proxy.
- Reduced the auto-update check interval from hourly to every 2 minutes so clients pick up new releases faster.

## v0.2.6 - 2026-04-13

### 中文

- 修复注册后首次邮箱验证码偶发收不到的问题。注册成功后不再复用已被 `signUp` 消耗的 Turnstile token，而是等验证页拿到新的 token 后再自动发送第一封验证码。
- 调整验证码提示文案。只有真正发送成功后才显示“验证码已发送”，避免首发失败时误导用户去邮箱里查找。

### English

- Fixed the intermittent issue where the first email verification code after sign-up was not delivered. The app no longer reuses the Turnstile token consumed by `signUp`; it now waits for a fresh token on the OTP screen before sending the initial code.
- Updated OTP messaging so the UI only reports success after the first verification email has actually been sent, avoiding misleading prompts when the initial send fails.

## v0.2.1 - 2026-04-10

### 中文

- 为 macOS 发布链路接入正式签名与公证配置。构建现在会使用 `Developer ID Application` 证书进行签名，并通过 App Store Connect API key 完成 notarization。
- 在 electron-builder 配置中启用 `hardenedRuntime` 和 macOS entitlements，补齐自动更新与 Gatekeeper 所需的基础签名参数。
- 更新 GitHub Actions 的 macOS 发布流程，支持从仓库 secrets 注入 `CSC_LINK` / `CSC_KEY_PASSWORD` 以及 Apple API key 文件。

### English

- Added production macOS signing and notarization to the release pipeline. macOS builds now sign with a `Developer ID Application` certificate and notarize through an App Store Connect API key.
- Enabled `hardenedRuntime` and macOS entitlements in electron-builder so the packaged app has the baseline signing settings required by Gatekeeper and auto update.
- Updated the GitHub Actions macOS release job to consume `CSC_LINK` / `CSC_KEY_PASSWORD` and the Apple API key file from repository secrets.

## v0.2.0 - 2026-04-10

### 中文

- 重做网络环境检测页。现在会直连检测出口 IP，并增加超时与备用服务，避免大陆网络环境下一直转圈。
- 简化网络优化流程。移除前置代理选择与本地端口扫描，要求用户先关闭系统代理；若仍是中国大陆出口，则提示开启 TUN mode 后重新检测。
- 恢复 sidecar 白名单分流。只有 Claude / Anthropic / Datadog / Sentry / Statsig / Intercom / `ipify` 等命中域名走代理，未命中的站点保持直连，本地公网 IP 检测重新可用。
- 加快 session 失效检测。主进程会立即首检并每 10 秒复查一次，401/403 时立刻清理本地会话并强制退回登录页。
- 优化订阅状态刷新。购买套餐后会更快刷新 plan 与账户状态；新用户在从免费升级为付费后会自动进入 onboarding，老用户则保留在正常商店页。

### English

- Reworked the network environment check page. It now detects the exit IP over a direct connection with explicit timeouts and fallback services, avoiding indefinite loading on mainland China networks.
- Simplified the network optimization flow. Upstream proxy selection and local port scanning were removed; users must disable any system proxy first, and if the exit IP is still in mainland China the app now asks them to enable TUN mode and re-check.
- Restored whitelist-based sidecar routing. Only Claude / Anthropic / Datadog / Sentry / Statsig / Intercom / `ipify` and related matches go through the proxy, while unmatched traffic stays direct so local public IP detection works again.
- Accelerated session invalidation checks. The main process now performs an immediate first check and revalidates every 10 seconds; 401/403 responses immediately clear the local session and return the user to login.
- Improved subscription refresh behavior. Plan and account state now refresh faster after purchase; new users automatically enter onboarding when upgrading from free to a paid plan, while existing users stay on the regular store page.

## v0.1.6 - 2026-04-10

### 中文

- 新增应用单例模式。重复启动时不会再创建第二个实例，而是恢复并聚焦现有窗口。
- 更新网络 sidecar 到当前最新方案，远端出站切换为 `Shadowsocks + WS + TLS`，目标为 `p.originai.cc:443`，路径为 `/update`。
- 保持本地代理入口为 `HTTP 21911` 与 `SOCKS 21910`，避免影响现有系统代理清理与 helper 恢复链路。
- 增强前置代理探测逻辑，支持自动识别 `HTTP` / `SOCKS`，并用于手动输入和本地端口扫描。
- 优化路由规则，采用 `geosite:cn` 与 `geoip:cn/private` 直连，其余 `TCP/UDP` 流量走代理。
- 保留并发布此前的网络修复，包括 Windows helper 弹窗置顶、代理验证稳定性改进，以及 helper watchdog 崩溃恢复链路。

### English

- Added single-instance mode. Launching the app again now restores and focuses the existing window instead of creating a second instance.
- Updated the network sidecar to the latest setup, switching the remote outbound to `Shadowsocks + WS + TLS` via `p.originai.cc:443` with path `/update`.
- Kept the local proxy entrypoints at `HTTP 21911` and `SOCKS 21910` so the existing system-proxy cleanup and helper recovery flow remains intact.
- Improved upstream proxy probing with automatic `HTTP` / `SOCKS` detection for both manual input and local port scanning.
- Updated routing to send `geosite:cn` and `geoip:cn/private` directly while routing all other `TCP/UDP` traffic through the proxy.
- Includes the previously completed network fixes: topmost Windows helper dialog behavior, more stable tunnel verification, and the helper watchdog crash-recovery flow.
