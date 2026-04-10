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
	fmt.Printf("[helper] killing process %d (SIGTERM)\n", pid)
	_ = proc.Signal(syscall.SIGTERM)
	time.Sleep(2 * time.Second)
	// Force kill if still alive
	if p2, err := os.FindProcess(pid); err == nil {
		if p2.Signal(syscall.Signal(0)) == nil {
			fmt.Printf("[helper] force killing process %d (SIGKILL)\n", pid)
			_ = p2.Kill()
		}
	}
}
