package database

import (
	"log"

	// "github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var PortfolioDB *gorm.DB

func InitPortfolioDB() {
	// var err error
	if PostgresDB == nil {
		InitPostgresDB()
	}

	PortfolioDB = PostgresDB  
	// PortfolioDB, err = gorm.Open(sqlite.Open("portfolio.db"), &gorm.Config{})
	// if err != nil {
	// 	log.Fatalf("Failed to connect to database: %v", err)
	// }

	if err := PortfolioDB.AutoMigrate(
		&models.Holding{},
		&models.PriceThreshold{},
	); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}
	log.Println("Portfolio database connected")
}
