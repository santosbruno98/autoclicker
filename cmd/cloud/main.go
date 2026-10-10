package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	gin.SetMode(gin.ReleaseMode)

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// Health endpoint for deployment testing.
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "autoclicker-api",
		})
	})

	log.Printf("Starting cloud API on port %s", port)

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatal(err)
	}
}
