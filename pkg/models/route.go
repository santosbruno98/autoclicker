package models

import "time"

type RoutePlan struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"not null" json:"name"`
	CacheKey     string    `gorm:"index;not null" json:"-"`
	DistanceM    float64   `json:"distance_m"`
	DurationS    float64   `json:"duration_s"`
	CreatedAt    time.Time `json:"created_at"`
	AreaRevision string    `json:"area_revision"`
	AreaID       string    `json:"area_id"`
	AreaLabel    string    `json:"area_label"`
	SectionOrder string    `json:"section_order"`
	MapsLimit    int       `json:"maps_limit"`
	CityStops    int       `json:"city_stops"`
	VillageStops int       `json:"village_stops"`

	Stops    []RouteStop    `gorm:"foreignKey:RouteID" json:"stops"`
	Segments []RouteSegment `gorm:"foreignKey:RouteID" json:"segments"`
}

type RouteStop struct {
	ID        uint    `gorm:"primaryKey" json:"id"`
	RouteID   uint    `gorm:"index;not null" json:"route_id"`
	Sequence  int     `json:"sequence"`
	Address   string  `gorm:"not null" json:"address"`
	Locality  string  `json:"locality"`
	Section   string  `json:"section"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	IsOrigin  bool    `json:"is_origin"`
	IsReturn  bool    `json:"is_return"`

	Services []RouteService `gorm:"foreignKey:StopID" json:"services"`
}

type RouteService struct {
	ID                uint   `gorm:"primaryKey" json:"id"`
	StopID            uint   `gorm:"index;not null" json:"stop_id"`
	ServiceID         string `json:"service_id"`
	SourceReference   string `json:"source_reference"`
	OriginalAddress   string `json:"original_address"`
	ServiceType       string `gorm:"not null" json:"service_type"`
	ParcelCount       int    `gorm:"default:1" json:"parcel_count"`
	LocationPrecision string `json:"location_precision"`
}

type RouteSegment struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	RouteID           uint       `gorm:"index;not null" json:"route_id"`
	Sequence          int        `json:"sequence"`
	Section           string     `json:"section"`
	SectionSequence   int        `json:"section_sequence"`
	SectionRouteCount int        `json:"section_route_count"`
	DestinationCount  int        `json:"destination_count"`
	IncludesReturn    bool       `json:"includes_return"`
	StartStop         int        `json:"start_stop"`
	EndStop           int        `json:"end_stop"`
	GoogleMapsURL     string     `gorm:"type:text" json:"google_maps_url"`
	Completed         bool       `gorm:"default:false" json:"completed"`
	CompletedAt       *time.Time `json:"completed_at"`
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
