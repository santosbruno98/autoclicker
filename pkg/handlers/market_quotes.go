package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
)

type marketQuoteResponse struct {
	Price         float64 `json:"price"`
	PreviousClose float64 `json:"previous_close"`
	Currency      string  `json:"currency"`
	MarketSession string  `json:"market_session"`
}

func GetMarketQuotes(c *gin.Context) {
	rawSymbols := c.Query("symbols")

	if strings.TrimSpace(rawSymbols) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "symbols query parameter is required",
		})
		return
	}

	// Remove duplicates and normalize ticker symbols.
	seen := make(map[string]struct{})
	symbols := make([]string, 0)

	for _, value := range strings.Split(rawSymbols, ",") {
		symbol := strings.ToUpper(strings.TrimSpace(value))

		if symbol == "" {
			continue
		}

		if _, exists := seen[symbol]; exists {
			continue
		}

		seen[symbol] = struct{}{}
		symbols = append(symbols, symbol)
	}

	if len(symbols) == 0 || len(symbols) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "provide between 1 and 50 unique symbols",
		})
		return
	}

	quotes := make(map[string]marketQuoteResponse)
	errors := make(map[string]string)

	var mutex sync.Mutex
	var wg sync.WaitGroup

	// Limit simultaneous requests to Yahoo.
	semaphore := make(chan struct{}, 5)

	for _, symbol := range symbols {
		wg.Add(1)

		go func(symbol string) {
			defer wg.Done()

			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			quote, err := services.FetchQuote(symbol)

			mutex.Lock()
			defer mutex.Unlock()

			if err != nil {
				errors[symbol] = err.Error()
				return
			}

			quotes[symbol] = marketQuoteResponse{
				Price:         quote.Price,
				PreviousClose: quote.PreviousClose,
				Currency:      quote.Currency,
				MarketSession: quote.MarketSession,
			}
		}(symbol)
	}

	wg.Wait()

	c.JSON(http.StatusOK, gin.H{
		"quotes":    quotes,
		"errors":    errors,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
