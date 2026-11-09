package handlers

import (
	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"autoclicker/pkg/services"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"sync"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const portfolioWorkerCount = 8

func GetHoldings(c *gin.Context) {
	holdings := make([]models.Holding, 0)
	err := database.PortfolioDB.WithContext(c.Request.Context()).
		Where("trade_request_id IS NULL").
		Order("symbol desc").
		Find(&holdings).Error
	if err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load holdings"})
		return
	}
	c.JSON(http.StatusOK, holdings)
}

func CreateHolding(c *gin.Context) {
	var holding models.Holding
	if c.ShouldBindJSON(&holding) != nil || !validLegacyHolding(&holding) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding"})
		return
	}

	holding.ID = 0
	holding.Side = models.TradeBuy

	err := withPortfolioWrite(c, func(tx *gorm.DB) error {
		if err := tx.Create(&holding).Error; err != nil {
			return err
		}
		return validatePortfolioSymbol(tx, holding.Symbol)
	})
	if err != nil {
		writePortfolioError(c, err)
		return
	}
	c.JSON(http.StatusOK, holding)
}

func UpdateHolding(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding ID"})
		return
	}

	var holding models.Holding
	invalidInput := false

	err = withPortfolioWrite(c, func(tx *gorm.DB) error {
		if err := tx.Where("trade_request_id IS NULL").First(&holding, id).Error; err != nil {
			return err
		}

		previousSymbol := normalizePortfolioSymbol(holding.Symbol)
		originalID := holding.ID
		if err := c.ShouldBindJSON(&holding); err != nil {
			invalidInput = true
			return err
		}
		holding.ID = originalID
		holding.Side = models.TradeBuy

		if !validLegacyHolding(&holding) {
			invalidInput = true
			return fmt.Errorf("invalid holding")
		}

		if err := tx.Save(&holding).Error; err != nil {
			return err
		}
		if err := validatePortfolioSymbol(tx, previousSymbol); err != nil {
			return err
		}
		if holding.Symbol != previousSymbol {
			return validatePortfolioSymbol(tx, holding.Symbol)
		}
		return nil
	})

	if invalidInput {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding"})
		return
	}
	if err != nil {
		writePortfolioError(c, err)
		return
	}
	c.JSON(http.StatusOK, holding)
}

func DeleteHolding(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid holding ID"})
		return
	}

	err = withPortfolioWrite(c, func(tx *gorm.DB) error {
		var holding models.Holding
		if err := tx.Where("trade_request_id IS NULL").First(&holding, id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&holding).Error; err != nil {
			return err
		}
		return validatePortfolioSymbol(tx, normalizePortfolioSymbol(holding.Symbol))
	})
	if err != nil {
		writePortfolioError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Holding deleted"})
}

