package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"autoclicker/internal/middleware"
	"autoclicker/pkg/database"
	"autoclicker/pkg/handlers"
	"autoclicker/pkg/kafka"
	"autoclicker/pkg/services"
)

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found; defaulting to system environment variables.")
	}

	kafkaBroker := os.Getenv("KAFKA_BROKER")
	if kafkaBroker == "" {
		kafkaBroker = "localhost:9092"
	}
	brokers := []string{kafkaBroker}
	topic := "app-logs"
	serviceName := "autoclicker-go-backend"

	// Initializing LogProducer with error handling
	kafkaProducer, err := kafka.NewLogProducer(brokers, topic, serviceName)
	if err != nil {
		log.Fatalf("Failed to initialize Kafka producer: %v", err)
	}
	defer func() {
		if err := kafkaProducer.Close(); err != nil {
			log.Printf("Error closing Kafka producer: %v", err)
		}
	}()

	database.InitDB()
	database.InitNotesDB()
	database.InitPortfolioDB()

	r := gin.Default()
	r.Use(CORSMiddleware())
	r.Use(middleware.NetworkLogger(kafkaProducer.Writer))

	api := r.Group("/api/v1")
	{
		api.POST("/tasks", handlers.CreateTask)
		api.GET("/tasks", handlers.GetTasks)
		api.GET("/tasks/:id", handlers.GetTaskByID)
		api.PUT("/tasks/:id", handlers.UpdateTask)
		api.DELETE("/tasks/:id", handlers.DeleteTask)

		api.GET("/processes", handlers.GetProcesses)
		api.GET("/processes/verify/:pid", handlers.VerifyPID)
		api.POST("/automation/start", handlers.StartJob)
		api.POST("/automation/stop", handlers.StopJob)
		api.GET("/automation/status", handlers.GetStatus)
		api.GET("/automation/logs", handlers.GetLogs)

		api.GET("/notes", handlers.GetNotes)
		api.POST("/notes", handlers.CreateNote)
		api.PUT("/notes/:id", handlers.UpdateNote)
		api.DELETE("/notes/:id", handlers.DeleteNote)

		api.GET("/portfolio/holdings", handlers.GetHoldings)
		api.POST("/portfolio/holdings", handlers.CreateHolding)
		api.PUT("/portfolio/holdings/:id", handlers.UpdateHolding)
		api.DELETE("/portfolio/holdings/:id", handlers.DeleteHolding)
		api.GET("/portfolio/summary", handlers.GetPortfolioSummary)
		api.GET("/portfolio/history", handlers.GetPortfolioHistory)

		// Threshold APIs
		api.GET("/portfolio/thresholds", handlers.GetPriceThresholds)
		api.GET("/portfolio/thresholds/:id", handlers.GetPriceThreshold)
		api.POST("/portfolio/thresholds", handlers.CreatePriceThreshold)
		api.PUT("/portfolio/thresholds/:id", handlers.UpdatePriceThreshold)
		api.DELETE("/portfolio/thresholds/:id", handlers.DeleteThreshold)

		api.POST("/alerts/grafana", handlers.GrafanaAlertWebhook)
		
	}
	
	r.GET("/metrics", handlers.GetPrometheusMetrics)
	
	
	srv := &http.Server{
		Addr:    "0.0.0.0:8080",
		Handler: r,
	}

	go func() {
		log.Println("Starting Gin automation server on :8080...")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	log.Println("Shutdown signal received. Releasing resources...")

	// 1. Stop active automation job
	if services.Manager.IsActive() {
		if err := services.Manager.StopJob(); err != nil {
			log.Printf("Error stopping active job: %v", err)
		} else {
			log.Println("Active automation job stopped.")
		}
	}

	// 2. Stop accepting HTTP requests (max 5s timeout)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	// 3. Close the DB connection pool
	if sqlDB, err := database.DB.DB(); err == nil {
		sqlDB.Close()
		log.Println("Database connection closed.")
	}

	log.Println("Shutdown complete.")
}

//TODO: Put the API logs into a topic and the application logs into another topic, using wildcard binding strings.
// TODO: Topic exchanges route dynamically based on routing keys containing dot-seperated words, allowing systems to selectively bind queues using wildcards
