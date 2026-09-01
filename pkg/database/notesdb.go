package database

import (
	"log"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"autoclicker/pkg/models"

)

var NotesDB *gorm.DB

func InitNotesDB() {
	var err error

	NotesDB, err = gorm.Open(sqlite.Open("notes.db"), &gorm.Config{})
	if err != nil {
		log.Fatal("Failed to connect to database: %v", err)
	}

	if err := NotesDB.AutoMigrate(&models.Note{}); err != nil {
		log.Fatal("Failed to migrate database: %v", err)
	}
	log.Println("Database connected")
}