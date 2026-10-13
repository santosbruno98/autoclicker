package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
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
	var holdings []models.Holding

	if err := database.PortfolioDB.
		Order("symbol asc").
		Find(&holdings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to load portfolio holdings",
		})
		return
	}

	forceRefresh := c.Query("refresh") == "true"

	usdToEUR, fxErr := services.FetchFXRate("USD", "EUR")

	response := PortfolioDividendEstimate{
		Holdings:     make([]HoldingDividendEstimate, len(holdings)),
		TaxRate:      estimatedPortugueseDividendTaxRate,
		FXUSDToEUR:   usdToEUR,
		Complete:     true,
		CalculatedAt: time.Now().UTC(),
	}

	var wg sync.WaitGroup

	// Bound concurrency to avoid excessive Yahoo requests.
	limit := make(chan struct{}, 4)

	for i, holding := range holdings {
		wg.Add(1)

		go func(index int, h models.Holding) {
			defer wg.Done()

			limit <- struct{}{}
			defer func() { <-limit }()

			result := HoldingDividendEstimate{
				HoldingID: h.ID,
				Symbol:    h.Symbol,
				Shares:    h.Shares,
				Events:    []services.DividendEvent{},
			}

			if h.PurchaseDate == nil {
				result.Error = "Purchase date is missing"
				response.Holdings[index] = result
				return
			}

			result.PurchaseDate = h.PurchaseDate.Format("2006-01-02")

			if h.Shares <= 0 {
				result.Error = "No shares held"
				response.Holdings[index] = result
				return
			}

			// Yahoo quote currency is the currency of
			// the security's quoted dividend history.
			quote, err := services.FetchQuote(h.Symbol)
			if err != nil {
				result.Error = "Quote unavailable: " + err.Error()
				response.Holdings[index] = result
				return
			}

			result.Currency = strings.ToUpper(quote.Currency)

			if result.Currency != "EUR" &&
				result.Currency != "USD" {
				result.Error = "Unsupported dividend currency: " +
					result.Currency
				response.Holdings[index] = result
				return
			}

			events, err := services.FetchDividendHistory(
				h.Symbol,
				*h.PurchaseDate,
				forceRefresh,
			)

			if err != nil {
				result.Error = err.Error()
				response.Holdings[index] = result
				return
			}

			result.Events = events
			result.EventsCount = len(events)

			for _, event := range events {
				result.GrossOriginal +=
					event.AmountPerShare * h.Shares
			}

			rate := 1.0

			if result.Currency == "USD" {
				if fxErr != nil || usdToEUR <= 0 {
					result.Error = "USD/EUR exchange rate unavailable"
					response.Holdings[index] = result
					return
				}
				rate = usdToEUR
			}

			result.GrossEUR = result.GrossOriginal * rate

			result.EstimatedTaxEUR =
				result.GrossEUR * estimatedPortugueseDividendTaxRate

			result.EstimatedNetEUR =
				result.GrossEUR - result.EstimatedTaxEUR

			response.Holdings[index] = result
		}(i, holding)
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
