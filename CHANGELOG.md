# Changelog

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
