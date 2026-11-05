package devtools

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// DatabaseStats returns public table metadata, estimated row counts, and database size.
func (h *DevToolsHandler) DatabaseStats(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "devtools.DatabaseStats")
	defer span.End()
	if h.dbStatsRepo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	stats, err := h.dbStatsRepo.Stats(ctx)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to read database statistics")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read database statistics")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

// MigrationStatus returns the current schema migration version.
func (h *DevToolsHandler) MigrationStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var version int64
	var dirty bool
	err := h.db.Pool.QueryRow(ctx,
		"SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version, &dirty)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read migration status: "+err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"version": version,
		"dirty":   dirty,
	})
}
