package signal

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

// SignalHistoryRow represents a single signal value at a point in time.
//
// Phase-42 / per-field MQTT cutover: this struct is now READ-ONLY — the
// legacy buffered Append + FlushLoop write path was deleted because the
// Phase-42a router writer (`internal/tesla/router/writers/signal_log_writer.go`)
// is the canonical signal_log writer and used the new schema (vehicle_id,
// ts, field, value_kind, str_value, bool_value, int_value, float_value,
// time_value). The old write path used pre-Phase-42 column names
// (`signal`, `value_num`, `value_str`, `value_bool`, `value_jsonb`,
// `created_at`) and never succeeded after the schema migration; rows
// were re-cycled through a Redis backlog that produced continuous
// `column "signal" of relation "signal_log" does not exist` log spam.
//
// The struct field names + JSON tags below are kept for backward compat
// with the API response shapes that consume `GetHistory` / `Query`.
type SignalHistoryRow struct {
	VehicleID  int64
	Signal     string
	ValueNum   *float64
	ValueStr   *string
	ValueBool  *bool
	ValueJsonb *string
	CreatedAt  time.Time
}

// SignalHistoryWriter is the read-only accessor for the signal_log
// hypertable. The legacy buffered write path (Append + FlushLoop +
// Redis backlog) was removed as part of the Phase-42 / per-field MQTT
// cutover — see `internal/tesla/router/writers/signal_log_writer.go`
// for the canonical writer.
type SignalHistoryWriter struct {
	db *database.DB
}

// NewSignalHistoryWriter constructs a read-only signal_log accessor.
// The legacy `flushInterval` and `rdb` parameters were dropped — the
// constructor now takes only the DB pool.
func NewSignalHistoryWriter(db *database.DB) *SignalHistoryWriter {
	return &SignalHistoryWriter{db: db}
}

// Cleanup deletes rows older than the retention period.
//
// Phase-42 schema: signal_log uses `ts` (TIMESTAMPTZ) as the row timestamp;
// the legacy `created_at` column no longer exists.
func (w *SignalHistoryWriter) Cleanup(ctx context.Context, retentionDays int) {
	result, err := w.db.Pool.Exec(ctx,
		"DELETE FROM signal_log WHERE ts < NOW() - $1::interval",
		fmt.Sprintf("%d days", retentionDays))
	if err != nil {
		log.Warn().Err(err).Msg("signal_log: TTL cleanup failed")
		return
	}
	log.Info().Int64("deleted", result.RowsAffected()).Int("retention_days", retentionDays).Msg("signal_log: TTL cleanup")
}

