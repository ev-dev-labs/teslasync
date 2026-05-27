package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// BackupHandler provides endpoints for database backup and restore operations.
type BackupHandler struct {
	db *database.DB
}

// NewBackupHandler creates a new BackupHandler.
func NewBackupHandler(db *database.DB) *BackupHandler {
	return &BackupHandler{db: db}
}

// allowedBackupTables is a whitelist of tables safe to export/query.
var allowedBackupTables = map[string]bool{
	"vehicles": true, "drives": true, "charging_sessions": true,
	"positions": true, "addresses": true, "geofences": true,
	"alerts": true, "alert_rules": true, "settings": true,
	"daily_mileage": true, "vehicle_states": true, "software_updates": true,
	"signal_log": true, "vampire_drain_events": true,
	"visited_locations": true, "trips": true,
}

// ExportData exports all data as JSON for backup.
func (h *BackupHandler) ExportData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	backup := make(map[string]interface{})

	for table := range allowedBackupTables {
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
		"tables":      len(allowedBackupTables),
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=teslasync-backup-%s.json", time.Now().Format("2006-01-02")))
	if err := json.NewEncoder(w).Encode(backup); err != nil {
		log.Error().Err(err).Msg("backup: encode error")
	}
}

// BackupStats returns info about the database for backup planning.
func (h *BackupHandler) BackupStats(w http.ResponseWriter, r *http.Request) {
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
	for t := range allowedBackupTables {
		var count int
		if err := h.db.Pool.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM "%s"`, t)).Scan(&count); err != nil && err != pgx.ErrNoRows {
			log.Warn().Err(err).Str("table", t).Msg("backup: row count query failed")
		}
		tableCounts[t] = count
	}

	writeJSON(w, 200, map[string]interface{}{
		"database_size": dbSize,
		"table_count":   tableCount,
		"row_counts":    tableCounts,
	})
}
