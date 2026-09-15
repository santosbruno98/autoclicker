# Logger Service Implementation Plan

## Architecture & Data Flow

```text
  +-------------------+              +-------------------+              +-------------------------+
  |                   |              |                   |              |                         |
  |   Go Application  | --(JSON)-->  |   Kafka Broker    | --(JSON)-->  |   Java Logger Service   |
  |    (Producer)     |              |  "app-logs" Topic |              |       (Consumer)        |
  |                   |              |                   |              |                         |
  +-------------------+              +-------------------+              +-------------------------+
                                                                                     |
                                                                                     v
                                                                        +-------------------------+
                                                                        |   Console / Database /  |
                                                                        |      Storage Output     |
                                                                        +-------------------------+

+--------------+               +--------------+               +---------------+
 | Go Producer  |               | Kafka Broker |               | Logger Service|
 +--------------+               +--------------+               +---------------+
        |                              |                               |
        | --- Send Log Message ------->|                               |
        |     (Topic: app-logs)        |                               |
        |                              | --- Poll/Push Event --------->|
        |                              |     (Log Message Payload)     |
        |                              |                               |
        |                              |                               | --- Process & Format Log
        |                              |                               | --- Write Output



Step-by-step Implementation Plan
Step 1: Kafka & Infrastructure Configuration
Verify Kafka is running locally or via docker-compose.yml.

Ensure the target Kafka topic (e.g., app-logs) is created or configured for auto-creation.

Step 2: Consumer Configuration (application.yml)
Define Kafka bootstrap servers (localhost:9092 or kafka:29092).

Set up key and value deserializers (String / JSON).

Configure the consumer group ID.

Step 3: Log Payload DTO Implementation
Create a Java class representing the incoming log payload (e.g., LogMessage).

Fields to include: timestamp, level, service, message, metadata.

Step 4: Kafka Consumer Listener Service
Implement a Spring @Service bean with a @KafkaListener method.

Annotate the listener method to target the app-logs topic.

Deserialize incoming JSON messages into the LogMessage DTO.

Step 5: Processing & Storage Logic
Add formatting logic to process incoming log events.

Print structured logs to standard output or route them to persistent storage.

Step 6: Go Producer Integration & End-to-End Testing
Configure the Go application to publish structured JSON logs to Kafka.

Trigger log generation in Go and verify reception in the Java service console.