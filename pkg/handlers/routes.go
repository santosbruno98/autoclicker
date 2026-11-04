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
	ID          string `json:"id"`
	ServiceType string `json:"service_type"`
	ParcelCount int    `json:"parcel_count"`
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

type RoutePointIssue struct {
	InputIndex   int      `json:"input_index"`
	Code         string   `json:"code"`
	Message      string   `json:"message"`
	Longitude    float64  `json:"longitude"`
	Latitude     float64  `json:"latitude"`
	SnapDistance *float64 `json:"snap_distance_m,omitempty"`
	Address      string   `json:"address,omitempty"`
	IsOrigin     bool     `json:"is_origin"`
	ServiceIDs   []string `json:"service_ids,omitempty"`
}

type RouteRoadPoint struct {
	InputIndex    int     `json:"input_index"`
	Longitude     float64 `json:"longitude"`
	Latitude      float64 `json:"latitude"`
	RoadLongitude float64 `json:"road_longitude"`
	RoadLatitude  float64 `json:"road_latitude"`
	SnapDistanceM float64 `json:"snap_distance_m"`
}

type RouteValidation struct {
	Points []RouteRoadPoint  `json:"points"`
	Issues []RoutePointIssue `json:"issues"`
}

type routingServiceError struct {
	Status  int
	Code    string
	Message string
	Issues  []RoutePointIssue
}

func (err *routingServiceError) Error() string {
	return err.Message
}

func routeRPC(
	ctx context.Context,
	path string,
	payload any,
	target any,
) error {
	endpoint := strings.TrimRight(
		strings.TrimSpace(os.Getenv("ROUTING_SERVICE_URL")),
		"/",
	)
	if endpoint == "" {
		return errors.New("ROUTING_SERVICE_URL is missing")
	}

	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New("ROUTING_SERVICE_URL must be an HTTP or HTTPS base URL")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("cannot encode routing request: %w", err)
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 180 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("routing service request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return errors.New("Cannot read routing service response")
	}

	if resp.StatusCode != http.StatusOK {
		failure := &routingServiceError{
			Status:  resp.StatusCode,
			Code:    "ROUTING_SERVICE_FAILED",
			Message: fmt.Sprintf("Routing service HTTP %d", resp.StatusCode),
		}

		var envelope struct {
			Detail json.RawMessage `json:"detail"`
		}
		if json.Unmarshal(raw, &envelope) == nil {
			var detail struct {
				Code    string            `json:"code"`
				Message string            `json:"message"`
				Issues  []RoutePointIssue `json:"issues"`
			}
			if json.Unmarshal(envelope.Detail, &detail) == nil &&
				detail.Code != "" {
				failure.Code = detail.Code
				failure.Message = detail.Message
				failure.Issues = detail.Issues
			} else {
				var message string
				if json.Unmarshal(envelope.Detail, &message) == nil {
					failure.Message += ": " + message
				}
			}
		}
		return failure
	}

	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("invalid routing service response: %w", err)
	}
	return nil
}

func validateRoutePoints(
	ctx context.Context,
	coordinates [][2]float64,
) (RouteValidation, error) {
	var result RouteValidation

	err := routeRPC(ctx, "/validate", gin.H{
		"coordinates": coordinates,
	}, &result)
	if err != nil {
		return result, err
	}

	seen := make([]bool, len(coordinates))
	for _, point := range result.Points {
		if point.InputIndex < 0 || point.InputIndex >= len(coordinates) ||
			seen[point.InputIndex] ||
			!validPoint(RouteInputStop{
				Latitude:  point.RoadLatitude,
				Longitude: point.RoadLongitude,
			}) ||
			math.IsNaN(point.SnapDistanceM) ||
			math.IsInf(point.SnapDistanceM, 0) ||
			point.SnapDistanceM < 0 {
			return result, errors.New("Invalid road validation response")
		}
		seen[point.InputIndex] = true
	}
	for _, issue := range result.Issues {
		if issue.InputIndex < 0 || issue.InputIndex >= len(coordinates) ||
			seen[issue.InputIndex] {
			return result, errors.New("Invalid road issue response")
		}
		seen[issue.InputIndex] = true
	}
	for _, exists := range seen {
		if !exists {
			return result, errors.New("Road validation omitted a location")
		}
	}
	return result, nil
}

