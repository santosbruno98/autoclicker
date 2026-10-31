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

const destinationsPerGoogleMapsRoute = 10

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

	coordinate := func(stop RouteInputStop) string {
		return strconv.FormatFloat(stop.Latitude, 'f', 6, 64) +
			"," +
			strconv.FormatFloat(stop.Longitude, 'f', 6, 64)
	}

	params := url.Values{}
	params.Set("api", "1")
	params.Set("travelmode", "driving")
	params.Set("origin", coordinate(stops[0]))
	params.Set("destination", coordinate(stops[len(stops)-1]))

	waypoints := make([]string, 0, len(stops)-2)

	for _, stop := range stops[1 : len(stops)-1] {
		waypoints = append(waypoints, coordinate(stop))
	}

	if len(waypoints) > 0 {
		params.Set("waypoints", strings.Join(waypoints, "|"))
	}

	return "https://www.google.com/maps/dir/?" + params.Encode()
}

func validOrder(order []int, count int) bool {
	if count < 2 || len(order) != count || order[0] != 0 {
		return false
	}

	seen := make([]bool, count)

	for _, index := range order {
		if index < 0 || index >= count || seen[index] {
			return false
		}

		seen[index] = true
	}

	return true
}

func validOptimization(result CloudRouteResponse, count int) bool {
	return validOrder(result.Order, count) &&
		!math.IsNaN(result.DistanceM) &&
		!math.IsNaN(result.DurationS) &&
		!math.IsInf(result.DistanceM, 0) &&
		!math.IsInf(result.DurationS, 0) &&
		result.DistanceM >= 0 &&
		result.DurationS >= 0
}

func requestOptimization(
	ctx context.Context,
	payload CloudRouteRequest,
) (CloudRouteResponse, error) {
	endpoint := strings.TrimRight(
		strings.TrimSpace(os.Getenv("ROUTING_SERVICE_URL")),
		"/",
	)

	if endpoint == "" {
		return CloudRouteResponse{}, errors.New(
			"ROUTING_SERVICE_URL is missing",
		)
	}

	apiKey := strings.TrimSpace(os.Getenv("ROUTING_API_KEY"))
	if apiKey == "" {
		return CloudRouteResponse{}, errors.New(
			"ROUTING_API_KEY is missing",
		)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return CloudRouteResponse{}, fmt.Errorf(
			"cannot encode routing request: %w",
			err,
		)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint+"/optimize",
		bytes.NewReader(body),
	)
	if err != nil {
		return CloudRouteResponse{}, fmt.Errorf(
			"cannot create routing request: %w",
			err,
		)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{
		Timeout: 180 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		// Preserve cancellation/deadline errors for the calling handler.
		return CloudRouteResponse{}, fmt.Errorf(
			"routing service request failed: %w",
			err,
		)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		message, readErr := io.ReadAll(
			io.LimitReader(resp.Body, 2048),
		)

		if readErr != nil {
			return CloudRouteResponse{}, fmt.Errorf(
				"routing service HTTP %d: cannot read error response",
				resp.StatusCode,
			)
		}

		detail := strings.ReplaceAll(
			strings.TrimSpace(string(message)),
			apiKey,
			"[REDACTED]",
		)

		if detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}

		return CloudRouteResponse{}, fmt.Errorf(
			"routing service HTTP %d: %s",
			resp.StatusCode,
			detail,
		)
	}

	var result CloudRouteResponse

	if err := json.NewDecoder(
		io.LimitReader(resp.Body, 1<<20),
	).Decode(&result); err != nil {
		return CloudRouteResponse{}, fmt.Errorf(
			"invalid routing service response: %w",
			err,
		)
	}

	if !validOptimization(result, len(payload.Coordinates)) {
		return CloudRouteResponse{}, errors.New(
			"routing service returned an invalid stop order or route metrics",
		)
	}

	return result, nil
}

func coordKey(stop RouteInputStop) string {
	return fmt.Sprintf(
		"%.6f,%.6f",
		stop.Latitude,
		stop.Longitude,
	)
}

func validPoint(stop RouteInputStop) bool {
	return !math.IsNaN(stop.Latitude) &&
		!math.IsNaN(stop.Longitude) &&
		!math.IsInf(stop.Latitude, 0) &&
		!math.IsInf(stop.Longitude, 0) &&
		stop.Latitude >= -90 &&
		stop.Latitude <= 90 &&
		stop.Longitude >= -180 &&
		stop.Longitude <= 180 &&
		!(stop.Latitude == 0 && stop.Longitude == 0)
}

