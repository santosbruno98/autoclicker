package handlers

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var (
	portfolioTicker = regexp.MustCompile(`^[A-Z0-9^][A-Z0-9.^=-]{0,9}$`)
	tradeDecimal    = regexp.MustCompile(`^[0-9]{1,7}(\.[0-9]{1,7})?$`)
	tradeFXDecimal  = regexp.MustCompile(`^[0-9]{1,7}(\.[0-9]{1,12})?$`)
	tradeUUID       = regexp.MustCompile(
		`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
	)
	errTradeRequestConflict = errors.New("request ID already belongs to another trade")

	// The previous editor saved local midnight as a timestamp. Use Lisbon
	// dates so those timestamps keep their intended trading day.
	portfolioLocation, _ = time.LoadLocation("Europe/Lisbon")
)

func normalizePortfolioSymbol(symbol string) string {
	return strings.ToUpper(strings.TrimSpace(symbol))
}

func portfolioTradeDay(trade models.Holding) string {
	if trade.PurchaseDate == nil {
		return ""
	}
	return trade.PurchaseDate.In(portfolioLocation).Format(time.DateOnly)
}

func portfolioTradeSide(trade models.Holding) models.TradeSide {
	if trade.Side == "" {
		return models.TradeBuy
	}
	return trade.Side
}

func portfolioTradeCurrency(trade models.Holding) string {
	currency := strings.ToUpper(strings.TrimSpace(trade.PurchasePriceCurrency))
	if currency == "" {
		return "USD"
	}
	return currency
}

func portfolioDecimal(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func sortPortfolioTrades(trades []models.Holding) {
	sort.Slice(trades, func(i, j int) bool {
		left, right := portfolioTradeDay(trades[i]), portfolioTradeDay(trades[j])
		if left == right {
			return trades[i].ID < trades[j].ID
		}
		return left < right
	})
}

func portfolioTradeGroups(db *gorm.DB) ([][]models.Holding, error) {
	var rows []models.Holding
	if err := db.Find(&rows).Error; err != nil {
		return nil, err
	}

	bySymbol := make(map[string][]models.Holding)
	for _, row := range rows {
		row.Symbol = normalizePortfolioSymbol(row.Symbol)
		bySymbol[row.Symbol] = append(bySymbol[row.Symbol], row)
	}

	symbols := make([]string, 0, len(bySymbol))
	for symbol := range bySymbol {
		symbols = append(symbols, symbol)
	}
	sort.Strings(symbols)

	groups := make([][]models.Holding, 0, len(symbols))
	for _, symbol := range symbols {
		trades := bySymbol[symbol]
		sortPortfolioTrades(trades)
		groups = append(groups, trades)
	}
	return groups, nil
}

// A nonempty beforeDay excludes trades on or after that date.
func portfolioShareBalance(trades []models.Holding, beforeDay string) (float64, error) {
	balance := new(big.Rat)

	for _, trade := range trades {
		if beforeDay != "" && portfolioTradeDay(trade) >= beforeDay {
			break
		}

		shares, ok := new(big.Rat).SetString(portfolioDecimal(trade.Shares))
		if !ok || shares.Sign() <= 0 {
			return 0, fmt.Errorf("trade %d has an invalid share quantity", trade.ID)
		}

		switch portfolioTradeSide(trade) {
		case models.TradeBuy:
			balance.Add(balance, shares)
		case models.TradeSell:
			if balance.Cmp(shares) < 0 {
				return 0, fmt.Errorf(
					"%s sale on %s: %w",
					trade.Symbol, portfolioTradeDay(trade), models.ErrInsufficientShares,
				)
			}
			balance.Sub(balance, shares)
		default:
			return 0, fmt.Errorf("trade %d has an invalid side", trade.ID)
		}
	}

	shares, _ := balance.Float64()
	return shares, nil
}

func validatePortfolioSymbol(tx *gorm.DB, symbol string) error {
	var trades []models.Holding
	if err := tx.Where("upper(btrim(symbol)) = ?", symbol).Find(&trades).Error; err != nil {
		return err
	}

	sortPortfolioTrades(trades)
	_, err := portfolioShareBalance(trades, "")
	return err
}

func withPortfolioWrite(c *gin.Context, write func(*gorm.DB) error) error {
	return database.PortfolioDB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Serialize writes, including legacy edits, while replaying trade history.
		// Ordinary reads can continue during this transaction.
		if err := tx.Exec("LOCK TABLE holdings IN SHARE ROW EXCLUSIVE MODE").Error; err != nil {
			return err
		}
		return write(tx)
	})
}

func writePortfolioError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Holding not found"})
	case errors.Is(err, models.ErrInsufficientShares),
		errors.Is(err, errTradeRequestConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.Error(err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save portfolio change"})
	}
}

func CreatePortfolioTrade(c *gin.Context) {
	var input struct {
		RequestID          string           `json:"request_id"`
		Symbol             string           `json:"symbol"`
		Side               models.TradeSide `json:"side"`
		Date               string           `json:"date"`
		Shares             string           `json:"shares"`
		UnitPrice          string           `json:"unit_price"`
		Currency           string           `json:"currency"`
		USDPerCurrencyUnit string           `json:"usd_per_currency_unit"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid trade payload"})
		return
	}

	input.Symbol = normalizePortfolioSymbol(input.Symbol)
	input.RequestID = strings.ToLower(strings.TrimSpace(input.RequestID))
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.Shares = strings.TrimSpace(input.Shares)
	input.UnitPrice = strings.TrimSpace(input.UnitPrice)
	input.USDPerCurrencyUnit = strings.TrimSpace(input.USDPerCurrencyUnit)

	if !portfolioTicker.MatchString(input.Symbol) || !tradeUUID.MatchString(input.RequestID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A valid ticker and request ID are required"})
		return
	}
	if input.Side != models.TradeBuy && input.Side != models.TradeSell {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Side must be buy or sell"})
		return
	}

	date, err := time.ParseInLocation(time.DateOnly, input.Date, portfolioLocation)
	if err != nil || input.Date > time.Now().In(portfolioLocation).Format(time.DateOnly) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a trade date that is today or earlier"})
		return
	}

	if !tradeDecimal.MatchString(input.Shares) || !tradeDecimal.MatchString(input.UnitPrice) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Shares and price must have up to seven digits before and after the decimal",
		})
		return
	}

	shares, _ := strconv.ParseFloat(input.Shares, 64)
	price, _ := strconv.ParseFloat(input.UnitPrice, 64)
	if shares <= 0 || price <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Shares and price must be greater than zero"})
		return
	}

	switch input.Currency {
	case "USD":
		input.USDPerCurrencyUnit = "1"
	case "EUR", "GBP", "JPY":
		if !tradeFXDecimal.MatchString(input.USDPerCurrencyUnit) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Enter the trade's USD exchange rate"})
			return
		}
		rate, ok := new(big.Rat).SetString(input.USDPerCurrencyUnit)
		if !ok || rate.Sign() <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Exchange rate must be greater than zero"})
			return
		}
		input.USDPerCurrencyUnit = strings.TrimRight(
			strings.TrimRight(rate.FloatString(12), "0"), ".",
		)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Currency must be USD, EUR, GBP, or JPY"})
		return
	}

	trade := models.Holding{
		Symbol:                input.Symbol,
		Side:                  input.Side,
		Shares:                shares,
		PurchasePrice:         price,
		PurchasePriceCurrency: input.Currency,
		PurchaseDate:          &date,
		TradeRequestID:        &input.RequestID,
		USDPerCurrencyUnit:    input.USDPerCurrencyUnit,
	}

	status := http.StatusCreated
	err = withPortfolioWrite(c, func(tx *gorm.DB) error {
		var existing models.Holding
		err := tx.Where("trade_request_id = ?", input.RequestID).Take(&existing).Error
		switch {
		case err == nil:
			if existing.Symbol != trade.Symbol ||
				existing.Side != trade.Side ||
				existing.Shares != trade.Shares ||
				existing.PurchasePrice != trade.PurchasePrice ||
				existing.PurchasePriceCurrency != trade.PurchasePriceCurrency ||
				existing.USDPerCurrencyUnit != trade.USDPerCurrencyUnit ||
				portfolioTradeDay(existing) != input.Date {
				return errTradeRequestConflict
			}

			trade = existing
			status = http.StatusOK
			return nil

		case !errors.Is(err, gorm.ErrRecordNotFound):
			return err
		}

		if err := tx.Create(&trade).Error; err != nil {
			return err
		}
		return validatePortfolioSymbol(tx, trade.Symbol)
	})
	if err != nil {
		writePortfolioError(c, err)
		return
	}

	c.JSON(status, gin.H{"id": trade.ID, "symbol": trade.Symbol})
}

