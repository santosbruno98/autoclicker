package com.example.loggerservice.service;

import com.bruno.loggerservice.dto.LogMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class LogConsumerService {
    private static final Logger log = LoggerFactory.getLogger(LogConsumerService.class);

    @KafkaListener(topics = "app-logs", groupId = "logger-group")
    public void consume(LogMessage message) {
        log.info(
           "Received Log: [{}] {} - {} ",
           message.service(),
           message.level(),
           message.message() 
        );
    }
}
