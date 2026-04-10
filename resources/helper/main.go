package main

import (
	"flag"
	"fmt"
	"os"
	"time"
)

var lang string

func main() {
	pid := flag.Int("pid", 0, "Main process PID to monitor")
	port := flag.Int("port", 21911, "Proxy port to clean up")
	xrayPid := flag.Int("xray-pid", 0, "Xray process PID to kill")
	flag.StringVar(&lang, "lang", "zh", "Dialog language (zh or en)")
	flag.Parse()

	if *pid == 0 {
		fmt.Fprintln(os.Stderr, "usage: originai-helper --pid <PID> --port <PORT> --xray-pid <XRAY_PID> [--lang zh|en]")
		os.Exit(1)
	}

	fmt.Printf("[helper] watching pid=%d port=%d xray-pid=%d lang=%s\n", *pid, *port, *xrayPid, lang)

	for {
		time.Sleep(1 * time.Second)
		if !processAlive(*pid) {
			fmt.Printf("[helper] pid %d is gone\n", *pid)

			// Wait for normal exit cleanup to finish (before-quit runs async)
			time.Sleep(2 * time.Second)

			// Check if system proxy is still set to our port.
			// If already cleared → normal exit happened → exit silently.
			// If still set → crash happened → run recovery.
			if !isProxySet(*port) {
				fmt.Println("[helper] proxy already cleared (normal exit), exiting silently")
				os.Exit(0)
			}

			fmt.Println("[helper] proxy still set (crash detected), starting recovery")
			clearSystemProxy(*port)
			clearShellProxy()
			if *xrayPid > 0 {
				killProcess(*xrayPid)
			}
			showDialog()
			fmt.Println("[helper] recovery complete, exiting")
			os.Exit(0)
		}
	}
}

func dialogMsg() (title string, body string) {
	if lang == "en" {
		return "OriginAI",
			"OriginAI has crashed unexpectedly. System proxy has been automatically restored.\n\nPlease stop using all Claude products immediately and restart OriginAI."
	}
	return "OriginAI",
		"OriginAI 已异常退出，系统代理已自动恢复。\n\n请立即停止使用 Claude 相关产品，并重新启动 OriginAI。"
}
