package database

import (
	"fmt"
	"log"

	"autoclicker/pkg/models"

	"gorm.io/gorm"
)

var RouteDB *gorm.DB

func InitRouteDB() error {
	dbName := getEnv("ROUTES_DB_NAME", "route_db")

	db, err := ConnectPostgresDB(dbName)
	if err != nil {
		return fmt.Errorf(
			"failed to connect to routes database %s: %w",
			dbName,
			err,
		)
	}

	if err := db.AutoMigrate(
		&models.RoutePlan{},
		&models.RouteStop{},
		&models.RouteService{},
		&models.RouteSegment{},
		&models.RouteOptimizationCache{},
		&models.RouteImageCache{},
		&models.RouteGeocodeCache{},
	); err != nil {
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}

		return fmt.Errorf(
			"failed to migrate routes database %s: %w",
			dbName,
			err,
		)
	}

	RouteDB = db

	log.Printf(
		"Successfully connected to routes database -> %s",
		dbName,
	)

	return nil
}
