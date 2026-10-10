
package database

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func ConnectPostgresDB(dbName string) (*gorm.DB, error) {
	var dsn string

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))

	if databaseURL != "" {
		parsedURL, err := url.Parse(databaseURL)
		if err != nil {
			return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
		}

		if parsedURL.Scheme != "postgres" &&
			parsedURL.Scheme != "postgresql" {
			return nil, fmt.Errorf(
				"DATABASE_URL must use postgres:// or postgresql://",
			)
		}

		if parsedURL.Host == "" || parsedURL.User == nil {
			return nil, fmt.Errorf(
				"DATABASE_URL is missing host or user",
			)
		}

		// Preserve credentials, hostname, SSL settings and
		// other parameters while selecting the database.
		parsedURL.Path = "/" + dbName
		parsedURL.RawPath = ""

		dsn = parsedURL.String()

		log.Printf(
			"Connecting to PostgreSQL database %s using DATABASE_URL",
			dbName,
		)
	} else {
		host := getEnv("POSTGRES_HOST", "localhost")
		port := getEnv("POSTGRES_PORT", "5432")
		user := getEnv("POSTGRES_USER", "autoclicker")
		password := getEnv("POSTGRES_PASSWORD", "password")
		sslMode := getEnv("POSTGRES_SSL_MODE", "disable")

		// URL encoding protects special characters in passwords.
		connectionURL := &url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(user, password),
			Host:   host + ":" + port,
			Path:   "/" + dbName,
		}

		query := connectionURL.Query()
		query.Set("sslmode", sslMode)
		connectionURL.RawQuery = query.Encode()

		dsn = connectionURL.String()

		log.Printf(
			"Connecting to local PostgreSQL database %s",
			dbName,
		)
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf(
			"failed to open PostgreSQL database %s: %w",
			dbName,
			err,
		)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf(
			"failed to get connection pool for %s: %w",
			dbName,
			err,
		)
	}

	sqlDB.SetMaxOpenConns(getEnvInt("MAX_OPEN_CONNS", 5))
	sqlDB.SetMaxIdleConns(getEnvInt("MAX_IDLE_CONNS", 2))
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(
		context.Background(),
		15*time.Second,
	)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()

		return nil, fmt.Errorf(
			"failed to ping PostgreSQL database %s: %w",
			dbName,
			err,
		)
	}

	return db, nil
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)

	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		log.Printf(
			"Invalid integer value for %s; using %d",
			key,
			fallback,
		)
		return fallback
	}

	return parsed
}
