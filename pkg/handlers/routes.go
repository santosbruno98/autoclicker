
package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RouteInputService struct {
	ServiceType string `json:"service_type"`
}

type RouteInputStop struct {
	Address   string              `json:"address" binding:"required"`
	Latitude  float64             `json:"latitude"`
	Longitude float64             `json:"longitude"`
	Services  []RouteInputService `json:"services"`
}

type CreateRouteRequest struct {
	Name      string           `json:"name"`
	Stops     []RouteInputStop `json:"stops" binding:"required"`
	RoundTrip bool             `json:"round_trip"`
}

type CloudRouteRequest struct {
	Coordinates [][2]float64 `json:"coordinates"`
	RoundTrip   bool         `json:"round_trip"`
}

type CloudRouteResponse struct {
	Order     []int   `json:"order"`
	DistanceM float64 `json:"distance_m"`
	DurationS float64 `json:"duration_s"`
}

func mapsURL(stops []RouteInputStop) string {
	if len(stops) < 2 {
		return ""
	}

	coord := func(s RouteInputStop) string {
		return strconv.FormatFloat(s.Latitude, 'f', 6, 64) +
			"," + strconv.FormatFloat(s.Longitude, 'f', 6, 64)
	}

	q := url.Values{}
	q.Set("api", "1")
	q.Set("travelmode", "driving")
	q.Set("origin", coord(stops[0]))
	q.Set("destination", coord(stops[len(stops)-1]))

	var points []string
	for _, stop := range stops[1 : len(stops)-1] {
		points = append(points, coord(stop))
	}
	if len(points) > 0 {
		q.Set("waypoints", strings.Join(points, "|"))
	}

	return "https://www.google.com/maps/dir/?" + q.Encode()
}

func validOrder(order []int, count int) bool {
	if count < 2 || len(order) != count || order[0] != 0 {
		return false
	}

	seen := make([]bool, count)
	for _, i := range order {
		if i < 0 || i >= count || seen[i] {
			return false
		}
		seen[i] = true
	}
	return true
}