func respondRoutingError(
	c *gin.Context,
	err error,
	stops []RouteInputStop,
) {
	var failure *routingServiceError
	if errors.As(err, &failure) {
		for index := range failure.Issues {
			issue := &failure.Issues[index]
			if issue.InputIndex < 0 || issue.InputIndex >= len(stops) {
				continue
			}
			stop := stops[issue.InputIndex]
			issue.Address = stop.Address
			issue.IsOrigin = issue.InputIndex == 0
			for _, service := range stop.Services {
				if service.ID != "" {
					issue.ServiceIDs = append(issue.ServiceIDs, service.ID)
				}
			}
		}

		status := http.StatusBadGateway
		switch failure.Status {
		case 400, 422:
			status = http.StatusUnprocessableEntity
		case 503:
			status = http.StatusServiceUnavailable
		case 504:
			status = http.StatusGatewayTimeout
		}

		c.JSON(status, gin.H{
			"error":  failure.Message,
			"code":   failure.Code,
			"issues": failure.Issues,
		})
		return
	}

	status := http.StatusBadGateway
	if errors.Is(err, context.DeadlineExceeded) {
		status = http.StatusGatewayTimeout
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func requestOptimization(
	ctx context.Context,
	payload CloudRouteRequest,
) (CloudRouteResponse, error) {
	var decoded struct {
		Order     []int    `json:"order"`
		DistanceM *float64 `json:"distance_m"`
		DurationS *float64 `json:"duration_s"`
	}

	if err := routeRPC(ctx, "/optimize", payload, &decoded); err != nil {
		return CloudRouteResponse{}, err
	}
	if decoded.DistanceM == nil || decoded.DurationS == nil {
		return CloudRouteResponse{}, errors.New(
			"routing service response is missing distance_m or duration_s",
		)
	}

	result := CloudRouteResponse{
		Order:     decoded.Order,
		DistanceM: *decoded.DistanceM,
		DurationS: *decoded.DurationS,
	}
	if !validOptimization(result, len(payload.Coordinates)) {
		return CloudRouteResponse{}, errors.New(
			"routing service returned an invalid stop order or route metrics",
		)
	}
	return result, nil
}

func mapsURL(stops []RouteInputStop) string {
	if len(stops) < 2 {
		return ""
	}
	coordinate := func(stop RouteInputStop) string {
		return strconv.FormatFloat(stop.Latitude, 'f', 6, 64) + "," +
			strconv.FormatFloat(stop.Longitude, 'f', 6, 64)
	}

	params := url.Values{}
	params.Set("api", "1")
	params.Set("travelmode", "driving")
	params.Set("origin", coordinate(stops[0]))
	params.Set("destination", coordinate(stops[len(stops)-1]))

	var waypoints []string
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
		result.DistanceM >= 0 && result.DurationS >= 0
}

func coordKey(stop RouteInputStop) string {
	return fmt.Sprintf("%.6f,%.6f", stop.Latitude, stop.Longitude)
}

func validPoint(stop RouteInputStop) bool {
	return !math.IsNaN(stop.Latitude) && !math.IsNaN(stop.Longitude) &&
		!math.IsInf(stop.Latitude, 0) && !math.IsInf(stop.Longitude, 0) &&
		stop.Latitude >= -90 && stop.Latitude <= 90 &&
		stop.Longitude >= -180 && stop.Longitude <= 180 &&
		!(stop.Latitude == 0 && stop.Longitude == 0)
}

func CreateRoutePlan(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)

	var input CreateRouteRequest
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Invalid route request"})
		return
	}
	if len(input.Stops) < 2 || len(input.Stops) > 150 {
		c.JSON(400, gin.H{"error": "Provide a start and 1 to 149 destinations"})
		return
	}

	coordinates := make([][2]float64, len(input.Stops))
	for index, stop := range input.Stops {
		if strings.TrimSpace(stop.Address) == "" || !validPoint(stop) {
			c.JSON(422, gin.H{
				"error": "Invalid address or coordinates",
				"issues": []gin.H{{
					"input_index": index,
					"address":     stop.Address,
					"is_origin":   index == 0,
					"code":        "INVALID_COORDINATES",
					"message":     "Choose a valid location",
				}},
			})
			return
		}
		coordinates[index] = [2]float64{stop.Longitude, stop.Latitude}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 180*time.Second)
	defer cancel()

	// Validate the original input indices before deduplication.
	// This also runs when optimization itself can use a cached result.
	validation, err := validateRoutePoints(ctx, coordinates)
	if err != nil {
		respondRoutingError(c, err, input.Stops)
		return
	}
	if len(validation.Issues) > 0 {
		respondRoutingError(c, &routingServiceError{
			Status:  422,
			Code:    "ROUTING_POINTS_REJECTED",
			Message: "Some locations need attention before routing",
			Issues:  validation.Issues,
		}, input.Stops)
		return
	}

	unique := make([]RouteInputStop, 0, len(input.Stops))
	positions := map[string]int{}
	for _, stop := range input.Stops {
		key := coordKey(stop)
		if index, exists := positions[key]; exists {
			unique[index].Services = append(
				unique[index].Services,
				stop.Services...,
			)
		} else {
			positions[key] = len(unique)
			unique = append(unique, stop)
		}
	}
	if len(unique) < 2 {
		c.JSON(422, gin.H{"error": "All destinations match the starting point"})
		return
	}

	coordinates = make([][2]float64, len(unique))
	for index, stop := range unique {
		coordinates[index] = [2]float64{stop.Longitude, stop.Latitude}
	}
	payload := CloudRouteRequest{
		Coordinates: coordinates,
		RoundTrip:   input.RoundTrip,
	}

	cacheInput, _ := json.Marshal(gin.H{
		"version":     "road-validated-v2",
		"coordinates": coordinates,
		"round_trip":  input.RoundTrip,
	})
	sum := sha256.Sum256(cacheInput)
	cacheKey := hex.EncodeToString(sum[:])

	var cached models.RouteOptimizationCache
	var result CloudRouteResponse

	err = database.RouteDB.WithContext(ctx).
		First(&cached, "key = ?", cacheKey).Error

	if err == nil {
		_ = json.Unmarshal(cached.Result, &result)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(500, gin.H{"error": "Optimization cache lookup failed"})
		return
	}

	if !validOptimization(result, len(unique)) {
		result, err = requestOptimization(ctx, payload)
		if err != nil {
			// Optimizer indices now refer to the deduplicated list.
			respondRoutingError(c, err, unique)
			return
		}

		encoded, encodeErr := json.Marshal(result)
		if encodeErr == nil {
			_ = database.RouteDB.WithContext(ctx).
				Save(&models.RouteOptimizationCache{
					Key:    cacheKey,
					Result: encoded,
				}).Error
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
		if !(input.RoundTrip && index == len(ordered)-1) {
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

	for start := 0; start < len(ordered)-1; {
		end := start + destinationsPerGoogleMapsRoute
		if end >= len(ordered) {
			end = len(ordered) - 1
		}
		plan.Segments = append(plan.Segments, models.RouteSegment{
			Sequence:      len(plan.Segments) + 1,
			StartStop:     start,
			EndStop:       end,
			GoogleMapsURL: mapsURL(ordered[start : end+1]),
		})
		start = end
	}
	plan.Name = fmt.Sprintf("%d Google Maps routes", len(plan.Segments))

	if err := database.RouteDB.WithContext(ctx).Create(&plan).Error; err != nil {
		c.JSON(500, gin.H{"error": "Unable to save optimized routes"})
		return
	}
	c.JSON(201, plan)
}

func ListRoutePlans(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
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
		Order("created_at DESC").Limit(30).Find(&plans).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Unable to load saved routes"})
		return
	}
	c.JSON(200, plans)
}

func SetRouteSegmentCompleted(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	var input struct {
		Completed *bool `json:"completed" binding:"required"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "completed must be a boolean"})
		return
	}

	var completedAt *time.Time
	if *input.Completed {
		now := time.Now().UTC()
		completedAt = &now
	}

	result := database.RouteDB.WithContext(c.Request.Context()).
		Model(&models.RouteSegment{}).
		Where("id = ? AND route_id = ?", c.Param("segmentId"), c.Param("id")).
		Updates(map[string]any{
			"completed":    *input.Completed,
			"completed_at": completedAt,
		})

	if result.Error != nil {
		c.JSON(500, gin.H{"error": "Unable to update route completion"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(404, gin.H{"error": "Route segment not found"})
		return
	}
	c.JSON(200, gin.H{"completed": *input.Completed})
}
