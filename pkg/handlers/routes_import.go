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
	"unicode"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/text/unicode/norm"
	"gorm.io/gorm"
)

const routeParserVersion = "structured-route-review-v2"

var (
	postalPattern     = regexp.MustCompile(`\b\d{4}-\d{3}\b`)
	longNumberPattern = regexp.MustCompile(`\d{5,}`)
	undefinedPattern  = regexp.MustCompile(`(?i)\b(undefined|null|nan)\b`)

	routeGeminiClient = &http.Client{
		Timeout: 60 * time.Second,
	}

	routeGeocodeClient = &http.Client{
		Timeout: 15 * time.Second,
	}
)

type RouteCandidate struct {
	ID          string  `json:"id"`
	Address     string  `json:"address"`
	Street      string  `json:"street"`
	HouseNumber string  `json:"house_number"`
	PostalCode  string  `json:"postal_code"`
	Locality    string  `json:"locality"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Confidence  float64 `json:"confidence"`
	ResultType  string  `json:"result_type"`
	MatchType   string  `json:"match_type"`
	Exact       bool    `json:"exact"`
	CanConfirm  bool    `json:"can_confirm"`
}

type RouteConfirmation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type ParsedRouteService struct {
	ID               string             `json:"id"`
	SourceApp        string             `json:"source_app"`
	SourceReference  string             `json:"source_reference"`
	SourceImage      int                `json:"source_image"`
	OriginalAddress  string             `json:"original_address"`
	Address          string             `json:"address"`
	Street           string             `json:"street"`
	HouseNumber      string             `json:"house_number"`
	PostalCode       string             `json:"postal_code"`
	Locality         string             `json:"locality"`
	ServiceType      string             `json:"service_type"`
	ParcelCount      int                `json:"parcel_count"`
	ExtractionIssues []string           `json:"extraction_issues"`
	Candidates       []RouteCandidate   `json:"candidates"`
	MatchedAddress   string             `json:"matched_address"`
	Latitude         float64            `json:"latitude"`
	Longitude        float64            `json:"longitude"`
	RoadLatitude     float64            `json:"road_latitude"`
	RoadLongitude    float64            `json:"road_longitude"`
	SnapDistanceM    float64            `json:"snap_distance_m"`
	Stage            string             `json:"stage"`
	Status           string             `json:"status"`
	Reason           string             `json:"reason"`
	Confirmed        bool               `json:"confirmed"`
	Confirmation     *RouteConfirmation `json:"confirmation,omitempty"`
	Resolution       *RouteResolution   `json:"resolution,omitempty"`
}

type routeParseResult struct {
	Services []ParsedRouteService `json:"services"`
}

const routeExtractionPrompt = `
Extract visible delivery/collection SERVICE CARDS from these logistics screenshots.

Return JSON only:
{
  "services": [
    {
      "source_app": "gls|lds|unknown",
      "source_reference": "visible shipment/service identifier or empty string",
      "original_address": "all visible address text belonging to this card",
      "street": "street name as visible, or empty string",
      "house_number": "house number as visible, or empty string",
      "postal_code": "Portuguese postal code as visible, or empty string",
      "locality": "locality as visible, or empty string",
      "service_type": "delivery|pickup|unknown",
      "parcel_count": 1,
      "extraction_issues": []
    }
  ]
}

Rules:
- A service card is one record. Two parcels on a card are not two services.
- Keep separate cards even when they share an address.
- GLS: D or E means delivery. P or an explicit collection label means pickup.
- LDS: associate the postal-code/locality heading with the street inside
  THE SAME card, even when the heading is above the street.
- Never take a heading from an adjacent card.
- Reproduce original address text without inventing or repairing information.
- Preserve suspicious/repeated house numbers in original_address.
- Flag corrupted numbers, cropped fields, obscured text, or unclear card
  association in extraction_issues.
- Do not invent missing house numbers, streets, postal codes, or localities.
- If no service identifier is visible, use an empty source_reference.
- Do not extract recipients, telephone numbers, customer names, button text,
  navigation text, or unrelated numbers.
- Do not use a telephone number as a service identifier.
- A delivery/collection status is separate from address completeness.
`

func routeHash(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizeRouteAddress(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), " ")
}

// Used for comparing address components, not for rewriting displayed text.
func addressWords(value string) string {
	var builder strings.Builder

	for _, character := range norm.NFD.String(strings.ToLower(value)) {
		if unicode.Is(unicode.Mn, character) {
			continue
		}
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			builder.WriteRune(character)
		} else {
			builder.WriteByte(' ')
		}
	}

	aliases := map[string]string{
		"r":      "rua",
		"av":     "avenida",
		"n":      "",
		"numero": "",
		"grd":    "guarda",
	}

	words := strings.Fields(builder.String())
	result := make([]string, 0, len(words))

	for _, word := range words {
		if replacement, exists := aliases[word]; exists {
			word = replacement
		}
		if word != "" {
			result = append(result, word)
		}
	}
	return strings.Join(result, " ")
}

func containsAddressWords(expected, actual string) bool {
	words := strings.Fields(addressWords(expected))
	if len(words) == 0 {
		return false
	}

	actualWords := make(map[string]bool)
	for _, word := range strings.Fields(addressWords(actual)) {
		actualWords[word] = true
	}

	for _, word := range words {
		if !actualWords[word] {
			return false
		}
	}
	return true
}

func serviceAddress(service ParsedRouteService) string {
	if service.OriginalAddress != "" {
		return service.OriginalAddress
	}
	return service.Address
}

func extractionProblem(service ParsedRouteService) string {
	original := serviceAddress(service)

	if len(service.ExtractionIssues) > 0 {
		return strings.Join(service.ExtractionIssues, "; ")
	}
	if undefinedPattern.MatchString(original) {
		return "Address contains undefined fields"
	}

	withoutPostal := postalPattern.ReplaceAllString(original, "")
	if longNumberPattern.MatchString(withoutPostal) {
		return "Address contains a suspicious number; confirm its location"
	}
	if strings.TrimSpace(service.Street) == "" {
		return "Street is missing or obscured"
	}
	if !postalPattern.MatchString(service.PostalCode) {
		return "Portuguese postal code is missing or invalid"
	}
	if strings.TrimSpace(service.Locality) == "" {
		return "Locality is missing"
	}
	return ""
}

func normalizeExtractedService(
	service ParsedRouteService,
	imageHash string,
	cardIndex int,
) ParsedRouteService {
	service.OriginalAddress = strings.TrimSpace(service.OriginalAddress)
	if service.OriginalAddress == "" {
		service.OriginalAddress = strings.TrimSpace(service.Address)
	}

	service.Address = service.OriginalAddress
	service.Street = strings.TrimSpace(service.Street)
	service.HouseNumber = strings.TrimSpace(service.HouseNumber)
	service.PostalCode = strings.TrimSpace(service.PostalCode)
	service.Locality = strings.TrimSpace(service.Locality)
	service.SourceReference = strings.TrimSpace(service.SourceReference)

	switch strings.ToLower(strings.TrimSpace(service.SourceApp)) {
	case "gls":
		service.SourceApp = "gls"
	case "lds":
		service.SourceApp = "lds"
	default:
		service.SourceApp = "unknown"
	}

	switch strings.ToLower(strings.TrimSpace(service.ServiceType)) {
	case "delivery", "d", "e":
		service.ServiceType = "delivery"
	case "pickup", "p":
		service.ServiceType = "pickup"
	default:
		service.ServiceType = "unknown"
	}

	if service.ParcelCount < 1 {
		service.ParcelCount = 1
	}

	identity := service.SourceApp + ":" + service.SourceReference
	if service.SourceReference == "" {
		// No invented shipment identity. Preserve separate cards.
		identity = fmt.Sprintf(
			"%s:%d:%s",
			imageHash,
			cardIndex,
			service.OriginalAddress,
		)
	}

	service.ID = routeHash([]byte(identity))
	service.Stage = "extracted"
	service.Status = "needs_attention"
	service.Reason = extractionProblem(service)
	service.Candidates = []RouteCandidate{}

	return service
}

func decodeRouteExtraction(
	text string,
	imageHash string,
) ([]ParsedRouteService, error) {
	var result struct {
		Services *[]ParsedRouteService `json:"services"`
	}

	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &result); err != nil {
		return nil, errors.New("Gemini returned invalid extraction JSON")
	}
	if result.Services == nil {
		return nil, errors.New("Gemini response is missing the services array")
	}
	if len(*result.Services) > 500 {
		return nil, errors.New("Too many extracted service cards")
	}

	services := make([]ParsedRouteService, 0, len(*result.Services))
	for index, service := range *result.Services {
		service = normalizeExtractedService(service, imageHash, index)
		if service.OriginalAddress == "" {
			service.Reason = "Address is missing or obscured"
		}
		services = append(services, service)
	}
	return services, nil
}

func configuredRouteGeminiModels() []string {
	value := strings.TrimSpace(os.Getenv("ROUTE_GEMINI_MODELS"))
	if value == "" {
		value = strings.TrimSpace(os.Getenv("ROUTE_GEMINI_MODEL")) +
			",gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.6-flash"
	}

	var result []string
	seen := map[string]bool{}

	for _, item := range strings.Split(value, ",") {
		model := strings.TrimPrefix(strings.TrimSpace(item), "models/")
		if model != "" && !seen[model] {
			seen[model] = true
			result = append(result, model)
		}
	}
	return result
}

func extractRouteImage(
	ctx context.Context,
	data []byte,
	mime string,
	imageHash string,
) ([]ParsedRouteService, error) {
	key := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if key == "" {
		return nil, errors.New("GEMINI_API_KEY is missing")
	}

	payload := map[string]any{
		"contents": []any{
			map[string]any{
				"parts": []any{
					map[string]string{"text": routeExtractionPrompt},
					map[string]any{
						"inline_data": map[string]string{
							"mime_type": mime,
							"data":      base64.StdEncoding.EncodeToString(data),
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
		return nil, err
	}

	attempts := make([]string, 0)

	for _, model := range configuredRouteGeminiModels() {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		attemptCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		req, err := http.NewRequestWithContext(
			attemptCtx,
			http.MethodPost,
			"https://generativelanguage.googleapis.com/v1beta/models/"+
				url.PathEscape(model)+":generateContent",
			bytes.NewReader(body),
		)
		if err != nil {
			cancel()
			return nil, errors.New("Cannot create Gemini request")
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-goog-api-key", key)

		resp, requestErr := routeGeminiClient.Do(req)
		if requestErr != nil {
			cancel()
			attempts = append(attempts, model+": request failed")
			continue
		}

		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
		resp.Body.Close()
		cancel()

		if readErr != nil || len(raw) > 2<<20 {
			attempts = append(attempts, model+": invalid response size")
			continue
		}

		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return nil, errors.New("Gemini rejected the configured credentials")
		}
		if resp.StatusCode != http.StatusOK {
			attempts = append(
				attempts,
				fmt.Sprintf("%s: HTTP %d", model, resp.StatusCode),
			)
			continue
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

		if json.Unmarshal(raw, &envelope) != nil {
			attempts = append(attempts, model+": invalid response envelope")
			continue
		}
		if envelope.PromptFeedback.BlockReason != "" {
			return nil, errors.New("Gemini blocked screenshot processing")
		}
		if len(envelope.Candidates) == 0 {
			attempts = append(attempts, model+": empty response")
			continue
		}

		candidate := envelope.Candidates[0]
		switch candidate.FinishReason {
		case "SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII":
			return nil, errors.New("Gemini blocked screenshot processing")
		case "", "STOP":
		default:
			attempts = append(attempts, model+": incomplete response")
			continue
		}

		var text strings.Builder
		for _, part := range candidate.Content.Parts {
			if !part.Thought {
				text.WriteString(part.Text)
			}
		}

		services, decodeErr := decodeRouteExtraction(text.String(), imageHash)
		if decodeErr == nil {
			return services, nil
		}
		attempts = append(attempts, model+": invalid extraction structure")
	}

	return nil, fmt.Errorf(
		"Screenshot extraction failed: %s",
		strings.Join(attempts, "; "),
	)
}

func parseRouteImage(
	ctx context.Context,
	data []byte,
	mime string,
) ([]ParsedRouteService, error) {
	// Changing the extraction policy invalidates old image-cache results.
	hash := routeHash(append(
		[]byte(routeParserVersion+":"),
		data...,
	))

	var cached models.RouteImageCache
	err := database.RouteDB.WithContext(ctx).
		First(&cached, "hash = ?", hash).Error

	if err == nil {
		var result routeParseResult
		if json.Unmarshal(cached.Result, &result) == nil &&
			result.Services != nil {
			return result.Services, nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("Screenshot cache lookup failed")
	}

	services, err := extractRouteImage(ctx, data, mime, hash)
	if err != nil {
		return nil, err
	}

	encoded, err := json.Marshal(routeParseResult{Services: services})
	if err == nil {
		// Cache failure does not discard successful extraction.
		_ = database.RouteDB.WithContext(ctx).
			Save(&models.RouteImageCache{
				Hash:   hash,
				Result: encoded,
			}).Error
	}
	return services, nil
}

func deduplicateRouteServices(
	input []ParsedRouteService,
) []ParsedRouteService {
	result := make([]ParsedRouteService, 0, len(input))
	positions := map[string]int{}

	for _, service := range input {
		if index, exists := positions[service.ID]; exists {
			previous := result[index]

			// Same reference with conflicting addresses must not be hidden.
			if normalizeRouteAddress(previous.OriginalAddress) !=
				normalizeRouteAddress(service.OriginalAddress) {
				result[index].ExtractionIssues = append(
					result[index].ExtractionIssues,
					"Same service identifier appears with different addresses",
				)
			}
			continue
		}
		positions[service.ID] = len(result)
		result = append(result, service)
	}

	// Without identifiers, an overlap cannot always be distinguished
	// from separate services at one address. Require review.
	byAddress := map[string][]int{}
	for index, service := range result {
		if service.SourceReference == "" {
			key := normalizeRouteAddress(service.OriginalAddress) +
				":" + service.ServiceType
			byAddress[key] = append(byAddress[key], index)
		}
	}

	for _, indices := range byAddress {
		if len(indices) < 2 {
			continue
		}
		for _, index := range indices {
			result[index].ExtractionIssues = append(
				result[index].ExtractionIssues,
				"Possible overlapping screenshot duplicate without a service identifier",
			)
		}
	}
	return result
}

type geoRouteProperties struct {
	Formatted   string  `json:"formatted"`
	Street      string  `json:"street"`
	HouseNumber string  `json:"housenumber"`
	Postcode    string  `json:"postcode"`
	CountryCode string  `json:"country_code"`
	City        string  `json:"city"`
	Town        string  `json:"town"`
	Village     string  `json:"village"`
	Suburb      string  `json:"suburb"`
	District    string  `json:"district"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ResultType  string  `json:"result_type"`
	Rank        struct {
		Confidence       float64 `json:"confidence"`
		StreetConfidence float64 `json:"confidence_street_level"`
		MatchType        string  `json:"match_type"`
	} `json:"rank"`
}

