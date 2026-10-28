package models

import "time"

type RoutePlan struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"not null" json:"name"`
	CacheKey  string    `gorm:"index;not null" json:"-"`
	DistanceM float64   `json:"distance_m"`
	DurationS float64   `json:"duration_s"`
	CreatedAt time.Time `json:"created_at"`

	Stops    []RouteStop    `gorm:"foreignKey:RouteID" json:"stops"`
	Segments []RouteSegment `gorm:"foreignKey:RouteID" json:"segments"`
}

type RouteStop struct {
	ID        uint    `gorm:"primaryKey" json:"id"`
	RouteID   uint    `gorm:"index;not null" json:"route_id"`
	Sequence  int     `json:"sequence"`
	Address   string  `gorm:"not null" json:"address"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`

	Services []RouteService `gorm:"foreignKey:StopID" json:"services"`
}

type RouteService struct {
	ID          uint   `gorm:"primaryKey" json:"id"`
	StopID      uint   `gorm:"index;not null" json:"stop_id"`
	ServiceType string `gorm:"not null" json:"service_type"`
}

type RouteSegment struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	RouteID       uint       `gorm:"index;not null" json:"route_id"`
	Sequence      int        `json:"sequence"`
	StartStop     int        `json:"start_stop"`
	EndStop       int        `json:"end_stop"`
	GoogleMapsURL string     `gorm:"type:text" json:"google_maps_url"`
	Completed     bool       `gorm:"default:false" json:"completed"`
	CompletedAt   *time.Time `json:"completed_at"`
}

type RouteOptimizationCache struct {
	Key       string `gorm:"primaryKey;size:64"`
	Result    []byte `gorm:"type:bytea;not null"`
	CreatedAt time.Time
}

type RouteImageCache struct {
	Hash      string `gorm:"primaryKey;size:64"`
	Result    []byte `gorm:"type:bytea;not null"`
	CreatedAt time.Time
}

type RouteGeocodeCache struct {
	Key       string `gorm:"primaryKey;size:64"`
	Address   string `gorm:"not null"`
	Latitude  float64
	Longitude float64
	CreatedAt time.Time
}
