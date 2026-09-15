package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/segmentio/kafka-go"
)

type LogProducer struct {
	Writer      *kafka.Writer
	Topic       string
	ServiceName string
}

func NewLogProducer(brokers []string, topic, serviceName string) (*LogProducer, error) {
	if len(brokers) == 0 {
		return nil, fmt.Errorf("kafka initialization failed: broker list cannot be empty")
	}

	if topic == "" {
		return nil, fmt.Errorf("kafka initialization failed: topic name cannot be empty")
	}

	writer := &kafka.Writer{
		Addr:                   kafka.TCP(brokers...),
		Topic:                  topic,
		Balancer:               &kafka.LeastBytes{},
		Async:                  true,
		BatchTimeout:           10 * time.Millisecond,
		AllowAutoTopicCreation: true,
		Completion: func(messages []kafka.Message, err error) {
			if err != nil {
				log.Printf("Failed to send log message to Kafka: %v", err)
			}
		},
	}

	return &LogProducer{
		Writer:      writer,
		Topic:       topic,
		ServiceName: serviceName,
	}, nil
}

func (k *LogProducer) Close() error {
	if k.Writer != nil {
		return k.Writer.Close()
	}
	return nil
}

func (p *LogProducer) EmitAppLog(ctx context.Context, level, message string) error {
	payload, err := json.Marshal(LogMessage{
		Timestamp: time.Now().UTC(),
		Level:     level,
		Service:   "app",
		Message:   message,
	})

	if err != nil {
		return err
	}
	return p.Writer.WriteMessages(ctx, kafka.Message{
		Value: payload,
	})
}
