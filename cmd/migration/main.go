package main

import (
	"autoclicker/pkg/models"
	"fmt"
	"log"
	"os"
	"reflect"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MigrationTask struct {
	Name       string
	SQLitePath string
	TargetDB   string // Database name in PostgreSQL (e.g. "portfolio_db")
	Models     []interface{}
}

const BatchSize = 300

func main() {
	pgHost := getEnv("POSTGRES_HOST", "localhost")
	pgPort := getEnv("POSTGRES_PORT", "5432")
	pgUser := getEnv("POSTGRES_USER", "autoclicker")
	pgPassword := getEnv("POSTGRES_PASSWORD", "password")
	pgSSLMode := getEnv("POSTGRES_SSL_MODE", "disable")

	tasks := []MigrationTask{
		{
			Name:       "Portfolio Positions Database",
			SQLitePath: "C:\\Users\\santo\\Documents\\GoLangProjects\\autoclicker\\portfolio.db",
			TargetDB:   "portfolio_db",
			Models: []interface{}{
				&models.Holding{},
				&models.PriceThreshold{},
			},
		},
		{
			Name:       "Notes Database",
			SQLitePath: "C:\\Users\\santo\\Documents\\GoLangProjects\\autoclicker\\notes.db",
			TargetDB:   "notes_db",
			Models: []interface{}{
				&models.Note{},
			},
		},
	}

	log.Println("Migrating databases...")

	// Step 1: Ensure target PostgreSQL databases exist
	for _, task := range tasks {
		if err := ensureDatabaseExists(pgHost, pgPort, pgUser, pgPassword, pgSSLMode, task.TargetDB); err != nil {
			log.Fatalf("Failed to ensure Postgres database '%s' exists: %v", task.TargetDB, err)
		}
	}

	// Step 2: Run data migration for each database
	for _, task := range tasks {
		log.Printf("\n Starting Migration for %s ---> Target DB: %s ", task.Name, task.TargetDB)
		if err := runMigration(task, pgHost, pgPort, pgUser, pgPassword, pgSSLMode); err != nil {
			log.Fatalf("Failed to migrate database '%s': %v", task.TargetDB, err)
		}
		log.Printf("==== Migration completed for %s ====\n", task.Name)
	}
}

func ensureDatabaseExists(host, port, user, password, sslMode, targetDBName string) error {
	adminDSN := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=postgres sslmode=%s", host, port, user, password, sslMode)
	adminDB, err := gorm.Open(postgres.Open(adminDSN), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("unable to connect to postgres admin DB: %w", err)
	}

	var count int64
	adminDB.Raw("SELECT count(1) FROM pg_database WHERE datname = ?", targetDBName).Scan(&count)
	if count == 0 {
		log.Printf("Database '%s' does not exist in Postgres. Creating...", targetDBName)
		if err := adminDB.Exec(fmt.Sprintf("CREATE DATABASE %s;", targetDBName)).Error; err != nil {
			return fmt.Errorf("failed to create database %s: %w", targetDBName, err)
		}
		log.Printf("Database '%s' created successfully.", targetDBName)
	} else {
		log.Printf("Database '%s' already exists in Postgres.", targetDBName)
	}
	return nil
}

func runMigration(task MigrationTask, host, port, user, password, sslMode string) error {
	// Connect to source SQLite file
	sourceDB, err := gorm.Open(sqlite.Open(task.SQLitePath), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to SQLite database (%s): %w", task.SQLitePath, err)
	}

	// Connect to target PostgreSQL database
	targetDSN := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, task.TargetDB, sslMode)
	targetDB, err := gorm.Open(postgres.Open(targetDSN), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("failed to connect to Postgres database (%s): %w", task.TargetDB, err)
	}

	// AutoMigrate target tables on target Postgres DB
	log.Println("Migrating table schemas...")
	for _, model := range task.Models {
		if err := targetDB.AutoMigrate(model); err != nil {
			return fmt.Errorf("failed to migrate schema for %T: %w", model, err)
		}
	}

	// Transfer records in batches
	for _, model := range task.Models {
		modelType := fmt.Sprintf("%T", model)
		log.Printf("Copying records for model: %s", modelType)

		if err := migrateModelInBatches(sourceDB, targetDB, model); err != nil {
			return fmt.Errorf("failed to copy records for model %s: %w", modelType, err)
		}
	}
	return nil
}

func migrateModelInBatches(sourceDB *gorm.DB, targetDB *gorm.DB, model interface{}) error {
	// Create a pointer to a slice of the model type dynamically (e.g., &[]models.Holding{})
	modelType := reflect.TypeOf(model)
	if modelType.Kind() == reflect.Ptr {
		modelType = modelType.Elem()
	}
	sliceType := reflect.SliceOf(modelType)
	slicePtr := reflect.New(sliceType).Interface()

	// FindInBatches will now populate the slice with all matching records
	result := sourceDB.Model(model).FindInBatches(slicePtr, BatchSize, func(tx *gorm.DB, batch int) error {
		if tx.RowsAffected == 0 {
			return nil
		}

		// Insert the entire batch slice into PostgreSQL
		if err := targetDB.Clauses(clause.OnConflict{UpdateAll: true}).Create(slicePtr).Error; err != nil {
			return fmt.Errorf("failed to insert batch %d into postgres: %w", batch, err)
		}
		log.Printf("  -> Successfully migrated batch %d (%d records)", batch, tx.RowsAffected)
		return nil
	})

	return result.Error
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists && value != "" {
		return value
	}
	return fallback
}
