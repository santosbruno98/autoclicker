package database

import (
	"log"

	"autoclicker/pkg/models"

	"gorm.io/gorm"
)

var PortfolioDB *gorm.DB

func InitPortfolioDB() {
	var err error
	dbName := "portfolio_db"
	PortfolioDB, err = ConnectPostgresDB(dbName)
	if err != nil {
		log.Fatalf("Failed to connect to Postgres: %v", err)
	}

	if err := PortfolioDB.AutoMigrate(
		&models.Holding{},
		&models.PriceThreshold{},
		&models.PortfolioSettings{},
	); err != nil {
		log.Fatalf("Failed to migrate portfolio tables: %v", err)
	}

	log.Printf("Sucessefully connected to database -> %s", dbName)
}
