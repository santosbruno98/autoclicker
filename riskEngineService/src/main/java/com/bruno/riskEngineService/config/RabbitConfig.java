package com.bruno.riskEngineService.config;

import java.beans.BeanProperty;

@Configuration
public class RabbitConfig {

    private static final String QUEUE_NAME = "trade.orders.queue";
    private static final String EXCHANGE_NAME = "trade.orders.exchange";
    private static final String ROUTING_KEY = "trade.orders.binding";

    @Bean
    public Queue orderQueue() {
    return QueueBuilder.durable(QUEUE_NAME).build();
    }

    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange(EXCHANGE_NAME);
    }

    @Bean
    public Binding binding(Queue orderQueue, DirectExchange orderExchange) {
        return BindingBuilder.bind(orderQueue).to(orderExchange).with(ROUTING_KEY);
    }
}