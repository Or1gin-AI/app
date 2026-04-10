//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

var psMarkerRe = regexp.MustCompile(`\n?# >>> OriginAI Proxy >>>[\s\S]*?# <<< OriginAI Proxy <<<\n?`)

func clearShellProxy() {
	// Clear env vars via setx
	for _, v := range []string{"http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY"} {
		exec.Command("setx", v, "").Run()
	}
	fmt.Println("[helper] cleared env vars via setx")

	// Clean PowerShell profiles
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	psProfiles := []string{
		filepath.Join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
		filepath.Join(home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
	}
	for _, path := range psProfiles {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		cleaned := psMarkerRe.ReplaceAll(data, []byte("\n"))
		if len(cleaned) != len(data) {
			os.WriteFile(path, cleaned, 0644)
			fmt.Printf("[helper] cleaned proxy from: %s\n", path)
		}
	}
}
