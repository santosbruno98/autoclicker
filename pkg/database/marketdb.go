
package database

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var MarketDB *gorm.DB

func InitMarketDB() error {
	dsn := os.Getenv("MARKET_DATABASE_URL")
	if dsn == "" {
		return errors.New("MARKET_DATABASE_URL is not configured")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return fmt.Errorf("connect to market database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return fmt.Errorf("get market database pool: %w", err)
	}

	// Keep the connection footprint small for Cloud Run.
	// These limits apply per Cloud Run instance.
	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	if err := sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()
		return fmt.Errorf("ping market database: %w", err)
	}

	// Verify that the migration has been applied.
	var tableExists bool

	err = db.WithContext(ctx).
		Raw(`
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.tables
				WHERE table_schema = 'public'
				  AND table_name = 'market_document_analyses'
			)
		`).
		Scan(&tableExists).Error

	if err != nil {
		sqlDB.Close()
		return fmt.Errorf("verify market schema: %w", err)
	}

	if !tableExists {
		sqlDB.Close()
		return errors.New(
			"market_document_analyses table missing; run migration 001 first",
		)
	}

	MarketDB = db
	log.Println("Connected to Neon market database")

	return nil
}

func CloseMarketDB() {
	if MarketDB == nil {
		return
	}

	sqlDB, err := MarketDB.DB()
	if err != nil {
		log.Printf("Market database pool error: %v", err)
		return
	}

	if err := sqlDB.Close(); err != nil {
		log.Printf("Market database close error: %v", err)
	}
}
