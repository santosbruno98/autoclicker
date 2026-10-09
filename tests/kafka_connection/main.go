package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/segmentio/kafka-go"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		log.Fatal("Could not load .env: ", err)
	}

	broker := os.Getenv("KAFKA_BROKER")
	if broker == "" {
		log.Fatal("KAFKA_BROKER is not configured")
	}

	caPEM, err := os.ReadFile(os.Getenv("KAFKA_CA_CERT_PATH"))
	if err != nil {
		log.Fatal("Failed to read CA certificate: ", err)
	}

	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}

	if !roots.AppendCertsFromPEM(caPEM) {
		log.Fatal("Invalid Kafka CA certificate")
	}

	certificate, err := tls.LoadX509KeyPair(
		os.Getenv("KAFKA_CLIENT_CERT_PATH"),
		os.Getenv("KAFKA_CLIENT_KEY_PATH"),
	)
	if err != nil {
		log.Fatal("Failed to load client certificate: ", err)
	}

	tlsConfig := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		RootCAs:      roots,
		Certificates: []tls.Certificate{certificate},
	}

	dialer := &kafka.Dialer{
		Timeout:   10 * time.Second,
		DualStack: true,
		TLS:       tlsConfig,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	conn, err := dialer.DialContext(ctx, "tcp", broker)
	if err != nil {
		log.Fatal("Kafka connection failed: ", err)
	}
	defer conn.Close()

	fmt.Println("Connected to Aiven Kafka successfully!")

	topic := os.Getenv("KAFKA_TOPIC_LOGS")
	if topic == "" {
		topic = "app-logs"
	}

	writer := &kafka.Writer{
		Addr:      kafka.TCP(broker),
		Topic:     topic,
		Balancer:  &kafka.LeastBytes{},
		Transport: &kafka.Transport{TLS: tlsConfig},
	}
	defer writer.Close()

	message := fmt.Sprintf(
		`{"service":"kafka-test","level":"INFO","message":"Aiven Kafka connection successful","timestamp":"%s"}`,
		time.Now().UTC().Format(time.RFC3339),
	)

	if err := writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte("connection-test"),
		Value: []byte(message),
	}); err != nil {
		log.Fatal("Failed to publish Kafka message: ", err)
	}

	fmt.Println("Message published successfully!")
	fmt.Println("Topic:", topic)

	// Read the latest messages from the same topic.
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     []string{broker},
		Topic:       topic,
		Partition:   0,
		MinBytes:    1,
		MaxBytes:    10e6,
		MaxWait:     time.Second,
		StartOffset: kafka.LastOffset,
		Dialer:      dialer,
	})
	defer reader.Close()

	// The test message was published before the reader started.
	// Read from the beginning to find the message.
	if err := reader.SetOffset(kafka.FirstOffset); err != nil {
		log.Fatal("Failed to set reader offset: ", err)
	}

	readCtx, readCancel := context.WithTimeout(
		context.Background(),
		15*time.Second,
	)
	defer readCancel()

	for {
		msg, err := reader.ReadMessage(readCtx)
		if err != nil {
			log.Fatal("Failed to read Kafka message: ", err)
		}

		if strings.Contains(string(msg.Value), "Aiven Kafka connection successful") {
			fmt.Println("Message received successfully!")
			fmt.Println("Received:", string(msg.Value))
			break
		}
	}
}
