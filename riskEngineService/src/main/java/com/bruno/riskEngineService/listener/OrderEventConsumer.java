package com.bruno.riskEngineService.listener;

@Component
public class OrderEventConsumer {
    private final RiskEngineService riskEngineService;

    public OrderEventConsumer(RiskEngineService riskEngineService) {
        this.riskEngineService = riskEngineService;
    }

    @RabbitListener(queues = RABBITMQCONFIG.QUEUE_NAME)
    public void consume(OrderEvent orderEvent) {
        riskEngineService.processOrderEvent(orderEvent);
    }
}