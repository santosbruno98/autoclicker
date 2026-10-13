package models

import "time"

// DividendPayment is a recorded dividend entitlement/payment.
// Monetary tax fields are always denominated in EUR.
type DividendPayment struct {
	ID uint `gorm:"primaryKey" json:"id"`

	HoldingID uint    `gorm:"not null;index" json:"holding_id"`
	Holding   Holding `gorm:"foreignKey:HoldingID;constraint:OnDelete:RESTRICT" json:"-"`

	Symbol string `gorm:"type:varchar(20);not null;index" json:"symbol"`

	ExDividendDate time.Time `gorm:"not null" json:"ex_dividend_date"`
	PaymentDate    time.Time `gorm:"not null;index" json:"payment_date"`

	EligibleShares   float64 `gorm:"not null" json:"eligible_shares"`
	DividendPerShare float64 `gorm:"not null" json:"dividend_per_share"`

	// Currency is the denomination of DividendPerShare.
	Currency string `gorm:"type:varchar(3);not null" json:"currency"`

	// EUR received for one unit of Currency.
	// For EUR dividends this must be 1.
	FXToEUR float64 `gorm:"not null" json:"fx_to_eur"`

	// Taxes are entered and stored in EUR only.
	ForeignTaxEUR    float64 `gorm:"not null;default:0" json:"foreign_tax_eur"`
	PortugueseTaxEUR float64 `gorm:"not null;default:0" json:"portuguese_tax_eur"`

	// If false, the record represents an announced or expected
	// payment and is excluded from realized P&L.
	Received bool `gorm:"not null;default:false" json:"received"`

	Notes string `gorm:"type:text" json:"notes"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DividendCalculated struct {
	DividendPayment

	GrossOriginal float64 `json:"gross_original"`
	GrossEUR      float64 `json:"gross_eur"`
	TotalTaxEUR   float64 `json:"total_tax_eur"`
	NetEUR        float64 `json:"net_eur"`
}

type DividendTotals struct {
	GrossEUR float64 `json:"gross_eur"`
	TaxEUR   float64 `json:"tax_eur"`
	NetEUR   float64 `json:"net_eur"`
}

type DividendResponse struct {
	Payments []DividendCalculated `json:"payments"`
	Totals   DividendTotals       `json:"totals"`
}
