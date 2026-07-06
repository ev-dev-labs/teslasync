package user

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Handler handles user authentication with simple HMAC-based tokens.
// When AUTH_ENABLED is false (default for self-hosted), all endpoints are
// accessible without authentication.
type Handler struct {
	db        *database.DB
	jwtSecret []byte
	// now is injectable so token issuance and expiry checks are
	// deterministic under test. Defaults to time.Now in NewHandler.
	now func() time.Time
}

// NewHandler creates a Handler. If jwtSecret is empty, a random
// 32-byte secret is generated (tokens will not survive server restarts).
func NewHandler(db *database.DB, jwtSecret string) *Handler {
	secret := []byte(jwtSecret)
	if len(secret) == 0 {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = b
	}
	return &Handler{db: db, jwtSecret: secret, now: time.Now}
}

// clock returns the handler's time source, falling back to time.Now for
// zero-value Handlers constructed without NewHandler.
func (h *Handler) clock() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

type userClaims struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	Exp      int64  `json:"exp"`
}

type contextKey string

const userContextKey contextKey = "user"

// Login validates credentials and returns an HMAC-signed token.
// For the initial release only a single admin account is supported.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Username != "admin" {
		httpx.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	exp := h.clock().Add(24 * time.Hour)
	token, err := h.signToken(userClaims{
		UserID:   1,
		Username: body.Username,
		Role:     "admin",
		Exp:      exp.Unix(),
	})
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"token":   token,
		"user":    body.Username,
		"role":    "admin",
		"expires": exp,
	})
}

// Me returns the authenticated user's info, or authenticated: false.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*userClaims)
	if !ok {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"authenticated": false,
		})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"authenticated": true,
		"user_id":       claims.UserID,
		"username":      claims.Username,
		"role":          claims.Role,
	})
}

// AuthMiddleware extracts and validates the Bearer token, injecting claims
// into the request context. If the token is missing or invalid the request
// is rejected with 401.
func (h *Handler) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			httpx.WriteError(w, http.StatusUnauthorized, "missing or invalid authorization header")
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")

		claims, err := h.verifyToken(tokenStr)
		if err != nil {
			httpx.WriteError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		ctx := context.WithValue(r.Context(), userContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// OptionalAuthMiddleware is like AuthMiddleware but does not reject
// unauthenticated requests — it simply attaches claims when present.
func (h *Handler) OptionalAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			tokenStr := strings.TrimPrefix(auth, "Bearer ")
			if claims, err := h.verifyToken(tokenStr); err == nil {
				ctx := context.WithValue(r.Context(), userContextKey, claims)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// signToken produces payload.signature using HMAC-SHA256.
func (h *Handler) signToken(c userClaims) (string, error) {
	payload, err := json.Marshal(c)
	if err != nil {
		return "", fmt.Errorf("marshal claims: %w", err)
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	sig := h.hmacSign(payloadB64)
	return payloadB64 + "." + sig, nil
}

// verifyToken validates and decodes a token string.
func (h *Handler) verifyToken(token string) (*userClaims, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("malformed token")
	}
	payloadB64, sig := parts[0], parts[1]

	expected := h.hmacSign(payloadB64)
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return nil, fmt.Errorf("invalid signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}

	var c userClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, fmt.Errorf("unmarshal claims: %w", err)
	}

	if h.clock().Unix() > c.Exp {
		return nil, fmt.Errorf("token expired")
	}

	return &c, nil
}

func (h *Handler) hmacSign(data string) string {
	mac := hmac.New(sha256.New, h.jwtSecret)
	mac.Write([]byte(data))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
