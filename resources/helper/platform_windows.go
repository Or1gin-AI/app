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

	exec.Command("reg", "add",
		`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		"/v", "ProxyEnable", "/t", "REG_DWORD", "/d", "0", "/f").Run()

	exec.Command("reg", "delete",
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
