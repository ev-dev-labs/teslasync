package api

import (
	"net/http"
	"runtime"
	"time"

	"github.com/teslasync/teslasync/internal/database"
)

var startTime = time.Now()

// version is the application version, set at build time or defaulted.
var version = "2.0.0"

// DatabaseSize returns database size and table count information.
func DatabaseSize(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var size string
		err := db.Pool.QueryRow(r.Context(),
			"SELECT pg_size_pretty(pg_database_size(current_database()))").Scan(&size)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get database size")
			return
		}

		var tableCount int
		_ = db.Pool.QueryRow(r.Context(),
			"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Scan(&tableCount)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"database_size": size,
			"table_count":   tableCount,
		})
	}
}

// SystemInfo returns system runtime information.
func SystemInfo(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"version":        version,
		"go_version":     runtime.Version(),
		"os":             runtime.GOOS,
		"arch":           runtime.GOARCH,
		"goroutines":     runtime.NumGoroutine(),
		"uptime_seconds": time.Since(startTime).Seconds(),
	})
}
