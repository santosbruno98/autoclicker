package database

import (
	"log"

	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var DB *gorm.DB

func InitDB() {
	var err error
	dbName := getEnv("POSTGRES_DB", "autoclicker")
	DB, err = ConnectPostgresDB(dbName)
	if err != nil {
		log.Fatalf("Failed to connect to Postgres: %v", err)
	}

	if err := DB.AutoMigrate(&models.Task{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	log.Printf("Sucessefully connected to database -> %s", dbName)

}
