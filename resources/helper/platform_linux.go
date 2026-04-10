//go:build linux

package main

import (
	"fmt"
	"os/exec"
	"strings"
)

func isProxySet(port int) bool {
	out, err := exec.Command("gsettings", "get", "org.gnome.system.proxy", "mode").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "manual")
}

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on Linux")
	exec.Command("gsettings", "set", "org.gnome.system.proxy", "mode", "none").Run()
	fmt.Println("[helper] Linux proxy cleared")
}

func showDialog() {
	_, body := dialogMsg()
	if err := exec.Command("zenity", "--warning", "--title=OriginAI", "--text="+body).Run(); err != nil {
		if err := exec.Command("kdialog", "--sorry", body, "--title", "OriginAI").Run(); err != nil {
			exec.Command("xmessage", "-center", body).Run()
		}
	}
}
