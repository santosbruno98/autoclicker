package models

import (
	"time"

	"gorm.io/gorm"
)

type ProcessInfo struct {
	PID  int    `json:"pid"`
	Name string `json:"name"`
}

// Task represents a saved automation profile in MySQL
type Task struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"type:varchar(100);not null" json:"name"`
	Keys      string         `gorm:"type:text;not null" json:"keys"` // Comma-separated: "tab,1,shift"
	KeyDelay  float64        `gorm:"default:0.5" json:"key_delay"`
	LoopDelay float64        `gorm:"default:1.5" json:"loop_delay"`
	AutoFocus bool           `gorm:"default:false" json:"auto_focus"`
	CreatedAt time.Time      `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt time.Time      `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type StartJobRequest struct {
	TaskID uint `json:"task_id" binding:"required"`
	PID    int  `json:"pid" binding:"required"`
}

// JobStatus represents an active automation task
type JobStatus struct {
	ID        string `json:"id"` // Fix: change "string" to "id"
	TaskID    uint   `json:"task_id"`
	PID       int    `json:"pid"`
	TaskName  string `json:"task_name"`
	IsRunning bool   `json:"is_running"`
}
