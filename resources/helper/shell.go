//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var shellProfiles = []string{
	".zshenv",
	".zshrc",
	".bashrc",
	".bash_profile",
	".profile",
	filepath.Join(".config", "fish", "config.fish"),
}

var markerRe = regexp.MustCompile(`\n?# >>> OriginAI Proxy >>>[\s\S]*?# <<< OriginAI Proxy <<<\n?`)

func clearShellProxy() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	for _, rel := range shellProfiles {
		path := filepath.Join(home, rel)
		data, err := os.ReadFile(path)
		if err != nil {
			continue // file doesn't exist or can't read
		}
		cleaned := markerRe.ReplaceAll(data, []byte("\n"))
		if len(cleaned) != len(data) {
			os.WriteFile(path, cleaned, 0644)
			fmt.Printf("[helper] cleaned proxy from: %s\n", path)
		}
	}
}
