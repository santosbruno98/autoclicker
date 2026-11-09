package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"autoclicker/pkg/database"
	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
)

const estimatedPortugueseDividendTaxRate = 0.28

type HoldingDividendEstimate struct {
	HoldingID    uint    `json:"holding_id"`
	Symbol       string  `json:"symbol"`
	PurchaseDate string  `json:"purchase_date"`
	Shares       float64 `json:"shares"`
	Currency     string  `json:"currency"`
	EventsCount  int     `json:"events_count"`

	GrossOriginal   float64 `json:"gross_original"`
	GrossEUR        float64 `json:"gross_eur"`
	EstimatedTaxEUR float64 `json:"estimated_tax_eur"`
	EstimatedNetEUR float64 `json:"estimated_net_eur"`

	Events []services.DividendEvent `json:"events"`
	Error  string                   `json:"error,omitempty"`
}

type PortfolioDividendEstimate struct {
	Holdings []HoldingDividendEstimate `json:"holdings"`

	GrossEUR        float64 `json:"gross_eur"`
	EstimatedTaxEUR float64 `json:"estimated_tax_eur"`
	EstimatedNetEUR float64 `json:"estimated_net_eur"`

	TaxRate    float64 `json:"tax_rate"`
	FXUSDToEUR float64 `json:"fx_usd_to_eur"`

	Complete     bool      `json:"complete"`
	CalculatedAt time.Time `json:"calculated_at"`
}

func GetPortfolioDividends(c *gin.Context) {
	groups, err := portfolioTradeGroups(
		database.PortfolioDB.WithContext(c.Request.Context()),
	)
	if err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to load portfolio trades",
		})
		return
	}

	forceRefresh := c.Query("refresh") == "true"

	usdToEUR, fxErr := services.FetchFXRate("USD", "EUR")

	response := PortfolioDividendEstimate{
		Holdings:     make([]HoldingDividendEstimate, len(groups)),
		TaxRate:      estimatedPortugueseDividendTaxRate,
		FXUSDToEUR:   usdToEUR,
		Complete:     true,
		CalculatedAt: time.Now().UTC(),
	}

	var wg sync.WaitGroup

	// Bound concurrency to avoid excessive Yahoo requests.
	limit := make(chan struct{}, 4)

	for i, trades := range groups {
		wg.Add(1)

		go func() {
			defer wg.Done()

			limit <- struct{}{}
			defer func() { <-limit }()

			first := trades[0]
			result := HoldingDividendEstimate{
				HoldingID:    first.ID,
				Symbol:       first.Symbol,
				PurchaseDate: portfolioTradeDay(first),
				Events:       []services.DividendEvent{},
			}
			defer func() { response.Holdings[i] = result }()

			if result.PurchaseDate == "" {
				result.Error = "An opening purchase date is missing"
				return
			}

			shares, err := portfolioShareBalance(trades, "")
			if err != nil {
				result.Error = err.Error()
				return
			}
			result.Shares = shares

			quote, err := services.FetchQuote(first.Symbol)
			if err != nil {
				result.Error = "Quote unavailable: " + err.Error()
				return
			}
			result.Currency = strings.ToUpper(quote.Currency)
			if result.Currency != "EUR" && result.Currency != "USD" {
				result.Error = "Unsupported dividend currency: " + result.Currency
				return
			}

			events, err := services.FetchDividendHistory(
				first.Symbol, *first.PurchaseDate, forceRefresh,
			)
			if err != nil {
				result.Error = err.Error()
				return
			}

			for _, event := range events {
				// Use the balance before the ex-date. A purchase entered on
				// the ex-date does not contribute to this estimate.
				eligibleShares, err := portfolioShareBalance(trades, event.ExDate)
				if err != nil {
					result.Error = err.Error()
					return
				}
				if eligibleShares > 0 {
					result.Events = append(result.Events, event)
					result.GrossOriginal += event.AmountPerShare * eligibleShares
				}
			}
			result.EventsCount = len(result.Events)

			rate := 1.0
			if result.Currency == "USD" {
				if fxErr != nil || usdToEUR <= 0 {
					result.Error = "USD/EUR exchange rate unavailable"
					return
				}
				rate = usdToEUR
			}

			result.GrossEUR = result.GrossOriginal * rate
			result.EstimatedTaxEUR = result.GrossEUR * estimatedPortugueseDividendTaxRate
			result.EstimatedNetEUR = result.GrossEUR - result.EstimatedTaxEUR
		}()
	}

	wg.Wait()

	for _, result := range response.Holdings {
		if result.Error != "" {
			response.Complete = false
			continue
		}

		response.GrossEUR += result.GrossEUR
		response.EstimatedTaxEUR += result.EstimatedTaxEUR
		response.EstimatedNetEUR += result.EstimatedNetEUR
	}

	c.JSON(http.StatusOK, response)
}
