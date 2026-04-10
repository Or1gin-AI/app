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