func GetPortfolioSummary(c *gin.Context) {
	db := database.PortfolioDB.WithContext(c.Request.Context())
	groups, err := portfolioTradeGroups(db)
	if err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load portfolio trades"})
		return
	}

	positions := make([]models.Holding, 0, len(groups))
	costs := make([]models.PositionCost, 0, len(groups))
	costErrors := make([]error, 0, len(groups))
	estimates := make([]bool, 0, len(groups))
	rates := make(map[string]*big.Rat)

	for _, trades := range groups {
		shares, err := portfolioShareBalance(trades, "")
		if err != nil {
			c.Error(err)
			c.JSON(http.StatusConflict, gin.H{"error": "Portfolio contains an invalid trade history"})
			return
		}

		cost, estimated, costErr := portfolioPositionCost(trades, rates)
		position := models.Holding{
			ID:                    trades[0].ID,
			Symbol:                trades[0].Symbol,
			Shares:                shares,
			PurchasePriceCurrency: "USD",
		}
		if costErr == nil {
			position.PurchasePrice, _ = cost.AverageCost.Float64()
		}

		positions = append(positions, position)
		costs = append(costs, cost)
		costErrors = append(costErrors, costErr)
		estimates = append(estimates, estimated)
	}

	results := processHoldingQuotes(positions)
	summary := models.PortfolioSummary{Holdings: results}
	var totalCostUSD float64

	for i := range results {
		row := &results[i]
		trades := groups[i]
		row.Transactions = make([]models.PortfolioTradeView, 0, len(trades))
		row.EstimatedCostBasis = estimates[i]
		summary.EstimatedCostBasis = summary.EstimatedCostBasis || estimates[i]

		for j := len(trades) - 1; j >= 0; j-- {
			trade := trades[j]
			view := models.PortfolioTradeView{
				ID:        trade.ID,
				Side:      portfolioTradeSide(trade),
				Date:      portfolioTradeDay(trade),
				Shares:    trade.Shares,
				UnitPrice: trade.PurchasePrice,
				Currency:  portfolioTradeCurrency(trade),
			}
			if gain := costs[i].RealizedByTrade[trade.ID]; gain != nil {
				amount, _ := gain.Float64()
				view.RealizedGainAbsUSD = &amount
			}
			row.Transactions = append(row.Transactions, view)
		}

		summary.TotalValueEUR += row.MarketValueEUR
		summary.TotalValueUSD += row.MarketValueUSD
		summary.DayChangeAbsEUR += row.DayGainAbsEUR
		summary.DayChangeAbsUSD += row.DayGainAbsUSD

		if costErrors[i] != nil {
			row.CostBasisError = costErrors[i].Error()
			row.TotalGainAbsUSD = 0
			row.TotalGainAbsEUR = 0
			row.TotalGainPercent = 0
			summary.CostBasisIncomplete = true
			continue
		}

		realized, _ := costs[i].RealizedGain.Float64()
		row.RealizedGainAbsUSD = &realized
		summary.RealizedGainAbsUSD += realized

		if row.Shares == 0 {
			continue
		}
		if row.QuoteFetchError != "" {
			summary.CostBasisIncomplete = true
			continue
		}

		summary.TotalGainAbsEUR += row.TotalGainAbsEUR
		summary.TotalGainAbsUSD += row.TotalGainAbsUSD
		totalCostUSD += row.TotalCostUSD
	}

	previousValueUSD := summary.TotalValueUSD - summary.DayChangeAbsUSD
	if previousValueUSD > 0 {
		summary.DayChangePercent = summary.DayChangeAbsUSD / previousValueUSD * 100
	}
	if totalCostUSD > 0 {
		summary.TotalGainPercent = summary.TotalGainAbsUSD / totalCostUSD * 100
	}

	var settings models.PortfolioSettings
	if err := db.FirstOrCreate(&settings, models.PortfolioSettings{ID: 1}).Error; err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load portfolio settings"})
		return
	}
	summary.BuyingPower = settings.BuyingPower

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

	priceUSDRate := fxOrOne(q.Currency, "USD")
	priceEURRate := fxOrOne(q.Currency, "EUR")
	if q.Currency == "" || priceUSDRate <= 0 || priceEURRate <= 0 {
		hq.QuoteFetchError = "Quote currency or exchange rate unavailable"
		return hq
	}

	hq.Currency = q.Currency
	hq.LastPrice = q.Price
	hq.MarketSession = q.MarketSession
	hq.MarketValue = q.Price * h.Shares
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

	hq.TotalGainAbsUSD = hq.MarketValueUSD - hq.TotalCostUSD
	hq.TotalGainAbsEUR = hq.MarketValueEUR - hq.TotalCostEUR
	if hq.TotalCostUSD > 0 {
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

func min(a, b int) int {
	if a < b {
		return a
	}

	return b
}

func processHoldingQuotes(
	holdings []models.Holding,
) []models.HoldingQuote {
	results := make([]models.HoldingQuote, len(holdings))

	jobs := make(chan int)

	var wg sync.WaitGroup

	workerCount := min(
		portfolioWorkerCount,
		len(holdings),
	)

	wg.Add(workerCount)

	for worker := 0; worker < workerCount; worker++ {
		go func() {
			defer wg.Done()

			for index := range jobs {
				holding := holdings[index]

				func() {
					defer func() {
						if recovered := recover(); recovered != nil {
							results[index] = models.HoldingQuote{
								Holding: holding,
								QuoteFetchError: fmt.Sprintf(
									"internal error fetching quote: %v",
									recovered,
								),
							}
						}
					}()

					results[index] = buildHoldingQuote(holding)
				}()
			}
		}()
	}

	for index := range holdings {
		jobs <- index
	}

	close(jobs)

	wg.Wait()

	return results
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

		groups, err := portfolioTradeGroups(
		database.PortfolioDB.WithContext(c.Request.Context()),
	)
	if err != nil {
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load portfolio trades"})
		return
	}

	holdings := make([]models.Holding, 0, len(groups))
	for _, trades := range groups {
		shares, err := portfolioShareBalance(trades, "")
		if err != nil {
			c.Error(err)
			c.JSON(http.StatusConflict, gin.H{"error": "Portfolio contains an invalid trade history"})
			return
		}
		if shares > 0 {
			holdings = append(holdings, models.Holding{
				Symbol: trades[0].Symbol,
				Shares: shares,
			})
		}
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
			// Offset index from the end to align recent timestamps
			offset := len(s.points) - minLen + i
			p := s.points[offset]

			oU += p.Open * s.shares * s.usdRate
			hU += p.High * s.shares * s.usdRate
			lU += p.Low * s.shares * s.usdRate
			cU += p.Close * s.shares * s.usdRate
			oE += p.Open * s.shares * s.eurRate
			hE += p.High * s.shares * s.eurRate
			lE += p.Low * s.shares * s.eurRate
			cE += p.Close * s.shares * s.eurRate
		}
		ts := all[0].points[len(all[0].points)-minLen+i].Timestamp
		usdPoints[i] = models.PortfolioPoint{Timestamp: ts, Open: oU, High: hU, Low: lU, Close: cU}
		eurPoints[i] = models.PortfolioPoint{Timestamp: ts, Open: oE, High: hE, Low: lE, Close: cE}
	}

	c.JSON(http.StatusOK, models.PortfolioHistory{USD: usdPoints, EUR: eurPoints})
}

// GetBuyingPower handles GET /api/portfolio/buying-power
func GetBuyingPower(c *gin.Context) {
	var settings models.PortfolioSettings
	if err := database.PortfolioDB.FirstOrCreate(&settings, models.PortfolioSettings{ID: 1}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, settings)
}

// UpdateBuyingPower handles PUT /api/portfolio/buying-power
func UpdateBuyingPower(c *gin.Context) {
	var req struct {
		BuyingPower float64 `json:"buying_power"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var settings models.PortfolioSettings
	database.PortfolioDB.FirstOrCreate(&settings, models.PortfolioSettings{ID: 1})
	settings.BuyingPower = req.BuyingPower

	if err := database.PortfolioDB.Save(&settings).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, settings)
}
