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

const routeParserVersion = "zone-aware-extraction-v4"

var (
	postalPattern = regexp.MustCompile(`\b\d{4}-\d{3}\b`)
	longNumberPattern = regexp.MustCompile(`\d{5,}`)
	undefinedPattern = regexp.MustCompile(
		`(?i)\b(undefined|null|nan)\b`,
	)
	postalSpacingPattern = regexp.MustCompile(
		`\b(\d{4})\s*-\s*(\d{3})\b`,
	)
	postalValuePattern = regexp.MustCompile(`^\d{4}(?:-\d{3})?$`)

	routeGeminiClient = &http.Client{Timeout: 60 * time.Second}
	routeGeocodeClient = &http.Client{Timeout: 15 * time.Second}
)

type RouteCandidate struct {
	ID                string  `json:"id"`
	Address           string  `json:"address"`
	Street            string  `json:"street"`
	HouseNumber       string  `json:"house_number"`
	PostalCode        string  `json:"postal_code"`
	Locality          string  `json:"locality"`
	Latitude          float64 `json:"latitude"`
	Longitude         float64 `json:"longitude"`
	Confidence        float64 `json:"confidence"`
	StreetConfidence  float64 `json:"street_confidence"`
	ResultType        string  `json:"result_type"`
	MatchType         string  `json:"match_type"`
	Exact             bool    `json:"exact"`
	CanConfirm        bool    `json:"can_confirm"`
	InSelectedArea    bool    `json:"in_selected_area"`
	LocationPrecision string  `json:"location_precision"`
}

type RouteConfirmation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type ParsedRouteService struct {
	ID                string             `json:"id"`
	SourceApp         string             `json:"source_app"`
	SourceReference   string             `json:"source_reference"`
	SourceImage       int                `json:"source_image"`
	OriginalAddress   string             `json:"original_address"`
	OriginalAddresses []string           `json:"original_addresses,omitempty"`
	Address           string             `json:"address"`
	Street            string             `json:"street"`
	HouseNumber       string             `json:"house_number"`
	PostalCode        string             `json:"postal_code"`
	Locality          string             `json:"locality"`
	ServiceType       string             `json:"service_type"`
	ParcelCount       int                `json:"parcel_count"`
	ExtractionIssues  []string           `json:"extraction_issues"`
	Candidates        []RouteCandidate   `json:"candidates"`
	MatchedAddress    string             `json:"matched_address"`
	LocationPrecision string             `json:"location_precision"`
	AreaRevision      string             `json:"area_revision"`
	Latitude          float64            `json:"latitude"`
	Longitude         float64            `json:"longitude"`
	RoadLatitude      float64            `json:"road_latitude"`
	RoadLongitude     float64            `json:"road_longitude"`
	SnapDistanceM     float64            `json:"snap_distance_m"`
	Stage             string             `json:"stage"`
	Status            string             `json:"status"`
	Reason            string             `json:"reason"`
	Confirmed         bool               `json:"confirmed"`
	Confirmation      *RouteConfirmation `json:"confirmation,omitempty"`
	Resolution        *RouteResolution   `json:"resolution,omitempty"`
}

type routeParseResult struct {
	Services []ParsedRouteService `json:"services"`
}

const routeExtractionPrompt = `
Extract visible logistics SERVICE CARDS. Return JSON only:
{
 "services": [{
  "source_app": "gls|lds|unknown",
  "source_reference": "",
  "original_address": "",
  "street": "",
  "house_number": "",
  "postal_code": "",
  "locality": "",
  "service_type": "delivery|pickup|unknown",
  "parcel_count": 1,
  "extraction_issues": []
 }]
}

Rules:
- One card is one service. Two parcels on a card are not two services.
- Keep separate cards even when they share an address.
- Copy the visible shipment identifier exactly.
- Never substitute a telephone number or postcode for a shipment identifier.
- GLS D/E mean delivery. GLS P/R mean pickup.
- Explicit collection/recolha/recogida labels mean pickup.
- Use unknown for an unfamiliar application's service type.
- LDS postcode/locality headings belong only to their own card.
- Preserve all visible address text in original_address.
- Separate street, house number, postcode and locality.
- A missing house number is allowed. Use "" when absent.
- Explicit S/N means no number: use house_number "S/N".
- Do not confuse road numbers, floors, apartments or kilometre references
  with house numbers.
- Estrada Nacional 324 is a street name; KM 123 is not a house number.
- Preserve corrupted numbers in original_address without guessing repairs.
- If a house number is corrupted, leave it empty and add
  "uncertain_house_number" to extraction_issues.
- Use "unclear_card_association" when fields cannot be assigned to one card.
- Use "cropped_street" or "cropped_locality" for truncated address fields.
- Do not invent missing postcodes. A visible four-digit prefix is allowed.
- Do not flag a missing house number or postcode as an extraction failure.
- Do not include recipients, phone numbers, emails, customer names,
  counters, navigation text or buttons in address fields.
- Do not invent cards from the total pending-services counter.
`

