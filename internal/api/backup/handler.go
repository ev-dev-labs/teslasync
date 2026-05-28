package backup

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Handler exposes admin-style data-export endpoints: a JSON dump of
// every table in AllowedTables (ExportData) and aggregate row counts +
// database size (BackupStats). Both are mounted under /api/v1/system/*
// in router.go.
type Handler struct {
	db *database.DB
}

// NewHandler constructs a Handler bound to the given DB pool.
func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db}
}

// AllowedTables is the read-only whitelist of tables safe to export
// or query via ExportData / BackupStats. Anything outside this list is
// silently skipped — preventing accidental exposure of credential /
// session / audit tables through the admin export.
//
// Treat as read-only: the AllowedTables regression test in this
// package pins required entries (vehicles, drives, ...) and required
// absences (pg_shadow, tokens, ...). Mutating this map at runtime is
// not supported and will race with the handlers reading it.
var AllowedTables = map[string]bool{
	"vehicles": true, "drives": true, "charging_sessions": true,
	"positions": true, "addresses": true, "geofences": true,
	"alerts": true, "alert_rules": true, "settings": true,
	"daily_mileage": true, "vehicle_states": true, "software_updates": true,
	"signal_log": true, "vampire_drain_events": true,
	"visited_locations": true, "trips": true,
}

// ExportData emits a JSON document containing every row of every table
// in AllowedTables plus a _meta envelope (exported_at, version, table
// count). Streamed directly to the response writer with an
// attachment Content-Disposition so browsers save-as a file.
func (h *Handler) ExportData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	backup := make(map[string]interface{})

	for table := range AllowedTables {
		rows, err := h.db.Pool.Query(ctx, fmt.Sprintf(`SELECT row_to_json(t) FROM "%s" t`, table))
		if err != nil {
			log.Warn().Err(err).Str("table", table).Msg("backup: failed to export table")
			continue
		}

		var records []json.RawMessage
		for rows.Next() {
			var raw json.RawMessage
			if err := rows.Scan(&raw); err == nil {
				records = append(records, raw)
			}
		}
		rows.Close()

		if records == nil {
			records = []json.RawMessage{}
		}
		backup[table] = records
	}

	backup["_meta"] = map[string]interface{}{
		"exported_at": time.Now(),
		"version":     "0.3.0",
		"tables":      len(AllowedTables),
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=teslasync-backup-%s.json", time.Now().Format("2006-01-02")))
	if err := json.NewEncoder(w).Encode(backup); err != nil {
		log.Error().Err(err).Msg("backup: encode error")
	}
}

// BackupStats returns aggregate info for backup planning: pretty-printed
// database size, public-schema table count, and per-table row counts
// for every AllowedTables entry.
func (h *Handler) BackupStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var dbSize string
	if err := h.db.Pool.QueryRow(ctx, "SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&dbSize); err != nil && err != pgx.ErrNoRows {
		log.Warn().Err(err).Msg("backup: database size query failed")
	}

	var tableCount int
	if err := h.db.Pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Scan(&tableCount); err != nil && err != pgx.ErrNoRows {
		log.Warn().Err(err).Msg("backup: table count query failed")
	}

	tableCounts := make(map[string]int)
	for t := range AllowedTables {
		var count int
		if err := h.db.Pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM "%s"`, t)).Scan(&count); err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Str("table", t).Msg("backup: row count query failed")
		}
		tableCounts[t] = count
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"database_size": dbSize,
		"table_count":   tableCount,
		"row_counts":    tableCounts,
	})
}
