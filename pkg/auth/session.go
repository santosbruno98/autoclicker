package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"google.golang.org/api/idtoken"
)

const (
	cookieName     = "autoclicker_session"
	sessionSeconds = 600
	plannerSeconds = 86400
)

type Session struct {
	GoogleSub string `json:"google_sub"`
	Email     string `json:"email"`
}

type Service struct {
	endpoint      string
	token         string
	clientID      string
	allowedEmail  string
	allowedOrigin string
	client        *http.Client
}

type plannerSnapshot struct {
	Version   string          `json:"version"`
	UpdatedAt string          `json:"updated_at"`
	State     json.RawMessage `json:"state"`
}

// Execute a Redis command through the Upstash HTTPS REST API.
func (s *Service) command(
	ctx context.Context,
	out any,
	args ...any,
) error {
	body, err := json.Marshal(args)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		s.endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return errors.New("cannot create Upstash request")
	}

	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return errors.New("Upstash connection failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Upstash HTTP %d", resp.StatusCode)
	}

	var result struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}

	if err := json.NewDecoder(
		io.LimitReader(resp.Body, 6<<20),
	).Decode(&result); err != nil {
		return err
	}

	if result.Error != "" {
		return errors.New("Upstash command failed")
	}

	if out == nil {
		return nil
	}

	return json.Unmarshal(result.Result, out)
}

func NewService(ctx context.Context) (*Service, error) {
	s := &Service{
		endpoint: strings.TrimRight(
			strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_URL")),
			"/",
		),
		token:    strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_TOKEN")),
		clientID: os.Getenv("GOOGLE_CLIENT_ID"),
		allowedEmail: strings.ToLower(
			strings.TrimSpace(os.Getenv("GOOGLE_ALLOWED_EMAIL")),
		),
		allowedOrigin: strings.TrimRight(
			os.Getenv("FRONTEND_ORIGIN"),
			"/",
		),
		client: &http.Client{
			Timeout: 8 * time.Second,
		},
	}

	if s.endpoint == "" ||
		s.token == "" ||
		s.clientID == "" ||
		s.allowedEmail == "" ||
		s.allowedOrigin == "" {
		return nil, errors.New(
			"UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, " +
				"GOOGLE_CLIENT_ID, GOOGLE_ALLOWED_EMAIL and " +
				"FRONTEND_ORIGIN are required",
		)
	}

	u, err := url.Parse(s.endpoint)
	if err != nil ||
		u.Scheme != "https" ||
		u.Host == "" ||
		u.User != nil ||
		u.RawQuery != "" {
		return nil, errors.New(
			"UPSTASH_REDIS_REST_URL must be an HTTPS endpoint",
		)
	}

	var pong string

	if err := s.command(ctx, &pong, "PING"); err != nil {
		return nil, err
	}

	if pong != "PONG" {
		return nil, errors.New("invalid Upstash PING response")
	}

	return s, nil
}

func (s *Service) Close() error {
	s.client.CloseIdleConnections()
	return nil
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

func (s *Service) setCookie(
	c *gin.Context,
	token string,
	age int,
) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   age,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
	})
}

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
			c.Header("Access-Control-Allow-Origin", origin)
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

	if c.ShouldBindJSON(&req) != nil {
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

	if !verified ||
		!strings.EqualFold(email, s.allowedEmail) ||
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

	if err := s.command(
		c.Request.Context(),
		nil,
		"SET",
		sessionKey(token),
		string(data),
		"EX",
		sessionSeconds,
	); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Session store unavailable",
		})
		return
	}

	s.setCookie(c, token, sessionSeconds)

	c.JSON(http.StatusOK, gin.H{
		"authenticated": true,
		"user_id":       payload.Subject,
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

		var data *string

		if err := s.command(
			c.Request.Context(),
			&data,
			"GETEX",
			sessionKey(token),
			"EX",
			sessionSeconds,
		); err != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "Session store unavailable",
			})
			return
		}

		if data == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Session expired",
			})
			return
		}

		var session Session

		if json.Unmarshal([]byte(*data), &session) != nil ||
			session.GoogleSub == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid session",
			})
			return
		}

		s.setCookie(c, token, sessionSeconds)
		c.Set("session", session)
		c.Next()
	}
}