func candidateFor(
	service ParsedRouteService,
	point geoRouteProperties,
) RouteCandidate {
	locality := strings.Join([]string{
		point.City,
		point.Town,
		point.Village,
		point.Suburb,
		point.District,
	}, " ")

	valid := validPoint(RouteInputStop{
		Latitude:  point.Lat,
		Longitude: point.Lon,
	})

	postalMatch := service.PostalCode != "" &&
		point.Postcode == service.PostalCode

	streetMatch := containsAddressWords(service.Street, point.Street)
	localityMatch := containsAddressWords(service.Locality, locality)

	houseMatch := service.HouseNumber != "" &&
		addressWords(service.HouseNumber) == addressWords(point.HouseNumber)

	exact := valid &&
		strings.EqualFold(point.CountryCode, "pt") &&
		postalMatch &&
		streetMatch &&
		localityMatch &&
		houseMatch &&
		point.Rank.Confidence >= 0.9 &&
		point.Rank.StreetConfidence >= 0.9 &&
		(point.ResultType == "building" ||
			point.Rank.MatchType == "match_by_building" ||
			point.Rank.MatchType == "full_match")

	return RouteCandidate{
		ID: routeHash([]byte(fmt.Sprintf(
			"%s:%.7f:%.7f",
			point.Formatted,
			point.Lat,
			point.Lon,
		))),
		Address:     point.Formatted,
		Street:      point.Street,
		HouseNumber: point.HouseNumber,
		PostalCode:  point.Postcode,
		Locality:    strings.TrimSpace(locality),
		Latitude:    point.Lat,
		Longitude:   point.Lon,
		Confidence:  point.Rank.Confidence,
		ResultType:  point.ResultType,
		MatchType:   point.Rank.MatchType,
		Exact:       exact,
		CanConfirm: valid &&
			strings.EqualFold(point.CountryCode, "pt") &&
			postalMatch &&
			point.Street != "",
	}
}

