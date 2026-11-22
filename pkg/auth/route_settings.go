package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"autoclicker/pkg/handlers"

	"github.com/gin-gonic/gin"
)

func routeSettingsKey(c *gin.Context) string {
	return plannerKey(c) + ":settings"
}

func decodeRouteSettings(
	raw string,
) (handlers.RouteSettings, error) {
	var settings handlers.RouteSettings

	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return handlers.RouteSettings{}, err
	}

	if settings.Area == nil {
		return settings, nil
	}

	if settings.Area.Type == "four_corners" {
		area, err := handlers.NewCornerRouteArea(
			settings.Area.Label,
			settings.Area.Corners,
		)
		if err != nil {
			return handlers.RouteSettings{}, err
		}

		settings.Area = &area
		return settings, nil
	}

	// Read-only migration for settings saved by the earlier backend.
	// GeoJSON is not part of the new save-request contract.
	var legacy struct {
		Area *struct {
			Polygon *struct {
				Type        string        `json:"type"`
				Coordinates [][][]float64 `json:"coordinates"`
			} `json:"polygon"`
		} `json:"area"`
	}

	if err := json.Unmarshal([]byte(raw), &legacy); err != nil {
		return handlers.RouteSettings{}, err
	}

	if legacy.Area == nil || legacy.Area.Polygon == nil {
		// An old administrative-boundary setting remains visible.
		// Routing middleware requires replacing it with four corners.
		return settings, nil
	}

	polygon := legacy.Area.Polygon

	if polygon.Type != "Polygon" ||
		len(polygon.Coordinates) != 1 ||
		len(polygon.Coordinates[0]) != 5 {
		return handlers.RouteSettings{}, errors.New(
			"Previously saved working area is invalid",
		)
	}

	ring := polygon.Coordinates[0]

	for _, coordinate := range ring {
		if len(coordinate) != 2 {
			return handlers.RouteSettings{}, errors.New(
				"Previously saved working-area coordinates are invalid",
			)
		}
	}

	if ring[0][0] != ring[4][0] ||
		ring[0][1] != ring[4][1] {
		return handlers.RouteSettings{}, errors.New(
			"Previously saved working-area outline is not closed",
		)
	}

	corners := make([]handlers.RouteCorner, 0, 4)

	for _, coordinate := range ring[:4] {
		corners = append(corners, handlers.RouteCorner{
			Longitude: coordinate[0],
			Latitude:  coordinate[1],
		})
	}

	label := settings.Area.Label
	if label == "" {
		label = "Delivery area"
	}

	area, err := handlers.NewCornerRouteArea(label, corners)
	if err != nil {
		return handlers.RouteSettings{}, err
	}

	settings.Area = &area
	return settings, nil
}

func (s *Service) readRouteSettings(
	c *gin.Context,
) (handlers.RouteSettings, error) {
	var raw *string

	if err := s.command(
		c.Request.Context(),
		&raw,
		"GET",
		routeSettingsKey(c),
	); err != nil {
		return handlers.RouteSettings{}, err
	}

	if raw == nil {
		return handlers.RouteSettings{
			Revision: "",
			Area:     nil,
		}, nil
	}

	return decodeRouteSettings(*raw)
}

func (s *Service) GetRouteSettings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	settings, err := s.readRouteSettings(c)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Route settings are unavailable",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"settings": settings,
	})
}

func (s *Service) SearchRouteAreas(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	c.JSON(http.StatusGone, gin.H{
		"error": "Area search was replaced by the four-corner map picker",
		"code":  "USE_AREA_PICKER",
	})
}

const saveRouteSettingsScript = `
local raw = redis.call('GET', KEYS[1])
local revision = ''

if raw then
  revision = cjson.decode(raw).revision or ''
end

if revision ~= ARGV[1] then
  return {0, raw or ''}
end

redis.call('SET', KEYS[1], ARGV[2])
return {1, ARGV[2]}
`

func (s *Service) SaveRouteSettings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	c.Request.Body = http.MaxBytesReader(
		c.Writer,
		c.Request.Body,
		32<<10,
	)

	var input struct {
		ExpectedRevision string                 `json:"expected_revision"`
		Label            string                 `json:"label"`
		Corners          []handlers.RouteCorner `json:"corners"`
	}

	if c.ShouldBindJSON(&input) != nil ||
		len(input.ExpectedRevision) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid working-area settings request",
		})
		return
	}

	if len(input.Corners) != 4 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": "Provide exactly four corners using longitude and latitude",
			"code":  "FOUR_CORNERS_REQUIRED",
		})
		return
	}

	area, err := handlers.NewCornerRouteArea(
		input.Label,
		input.Corners,
	)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error": err.Error(),
			"code":  "INVALID_WORKING_AREA",
		})
		return
	}

	next := handlers.RouteSettings{
		Revision: handlers.NewRouteRevision(),
		Area:     &area,
		UpdatedAt: time.Now().UTC().
			Format(time.RFC3339Nano),
	}

	encoded, err := json.Marshal(next)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Cannot encode route settings",
		})
		return
	}

	var result []json.RawMessage

	if err := s.command(
		c.Request.Context(),
		&result,
		"EVAL",
		saveRouteSettingsScript,
		1,
		routeSettingsKey(c),
		input.ExpectedRevision,
		string(encoded),
	); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Cannot save route settings",
		})
		return
	}

	var accepted int
	var stored string

	if len(result) != 2 ||
		json.Unmarshal(result[0], &accepted) != nil ||
		json.Unmarshal(result[1], &stored) != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Invalid settings-store response",
		})
		return
	}

	if accepted != 1 {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Settings changed on another device; reload them",
			"code":  "AREA_CHANGED",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"settings": next,
	})
}

func (s *Service) RequireRouteArea() gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := s.readRouteSettings(c)
		if err != nil {
			c.AbortWithStatusJSON(
				http.StatusServiceUnavailable,
				gin.H{
					"error": "Route settings are unavailable",
				},
			)
			return
		}

		ctx := handlers.WithRouteSettings(
			c.Request.Context(),
			settings,
		)

		if _, err := handlers.CurrentRouteSettings(ctx); err != nil {
			c.AbortWithStatusJSON(
				http.StatusPreconditionRequired,
				gin.H{
					"error": err.Error(),
					"code":  "AREA_REQUIRED",
				},
			)
			return
		}

		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
