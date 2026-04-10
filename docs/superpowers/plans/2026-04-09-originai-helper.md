# originai-helper Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight Go watchdog binary that monitors the Electron main process and performs crash recovery (clear system proxy, kill xray, notify user).

**Architecture:** Go binary receives PID/port/xray-pid via CLI args, polls PID every second, triggers platform-specific recovery on death. Electron spawns it after sidecar starts, kills it on normal shutdown.

**Tech Stack:** Go 1.21+, platform build tags for macOS/Windows, electron-builder extraResources

---

### Task 1: Go project scaffold and main loop

**Files:**
- Create: `resources/helper/go.mod`
- Create: `resources/helper/main.go`

- [ ] **Step 1: Create go.mod**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper
go mod init originai-helper
```

This creates `go.mod` with module name `originai-helper`.

- [ ] **Step 2: Create main.go**

```go
package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	pid := flag.Int("pid", 0, "Main process PID to monitor")
	port := flag.Int("port", 21911, "Proxy port to clean up")
	xrayPid := flag.Int("xray-pid", 0, "Xray process PID to kill")
	flag.Parse()

	if *pid == 0 {
		fmt.Fprintln(os.Stderr, "usage: originai-helper --pid <PID> --port <PORT> --xray-pid <XRAY_PID>")
		os.Exit(1)
	}

	fmt.Printf("[helper] watching pid=%d port=%d xray-pid=%d\n", *pid, *port, *xrayPid)

	for {
		time.Sleep(1 * time.Second)
		if !processAlive(*pid) {
			fmt.Printf("[helper] pid %d is gone, starting recovery\n", *pid)
			clearSystemProxy(*port)
			if *xrayPid > 0 {
				killProcess(*xrayPid)
			}
			showDialog()
			fmt.Println("[helper] recovery complete, exiting")
			os.Exit(0)
		}
	}
}
```

- [ ] **Step 3: Verify it compiles (will fail — missing functions, that's expected)**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper
go build -o /dev/null . 2>&1 || echo "Expected: missing functions"
```

- [ ] **Step 4: Commit**

```bash
git add resources/helper/go.mod resources/helper/main.go
git commit -m "feat(helper): scaffold Go project with main loop and CLI args"
```

---

### Task 2: Cross-platform process checking and killing

**Files:**
- Create: `resources/helper/process.go`

- [ ] **Step 1: Create process.go**

This uses `os.FindProcess` + signal 0 on Unix, and `OpenProcess` on Windows via build tags. Since we need cross-platform from a single file (no Windows-only syscalls on macOS), use the portable approach: `os.FindProcess` + `Signal(0)` works on Unix; on Windows `FindProcess` always succeeds so we use `tasklist` as a fallback.

Actually, simpler: use build tags.

Create `resources/helper/process.go`:

```go
//go:build !windows

package main

import (
	"fmt"
	"os"
	"syscall"
)

func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func killProcess(pid int) {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	fmt.Printf("[helper] killing process %d\n", pid)
	_ = proc.Signal(syscall.SIGTERM)
	// Give it a moment, then force kill
	time.Sleep(2 * time.Second)
	_ = proc.Kill()
}
```

Wait — need to import time. Let me write it properly:

```go
//go:build !windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(syscall.Signal(0))
	return err == nil
}

func killProcess(pid int) {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	fmt.Printf("[helper] killing process %d\n", pid)
	_ = proc.Signal(syscall.SIGTERM)
	time.Sleep(2 * time.Second)
	_ = proc.Kill()
}
```

- [ ] **Step 2: Create process_windows.go**

Create `resources/helper/process_windows.go`:

```go
//go:build windows

package main

import (
	"fmt"
	"os"
	"time"
)

func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// On Windows, FindProcess always succeeds. Try to signal.
	// If the process doesn't exist, Kill returns an error.
	// Use a non-destructive check: open the process handle.
	err = proc.Signal(os.Kill)
	if err != nil {
		// Process doesn't exist or access denied
		// Try another approach: just check if we can find it
		return false
	}
	// Oops, we just killed it. That's not what we want.
	// Better approach: use syscall.OpenProcess
	return true
}
```

Actually, the Windows approach needs to use `windows.OpenProcess` to check without killing. Let me write it correctly:

```go
//go:build windows

package main

import (
	"fmt"
	"os"
	"time"
	"golang.org/x/sys/windows"
)
```

No — we don't want external dependencies. Use `syscall` directly:

```go
//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess = kernel32.NewProc("OpenProcess")
	procCloseHandle = kernel32.NewProc("CloseHandle")
)

const processQueryLimitedInfo = 0x1000

func processAlive(pid int) bool {
	handle, _, err := procOpenProcess.Call(
		uintptr(processQueryLimitedInfo),
		0,
		uintptr(pid),
	)
	if handle == 0 {
		_ = err
		return false
	}
	procCloseHandle.Call(handle)
	return true
}

func killProcess(pid int) {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	fmt.Printf("[helper] killing process %d\n", pid)
	_ = proc.Kill()
	_ = time.Now() // suppress unused import
}
```

