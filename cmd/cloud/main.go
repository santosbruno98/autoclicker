package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"autoclicker/pkg/auth"
	"autoclicker/pkg/database"
	"autoclicker/pkg/handlers"

	"github.com/gin-gonic/gin"
)

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	gin.SetMode(gin.ReleaseMode)

	// Database connections are required by the existing handlers.
	// Cloud Run must receive DATABASE_URL through its configuration.
	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL is required for the cloud API")
	}

	database.InitCoreDB()
	database.InitNotesDB()
	database.InitPortfolioDB()

	// Authentication
	authService, err := auth.NewService(context.Background())
	if err != nil {
		log.Fatalf("Authentication initialization failed: %v", err)
	}
	defer authService.Close()

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// Authentication
	router.POST("/auth/google", authService.GoogleLogin)

	authenticated := router.Group("/")
	authenticated.Use(authService.RequireSession())

	authenticated.GET("/auth/me", authService.Me)
	authenticated.POST("/auth/logout", authService.Logout)

	// Prometheus metrics
	authenticated.GET("/metrics", handlers.GetPrometheusMetrics)

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service": "autoclicker-api",
			"status":  "ok",
		})
	})

	api := authenticated.Group("/api/v1")
	{
		// Tasks
		api.POST("/tasks", handlers.CreateTask)
		api.GET("/tasks", handlers.GetTasks)
		api.GET("/tasks/:id", handlers.GetTaskByID)
		api.PUT("/tasks/:id", handlers.UpdateTask)
		api.DELETE("/tasks/:id", handlers.DeleteTask)

		// Notes
		api.GET("/notes", handlers.GetNotes)
		api.POST("/notes", handlers.CreateNote)
		api.PUT("/notes/:id", handlers.UpdateNote)
		api.DELETE("/notes/:id", handlers.DeleteNote)

		// Portfolio
		api.GET("/portfolio/holdings", handlers.GetHoldings)
		api.POST("/portfolio/holdings", handlers.CreateHolding)
		api.PUT("/portfolio/holdings/:id", handlers.UpdateHolding)
		api.DELETE("/portfolio/holdings/:id", handlers.DeleteHolding)

		api.GET("/portfolio/summary", handlers.GetPortfolioSummary)
		api.GET("/portfolio/history", handlers.GetPortfolioHistory)

		api.GET("/portfolio/buyingPower", handlers.GetBuyingPower)
		api.PUT("/portfolio/buyingPower", handlers.UpdateBuyingPower)

		// Price thresholds
		api.GET("/portfolio/thresholds", handlers.GetPriceThresholds)
		api.GET("/portfolio/thresholds/:id", handlers.GetPriceThreshold)
		api.POST("/portfolio/thresholds", handlers.CreatePriceThreshold)
		api.PUT("/portfolio/thresholds/:id", handlers.UpdatePriceThreshold)
		api.DELETE("/portfolio/thresholds/:id", handlers.DeleteThreshold)

		// Market data and PDF processing
		api.GET("/market/quotes", handlers.GetMarketQuotes)
		api.POST("/market/documents", handlers.ProcessMarketPDF)

	}

	// Grafana webhook
	router.POST("/alerts/grafana", handlers.GrafanaAlertWebhook)

	log.Println("=== REGISTERED API ROUTES ===")
	for _, route := range router.Routes() {
		log.Printf("%-7s %s", route.Method, route.Path)
	}
	log.Println("=============================")

	if err := router.Run("0.0.0.0:" + port); err != nil {
		log.Fatal(err)
	}
}