func lookupRouteCandidates(
	ctx context.Context,
	service ParsedRouteService,
) ([]RouteCandidate, error) {
	key := strings.TrimSpace(os.Getenv("GEOAPIFY_API_KEY"))
	if key == "" {
		return nil, errors.New("GEOAPIFY_API_KEY is missing")
	}

	query := url.Values{}
	query.Set("text", serviceAddress(service))
	query.Set("filter", "countrycode:pt")
	query.Set("limit", "5")
	query.Set("apiKey", key)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://api.geoapify.com/v1/geocode/search?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, errors.New("Cannot create address lookup")
	}

	resp, err := routeGeocodeClient.Do(req)
	if err != nil {
		// Do not return an error containing the API-key URL.
		return nil, errors.New("Address lookup is unavailable")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Address lookup HTTP %d", resp.StatusCode)
	}

	var result struct {
		Features []struct {
			Properties geoRouteProperties `json:"properties"`
		} `json:"features"`
	}

	if err := json.NewDecoder(
		io.LimitReader(resp.Body, 2<<20),
	).Decode(&result); err != nil {
		return nil, errors.New("Invalid address lookup response")
	}

	candidates := make([]RouteCandidate, 0, len(result.Features))
	seen := map[string]bool{}

	for _, feature := range result.Features {
		candidate := candidateFor(service, feature.Properties)
		if !seen[candidate.ID] {
			seen[candidate.ID] = true
			candidates = append(candidates, candidate)
		}
	}
	return candidates, nil
}

