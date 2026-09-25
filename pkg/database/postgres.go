package database

import (
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var PostgresDB *gorm.DB

func InitPostgresDB() {
	host := getEnv("POSTGRES_HOST", "localhost")
	port := getEnv("POSTGRES_PORT", "5432")

	user := getEnv("POSTGRES_USER", "autoclicker")
	password := getEnv("POSTGRES_PASSWORD", "password")
	dbName := getEnv("POSTGRES_DB", "autoclicker")
	sslMode := getEnv("POSTGRES_SSL_MODE", "disable")

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbName, sslMode,
	)

	var err error
	PostgresDB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to Postgres: %v", err)
	}

	sqlDB, err := PostgresDB.DB()
	if err != nil {
		log.Fatalf("Failed to get DB connection: %v", err)
	}

	sqlDB.SetMaxOpenConns(20)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	if err := sqlDB.Ping(); err != nil {
		log.Fatalf("Failed to ping Postgres: %v", err)
	}

	log.Println("Connected to Postgres database.")
}

// Helper function to read an env variable or return a fallback value
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}
