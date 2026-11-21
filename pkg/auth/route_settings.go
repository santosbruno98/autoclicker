package auth

import (
	"encoding/json"
	"net/http"
	"time"

	"autoclicker/pkg/handlers"

	"github.com/gin-gonic/gin"
)

func routeSettingsKey(c *gin.Context) string {
	return plannerKey(c) + ":settings"
}

func (s *Service) readRouteSettings(
	c *gin.Context,
) (handlers.RouteSettings, error) {
	var raw *string

	err := s.command(
		c.Request.Context(),
		&raw,
		"GET",
		routeSettingsKey(c),
	)
	if err != nil {
		return handlers.RouteSettings{}, err
	}

	if raw == nil {
		return handlers.RouteSettings{
			Revision: "",
			Area:     nil,
		}, nil
	}

	var settings handlers.RouteSettings
	err = json.Unmarshal([]byte(*raw), &settings)
	return settings, err
}

func (s *Service) GetRouteSettings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	settings, err := s.readRouteSettings(c)
	if err != nil {
		c.JSON(503, gin.H{"error": "Route settings are unavailable"})
		return
	}

	c.JSON(200, gin.H{"settings": settings})
}

func (s *Service) SearchRouteAreas(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	user := c.MustGet("session").(Session)

	results, err := handlers.SearchRouteAreas(
		c.Request.Context(),
		user.GoogleSub,
		c.Query("q"),
	)
	if err != nil {
		c.JSON(502, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"results": results})
}

const saveRouteSettingsScript = `
local raw = redis.call('GET', KEYS[1])
local revision = ''

if raw then
  revision = cjson.decode(raw).revision
end

if revision ~= ARGV[1] then
  return {0, raw or ''}
end

redis.call('SET', KEYS[1], ARGV[2])
return {1, ARGV[2]}
`

func (s *Service) SaveRouteSettings(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)

	var input struct {
		ExpectedRevision string `json:"expected_revision"`
		SelectionToken   string `json:"selection_token"`
	}

	if c.ShouldBindJSON(&input) != nil ||
		len(input.ExpectedRevision) > 128 {
		c.JSON(400, gin.H{"error": "Invalid settings request"})
		return
	}

	user := c.MustGet("session").(Session)

	area, err := handlers.VerifyRouteAreaSelection(
		user.GoogleSub,
		input.SelectionToken,
	)
	if err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
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
		c.JSON(500, gin.H{"error": "Cannot encode settings"})
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
		c.JSON(503, gin.H{"error": "Cannot save route settings"})
		return
	}

	var accepted int
	var raw string

	if len(result) != 2 ||
		json.Unmarshal(result[0], &accepted) != nil ||
		json.Unmarshal(result[1], &raw) != nil {
		c.JSON(503, gin.H{"error": "Invalid settings-store response"})
		return
	}

	if accepted != 1 {
		c.JSON(http.StatusConflict, gin.H{
			"error": "Settings changed on another device; reload them",
			"code":  "AREA_CHANGED",
		})
		return
	}

	c.JSON(200, gin.H{"settings": next})
}

func (s *Service) RequireRouteArea() gin.HandlerFunc {
	return func(c *gin.Context) {
		settings, err := s.readRouteSettings(c)
		if err != nil {
			c.AbortWithStatusJSON(503, gin.H{
				"error": "Route settings are unavailable",
			})
			return
		}

		if settings.Area == nil || settings.Revision == "" {
			c.AbortWithStatusJSON(428, gin.H{
				"error": "Select an area in Route Planner Settings first",
				"code":  "AREA_REQUIRED",
			})
			return
		}

		c.Request = c.Request.WithContext(
			handlers.WithRouteSettings(
				c.Request.Context(),
				settings,
			),
		)

		c.Next()
	}
}