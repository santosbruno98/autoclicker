package handlers

import (
	"autoclicker/pkg/services"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

const maxFileSize = 25 << 20 // 25 MiB

func ProcessMarketPDF(c *gin.Context) {
	fileHandler, err := c.FormFile("file")
	if err != nil {
		log.Println("PDF file is required using the 'file' field-> %s", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "PDF file is required using the 'file' field"})
		return
	}

	if fileHandler.Size == 0 {
		log.Println("PDF file size is 0")
		c.JSON(http.StatusBadRequest, gin.H{"error": "PDF file size is 0"})
		return
	}

	if fileHandler.Size == maxFileSize {
		log.Println("PDF file size is greater than maxFileSize")
		c.JSON(http.StatusRequestEntityTooLarge,
			gin.H{"error": "PDF file size is greater than 25 Mib"},
		)
		return
	}

	file, err := fileHandler.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Error opening PDF file"})
		return
	}
	defer file.Close()

	tempfile, err := os.CreateTemp("", "market_document")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Error creating temporary file"})
		return
	}

	tempPath := tempfile.Name()

	defer func() {
		_ = os.Remove(tempPath)
	}()

	if _, err := tempfile.ReadFrom(file); err != nil {
		_ = tempfile.Close()

		c.JSON(http.StatusInternalServerError,
			gin.H{"error": "Error reading PDF file"},
		)
		return
	}

	if err := tempfile.Close(); err != nil {
		c.JSON(http.StatusInternalServerError,
			gin.H{"error": "Error closing temporary file"},
		)
		return
	}

	result, err := services.ProcessMarketPDF(tempPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)

}
