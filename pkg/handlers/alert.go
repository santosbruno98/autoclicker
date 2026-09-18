package handlers

import (
	"net/http"
	"os"
	"strings"

	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
)

func GrafanaAlertWebhook(c *gin.Context) {
	expectedToken := strings.TrimSpace(
		os.Getenv("GRAFANA_WEBHOOK_TOKEN"), //TODO : get this token
	)

	if expectedToken == "" {
		c.JSON(401, gin.H{"error": "Missing Grafana webhook token"})
		return
	}

	authorization := c.GetHeader("Authorization")
	expectedAuthorization := "Bearer " + expectedToken

	if authorization != expectedAuthorization {
		c.JSON(401, gin.H{"error": "Invalid Grafana webhook token"})
		return
	}

	var payload services.GrafanaAlertWebhook
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if len(payload.Alerts) == 0 {
		c.JSON(204, gin.H{"message": "No alerts found"})
		return
	}
	if err := services.HandlerGrafanaAlert(payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Alert fowarded to Discord",
	})

}
