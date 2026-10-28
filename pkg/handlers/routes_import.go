package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ParsedRouteService struct {
	Address     string  `json:"address"`
	ServiceType string  `json:"service_type"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Status      string  `json:"status"`
	Reason      string  `json:"reason"`
}

type routeParseResult struct {
	Services []ParsedRouteService `json:"services"`
}

var postalPattern = regexp.MustCompile(`\b\d{4}-\d{3}\b`)
var undefinedPattern = regexp.MustCompile(`(?i)\b(undefined|null|nan)\b`)

func routeHash(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizeRouteAddress(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), " ")
	return s
}

func validateRouteAddress(address string) string {
	if undefinedPattern.MatchString(address) {
		return "Address contains undefined fields"
	}
	if !postalPattern.MatchString(address) {
		return "Missing Portuguese postal code"
	}

	// A postal code alone does not prove the locality is known.
	// Require text following the postal code before Portugal.
	match := postalPattern.FindStringIndex(address)
	after := strings.TrimSpace(address[match[1]:])
	after = strings.Trim(after, ", ")
	after = strings.TrimSpace(
		strings.TrimSuffix(
			strings.TrimSuffix(after, "Portugal"),
			"PORTUGAL",
		),
	)
	after = strings.Trim(after, ", ")

	if after == "" {
		return "Missing locality"
	}

	before := strings.TrimSpace(address[:match[0]])
	if len([]rune(before)) < 5 {
		return "Missing street information"
	}

	return ""
}

func parseRouteImage(ctx context.Context, data []byte, mime string) ([]ParsedRouteService, error) {
	hash := routeHash(data)

	var cached models.RouteImageCache
	err := database.RouteDB.First(&cached, "hash = ?", hash).Error
	if err == nil {
		var result routeParseResult
		if json.Unmarshal(cached.Result, &result) == nil {
			return result.Services, nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		return nil, errors.New("GEMINI_API_KEY is missing")
	}

	model := os.Getenv("ROUTE_GEMINI_MODEL")
	if model == "" {
		model = "gemini-2.5-flash"
	}

	prompt := `Extract every visible delivery or collection service from this Portuguese logistics screenshot.

Return JSON only, with this structure:
{"services":[{"address":"string","service_type":"delivery|pickup|unknown"}]}

Rules:
- Each service card is one record, even when two cards have the same address.
- D means delivery; P means pickup. If unclear, use unknown.
- Reproduce the complete address using only visible information.
- Do not invent or repair missing street names, numbers, postal codes or localities.
- Preserve the word "undefined" when visible.
- Ignore recipients, customer names, tracking numbers and shipment IDs.
- Do not extract navigation buttons, menu text or parcel counts.
- Do not merge duplicate service cards.
- If an address is partially obscured, include only its visible text.`

	payload := map[string]interface{}{
		"contents": []interface{}{
			map[string]interface{}{
				"parts": []interface{}{
					map[string]string{"text": prompt},
					map[string]interface{}{
						"inline_data": map[string]string{
							"mime_type": mime,
							"data":      base64.StdEncoding.EncodeToString(data),
						},
					},
				},
			},
		},
		"generationConfig": map[string]interface{}{
			"responseMimeType": "application/json",
			"temperature":      0,
		},
	}

	body, _ := json.Marshal(payload)
	endpoint := "https://generativelanguage.googleapis.com/v1beta/models/" +
		url.PathEscape(model) + ":generateContent"

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Gemini parsing failed: HTTP %d", resp.StatusCode)
	}

	var envelope struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Candidates) == 0 ||
		len(envelope.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("Gemini returned no extracted addresses")
	}

	var result routeParseResult
	if err := json.Unmarshal(
		[]byte(envelope.Candidates[0].Content.Parts[0].Text),
		&result,
	); err != nil {
		return nil, fmt.Errorf("invalid Gemini JSON: %w", err)
	}

	// Cache only the address/service extraction, never the screenshot.
	for i := range result.Services {
		s := &result.Services[i]
		s.Address = strings.TrimSpace(s.Address)
		switch s.ServiceType {
		case "delivery", "pickup":
		default:
			s.ServiceType = "unknown"
		}
	}

	encoded, _ := json.Marshal(result)
	_ = database.RouteDB.Save(&models.RouteImageCache{
		Hash: hash, Result: encoded,
	}).Error

	return result.Services, nil
}

func geocodeRouteAddress(ctx context.Context, address string) (float64, float64, error) {
	key := routeHash([]byte(normalizeRouteAddress(address)))

	var cached models.RouteGeocodeCache
	err := database.RouteDB.First(&cached, "key = ?", key).Error
	if err == nil {
		return cached.Latitude, cached.Longitude, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, 0, err
	}

	apiKey := os.Getenv("GEOAPIFY_API_KEY")
	if apiKey == "" {
		return 0, 0, errors.New("GEOAPIFY_API_KEY is missing")
	}

	q := url.Values{}
	q.Set("text", address)
	q.Set("filter", "countrycode:pt")
	q.Set("limit", "1")
	q.Set("apiKey", apiKey)

	req, err := http.NewRequestWithContext(
		ctx, "GET",
		"https://api.geoapify.com/v1/geocode/search?"+q.Encode(),
		nil,
	)
	if err != nil {
		return 0, 0, err
	}

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return 0, 0, fmt.Errorf("geocoding HTTP %d", resp.StatusCode)
	}

	var result struct {
		Features []struct {
			Properties struct {
				Lat      float64 `json:"lat"`
				Lon      float64 `json:"lon"`
				Postcode string  `json:"postcode"`
			} `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).
		Decode(&result); err != nil {
		return 0, 0, err
	}

	if len(result.Features) == 0 {
		return 0, 0, errors.New("Address not found")
	}

	point := result.Features[0].Properties
	requestedPostal := postalPattern.FindString(address)

	if requestedPostal != "" &&
		point.Postcode != requestedPostal {
		return 0, 0, errors.New("Geocoding postal code mismatch")
	}

	if point.Lat == 0 && point.Lon == 0 {
		return 0, 0, errors.New("Invalid geocoding coordinates")
	}

	if err := database.RouteDB.Create(&models.RouteGeocodeCache{
		Key:       key,
		Address:   address,
		Latitude:  point.Lat,
		Longitude: point.Lon,
	}).Error; err != nil {
		return 0, 0, err
	}

	return point.Lat, point.Lon, nil
}

