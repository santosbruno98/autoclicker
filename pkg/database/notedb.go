package database

import (
	"log"

	"autoclicker/pkg/models"

	"gorm.io/gorm"
)

var NotesDB *gorm.DB

func InitNotesDB() {
	var err error
	dbName := "notes_db"
	NotesDB, err = ConnectPostgresDB(dbName)
	if err != nil {
		log.Fatalf("Failed to connect to Postgres: %v", err)
	}

	if err := NotesDB.AutoMigrate(&models.Note{}); err != nil {
		log.Fatalf("Failed to migrate notes tables: %v", err)
	}

	log.Printf("Sucessefully connected to database -> %s", dbName)

}