func reviewRouteService(
	ctx context.Context,
	service ParsedRouteService,
	confirmation *RouteConfirmation,
) ParsedRouteService {
	service.Status = "needs_attention"
	service.Stage = "extracted"
	service.Reason = ""

	service.Latitude = 0
	service.Longitude = 0
	service.RoadLatitude = 0
	service.RoadLongitude = 0
	service.SnapDistanceM = 0

	service.Confirmed = false
	service.Confirmation = nil
	service.MatchedAddress = ""
	service.Candidates = []RouteCandidate{}

	// Never trust an audit submitted by the browser.
	service.Resolution = newRouteResolution(service)

	if service.OriginalAddress == "" {
		service.OriginalAddress = service.Address
	}
	service.Address = service.OriginalAddress

	if confirmation != nil {
		// This is an explicit user override, not an AI decision.
		if !validPoint(RouteInputStop{
			Latitude:  confirmation.Latitude,
			Longitude: confirmation.Longitude,
		}) {
			return resolutionFailure(
				service,
				errors.New("Selected coordinates are invalid"),
			)
		}

		service.Latitude = confirmation.Latitude
		service.Longitude = confirmation.Longitude
		service.Confirmation = &RouteConfirmation{
			Latitude:  confirmation.Latitude,
			Longitude: confirmation.Longitude,
		}
		service.Confirmed = true
		service.Stage = "geocoded"
		service.MatchedAddress = "User-confirmed location"

		service.Resolution.Method = "user_pin"
		service.Resolution.Decision = "selected"
		service.Resolution.Reason =
			"Location explicitly selected by the user"

		// Even user-selected coordinates must pass the road check.
		return applyRouteRoadCheck(ctx, service)
	}

	normalized, err := normalizeRouteEvidence(
		service,
		service.Resolution,
	)
	service = normalized

	if err != nil {
		return resolutionFailure(service, err)
	}

	candidates, err := lookupResolutionCandidates(
		ctx,
		service,
		service.Resolution,
	)
	if err != nil {
		return resolutionFailure(service, err)
	}

	service.Candidates = candidates
	if len(candidates) > 0 {
		service.Stage = "geocoded"
	}

	selected, err := resolveRouteCandidate(
		ctx,
		service,
		candidates,
		service.Resolution,
	)
	if err != nil {
		return resolutionFailure(service, err)
	}

	// Coordinates are copied exclusively from the geocoder result.
	// Gemini's response schema has no coordinate fields.
	service.Latitude = selected.Latitude
	service.Longitude = selected.Longitude
	service.MatchedAddress = selected.Address
	service.Stage = "geocoded"

	return applyRouteRoadCheck(ctx, service)
}