func resolveRouteService(ctx context.Context, service ParsedRouteService) ParsedRouteService {
	service.Status = "uncomplete"
	service.Latitude = 0
	service.Longitude = 0

	if reason := validateRouteAddress(service.Address); reason != "" {
		service.Reason = reason
		return service
	}

	lat, lon, err := geocodeRouteAddress(ctx, service.Address)
	if err != nil {
		service.Reason = "Address needs geocoding verification: " + err.Error()
		return service
	}

	service.Latitude = lat
	service.Longitude = lon
	service.Status = "complete"
	service.Reason = ""
	return service
}

func ParseRouteScreenshots(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(400, gin.H{"error": "Expected multipart form data"})
		return
	}

	files := form.File["files"]
	if len(files) == 0 || len(files) > 10 {
		c.JSON(400, gin.H{"error": "Upload 1 to 10 screenshots"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 240*time.Second)
	defer cancel()

	var extracted []ParsedRouteService

	for _, fileHeader := range files {
		if fileHeader.Size <= 0 || fileHeader.Size > 10<<20 {
			c.JSON(413, gin.H{"error": "Each image must be under 10 MiB"})
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "Cannot open screenshot"})
			return
		}

		data, readErr := io.ReadAll(io.LimitReader(file, 10<<20+1))
		file.Close()
		if readErr != nil || len(data) > 10<<20 {
			c.JSON(413, gin.H{"error": "Invalid screenshot size"})
			return
		}

		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
			c.JSON(400, gin.H{"error": "Use PNG, JPEG or WebP screenshots"})
			return
		}

		services, err := parseRouteImage(ctx, data, mime)
		if err != nil {
			c.JSON(502, gin.H{"error": err.Error()})
			return
		}
		extracted = append(extracted, services...)
	}

	// Geocode each unique address once per request.
	resolved := make(map[string]ParsedRouteService)
	var complete, uncomplete []ParsedRouteService

	for _, service := range extracted {
		key := normalizeRouteAddress(service.Address)

		base, ok := resolved[key]
		if !ok {
			base = resolveRouteService(ctx, service)
			resolved[key] = base
		}

		service.Status = base.Status
		service.Reason = base.Reason
		service.Latitude = base.Latitude
		service.Longitude = base.Longitude

		if service.Status == "complete" {
			complete = append(complete, service)
		} else {
			uncomplete = append(uncomplete, service)
		}
	}

	c.JSON(200, gin.H{
		"complete":   complete,
		"uncomplete": uncomplete,
	})
}

func VerifyRouteAddress(c *gin.Context) {
	var input struct {
		Address string `json:"address" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	result := resolveRouteService(c.Request.Context(), ParsedRouteService{
		Address:     strings.TrimSpace(input.Address),
		ServiceType: "unknown",
	})
	c.JSON(200, result)
}
