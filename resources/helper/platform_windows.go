//go:build windows

package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

func isProxySet(port int) bool {
	cmd := hiddenCmd("reg", "query",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyServer")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	match := regexp.MustCompile(`ProxyServer\s+REG_SZ\s+(.+)`).FindStringSubmatch(string(out))
	expected := fmt.Sprintf("127.0.0.1:%d", port)
	return len(match) > 1 && strings.TrimSpace(match[1]) == expected
}

// hiddenCmd creates an exec.Cmd that won't show a console window on Windows
func hiddenCmd(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on Windows")

	hiddenCmd("reg", "add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f").Run()

	hiddenCmd("reg", "delete",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyServer", "/f").Run()

	fmt.Println("[helper] Windows proxy cleared")
}

var (
	user32         = syscall.NewLazyDLL("user32.dll")
	procMessageBox = user32.NewProc("MessageBoxW")
)

const (
	mbOK          = 0x00000000
	mbIconWarning = 0x00000030
	mbTopMost     = 0x00040000
	mbSetForeground = 0x00010000
)

func showDialog() {
	t, body := dialogMsg()
	titlePtr, _ := syscall.UTF16PtrFromString(t)
	msgPtr, _ := syscall.UTF16PtrFromString(body)
	procMessageBox.Call(
		0,
		uintptr(unsafe.Pointer(msgPtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		uintptr(mbOK|mbIconWarning|mbTopMost|mbSetForeground),
	)
}
