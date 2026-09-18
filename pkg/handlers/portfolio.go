package handlers

import (
	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"autoclicker/pkg/services"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
)

func GetHoldings(c *gin.Context) {
	var holdings []models.Holding
	if err := database.PortfolioDB.Order("symbol desc").Find(&holdings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, holdings)
}

func CreateHolding(c *gin.Context) {
	var holding models.Holding
	if err := c.ShouldBindJSON(&holding); err != nil {
		log.Printf("CreateHolding JSON binding error: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := database.PortfolioDB.Create(&holding).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, holding)
}

func UpdateHolding(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding ID"})
		return
	}

	var holding models.Holding
	if err := database.PortfolioDB.First(&holding, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Holding not found"})
		return
	}

	if err := c.ShouldBindJSON(&holding); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	database.PortfolioDB.Save(&holding)
	c.JSON(http.StatusOK, holding)
}

func DeleteHolding(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding ID"})
		return
	}

	if err := database.PortfolioDB.Delete(&models.Holding{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Holding not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Holding deleted"})
}

func GetPortfolioSummary(c *gin.Context) {
	var holdings []models.Holding
	if err := database.PortfolioDB.Order("symbol asc").Find(&holdings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	results := make([]models.HoldingQuote, len(holdings))
	var wg sync.WaitGroup

	for i, h := range holdings {
		wg.Add(1)
		go func(i int, h models.Holding) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results[i] = models.HoldingQuote{
						Holding:         h,
						QuoteFetchError: fmt.Sprintf("internal error fetching quote: %v", r),
					}
				}
			}()
			results[i] = buildHoldingQuote(h)
		}(i, h)
	}
	wg.Wait()

	// The bug: this used to stay an empty slice forever — totals were summed
	// from `results` directly below, but `results` itself was never assigned
	// into the response. Fixed by making Holdings just *be* results.
	summary := models.PortfolioSummary{Holdings: results}

	var totalCostUSD float64
	for _, hq := range results {
		summary.TotalValueEUR += hq.MarketValueEUR
		summary.TotalValueUSD += hq.MarketValueUSD
		summary.DayChangeAbsEUR += hq.DayGainAbsEUR
		summary.DayChangeAbsUSD += hq.DayGainAbsUSD
		summary.TotalGainAbsEUR += hq.TotalGainAbsEUR
		summary.TotalGainAbsUSD += hq.TotalGainAbsUSD
		totalCostUSD += hq.TotalCostUSD
	}

	prevTotalUSD := summary.TotalValueUSD - summary.DayChangeAbsUSD
	if prevTotalUSD > 0 {
		summary.DayChangePercent = summary.DayChangeAbsUSD / prevTotalUSD * 100
	}
	if totalCostUSD > 0 {
		summary.TotalGainPercent = summary.TotalGainAbsUSD / totalCostUSD * 100
	}

	c.JSON(http.StatusOK, summary)
}

// buildHoldingQuote fetches live data for a single holding and computes all
// derived figures. Split out so summary can run one of these per holding
// concurrently instead of blocking on Yahoo sequentially.
func buildHoldingQuote(h models.Holding) models.HoldingQuote {
	hq := models.HoldingQuote{Holding: h}

	costCurrency := h.PurchasePriceCurrency
	if costCurrency == "" {
		costCurrency = "USD"
	}
	avgUSD := h.PurchasePrice * fxOrOne(costCurrency, "USD")
	avgEUR := h.PurchasePrice * fxOrOne(costCurrency, "EUR")
	hq.AvgCostShareUSD = avgUSD
	hq.AvgCostShareEUR = avgEUR
	hq.TotalCostUSD = avgUSD * h.Shares
	hq.TotalCostEUR = avgEUR * h.Shares

	q, err := services.FetchQuote(h.Symbol)
	if err != nil {
		hq.QuoteFetchError = err.Error()
		return hq
	}

	hq.Currency = q.Currency
	hq.LastPrice = q.Price
	hq.MarketSession = q.MarketSession
	hq.MarketValue = q.Price * h.Shares

	priceUSDRate := fxOrOne(q.Currency, "USD")
	priceEURRate := fxOrOne(q.Currency, "EUR")
	hq.LastPriceUSD = q.Price * priceUSDRate
	hq.LastPriceEUR = q.Price * priceEURRate
	hq.MarketValueUSD = hq.MarketValue * priceUSDRate
	hq.MarketValueEUR = hq.MarketValue * priceEURRate

	if q.PreviousClose > 0 {
		hq.DayGainPercent = (q.Price - q.PreviousClose) / q.PreviousClose * 100
		hq.DayGainAbs = (q.Price - q.PreviousClose) * h.Shares
		hq.DayGainAbsUSD = hq.DayGainAbs * priceUSDRate
		hq.DayGainAbsEUR = hq.DayGainAbs * priceEURRate
	}

	if hq.TotalCostUSD > 0 {
		hq.TotalGainAbsUSD = hq.MarketValueUSD - hq.TotalCostUSD
		hq.TotalGainAbsEUR = hq.MarketValueEUR - hq.TotalCostEUR
		hq.TotalGainPercent = hq.TotalGainAbsUSD / hq.TotalCostUSD * 100
	}

	return hq
}

