package handlers

import (
	"net/http"

	"autoclicker/pkg/services"

	"log"

	"github.com/gin-gonic/gin"
)

func GetPrometheusMetrics(c *gin.Context) {
	metrics, err := services.PrometheusStockMetrics()
	if err != nil {
		log.Printf("Failed to fetch Prometheus metrics: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(
		http.StatusOK,
		"text/plain; version=0.0.4; charset=utf-8",
		[]byte(metrics),
	)
}
