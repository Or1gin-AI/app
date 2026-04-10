# originai-helper Watchdog Design

## Goal

A lightweight Go binary that monitors the main Electron process and performs crash recovery (clear system proxy, kill xray, notify user) when the main process dies unexpectedly.

## Problem

If the Electron app crashes or is force-killed, `before-quit` cleanup never runs. The system proxy stays pointed at our dead port (127.0.0.1:21911), causing the user's entire machine to lose internet access until they manually fix the proxy settings.

## Architecture

A single Go binary (`originai-helper`) launched as a child process by Electron. It receives the main process PID, proxy port, and xray PID as CLI args. It polls PID liveness every second. If the PID disappears, it triggers recovery.

## CLI Interface

```
originai-helper --pid <main-PID> --port <proxy-port> --xray-pid <xray-PID>
```

## Core Loop

```
1. Parse args
2. Every 1 second:
   a. Check if --pid process exists
   b. If alive → continue
   c. If dead → run recovery:
      i.   Clear system proxy (platform-specific)
      ii.  Kill xray process (--xray-pid, SIGTERM then SIGKILL)
      iii. Show native dialog notification
      iv.  Exit 0
```

## Platform-Specific Recovery

### System Proxy Cleanup

**macOS:**
- List network services via `networksetup -listallnetworkservices`
- For each service: `networksetup -setwebproxystate <svc> off` and `networksetup -setsecurewebproxystate <svc> off`

**Windows:**
- `reg add "HKCU\...\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`
- `reg delete "HKCU\...\Internet Settings" /v ProxyServer /f`

### Native Dialog

**macOS:** `osascript -e 'display dialog "..." with title "OriginAI" buttons {"OK"} default button "OK"'`

**Windows:** Win32 `MessageBoxW` via syscall (no CGo needed)

**Dialog text (zh):** "OriginAI 已异常退出，系统代理已自动恢复。请立即停止使用 Claude 相关产品，并重新启动 OriginAI。"

**Dialog text (en):** "OriginAI has crashed. System proxy has been automatically restored. Please stop using all Claude products immediately and restart OriginAI."

## File Structure

```
resources/helper/
├── main.go            # Entry: arg parsing + main loop
├── process.go         # Cross-platform PID check + kill
├── proxy_darwin.go    # macOS proxy cleanup
├── proxy_windows.go   # Windows proxy cleanup
├── notify_darwin.go   # macOS osascript dialog
├── notify_windows.go  # Windows MessageBoxW
├── go.mod
```

Build outputs: `resources/helper/{platform}-{arch}/originai-helper[.exe]`

## Electron Integration

### sidecar.ts additions

- `startHelper(mainPid, proxyPort, xrayPid)`: spawn helper binary, store ChildProcess ref
- `stopHelper()`: kill helper process (SIGTERM)

### index.ts integration points

- After `startSidecar()` succeeds → call `startHelper(process.pid, port, xrayProcess.pid)`
- In `sidecar:stop` handler → call `stopHelper()` before `stopSidecar()`
- In `before-quit` → call `stopHelper()` before cleanup

### Lifecycle

| Scenario | Helper behavior |
|---|---|
| Normal quit (`before-quit`) | Main process kills helper first → helper dies → no recovery |
| `sidecar:stop` (user stops optimization) | Main process kills helper → helper dies → no recovery |
| Main process crash / force-kill | Helper detects PID gone → recovery → exit |
| Helper itself crashes | No impact — main process still runs, `before-quit` still works |

## What We Don't Do

- Don't kill Claude processes (preserve user work)
- Don't clean TUN (we don't use TUN)
- Don't clean shell env vars (won't cause immediate breakage)
- Don't restart the main app (user should restart manually)
- Don't run as a persistent service/daemon (dies with or shortly after main process)
