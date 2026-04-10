//go:build linux

package main

import (
	"fmt"
	"os/exec"
)

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on Linux")
	exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "none").Run()
	fmt.Println("[helper] Linux proxy cleared")
}

func showDialog() {
	// Try zenity first (GNOME), fallback to kdialog (KDE), then xmessage
	msg := "OriginAI 已异常退出，系统代理已自动恢复。\n请立即停止使用 Claude 相关产品，并重新启动 OriginAI。"
	if err := exec.Command("zenity", "--warning", "--title=OriginAI", "--text="+msg).Run(); err != nil {
		if err := exec.Command("kdialog", "--sorry", msg, "--title", "OriginAI").Run(); err != nil {
			exec.Command("xmessage", "-center", msg).Run()
		}
	}
}