func ParseRouteScreenshots(c *gin.Context) {
	c.Header("X-Route-Parser-Version", routeParserVersion)

	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	// Includes multipart overhead for ten screenshots of up to 10 MiB.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 105<<20)

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(400, gin.H{"error": "Expected screenshots under the files field"})
		return
	}
	defer form.RemoveAll()

	files := form.File["files"]
	if len(files) < 1 || len(files) > 10 {
		c.JSON(400, gin.H{"error": "Upload between 1 and 10 screenshots"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 240*time.Second)
	defer cancel()

	var extracted []ParsedRouteService

	for index, header := range files {
		if header.Size <= 0 || header.Size > 10<<20 {
			c.JSON(413, gin.H{"error": "Each screenshot must be at most 10 MiB"})
			return
		}

		file, openErr := header.Open()
		if openErr != nil {
			c.JSON(400, gin.H{"error": "Cannot open screenshot"})
			return
		}
		data, readErr := io.ReadAll(io.LimitReader(file, (10<<20)+1))
		file.Close()

		if readErr != nil || len(data) > 10<<20 {
			c.JSON(413, gin.H{"error": "Cannot read screenshot or file is too large"})
			return
		}

		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
			c.JSON(400, gin.H{"error": "Use PNG, JPEG or WebP screenshots"})
			return
		}

		services, parseErr := parseRouteImage(ctx, data, mime)
		if parseErr != nil {
			c.JSON(502, gin.H{
				"error":          parseErr.Error(),
				"image_index":    index + 1,
				"parser_version": routeParserVersion,
			})
			return
		}

		for _, service := range services {
			service.SourceImage = index + 1
			extracted = append(extracted, service)
		}
	}

	services := deduplicateRouteServices(extracted)

	// Preserve extracted work even when lookup/road checks fail.
	// A failure becomes an individual review item, not a lost batch.
	for index := range services {
		if ctx.Err() != nil {
			services[index].Status = "needs_attention"
			services[index].Reason = "Verification interrupted; retry this address"
			continue
		}
		services[index] = reviewRouteService(ctx, services[index], nil)
	}

	ready := make([]ParsedRouteService, 0)
	attention := make([]ParsedRouteService, 0)

	for _, service := range services {
		if service.Status == "ready" {
			ready = append(ready, service)
		} else {
			attention = append(attention, service)
		}
	}

	c.JSON(200, gin.H{
		"services": services,
		// Compatibility with existing consumers.
		"complete":       ready,
		"uncomplete":     attention,
		"parser_version": routeParserVersion,
	})
}

