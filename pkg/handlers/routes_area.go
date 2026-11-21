package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RouteArea struct {
	PlaceID     string  `json:"place_id"`
	Label       string  `json:"label"`
	Level       string  `json:"level"`
	CountryCode string  `json:"country_code"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	OSMID       string  `json:"osm_id,omitempty"`
	OSMType     string  `json:"osm_type,omitempty"`
}

type RouteSettings struct {
	Revision  string     `json:"revision"`
	Area      *RouteArea `json:"area"`
	UpdatedAt string     `json:"updated_at,omitempty"`
}

type RouteAreaOption struct {
	RouteArea
	SelectionToken string `json:"selection_token"`
}

type routeAreaClaim struct {
	UserID    string    `json:"user_id"`
	ExpiresAt int64     `json:"expires_at"`
	Area      RouteArea `json:"area"`
}

type routeSettingsContextKey struct{}

type geoRouteProperties struct {
	Name        string  `json:"name"`
	PlaceID     string  `json:"place_id"`
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
	County      string  `json:"county"`
	State       string  `json:"state"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ResultType  string  `json:"result_type"`
	Datasource  struct {
		Raw map[string]any `json:"raw"`
	} `json:"datasource"`
	Rank struct {
		Confidence       float64 `json:"confidence"`
		StreetConfidence float64 `json:"confidence_street_level"`
		MatchType        string  `json:"match_type"`
	} `json:"rank"`
}

func WithRouteSettings(
	ctx context.Context,
	settings RouteSettings,
) context.Context {
	return context.WithValue(ctx, routeSettingsContextKey{}, settings)
}

func CurrentRouteSettings(ctx context.Context) (RouteSettings, error) {
	settings, ok := ctx.Value(routeSettingsContextKey{}).(RouteSettings)

	if !ok || settings.Area == nil ||
		settings.Area.PlaceID == "" || settings.Revision == "" {
		return RouteSettings{}, errors.New(
			"Select a geographic area in Route Planner Settings first",
		)
	}

	return settings, nil
}

func geoapifyFeatures(
	ctx context.Context,
	path string,
	query url.Values,
) ([]geoRouteProperties, error) {
	key := strings.TrimSpace(os.Getenv("GEOAPIFY_API_KEY"))
	if key == "" {
		return nil, errors.New("GEOAPIFY_API_KEY is missing")
	}

	query.Set("apiKey", key)

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://api.geoapify.com"+path+"?"+query.Encode(),
		nil,
	)
	if err != nil {
		return nil, errors.New("Cannot create geocoding request")
	}

	resp, err := routeGeocodeClient.Do(req)
	if err != nil {
		return nil, errors.New("Geographic lookup is unavailable")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"Geographic lookup HTTP %d",
			resp.StatusCode,
		)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
	if err != nil || len(raw) > 4<<20 {
		return nil, errors.New("Invalid geographic response size")
	}

	var result struct {
		Type     string `json:"type"`
		Features []struct {
			Properties geoRouteProperties `json:"properties"`
		} `json:"features"`
	}

	if json.Unmarshal(raw, &result) != nil ||
		result.Type != "FeatureCollection" {
		return nil, errors.New("Invalid geographic response")
	}

	points := make([]geoRouteProperties, 0, len(result.Features))
	for _, feature := range result.Features {
		points = append(points, feature.Properties)
	}

	return points, nil
}

func routeOSMType(value string) string {
	switch strings.ToLower(value) {
	case "r", "relation":
		return "r"
	case "w", "way":
		return "w"
	case "n", "node":
		return "n"
	default:
		return ""
	}
}

func routeRawString(raw map[string]any, key string) string {
	value, exists := raw[key]
	if !exists || value == nil {
		return ""
	}

	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', 0, 64)
	default:
		return fmt.Sprint(value)
	}
}

func routeAreaSigningKey() ([]byte, error) {
	value := strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_TOKEN"))
	if value == "" {
		return nil, errors.New("Area-selection signing key is unavailable")
	}

	sum := sha256.Sum256([]byte("route-area-selection:v1:" + value))
	return sum[:], nil
}

func signRouteArea(userID string, area RouteArea) (string, error) {
	key, err := routeAreaSigningKey()
	if err != nil {
		return "", err
	}

	payload, err := json.Marshal(routeAreaClaim{
		UserID:    userID,
		ExpiresAt: time.Now().Add(15 * time.Minute).Unix(),
		Area:      area,
	})
	if err != nil {
		return "", err
	}

	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(encoded))

	return encoded + "." +
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func VerifyRouteAreaSelection(
	userID string,
	token string,
) (RouteArea, error) {
	if len(token) > 16384 {
		return RouteArea{}, errors.New("Invalid area selection")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return RouteArea{}, errors.New("Invalid area selection")
	}

	key, err := routeAreaSigningKey()
	if err != nil {
		return RouteArea{}, err
	}

	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return RouteArea{}, errors.New("Invalid area signature")
	}

	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(parts[0]))

	if !hmac.Equal(signature, mac.Sum(nil)) {
		return RouteArea{}, errors.New("Invalid area signature")
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return RouteArea{}, errors.New("Invalid area selection")
	}

	var claim routeAreaClaim
	if json.Unmarshal(raw, &claim) != nil ||
		claim.UserID != userID ||
		claim.ExpiresAt <= time.Now().Unix() ||
		claim.Area.PlaceID == "" {
		return RouteArea{}, errors.New(
			"Area selection expired; search and select the area again",
		)
	}

	return claim.Area, nil
}

