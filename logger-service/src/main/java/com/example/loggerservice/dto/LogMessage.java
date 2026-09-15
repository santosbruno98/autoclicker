package com.bruno.loggerservice.dto;

import java.time.Instant;

public record LogMessage(
    Instant timestamp,
    String level,
    String service,
    String message
) {}