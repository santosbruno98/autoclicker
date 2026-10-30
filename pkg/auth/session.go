package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"google.golang.org/api/idtoken"
)

const (
	cookieName = "autoclicker_session"
	sessionTTL = 10 * time.Minute
)

type Session struct {
	GoogleSub string `json:"google_sub"`
	Email     string `json:"email"`
}

type Service struct {
	redis         *redis.Client
	clientID      string
	allowedEmail  string
	allowedOrigin string
}

func NewService(ctx context.Context) (*Service, error) {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	allowedEmail := os.Getenv("GOOGLE_ALLOWED_EMAIL")
	redisURL := os.Getenv("UPSTASH_REDIS_REST_URL")
	allowedOrigin := strings.TrimRight(
		os.Getenv("FRONTEND_ORIGIN"),
		"/",
	)

	if clientID == "" || allowedEmail == "" ||
		redisURL == "" || allowedOrigin == "" {
		return nil, errors.New(
			"GOOGLE_CLIENT_ID, GOOGLE_ALLOWED_EMAIL, " +
				"UPSTASH_REDIS_REST_URL and FRONTEND_ORIGIN are required",
		)
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	client := redis.NewClient(opts)

	if err := client.Ping(ctx).Err(); err != nil {
		client.Close()
		return nil, err
	}

	return &Service{
		redis:         client,
		clientID:      clientID,
		allowedEmail:  strings.ToLower(allowedEmail),
		allowedOrigin: allowedOrigin,
	}, nil
}

func (s *Service) Close() error {
	return s.redis.Close()
}

func sessionKey(token string) string {
	hash := sha256.Sum256([]byte(token))
	return "session:" + hex.EncodeToString(hash[:])
}

func newToken() (string, error) {
	raw := make([]byte, 32)

	if _, err := rand.Read(raw); err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (s *Service) setCookie(c *gin.Context, token string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
	})
}

// CORS runs before session authentication, including for OPTIONS requests.
func (s *Service) CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Add("Vary", "Origin")

		origin := c.GetHeader("Origin")

		if origin != "" && origin != s.allowedOrigin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "Invalid request origin",
			})
			return
		}

		if origin == s.allowedOrigin {
			c.Header("Access-Control-Allow-Origin", s.allowedOrigin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header(
				"Access-Control-Allow-Methods",
				"GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
			)
			c.Header(
				"Access-Control-Allow-Headers",
				"Content-Type, X-Requested-With",
			)
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func (s *Service) checkOrigin(c *gin.Context) bool {
	if c.GetHeader("Origin") != s.allowedOrigin {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "Invalid request origin",
		})
		return false
	}

	return true
}

func (s *Service) GoogleLogin(c *gin.Context) {
	if !s.checkOrigin(c) {
		return
	}

	var req struct {
		Credential string `json:"credential" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Missing credential",
		})
		return
	}

	payload, err := idtoken.Validate(
		c.Request.Context(),
		req.Credential,
		s.clientID,
	)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid Google ID token",
		})
		return
	}

	email, _ := payload.Claims["email"].(string)
	verified, _ := payload.Claims["email_verified"].(bool)

	if !verified || !strings.EqualFold(email, s.allowedEmail) ||
		payload.Subject == "" {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Google account not authorized",
		})
		return
	}

	token, err := newToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Session creation failed",
		})
		return
	}

	data, err := json.Marshal(Session{
		GoogleSub: payload.Subject,
		Email:     email,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Session creation failed",
		})
		return
	}

	if err := s.redis.Set(
		c.Request.Context(),
		sessionKey(token),
		data,
		sessionTTL,
	).Err(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Session store unavailable",
		})
		return
	}

	s.setCookie(c, token, int(sessionTTL.Seconds()))

	c.JSON(http.StatusOK, gin.H{
		"authenticated": true,
		"email":         email,
	})
}

func (s *Service) RequireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet &&
			c.Request.Method != http.MethodHead &&
			c.Request.Method != http.MethodOptions {
			if !s.checkOrigin(c) {
				return
			}

			if c.GetHeader("X-Requested-With") != "XMLHttpRequest" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"error": "Missing CSRF protection header",
				})
				return
			}
		}

		token, err := c.Cookie(cookieName)
		if err != nil || token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Authentication required",
			})
			return
		}

		data, err := s.redis.GetEx(
			c.Request.Context(),
			sessionKey(token),
			sessionTTL,
		).Bytes()

		if errors.Is(err, redis.Nil) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Session expired",
			})
			return
		}

		if err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "Session store unavailable",
			})
			return
		}

		var session Session

		if err := json.Unmarshal(data, &session); err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid session",
			})
			return
		}

		c.Set("session", session)
		c.Next()
	}
}

func (s *Service) Me(c *gin.Context) {
	session := c.MustGet("session").(Session)

	c.JSON(http.StatusOK, gin.H{
		"authenticated": true,
		"email":         session.Email,
	})
}

func (s *Service) Logout(c *gin.Context) {
	token, err := c.Cookie(cookieName)

	if err == nil {
		if err := s.redis.Del(
			c.Request.Context(),
			sessionKey(token),
		).Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "Could not revoke session",
			})
			return
		}
	}

	s.setCookie(c, "", -1)

	c.JSON(http.StatusOK, gin.H{
		"authenticated": false,
	})
}
