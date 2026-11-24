package handlers

import (
	"bytes"
	"context"
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
	ID                string `json:"id"`
	SourceReference   string `json:"source_reference"`
	OriginalAddress   string `json:"original_address"`
	ServiceType       string `json:"service_type"`
	ParcelCount       int    `json:"parcel_count"`
	LocationPrecision string `json:"location_precision"`
}

type RouteInputStop struct {
	Address         string              `json:"address" binding:"required"`
	Locality        string              `json:"locality"`
	Section         string              `json:"section"`
	SectionOverride bool                `json:"section_override"`
	Latitude        float64             `json:"latitude"`
	Longitude       float64             `json:"longitude"`
	Services        []RouteInputService `json:"services"`

	IsOrigin bool `json:"-"`
	IsReturn bool `json:"-"`
}

type CreateRouteRequest struct {
	Name         string           `json:"name"`
	Stops        []RouteInputStop `json:"stops" binding:"required"`
	RoundTrip    bool             `json:"round_trip"`
	AreaRevision string           `json:"area_revision"`
	SectionOrder []string         `json:"section_order"`
	MapsLimit    int              `json:"maps_limit"`
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

	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return errors.New(
			"ROUTING_SERVICE_URL must be an HTTP or HTTPS base URL",
		)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
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

	resp, err := (&http.Client{
		Timeout: 180 * time.Second,
	}).Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("Routing service request failed")
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return errors.New("Invalid routing response size")
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

	if json.Unmarshal(raw, target) != nil {
		return errors.New("Invalid routing response JSON")
	}

	return nil
}

func validPoint(stop RouteInputStop) bool {
	return !math.IsNaN(stop.Latitude) &&
		!math.IsNaN(stop.Longitude) &&
		!math.IsInf(stop.Latitude, 0) &&
		!math.IsInf(stop.Longitude, 0) &&
		math.Abs(stop.Latitude) <= 90 &&
		math.Abs(stop.Longitude) <= 180 &&
		!(stop.Latitude == 0 && stop.Longitude == 0)
}

func coordKey(stop RouteInputStop) string {
	return fmt.Sprintf("%.6f,%.6f", stop.Latitude, stop.Longitude)
}

