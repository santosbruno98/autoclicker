//go:build windows && !cloud

package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"autoclicker/pkg/database"
	"autoclicker/pkg/handlers"
	"autoclicker/pkg/services"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	if os.Getenv("ALLOWED_ADDRESS") == "" {
		log.Fatal("ALLOWED_ADDRESS is required to load saved tasks")
	}
	address := os.Getenv("ALLOWED_ADDRESS")

	if os.Getenv("LOCAL_DATABASE_URL") == "" {
		log.Fatal("LOCAL_DATABASE_URL is required to load saved tasks")
	}

	database.InitCoreDB()

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		log.Fatal(err)
	}

	token := base64.RawURLEncoding.EncodeToString(raw)

	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery(), securityHeaders())

	r.GET("/local/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":           "online",
			"platform":         "windows",
			"requires_pairing": true,
		})
	})

	secured := r.Group("/local")
	secured.Use(requireToken(token))

	secured.GET("/processes", handlers.GetProcesses)
	secured.GET("/processes/verify/:pid", handlers.VerifyPID)
	secured.GET("/automation/status", handlers.GetStatus)
	secured.GET("/automation/logs", handlers.GetLogs)
	secured.POST("/automation/start", handlers.StartJob)
	secured.POST("/automation/stop", handlers.StopJob)

	server := &http.Server{
		Addr:              address,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       30 * time.Second,
	}

	listener, err := net.Listen("tcp4", address)
	if err != nil {
		log.Fatal(err)
	}

	log.Println("Local controller listening on http://" + address)
	log.Println("LOCAL ACCESS TOKEN (do not share): " + token)
	log.Println("Open MyPlatform on THIS PC and paste the token into the Controller tab.")
	log.Println("Press Ctrl+C to stop the agent and any running automation.")

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := server.Serve(listener); err != nil &&
			!errors.Is(err, http.ErrServerClosed) {
			log.Println("server error:", err)
			done <- syscall.SIGTERM
		}
	}()

	<-done

	if services.Manager.IsActive() {
		_ = services.Manager.StopJob()
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		5*time.Second,
	)
	defer cancel()

	_ = server.Shutdown(ctx)
}

func securityHeaders() gin.HandlerFunc {
	if os.Getenv("FRONTEND_ORIGIN") == "" {
		log.Fatal("FRONTEND_ORIGIN is required to load saved tasks")
	}

	origin := os.Getenv("FRONTEND_ORIGIN")

	if os.Getenv("ALLOWED_ADDRESS") == "" {
		log.Fatal("ALLOWED_ADDRESS is required to load saved tasks")
	}
	address := os.Getenv("ALLOWED_ADDRESS")

	return func(c *gin.Context) {
		h := c.Writer.Header()

		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
		h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		h.Set(
			"Access-Control-Allow-Headers",
			"Authorization, Content-Type, X-Requested-With",
		)
		h.Set("Access-Control-Allow-Private-Network", "true")
		h.Set("Access-Control-Max-Age", "600")

		// Reject requests using unexpected Host headers.
		if c.Request.Host != address {
			c.AbortWithStatusJSON(
				http.StatusForbidden,
				gin.H{"error": "invalid host"},
			)
			return
		}

		// Only the production MyPlatform origin is accepted.
		if c.Request.Header.Get("Origin") != origin {
			c.AbortWithStatusJSON(
				http.StatusForbidden,
				gin.H{"error": "invalid origin"},
			)
			return
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func requireToken(expected string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := strings.TrimPrefix(
			c.GetHeader("Authorization"),
			"Bearer ",
		)

		if subtle.ConstantTimeCompare(
			[]byte(provided),
			[]byte(expected),
		) != 1 {
			c.AbortWithStatusJSON(
				http.StatusUnauthorized,
				gin.H{"error": "local authorization required"},
			)
			return
		}

		if c.Request.Method == http.MethodPost &&
			c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
			c.AbortWithStatusJSON(
				http.StatusForbidden,
				gin.H{"error": "missing request marker"},
			)
			return
		}

		c.Next()
	}
}
