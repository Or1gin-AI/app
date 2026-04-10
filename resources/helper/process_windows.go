//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
)

var (
	kernel32         = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess  = kernel32.NewProc("OpenProcess")
	procCloseHandle  = kernel32.NewProc("CloseHandle")
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
