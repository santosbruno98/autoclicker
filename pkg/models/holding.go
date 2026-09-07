package models

import "time"

type Holding struct {
	ID                    uint       `gorm:"primaryKey" json:"id"`
	Symbol                string     `gorm:"type:varchar(10);not null" json:"symbol"`
	Shares                float64    `gorm:"not null" json:"shares"`
	PurchasePrice         float64    `gorm:"default:0" json:"purchase_price"`
	PurchasePriceCurrency string     `gorm:"type:varchar(3);default:'USD' " json:"purchase_price_currency"`
	PurchaseDate          *time.Time `json:"purchase_date"`
	CreatedAt             time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt             time.Time  `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
}

type HoldingQuote struct {
	Holding
	Currency      string  `json:"currency"`
	LastPrice     float64 `json:"last_price"`
	MarketSession string  `json:"market_session"`

	MarketValue      float64 `json:"market_value"`
	DayGainPercent   float64 `json:"day_gain_percent"`
	DayGainAbs       float64 `json:"day_gain_abs"`
	WeekGainPercent  float64 `json:"week_gain_percent"`
	WeekGainAbs      float64 `json:"week_gain_abs"`
	TotalGainPercent float64 `json:"total_gain_percent"`
	TotalGainAbs     float64 `json:"total_gain_abs"`

	LastPriceUSD    float64 `json:"last_price_usd"`
	LastPriceEUR    float64 `json:"last_price_eur"`
	MarketValueUSD  float64 `json:"market_value_usd"`
	MarketValueEUR  float64 `json:"market_value_eur"`
	AvgCostShareUSD float64 `json:"avg_cost_share_usd"`
	AvgCostShareEUR float64 `json:"avg_cost_share_eur"`
	TotalCostEUR    float64 `json:"total_cost_eur"`
	TotalCostUSD    float64 `json:"total_cost_usd"`
	DayGainAbsUSD   float64 `json:"day_gain_abs_usd"`
	DayGainAbsEUR   float64 `json:"day_gain_abs_eur"`
	TotalGainAbsUSD float64 `json:"total_gain_abs_usd"`
	TotalGainAbsEUR float64 `json:"total_gain_abs_eur"`

	QuoteFetchError string `json:"quote_fetch_error,omitempty"`
}

// PortfolioPoint represents a single point in time in the portfolio's value history
type PortfolioPoint struct {
	Timestamp int64   `json:"timestamp"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
}

type PortfolioHistory struct {
	USD []PortfolioPoint `json:"usd"`
	EUR []PortfolioPoint `json:"eur"`
}

// PortfolioSummary represents a summary of the current portfolio value
type PortfolioSummary struct {
	TotalValueUSD    float64 `json:"total_value_usd"`
	TotalValueEUR    float64 `json:"total_value_eur"`
	DayChangeAbsUSD  float64 `json:"day_change_abs_usd"`
	DayChangeAbsEUR  float64 `json:"day_change_abs_eur"`
	DayChangePercent float64 `json:"day_change_percent"`
	WeekChangeAbsUSD float64 `json:"week_change_abs_usd"`
	WeekChangeAbsEUR float64 `json:"week_change_abs_eur"`
	TotalGainAbsUSD  float64 `json:"total_gain_abs_usd"`
	TotalGainAbsEUR  float64 `json:"total_gain_abs_eur"`
	TotalGainPercent float64 `json:"total_gain_percent"`

	Holdings []HoldingQuote `json:"holdings"`
}