func (s *Service) Me(c *gin.Context) {
	user := c.MustGet("session").(Session)

	c.JSON(http.StatusOK, gin.H{
		"authenticated": true,
		"user_id":       user.GoogleSub,
		"email":         user.Email,
	})
}

func (s *Service) Logout(c *gin.Context) {
	if token, err := c.Cookie(cookieName); err == nil {
		if err := s.command(
			c.Request.Context(),
			nil,
			"DEL",
			sessionKey(token),
		); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "Could not revoke session",
			})
			return
		}
	}

	s.setCookie(c, "", -1)

	// Planner keys survive session expiration and logout.
	c.JSON(http.StatusOK, gin.H{
		"authenticated": false,
	})
}

func plannerKey(c *gin.Context) string {
	user := c.MustGet("session").(Session)
	hash := sha256.Sum256([]byte(user.GoogleSub))

	return "route-planner:" + hex.EncodeToString(hash[:])
}

func (s *Service) GetPlanner(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	var raw *string

	if err := s.command(
		c.Request.Context(),
		&raw,
		"GET",
		plannerKey(c),
	); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Planner store unavailable",
		})
		return
	}

	if raw == nil {
		c.JSON(http.StatusOK, gin.H{
			"snapshot": nil,
		})
		return
	}

	var snapshot plannerSnapshot

	if json.Unmarshal([]byte(*raw), &snapshot) != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Stored planner data is invalid",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"snapshot": snapshot,
	})
}

// Atomic compare-and-set prevents stale offline copies
// from silently overwriting newer cloud data.
const savePlannerScript = `
local raw = redis.call('GET', KEYS[1])
local version = ''

if raw then
  version = cjson.decode(raw).version
end

if version == ARGV[2] then
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  return {1, raw}
end

if version ~= ARGV[1] then
  return {0, raw or ''}
end

redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
return {1, ARGV[3]}
`

func (s *Service) SavePlanner(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	c.Request.Body = http.MaxBytesReader(
		c.Writer,
		c.Request.Body,
		3<<20,
	)

	var req struct {
		ExpectedVersion string          `json:"expected_version"`
		Version         string          `json:"version"`
		State           json.RawMessage `json:"state"`
	}

	if c.ShouldBindJSON(&req) != nil ||
		req.Version == "" ||
		len(req.Version) > 128 ||
		len(req.ExpectedVersion) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid planner save request",
		})
		return
	}

	if len(req.State) > 2<<20 {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{
			"error": "Planner snapshot exceeds 2 MiB",
		})
		return
	}

	var schema struct {
		Schema int `json:"schema"`
	}

	if json.Unmarshal(req.State, &schema) != nil ||
		schema.Schema != 1 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Unsupported planner state schema",
		})
		return
	}

	next := plannerSnapshot{
		Version:   req.Version,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
		State:     req.State,
	}

	encoded, err := json.Marshal(next)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid planner state",
		})
		return
	}

	var result []json.RawMessage

	if err := s.command(
		c.Request.Context(),
		&result,
		"EVAL",
		savePlannerScript,
		1,
		plannerKey(c),
		req.ExpectedVersion,
		req.Version,
		string(encoded),
		plannerSeconds,
	); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Planner store unavailable",
		})
		return
	}

	if len(result) != 2 {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Invalid planner store response",
		})
		return
	}

	var accepted int
	var raw string

	if json.Unmarshal(result[0], &accepted) != nil ||
		json.Unmarshal(result[1], &raw) != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "Invalid planner store response",
		})
		return
	}

	var snapshot *plannerSnapshot

	if raw != "" {
		snapshot = &plannerSnapshot{}

		if json.Unmarshal([]byte(raw), snapshot) != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Invalid stored planner state",
			})
			return
		}
	}

	if accepted == 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error":    "A newer cloud snapshot exists",
			"snapshot": snapshot,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"snapshot": snapshot,
	})
}
