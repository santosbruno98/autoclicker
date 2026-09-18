package handlers

import (
	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

type PriceThresholdRequest struct {
	Symbol      string  `json:"symbol" binding:"required"`
	Condition   string  `json:"condition" binding:"required"`
	TargetPrice float64 `json:"target_price" binding:"required,gt=0"`
	Enabled     *bool   `json:"enabled"`
}

func CreatePriceThreshold(c *gin.Context) {
	var request PriceThresholdRequest

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	request.Symbol = strings.ToUpper(strings.TrimSpace(request.Symbol))
	request.Condition = strings.ToLower(strings.TrimSpace(request.Condition))

	if request.Symbol == "" || len(request.Symbol) > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid symbol"})
		return
	}

	if request.Condition != models.ThresholdConditionAbove && request.Condition != models.ThresholdConditionBelow {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid condition"})
		return
	}

	enabled := true
	if request.Enabled != nil {
		enabled = *request.Enabled
	}

	threshold := models.PriceThreshold{
		Symbol:      request.Symbol,
		Condition:   request.Condition,
		TargetPrice: request.TargetPrice,
		Enabled:     enabled,
	}

	if err := database.PortfolioDB.Create(&threshold).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, threshold)
}

func UpdatePriceThreshold(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid threshold ID"})
		return
	}
	var threshold models.PriceThreshold
	if err := database.PortfolioDB.First(&threshold, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Threshold not found"})
		return
	}

	var request PriceThresholdRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	request.Symbol = strings.ToUpper(strings.TrimSpace(request.Symbol))
	request.Condition = strings.ToLower(strings.TrimSpace(request.Condition))

	if request.Symbol == "" || len(request.Symbol) > 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid symbol"})
		return
	}

	if request.Condition != models.ThresholdConditionAbove && request.Condition != models.ThresholdConditionBelow {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid condition"})
		return
	}

	enabled := threshold.Enabled
	if request.Enabled != nil {
		enabled = *request.Enabled
	}

	threshold.Symbol = request.Symbol
	threshold.Condition = request.Condition
	threshold.TargetPrice = request.TargetPrice
	threshold.Enabled = enabled

	if err := database.PortfolioDB.Save(&threshold).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, threshold)
}

func GetPriceThresholds(c *gin.Context) {
	var thresholds []models.PriceThreshold
	if err := database.PortfolioDB.
		Order("symbol asc, condition asc").
		Find(&thresholds).Error; err != nil {

		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, thresholds)
}

func GetPriceThreshold(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid threshold ID",
		})
		return
	}
	var threshold models.PriceThreshold
	if err := database.PortfolioDB.First(&threshold, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Threshold not found"})
		return
	}

	c.JSON(http.StatusOK, threshold)
}

func DeleteThreshold(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid threshold ID",
		})
		return
	}

	result := database.PortfolioDB.Delete(
		&models.PriceThreshold{},
		id,
	)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": result.Error.Error(),
		})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Threshold not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Threshold deleted",
	})
}