Hmm, the `time` import isn't needed on Windows since `Kill()` is immediate. Let me clean this up:

```go
//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess = kernel32.NewProc("OpenProcess")
	procCloseHandle = kernel32.NewProc("CloseHandle")
)

const processQueryLimitedInfo = 0x1000

func processAlive(pid int) bool {
	handle, _, _ := procOpenProcess.Call(
		uintptr(processQueryLimitedInfo),
		0,
		uintptr(pid),
	)
	if handle == 0 {
		return false
	}
	procCloseHandle.Call(handle)
	return true
}

func killProcess(pid int) {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	fmt.Printf("[helper] killing process %d\n", pid)
	_ = proc.Kill()
}
```

- [ ] **Step 3: Verify compilation on macOS**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper
go build -o /dev/null . 2>&1 || echo "Still missing proxy/notify functions"
```

- [ ] **Step 4: Commit**

```bash
git add resources/helper/process.go resources/helper/process_windows.go
git commit -m "feat(helper): add cross-platform process alive check and kill"
```

---

### Task 3: macOS proxy cleanup and dialog

**Files:**
- Create: `resources/helper/platform_darwin.go`

- [ ] **Step 1: Create platform_darwin.go**

```go
//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on macOS")

	// Get all network services
	out, err := exec.Command("networksetup", "-listallnetworkservices").Output()
	services := []string{"Wi-Fi", "Ethernet"}
	if err == nil {
		lines := strings.Split(string(out), "\n")
		parsed := []string{}
		for _, line := range lines[1:] {
			s := strings.TrimSpace(line)
			if s != "" && !strings.HasPrefix(s, "*") {
				parsed = append(parsed, s)
			}
		}
		if len(parsed) > 0 {
			services = parsed
		}
	}

	for _, svc := range services {
		exec.Command("networksetup", "-setwebproxystate", svc, "off").Run()
		exec.Command("networksetup", "-setsecurewebproxystate", svc, "off").Run()
		fmt.Printf("[helper] proxy disabled on: %s\n", svc)
	}
}

func showDialog() {
	msg := "OriginAI 已异常退出，系统代理已自动恢复。\\n请立即停止使用 Claude 相关产品，并重新启动 OriginAI。"
	script := fmt.Sprintf(`display dialog "%s" with title "OriginAI" buttons {"OK"} default button "OK" with icon caution`, msg)
	exec.Command("osascript", "-e", script).Run()
}
```

- [ ] **Step 2: Verify full compilation on macOS**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper
go build -o /tmp/originai-helper .
echo "Build succeeded: $(file /tmp/originai-helper)"
```

- [ ] **Step 3: Quick manual smoke test**

```bash
# Start a sleep process to simulate the main app
sleep 300 &
FAKE_PID=$!
echo "Fake PID: $FAKE_PID"

# Start helper watching it
/tmp/originai-helper --pid $FAKE_PID --port 21911 &
HELPER_PID=$!

# Kill the fake process — helper should detect and run recovery
sleep 2
kill $FAKE_PID
wait $HELPER_PID 2>/dev/null
echo "Helper exited (expected: recovery triggered, dialog shown)"
```

- [ ] **Step 4: Commit**

```bash
git add resources/helper/platform_darwin.go
git commit -m "feat(helper): add macOS proxy cleanup and dialog notification"
```

---

### Task 4: Windows proxy cleanup and dialog

**Files:**
- Create: `resources/helper/platform_windows.go`

- [ ] **Step 1: Create platform_windows.go**

```go
//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"
)

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on Windows")

	// Set ProxyEnable = 0
	exec.Command("reg", "add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f").Run()

	// Delete ProxyServer
	exec.Command("reg", "delete",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyServer", "/f").Run()

	fmt.Println("[helper] Windows proxy cleared")
}

var (
	user32       = syscall.NewLazyDLL("user32.dll")
	procMessageBox = user32.NewProc("MessageBoxW")
)

const (
	mbOK          = 0x00000000
	mbIconWarning = 0x00000030
)

func showDialog() {
	title, _ := syscall.UTF16PtrFromString("OriginAI")
	msg, _ := syscall.UTF16PtrFromString("OriginAI 已异常退出，系统代理已自动恢复。\n请立即停止使用 Claude 相关产品，并重新启动 OriginAI。")
	procMessageBox.Call(
		0,
		uintptr(unsafe.Pointer(msg)),
		uintptr(unsafe.Pointer(title)),
		uintptr(mbOK|mbIconWarning),
	)
}
```

