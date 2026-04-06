package api

import (
	"context"
	"crypto"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

type contextKey string

const authentikUserCtxKey contextKey = "authentik_user"

// AuthentikClaims represents the JWT claims from authentik.
type AuthentikClaims struct {
	Sub    string   `json:"sub"`
	Email  string   `json:"email"`
	Name   string   `json:"name"`
	Groups []string `json:"groups"`
	Exp    int64    `json:"exp"`
	Iat    int64    `json:"iat"`
	Iss    string   `json:"iss"`
}

// jwksCache caches the JWKS keys from authentik.
type jwksCache struct {
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
	jwksURL   string
	ttl       time.Duration
}

func newJWKSCache(jwksURL string) *jwksCache {
	return &jwksCache{
		keys:    make(map[string]*rsa.PublicKey),
		jwksURL: jwksURL,
		ttl:     5 * time.Minute,
	}
}

type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

func (c *jwksCache) getKey(kid string) (*rsa.PublicKey, error) {
	c.mu.RLock()
	if time.Since(c.fetchedAt) < c.ttl {
		if key, ok := c.keys[kid]; ok {
			c.mu.RUnlock()
			return key, nil
		}
	}
	c.mu.RUnlock()

	if err := c.refresh(); err != nil {
		return nil, fmt.Errorf("failed to refresh JWKS: %w", err)
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("key %q not found in JWKS", kid)
	}
	return key, nil
}

func (c *jwksCache) refresh() error {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(c.jwksURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned %d", resp.StatusCode)
	}

	var jwks jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return err
	}

	keys := make(map[string]*rsa.PublicKey, len(jwks.Keys))
	for _, k := range jwks.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := parseRSAPublicKey(k.N, k.E)
		if err != nil {
			log.Warn().Err(err).Str("kid", k.Kid).Msg("skipping invalid JWKS key")
			continue
		}
		keys[k.Kid] = pub
	}

	c.mu.Lock()
	c.keys = keys
	c.fetchedAt = time.Now()
	c.mu.Unlock()

	log.Info().Int("keys", len(keys)).Msg("refreshed JWKS cache")
	return nil
}

func parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nStr)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eStr)
	if err != nil {
		return nil, err
	}
	e := new(big.Int).SetBytes(eBytes)
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(e.Int64()),
	}, nil
}

// verifyJWT validates an authentik JWT without external dependencies.
// It checks the signature against the JWKS keys and validates expiry.
func verifyJWT(tokenStr string, cache *jwksCache) (*AuthentikClaims, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	// Decode header to get kid
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("invalid header encoding: %w", err)
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("invalid header: %w", err)
	}
	if header.Alg != "RS256" {
		return nil, fmt.Errorf("unsupported algorithm: %s", header.Alg)
	}

	// Get public key from JWKS
	pubKey, err := cache.getKey(header.Kid)
	if err != nil {
		return nil, err
	}

	// Verify signature
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("invalid signature encoding: %w", err)
	}
	signedContent := []byte(parts[0] + "." + parts[1])
	h := crypto.SHA256.New()
	h.Write(signedContent)
	if err := rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, h.Sum(nil), sigBytes); err != nil {
		return nil, fmt.Errorf("invalid signature: %w", err)
	}

	// Decode claims
	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("invalid claims encoding: %w", err)
	}
	var claims AuthentikClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return nil, fmt.Errorf("invalid claims: %w", err)
	}

	// Check expiry
	if claims.Exp > 0 && time.Now().Unix() > claims.Exp {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}

// AuthentikSSEAuth creates middleware that validates authentik JWT tokens
// for the SSE endpoint. It checks (in order):
//  1. X-authentik-jwt header (when behind ForwardAuth)
//  2. Authorization: Bearer <token> header
//  3. ?token= query parameter (for EventSource which can't set headers)
func AuthentikSSEAuth(jwksURL string) func(http.Handler) http.Handler {
	cache := newJWKSCache(jwksURL)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var token string

			// 1. Check X-authentik-jwt header (ForwardAuth path)
			if t := r.Header.Get("X-authentik-jwt"); t != "" {
				token = t
			}

			// 2. Check Authorization header
			if token == "" {
				if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
					token = strings.TrimPrefix(auth, "Bearer ")
				}
			}

			// 3. Check query parameter (EventSource fallback)
			if token == "" {
				token = r.URL.Query().Get("token")
			}

			if token == "" {
				http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
				return
			}

			claims, err := verifyJWT(token, cache)
			if err != nil {
				log.Warn().Err(err).Msg("SSE auth: invalid token")
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), authentikUserCtxKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SSETokenHandler returns the authentik JWT to the frontend.
// This endpoint MUST be behind authentik ForwardAuth so the
// X-authentik-jwt header is injected by Traefik.
func SSETokenHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("X-authentik-jwt")
		if token == "" {
			http.Error(w, `{"error":"no authentik token available"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": token})
	}
}
