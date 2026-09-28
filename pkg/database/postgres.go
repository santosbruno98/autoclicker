package database

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Helper function to create a PostgreSQL connection pool for a specific database name
func ConnectPostgresDB(dbName string) (*gorm.DB, error) {
	host := getEnv("POSTGRES_HOST", "localhost")
	port := getEnv("POSTGRES_PORT", "5432")
	user := getEnv("POSTGRES_USER", "autoclicker")
	password := getEnv("POSTGRES_PASSWORD", "password")
	sslMode := getEnv("POSTGRES_SSL_MODE", "disable")
	MaxOpenConns := getEnvInt("MAX_OPEN_CONNS", "5")
	MaxIdleConns := getEnvInt("MAX_IDLE_CONNS", "2")
	
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbName, sslMode,
	)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("gorm open error for %s: %w", dbName, err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("sql.DB error for %s: %w", dbName, err)
	}

	sqlDB.SetMaxOpenConns(MaxOpenConns)
	sqlDB.SetMaxIdleConns(MaxIdleConns)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping error for %s: %w", dbName, err)
	}

	return db, nil
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}


func getEnvInt(key string, fallback int) int {~
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		log.Printf(
			"Invalid integer value for %s=%q; using %d",
			key,
			value,
			fallback,
		)

		return fallback
	}

	return parsed
}