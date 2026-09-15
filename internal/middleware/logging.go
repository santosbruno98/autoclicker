package middleware

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/segmentio/kafka-go"
)

type NetworkLogPayload struct {
	Timestamp  string `json:"timestamp"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	StatusCode int    `json:"status_code"`
	LatencyMs  int64  `json:"latency_ms"`
	ClientIP   string `json:"client_ip"`
}

func NetworkLogger(writer *kafka.Writer) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		payload, _ := json.Marshal(NetworkLogPayload{
			Timestamp: 	time.Now().UTC().Format(time.RFC3339),
			Method:     c.Request.Method,
			Path:       c.FullPath(),
			StatusCode: c.Writer.Status(),
			LatencyMs:  time.Since(start).Milliseconds(),
			ClientIP:   c.ClientIP(),
		})

		_ = writer.WriteMessages(context.Background(), kafka.Message{
			Value: payload,
		})

	}
}
