package com.bruno.riskEngineService.repository;

@Entity
@Table(name = "execution_logs")
public class ExecutionLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "order_id")
    private String orderId;

    @Column(name = "symbol")
    private String symbol;

    @Column(name = "action")
    private String action; // BUY, SELL, HOLD

    @Column(name = "quantity")
    private double quantity;

    @Column(name = "price")
    private double price;

    @Column(name = "status")
    private String status; // SUBMITTED, FILLED, PARTIALLY_FILLED, REJECTED, CANCELLED

    private Instant timestamp;

    public ExecutionLog() {}

    public ExecutionLog(String orderId, String symbol, String action, double quantity, double price, String status, Instant timestamp) {
        this.orderId = orderId;
        this.symbol = symbol;
        this.action = action;
        this.quantity = quantity;
        this.price = price;
        this.status = status;
        this.timestamp = timestamp;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getOrderId() {
        return orderId;
    }

    public void setOrderId(String orderId) {
        this.orderId = orderId;
    }

    public String getSymbol() {
        return symbol;
    }

    public void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    public String getAction() {
        return action;
    }

    public void setAction(String action) {
        this.action = action;
    }

    public double getQuantity() {
        return quantity;
    }

    public void setQuantity(double quantity) {
        this.quantity = quantity;
    }

    public double getPrice() {
        return price;
    }

    public void setPrice(double price) {
        this.price = price;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Instant timestamp) {
        this.timestamp = timestamp;
    }
}