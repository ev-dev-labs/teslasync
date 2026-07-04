package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// dbOpTimeout bounds every database round-trip so a stalled pool never
// pins a request goroutine open indefinitely when the client does not
// cancel. It is derived from the inbound request context so caller
// cancellation still wins when it fires first.
const dbOpTimeout = 10 * time.Second

// maxKeyNameLen mirrors the api_keys.name VARCHAR(255) column. Names
// longer than this are rejected with a 400 up front rather than surfacing
// as an opaque 500 from a Postgres length-constraint violation.
const maxKeyNameLen = 255

// randReader is the entropy source used to mint raw API keys. It defaults
// to crypto/rand.Reader (crypto/rand.Read is itself io.ReadFull(Reader,…))
// and is a package-private seam so tests can exercise the
// key-generation-failure branch without a live CSPRNG fault.
var randReader io.Reader = rand.Reader

// Handler handles API key management endpoints.
type Handler struct {
	db                database.DBTX
	forwardAuthHeader string
	audit             AuditFunc
}

// AuditFunc is the audit-logging callback shape expected by Handler.
type AuditFunc func(r *http.Request, headerName, action, resource string, entityID *int64, detail string)

// Option mutates a Handler during construction.
type Option func(*Handler)

// WithAuditFunc installs the audit callback invoked after successful mutations.
func WithAuditFunc(f AuditFunc) Option { return func(h *Handler) { h.audit = f } }

// NewHandler creates a new Handler.
//
// forwardAuthHeader names the request header (e.g. X-Forwarded-User) that the
// reverse-proxy auth provider injects; when set it is used as the actor on
// emitted audit_logs entries so they appear in /users/me/activity.
//
// A nil db (or a db with a nil pool) is tolerated: the mutating endpoints
// degrade to 503 and List degrades to an empty array rather than panicking.
func NewHandler(db *database.DB, forwardAuthHeader string, opts ...Option) *Handler {
	var q database.DBTX
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return newHandler(q, forwardAuthHeader, opts...)
}

// newHandler is the querier-injecting constructor shared by NewHandler and
// tests. Keeping the option-application logic here lets tests drive the
// handler against a fake database.DBTX without a live pool.
func newHandler(q database.DBTX, forwardAuthHeader string, opts ...Option) *Handler {
	h := &Handler{db: q, forwardAuthHeader: forwardAuthHeader}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	return h
}

// apiKeyRow is the redacted wire shape returned by List — deliberately
// omits key_hash so a stored secret is never echoed back.
type apiKeyRow struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	KeyPrefix   string     `json:"key_prefix"`
	Permissions string     `json:"permissions"`
	LastUsedAt  *time.Time `json:"last_used_at"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

// List returns all API keys (without the hash).
//
// The endpoint is deliberately forgiving: a missing table, a query error,
// or an absent database all resolve to an empty JSON array (HTTP 200) so a
// fresh install's settings dashboard renders instead of erroring. Errors
// are logged at debug for operators without breaking the UI contract.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		httpx.WriteJSON(w, http.StatusOK, []apiKeyRow{})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
	defer cancel()

	rows, err := h.db.Query(ctx,
		`SELECT id, name, key_prefix, permissions, last_used_at, created_at, expires_at FROM api_keys ORDER BY created_at DESC`)
	if err != nil {
		// Table may not exist yet — return empty array gracefully.
		log.Debug().Err(err).Msg("apikey: list query failed, returning empty array")
		httpx.WriteJSON(w, http.StatusOK, []apiKeyRow{})
		return
	}
	defer rows.Close()

	keys := []apiKeyRow{}
	for rows.Next() {
		var k apiKeyRow
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &k.Permissions, &k.LastUsedAt, &k.CreatedAt, &k.ExpiresAt); err != nil {
			log.Debug().Err(err).Msg("apikey: skipping unscannable api_keys row")
			continue
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		log.Debug().Err(err).Int("scanned", len(keys)).Msg("apikey: rows iteration ended in error")
	}
	httpx.WriteJSON(w, http.StatusOK, keys)
}

// Create generates a new API key, stores its hash, and returns the raw key once.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Permissions string `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		httpx.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(name) > maxKeyNameLen {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("name must be at most %d characters", maxKeyNameLen))
		return
	}
	perm := body.Permissions
	if perm == "" {
		perm = "read"
	}
	validPerms := map[string]bool{"read": true, "read-write": true, "admin": true}
	if !validPerms[perm] {
		httpx.WriteError(w, http.StatusBadRequest, "permissions must be read, read-write, or admin")
		return
	}

	if h.db == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	rawBytes := make([]byte, 32)
	if _, err := io.ReadFull(randReader, rawBytes); err != nil {
		log.Error().Err(err).Msg("apikey: failed to read entropy for new key")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	rawKey := "ts_" + hex.EncodeToString(rawBytes)
	prefix := rawKey[:10] + "..."
	hash := sha256Hex(rawKey)

	ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
	defer cancel()

	var id int64
	err := h.db.QueryRow(ctx,
		`INSERT INTO api_keys (name, key_hash, key_prefix, permissions, created_at)
		 VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
		name, hash, prefix, perm).Scan(&id)
	if err != nil {
		log.Error().Err(err).Str("name", name).Str("permissions", perm).Msg("apikey: failed to create API key")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create API key")
		return
	}

	h.logAudit(r, "create", &id, fmt.Sprintf("created key %q", name))

	httpx.WriteJSON(w, http.StatusCreated, map[string]interface{}{
		"id":          id,
		"key":         rawKey,
		"name":        name,
		"key_prefix":  prefix,
		"permissions": perm,
	})
}

// Delete removes an API key by ID.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	if h.db == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
	defer cancel()

	if _, err = h.db.Exec(ctx, `DELETE FROM api_keys WHERE id = $1`, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("apikey: failed to delete API key")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete API key")
		return
	}
	h.logAudit(r, "delete", &id, fmt.Sprintf("deleted key id=%d", id))
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Revoke marks an API key as expired (sets expires_at to now).
func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	if h.db == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
	defer cancel()

	if _, err = h.db.Exec(ctx, `UPDATE api_keys SET expires_at = NOW() WHERE id = $1`, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("apikey: failed to revoke API key")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to revoke API key")
		return
	}
	h.logAudit(r, "update", &id, fmt.Sprintf("revoked key id=%d", id))
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func (h *Handler) logAudit(r *http.Request, action string, entityID *int64, detail string) {
	if h.audit == nil {
		return
	}
	h.audit(r, h.forwardAuthHeader, action, "api_key", entityID, detail)
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