// GetHistory returns time-series data for a single signal within a date range.
// Results are ordered by ts ASC for chart rendering.
//
// Phase-42 schema: SELECT ts/field/str_value/bool_value/COALESCE(float_value,
// int_value::float8); the legacy created_at/signal/value_num/value_str/
// value_bool columns no longer exist.
func (w *SignalHistoryWriter) GetHistory(ctx context.Context, vehicleID int64, signalName string, from, to time.Time, limit int) ([]SignalHistoryRow, error) {
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}
	query := `SELECT vehicle_id, field, COALESCE(float_value, int_value::float8), str_value, bool_value, ts
	          FROM signal_log
	          WHERE vehicle_id = $1 AND field = $2 AND ts BETWEEN $3 AND $4
	          ORDER BY ts ASC
	          LIMIT $5`
	rows, err := w.db.Pool.Query(ctx, query, vehicleID, signalName, from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []SignalHistoryRow
	for rows.Next() {
		var r SignalHistoryRow
		if err := rows.Scan(&r.VehicleID, &r.Signal, &r.ValueNum, &r.ValueStr, &r.ValueBool, &r.CreatedAt); err != nil {
			return nil, err
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetGlobalStats returns total signal count and date range for a vehicle.
//
// Phase-42 schema: signal_log uses `ts` as the row timestamp.
func (w *SignalHistoryWriter) GetGlobalStats(ctx context.Context, vehicleID int64) (int64, *time.Time, *time.Time, error) {
	var count int64
	var oldest, newest *time.Time
	err := w.db.Pool.QueryRow(ctx,
		`SELECT COUNT(*), MIN(ts), MAX(ts)
		 FROM signal_log WHERE vehicle_id = $1`, vehicleID).Scan(&count, &oldest, &newest)
	return count, oldest, newest, err
}

// SignalHistoryEntry is a single row from signal_log for API responses.
type SignalHistoryEntry struct {
	Signal    string    `json:"signal"`
	ValueNum  *float64  `json:"value_num,omitempty"`
	ValueStr  *string   `json:"value_str,omitempty"`
	ValueBool *bool     `json:"value_bool,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Query returns signal history rows with pagination.
//
// Phase-42 schema: ts/field/str_value/bool_value/COALESCE(float_value,
// int_value::float8).
func (w *SignalHistoryWriter) Query(ctx context.Context, vehicleID int64, signals []string, from, to time.Time, page, perPage int) ([]SignalHistoryEntry, int64, error) {
	if perPage <= 0 {
		perPage = 50
	}
	if perPage > 100 {
		perPage = 100
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * perPage

	var total int64
	err := w.db.Pool.QueryRow(ctx,
		"SELECT COUNT(*) FROM signal_log WHERE vehicle_id = $1 AND field = ANY($2) AND ts BETWEEN $3 AND $4",
		vehicleID, signals, from, to).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	rows, err := w.db.Pool.Query(ctx,
		`SELECT field, COALESCE(float_value, int_value::float8), str_value, bool_value, ts
		 FROM signal_log
		 WHERE vehicle_id = $1 AND field = ANY($2) AND ts BETWEEN $3 AND $4
		 ORDER BY ts DESC LIMIT $5 OFFSET $6`,
		vehicleID, signals, from, to, perPage, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := make([]SignalHistoryEntry, 0)
	for rows.Next() {
		var e SignalHistoryEntry
		if err := rows.Scan(&e.Signal, &e.ValueNum, &e.ValueStr, &e.ValueBool, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		entries = append(entries, e)
	}
	return entries, total, rows.Err()
}

// AvailableSignals returns distinct signal names for a vehicle.
//
// Phase-42 schema: signal_log column is `field`, not `signal`.
func (w *SignalHistoryWriter) AvailableSignals(ctx context.Context, vehicleID int64) ([]string, error) {
	rows, err := w.db.Pool.Query(ctx,
		"SELECT DISTINCT field FROM signal_log WHERE vehicle_id = $1 ORDER BY field",
		vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	signals := make([]string, 0)
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		signals = append(signals, s)
	}
	return signals, rows.Err()
}

// SignalStats holds min/max/avg/count for a signal.
type SignalStats struct {
	Signal string  `json:"signal"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Avg    float64 `json:"avg"`
	Count  int64   `json:"count"`
}

// Stats returns aggregate stats per signal using the cagg_signal_hourly continuous aggregate.
func (w *SignalHistoryWriter) Stats(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalStats, error) {
	rows, err := w.db.Pool.Query(ctx,
		`SELECT signal_name, COALESCE(MIN(min_value), 0), COALESCE(MAX(max_value), 0),
		        COALESCE(SUM(avg_value * sample_count) / NULLIF(SUM(sample_count), 0), 0), COALESCE(SUM(sample_count), 0)
		 FROM cagg_signal_hourly
		 WHERE vehicle_id = $1 AND signal_name = ANY($2) AND hour >= $3 AND hour < $4
		 GROUP BY signal_name ORDER BY signal_name`,
		vehicleID, signals, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]SignalStats, 0)
	for rows.Next() {
		var s SignalStats
		if err := rows.Scan(&s.Signal, &s.Min, &s.Max, &s.Avg, &s.Count); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, rows.Err()
}
