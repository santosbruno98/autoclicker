package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

var quoteHTTPClient = &http.Client{Timeout: 6 * time.Second}

type Quote struct {
	Price         float64 // "effective" last price: post/pre-market when the market is closed, matching how Robinhood/Yahoo display it
	PreviousClose float64
	Currency      string
	MarketSession string // "regular", "post", "pre"
}

func yahooRequest(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	return quoteHTTPClient.Do(req)
}

type yahooQuoteResponse struct {
	QuoteResponse struct {
		Result []struct {
			Currency                   string  `json:"currency"`
			RegularMarketPrice         float64 `json:"regularMarketPrice"`
			RegularMarketPreviousClose float64 `json:"regularMarketPreviousClose"`
			MarketState                string  `json:"marketState"`
			PostMarketPrice            float64 `json:"postMarketPrice"`
			PreMarketPrice             float64 `json:"preMarketPrice"`
		} `json:"result"`
	} `json:"quoteResponse"`
}

// FetchQuote returns the current effective price for a symbol — post/pre
// market price when the market is closed, regular session price otherwise.
// Tries Yahoo's quote endpoint first (has session data); falls back to the
// chart endpoint (regular-hours price only) if that's unavailable, since
// the quote endpoint is more prone to being rate-limited.
func FetchQuote(symbol string) (Quote, error) {
	if cached, ok := quoteCache.get(symbol); ok {
		return cached, nil
	}

	url := fmt.Sprintf("https://query1.finance.yahoo.com/v7/finance/quote?symbols=%s", symbol)
	resp, err := yahooRequest(url)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			var data yahooQuoteResponse
			if decErr := json.NewDecoder(resp.Body).Decode(&data); decErr == nil && len(data.QuoteResponse.Result) > 0 {
				r := data.QuoteResponse.Result[0]
				q := Quote{
					Price:         r.RegularMarketPrice,
					PreviousClose: r.RegularMarketPreviousClose,
					Currency:      r.Currency,
					MarketSession: "regular",
				}
				switch r.MarketState {
				case "POST", "POSTPOST":
					if r.PostMarketPrice > 0 {
						q.Price = r.PostMarketPrice
						q.MarketSession = "post"
					}
				case "PRE", "PREPRE":
					if r.PreMarketPrice > 0 {
						q.Price = r.PreMarketPrice
						q.MarketSession = "pre"
					}
				}
				quoteCache.set(symbol, q, quoteCacheTTL)
				return q, nil
			}
		}
	}

	// Fallback: chart endpoint, regular-hours price only.
	q, err := fetchQuoteViaChart(symbol)
	if err == nil {
		quoteCache.set(symbol, q, quoteCacheTTL)
	}
	return q, err
}

type chartMetaResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency           string  `json:"currency"`
				RegularMarketPrice float64 `json:"regularMarketPrice"`
				PreviousClose      float64 `json:"previousClose"`
				ChartPreviousClose float64 `json:"chartPreviousClose"`
			} `json:"meta"`
		} `json:"result"`
	} `json:"chart"`
}

func fetchQuoteViaChart(symbol string) (Quote, error) {
	url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s", symbol)
	resp, err := yahooRequest(url)
	if err != nil {
		return Quote{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Quote{}, fmt.Errorf("yahoo finance returned status %d for %s", resp.StatusCode, symbol)
	}

	var data chartMetaResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return Quote{}, err
	}
	if len(data.Chart.Result) == 0 {
		return Quote{}, fmt.Errorf("no quote data returned for %s (check the symbol is valid)", symbol)
	}
	meta := data.Chart.Result[0].Meta
	prevClose := meta.PreviousClose
	if prevClose == 0 {
		prevClose = meta.ChartPreviousClose
	}
	return Quote{
		Price:         meta.RegularMarketPrice,
		PreviousClose: prevClose,
		Currency:      meta.Currency,
		MarketSession: "regular",
	}, nil
}

// FetchFXRate returns the multiplier to convert an amount in `from` to `to`.
func FetchFXRate(from, to string) (float64, error) {
	if from == "" || to == "" || from == to {
		return 1, nil
	}
	key := from + to
	if cached, ok := fxCache.get(key); ok {
		return cached, nil
	}
	q, err := FetchQuote(from + to + "=X")
	if err == nil && q.Price > 0 {
		fxCache.set(key, q.Price, fxCacheTTL)
		return q.Price, nil
	}
	q2, err2 := FetchQuote(to + from + "=X")
	if err2 == nil && q2.Price > 0 {
		fxCache.set(key, 1/q2.Price, fxCacheTTL)
		return 1 / q2.Price, nil
	}
	if err != nil {
		return 0, err
	}
	return 0, err2
}

type OHLCPoint struct {
	Timestamp              int64
	Open, High, Low, Close float64
}

type chartOHLCResponse struct {
	Chart struct {
		Result []struct {
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open  []*float64 `json:"open"`
					High  []*float64 `json:"high"`
					Low   []*float64 `json:"low"`
					Close []*float64 `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
	} `json:"chart"`
}

// IntradaySeries returns OHLC bars for a symbol over the current trading day.
func IntradaySeries(symbol string) ([]OHLCPoint, error) {
	if cached, ok := intradayCache.get(symbol); ok {
		return cached, nil
	}

	url := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1d&interval=5m", symbol)
	resp, err := yahooRequest(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo finance returned status %d for %s", resp.StatusCode, symbol)
	}

	var data chartOHLCResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	if len(data.Chart.Result) == 0 || len(data.Chart.Result[0].Indicators.Quote) == 0 {
		return nil, fmt.Errorf("no intraday series for %s", symbol)
	}

	result := data.Chart.Result[0]
	q := result.Indicators.Quote[0]

	var points []OHLCPoint
	for i := range q.Close {
		if i >= len(result.Timestamp) || q.Open[i] == nil || q.High[i] == nil || q.Low[i] == nil || q.Close[i] == nil {
			continue
		}
		points = append(points, OHLCPoint{
			Timestamp: result.Timestamp[i],
			Open:      *q.Open[i],
			High:      *q.High[i],
			Low:       *q.Low[i],
			Close:     *q.Close[i],
		})
	}
	intradayCache.set(symbol, points, intradayCacheTTL)
	return points, nil
}
