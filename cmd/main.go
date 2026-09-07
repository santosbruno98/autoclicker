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

	"autoclicker/pkg/database"
	"autoclicker/pkg/handlers"
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

	database.InitDB()
	database.InitNotesDB()
	database.InitPortfolioDB()

	r := gin.Default()
	r.Use(CORSMiddleware())

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

	}

	srv := &http.Server{
		Addr:    ":8080",
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

	// 1. Stop any active automation job first — releases the key-press loop cleanly
	//    instead of leaving robotgo mid-keystroke or a goroutine dangling.
	if services.Manager.IsActive() {
		if err := services.Manager.StopJob(); err != nil {
			log.Printf("Error stopping active job: %v", err)
		} else {
			log.Println("Active automation job stopped.")
		}
	}

	// 2. Stop accepting new HTTP requests, let in-flight ones finish (max 5s)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	// 3. Close the DB connection pool last
	if sqlDB, err := database.DB.DB(); err == nil {
		sqlDB.Close()
		log.Println("Database connection closed.")
	}

	log.Println("Shutdown complete.")
}
