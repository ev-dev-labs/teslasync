package export

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ExportTableRow is one row of a table represented as a flat JSON object.
// Maps preserve column → value for CSV/JSON serialization without coupling
// the export pipeline to per-table Go models.
type ExportTableRow map[string]any

// ExportTableSnapshot is a paginated snapshot of an entire table fetched for
// a "Download my data" GDPR-style account export.
type ExportTableSnapshot struct {
	Table   string
	Columns []string
	Rows    []ExportTableRow
}

// AllowedAccountTables enumerates the tables included in account exports.
// Only safe, non-secret rows are listed — connection secrets and credentials
// are deliberately excluded. Order is the desired output order in the ZIP.
var AllowedAccountTables = []string{
	"vehicles",
	"drives",
	"charging_sessions",
	"positions",
	"addresses",
	"geofences",
	"alerts",
	"alert_rules",
	"settings",
	"daily_mileage",
	"vehicle_states",
	"software_updates",
	"vampire_drain_events",
	"signal_log",
	"visited_locations",
	"trips",
	"notifications",
	"notification_logs",
}

// FetchTableSnapshot returns rows for the named table. The query uses
// row_to_json so callers don't need to know per-table columns; the helper
// flattens each row into a string-keyed map. Rows are capped by maxRows to
// avoid unbounded memory growth on large hypertables like signal_log.
//
// The table name is checked against AllowedAccountTables to prevent SQL
// injection from caller-supplied identifiers; pgx parameters cannot be
// used for table names.
func FetchTableSnapshot(ctx context.Context, db *database.DB, table string, maxRows int) (*ExportTableSnapshot, error) {
	if !isAllowedAccountTable(table) {
		return nil, fmt.Errorf("table %q is not allowed for account export", table)
	}
	if maxRows <= 0 {
		maxRows = 10_000
	}

	// row_to_json yields a JSON object; LIMIT bounds the result set.
	// We intentionally use fmt.Sprintf for the table name (validated above)
	// because identifiers can't be parameterised.
	q := fmt.Sprintf(`SELECT row_to_json(t) FROM "%s" t LIMIT %d`, table, maxRows)
	rows, err := db.Pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", table, err)
	}
	defer rows.Close()

	snap := &ExportTableSnapshot{Table: table}
	colSeen := map[string]struct{}{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan %s: %w", table, err)
		}
		row := ExportTableRow{}
		if err := json.Unmarshal(raw, &row); err != nil {
			return nil, fmt.Errorf("decode %s row: %w", table, err)
		}
		for k := range row {
			if _, ok := colSeen[k]; !ok {
				colSeen[k] = struct{}{}
				snap.Columns = append(snap.Columns, k)
			}
		}
		snap.Rows = append(snap.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s: %w", table, err)
	}

	return snap, nil
}

// FetchTableSnapshotForVehicle is the same as FetchTableSnapshot but filters
// by vehicle_id when the table has that column. Tables without a vehicle_id
// column (e.g. settings, geofences, addresses) return all rows.
func FetchTableSnapshotForVehicle(ctx context.Context, db *database.DB, table string, vehicleID int64, maxRows int) (*ExportTableSnapshot, error) {
	if !isAllowedAccountTable(table) {
		return nil, fmt.Errorf("table %q is not allowed for account export", table)
	}
	if maxRows <= 0 {
		maxRows = 10_000
	}

	hasVehicle, err := tableHasColumn(ctx, db, table, "vehicle_id")
	if err != nil {
		return nil, err
	}
	if !hasVehicle {
		return FetchTableSnapshot(ctx, db, table, maxRows)
	}

	q := fmt.Sprintf(`SELECT row_to_json(t) FROM "%s" t WHERE vehicle_id = $1 LIMIT %d`, table, maxRows)
	rows, err := db.Pool.Query(ctx, q, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", table, err)
	}
	defer rows.Close()

	snap := &ExportTableSnapshot{Table: table}
	colSeen := map[string]struct{}{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan %s: %w", table, err)
		}
		row := ExportTableRow{}
		if err := json.Unmarshal(raw, &row); err != nil {
			return nil, fmt.Errorf("decode %s row: %w", table, err)
		}
		for k := range row {
			if _, ok := colSeen[k]; !ok {
				colSeen[k] = struct{}{}
				snap.Columns = append(snap.Columns, k)
			}
		}
		snap.Rows = append(snap.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate %s: %w", table, err)
	}
	return snap, nil
}

// CountTableRows returns an approximate row count for the table. Used by the
// frontend to surface a size estimate before the user confirms a large export.
func CountTableRows(ctx context.Context, db *database.DB, table string) (int64, error) {
	if !isAllowedAccountTable(table) {
		return 0, fmt.Errorf("table %q is not allowed for account export", table)
	}
	var n int64
	q := fmt.Sprintf(`SELECT COUNT(*) FROM "%s"`, table)
	if err := db.Pool.QueryRow(ctx, q).Scan(&n); err != nil {
		return 0, fmt.Errorf("count %s: %w", table, err)
	}
	return n, nil
}

func isAllowedAccountTable(table string) bool {
	for _, t := range AllowedAccountTables {
		if t == table {
			return true
		}
	}
	return false
}

func tableHasColumn(ctx context.Context, db *database.DB, table, column string) (bool, error) {
	var exists bool
	err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = $1 AND column_name = $2
		)`, table, column).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("check column %s.%s: %w", table, column, err)
	}
	return exists, nil
}
