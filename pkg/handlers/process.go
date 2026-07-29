package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/shirou/gopsutil/v4/process"
)

type ProcessInfo struct {
	PID  int32  `json:"pid"`
	Name string `json:"name"`
}

// GetProcesses returns list of running processes with optional name filtering (?name=xxx)
func GetProcesses(c *gin.Context) {
	ctx := c.Request.Context()
	searchQuery := strings.ToLower(c.Query("name"))

	pids, err := process.PidsWithContext(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to retrieve processes"})
		return
	}

	var results []ProcessInfo
	for _, pid := range pids {
		proc, err := process.NewProcessWithContext(ctx, pid)
		if err != nil {
			continue
		}

		name, err := proc.NameWithContext(ctx)
		if err != nil {
			continue
		}

		if searchQuery == "" || strings.Contains(strings.ToLower(name), searchQuery) {
			results = append(results, ProcessInfo{
				PID:  pid,
				Name: name,
			})
		}
	}

	c.JSON(http.StatusOK, results)
}

// VerifyPID checks if a given PID is active on the system
func VerifyPID(c *gin.Context) {
	ctx := c.Request.Context()
	pidParam := c.Param("pid")

	pid, err := strconv.ParseInt(pidParam, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"exists": false, "message": "Invalid PID format"})
		return
	}

	exists, err := process.PidExistsWithContext(ctx, int32(pid))
	if err != nil || !exists {
		c.JSON(http.StatusOK, gin.H{"exists": false, "pid": pid, "message": "Process not found"})
		return
	}

	proc, err := process.NewProcessWithContext(ctx, int32(pid))
	name := "Unknown"
	if err == nil {
		if procName, err := proc.NameWithContext(ctx); err == nil {
			name = procName
		}
	}

	c.JSON(http.StatusOK, gin.H{"exists": true, "pid": pid, "name": name})
}
