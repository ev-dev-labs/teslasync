package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	authmodel "github.com/ev-dev-labs/teslasync/internal/models/auth"
	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/api/apiauthctx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
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

// AppTokenAuth is middleware that authenticates requests via
// `Authorization: Bearer` app-bound API keys (see Handler.Create with
// `"app_token": true` and migration 000254). It lets the generic native
// apps sign in to any self-hosted server as the key owner's subject.
//
// Behaviour:
//
//   - No Authorization header, or a non-Bearer scheme: passthrough.
//     Browser sessions, proxy headers, and open mode are untouched.
//   - Open mode (headerName == ""): Bearer tokens are ignored — there is
//     no identity to bind them to and nothing to protect.
//   - Valid Bearer app key: the key's subject is injected as the forward
//     auth header so every downstream consumer (ForwardAuthMiddleware,
//     RequireSubjectMiddleware, handlers reading the header) works
//     unchanged, and the request context is flagged so the session
//     tracker skips cookie minting.
//   - Invalid, expired, device-scoped, or conflicting Bearer token: 401
//     fail-closed. A wrong token must never fall through to anonymous
//     access. Device-scoped keys (subject NULL) stay X-API-Key /
//     /watch-only exactly as before.
//
// Mount on the /api/v1 group after APICallLog (so 401s are captured)
// but before ForwardAuthMiddleware.
func AppTokenAuth(db *database.DB, headerName string) func(http.Handler) http.Handler {
	var q database.DBTX
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return appTokenAuth(q, headerName)
}

// appTokenAuth is the querier-injecting constructor shared by
// AppTokenAuth and tests.
func appTokenAuth(q database.DBTX, headerName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("Authorization")
			if raw == "" {
				next.ServeHTTP(w, r)
				return
			}
			scheme, token, _ := strings.Cut(raw, " ")
			if scheme != "Bearer" || strings.TrimSpace(token) == "" {
				next.ServeHTTP(w, r)
				return
			}
			if headerName == "" {
				// Open mode: nothing to bind the token to.
				next.ServeHTTP(w, r)
				return
			}
			if q == nil {
				writeError(w, http.StatusServiceUnavailable, "database not available")
				return
			}

			var id int64
			var subject string
			err := q.QueryRow(r.Context(),
				`SELECT id, COALESCE(subject, '') FROM api_keys
				 WHERE key_hash = $1 AND permissions = 'admin'
				   AND (expires_at IS NULL OR expires_at > NOW())`,
				sha256Hex(strings.TrimSpace(token))).Scan(&id, &subject)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				writeError(w, http.StatusServiceUnavailable, "token lookup unavailable")
				return
			}
			if err != nil || subject == "" {
				// Deliberately one message for unknown vs expired vs
				// device-scoped so the endpoint is not a
				// token-validity oracle.
				writeError(w, http.StatusUnauthorized, "invalid or expired access token")
				return
			}
			if existing := strings.TrimSpace(r.Header.Get(headerName)); existing != "" &&
				subtle.ConstantTimeCompare([]byte(existing), []byte(subject)) != 1 {
				// Proxy says one user, token says another — refuse
				// rather than guess which identity wins.
				writeError(w, http.StatusUnauthorized, "conflicting identities")
				return
			}

			_, _ = q.Exec(r.Context(), `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, id)

			r.Header.Set(headerName, subject)
			ctx := tsauth.WithAppTokenSubject(r.Context(), subject)
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
