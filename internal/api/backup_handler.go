package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/teslasync/teslasync/internal/database"
)

// BackupHandler provides endpoints for database backup and restore operations.
type BackupHandler struct {
	db *database.DB
}

// NewBackupHandler creates a new BackupHandler.
func NewBackupHandler(db *database.DB) *BackupHandler {
	return &BackupHandler{db: db}
}

// ExportData exports all data as JSON for backup.
func (h *BackupHandler) ExportData(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	backup := make(map[string]interface{})

	tables := []string{"vehicles", "drives", "charging_sessions", "positions", "addresses",
		"geofences", "alerts", "alert_rules", "settings", "daily_mileage",
		"vehicle_states", "software_updates", "tire_pressure_snapshots",
		"vampire_drain_events", "visited_locations", "trips"}

	for _, table := range tables {
		rows, err := h.db.Pool.Query(ctx, fmt.Sprintf("SELECT row_to_json(t) FROM %s t", table))
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
		"version":     "0.1.0",
		"tables":      len(tables),
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
	_ = h.db.Pool.QueryRow(ctx, "SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&dbSize)

	var tableCount int
	_ = h.db.Pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Scan(&tableCount)

	tableCounts := make(map[string]int)
	tables := []string{"vehicles", "drives", "charging_sessions", "positions", "alerts", "daily_mileage"}
	for _, t := range tables {
		var count int
		_ = h.db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM %s", t)).Scan(&count)
		tableCounts[t] = count
	}

	writeJSON(w, 200, map[string]interface{}{
		"database_size": dbSize,
		"table_count":   tableCount,
		"row_counts":    tableCounts,
	})
}
