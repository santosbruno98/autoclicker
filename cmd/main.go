package main

import (
	"log"

	"github.com/gin-gonic/gin"

	"autoclicker/pkg/database"
	"autoclicker/pkg/handlers"
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
	// 1. Initialize database
	database.InitDB()

	// 2. Setup Gin
	r := gin.Default()
	r.Use(CORSMiddleware())

	api := r.Group("/api/v1")
	{
		// Task CRUD Endpoints

		api.POST("/tasks", handlers.CreateTask)
		api.GET("/tasks", handlers.GetTasks)
		api.GET("/tasks/:id", handlers.GetTaskByID)
		api.PUT("/tasks/:id", handlers.UpdateTask)
		api.DELETE("/tasks/:id", handlers.DeleteTask)
		
		// Automation Execution Endpoints
		api.GET("/processes", handlers.GetProcesses)
		api.POST("/automation/start", handlers.StartJob)
		api.POST("/automation/stop", handlers.StopJob)
		api.GET("/automation/status", handlers.GetStatus)
	}

	log.Println("Starting Gin automation server on :8080...")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}