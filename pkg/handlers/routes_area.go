package handlers

import (
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
)

const routeGeometryEpsilon = 1e-10

type RouteCorner struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

type RouteArea struct {
	ID        string        `json:"id"`
	Type      string        `json:"type"`
	Label     string        `json:"label"`
	Latitude  float64       `json:"latitude"`
	Longitude float64       `json:"longitude"`
	Corners   []RouteCorner `json:"corners,omitempty"`

	// Compatibility when reading older boundary-based settings.
	PlaceID     string `json:"place_id,omitempty"`
	Level       string `json:"level,omitempty"`
	CountryCode string `json:"country_code,omitempty"`
	OSMID       string `json:"osm_id,omitempty"`
	OSMType     string `json:"osm_type,omitempty"`
}

type RouteSettings struct {
	Revision  string     `json:"revision"`
	Area      *RouteArea `json:"area"`
	UpdatedAt string     `json:"updated_at,omitempty"`
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

	Datasource struct {
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
	return context.WithValue(
		ctx,
		routeSettingsContextKey{},
		settings,
	)
}

func CurrentRouteSettings(
	ctx context.Context,
) (RouteSettings, error) {
	settings, ok := ctx.Value(
		routeSettingsContextKey{},
	).(RouteSettings)

	if !ok ||
		settings.Revision == "" ||
		settings.Area == nil ||
		settings.Area.ID == "" ||
		settings.Area.Type != "four_corners" {
		return RouteSettings{}, errors.New(
			"Select and save four working-area corners in Route Planner Settings first",
		)
	}

	if err := ValidateRouteCorners(settings.Area.Corners); err != nil {
		return RouteSettings{}, fmt.Errorf(
			"Saved working area is invalid: %w",
			err,
		)
	}

	return settings, nil
}

func finiteRouteCoordinate(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func sameRouteCorner(first, second RouteCorner) bool {
	return math.Abs(first.Longitude-second.Longitude) <=
		routeGeometryEpsilon &&
		math.Abs(first.Latitude-second.Latitude) <=
			routeGeometryEpsilon
}

func routeCornerCross(a, b, c RouteCorner) float64 {
	return (b.Longitude-a.Longitude)*(c.Latitude-a.Latitude) -
		(b.Latitude-a.Latitude)*(c.Longitude-a.Longitude)
}

func routeCornerOnSegment(
	first RouteCorner,
	second RouteCorner,
	point RouteCorner,
) bool {
	if math.Abs(
		routeCornerCross(first, second, point),
	) > routeGeometryEpsilon {
		return false
	}

	return point.Longitude >=
		math.Min(first.Longitude, second.Longitude)-routeGeometryEpsilon &&
		point.Longitude <=
			math.Max(first.Longitude, second.Longitude)+routeGeometryEpsilon &&
		point.Latitude >=
			math.Min(first.Latitude, second.Latitude)-routeGeometryEpsilon &&
		point.Latitude <=
			math.Max(first.Latitude, second.Latitude)+routeGeometryEpsilon
}

func routeCornerSegmentsIntersect(
	a RouteCorner,
	b RouteCorner,
	c RouteCorner,
	d RouteCorner,
) bool {
	first := routeCornerCross(a, b, c)
	second := routeCornerCross(a, b, d)
	third := routeCornerCross(c, d, a)
	fourth := routeCornerCross(c, d, b)

	crosses := ((first > 0 && second < 0) ||
		(first < 0 && second > 0)) &&
		((third > 0 && fourth < 0) ||
			(third < 0 && fourth > 0))

	return crosses ||
		routeCornerOnSegment(a, b, c) ||
		routeCornerOnSegment(a, b, d) ||
		routeCornerOnSegment(c, d, a) ||
		routeCornerOnSegment(c, d, b)
}

func routeSignedCornerArea(corners []RouteCorner) float64 {
	origin := corners[0]
	twiceArea := 0.0

	for index, current := range corners {
		next := corners[(index+1)%len(corners)]

		currentX := current.Longitude - origin.Longitude
		currentY := current.Latitude - origin.Latitude
		nextX := next.Longitude - origin.Longitude
		nextY := next.Latitude - origin.Latitude

		twiceArea += currentX*nextY - nextX*currentY
	}

	return twiceArea
}

func ValidateRouteCorners(corners []RouteCorner) error {
	if len(corners) != 4 {
		return errors.New(
			"The working area must contain exactly four corners",
		)
	}

	minLongitude := corners[0].Longitude
	maxLongitude := corners[0].Longitude

	for index, corner := range corners {
		if !finiteRouteCoordinate(corner.Longitude) ||
			!finiteRouteCoordinate(corner.Latitude) ||
			math.Abs(corner.Longitude) > 180 ||
			math.Abs(corner.Latitude) > 90 {
			return fmt.Errorf(
				"Corner %d contains invalid coordinates",
				index+1,
			)
		}

		minLongitude = math.Min(
			minLongitude,
			corner.Longitude,
		)
		maxLongitude = math.Max(
			maxLongitude,
			corner.Longitude,
		)

		for other := index + 1; other < len(corners); other++ {
			if sameRouteCorner(corner, corners[other]) {
				return errors.New(
					"Each corner must have a different position",
				)
			}
		}
	}

	if maxLongitude-minLongitude > 180 {
		return errors.New(
			"Working areas crossing the international date line are unsupported",
		)
	}

	if routeCornerSegmentsIntersect(
		corners[0], corners[1], corners[2], corners[3],
	) || routeCornerSegmentsIntersect(
		corners[1], corners[2], corners[3], corners[0],
	) {
		return errors.New(
			"The working-area edges cross; keep the corners in boundary order",
		)
	}

	for index := range corners {
		previous := corners[(index+3)%4]
		current := corners[index]
		next := corners[(index+1)%4]

		if math.Abs(
			routeCornerCross(previous, current, next),
		) <= routeGeometryEpsilon {
			return errors.New(
				"Three neighbouring corners cannot lie on one straight line",
			)
		}
	}

	if math.Abs(
		routeSignedCornerArea(corners),
	) <= routeGeometryEpsilon {
		return errors.New(
			"The selected working area is too small or has no area",
		)
	}

	return nil
}

func canonicalRouteCorners(
	input []RouteCorner,
) []RouteCorner {
	corners := append([]RouteCorner(nil), input...)

	if routeSignedCornerArea(corners) < 0 {
		for first, last := 0, len(corners)-1; first < last; {
			corners[first], corners[last] =
				corners[last], corners[first]

			first++
			last--
		}
	}

	start := 0

	for index := 1; index < len(corners); index++ {
		if corners[index].Longitude < corners[start].Longitude ||
			(corners[index].Longitude == corners[start].Longitude &&
				corners[index].Latitude < corners[start].Latitude) {
			start = index
		}
	}

	result := make([]RouteCorner, 0, 4)

	for offset := 0; offset < 4; offset++ {
		corner := corners[(start+offset)%4]

		if corner.Longitude == 0 {
			corner.Longitude = 0
		}
		if corner.Latitude == 0 {
			corner.Latitude = 0
		}

		result = append(result, corner)
	}

	return result
}

func routeCornerBounds(
	corners []RouteCorner,
) (
	minLongitude float64,
	minLatitude float64,
	maxLongitude float64,
	maxLatitude float64,
) {
	minLongitude = corners[0].Longitude
	maxLongitude = corners[0].Longitude
	minLatitude = corners[0].Latitude
	maxLatitude = corners[0].Latitude

	for _, corner := range corners[1:] {
		minLongitude = math.Min(minLongitude, corner.Longitude)
		maxLongitude = math.Max(maxLongitude, corner.Longitude)
		minLatitude = math.Min(minLatitude, corner.Latitude)
		maxLatitude = math.Max(maxLatitude, corner.Latitude)
	}

	return
}

func NewCornerRouteArea(
	label string,
	corners []RouteCorner,
) (RouteArea, error) {
	label = strings.TrimSpace(label)

	if len([]rune(label)) < 1 || len([]rune(label)) > 100 {
		return RouteArea{}, errors.New(
			"Enter an area name between 1 and 100 characters",
		)
	}

	if err := ValidateRouteCorners(corners); err != nil {
		return RouteArea{}, err
	}

	// The identifier is independent of corner numbering and winding.
	canonical := canonicalRouteCorners(corners)

	encoded, err := json.Marshal(canonical)
	if err != nil {
		return RouteArea{}, errors.New("Cannot encode working-area corners")
	}

	sum := sha256.Sum256(encoded)

	minLongitude, minLatitude, maxLongitude, maxLatitude :=
		routeCornerBounds(corners)

	return RouteArea{
		ID:        "corners:" + hex.EncodeToString(sum[:]),
		Type:      "four_corners",
		Label:     label,
		Latitude:  (minLatitude + maxLatitude) / 2,
		Longitude: (minLongitude + maxLongitude) / 2,

		// Preserve the user's corner numbering in stored settings.
		Corners: append([]RouteCorner(nil), corners...),
	}, nil
}

func RouteAreaSearchFilter(area RouteArea) (string, error) {
	if area.Type != "four_corners" {
		return "", errors.New(
			"Save a four-corner working area first",
		)
	}

	if err := ValidateRouteCorners(area.Corners); err != nil {
		return "", err
	}

	minLongitude, minLatitude, maxLongitude, maxLatitude :=
		routeCornerBounds(area.Corners)

	format := func(value float64) string {
		return strconv.FormatFloat(value, 'f', -1, 64)
	}

	return "rect:" +
		format(minLongitude) + "," +
		format(minLatitude) + "," +
		format(maxLongitude) + "," +
		format(maxLatitude), nil
}

func RoutePointInsideArea(
	ctx context.Context,
	area RouteArea,
	longitude float64,
	latitude float64,
) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	if !finiteRouteCoordinate(longitude) ||
		!finiteRouteCoordinate(latitude) ||
		math.Abs(longitude) > 180 ||
		math.Abs(latitude) > 90 {
		return false, errors.New("Invalid location coordinates")
	}

	if area.Type != "four_corners" {
		return false, errors.New(
			"Save a four-corner working area first",
		)
	}

	if err := ValidateRouteCorners(area.Corners); err != nil {
		return false, err
	}

	point := RouteCorner{
		Longitude: longitude,
		Latitude:  latitude,
	}

	// Include locations lying on the selected outline.
	for index, first := range area.Corners {
		second := area.Corners[(index+1)%4]

		if routeCornerOnSegment(first, second, point) {
			return true, nil
		}
	}

	inside := false

	for index, first := range area.Corners {
		second := area.Corners[(index+1)%4]

		if (first.Latitude > latitude) ==
			(second.Latitude > latitude) {
			continue
		}

		intersectionLongitude := first.Longitude +
			(latitude-first.Latitude)*
				(second.Longitude-first.Longitude)/
				(second.Latitude-first.Latitude)

		if longitude < intersectionLongitude {
			inside = !inside
		}
	}

	return inside, nil
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

	switch path {
	case "/v1/geocode/search", "/v1/geocode/reverse":
	default:
		return nil, errors.New("Unsupported Geoapify endpoint")
	}

	parameters := make(url.Values, len(query)+2)

	for name, values := range query {
		parameters[name] = append([]string(nil), values...)
	}

	parameters.Set("apiKey", key)
	parameters.Set("format", "geojson")

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"https://api.geoapify.com"+path+"?"+parameters.Encode(),
		nil,
	)
	if err != nil {
		return nil, errors.New("Cannot create Geoapify request")
	}

	req.Header.Set("Accept", "application/json")

	resp, err := routeGeocodeClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		// Transport errors may contain the URL and API key.
		return nil, errors.New("Geoapify request failed")
	}
	defer resp.Body.Close()

	const maximumBytes = 4 << 20

	raw, err := io.ReadAll(
		io.LimitReader(resp.Body, maximumBytes+1),
	)
	if err != nil || len(raw) > maximumBytes {
		return nil, errors.New("Invalid Geoapify response size")
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"Geoapify endpoint %s returned HTTP %d",
			path,
			resp.StatusCode,
		)
	}

	var result struct {
		Type     string `json:"type"`
		Features []struct {
			Properties geoRouteProperties `json:"properties"`
		} `json:"features"`
	}

	if json.Unmarshal(raw, &result) != nil ||
		result.Type != "FeatureCollection" {
		return nil, errors.New(
			"Geoapify did not return a valid FeatureCollection",
		)
	}

	points := make([]geoRouteProperties, 0, len(result.Features))

	for _, feature := range result.Features {
		points = append(points, feature.Properties)
	}

	return points, nil
}