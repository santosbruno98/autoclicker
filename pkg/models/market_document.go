package models

type MarketDocumentResult struct {
	SourceFile string          `json:"source_file"`
	Companies  []MarketCompany `json:"companies"`
	AISummary  string          `json:"ai_summary"`
}

type MarketCompany struct {
	CompanyName string `json:"company_name"`
	Symbol      string `json:"symbol"`
	Bullish     bool   `json:"bullish"`
	Bearish     bool   `json:"bearish"`
}