func SearchRouteAreas(
	ctx context.Context,
	userID string,
	text string,
) ([]RouteAreaOption, error) {
	text = strings.TrimSpace(text)
	if len(text) < 3 || len(text) > 200 {
		return nil, errors.New("Enter between 3 and 200 characters")
	}

	query := url.Values{
		"text":   {text},
		"type":   {"locality"},
		"filter": {"countrycode:pt"},
		"lang":   {"pt"},
		"limit":  {"10"},
	}

	points, err := geoapifyFeatures(
		ctx,
		"/v1/geocode/search",
		query,
	)
	if err != nil {
		return nil, err
	}

	result := make([]RouteAreaOption, 0)
	seen := make(map[string]bool)

	for _, point := range points {
		if point.PlaceID == "" || seen[point.PlaceID] {
			continue
		}

		switch point.ResultType {
		case "country", "state", "county", "city",
			"district", "suburb", "postcode":
		default:
			continue
		}

		osmType := routeOSMType(
			routeRawString(point.Datasource.Raw, "osm_type"),
		)

		// A settlement node is a point, not a delimited search boundary.
		// Offer only relation/way areas.
		if osmType != "r" && osmType != "w" {
			continue
		}

		area := RouteArea{
			PlaceID:     point.PlaceID,
			Label:       point.Formatted,
			Level:       point.ResultType,
			CountryCode: point.CountryCode,
			Latitude:    point.Lat,
			Longitude:   point.Lon,
			OSMID:       routeRawString(point.Datasource.Raw, "osm_id"),
			OSMType:     osmType,
		}

		if area.Label == "" {
			area.Label = point.Name
		}

		token, signErr := signRouteArea(userID, area)
		if signErr != nil {
			return nil, signErr
		}

		seen[point.PlaceID] = true

		result = append(result, RouteAreaOption{
			RouteArea:      area,
			SelectionToken: token,
		})
	}

	return result, nil
}

type routeMembershipEntry struct {
	Inside  bool
	Expires time.Time
}

var routeMembershipCache = struct {
	sync.Mutex
	Entries map[string]routeMembershipEntry
}{
	Entries: make(map[string]routeMembershipEntry),
}

func RoutePointInsideArea(
	ctx context.Context,
	area RouteArea,
	longitude float64,
	latitude float64,
) (bool, error) {
	if !validPoint(RouteInputStop{
		Longitude: longitude,
		Latitude:  latitude,
	}) {
		return false, errors.New("Invalid coordinates")
	}

	cacheKey := fmt.Sprintf(
		"%s:%s:%s",
		area.PlaceID,
		strconv.FormatFloat(longitude, 'g', -1, 64),
		strconv.FormatFloat(latitude, 'g', -1, 64),
	)

	routeMembershipCache.Lock()
	cached, exists := routeMembershipCache.Entries[cacheKey]
	routeMembershipCache.Unlock()

	if exists && time.Now().Before(cached.Expires) {
		return cached.Inside, nil
	}

	query := url.Values{
		"lon": {
			strconv.FormatFloat(longitude, 'g', -1, 64),
		},
		"lat": {
			strconv.FormatFloat(latitude, 'g', -1, 64),
		},
		"boundaries": {"administrative,postal_code"},
		"geometry":   {"point"},
		"lang":       {"pt"},
	}

	boundaries, err := geoapifyFeatures(
		ctx,
		"/v1/boundaries/part-of",
		query,
	)
	if err != nil {
		return false, err
	}

	inside := false

	for _, boundary := range boundaries {
		if boundary.PlaceID == area.PlaceID {
			inside = true
			break
		}

		osmID := routeRawString(
			boundary.Datasource.Raw,
			"osm_id",
		)
		osmType := routeOSMType(routeRawString(
			boundary.Datasource.Raw,
			"osm_type",
		))

		if area.OSMID != "" && area.OSMType != "" &&
			osmID == area.OSMID && osmType == area.OSMType {
			inside = true
			break
		}
	}

	routeMembershipCache.Lock()

	if len(routeMembershipCache.Entries) >= 4096 {
		routeMembershipCache.Entries =
			make(map[string]routeMembershipEntry)
	}

	routeMembershipCache.Entries[cacheKey] = routeMembershipEntry{
		Inside:  inside,
		Expires: time.Now().Add(30 * time.Minute),
	}

	routeMembershipCache.Unlock()

	return inside, nil
}