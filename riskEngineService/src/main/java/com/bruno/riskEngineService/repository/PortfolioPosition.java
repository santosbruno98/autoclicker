package com.bruno.riskEngineService.repository;

@Entity
@Table(name = "portfolio_positions")
public class PortfolioPosition {

    @Id
    private String symbol;

    private int totalQuantity;
    private BigDecimal averagePrice;
    private BigDecimal currentExposure;

    public PortfolioPosition() {}

    public PortfolioPosition(String symbol, int totalQuantity, BigDecimal averagePrice, BigDecimal currentExposure) {
        this.symbol = symbol;
        this.totalQuantity = totalQuantity;
        this.averagePrice = averagePrice;
        this.currentExposure = currentExposure;
    }

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    public int getTotalQuantity() {
        return totalQuantity;
    }

    public void setTotalQuantity(int totalQuantity) {
        this.totalQuantity = totalQuantity;
    }

    public BigDecimal getAveragePrice() {
        return averagePrice;
    }

    public void setAveragePrice(BigDecimal averagePrice) {
        this.averagePrice = averagePrice;
    }

    public BigDecimal getCurrentExposure() {
        return currentExposure;
    }

    public void setCurrentExposure(BigDecimal currentExposure) {
        this.currentExposure = currentExposure;
    }
}