- [ ] **Step 2: Cross-compile for Windows to verify**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper
GOOS=windows GOARCH=amd64 go build -o /tmp/originai-helper.exe .
echo "Windows build: $(file /tmp/originai-helper.exe)"
```

- [ ] **Step 3: Commit**

```bash
git add resources/helper/platform_windows.go
git commit -m "feat(helper): add Windows proxy cleanup and MessageBox dialog"
```

---

### Task 5: Build helper binaries for all platforms

**Files:**
- Modify: (shell commands only, placing binaries into resources/sidecar/)

- [ ] **Step 1: Build all platform variants**

```bash
cd /Users/clck/Desktop/Workspace/originai-app/resources/helper

# macOS arm64
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o ../sidecar/darwin-arm64/originai-helper .

# macOS x64
GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o ../sidecar/darwin-x64/originai-helper .

# Windows x64
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../sidecar/win32-x64/originai-helper.exe .

# Linux x64 (if needed)
GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o ../sidecar/linux-x64/originai-helper .

# Linux arm64 (if needed)
GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o ../sidecar/linux-arm64/originai-helper .

echo "Built all variants"
ls -la ../sidecar/*/originai-helper*
```

- [ ] **Step 2: Commit binaries**

```bash
git add resources/sidecar/*/originai-helper*
git commit -m "build(helper): compile watchdog binaries for all platforms"
```

---

### Task 6: Integrate helper into Electron sidecar.ts

**Files:**
- Modify: `src/main/sidecar.ts`

- [ ] **Step 1: Add helper process management to sidecar.ts**

Add after the `killOrphanedSidecar` function (around line 379), before the system proxy section:

```typescript
// ── Helper (watchdog) process management ──

let helperProcess: ChildProcess | null = null

function getHelperBinary(): string {
  const platform = process.platform
  const binaryName = platform === 'win32' ? 'originai-helper.exe' : 'originai-helper'

  if (app.isPackaged) {
    return join(process.resourcesPath, 'sidecar', binaryName)
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return join(app.getAppPath(), 'resources', 'sidecar', `${platform}-${arch}`, binaryName)
}

export function startHelper(): void {
  stopHelper()
  const xrayPid = sidecarProcess?.pid
  if (!xrayPid) return

  const binary = getHelperBinary()
  if (!existsSync(binary)) {
    console.warn('[helper] binary not found:', binary)
    return
  }

  const args = [
    '--pid', String(process.pid),
    '--port', String(LOCAL_PORT),
    '--xray-pid', String(xrayPid),
  ]

  console.log('[helper] starting:', binary, args.join(' '))
  helperProcess = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  })

  helperProcess.stdout?.on('data', (d: Buffer) => console.log('[helper]', d.toString().trimEnd()))
  helperProcess.stderr?.on('data', (d: Buffer) => console.error('[helper]', d.toString().trimEnd()))
  helperProcess.on('exit', (code) => {
    console.log('[helper] exited with code', code)
    helperProcess = null
  })

  // Unref so helper doesn't prevent Electron from exiting
  helperProcess.unref()
}

export function stopHelper(): void {
  if (helperProcess) {
    const proc = helperProcess
    helperProcess = null
    try { proc.kill('SIGTERM') } catch { /* already dead */ }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/sidecar.ts
git commit -m "feat(helper): add startHelper/stopHelper to sidecar.ts"
```

---

### Task 7: Wire helper into main process lifecycle

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add startHelper/stopHelper to imports**

Update the import line to include `startHelper, stopHelper`:

```typescript
import { startSidecar, stopSidecar, isSidecarRunning, verifySidecar, onSidecarCrash, setSystemProxy, clearSystemProxy, setShellProxy, killOrphanedSidecar, updateOutboundPassword, checkSystemProxy, probePreProxy, getLocalPort, startHelper, stopHelper } from './sidecar'
```

- [ ] **Step 2: Start helper after sidecar starts**

In the `sidecar:start` handler, after `startProxyMonitor()`, add:

```typescript
    startHelper()
```

So the block becomes:
```typescript
    setShellProxy()
    scheduleProxyRefresh()
    startProxyMonitor()
    startHelper()
```

- [ ] **Step 3: Stop helper in sidecar:stop handler**

In the `sidecar:stop` handler, add `stopHelper()` after `stopProxyMonitor()`:

```typescript
  stopProxyMonitor()
  stopHelper()
  await stopSidecar()
```

- [ ] **Step 4: Stop helper in before-quit**

In the `before-quit` handler, add `stopHelper()`:

```typescript
app.on('before-quit', async () => {
  if (proxyRefreshTimer) { clearTimeout(proxyRefreshTimer); proxyRefreshTimer = null }
  stopProxyMonitor()
  stopHelper()
  await clearSystemProxy().catch(() => {})
  await stopSidecar()
})
```

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(helper): wire watchdog into main process lifecycle"
```
