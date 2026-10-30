package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
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

type routeModelAttempt struct {
	Model             string `json:"model"`
	Stage             string `json:"stage"`
	HTTPStatus        int    `json:"upstream_http_status,omitempty"`
	UpstreamStatus    string `json:"upstream_status,omitempty"`
	UpstreamRequestID string `json:"upstream_request_id,omitempty"`
	FinishReason      string `json:"finish_reason,omitempty"`
	Message           string `json:"message,omitempty"`
	DurationMS        int64  `json:"duration_ms"`
}

type routeParseFailure struct {
	HTTPStatus int
	Code       string
	Stage      string
	Message    string
	Attempts   []routeModelAttempt
}

func (e *routeParseFailure) Error() string {
	return e.Message
}

const (
	routeParserVersion = "gemini-fallback-diagnostics-v1"
	routeAttemptTimeout = 60 * time.Second
	routeResponseLimit  = 2 << 20
)

const routeExtractionPrompt = `Extract every visible delivery or collection service from this Portuguese logistics screenshot.

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

var routeGeminiClient = &http.Client{
	Timeout: routeAttemptTimeout,
}

var postalPattern = regexp.MustCompile(`\b\d{4}-\d{3}\b`)
var undefinedPattern = regexp.MustCompile(`(?i)\b(undefined|null|nan)\b`)

func routeHash(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizeRouteAddress(s string) string {
	return strings.Join(
		strings.Fields(strings.ToLower(strings.TrimSpace(s))),
		" ",
	)
}

func validateRouteAddress(address string) string {
	if undefinedPattern.MatchString(address) {
		return "Address contains undefined fields"
	}
	if !postalPattern.MatchString(address) {
		return "Missing Portuguese postal code"
	}

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
	if len([]rune(strings.TrimSpace(address[:match[0]]))) < 5 {
		return "Missing street information"
	}

	return ""
}

func routeRequestID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err == nil {
		return hex.EncodeToString(raw[:])
	}
	return fmt.Sprintf("route-%d", time.Now().UnixNano())
}

// Used for provider messages only. Never pass extracted addresses,
// image contents, database errors, or geocoding URLs to this function.
func safeRouteProviderMessage(message string) string {
	for _, name := range []string{
		"GEMINI_API_KEY",
		"GEOAPIFY_API_KEY",
	} {
		if key := strings.TrimSpace(os.Getenv(name)); key != "" {
			message = strings.ReplaceAll(message, key, "[REDACTED]")
		}
	}

	message = strings.Join(strings.Fields(message), " ")
	runes := []rune(message)
	if len(runes) > 1200 {
		return string(runes[:1200]) + "..."
	}
	return message
}

func configuredRouteGeminiModels() []string {
	defaults := []string{
		"gemini-3.5-flash-lite",
		"gemini-3.8-flash",
		"gemini-3.6-flash",
	}

	var candidates []string

	if value := strings.TrimSpace(
		os.Getenv("ROUTE_GEMINI_MODELS"),
	); value != "" {
		candidates = strings.Split(value, ",")
	} else {
		if primary := strings.TrimSpace(
			os.Getenv("ROUTE_GEMINI_MODEL"),
		); primary != "" {
			candidates = append(candidates, primary)
		}
		candidates = append(candidates, defaults...)
	}

	seen := make(map[string]bool)
	result := make([]string, 0, len(candidates))

	for _, candidate := range candidates {
		model := strings.TrimPrefix(
			strings.TrimSpace(candidate),
			"models/",
		)
		if model == "" || seen[model] {
			continue
		}
		seen[model] = true
		result = append(result, model)
	}

	return result
}

func respondRouteFailure(
	c *gin.Context,
	requestID string,
	started time.Time,
	imageIndex int,
	failure *routeParseFailure,
) {
	response := gin.H{
		"error":          failure.Message,
		"code":           failure.Code,
		"stage":          failure.Stage,
		"request_id":     requestID,
		"parser_version": routeParserVersion,
		"revision":       os.Getenv("K_REVISION"),
		"duration_ms":    time.Since(started).Milliseconds(),
	}

	if imageIndex > 0 {
		response["image_index"] = imageIndex
	}
	if failure.Stage == "gemini" || failure.Stage == "configuration" {
		response["configured_models"] = configuredRouteGeminiModels()
	}
	if len(failure.Attempts) > 0 {
		response["attempts"] = failure.Attempts
	}

	if encoded, err := json.Marshal(response); err == nil {
		log.Printf("route_parse_failure %s", encoded)
	}

	c.JSON(failure.HTTPStatus, response)
}

func decodeRouteExtraction(text string) ([]ParsedRouteService, error) {
	var result struct {
		Services *[]ParsedRouteService `json:"services"`
	}

	// Do not expose model-generated address text in decode errors.
	if err := json.Unmarshal(
		[]byte(strings.TrimSpace(text)),
		&result,
	); err != nil {
		return nil, errors.New(
			"Model output is not valid JSON matching the extraction structure",
		)
	}
	if result.Services == nil {
		return nil, errors.New(
			"Model output is missing a non-null services array",
		)
	}

	services := *result.Services
	for i := range services {
		services[i].Address = strings.TrimSpace(services[i].Address)
		if services[i].Address == "" {
			return nil, fmt.Errorf(
				"Model output contains an empty address at record %d",
				i+1,
			)
		}
		switch services[i].ServiceType {
		case "delivery", "pickup":
		default:
			services[i].ServiceType = "unknown"
		}
	}
	return services, nil
}

func attemptRouteGemini(
	ctx context.Context,
	model string,
	apiKey string,
	body []byte,
) (
	services []ParsedRouteService,
	attempt routeModelAttempt,
	attemptErr error,
) {
	started := time.Now()
	attempt.Model = model
	attempt.Stage = "request"

	defer func() {
		attempt.DurationMS = time.Since(started).Milliseconds()
	}()

	fail := func(stage string, message string) {
		attempt.Stage = stage
		attempt.Message = safeRouteProviderMessage(message)
		attemptErr = errors.New(attempt.Message)
	}

	attemptCtx, cancel := context.WithTimeout(ctx, routeAttemptTimeout)
	defer cancel()

	endpoint := "https://generativelanguage.googleapis.com/v1beta/models/" +
		url.PathEscape(model) + ":generateContent"

	req, err := http.NewRequestWithContext(
		attemptCtx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		fail("request", "Cannot construct Gemini request")
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := routeGeminiClient.Do(req)
	if err != nil {
		switch {
		case ctx.Err() != nil:
			fail("request_cancelled", ctx.Err().Error())
		case errors.Is(err, context.DeadlineExceeded),
			errors.Is(attemptCtx.Err(), context.DeadlineExceeded):
			fail("timeout", "Gemini attempt exceeded its 60-second timeout")
		default:
			fail("network", err.Error())
		}
		return
	}
	defer resp.Body.Close()

	attempt.HTTPStatus = resp.StatusCode
	attempt.UpstreamRequestID = resp.Header.Get("X-Goog-Request-Id")
	if attempt.UpstreamRequestID == "" {
		attempt.UpstreamRequestID = resp.Header.Get("X-Request-Id")
	}

	raw, err := io.ReadAll(
		io.LimitReader(resp.Body, routeResponseLimit+1),
	)
	if err != nil {
		fail("response_read", "Failed to read the Gemini response")
		return
	}
	if len(raw) > routeResponseLimit {
		fail("response_read", "Gemini response exceeded the 2 MiB limit")
		return
	}

	if resp.StatusCode != http.StatusOK {
		var upstream struct {
			Error struct {
				Status  string `json:"status"`
				Message string `json:"message"`
			} `json:"error"`
		}

		if err := json.Unmarshal(raw, &upstream); err == nil &&
			upstream.Error.Message != "" {
			attempt.UpstreamStatus = upstream.Error.Status
			fail("upstream_http", upstream.Error.Message)
		} else {
			fail(
				"upstream_http",
				fmt.Sprintf(
					"Gemini returned HTTP %d without a readable JSON error; content type: %s",
					resp.StatusCode,
					resp.Header.Get("Content-Type"),
				),
			)
		}
		return
	}

	var envelope struct {
		PromptFeedback struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
		Candidates []struct {
			FinishReason string `json:"finishReason"`
			Content      struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(raw, &envelope); err != nil {
		fail("response_decode", "Gemini returned an invalid response envelope")
		return
	}

	if envelope.PromptFeedback.BlockReason != "" {
		attempt.FinishReason = envelope.PromptFeedback.BlockReason
		fail(
			"blocked",
			"Gemini blocked the request: "+envelope.PromptFeedback.BlockReason,
		)
		return
	}

	if len(envelope.Candidates) == 0 {
		fail("empty_response", "Gemini returned no candidates")
		return
	}

	candidate := envelope.Candidates[0]
	attempt.FinishReason = candidate.FinishReason

	if candidate.FinishReason != "" && candidate.FinishReason != "STOP" {
		stage := "incomplete_response"
		switch candidate.FinishReason {
		case "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII":
			stage = "blocked"
		}
		fail(
			stage,
			"Gemini generation ended with finish reason: "+candidate.FinishReason,
		)
		return
	}

	var text strings.Builder
	for _, part := range candidate.Content.Parts {
		if !part.Thought {
			text.WriteString(part.Text)
		}
	}

	if strings.TrimSpace(text.String()) == "" {
		fail("empty_response", "Gemini returned no extraction text")
		return
	}

	services, err = decodeRouteExtraction(text.String())
	if err != nil {
		fail("extraction_decode", err.Error())
		return
	}

	attempt.Stage = "success"
	return
}

func extractRouteWithGemini(
	ctx context.Context,
	data []byte,
	mime string,
) ([]ParsedRouteService, error) {
	apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if apiKey == "" {
		return nil, &routeParseFailure{
			HTTPStatus: http.StatusServiceUnavailable,
			Code:       "GEMINI_KEY_MISSING",
			Stage:      "configuration",
			Message:    "GEMINI_API_KEY is not configured on this backend revision",
		}
	}

	models := configuredRouteGeminiModels()
	if len(models) == 0 {
		return nil, &routeParseFailure{
			HTTPStatus: http.StatusServiceUnavailable,
			Code:       "GEMINI_MODELS_MISSING",
			Stage:      "configuration",
			Message:    "No Gemini models are configured",
		}
	}

	payload := map[string]any{
		"contents": []any{
			map[string]any{
				"parts": []any{
					map[string]string{"text": routeExtractionPrompt},
					map[string]any{
						"inline_data": map[string]string{
							"mime_type": mime,
							"data": base64.StdEncoding.EncodeToString(data),
						},
					},
				},
			},
		},
		"generationConfig": map[string]any{
			"responseMimeType": "application/json",
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, &routeParseFailure{
			HTTPStatus: http.StatusInternalServerError,
			Code:       "GEMINI_REQUEST_ENCODING_FAILED",
			Stage:      "gemini",
			Message:    "Backend could not encode the Gemini request",
		}
	}

	attempts := make([]routeModelAttempt, 0, len(models))

	for _, model := range models {
		if ctx.Err() != nil {
			break
		}

		services, attempt, err := attemptRouteGemini(
			ctx, model, apiKey, body,
		)
		attempts = append(attempts, attempt)

		if err == nil {
			return services, nil
		}

		if attempt.HTTPStatus == http.StatusUnauthorized ||
			attempt.HTTPStatus == http.StatusForbidden {
			return nil, &routeParseFailure{
				HTTPStatus: http.StatusBadGateway,
				Code:       "GEMINI_ACCESS_DENIED",
				Stage:      "gemini",
				Message:    "Gemini rejected the API credentials or permissions; model fallback stopped",
				Attempts:   attempts,
			}
		}

		if attempt.Stage == "blocked" {
			return nil, &routeParseFailure{
				HTTPStatus: http.StatusUnprocessableEntity,
				Code:       "GEMINI_CONTENT_BLOCKED",
				Stage:      "gemini",
				Message:    "Gemini blocked screenshot processing",
				Attempts:   attempts,
			}
		}
	}

	code := "GEMINI_ALL_MODELS_FAILED"
	status := http.StatusBadGateway
	message := "Screenshot extraction failed for every attempted Gemini model"

	if ctx.Err() != nil {
		code = "ROUTE_PARSE_DEADLINE"
		status = http.StatusGatewayTimeout
		message = "The overall screenshot parsing deadline was exceeded or the request was cancelled"
	} else if len(attempts) > 0 {
		all404, all429, allTimeout := true, true, true
		for _, attempt := range attempts {
			all404 = all404 && attempt.HTTPStatus == http.StatusNotFound
			all429 = all429 && attempt.HTTPStatus == http.StatusTooManyRequests
			allTimeout = allTimeout && attempt.Stage == "timeout"
		}
		switch {
		case all404:
			code = "GEMINI_MODELS_NOT_FOUND"
			message = "Gemini returned 404 for every attempted model; inspect the upstream messages for model availability or API compatibility"
		case all429:
			code = "GEMINI_RATE_LIMITED"
			status = http.StatusServiceUnavailable
			message = "Every attempted Gemini model returned a quota or rate-limit error"
		case allTimeout:
			code = "GEMINI_MODELS_TIMED_OUT"
			status = http.StatusGatewayTimeout
			message = "Every attempted Gemini model timed out"
		}
	}

	return nil, &routeParseFailure{
		HTTPStatus: status,
		Code:       code,
		Stage:      "gemini",
		Message:    message,
		Attempts:   attempts,
	}
}

func parseRouteImage(
	ctx context.Context,
	data []byte,
	mime string,
) ([]ParsedRouteService, error) {
	hash := routeHash(data)
	var cached models.RouteImageCache

	err := database.RouteDB.WithContext(ctx).
		First(&cached, "hash = ?", hash).Error

	if err == nil {
		if services, decodeErr := decodeRouteExtraction(
			string(cached.Result),
		); decodeErr == nil {
			return services, nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &routeParseFailure{
			HTTPStatus: http.StatusInternalServerError,
			Code:       "ROUTE_CACHE_LOOKUP_FAILED",
			Stage:      "database",
			Message:    "Backend could not read the screenshot extraction cache",
		}
	}

	services, err := extractRouteWithGemini(ctx, data, mime)
	if err != nil {
		return nil, err
	}

	encoded, err := json.Marshal(routeParseResult{Services: services})
	if err != nil {
		return nil, &routeParseFailure{
			HTTPStatus: http.StatusInternalServerError,
			Code:       "ROUTE_CACHE_ENCODING_FAILED",
			Stage:      "database",
			Message:    "Backend could not encode the extraction cache",
		}
	}

	// A cache write failure does not discard a successful extraction.
	_ = database.RouteDB.WithContext(ctx).
		Save(&models.RouteImageCache{
			Hash: hash, Result: encoded,
		}).Error

	return services, nil
}

func geocodeRouteAddress(
	ctx context.Context,
	address string,
) (float64, float64, error) {
	key := routeHash([]byte(normalizeRouteAddress(address)))
	var cached models.RouteGeocodeCache

	err := database.RouteDB.WithContext(ctx).
		First(&cached, "key = ?", key).Error
	if err == nil {
		return cached.Latitude, cached.Longitude, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, 0, errors.New("Geocoding cache lookup failed")
	}

	apiKey := strings.TrimSpace(os.Getenv("GEOAPIFY_API_KEY"))
	if apiKey == "" {
		return 0, 0, errors.New("GEOAPIFY_API_KEY is missing")
	}

	q := url.Values{}
	q.Set("text", address)
	q.Set("filter", "countrycode:pt")
	q.Set("limit", "1")
	q.Set("apiKey", apiKey)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://api.geoapify.com/v1/geocode/search?"+q.Encode(),
		nil,
	)
	if err != nil {
		return 0, 0, errors.New("Cannot create geocoding request")
	}

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		// Do not expose the request URL: it contains the geocoding key.
		if ctx.Err() != nil {
			return 0, 0, errors.New("Geocoding request deadline or cancellation")
		}
		return 0, 0, errors.New("Geocoding network request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("Geocoding HTTP %d", resp.StatusCode)
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
		return 0, 0, errors.New("Invalid geocoding response")
	}
	if len(result.Features) == 0 {
		return 0, 0, errors.New("Address not found")
	}

	point := result.Features[0].Properties
	requestedPostal := postalPattern.FindString(address)

	if requestedPostal != "" && point.Postcode != requestedPostal {
		return 0, 0, errors.New("Geocoding postal code mismatch")
	}
	if point.Lat == 0 && point.Lon == 0 {
		return 0, 0, errors.New("Invalid geocoding coordinates")
	}

	if err := database.RouteDB.WithContext(ctx).
		Create(&models.RouteGeocodeCache{
			Key:       key,
			Address:   address,
			Latitude:  point.Lat,
			Longitude: point.Lon,
		}).Error; err != nil {
		return 0, 0, errors.New("Geocoding cache write failed")
	}

	return point.Lat, point.Lon, nil
}

func resolveRouteService(
	ctx context.Context,
	service ParsedRouteService,
) ParsedRouteService {
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
	started := time.Now()
	requestID := routeRequestID()

	c.Header("X-Route-Request-ID", requestID)
	c.Header("X-Route-Parser-Version", routeParserVersion)

	fail := func(status int, code, stage, message string, image int) {
		respondRouteFailure(c, requestID, started, image, &routeParseFailure{
			HTTPStatus: status,
			Code:       code,
			Stage:      stage,
			Message:    message,
		})
	}

	if database.RouteDB == nil {
		fail(503, "ROUTE_DATABASE_UNAVAILABLE", "database",
			"Routes database is not initialized", 0)
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		fail(400, "INVALID_MULTIPART_FORM", "upload",
			"Expected multipart form data with screenshots under the files field", 0)
		return
	}
	defer form.RemoveAll()

	files := form.File["files"]
	if len(files) == 0 || len(files) > 10 {
		fail(400, "INVALID_SCREENSHOT_COUNT", "upload",
			"Upload between 1 and 10 screenshots under the files field", 0)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 240*time.Second)
	defer cancel()

	var extracted []ParsedRouteService

	for index, fileHeader := range files {
		imageIndex := index + 1

		if fileHeader.Size <= 0 || fileHeader.Size > 10<<20 {
			fail(413, "INVALID_SCREENSHOT_SIZE", "upload",
				"Each screenshot must contain data and be at most 10 MiB", imageIndex)
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			fail(400, "SCREENSHOT_OPEN_FAILED", "upload",
				"Cannot open uploaded screenshot", imageIndex)
			return
		}

		data, readErr := io.ReadAll(io.LimitReader(file, (10<<20)+1))
		file.Close()

		if readErr != nil {
			fail(400, "SCREENSHOT_READ_FAILED", "upload",
				"Cannot read uploaded screenshot", imageIndex)
			return
		}
		if len(data) > 10<<20 {
			fail(413, "SCREENSHOT_TOO_LARGE", "upload",
				"Screenshot exceeds 10 MiB", imageIndex)
			return
		}

		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
			fail(400, "UNSUPPORTED_SCREENSHOT_TYPE", "upload",
				"Use PNG, JPEG or WebP screenshots", imageIndex)
			return
		}

		services, err := parseRouteImage(ctx, data, mime)
		if err != nil {
			var failure *routeParseFailure
			if errors.As(err, &failure) {
				respondRouteFailure(c, requestID, started, imageIndex, failure)
			} else {
				fail(500, "ROUTE_PARSE_INTERNAL_ERROR", "internal",
					"Unexpected screenshot processing error", imageIndex)
			}
			return
		}

		extracted = append(extracted, services...)
	}

	resolved := make(map[string]ParsedRouteService)
	complete := make([]ParsedRouteService, 0)
	uncomplete := make([]ParsedRouteService, 0)

	for _, service := range extracted {
		if ctx.Err() != nil {
			fail(504, "ROUTE_GEOCODING_DEADLINE", "geocoding",
				"Request deadline or cancellation interrupted address verification", 0)
			return
		}

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

	if ctx.Err() != nil {
		fail(504, "ROUTE_GEOCODING_DEADLINE", "geocoding",
			"Request deadline or cancellation interrupted address verification", 0)
		return
	}

	log.Printf(
		"route_parse_success request_id=%s revision=%s duration_ms=%d screenshots=%d complete=%d uncomplete=%d",
		requestID,
		os.Getenv("K_REVISION"),
		time.Since(started).Milliseconds(),
		len(files),
		len(complete),
		len(uncomplete),
	)

	c.JSON(http.StatusOK, gin.H{
		"complete":       complete,
		"uncomplete":     uncomplete,
		"request_id":     requestID,
		"parser_version": routeParserVersion,
		"revision":       os.Getenv("K_REVISION"),
	})
}

func VerifyRouteAddress(c *gin.Context) {
	var input struct {
		Address string `json:"address" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if database.RouteDB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Routes database unavailable",
		})
		return
	}

	result := resolveRouteService(
		c.Request.Context(),
		ParsedRouteService{
			Address:     strings.TrimSpace(input.Address),
			ServiceType: "unknown",
		},
	)
	c.JSON(http.StatusOK, result)
}