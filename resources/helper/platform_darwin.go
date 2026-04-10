//go:build darwin

package main

import (
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

func isProxySet(port int) bool {
	out, err := exec.Command("scutil", "--proxy").Output()
	if err != nil {
		return false
	}
	s := string(out)
	httpEnabled := regexp.MustCompile(`HTTPEnable\s*:\s*1`).MatchString(s)
	portMatch := regexp.MustCompile(`HTTPPort\s*:\s*(\d+)`).FindStringSubmatch(s)
	return httpEnabled && len(portMatch) > 1 && portMatch[1] == fmt.Sprintf("%d", port)
}

func clearSystemProxy(port int) {
	fmt.Println("[helper] clearing system proxy on macOS")

	out, err := exec.Command("networksetup", "-listallnetworkservices").Output()
	services := []string{"Wi-Fi", "Ethernet"}
	if err == nil {
		lines := strings.Split(string(out), "\n")
		var parsed []string
		for _, line := range lines[1:] {
			s := strings.TrimSpace(line)
			if s != "" && !strings.HasPrefix(s, "*") {
				parsed = append(parsed, s)
			}
		}
		if len(parsed) > 0 {
			services = parsed
		}
	}

	for _, svc := range services {
		exec.Command("networksetup", "-setwebproxystate", svc, "off").Run()
		exec.Command("networksetup", "-setsecurewebproxystate", svc, "off").Run()
		fmt.Printf("[helper] proxy disabled on: %s\n", svc)
	}
}

func showDialog() {
	title, body := dialogMsg()
	// Escape double quotes and use \n for osascript
	escaped := strings.ReplaceAll(body, "\n", "\\n")
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	script := fmt.Sprintf(`display dialog "%s" with title "%s" buttons {"OK"} default button "OK" with icon caution`, escaped, title)
	exec.Command("osascript", "-e", script).Run()
}
