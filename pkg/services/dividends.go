package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

type DividendEvent struct {
	ExDate         string  `json:"ex_date"`
	AmountPerShare float64 `json:"amount_per_share"`
}

type yahooDividend struct {
	Amount float64 `json:"amount"`
	Date   int64   `json:"date"`
}

type yahooDividendResponse struct {
	Chart struct {
		Result []struct {
			Events struct {
				Dividends map[string]yahooDividend `json:"dividends"`
			} `json:"events"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}

type dividendCacheEntry struct {
	Events    []DividendEvent
	ExpiresAt time.Time
}

var dividendCache = struct {
	sync.RWMutex
	Items map[string]dividendCacheEntry
}{
	Items: make(map[string]dividendCacheEntry),
}

var dividendHTTPClient = &http.Client{
	Timeout: 12 * time.Second,
}

// FetchDividendHistory returns historical ex-dividend events
// since the requested purchase date.
//
// Yahoo's data is not evidence of actual broker payment.
func FetchDividendHistory(
	symbol string,
	purchaseDate time.Time,
	forceRefresh bool,
) ([]DividendEvent, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))

	if symbol == "" {
		return nil, errors.New("empty ticker symbol")
	}

	if purchaseDate.IsZero() {
		return nil, errors.New("purchase date is required")
	}

	start := purchaseDate.UTC().Truncate(24 * time.Hour)
	now := time.Now().UTC()

	if start.After(now) {
		return []DividendEvent{}, nil
	}

	key := fmt.Sprintf("%s:%s",
		symbol, start.Format("2006-01-02"))

	if !forceRefresh {
		dividendCache.RLock()
		entry, exists := dividendCache.Items[key]
		dividendCache.RUnlock()

		if exists && now.Before(entry.ExpiresAt) {
			return append([]DividendEvent(nil), entry.Events...), nil
		}
	}

	// period2 is exclusive, so use tomorrow.
	end := now.Add(24 * time.Hour)

	endpoint := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s",
		url.PathEscape(symbol),
	)

	params := url.Values{}
	params.Set("period1", fmt.Sprintf("%d", start.Unix()))
	params.Set("period2", fmt.Sprintf("%d", end.Unix()))
	params.Set("interval", "1d")
	params.Set("events", "div")

	request, err := http.NewRequest(
		http.MethodGet,
		endpoint+"?"+params.Encode(),
		nil,
	)
	if err != nil {
		return nil, err
	}

	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.Header.Set("Accept", "application/json")

	response, err := dividendHTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Yahoo request failed: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf(
			"Yahoo returned HTTP %d for %s",
			response.StatusCode, symbol,
		)
	}

	body := io.LimitReader(response.Body, 8*1024*1024)

	var payload yahooDividendResponse
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("invalid Yahoo response: %w", err)
	}

	if payload.Chart.Error != nil {
		return nil, fmt.Errorf(
			"Yahoo: %s",
			payload.Chart.Error.Description,
		)
	}

	if len(payload.Chart.Result) == 0 {
		return nil, errors.New("Yahoo returned no chart result")
	}

	events := make([]DividendEvent, 0)
	seen := make(map[int64]bool)

	for _, dividend := range payload.Chart.Result[0].Events.Dividends {
		if dividend.Amount <= 0 {
			continue
		}

		eventDate := time.Unix(
			dividend.Date, 0,
		).UTC().Format("2006-01-02")

		if eventDate < start.Format("2006-01-02") ||
			eventDate > now.Format("2006-01-02") {
			continue
		}

		if seen[dividend.Date] {
			continue
		}
		seen[dividend.Date] = true

		events = append(events, DividendEvent{
			ExDate:         eventDate,
			AmountPerShare: dividend.Amount,
		})
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].ExDate < events[j].ExDate
	})

	dividendCache.Lock()
	dividendCache.Items[key] = dividendCacheEntry{
		Events:    events,
		ExpiresAt: time.Now().Add(6 * time.Hour),
	}
	dividendCache.Unlock()

	return append([]DividendEvent(nil), events...), nil
}