func fxOrOne(from, to string) float64 {
	rate, err := services.FetchFXRate(from, to)
	if err != nil {
		return 0
	}
	return rate
}

// GetPortfolioHistory returns combined intraday OHLC bars for the whole
// portfolio, in both USD and EUR. Each holding's series is converted using
// a single current FX rate applied across all its points (not a true
// historical rate per point) — a reasonable approximation for an intraday
// view. High/Low are summed across holdings at each bar, which is itself an
// approximation (the true portfolio high/low can occur at slightly
// different moments within the same 5-minute bar per symbol) but is
// standard practice for aggregated multi-asset bars.
func GetPortfolioHistory(c *gin.Context) {
	empty := models.PortfolioHistory{USD: []models.PortfolioPoint{}, EUR: []models.PortfolioPoint{}}

	var holdings []models.Holding
	if err := database.PortfolioDB.Find(&holdings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(holdings) == 0 {
		c.JSON(http.StatusOK, empty)
		return
	}

	type seriesInfo struct {
		points  []services.OHLCPoint
		shares  float64
		usdRate float64
		eurRate float64
		ok      bool
	}
	results := make([]seriesInfo, len(holdings))
	var wg sync.WaitGroup

	for i, h := range holdings {
		wg.Add(1)
		go func(i int, h models.Holding) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results[i] = seriesInfo{ok: false}
				}
			}()
			points, err := services.IntradaySeries(h.Symbol)
			if err != nil || len(points) == 0 {
				return
			}
			currency := "USD"
			if q, qerr := services.FetchQuote(h.Symbol); qerr == nil {
				currency = q.Currency
			}
			results[i] = seriesInfo{
				points:  points,
				shares:  h.Shares,
				usdRate: fxOrOne(currency, "USD"),
				eurRate: fxOrOne(currency, "EUR"),
				ok:      true,
			}
		}(i, h)
	}
	wg.Wait()

	var all []seriesInfo
	minLen := -1
	for _, s := range results {
		if !s.ok {
			continue
		}
		all = append(all, s)
		if minLen == -1 || len(s.points) < minLen {
			minLen = len(s.points)
		}
	}

	if len(all) == 0 || minLen <= 0 {
		c.JSON(http.StatusOK, empty)
		return
	}

	usdPoints := make([]models.PortfolioPoint, minLen)
	eurPoints := make([]models.PortfolioPoint, minLen)

	for i := 0; i < minLen; i++ {
		var oU, hU, lU, cU, oE, hE, lE, cE float64
		for _, s := range all {
			p := s.points[i]
			oU += p.Open * s.shares * s.usdRate
			hU += p.High * s.shares * s.usdRate
			lU += p.Low * s.shares * s.usdRate
			cU += p.Close * s.shares * s.usdRate
			oE += p.Open * s.shares * s.eurRate
			hE += p.High * s.shares * s.eurRate
			lE += p.Low * s.shares * s.eurRate
			cE += p.Close * s.shares * s.eurRate
		}
		ts := all[0].points[i].Timestamp
		usdPoints[i] = models.PortfolioPoint{Timestamp: ts, Open: oU, High: hU, Low: lU, Close: cU}
		eurPoints[i] = models.PortfolioPoint{Timestamp: ts, Open: oE, High: hE, Low: lE, Close: cE}
	}

	c.JSON(http.StatusOK, models.PortfolioHistory{USD: usdPoints, EUR: eurPoints})
}
