package models

type Note struct {
	ID        uint `gorm:"primaryKey json:"id"`
	Content   uint `gorm:"primaryKey json:"content"`
	Done      uint `gorm:"primaryKey json:"done"`
	CreatedAt uint `gorm:"primaryKey json:"created_at"`
	UpdatedAt uint `gorm:"primaryKey json:"updated_at"`
}
