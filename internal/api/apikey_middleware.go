package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"

	"github.com/ev-dev-labs/teslasync/internal/api/apiauthctx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// APIKeyAuth is middleware that authenticates requests via X-API-Key header.
// If no key is provided, the request passes through (Tesla OAuth may handle auth).
func APIKeyAuth(db *database.DB) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-API-Key")
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}

			hash := sha256Hex(key)
			apiKey, err := findAPIKeyByHash(db, r.Context(), hash)
			if err != nil || apiKey == nil {
				writeError(w, http.StatusUnauthorized, "invalid API key")
				return
			}

			if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
				writeError(w, http.StatusUnauthorized, "API key expired")
				return
			}

			_ = updateAPIKeyLastUsed(db, r.Context(), apiKey.ID)

			ctx := apiauthctx.WithPermissions(r.Context(), apiKey.Permissions)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// APIKeyAuthRequired is middleware that requires a valid X-API-Key header.
// Unlike APIKeyAuth (which passes through when no key is provided), this
// middleware rejects requests without a valid API key. Used for watch
// endpoints where OAuth is not available.
func APIKeyAuthRequired(db *database.DB) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get("X-API-Key")
			if key == "" {
				writeError(w, http.StatusUnauthorized, "API key required")
				return
			}

			hash := sha256Hex(key)
			apiKey, err := findAPIKeyByHash(db, r.Context(), hash)
			if err != nil || apiKey == nil {
				writeError(w, http.StatusUnauthorized, "invalid API key")
				return
			}

			if apiKey.ExpiresAt != nil && time.Now().After(*apiKey.ExpiresAt) {
				writeError(w, http.StatusUnauthorized, "API key expired")
				return
			}

			_ = updateAPIKeyLastUsed(db, r.Context(), apiKey.ID)

			ctx := apiauthctx.WithPermissions(r.Context(), apiKey.Permissions)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func findAPIKeyByHash(db *database.DB, ctx context.Context, hash string) (*authmodel.APIKey, error) {
	var k authmodel.APIKey
	err := db.Pool.QueryRow(ctx,
		`SELECT id, name, key_hash, key_prefix, permissions, last_used_at, created_at, expires_at
		 FROM api_keys WHERE key_hash = $1`, hash).Scan(
		&k.ID, &k.Name, &k.KeyHash, &k.KeyPrefix, &k.Permissions, &k.LastUsedAt, &k.CreatedAt, &k.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	return &k, nil
}

func updateAPIKeyLastUsed(db *database.DB, ctx context.Context, id int64) error {
	_, err := db.Pool.Exec(ctx, `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
