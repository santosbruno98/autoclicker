package database

import (
	"errors"
	"fmt"
	"os"
	"time"

	"autoclicker/pkg/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var RouteDB *gorm.DB

func InitRouteDB() error {
	dsn := os.Getenv("ROUTES_DATABASE_URL")
	if dsn == "" {
		return errors.New("ROUTES_DATABASE_URL is missing")
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("connect to Neon routes database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return err
	}

	sqlDB.SetMaxOpenConns(5)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	if err := db.AutoMigrate(
		&models.RoutePlan{},
		&models.RouteStop{},
		&models.RouteService{},
		&models.RouteSegment{},
		&models.RouteOptimizationCache{},
		&models.RouteImageCache{},
		&models.RouteGeocodeCache{},
	); err != nil {
		sqlDB.Close()
		return fmt.Errorf("migrate routes database: %w", err)
	}

	RouteDB = db
	return nil
}
