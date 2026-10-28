package handlers

import (
	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RouteInputStop struct {
	Address   string  `json:"address" binding:"required"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type CreateRouteRequest struct {
	Name      string           `json:"name" binding:"required"`
	Stops     []RouteInputStop `json:"stops" binding:"required"`
	RoundTrip bool             `json:"round_trip"`
}

type CloudRouteRequest struct {
	Coordinates [][2]float64 `json:"coordinates"` // lat, lon
	RouteTrips  bool         `json:"round_trip"`
}

type CloudRouteResponse struct {
	Order     []int   `json:"order"`
	DistanceM float64 `json:"distance_m"`
	DurationS float64 `json:"duration_s"`
}

func mapsURL(stops []RouteInputStop) string {
	if len(stops) <= 0 {
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

	var waypoints []string

	for _, stop := range stops[1 : len(stops)-1] {
		waypoints = append(waypoints, coord(stop))
	}
	if len(waypoints) > 0 {
		q.Set("waypoints", strings.Join(waypoints, "|"))
	}

	return "https://www.google.com/maps/dir/?" + q.Encode()
}

func validOrder(order []int, count int) bool {
	if len(order) != count || order[0] != 0 {
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
	endpoint := strings.TrimRight(os.Getenv("ROUTING_SERVICE_URL"), "/") // TODO: get the routing service URL
	if endpoint == "" {
		return CloudRouteResponse{}, errors.New("ROUTING_SERVICE_URL is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CloudRouteResponse{}, err
	}

	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint+"/optimize",
		bytes.NewReader(body),
	)

	if err != nil {
		return CloudRouteResponse{}, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("ROUTING_API_KEY"))

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CloudRouteResponse{}, err
	}

	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return CloudRouteResponse{}, errors.New("Routing service returned an error")
	}

	var result CloudRouteResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).
		Decode(&result); err != nil {
		return result, err
	}
	return result, nil
}

func CreateRoutePlan(c *gin.Context) {
	var input CreateRouteRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	if len(input.Stops) < 2 || len(input.Stops) > 150 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "too many stops, from 2 to 150"})
		return
	}

	coordinates := make([][2]float64, len(input.Stops))
	for i, stop := range input.Stops {
		if stop.Latitude < -90 || stop.Latitude > 90 || stop.Longitude < -180 || stop.Longitude > 180 { // TODO: this should be guarda district
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid coordinates"})
			return
		}
		coordinates[i] = [2]float64{stop.Longitude, stop.Latitude}
	}

	payload := CloudRouteRequest{
		Coordinates: coordinates,
		RouteTrips:  input.RoundTrip,
	}
	// Extracct request cache: stop order
	normalized := append([][2]float64(nil), coordinates[1:]...)

	sort.Slice(normalized, func(i, j int) bool {
		if normalized[i][0] != normalized[j][0] {
			return normalized[i][0] < normalized[j][0]
		}
		return normalized[i][1] < normalized[j][1]
	})

	cacheInput := struct {
		Coordinates [][2]float64 `json:"coordinates"`
		RoundTrip   bool         `json:"round_trip"`
		Version     string       `json:"version"`
	}{
		Coordinates: coordinates,
		RoundTrip:   input.RoundTrip,
		Version:     "guarda-osrm-v1",
	}

	rawKey, err := json.Marshal(cacheInput)
	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to create cache key"})
		return
	}

	hash := sha256.Sum256(rawKey)
	cacheKey := hex.EncodeToString(hash[:])

	var cached models.RouteOptimizationCache
	var result CloudRouteResponse

	if err := database.RouteDB.Where(&cached, "Key = ?", cacheKey).Error; err == nil {
		if err := json.Unmarshal(cached.Result, &result); err == nil {
			var saved struct {
				Coordinates [][2]float64       `json:"coordinates"`
				Result      CloudRouteResponse `json:"result"`
			}
			if json.Unmarshal(cached.Result, &saved) == nil && len(saved.Coordinates) == len(coordinates) {
				matches := true
				for i := range coordinates {
					if coordinates[i] != saved.Coordinates[i] {
						matches = false
						break
					}
				}
				if matches {
					result = saved.Result
				}
			}
		}
	}

	if !validOrder(result.Order, len(input.Stops)) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
		defer cancel()

		var err error
		result, err = requestOptimization(ctx, payload)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if !validOrder(result.Order, len(input.Stops)) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid order"})
			return
		}

		saved, _ := json.Marshal(struct {
			Coordinates [][2]float64       `json:"coordinates"`
			Result      CloudRouteResponse `json:"result"`
		}{coordinates, result})
		database.RouteDB.Save(&models.RouteOptimizationCache{
			Key:    cacheKey,
			Result: saved,
		})
	}

	ordered := make([]RouteInputStop, 0, len(result.Order)+1)
	for _, index := range result.Order {
		ordered = append(ordered, input.Stops[index])
	}

	if input.RoundTrip {
		ordered = append(ordered, input.Stops[0])
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
		plan.Stops = append(plan.Stops, models.RouteStop{
			Sequence:  i,
			Address:   stop.Address,
			Latitude:  stop.Latitude,
			Longitude: stop.Longitude,
		})
	}

	const maxLegs = 4
	for start := 0; start < len(ordered)-1; {
		end := start + maxLegs
		if end > len(ordered)-1 {
			end = len(ordered) - 1
		}
		plan.Segments = append(plan.Segments, models.RouteSegment{
			Sequence:      start,
			StartStop:     start,
			EndStop:       end,
			GoogleMapsURL: mapsURL(ordered[start : end+1]),
		})
		start = end
	}

	if err := database.RouteDB.Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, plan)
}

func ListRoutePlans(c *gin.Context) { //TODO: Update i want also the generated links
	var plans []models.RoutePlan
	if err := database.RouteDB.
		Preload("Stops", func(db *gorm.DB) *gorm.DB {
			return db.Order("sequence ASC")
		}).
		Preload("Segments", func(db *gorm.DB) *gorm.DB {
			return db.Order("sequence ASC")
		}).
		Order("created_at DESC").Limit(30).Find(&plans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to load routes"})
		return
	}
	c.JSON(200, plans)
}

func SetRouteSegmentCompleted(c *gin.Context) {
	var input struct {
		Completed bool `json:"completed"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	var completedAt *time.Time
	if input.Completed {
		now := time.Now().UTC()
		completedAt = &now
	}

	tx := database.RouteDB.Model(&models.RouteSegment{}).
		Where("id = ? AND route_id = ?", c.Param("segmentId"), c.Param("id")).
		Updates(map[string]interface{}{
			"completed":    input.Completed,
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
	c.JSON(200, gin.H{"completed": input.Completed})
}
