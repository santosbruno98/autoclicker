package handlers

import (
	"net/http"

	"autoclicker/pkg/models"
	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
)

// ProcessDTO for clean JSON output
type ProcessDTO struct {
	PID  int32  `json:"pid"`
	Name string `json:"name"`
}

// StartJob receives configuration and kicks off background worker
func StartJob(c *gin.Context) {
	var req models.StartJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := services.Manager.StartJob(req.TaskID, req.PID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Job started successfully"})
}

// StopJob cancels active background worker
func StopJob(c *gin.Context) {
	if err := services.Manager.StopJob(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Job stopped successfully"})
}

// GetStatus checks current worker state
func GetStatus(c *gin.Context) {
	c.JSON(http.StatusOK, services.Manager.GetStatus())
}
