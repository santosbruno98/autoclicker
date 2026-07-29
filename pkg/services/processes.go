package services

import (
	"bytes"
	"os/exec"
	"strconv"
	"strings"

	"autoclicker/pkg/models"
)

// ListProcesses returns a list of all running processes on the system
func ListProcesses() ([]models.ProcessInfo, error) {
	cmd := exec.Command("tasklist", "/FO", "CSV", "/NH")
	var out bytes.Buffer // Capture output
	cmd.Stdout = &out

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	lines := strings.Split(out.String(), "\n")
	var processes []models.ProcessInfo

	for _, line := range lines {
		parts := strings.Split(line, ",")
		if len(parts) >= 2 {
			name := strings.Trim(parts[0], `"`)
			pidStr := strings.Trim(parts[1], `"`)
			pid, err := strconv.Atoi(pidStr)
			if err == nil && pid > 0 {
				processes = append(processes, models.ProcessInfo{
					PID:  pid,
					Name: name,
				})
			}
		}
	}
	return processes, nil
}
