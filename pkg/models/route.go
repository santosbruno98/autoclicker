package models

import "time"

type RoutePlan struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	Name      string         `gorm:"index;not null" json:"name"`
	CacheKey  string         `gorm:"index;not null" json:"cache_key"`
	DistanceM float64        `json:"distance_m"`
	DurationS float64        `json:"duration_s"`
	CreatedAt time.Time      `json:"created_at"`
	Stops     []RouteStop    `json:"stops"`
	Segments  []RouteSegment `json:"segments"`
}

type RouteStop struct {
	ID        uint    `gorm:"primaryKey" json:"id"`
	RouteID   uint    `gorm:"index;not null" json:"route_id"`
	Sequence  int     `json:"sequence"`
	Address   string  `json:"address"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type RouteSegment struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	RouteID       uint       `gorm:"index;not null" json:"route_id"`
	Sequence      int        `json:"sequence"`
	StartStop     int        `json:"start_stop"`
	EndStop       int        `json:"end_stop"`
	GoogleMapsURL string     `json:"google_maps_url"`
	Completed     bool       `json:"completed"`
	CompletedAt   *time.Time `json:"completed_at"`
	// TODO: add a way to track the problematic addresses, that is, the ones that are not reachable and add them into a pile
}

type RouteOptimizationCache struct {
	Key       string `gorm:"primaryKey; size:64"`
	Result    []byte `gorm:"type:bytea;not null"`
	CreatedAt time.Time
}
