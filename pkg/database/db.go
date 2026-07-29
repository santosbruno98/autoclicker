package database

import (
	"log"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var DB *gorm.DB

func InitDB() {
	// DSN format: username:password@tcp(host:port)/dbname?charset=utf8mb4&parseTime=True&loc=Local
	dsn := "root:password@tcp(127.0.0.1:3306)/autoclicker_db?charset=utf8mb4&parseTime=True&loc=Local"
	
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