func portfolioTradePriceUSD(
	trade models.Holding,
	rates map[string]*big.Rat,
) (*big.Rat, bool, error) {
	price, ok := new(big.Rat).SetString(portfolioDecimal(trade.PurchasePrice))
	if !ok || price.Sign() < 0 {
		return nil, false, fmt.Errorf("trade %d has an invalid price", trade.ID)
	}

	currency := portfolioTradeCurrency(trade)
	if currency == "USD" {
		return price, false, nil
	}

	if trade.USDPerCurrencyUnit != "" {
		rate, ok := new(big.Rat).SetString(trade.USDPerCurrencyUnit)
		if !ok || rate.Sign() <= 0 {
			return nil, false, fmt.Errorf("trade %d has an invalid FX rate", trade.ID)
		}
		return price.Mul(price, rate), false, nil
	}

	rate, cached := rates[currency]
	if !cached {
		if value, err := services.FetchFXRate(currency, "USD"); err == nil {
			rate, _ = new(big.Rat).SetString(portfolioDecimal(value))
		}
		rates[currency] = rate
	}
	if rate == nil || rate.Sign() <= 0 {
		return nil, true, fmt.Errorf("legacy %s/USD exchange rate unavailable", currency)
	}

	return price.Mul(price, rate), true, nil
}

func portfolioPositionCost(
	trades []models.Holding,
	rates map[string]*big.Rat,
) (models.PositionCost, bool, error) {
	input := make([]models.CostTrade, 0, len(trades))
	var estimated bool

	for _, trade := range trades {
		price, usedEstimate, err := portfolioTradePriceUSD(trade, rates)
		estimated = estimated || usedEstimate
		if err != nil {
			return models.PositionCost{}, estimated, err
		}

		input = append(input, models.CostTrade{
			ID:        trade.ID,
			Side:      portfolioTradeSide(trade),
			Shares:    portfolioDecimal(trade.Shares),
			UnitPrice: price,
		})
	}

	cost, err := models.CalculatePositionCost(input)
	return cost, estimated, err
}

func validLegacyHolding(holding *models.Holding) bool {
	holding.Symbol = normalizePortfolioSymbol(holding.Symbol)
	holding.PurchasePriceCurrency = portfolioTradeCurrency(*holding)

	return portfolioTicker.MatchString(holding.Symbol) &&
		holding.Shares > 0 && !math.IsInf(holding.Shares, 0) &&
		holding.PurchasePrice >= 0 && !math.IsInf(holding.PurchasePrice, 0)
}