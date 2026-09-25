package database

import (
	"fmt"
	"log"
	"os"

	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var DB *gorm.DB

func InitDB() {
	// 1. First check if a full DSN string is defined in .env
	dsn := os.Getenv("DB_DSN")

	// 2. Fallback: Build DSN from individual env variables or safe defaults
	if dsn == "" {
		host := getEnv("POSTGRES_HOST", "localhost")
		port := getEnv("POSTGRES_PORT", "5432")
		user := getEnv("POSTGRES_USER", "autoclicker")
		password := getEnv("POSTGRES_PASSWORD", "password")
		dbName := getEnv("POSTGRES_DB", "autoclicker")
		sslMode := getEnv("POSTGRES_SSL_MODE", "disable")

		dsn = fmt.Sprintf(
			"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
			host,
			port,
			user,
			password,
			dbName,
			sslMode,
		)
	}

	// var err error
	// DB, err = gorm.Open(mysql.New(mysql.Config{
	// 	DSN:                      dsn,
	// 	DisableDatetimePrecision: true,
	// }), &gorm.Config{})
	// if err != nil {
	// 	log.Fatalf("Failed to connect to MySQL database: %v", err)
	// }
	DB = PostgresDB
	
	// Auto-Migrate creates or updates the tasks table schema
	if err := DB.AutoMigrate(&models.Task{}); err != nil {
		log.Fatalf("Failed to run database migrations: %v", err)
	}

	log.Println("Database connection established and migrations applied.")
}


