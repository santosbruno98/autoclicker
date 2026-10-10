
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	amqp "github.com/rabbitmq/amqp091-go"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		log.Fatal("Failed to load .env: ", err)
	}

	rabbitURL := os.Getenv("RABBITMQ_URL")
	if rabbitURL == "" {
		log.Fatal("RABBITMQ_URL is not configured")
	}

	conn, err := amqp.DialConfig(rabbitURL, amqp.Config{
		Heartbeat: 10 * time.Second,
	})
	if err != nil {
		log.Fatal("RabbitMQ connection failed: ", err)
	}
	defer conn.Close()

	fmt.Println("Connected to CloudAMQP successfully!")

	channel, err := conn.Channel()
	if err != nil {
		log.Fatal("Failed to create RabbitMQ channel: ", err)
	}
	defer channel.Close()

	queue, err := channel.QueueDeclare(
		"autoclicker-test",
		true,  // durable
		false, // auto-delete
		false, // exclusive
		false, // no-wait
		nil,
	)
	if err != nil {
		log.Fatal("Failed to declare queue: ", err)
	}

	fmt.Println("Queue declared:", queue.Name)

	ctx, cancel := context.WithTimeout(
		context.Background(),
		15*time.Second,
	)
	defer cancel()

	message := fmt.Sprintf(
		"RabbitMQ integration test at %s",
		time.Now().UTC().Format(time.RFC3339),
	)

	err = channel.PublishWithContext(
		ctx,
		"",         // Default exchange
		queue.Name, // Routing key
		false,
		false,
		amqp.Publishing{
			ContentType:  "text/plain",
			DeliveryMode: amqp.Persistent,
			Body:         []byte(message),
		},
	)
	if err != nil {
		log.Fatal("Failed to publish message: ", err)
	}

	fmt.Println("Message published successfully!")

	deliveries, err := channel.Consume(
		queue.Name,
		"rabbitmq-integration-test",
		false, // Manual acknowledgement
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatal("Failed to start consumer: ", err)
	}

	select {
	case delivery, ok := <-deliveries:
		if !ok {
			log.Fatal("Delivery channel closed")
		}

		fmt.Println("Message received:", string(delivery.Body))

		if err := delivery.Ack(false); err != nil {
			log.Fatal("Failed to acknowledge message: ", err)
		}

		fmt.Println("Message acknowledged successfully!")

	case <-ctx.Done():
		log.Fatal("Timed out waiting for RabbitMQ message")
	}

	fmt.Println("CloudAMQP integration test passed!")
}