func NewRouteRevision() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		panic("cryptographic randomness unavailable")
	}
	return hex.EncodeToString(value)
}

func routeHash(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func normalizeRouteAddress(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), " ")
}

func cleanRouteText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func cleanRoutePostcode(value string) string {
	return strings.TrimSpace(
		postalSpacingPattern.ReplaceAllString(value, "$1-$2"),
	)
}

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
		"r": "rua", "av": "avenida", "dr": "doutor",
		"prof": "professor", "grd": "guarda",
		"numero": "", "n": "",
	}

	result := make([]string, 0)
	for _, word := range strings.Fields(builder.String()) {
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

	available := make(map[string]bool)
	for _, word := range strings.Fields(addressWords(actual)) {
		available[word] = true
	}
	for _, word := range words {
		if !available[word] {
			return false
		}
	}
	return true
}

func sameRouteStreet(first, second string) bool {
	return containsAddressWords(first, second) &&
		containsAddressWords(second, first)
}

func uniqueRouteStrings(values ...string) []string {
	result := make([]string, 0)
	seen := make(map[string]bool)
	for _, value := range values {
		value = strings.TrimSpace(value)
		key := normalizeRouteAddress(value)
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, value)
		}
	}
	return result
}

func serviceAddress(service ParsedRouteService) string {
	if service.OriginalAddress != "" {
		return service.OriginalAddress
	}
	return service.Address
}

func routeEvidence(service ParsedRouteService) string {
	values := append([]string{serviceAddress(service)}, service.OriginalAddresses...)
	return strings.Join(uniqueRouteStrings(values...), "\n")
}

func hasRouteIssue(service ParsedRouteService, issue string) bool {
	for _, existing := range service.ExtractionIssues {
		if strings.EqualFold(existing, issue) {
			return true
		}
	}
	return false
}

func noRouteHouse(value string) bool {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), " ", "")) {
	case "", "s/n", "sn", "s.n.", "semnumero", "semnúmero":
		return true
	default:
		return false
	}
}

func extractionProblem(service ParsedRouteService) string {
	for _, issue := range []string{
		"conflicting_shipment_address",
		"unclear_card_association",
		"cropped_street",
		"cropped_locality",
	} {
		if hasRouteIssue(service, issue) {
			return issue
		}
	}

	if service.Street == "" || service.Locality == "" {
		return "Street and locality are required"
	}

	if strings.Contains(service.Street, "...") ||
		strings.Contains(service.Street, "…") ||
		strings.Contains(service.Locality, "...") ||
		strings.Contains(service.Locality, "…") {
		return "Street or locality is truncated"
	}

	if undefinedPattern.MatchString(service.Street + " " + service.Locality) {
		return "Street or locality contains an undefined field"
	}

	if service.PostalCode != "" &&
		!postalValuePattern.MatchString(service.PostalCode) {
		return "Visible postcode is malformed"
	}

	return ""
}

func normalizeExtractedService(
	input ParsedRouteService,
	imageHash string,
	cardIndex int,
) ParsedRouteService {
	service := ParsedRouteService{
		SourceApp:         strings.ToLower(strings.TrimSpace(input.SourceApp)),
		SourceReference:   strings.TrimSpace(input.SourceReference),
		OriginalAddress:   strings.TrimSpace(serviceAddress(input)),
		Street:            cleanRouteText(input.Street),
		HouseNumber:       cleanRouteText(input.HouseNumber),
		PostalCode:        cleanRoutePostcode(input.PostalCode),
		Locality:          cleanRouteText(input.Locality),
		ParcelCount:       input.ParcelCount,
		ExtractionIssues:  uniqueRouteStrings(input.ExtractionIssues...),
		Candidates:        []RouteCandidate{},
		Stage:             "extracted",
		Status:            "needs_attention",
	}

	if service.SourceApp != "gls" && service.SourceApp != "lds" {
		service.SourceApp = "unknown"
	}

	switch strings.ToLower(input.ServiceType) {
	case "delivery", "d", "e":
		service.ServiceType = "delivery"
	case "pickup", "p", "r":
		service.ServiceType = "pickup"
	default:
		service.ServiceType = "unknown"
	}

	if service.ParcelCount < 1 {
		service.ParcelCount = 1
	}

	service.Address = service.OriginalAddress
	service.OriginalAddresses = []string{service.OriginalAddress}

	identity := service.SourceApp + ":" +
		strings.ToUpper(strings.Join(strings.Fields(service.SourceReference), ""))

	if service.SourceReference == "" {
		identity = fmt.Sprintf("%s:%d", imageHash, cardIndex)
	}

	service.ID = routeHash([]byte(identity))
	service.Reason = extractionProblem(service)
	return service
}

