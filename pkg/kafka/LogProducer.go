package kafka

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/scram"
)

type LogProducer struct {
	Writer      *kafka.Writer
	Topic       string
	ServiceName string
}

func kafkaTLSConfig() (*tls.Config, error) {
	if !strings.EqualFold(os.Getenv("KAFKA_TLS_ENABLED"), "true") {
		return nil, nil
	}

	config := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	caPath := strings.TrimSpace(os.Getenv("KAFKA_CA_CERT_PATH"))
	if caPath != "" {
		caPEM, err := os.ReadFile(caPath)
		if err != nil {
			return nil, fmt.Errorf("read Kafka CA certificate: %w", err)
		}

		roots, err := x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}

		if !roots.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("invalid Kafka CA certificate")
		}
		config.RootCAs = roots
	}

	certPath := strings.TrimSpace(os.Getenv("KAFKA_CLIENT_CERT_PATH"))
	keyPath := strings.TrimSpace(os.Getenv("KAFKA_CLIENT_KEY_PATH"))

	if (certPath == "") != (keyPath == "") {
		return nil, fmt.Errorf(
			"Kafka client certificate and key must be configured together",
		)
	}

	if certPath != "" {
		certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return nil, fmt.Errorf("load Kafka client certificate: %w", err)
		}

		config.Certificates = []tls.Certificate{certificate}
	}

	return config, nil
}

func kafkaSASLMechanism() (sasl.Mechanism, error) {
	username := strings.TrimSpace(os.Getenv("KAFKA_SASL_USERNAME"))
	password := os.Getenv("KAFKA_SASL_PASSWORD")

	if username == "" && password == "" {
		return nil, nil
	}

	if username == "" || password == "" {
		return nil, fmt.Errorf(
			"both KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required",
		)
	}

	algorithm := scram.SHA256

	if strings.EqualFold(
		os.Getenv("KAFKA_SASL_MECHANISM"),
		"SCRAM-SHA-512",
	) {
		algorithm = scram.SHA512
	}

	return scram.Mechanism(algorithm, username, password)
}

func NewLogProducer(
	brokers []string,
	topic string,
	serviceName string,
) (*LogProducer, error) {
	if len(brokers) == 0 {
		return nil, fmt.Errorf("Kafka broker list cannot be empty")
	}

	if topic == "" {
		return nil, fmt.Errorf("Kafka topic cannot be empty")
	}

	tlsConfig, err := kafkaTLSConfig()
	if err != nil {
		return nil, err
	}

	mechanism, err := kafkaSASLMechanism()
	if err != nil {
		return nil, err
	}

	if mechanism != nil && tlsConfig == nil {
		return nil, fmt.Errorf(
			"Kafka SASL credentials require KAFKA_TLS_ENABLED=true",
		)
	}

	transport := &kafka.Transport{
		TLS:  tlsConfig,
		SASL: mechanism,
	}

	writer := &kafka.Writer{
		Addr:                   kafka.TCP(brokers...),
		Topic:                  topic,
		Balancer:               &kafka.LeastBytes{},
		Transport:              transport,
		Async:                  true,
		BatchTimeout:           10 * time.Millisecond,
		AllowAutoTopicCreation: false,
		Completion: func(messages []kafka.Message, err error) {
			if err != nil {
				log.Printf("Kafka delivery failed: %v", err)
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
