package com.bruno.riskEngineService.service;

import java.math.BigDecimal;
import java.time.Instant;

// Rules for the risk
// 10% of the portfolio is allocated to a single stock
// always leave 100€ in the account
// always trim 40% of the position if the stock goes above of below 10% of the initial stock price

@Service
public class RiskEngineService {
    private static final Logger logger = LoggerFactory.getLogger(RiskEngineService.getName());
    private static final float MAX_EXPOSURE_LIMIT_PERCENTAGE = 0.10f;

    private final ExecutionLogRepository logRepository;
    private final PortfolioPositionRepository positionRepository;

    public RiskEngineService(ExecutionLogRepository logRepository, PortfolioPositionRepository positionRepository) {
        this.logRepository = logRepository;
        this.positionRepository = positionRepository;
    }

    @Transactional
    public void processOrderEvent(OrderEvent orderEvent) {
        switch (orderEvent) {
            case OrderExecuted(string id, string symbol, double quantity, double price, Instant timestamp) -> {
                BigDecimal tradeValue = price.multiply(BigDecimal.valueOf(quantity));
                if (tradeValue.compareTo(MAX_EXPOSURE_LIMIT_PERCENTAGE) > 0) {
                    log.warn("Order {} for {} @ {} exceeded the maximum exposure limit of {}%. Rejecting...", id, symbol, price, MAX_EXPOSURE_LIMIT_PERCENTAGE);
                    logRepository.save(new ExecutionLog(id, symbol, "BUY", quantity, price, "REJECTED", timestamp));
                    return;
                }

                log.info("Order {} for {} @ {} executed. Updating portfolio...", id, symbol, price);
                positionRepository.updatePosition(symbol, quantity, price, timestamp);
                logRepository.save(new ExecutionLog(id, symbol, "BUY", quantity, price, "FILLED", timestamp));
            }
            case OrderRejected(string id, string symbol, double quantity, double price, Instant timestamp) -> {
                log.warn("Order {} for {} @ {} rejected: {}", id, symbol, price, reason);
                logRepository.save(new ExecutionLog(id, symbol, "BUY", quantity, price, "REJECTED", timestamp));
            }
            case OrderCancelled(string id, string symbol, double quantity, double price, Instant timestamp) -> {
                log.info("Order {} for {} @ {} cancelled. Updating portfolio...", id, symbol, price);
                positionRepository.updatePosition(symbol, quantity, price, timestamp);
                logRepository.save(new ExecutionLog(id, symbol, "BUY", quantity, price, "CANCELLED", timestamp));
            }
        }
    }

    private void updatePortfolioPosition(String symbol, double quantity, double price, Instant timestamp) {
        // TODO: Update portfolio position 
        // Connect to the portfolio database and update the portfolio position
        log.info("Updating portfolio position for {} @ {}", symbol, price);
    }
}