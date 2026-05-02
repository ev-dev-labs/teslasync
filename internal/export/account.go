package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// processAccount produces a GDPR-style ZIP export with one CSV per allowed
// table, plus a manifest.json describing the scope and schema version. The
// archive is generated entirely in memory; callers should stream it to the
// client immediately to keep peak RSS bounded. Per-table row counts are
// capped by MaxAccountRowsPerTable.
func (p *Processor) processAccount(ctx context.Context, req *models.ExportJobRequest) (*ProcessResult, error) {
	if p.db == nil {
		return nil, fmt.Errorf("processAccount: db is nil")
	}

	type tableMeta struct {
		Table       string `json:"table"`
		FileName    string `json:"file_name"`
		RowCount    int    `json:"row_count"`
		Truncated   bool   `json:"truncated"`
		ColumnCount int    `json:"column_count"`
	}

	manifest := struct {
		ExportedAt     time.Time   `json:"exported_at"`
		SchemaVersion  string      `json:"schema_version"`
		Format         string      `json:"format"`
		VehicleID      *int64      `json:"vehicle_id,omitempty"`
		StartDate      *time.Time  `json:"start_date,omitempty"`
		EndDate        *time.Time  `json:"end_date,omitempty"`
		MaxRowsCap     int         `json:"max_rows_cap"`
		Tables         []tableMeta `json:"tables"`
		TotalRowCount  int         `json:"total_row_count"`
		TotalSizeBytes int64       `json:"total_size_bytes"`
	}{
		ExportedAt:    time.Now().UTC(),
		SchemaVersion: AccountSchemaVersion,
		Format:        "zip-csv",
		VehicleID:     req.VehicleID,
		StartDate:     req.StartDate,
		EndDate:       req.EndDate,
		MaxRowsCap:    MaxAccountRowsPerTable,
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	totalRecords := 0
	for _, table := range database.AllowedAccountTables {
		if err := ctx.Err(); err != nil {
			_ = zw.Close()
			return nil, err
		}

		var (
			snap *database.ExportTableSnapshot
			err  error
		)
		if req.VehicleID != nil {
			snap, err = database.FetchTableSnapshotForVehicle(ctx, p.db, table, *req.VehicleID, MaxAccountRowsPerTable)
		} else {
			snap, err = database.FetchTableSnapshot(ctx, p.db, table, MaxAccountRowsPerTable)
		}
		if err != nil {
			// Don't abort the whole archive — log and skip this table. The
			// manifest will record the gap.
			log.Warn().Err(err).Str("table", table).Msg("export account: skipping table")
			continue
		}

		csvBytes, err := snapshotToCSV(snap, req.StartDate, req.EndDate)
		if err != nil {
			log.Warn().Err(err).Str("table", table).Msg("export account: failed to encode CSV")
			continue
		}

		fname := table + ".csv"
		fw, err := zw.Create(fname)
		if err != nil {
			_ = zw.Close()
			return nil, fmt.Errorf("zip create %s: %w", fname, err)
		}
		if _, err := fw.Write(csvBytes); err != nil {
			_ = zw.Close()
			return nil, fmt.Errorf("zip write %s: %w", fname, err)
		}

		manifest.Tables = append(manifest.Tables, tableMeta{
			Table:       table,
			FileName:    fname,
			RowCount:    len(snap.Rows),
			Truncated:   len(snap.Rows) >= MaxAccountRowsPerTable,
			ColumnCount: len(snap.Columns),
		})
		totalRecords += len(snap.Rows)
	}

	manifest.TotalRowCount = totalRecords

	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		_ = zw.Close()
		return nil, fmt.Errorf("encode manifest: %w", err)
	}
	mfw, err := zw.Create("manifest.json")
	if err != nil {
		_ = zw.Close()
		return nil, fmt.Errorf("zip create manifest: %w", err)
	}
	if _, err := mfw.Write(manifestBytes); err != nil {
		_ = zw.Close()
		return nil, fmt.Errorf("zip write manifest: %w", err)
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("zip close: %w", err)
	}

	manifest.TotalSizeBytes = int64(buf.Len())

	fileName := fmt.Sprintf("teslasync-account-%s.zip", time.Now().UTC().Format("2006-01-02-150405"))
	return &ProcessResult{
		FileName:    fileName,
		Data:        buf.Bytes(),
		RecordCount: totalRecords,
	}, nil
}

// snapshotToCSV serializes an ExportTableSnapshot into a CSV byte slice,
// stable column order. When a row contains a "ts", "timestamp", "created_at"
// or "start_ts" column and date filters are present in the request, rows
// outside the range are dropped. Date filtering is best-effort — rows with
// non-string/timestamp values pass through.
func snapshotToCSV(snap *database.ExportTableSnapshot, startDate, endDate *time.Time) ([]byte, error) {
	if snap == nil {
		return nil, fmt.Errorf("snapshotToCSV: nil snapshot")
	}

	cols := append([]string(nil), snap.Columns...)
	sort.Strings(cols)

	var buf bytes.Buffer
	cw := csv.NewWriter(&buf)
	if err := cw.Write(cols); err != nil {
		return nil, err
	}

	tsKey := pickTimestampKey(cols)
	for _, row := range snap.Rows {
		if tsKey != "" && (startDate != nil || endDate != nil) {
			if !rowInDateRange(row[tsKey], startDate, endDate) {
				continue
			}
		}
		record := make([]string, len(cols))
		for i, c := range cols {
			record[i] = stringifyCell(row[c])
		}
		if err := cw.Write(record); err != nil {
			return nil, err
		}
	}
	cw.Flush()
	if err := cw.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// pickTimestampKey returns the first plausible timestamp column name found
// in cols, or "" if none. Used by snapshotToCSV for optional date filtering.
func pickTimestampKey(cols []string) string {
	for _, candidate := range []string{"ts", "timestamp", "created_at", "start_ts", "occurred_at", "happened_at"} {
		for _, c := range cols {
			if c == candidate {
				return c
			}
		}
	}
	return ""
}

// rowInDateRange returns true when the cell value can be parsed as a time
// and falls within the [startDate, endDate] inclusive range. When the value
// can't be parsed, returns true (the row passes through).
func rowInDateRange(cell any, startDate, endDate *time.Time) bool {
	s, ok := cell.(string)
	if !ok {
		return true
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return true
		}
	}
	if startDate != nil && t.Before(*startDate) {
		return false
	}
	if endDate != nil && t.After(*endDate) {
		return false
	}
	return true
}

// stringifyCell renders any JSON-decoded cell value as a CSV-safe string.
// Numbers print without trailing zeros, bools as true/false, nil as empty.
// Maps and slices are JSON-encoded so structured columns survive round-trip.
func stringifyCell(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case float64:
		// JSON numbers decode to float64. Prefer integer formatting when the
		// value is a whole number to avoid noisy ".0" suffixes.
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	case json.Number:
		return x.String()
	default:
		b, err := json.Marshal(x)
		if err != nil {
			return fmt.Sprintf("%v", x)
		}
		return string(b)
	}
}
