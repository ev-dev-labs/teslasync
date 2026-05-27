package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// APIKeyHandler handles API key management endpoints.
type APIKeyHandler struct {
	db                *database.DB
	forwardAuthHeader string
}

// NewAPIKeyHandler creates a new APIKeyHandler.
//
// forwardAuthHeader names the request header (e.g. X-Forwarded-User) that the
// reverse-proxy auth provider injects; when set it is used as the actor on
// emitted audit_logs entries so they appear in /users/me/activity.
func NewAPIKeyHandler(db *database.DB, forwardAuthHeader string) *APIKeyHandler {
	return &APIKeyHandler{db: db, forwardAuthHeader: forwardAuthHeader}
}

// List returns all API keys (without the hash).
func (h *APIKeyHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, name, key_prefix, permissions, last_used_at, created_at, expires_at FROM api_keys ORDER BY created_at DESC`)
	if err != nil {
		// Table may not exist yet — return empty array gracefully
		writeJSON(w, http.StatusOK, []struct{}{})
		return
	}
	defer rows.Close()

	type apiKeyRow struct {
		ID          int64      `json:"id"`
		Name        string     `json:"name"`
		KeyPrefix   string     `json:"key_prefix"`
		Permissions string     `json:"permissions"`
		LastUsedAt  *time.Time `json:"last_used_at"`
		CreatedAt   time.Time  `json:"created_at"`
		ExpiresAt   *time.Time `json:"expires_at"`
	}

	keys := []apiKeyRow{}
	for rows.Next() {
		var k apiKeyRow
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPrefix, &k.Permissions, &k.LastUsedAt, &k.CreatedAt, &k.ExpiresAt); err != nil {
			continue
		}
		keys = append(keys, k)
	}
	writeJSON(w, http.StatusOK, keys)
}

// Create generates a new API key, stores its hash, and returns the raw key once.
func (h *APIKeyHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Permissions string `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	perm := body.Permissions
	if perm == "" {
		perm = "read"
	}
	validPerms := map[string]bool{"read": true, "read-write": true, "admin": true}
	if !validPerms[perm] {
		writeError(w, http.StatusBadRequest, "permissions must be read, read-write, or admin")
		return
	}

	rawBytes := make([]byte, 32)
	if _, err := rand.Read(rawBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate key")
		return
	}
	rawKey := "ts_" + hex.EncodeToString(rawBytes)
	prefix := rawKey[:10] + "..."
	hash := sha256Hex(rawKey)

	var id int64
	err := h.db.Pool.QueryRow(r.Context(),
		`INSERT INTO api_keys (name, key_hash, key_prefix, permissions, created_at)
		 VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
		name, hash, prefix, perm).Scan(&id)
	if err != nil {
		log.Error().Err(err).Msg("failed to create API key")
		writeError(w, http.StatusInternalServerError, "failed to create API key")
		return
	}

	logAuditFromRequest(h.db, r, h.forwardAuthHeader, "create", "api_key", &id, fmt.Sprintf("created key %q", name))

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":          id,
		"key":         rawKey,
		"name":        name,
		"key_prefix":  prefix,
		"permissions": perm,
	})
}

// Delete removes an API key by ID.
func (h *APIKeyHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	_, err = h.db.Pool.Exec(r.Context(), `DELETE FROM api_keys WHERE id = $1`, id)
	if err != nil {
		log.Error().Err(err).Msg("failed to delete API key")
		writeError(w, http.StatusInternalServerError, "failed to delete API key")
		return
	}
	logAuditFromRequest(h.db, r, h.forwardAuthHeader, "delete", "api_key", &id, fmt.Sprintf("deleted key id=%d", id))
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Revoke marks an API key as expired (sets expires_at to now).
func (h *APIKeyHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key ID")
		return
	}
	_, err = h.db.Pool.Exec(r.Context(), `UPDATE api_keys SET expires_at = NOW() WHERE id = $1`, id)
	if err != nil {
		log.Error().Err(err).Msg("failed to revoke API key")
		writeError(w, http.StatusInternalServerError, "failed to revoke API key")
		return
	}
	logAuditFromRequest(h.db, r, h.forwardAuthHeader, "update", "api_key", &id, fmt.Sprintf("revoked key id=%d", id))
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
