package database

import (
	"fmt"
	"log"
	"os"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var DB *gorm.DB

func InitDB() {
	// 1. First check if a full DSN string is defined in .env
	dsn := os.Getenv("DB_DSN")

	// 2. Fallback: Build DSN from individual env variables or safe defaults
	if dsn == "" {
		dbUser := getEnv("DB_USER", "autoclicker_user")
		dbPass := getEnv("DB_PASSWORD", "secret")
		dbHost := getEnv("DB_HOST", "127.0.0.1")
		dbPort := getEnv("DB_PORT", "3306")
		dbName := getEnv("DB_NAME", "autoclicker_db")

		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			dbUser, dbPass, dbHost, dbPort, dbName,
		)
	}

	var err error
	DB, err = gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to MySQL database: %v", err)
	}

	// Auto-Migrate creates or updates the tasks table schema
	if err := DB.AutoMigrate(&models.Task{}); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	log.Println("Database connection established and migrations applied.")
}

// Helper function to read an env variable or return a fallback value
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}
