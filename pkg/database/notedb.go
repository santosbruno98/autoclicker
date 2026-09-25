package database

import (
	"log"

	"gorm.io/gorm"

	"autoclicker/pkg/models"
)

var NotesDB *gorm.DB

func InitNotesDB() {
	if PostgresDB == nil {
		InitPostgresDB()
	}
	NotesDB = PostgresDB

	// NotesDB, err = gorm.Open(sqlite.Open("notes.db"), &gorm.Config{})

	if err := NotesDB.AutoMigrate(&models.Note{}); err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	log.Println("Notes database connected")
}
