package models

import "time"

const (
	ThresholdConditionAbove = "above"
	ThresholdConditionBelow = "below"
)

type PriceThreshold struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Symbol      string    `gorm:"type:varchar(10);not null;uniqueIndex:idx_threshold_symbol_condition" json:"symbol"`
	Condition   string    `gorm:"type:varchar(5);not null;uniqueIndex:idx_threshold_symbol_condition" json:"condition"`
	TargetPrice float64   `gorm:"not null" json:"target_price"`
	Enabled     bool      `gorm:"not null;default:true" json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
