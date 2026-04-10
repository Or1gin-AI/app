# Changelog

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
