package handlers

import (
	"net/http"
	"strconv"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"

	"github.com/gin-gonic/gin"
)

func GetNotes(c *gin.Context) {
	var notes []models.Note
	if err := database.NotesDB.Find(&notes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, notes)
}


func CreateNote(c *gin.Context) {
	var note models.Note
	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.NotesDB.Create(&note).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, note)

}

func UpdateNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid note ID"})
		return
	}

	var note models.Note
	if err := database.NotesDB.First(&note, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Note not found"})
		return
	}

	if err := c.ShouldBindJSON(&note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	database.NotesDB.Save(&note)
	c.JSON(http.StatusOK, note)
}


func DeleteNote(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid note ID"})
		return
	}

	if err := database.NotesDB.Delete(&models.Note{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Note not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Note deleted"})
}