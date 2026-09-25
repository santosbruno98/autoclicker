package com.bruno.riskEngineService.repository;

@Entity
@Table(name = "portfolio_positions")
public class PortfolioPosition {

    @Id
    private String symbol;
    private float shares;
    private BigDecimal purchasePrice;
    private BigDecimal purchasePriceCurrency;
    private Instant purchaseDate;

    public PortfolioPosition() {}

    public PortfolioPosition(String symbol, float shares, BigDecimal purchasePrice, BigDecimal purchasePriceCurrency, Instant purchaseDate) {
        this.symbol = symbol;
        this.shares = shares;
        this.purchasePrice = purchasePrice;
        this.purchasePriceCurrency = purchasePriceCurrency;
        this.purchaseDate = purchaseDate;
    }
    

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    public float getShares() {
        return shares;
    }

    public void setShares(float shares) {
        this.shares = shares;
    }

    public BigDecimal getPurchasePrice() {
        return purchasePrice;
    }

    public void setPurchasePrice(BigDecimal purchasePrice) {
        this.purchasePrice = purchasePrice;
    }

    public BigDecimal getPurchasePriceCurrency() {
        return purchasePriceCurrency;
    }

    public void setPurchasePriceCurrency(BigDecimal purchasePriceCurrency) {
        this.purchasePriceCurrency = purchasePriceCurrency;
    }

    public Instant getPurchaseDate() {
        return purchaseDate;
    }

    public void setPurchaseDate(Instant purchaseDate) {
        this.purchaseDate = purchaseDate;
    }
}