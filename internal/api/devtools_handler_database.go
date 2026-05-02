package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
)

// ---------------------------------------------------------------------------
// Database endpoints
// ---------------------------------------------------------------------------

// DatabaseStats returns public table names, row counts, and database size.
func (h *DevToolsHandler) DatabaseStats(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	// Fetch public tables.
	rows, err := h.db.Pool.Query(ctx,
		"SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tables: "+err.Error())
		return
	}
	defer rows.Close()

	type tableInfo struct {
		Schema   string `json:"schema"`
		Name     string `json:"name"`
		RowCount int64  `json:"row_count"`
	}

	var tables []tableInfo
	for rows.Next() {
		var t tableInfo
		if err := rows.Scan(&t.Schema, &t.Name); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to scan table row: "+err.Error())
			return
		}
		tables = append(tables, t)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "row iteration error: "+err.Error())
		return
	}

	// Get row counts for each table.
	for i := range tables {
		query := fmt.Sprintf("SELECT COUNT(*) FROM %q.%q", tables[i].Schema, tables[i].Name)
		if err := h.db.Pool.QueryRow(ctx, query).Scan(&tables[i].RowCount); err != nil {
			log.Warn().Err(err).Str("table", tables[i].Name).Msg("failed to count rows")
		}
	}

	// Get total database size.
	var dbSize int64
	if err := h.db.Pool.QueryRow(ctx,
		"SELECT pg_database_size(current_database())").Scan(&dbSize); err != nil {
		log.Warn().Err(err).Msg("failed to get database size")
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"tables":        tables,
		"table_count":   len(tables),
		"database_size": dbSize,
	})
}

// MigrationStatus returns the current schema migration version.
func (h *DevToolsHandler) MigrationStatus(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var version int64
	var dirty bool
	err := h.db.Pool.QueryRow(ctx,
		"SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&version, &dirty)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read migration status: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version": version,
		"dirty":   dirty,
	})
}