func CreateRoutePlan(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Routes database unavailable",
		})
		return
	}

	var input CreateRouteRequest

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	// First location is the user's current position.
	// Remaining locations are delivery/pickup destinations.
	if len(input.Stops) < 2 || len(input.Stops) > 150 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Provide a starting location and 1 to 149 destinations",
		})
		return
	}

	unique := make([]RouteInputStop, 0, len(input.Stops))
	positions := make(map[string]int)

	for index, stop := range input.Stops {
		stop.Address = strings.TrimSpace(stop.Address)

		if stop.Address == "" || !validPoint(stop) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf(
					"Invalid address or coordinates at location %d",
					index+1,
				),
			})
			return
		}

		key := coordKey(stop)

		if existing, found := positions[key]; found {
			unique[existing].Services = append(
				unique[existing].Services,
				stop.Services...,
			)
			continue
		}

		positions[key] = len(unique)
		unique = append(unique, stop)
	}

	if len(unique) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "All destinations match the starting location",
		})
		return
	}

	coordinates := make([][2]float64, len(unique))

	for index, stop := range unique {
		// VROOM/OSRM expects longitude before latitude.
		coordinates[index] = [2]float64{
			stop.Longitude,
			stop.Latitude,
		}
	}

	payload := CloudRouteRequest{
		Coordinates: coordinates,
		RoundTrip:   input.RoundTrip,
	}

	cacheInput := struct {
		Coordinates [][2]float64 `json:"coordinates"`
		RoundTrip   bool         `json:"round_trip"`
		Version     string       `json:"version"`
	}{
		Coordinates: coordinates,
		RoundTrip:   input.RoundTrip,
		Version:     "guarda-vroom-osrm-v1",
	}

	rawKey, err := json.Marshal(cacheInput)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Unable to encode optimization cache key",
		})
		return
	}

	sum := sha256.Sum256(rawKey)
	cacheKey := hex.EncodeToString(sum[:])

	ctx, cancel := context.WithTimeout(
		c.Request.Context(),
		180*time.Second,
	)
	defer cancel()

	var result CloudRouteResponse
	var cached models.RouteOptimizationCache

	err = database.RouteDB.WithContext(ctx).
		First(&cached, "key = ?", cacheKey).Error

	if err == nil {
		_ = json.Unmarshal(cached.Result, &result)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Optimization cache lookup failed",
		})
		return
	}

	if !validOptimization(result, len(unique)) {
		// Optimize the entire journey using the existing cloud service.
		// Do not optimize separate batches independently.
		result, err = requestOptimization(ctx, payload)

		if err != nil {
			status := http.StatusBadGateway
			if errors.Is(err, context.DeadlineExceeded) {
				status = http.StatusGatewayTimeout
			}

			c.JSON(status, gin.H{
				"error": err.Error(),
			})
			return
		}

		if !validOptimization(result, len(unique)) {
			c.JSON(http.StatusBadGateway, gin.H{
				"error": "Routing service returned an invalid stop order or route metrics",
			})
			return
		}

		encoded, err := json.Marshal(result)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Unable to encode optimized route",
			})
			return
		}

		if err := database.RouteDB.WithContext(ctx).
			Save(&models.RouteOptimizationCache{
				Key:    cacheKey,
				Result: encoded,
			}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Unable to cache optimized route",
			})
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

	plan := models.RoutePlan{
		CacheKey:  cacheKey,
		DistanceM: result.DistanceM,
		DurationS: result.DurationS,
	}

	for index, stop := range ordered {
		item := models.RouteStop{
			Sequence:  index,
			Address:   stop.Address,
			Latitude:  stop.Latitude,
			Longitude: stop.Longitude,
		}

		isRepeatedDepot := input.RoundTrip &&
			index == len(ordered)-1

		if !isRepeatedDepot {
			for _, service := range stop.Services {
				kind := service.ServiceType

				if kind != "delivery" && kind != "pickup" {
					kind = "unknown"
				}

				item.Services = append(
					item.Services,
					models.RouteService{
						ServiceType: kind,
					},
				)
			}
		}

		plan.Stops = append(plan.Stops, item)
	}

	// Each link contains:
	//   - One starting point.
	//   - Up to ten subsequent stops.
	//
	// The next link reuses the previous link's endpoint as its start.
	for start := 0; start < len(ordered)-1; {
		end := start + destinationsPerGoogleMapsRoute

		if end >= len(ordered) {
			end = len(ordered) - 1
		}

		plan.Segments = append(
			plan.Segments,
			models.RouteSegment{
				Sequence:      len(plan.Segments) + 1,
				StartStop:     start,
				EndStop:       end,
				GoogleMapsURL: mapsURL(ordered[start : end+1]),
			},
		)

		start = end
	}

	// No user-entered route name.
	// Individual link names are derived from segment sequence and count.
	plan.Name = fmt.Sprintf(
		"%d Google Maps routes",
		len(plan.Segments),
	)

	if err := database.RouteDB.WithContext(ctx).
		Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Unable to save optimized routes",
		})
		return
	}

	c.JSON(http.StatusCreated, plan)
}

func ListRoutePlans(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Routes database unavailable",
		})
		return
	}

	plans := make([]models.RoutePlan, 0)

	err := database.RouteDB.WithContext(c.Request.Context()).
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
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Unable to load saved routes",
		})
		return
	}

	c.JSON(http.StatusOK, plans)
}

func SetRouteSegmentCompleted(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Routes database unavailable",
		})
		return
	}

	var input struct {
		Completed *bool `json:"completed" binding:"required"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	var completedAt *time.Time

	if *input.Completed {
		now := time.Now().UTC()
		completedAt = &now
	}

	tx := database.RouteDB.WithContext(c.Request.Context()).
		Model(&models.RouteSegment{}).
		Where(
			"id = ? AND route_id = ?",
			c.Param("segmentId"),
			c.Param("id"),
		).
		Updates(map[string]interface{}{
			"completed":    *input.Completed,
			"completed_at": completedAt,
		})

	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Unable to update route completion",
		})
		return
	}

	if tx.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Route segment not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"completed": *input.Completed,
	})
}
