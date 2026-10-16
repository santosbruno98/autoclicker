package handlers

import (
	"autoclicker/pkg/services"
	"net/http"

	"github.com/gin-gonic/gin"
)

// GetBenchmarkHistory returns the benchmark history for the current user.
func GetBenchmarkHistory(c *gin.Context) {
	points, err := services.IntradaySeries("SPY")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Not able to fetch SPY history: " + err.Error(),
		})
		return
	}
	if len(points) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"symbol": "SPY",
			"points": []gin.H{},
		})
		return
	}
	
	result := make([]gin.H, 0, len(points))

	for _, point := range points {
		result = append(result, gin.H{
			"timestamp": point.Timestamp,
			"open":      point.Open,
			"high":      point.High,
			"low":       point.Low,
			"close":     point.Close,
		})
	}

	c.JSON(http.StatusOK, gin.H{
			"symbol": "SPY",
			"points": result,
	})
}