func configuredRouteGeminiModels() []string {
	value := strings.TrimSpace(os.Getenv("ROUTE_GEMINI_MODELS"))
	if value == "" {
		value = strings.TrimSpace(os.Getenv("ROUTE_GEMINI_MODEL"))
	}

	// Retain the repository's existing fallback configuration.
	if value == "" {
		value = "gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.6-flash"
	}

	models := make([]string, 0)
	for _, model := range uniqueRouteStrings(strings.Split(value, ",")...) {
		models = append(models, strings.TrimPrefix(model, "models/"))
	}
	return models
}

func requestRouteGeminiText(
	ctx context.Context,
	prompt string,
	extraParts []any,
) (string, string, error) {
	key := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if key == "" {
		return "", "", errors.New("GEMINI_API_KEY is missing")
	}

	parts := append(
		[]any{map[string]string{"text": prompt}},
		extraParts...,
	)

	body, err := json.Marshal(map[string]any{
		"contents": []any{map[string]any{"parts": parts}},
		"generationConfig": map[string]any{
			"responseMimeType": "application/json",
			"temperature":      0,
		},
	})
	if err != nil {
		return "", "", err
	}

	for _, model := range configuredRouteGeminiModels() {
		if ctx.Err() != nil {
			return "", "", ctx.Err()
		}

		attempt, cancel := context.WithTimeout(ctx, 45*time.Second)
		req, err := http.NewRequestWithContext(
			attempt,
			http.MethodPost,
			"https://generativelanguage.googleapis.com/v1beta/models/"+
				url.PathEscape(model)+":generateContent",
			bytes.NewReader(body),
		)
		if err != nil {
			cancel()
			return "", "", errors.New("Cannot create Gemini request")
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-goog-api-key", key)

		resp, err := routeGeminiClient.Do(req)
		if err != nil {
			cancel()
			continue
		}

		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
		resp.Body.Close()
		cancel()

		if readErr != nil || len(raw) > 2<<20 {
			continue
		}

		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return "", "", errors.New("Gemini rejected its configured credentials")
		}
		if resp.StatusCode != 200 {
			continue
		}

		var result struct {
			PromptFeedback struct {
				BlockReason string `json:"blockReason"`
			} `json:"promptFeedback"`
			Candidates []struct {
				FinishReason string `json:"finishReason"`
				Content struct {
					Parts []struct {
						Text string `json:"text"`
						Thought bool `json:"thought"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}

		if json.Unmarshal(raw, &result) != nil ||
			len(result.Candidates) == 0 ||
			result.PromptFeedback.BlockReason != "" {
			continue
		}

		candidate := result.Candidates[0]
		if candidate.FinishReason != "" && candidate.FinishReason != "STOP" {
			continue
		}

		var text strings.Builder
		for _, part := range candidate.Content.Parts {
			if !part.Thought {
				text.WriteString(part.Text)
			}
		}

		if strings.TrimSpace(text.String()) != "" {
			return text.String(), model, nil
		}
	}

	return "", "", errors.New("No configured Gemini model completed the request")
}

func decodeRouteExtraction(text, imageHash string) ([]ParsedRouteService, error) {
	var result struct {
		Services *[]ParsedRouteService `json:"services"`
	}

	if json.Unmarshal([]byte(text), &result) != nil || result.Services == nil {
		return nil, errors.New("Invalid screenshot extraction JSON")
	}
	if len(*result.Services) > 500 {
		return nil, errors.New("Too many extracted cards")
	}

	services := make([]ParsedRouteService, 0, len(*result.Services))
	for index, service := range *result.Services {
		services = append(services, normalizeExtractedService(service, imageHash, index))
	}
	return services, nil
}

func extractRouteImage(
	ctx context.Context,
	data []byte,
	mime, imageHash string,
) ([]ParsedRouteService, error) {
	text, _, err := requestRouteGeminiText(ctx, routeExtractionPrompt, []any{
		map[string]any{
			"inline_data": map[string]string{
				"mime_type": mime,
				"data": base64.StdEncoding.EncodeToString(data),
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return decodeRouteExtraction(text, imageHash)
}

func parseRouteImage(
	ctx context.Context,
	data []byte,
	mime string,
) ([]ParsedRouteService, error) {
	hash := routeHash(append([]byte(routeParserVersion+":"), data...))
	var cached models.RouteImageCache

	err := database.RouteDB.WithContext(ctx).First(&cached, "hash = ?", hash).Error
	if err == nil {
		var result routeParseResult
		if json.Unmarshal(cached.Result, &result) == nil && result.Services != nil {
			return result.Services, nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errors.New("Screenshot cache lookup failed")
	}

	services, err := extractRouteImage(ctx, data, mime, hash)
	if err != nil {
		return nil, err
	}

	if encoded, encodeErr := json.Marshal(routeParseResult{Services: services}); encodeErr == nil {
		_ = database.RouteDB.WithContext(ctx).Save(
			&models.RouteImageCache{Hash: hash, Result: encoded},
		).Error
	}

	return services, nil
}

func routeEvidenceScore(service ParsedRouteService) int {
	score := 0
	if service.Street != "" {
		score += 20
	}
	if service.Locality != "" {
		score += 20
	}
	if len(service.PostalCode) == 8 {
		score += 10
	}
	if !noRouteHouse(service.HouseNumber) &&
		!longNumberPattern.MatchString(service.HouseNumber) {
		score += 5
	}
	return score - len(service.ExtractionIssues)*3
}

func routeEvidenceConflict(first, second ParsedRouteService) bool {
	conflicts := func(a, b string) bool {
		return a != "" && b != "" &&
			!containsAddressWords(a, b) &&
			!containsAddressWords(b, a)
	}

	if conflicts(first.Street, second.Street) ||
		conflicts(first.Locality, second.Locality) ||
		!routePostcodesCompatible(first.PostalCode, second.PostalCode) {
		return true
	}

	if !noRouteHouse(first.HouseNumber) &&
		!noRouteHouse(second.HouseNumber) &&
		!longNumberPattern.MatchString(first.HouseNumber) &&
		!longNumberPattern.MatchString(second.HouseNumber) &&
		addressWords(first.HouseNumber) != addressWords(second.HouseNumber) {
		return true
	}

	return first.ServiceType != "unknown" &&
		second.ServiceType != "unknown" &&
		first.ServiceType != second.ServiceType
}

func MergeRouteServices(input []ParsedRouteService) []ParsedRouteService {
	result := make([]ParsedRouteService, 0, len(input))
	positions := make(map[string]int)

	for _, service := range input {
		key := service.ID
		if service.SourceReference != "" {
			key = service.SourceApp + ":" +
				strings.ToUpper(strings.Join(strings.Fields(service.SourceReference), ""))
		}

		position, exists := positions[key]
		if key == "" || !exists {
			if key != "" {
				positions[key] = len(result)
			}
			result = append(result, service)
			continue
		}

		old := result[position]
		conflict := routeEvidenceConflict(old, service)
		winner, other := old, service

		if routeEvidenceScore(service) > routeEvidenceScore(old) {
			winner, other = service, old
		}

		winner.ID = old.ID
		evidence := append([]string{}, old.OriginalAddresses...)
		evidence = append(evidence, service.OriginalAddresses...)
		evidence = append(evidence, serviceAddress(old), serviceAddress(service))
		winner.OriginalAddresses = uniqueRouteStrings(evidence...)

		if !conflict {
			if winner.Street == "" {
				winner.Street = other.Street
			}
			if winner.Locality == "" {
				winner.Locality = other.Locality
			}
			if winner.HouseNumber == "" {
				winner.HouseNumber = other.HouseNumber
			}
			if winner.PostalCode == "" ||
				(len(winner.PostalCode) == 4 && len(other.PostalCode) == 8) {
				winner.PostalCode = other.PostalCode
			}
			if winner.ServiceType == "unknown" {
				winner.ServiceType = other.ServiceType
			}
		}

		// Repeated observations do not increase parcel count.
		if other.ParcelCount > winner.ParcelCount {
			winner.ParcelCount = other.ParcelCount
		}

		if conflict ||
			hasRouteIssue(old, "conflicting_shipment_address") ||
			hasRouteIssue(service, "conflicting_shipment_address") {
			winner.ExtractionIssues = uniqueRouteStrings(
				append(winner.ExtractionIssues, "conflicting_shipment_address")...,
			)
		}

		result[position] = winner
	}

	return result
}

func deduplicateRouteServices(input []ParsedRouteService) []ParsedRouteService {
	return MergeRouteServices(input)
}

func requireAreaRevision(c *gin.Context, revision string) bool {
	settings, err := CurrentRouteSettings(c.Request.Context())
	if err != nil {
		c.JSON(428, gin.H{"error": err.Error(), "code": "AREA_REQUIRED"})
		return false
	}
	if revision != settings.Revision {
		c.JSON(409, gin.H{
			"error": "The selected area changed; reload settings and revalidate addresses",
			"code": "AREA_CHANGED",
		})
		return false
	}
	return true
}

func ParseRouteScreenshots(c *gin.Context) {
	if database.RouteDB == nil {
		c.JSON(503, gin.H{"error": "Routes database unavailable"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 105<<20)
	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(400, gin.H{"error": "Expected screenshots in files"})
		return
	}
	defer form.RemoveAll()

	if !requireAreaRevision(c, c.PostForm("area_revision")) {
		return
	}

	files := form.File["files"]
	if len(files) < 1 || len(files) > 10 {
		c.JSON(400, gin.H{"error": "Upload between 1 and 10 screenshots"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 240*time.Second)
	defer cancel()

	extracted := make([]ParsedRouteService, 0)

	for index, header := range files {
		if header.Size <= 0 || header.Size > 10<<20 {
			c.JSON(413, gin.H{"error": "Each screenshot must be at most 10 MiB"})
			return
		}

		file, err := header.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "Cannot open screenshot"})
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, (10<<20)+1))
		file.Close()

		if err != nil || len(data) > 10<<20 {
			c.JSON(413, gin.H{"error": "Cannot read screenshot"})
			return
		}

		mime := http.DetectContentType(data)
		if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
			c.JSON(400, gin.H{"error": "Use PNG, JPEG or WebP screenshots"})
			return
		}

		services, err := parseRouteImage(ctx, data, mime)
		if err != nil {
			c.JSON(502, gin.H{"error": err.Error(), "image_index": index + 1})
			return
		}
		for _, service := range services {
			service.SourceImage = index + 1
			extracted = append(extracted, service)
		}
	}

	services := MergeRouteServices(extracted)

	for index := range services {
		if ctx.Err() != nil {
			services[index].Status = "needs_attention"
			services[index].Reason = "Verification interrupted; retry this address"
			continue
		}
		services[index] = reviewRouteService(ctx, services[index], nil)
	}

	settings, _ := CurrentRouteSettings(ctx)
	c.Header("X-Route-Parser-Version", routeParserVersion)
	c.JSON(200, gin.H{
		"services": services,
		"area_revision": settings.Revision,
		"parser_version": routeParserVersion,
	})
}

func VerifyRouteAddress(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)

	var input struct {
		Action string `json:"action"`
		AreaRevision string `json:"area_revision"`
		Service ParsedRouteService `json:"service"`
		Confirm *RouteConfirmation `json:"confirm"`
	}

	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"error": "Invalid address request"})
		return
	}
	if !requireAreaRevision(c, input.AreaRevision) {
		return
	}

	if input.Action != "" && input.Action != "verify" &&
		input.Action != "ai_assist" {
		c.JSON(400, gin.H{"error": "Unsupported address action"})
		return
	}

	if input.Action == "ai_assist" && input.Confirm != nil {
		c.JSON(400, gin.H{"error": "AI assistance and pin confirmation are separate actions"})
		return
	}

	if strings.TrimSpace(serviceAddress(input.Service)) == "" {
		c.JSON(400, gin.H{"error": "Original address is required"})
		return
	}

	if input.Service.ID == "" {
		input.Service.ID = routeHash([]byte(serviceAddress(input.Service)))
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	if input.Action == "ai_assist" {
		result, err := assistRouteService(
			ctx, input.Service, newAssistanceRequestID(input.Service.ID),
		)
		if err != nil {
			c.JSON(502, gin.H{"error": err.Error()})
			return
		}
		c.JSON(200, result)
		return
	}

	c.JSON(200, gin.H{
		"service": reviewRouteService(ctx, input.Service, input.Confirm),
	})
}