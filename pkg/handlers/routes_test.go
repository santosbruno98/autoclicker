package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func routingTestPayload() CloudRouteRequest {
	return CloudRouteRequest{
		// Guarda sample points: longitude, latitude.
		Coordinates: [][2]float64{
			{-7.268, 40.537},
			{-7.265, 40.540},
			{-7.260, 40.545},
		},
		RoundTrip: false,
	}
}

func TestRequestOptimizationWithoutAPIKey(t *testing.T) {
	payload := routingTestPayload()

	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost || r.URL.Path != "/optimize" {
				t.Error("expected POST /optimize")
				w.WriteHeader(http.StatusNotFound)
				return
			}

			if r.Header.Get("Authorization") != "" {
				t.Error("client must not send a custom bearer credential")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			if r.Header.Get("Content-Type") != "application/json" {
				t.Error("expected application/json")
				w.WriteHeader(http.StatusUnsupportedMediaType)
				return
			}

			var received CloudRouteRequest
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
				t.Errorf("invalid request JSON: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			if len(received.Coordinates) != len(payload.Coordinates) {
				t.Error("incorrect coordinate count")
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			for index, point := range payload.Coordinates {
				if received.Coordinates[index] != point {
					t.Errorf(
						"point %d changed; expected longitude/latitude order",
						index,
					)
				}
			}

			if received.RoundTrip != payload.RoundTrip {
				t.Error("round_trip changed")
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(CloudRouteResponse{
				Order:     []int{0, 2, 1},
				DistanceM: 2400,
				DurationS: 300,
			})
		},
	))
	defer server.Close()

	t.Setenv("ROUTING_SERVICE_URL", " "+server.URL+"/ ")
	t.Setenv("ROUTING_API_KEY", "")

	result, err := requestOptimization(context.Background(), payload)
	if err != nil {
		t.Fatalf("request failed without an API key: %v", err)
	}

	if !validOptimization(result, len(payload.Coordinates)) {
		t.Fatalf("invalid optimization: %+v", result)
	}
}

func TestRequestOptimizationInvalidConfiguration(t *testing.T) {
	for _, endpoint := range []string{
		"",
		"not-a-url",
		"ftp://routing.example",
		"https://routing.example?key=unexpected",
	} {
		t.Run(endpoint, func(t *testing.T) {
			t.Setenv("ROUTING_SERVICE_URL", endpoint)

			_, err := requestOptimization(
				context.Background(),
				routingTestPayload(),
			)
			if err == nil {
				t.Fatal("expected a configuration error")
			}
		})
	}
}

func TestRequestOptimizationRejectsBadResponses(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{
			name:   "upstream unauthorized",
			status: http.StatusUnauthorized,
			body:   `{"detail":"Unauthorized"}`,
		},
		{
			name:   "invalid JSON",
			status: http.StatusOK,
			body:   "<html>bad response</html>",
		},
		{
			name:   "missing metrics",
			status: http.StatusOK,
			body:   `{"order":[0,1,2]}`,
		},
		{
			name:   "duplicate stop",
			status: http.StatusOK,
			body:   `{"order":[0,1,1],"distance_m":100,"duration_s":20}`,
		},
		{
			name:   "wrong origin",
			status: http.StatusOK,
			body:   `{"order":[1,0,2],"distance_m":100,"duration_s":20}`,
		},
		{
			name:   "negative distance",
			status: http.StatusOK,
			body:   `{"order":[0,1,2],"distance_m":-1,"duration_s":20}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(test.status)
					_, _ = w.Write([]byte(test.body))
				},
			))
			defer server.Close()

			t.Setenv("ROUTING_SERVICE_URL", server.URL)

			_, err := requestOptimization(
				context.Background(),
				routingTestPayload(),
			)
			if err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestRequestOptimizationCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, r *http.Request) {
			t.Error("cancelled request reached the server")
		},
	))
	defer server.Close()

	t.Setenv("ROUTING_SERVICE_URL", server.URL)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := requestOptimization(ctx, routingTestPayload())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation; got %v", err)
	}
}

func TestRoutingLive(t *testing.T) {
	endpoint := strings.TrimSpace(os.Getenv("ROUTING_TEST_URL"))
	if endpoint == "" {
		t.Skip("live check disabled; use scripts/test-routing.ps1")
	}

	t.Setenv("ROUTING_SERVICE_URL", endpoint)
	t.Setenv("ROUTING_API_KEY", "")

	for _, roundTrip := range []bool{false, true} {
		name := "open journey"
		if roundTrip {
			name = "return to origin"
		}

		t.Run(name, func(t *testing.T) {
			payload := routingTestPayload()
			payload.RoundTrip = roundTrip

			ctx, cancel := context.WithTimeout(
				context.Background(),
				180*time.Second,
			)
			defer cancel()

			started := time.Now()
			result, err := requestOptimization(ctx, payload)
			if err != nil {
				t.Fatalf("FastAPI/VROOM/OSRM check failed: %v", err)
			}

			if !validOptimization(result, len(payload.Coordinates)) {
				t.Fatalf("invalid optimized route: %+v", result)
			}

			// These sample locations are distinct.
			if result.DistanceM <= 0 || result.DurationS <= 0 {
				t.Fatal("expected positive distance and duration")
			}

			t.Logf(
				"order=%v distance=%.0fm duration=%.0fs elapsed=%s",
				result.Order,
				result.DistanceM,
				result.DurationS,
				time.Since(started).Round(time.Millisecond),
			)
		})
	}

	t.Run("reject invalid coordinate count", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(
			context.Background(),
			30*time.Second,
		)
		defer cancel()

		req, err := http.NewRequestWithContext(
			ctx,
			http.MethodPost,
			strings.TrimRight(endpoint, "/")+"/optimize",
			strings.NewReader(
				`{"coordinates":[[-7.268,40.537]],"round_trip":false}`,
			),
		)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")

		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()

		if response.StatusCode != http.StatusUnprocessableEntity {
			t.Fatalf(
				"expected validation HTTP 422; got %d",
				response.StatusCode,
			)
		}
	})
}
