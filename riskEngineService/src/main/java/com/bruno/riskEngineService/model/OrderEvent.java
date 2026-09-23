package com.bruno.riskEngineService.model;

public sealed interface OrderEvent permits OrderExecuted, OrderRejected, OrderCancelled {
    String orderId();
    String symbol();
    double quantity();
    double price();
    Instant timestamp();
}

public record OrderExecuted(
    String orderId,
    String symbol,
    double quantity,
    double price,
    Instant timestamp    
) implements OrderEvent {}

public record OrderRejected(
    String orderId,
    String symbol,
    double quantity,
    double price,
    Instant timestamp,
    String reason
) implements OrderEvent {}

public record OrderCancelled(
    String orderId,
    String symbol,
    double quantity,
    double price,
    Instant timestamp
) implements OrderEvent {}
