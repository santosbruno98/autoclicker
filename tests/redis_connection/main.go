package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

func main() {
	_ = godotenv.Load()

	redisURL := os.Getenv("UPSTASH_REDIS_REST_URL")
	if redisURL == "" {
		log.Fatal("REDIS_URL is not configured")
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal("Invalid REDIS_URL: ", err)
	}

	opts.PoolSize = 3
	opts.MinIdleConns = 0

	client := redis.NewClient(opts)
	defer client.Close()

	ctx, cancel := context.WithTimeout(
		context.Background(),
		10*time.Second,
	)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Fatal("Redis connection failed: ", err)
	}

	fmt.Println("Connected successfully to Redis!")

	key := "autoclicker:test:connection"
	value := "Hello from Go!"

	if err := client.Set(ctx, key, value, time.Minute).Err(); err != nil {
		log.Fatal("Redis SET failed: ", err)
	}

	result, err := client.Get(ctx, key).Result()
	if err != nil {
		log.Fatal("Redis GET failed: ", err)
	}

	fmt.Println("Stored value:", result)

	if err := client.Del(ctx, key).Err(); err != nil {
		log.Fatal("Redis DELETE failed: ", err)
	}

	fmt.Println("Redis SET, GET and DELETE passed!")
}