func validateRoutePoints(
	ctx context.Context,
	coordinates [][2]float64,
) (RouteValidation, error) {
	var result RouteValidation

	if err := routeRPC(
		ctx,
		"/validate",
		gin.H{"coordinates": coordinates},
		&result,
	); err != nil {
		return result, err
	}

	seen := make([]bool, len(coordinates))

	for _, point := range result.Points {
		if point.InputIndex < 0 ||
			point.InputIndex >= len(seen) ||
			seen[point.InputIndex] ||
			!validPoint(RouteInputStop{
				Latitude:  point.RoadLatitude,
				Longitude: point.RoadLongitude,
			}) ||
			math.IsNaN(point.SnapDistanceM) ||
			math.IsInf(point.SnapDistanceM, 0) ||
			point.SnapDistanceM < 0 {
			return result, errors.New("Invalid road-validation point")
		}

		seen[point.InputIndex] = true
	}

	for _, issue := range result.Issues {
		if issue.InputIndex < 0 ||
			issue.InputIndex >= len(seen) ||
			seen[issue.InputIndex] {
			return result, errors.New("Invalid road-validation issue")
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

	if !errors.As(err, &failure) {
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	for index := range failure.Issues {
		issue := &failure.Issues[index]
		if issue.InputIndex < 0 || issue.InputIndex >= len(stops) {
			continue
		}

		stop := stops[issue.InputIndex]
		issue.Address = stop.Address
		issue.IsOrigin = stop.IsOrigin
		issue.ServiceIDs = nil

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
			"Routing response is missing metrics",
		)
	}

	result := CloudRouteResponse{
		Order:     decoded.Order,
		DistanceM: *decoded.DistanceM,
		DurationS: *decoded.DurationS,
	}

	if !validOptimization(result, len(payload.Coordinates)) {
		return result, errors.New(
			"Routing response contains invalid order or metrics",
		)
	}

	return result, nil
}

func cachedSectionOptimization(
	ctx context.Context,
	stops []RouteInputStop,
) (CloudRouteResponse, error) {
	coordinates := make([][2]float64, len(stops))

	for index, stop := range stops {
		coordinates[index] = [2]float64{
			stop.Longitude,
			stop.Latitude,
		}
	}

	payload := CloudRouteRequest{
		Coordinates: coordinates,
		RoundTrip:   false,
	}

	encodedKey, _ := json.Marshal(gin.H{
		"policy":  "separate-sections-v1",
		"payload": payload,
	})
	cacheKey := routeHash(encodedKey)

	var cached models.RouteOptimizationCache
	var result CloudRouteResponse

	err := database.RouteDB.WithContext(ctx).
		First(&cached, "key = ?", cacheKey).Error

	if err == nil {
		_ = json.Unmarshal(cached.Result, &result)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return result, errors.New("Optimization cache lookup failed")
	}

	if validOptimization(result, len(stops)) {
		return result, nil
	}

	result, err = requestOptimization(ctx, payload)
	if err != nil {
		return result, err
	}

	encoded, err := json.Marshal(result)
	if err == nil {
		_ = database.RouteDB.WithContext(ctx).Save(
			&models.RouteOptimizationCache{
				Key:    cacheKey,
				Result: encoded,
			},
		).Error
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

	query := url.Values{
		"api":         {"1"},
		"travelmode":  {"driving"},
		"origin":      {coordinate(stops[0])},
		"destination": {coordinate(stops[len(stops)-1])},
	}

	waypoints := make([]string, 0)

	for _, stop := range stops[1 : len(stops)-1] {
		waypoints = append(waypoints, coordinate(stop))
	}

	if len(waypoints) > 0 {
		query.Set("waypoints", strings.Join(waypoints, "|"))
	}

	return "https://www.google.com/maps/dir/?" + query.Encode()
}

// Classification uses the delivery locality, never the full address.
func ClassifyRouteLocality(locality string) string {
	locality = strings.Split(locality, ",")[0]
	value := addressWords(strings.TrimSpace(locality))

	switch value {
	case "":
		return ""
	case "sabugal", "cidade do sabugal", "cidade de sabugal":
		return "city"
	default:
		return "villages"
	}
}

func mergeRouteInputServices(
	first []RouteInputService,
	second []RouteInputService,
) []RouteInputService {
	result := append([]RouteInputService(nil), first...)
	positions := make(map[string]int)

	for index, service := range result {
		if service.ID != "" {
			positions[service.ID] = index
		}
	}

	for _, service := range second {
		if service.ID != "" {
			if position, exists := positions[service.ID]; exists {
				if service.ParcelCount > result[position].ParcelCount {
					result[position].ParcelCount = service.ParcelCount
				}
				continue
			}
			positions[service.ID] = len(result)
		}

		result = append(result, service)
	}

	return result
}

// Input contains destinations only, without the original starting point.
func PrepareRouteDestinations(
	input []RouteInputStop,
) ([]RouteInputStop, error) {
	result := make([]RouteInputStop, 0)
	positions := make(map[string]int)
	firstInputIndex := make(map[string]int)
	serviceLocations := make(map[string]string)

	for index, original := range input {
		stop := original
		stop.IsOrigin = false
		stop.IsReturn = false

		section := ClassifyRouteLocality(stop.Locality)

		if stop.SectionOverride {
			if stop.Section != "city" && stop.Section != "villages" {
				return nil, errors.New("Invalid manual routing section")
			}
			section = stop.Section
		} else if stop.Section != "" && stop.Section != section {
			return nil, fmt.Errorf(
				"Section does not match locality for %s; use the manual override",
				stop.Address,
			)
		}

		if section == "" {
			return nil, fmt.Errorf(
				"Choose City or Villages for %s",
				stop.Address,
			)
		}

		stop.Section = section
		key := coordKey(stop)

		if position, exists := positions[key]; exists {
			if result[position].Section != section {
				message := "The same destination is assigned to both sections; choose one section for its services"

				return nil, &routingServiceError{
					Status:  422,
					Code:    "SECTION_CONFLICT",
					Message: message,
					Issues: []RoutePointIssue{
						{
							InputIndex: firstInputIndex[key] + 1,
							Code:       "SECTION_CONFLICT",
							Message:    message,
						},
						{
							InputIndex: index + 1,
							Code:       "SECTION_CONFLICT",
							Message:    message,
						},
					},
				}
			}
		}

		for _, service := range stop.Services {
			if service.ID == "" {
				continue
			}

			location := section + ":" + key

			if previous, exists := serviceLocations[service.ID]; exists &&
				previous != location {
				return nil, fmt.Errorf(
					"Shipment %s appears at conflicting destinations",
					service.ID,
				)
			}

			serviceLocations[service.ID] = location
		}

		if position, exists := positions[key]; exists {
			result[position].Services = mergeRouteInputServices(
				result[position].Services,
				stop.Services,
			)
			continue
		}

		positions[key] = len(result)
		firstInputIndex[key] = index
		stop.Services = mergeRouteInputServices(nil, stop.Services)
		result = append(result, stop)
	}

	return result, nil
}

func RouteSegmentsForSection(
	ordered []RouteInputStop,
	section string,
	startOffset int,
	limit int,
) ([]models.RouteSegment, error) {
	if section != "city" && section != "villages" {
		return nil, errors.New("Invalid routing section")
	}
	if limit != 4 && limit != 10 {
		return nil, errors.New("Maps link limit must be 4 or 10")
	}
	if startOffset < 0 {
		return nil, errors.New("Invalid route offset")
	}

	result := make([]models.RouteSegment, 0)

	for start := 0; start < len(ordered)-1; {
		end := start + limit
		if end >= len(ordered) {
			end = len(ordered) - 1
		}

		count := 0
		includesReturn := false

		for _, stop := range ordered[start+1 : end+1] {
			if stop.IsReturn {
				includesReturn = true
			} else {
				count++
			}
		}

		result = append(result, models.RouteSegment{
			Section:          section,
			SectionSequence:  len(result) + 1,
			DestinationCount: count,
			IncludesReturn:   includesReturn,
			StartStop:        startOffset + start,
			EndStop:          startOffset + end,
			GoogleMapsURL:    mapsURL(ordered[start : end+1]),
		})

		start = end
	}

	for index := range result {
		result[index].SectionRouteCount = len(result)
	}

	return result, nil
}

func CreateRoutePlan(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)

	var input CreateRouteRequest

	if c.ShouldBindJSON(&input) != nil ||
		len(input.Stops) < 2 || len(input.Stops) > 150 {
		c.JSON(400, gin.H{
			"error": "Provide a start and 1 to 149 destinations",
		})
		return
	}

	if !requireAreaRevision(c, input.AreaRevision) {
		return
	}

	if input.MapsLimit == 0 {
		input.MapsLimit = destinationsPerGoogleMapsRoute
	}
	if input.MapsLimit != 4 && input.MapsLimit != 10 {
		c.JSON(400, gin.H{"error": "maps_limit must be 4 or 10"})
		return
	}

	if len(input.SectionOrder) == 0 {
		input.SectionOrder = []string{"villages", "city"}
	}

	if len(input.SectionOrder) != 2 ||
		input.SectionOrder[0] == input.SectionOrder[1] ||
		(input.SectionOrder[0] != "city" && input.SectionOrder[0] != "villages") ||
		(input.SectionOrder[1] != "city" && input.SectionOrder[1] != "villages") {
		c.JSON(400, gin.H{
			"error": "section_order must contain city and villages once each",
		})
		return
	}

	ctx, cancel := context.WithTimeout(
		c.Request.Context(),
		240*time.Second,
	)
	defer cancel()

	settings, err := CurrentRouteSettings(ctx)
	if err != nil {
		c.JSON(428, gin.H{"error": err.Error()})
		return
	}

	coordinates := make([][2]float64, len(input.Stops))

	for index := range input.Stops {
		stop := &input.Stops[index]
		stop.IsOrigin = index == 0
		stop.IsReturn = false

		if strings.TrimSpace(stop.Address) == "" || !validPoint(*stop) {
			c.JSON(422, gin.H{
				"error":       "Invalid stop",
				"input_index": index,
			})
			return
		}

		coordinates[index] = [2]float64{
			stop.Longitude,
			stop.Latitude,
		}

		if index > 0 {
			inside, err := RoutePointInsideArea(
				ctx,
				*settings.Area,
				stop.Longitude,
				stop.Latitude,
			)
			if err != nil {
				c.JSON(503, gin.H{"error": err.Error()})
				return
			}

			if !inside {
				respondRoutingError(c, &routingServiceError{
					Status:  422,
					Code:    "ROUTING_POINTS_REJECTED",
					Message: "Destination is outside the selected area",
					Issues: []RoutePointIssue{{
						InputIndex: index,
						Code:       "OUTSIDE_SELECTED_AREA",
						Message:    "Destination is outside the selected area",
					}},
				}, input.Stops)
				return
			}
		}
	}

	destinations, err := PrepareRouteDestinations(input.Stops[1:])
	if err != nil {
		var failure *routingServiceError
		if errors.As(err, &failure) {
			respondRoutingError(c, err, input.Stops)
		} else {
			c.JSON(422, gin.H{"error": err.Error()})
		}
		return
	}

	validation, err := validateRoutePoints(ctx, coordinates)
	if err != nil {
		respondRoutingError(c, err, input.Stops)
		return
	}
	if len(validation.Issues) > 0 {
		respondRoutingError(c, &routingServiceError{
			Status:  422,
			Code:    "ROUTING_POINTS_REJECTED",
			Message: "Some locations need attention",
			Issues:  validation.Issues,
		}, input.Stops)
		return
	}

	originalOrigin := input.Stops[0]
	originalOrigin.Services = nil
	originalOrigin.Section = "origin"

	orderedAll := []RouteInputStop{originalOrigin}
	carry := originalOrigin

	plan := models.RoutePlan{
		AreaRevision: settings.Revision,
		AreaID:       settings.Area.ID,
		AreaLabel:    settings.Area.Label,
		SectionOrder: strings.Join(input.SectionOrder, ","),
		MapsLimit:    input.MapsLimit,
	}

	nonempty := make([]string, 0, 2)

	for _, section := range input.SectionOrder {
		for _, stop := range destinations {
			if stop.Section == section {
				nonempty = append(nonempty, section)
				break
			}
		}
	}

	for sectionIndex, section := range nonempty {
		group := []RouteInputStop{carry}

		for _, stop := range destinations {
			if stop.Section == section {
				group = append(group, stop)
			}
		}

		result, err := cachedSectionOptimization(ctx, group)
		if err != nil {
			respondRoutingError(c, err, group)
			return
		}

		orderedGroup := make([]RouteInputStop, 0, len(group)+1)

		for _, index := range result.Order {
			orderedGroup = append(orderedGroup, group[index])
		}

		plan.DistanceM += result.DistanceM
		plan.DurationS += result.DurationS

		targetCount := len(orderedGroup) - 1

		if section == "city" {
			plan.CityStops = targetCount
		} else {
			plan.VillageStops = targetCount
		}

		if input.RoundTrip &&
			sectionIndex == len(nonempty)-1 &&
			coordKey(orderedGroup[len(orderedGroup)-1]) != coordKey(originalOrigin) {
			last := orderedGroup[len(orderedGroup)-1]

			back := originalOrigin
			back.IsOrigin = false
			back.IsReturn = true
			back.Section = section

			returnResult, err := cachedSectionOptimization(
				ctx,
				[]RouteInputStop{last, back},
			)
			if err != nil {
				respondRoutingError(
					c,
					err,
					[]RouteInputStop{last, back},
				)
				return
			}

			plan.DistanceM += returnResult.DistanceM
			plan.DurationS += returnResult.DurationS
			orderedGroup = append(orderedGroup, back)
		}

		offset := len(orderedAll) - 1

		segments, err := RouteSegmentsForSection(
			orderedGroup,
			section,
			offset,
			input.MapsLimit,
		)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		for _, segment := range segments {
			segment.Sequence = len(plan.Segments) + 1
			plan.Segments = append(plan.Segments, segment)
		}

		orderedAll = append(orderedAll, orderedGroup[1:]...)
		carry = orderedGroup[len(orderedGroup)-1]
	}

	for index, stop := range orderedAll {
		item := models.RouteStop{
			Sequence:  index,
			Address:   stop.Address,
			Locality:  stop.Locality,
			Section:   stop.Section,
			Latitude:  stop.Latitude,
			Longitude: stop.Longitude,
			IsOrigin:  stop.IsOrigin,
			IsReturn:  stop.IsReturn,
		}

		for _, service := range stop.Services {
			count := service.ParcelCount
			if count < 1 {
				count = 1
			}

			kind := service.ServiceType
			if kind != "delivery" && kind != "pickup" {
				kind = "unknown"
			}

			item.Services = append(item.Services, models.RouteService{
				ServiceID:         service.ID,
				SourceReference:   service.SourceReference,
				OriginalAddress:   service.OriginalAddress,
				ServiceType:       kind,
				ParcelCount:       count,
				LocationPrecision: service.LocationPrecision,
			})
		}

		plan.Stops = append(plan.Stops, item)
	}

	plan.Name = fmt.Sprintf(
		"Sabugal: %d city / %d village destinations · %d links",
		plan.CityStops,
		plan.VillageStops,
		len(plan.Segments),
	)

	if database.RouteDB.WithContext(ctx).Create(&plan).Error != nil {
		c.JSON(500, gin.H{"error": "Cannot save journey"})
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
		Order("created_at DESC").
		Limit(30).
		Find(&plans).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Cannot load journeys"})
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
		Where(
			"id = ? AND route_id = ?",
			c.Param("segmentId"),
			c.Param("id"),
		).
		Updates(map[string]any{
			"completed":    *input.Completed,
			"completed_at": completedAt,
		})

	if result.Error != nil {
		c.JSON(500, gin.H{"error": "Cannot update route completion"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(404, gin.H{"error": "Route segment not found"})
		return
	}

	c.JSON(200, gin.H{"completed": *input.Completed})
}
