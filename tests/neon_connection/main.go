
package main

import (
	"fmt"
	"log"

	"autoclicker/pkg/database"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		log.Fatal("Failed to load .env: ", err)
	}

	databases := []string{
		"autoclicker",
		"notes_db",
		"portfolio_db",
	}

	for _, name := range databases {
		db, err := database.ConnectPostgresDB(name)
		if err != nil {
			log.Fatalf(
				"Failed connecting to %s: %v",
				name,
				err,
			)
		}

		var result string

		if err := db.Raw(
			"SELECT current_database()",
		).Scan(&result).Error; err != nil {
			log.Fatalf(
				"Query failed for %s: %v",
				name,
				err,
			)
		}

		fmt.Printf(
			"Connected successfully: %s\n",
			result,
		)

		sqlDB, err := db.DB()
		if err != nil {
			log.Fatal(err)
		}

		if err := sqlDB.Close(); err != nil {
			log.Fatal(err)
		}
	}

	fmt.Println("All Neon PostgreSQL connections passed!")
}
