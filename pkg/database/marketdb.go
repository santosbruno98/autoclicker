
package database

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"
)

var MarketDB *gorm.DB

func InitMarketDB() error {
	const dbName = "market_db"

	// Connect to the Neon PostgreSQL database using
	// the shared DATABASE_URL configuration.
	db, err := ConnectPostgresDB(dbName)
	if err != nil {
		return fmt.Errorf(
			"failed to connect to market database %s: %w",
			dbName,
			err,
		)
	}

	// Verify that the required market database
	// migration has already been applied.
	ctx, cancel := context.WithTimeout(
		context.Background(),
		15*time.Second,
	)
	defer cancel()

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
		closeMarketConnection(db)

		return fmt.Errorf(
			"failed to verify market database schema: %w",
			err,
		)
	}

	if !tableExists {
		closeMarketConnection(db)

		return errors.New(
			"market_document_analyses table missing in market_db; run migration 001 first",
		)
	}

	MarketDB = db

	log.Printf(
		"Successfully connected to market database -> %s",
		dbName,
	)

	return nil
}

func CloseMarketDB() {
	if MarketDB == nil {
		return
	}

	closeMarketConnection(MarketDB)
	MarketDB = nil
}

func closeMarketConnection(db *gorm.DB) {
	if db == nil {
		return
	}

	sqlDB, err := db.DB()
	if err != nil {
		log.Printf(
			"Failed to access market database connection pool: %v",
			err,
		)
		return
	}

	if err := sqlDB.Close(); err != nil {
		log.Printf(
			"Failed to close market database connection: %v",
			err,
		)
	}
}