func requestOptimization(ctx context.Context, payload CloudRouteRequest) (CloudRouteResponse, error) {
	endpoint := strings.TrimRight(os.Getenv("ROUTING_SERVICE_URL"), "/")
	if endpoint == "" {
		return CloudRouteResponse{}, errors.New("ROUTING_SERVICE_URL is missing")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CloudRouteResponse{}, err
	}

	req, err := http.NewRequestWithContext(
		ctx, "POST", endpoint+"/optimize", bytes.NewReader(body),
	)
	if err != nil {
		return CloudRouteResponse{}, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ROUTING_API_KEY"))

	resp, err := (&http.Client{Timeout: 180 * time.Second}).Do(req)
	if err != nil {
		return CloudRouteResponse{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return CloudRouteResponse{}, fmt.Errorf(
			"routing HTTP %d: %s", resp.StatusCode, string(msg),
		)
	}

	var result CloudRouteResponse
	err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result)
	return result, err
}

func coordKey(s RouteInputStop) string {
	return fmt.Sprintf("%.6f,%.6f", s.Latitude, s.Longitude)
}

func validPoint(s RouteInputStop) bool {
	return !math.IsNaN(s.Latitude) &&
		!math.IsNaN(s.Longitude) &&
		!math.IsInf(s.Latitude, 0) &&
		!math.IsInf(s.Longitude, 0) &&
		s.Latitude >= -90 && s.Latitude <= 90 &&
		s.Longitude >= -180 && s.Longitude <= 180 &&
		!(s.Latitude == 0 && s.Longitude == 0)
}

func CreateRoutePlan(c *gin.Context) {
	var input CreateRouteRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	if len(input.Stops) < 2 || len(input.Stops) > 150 {
		c.JSON(400, gin.H{"error": "Provide 2 to 150 locations"})
		return
	}

	// Deduplicate physical destinations, not services.
	unique := make([]RouteInputStop, 0, len(input.Stops))
	positions := make(map[string]int)

	for i, stop := range input.Stops {
		if !validPoint(stop) {
			c.JSON(400, gin.H{"error": fmt.Sprintf("Invalid coordinates at row %d", i+1)})
			return
		}

		key := coordKey(stop)
		if existing, found := positions[key]; found {
			unique[existing].Services = append(
				unique[existing].Services, stop.Services...,
			)
			continue
		}

		positions[key] = len(unique)
		unique = append(unique, stop)
	}

	if len(unique) < 2 {
		c.JSON(400, gin.H{"error": "At least two distinct locations required"})
		return
	}

	coordinates := make([][2]float64, len(unique))
	for i, stop := range unique {
		coordinates[i] = [2]float64{stop.Longitude, stop.Latitude}
	}

	payload := CloudRouteRequest{
		Coordinates: coordinates,
		RoundTrip: input.RoundTrip,
	}

	// Exact-order cache avoids positional-index mismatches.
	cacheInput := struct {
		Coordinates [][2]float64 `json:"coordinates"`
		RoundTrip   bool         `json:"round_trip"`
		Version     string       `json:"version"`
	}{coordinates, input.RoundTrip, "guarda-vroom-osrm-v1"}

	rawKey, _ := json.Marshal(cacheInput)
	sum := sha256.Sum256(rawKey)
	cacheKey := hex.EncodeToString(sum[:])

	var result CloudRouteResponse
	var cached models.RouteOptimizationCache

	err := database.RouteDB.First(&cached, "key = ?", cacheKey).Error
	if err == nil {
		_ = json.Unmarshal(cached.Result, &result)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(500, gin.H{"error": "Cache lookup failed"})
		return
	}

	if !validOrder(result.Order, len(unique)) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
		defer cancel()

		result, err = requestOptimization(ctx, payload)
		if err != nil {
			c.JSON(502, gin.H{"error": err.Error()})
			return
		}
		if !validOrder(result.Order, len(unique)) ||
			math.IsNaN(result.DistanceM) ||
			math.IsNaN(result.DurationS) ||
			result.DistanceM < 0 || result.DurationS < 0 {
			c.JSON(502, gin.H{"error": "Invalid routing response"})
			return
		}

		data, _ := json.Marshal(result)
		if err := database.RouteDB.Save(&models.RouteOptimizationCache{
			Key: cacheKey, Result: data,
		}).Error; err != nil {
			c.JSON(500, gin.H{"error": "Unable to cache route"})
			return
		}
	}

	ordered := make([]RouteInputStop, 0, len(unique)+1)
	for _, index := range result.Order {
		ordered = append(ordered, unique[index])
	}
	if input.RoundTrip {
		ordered = append(ordered, unique[0])
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Guarda Route"
	}

	plan := models.RoutePlan{
		Name:      name,
		CacheKey:  cacheKey,
		DistanceM: result.DistanceM,
		DurationS: result.DurationS,
	}

	for i, stop := range ordered {
		item := models.RouteStop{
			Sequence:  i,
			Address:   stop.Address,
			Latitude:  stop.Latitude,
			Longitude: stop.Longitude,
		}

		// The final repeated depot is not a second delivery.
		if !(input.RoundTrip && i == len(ordered)-1) {
			for _, service := range stop.Services {
				kind := service.ServiceType
				if kind != "delivery" && kind != "pickup" {
					kind = "unknown"
				}
				item.Services = append(item.Services, models.RouteService{
					ServiceType: kind,
				})
			}
		}

		plan.Stops = append(plan.Stops, item)
	}

	const maxLegs = 4
	for start := 0; start < len(ordered)-1; {
		end := start + maxLegs
		if end >= len(ordered) {
			end = len(ordered)-1
		}

		plan.Segments = append(plan.Segments, models.RouteSegment{
			Sequence:      len(plan.Segments)+1,
			StartStop:     start,
			EndStop:       end,
			GoogleMapsURL: mapsURL(ordered[start : end+1]),
		})
		start = end
	}

	if err := database.RouteDB.Create(&plan).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save route"})
		return
	}
	c.JSON(201, plan)
}

func ListRoutePlans(c *gin.Context) {
	var plans []models.RoutePlan

	err := database.RouteDB.
		Preload("Stops", func(db *gorm.DB) *gorm.DB {
			return db.Order("sequence ASC")
		}).
		Preload("Stops.Services").
		Preload("Segments", func(db *gorm.DB) *gorm.DB {
			return db.Order("sequence ASC")
		}).
		Order("created_at DESC").
		Limit(30).
		Find(&plans).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to load routes"})
		return
	}
	c.JSON(200, plans)
}

func SetRouteSegmentCompleted(c *gin.Context) {
	var input struct {
		Completed *bool `json:"completed" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	var completedAt *time.Time
	if *input.Completed {
		now := time.Now().UTC()
		completedAt = &now
	}

	tx := database.RouteDB.Model(&models.RouteSegment{}).
		Where("id = ? AND route_id = ?", c.Param("segmentId"), c.Param("id")).
		Updates(map[string]interface{}{
			"completed": *input.Completed,
			"completed_at": completedAt,
		})

	if tx.Error != nil {
		c.JSON(500, gin.H{"error": "Unable to update segment"})
		return
	}
	if tx.RowsAffected == 0 {
		c.JSON(404, gin.H{"error": "Segment not found"})
		return
	}

	c.JSON(200, gin.H{"completed": *input.Completed})
}
