package api

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// logAudit records an audit log entry for a mutation action.
func logAudit(db *database.DB, ctx context.Context, action, resource, details, ip string) {
	query := `INSERT INTO audit_logs (action, resource, details, ip, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := db.Pool.Exec(ctx, query, action, resource, details, ip, time.Now().UTC())
	if err != nil {
		log.Warn().Err(err).Str("action", action).Str("resource", resource).Msg("failed to write audit log")
	}
}

// AuditHandler handles audit log endpoints.
type AuditHandler struct {
	db *database.DB
}

// NewAuditHandler creates a new AuditHandler.
func NewAuditHandler(db *database.DB) *AuditHandler {
	return &AuditHandler{db: db}
}

// List returns recent audit log entries.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := pagination(r)
	if limit > 200 {
		limit = 200
	}

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, action, resource, details, ip, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		// Table may not exist yet — return empty array instead of 500
		// to avoid tripping the frontend circuit breaker
		writeJSON(w, http.StatusOK, []models.AuditLog{})
		return
	}
	defer rows.Close()

	logs := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.Action, &l.Resource, &l.Details, &l.IP, &l.CreatedAt); err != nil {
			continue
		}
		logs = append(logs, l)
	}
	writeJSON(w, http.StatusOK, logs)
}