func VerifyRouteAddress(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	c.Request.Body = http.MaxBytesReader(
		c.Writer,
		c.Request.Body,
		256<<10,
	)

	var input struct {
		Action  string             `json:"action"`
		Service ParsedRouteService `json:"service"`
		Address string             `json:"address"`
		Confirm *RouteConfirmation `json:"confirm"`
	}

	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid address review request",
		})
		return
	}

	switch input.Action {
	case "", "verify", "ai_assist":
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported address action",
		})
		return
	}

	if input.Action == "ai_assist" && input.Confirm != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "AI assistance and pin confirmation are separate actions",
		})
		return
	}

	if input.Service.OriginalAddress == "" {
		input.Service.OriginalAddress = input.Service.Address
	}
	if input.Service.OriginalAddress == "" {
		input.Service.OriginalAddress = input.Address
	}

	if strings.TrimSpace(input.Service.OriginalAddress) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Original address is required",
		})
		return
	}

	if input.Service.ID == "" {
		input.Service.ID = routeHash(
			[]byte(input.Service.OriginalAddress),
		)
	}

	ctx, cancel := context.WithTimeout(
		c.Request.Context(),
		120*time.Second,
	)
	defer cancel()

	if input.Action == "ai_assist" {
		requestID := newAssistanceRequestID(input.Service.ID)
		c.Header("X-Route-Assistance-ID", requestID)

		result, err := assistRouteService(
			ctx,
			input.Service,
			requestID,
		)
		if err != nil {
			status := http.StatusBadGateway

			if errors.Is(err, context.DeadlineExceeded) {
				status = http.StatusGatewayTimeout
			}

			c.JSON(status, gin.H{
				"error":      err.Error(),
				"request_id": requestID,
			})
			return
		}

		c.JSON(http.StatusOK, result)
		return
	}

	result := reviewRouteService(
		ctx,
		input.Service,
		input.Confirm,
	)

	c.JSON(http.StatusOK, gin.H{
		"service": result,
	})
}
