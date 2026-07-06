// In-memory test doubles for the backup repositories. The repos hold a
// database.DBTX querier (satisfied in production by *pgxpool.Pool); these
// fakes satisfy the same interface so every method is exercised without a
// live PostgreSQL — the pattern established by drive/repo_backfill_test.go's
// txRecorder, extended here to also fake the Query / QueryRow read paths.
package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"time"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// recordedCall captures a single SQL statement and its bound arguments so
// tests can assert on parameterisation (placeholder order, values) and SQL
// shape without a database round-trip.
type recordedCall struct {
	sql  string
	args []any
}

// fakeDBTX is an in-memory database.DBTX. Each repo method issues exactly
// one pool call, so a fake configured with a single canned response per
// verb is sufficient; every call is recorded for assertions.
type fakeDBTX struct {
	execCalls  []recordedCall
	queryCalls []recordedCall
	rowCalls   []recordedCall

	// Exec response.
	execTag pgconn.CommandTag
	execErr error

	// Query response.
	rows     pgx.Rows
	queryErr error

	// QueryRow response.
	row pgx.Row
}

func (f *fakeDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	return f.execTag, f.execErr
}

func (f *fakeDBTX) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls = append(f.queryCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	return f.rows, f.queryErr
}

func (f *fakeDBTX) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.rowCalls = append(f.rowCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	return f.row
}

// Compile-time guarantee the fake stays interface-compatible.
var _ database.DBTX = (*fakeDBTX)(nil)

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

// fakeRow is a pgx.Row that either surfaces a Scan error or assigns a fixed
// slice of values positionally into the caller's destinations.
type fakeRow struct {
	err  error
	vals []any
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScan(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// fakeRows is a pgx.Rows backed by a slice of pre-decoded rows. scanErr, if
// set, is returned from Scan (simulating a per-row decode failure); errFinal
// is returned from Err (simulating a mid-stream fetch error surfaced after
// Next reports false).
type fakeRows struct {
	rows     [][]any
	idx      int
	scanErr  error
	errFinal error
	closed   bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.rows) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	return assignScan(dest, r.rows[r.idx-1])
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errFinal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// assignScan mimics pgx's positional Scan: it assigns vals[i] into the value
// pointed to by dest[i] via reflection, tolerating typed-nil pointers and
// slice/RawMessage columns. A length or type mismatch is an error, exactly
// as a real Scan would surface.
func assignScan(dest []any, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: dest count %d != value count %d", len(dest), len(vals))
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return fmt.Errorf("scan: dest[%d] is not a non-nil pointer", i)
		}
		target := dv.Elem()
		if vals[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		sv := reflect.ValueOf(vals[i])
		if !sv.Type().AssignableTo(target.Type()) {
			return fmt.Errorf("scan: dest[%d] cannot assign %T to %s", i, vals[i], target.Type())
		}
		target.Set(sv)
	}
	return nil
}

// configScanVals returns c's fields in the exact column order the config
// SELECT projections (GetByID / List / GetDueConfigs) scan.
func configScanVals(c backupmodel.BackupConfig) []any {
	return []any{
		c.ID, c.Name, c.Enabled, c.BackupType, c.FrequencyDays, c.MaxRetention,
		c.Provider, c.ProviderConfig, c.IncludeTables, c.Compress, c.Encrypt,
		c.LastRunAt, c.NextRunAt, c.CreatedAt, c.UpdatedAt,
	}
}

// runScanVals returns run's fields in the exact column order the run SELECT
// projections (GetByID / List / ListByConfig / LatestSuccessful) scan.
func runScanVals(run backupmodel.BackupRun) []any {
	return []any{
		run.ID, run.ConfigID, run.RunType, run.BackupType, run.Status, run.Provider,
		run.FileName, run.FilePath, run.FileSize, run.RecordCount, run.TableCount,
		run.Checksum, run.DurationMs, run.ErrorMessage, run.Metadata,
		run.StartedAt, run.CompletedAt, run.CreatedAt,
	}
}

func strPtr(s string) *string { return &s }
func i64Ptr(i int64) *int64   { return &i }

// sampleConfig is a fully-populated BackupConfig used across read tests.
func sampleConfig() backupmodel.BackupConfig {
	created := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	last := time.Date(2026, 6, 2, 10, 0, 0, 0, time.UTC)
	next := time.Date(2026, 6, 3, 10, 0, 0, 0, time.UTC)
	return backupmodel.BackupConfig{
		ID:             42,
		Name:           "Nightly",
		Enabled:        true,
		BackupType:     "full",
		FrequencyDays:  1,
		MaxRetention:   30,
		Provider:       "local",
		ProviderConfig: json.RawMessage(`{"path":"/data"}`),
		IncludeTables:  []string{"vehicles", "drives"},
		Compress:       true,
		Encrypt:        false,
		LastRunAt:      &last,
		NextRunAt:      &next,
		CreatedAt:      created,
		UpdatedAt:      created,
	}
}

// sampleRun is a fully-populated BackupRun used across read tests.
func sampleRun() backupmodel.BackupRun {
	created := time.Date(2026, 6, 1, 11, 0, 0, 0, time.UTC)
	started := time.Date(2026, 6, 1, 11, 0, 1, 0, time.UTC)
	completed := time.Date(2026, 6, 1, 11, 5, 0, 0, time.UTC)
	return backupmodel.BackupRun{
		ID:           7,
		ConfigID:     i64Ptr(42),
		RunType:      "backup",
		BackupType:   "full",
		Status:       "completed",
		Provider:     "local",
		FileName:     strPtr("backup-7.json.gz"),
		FilePath:     strPtr("backups/backup-7.json.gz"),
		FileSize:     2048,
		RecordCount:  500,
		TableCount:   12,
		Checksum:     strPtr("deadbeef"),
		DurationMs:   4200,
		ErrorMessage: nil,
		Metadata:     json.RawMessage(`{"version":"1.0"}`),
		StartedAt:    &started,
		CompletedAt:  &completed,
		CreatedAt:    created,
	}
}
