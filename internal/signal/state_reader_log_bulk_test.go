package signal

// Bulk signal_log read tests.
//
// StatesAt exists to replace N DISTINCT ON queries with ONE. The query-count
// assertion is therefore the primary contract; the rest pins the grouping,
// the absence-vs-error distinction and the zero-`at` guard that stop a caller
// from mistaking "no rows" for "no history".

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// bulkRow is one row of the StatesAt 8-column projection.
type bulkRow struct {
	vehicleID int64
	field     string
	kind      int16
	sv        *string
	bv        *bool
	iv        *int64
	fv        *float64
	tv        *time.Time
}

// bulkPgxRows implements pgx.Rows over in-memory bulkRows.
type bulkPgxRows struct {
	rows    []bulkRow
	pos     int
	scanErr error
	err     error
}

func (b *bulkPgxRows) Close()                                       {}
func (b *bulkPgxRows) Err() error                                   { return b.err }
func (b *bulkPgxRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (b *bulkPgxRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (b *bulkPgxRows) Values() ([]any, error)                       { return nil, nil }
func (b *bulkPgxRows) RawValues() [][]byte                          { return nil }
func (b *bulkPgxRows) Conn() *pgx.Conn                              { return nil }

func (b *bulkPgxRows) Next() bool {
	if b.pos >= len(b.rows) {
		return false
	}
	b.pos++
	return true
}

func (b *bulkPgxRows) Scan(dest ...any) error {
	if b.scanErr != nil {
		return b.scanErr
	}
	if len(dest) != 8 {
		return fmt.Errorf("bulkPgxRows: expected 8 destinations, got %d", len(dest))
	}
	row := b.rows[b.pos-1]
	*(dest[0].(*int64)) = row.vehicleID
	*(dest[1].(*string)) = row.field
	*(dest[2].(*int16)) = row.kind
	*(dest[3].(**string)) = row.sv
	*(dest[4].(**bool)) = row.bv
	*(dest[5].(**int64)) = row.iv
	*(dest[6].(**float64)) = row.fv
	*(dest[7].(**time.Time)) = row.tv
	return nil
}

// recordingQuerier captures every SQL statement and its arguments so a test
// can prove ONE query covered the whole fleet.
type recordingQuerier struct {
	rows  pgx.Rows
	err   error
	sqls  []string
	args  [][]any
	sleep time.Duration
}

func (r *recordingQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	r.sqls = append(r.sqls, sql)
	r.args = append(r.args, args)
	if r.sleep > 0 {
		select {
		case <-time.After(r.sleep):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if r.err != nil {
		return nil, r.err
	}
	if r.rows != nil {
		return r.rows, nil
	}
	return &bulkPgxRows{}, nil
}

func bulkFloatRow(vehicleID int64, field string, v float64) bulkRow {
	value := v
	return bulkRow{vehicleID: vehicleID, field: field, kind: 5 /* ValueKindFloat */, fv: &value}
}

func TestStatesAtReadsEveryVehicleInOneQuery(t *testing.T) {
	querier := &recordingQuerier{rows: &bulkPgxRows{rows: []bulkRow{
		bulkFloatRow(1, "Odometer", 100),
		bulkFloatRow(1, "BatteryLevel", 61),
		bulkFloatRow(2, "Odometer", 200),
		bulkFloatRow(3, "BatteryLevel", 42),
	}}}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	states, err := reader.StatesAt(context.Background(), []int64{1, 2, 3}, time.Now().UTC())
	if err != nil {
		t.Fatalf("StatesAt: %v", err)
	}
	if len(querier.sqls) != 1 {
		t.Fatalf("queries = %d, want exactly 1 set-based query for 3 vehicles", len(querier.sqls))
	}
	sql := querier.sqls[0]
	if !strings.Contains(sql, "DISTINCT ON (vehicle_id, field)") {
		t.Fatalf("query does not forward-fold per vehicle+field:\n%s", sql)
	}
	if !strings.Contains(sql, "vehicle_id = ANY($1)") {
		t.Fatalf("query is not set-based:\n%s", sql)
	}
	if !strings.Contains(sql, "FROM signal_log") {
		t.Fatalf("bulk durable read must come from signal_log, not a snapshot table:\n%s", sql)
	}
	if len(states) != 3 {
		t.Fatalf("states = %d, want one per vehicle with rows", len(states))
	}
	if got := states[1]["Odometer"]; got != float64(100) {
		t.Fatalf("vehicle 1 Odometer = %v, want 100", got)
	}
	if got := states[1]["BatteryLevel"]; got != float64(61) {
		t.Fatalf("vehicle 1 BatteryLevel = %v, want 61", got)
	}
	if _, present := states[2]["BatteryLevel"]; present {
		t.Fatal("vehicle 2 inherited another vehicle's signal — rows must be grouped by vehicle_id")
	}
}

func TestStatesAtOmitsVehiclesWithNoHistory(t *testing.T) {
	querier := &recordingQuerier{rows: &bulkPgxRows{rows: []bulkRow{bulkFloatRow(1, "Odometer", 100)}}}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	states, err := reader.StatesAt(context.Background(), []int64{1, 2}, time.Now().UTC())
	if err != nil {
		t.Fatalf("StatesAt: %v", err)
	}
	if _, present := states[2]; present {
		t.Fatal("a vehicle with no rows must carry NO entry (absence), not an empty state")
	}
}

func TestStatesAtDeduplicatesIDsAndSkipsSQLForAnEmptySet(t *testing.T) {
	querier := &recordingQuerier{}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	if _, err := reader.StatesAt(context.Background(), []int64{5, 5, 0, -1}, time.Now().UTC()); err != nil {
		t.Fatalf("StatesAt: %v", err)
	}
	if len(querier.args) != 1 {
		t.Fatalf("queries = %d, want 1", len(querier.args))
	}
	ids, ok := querier.args[0][0].([]int64)
	if !ok || len(ids) != 1 || ids[0] != 5 {
		t.Fatalf("query ids = %v, want the single distinct positive id", querier.args[0][0])
	}

	states, err := reader.StatesAt(context.Background(), nil, time.Now().UTC())
	if err != nil {
		t.Fatalf("StatesAt(empty): %v", err)
	}
	if len(states) != 0 {
		t.Fatalf("states = %v, want empty", states)
	}
	if len(querier.sqls) != 1 {
		t.Fatalf("an empty id set must issue no SQL; queries = %d", len(querier.sqls))
	}
}

func TestStatesAtRejectsZeroAt(t *testing.T) {
	querier := &recordingQuerier{}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	if _, err := reader.StatesAt(context.Background(), []int64{1}, time.Time{}); err == nil {
		t.Fatal("a zero `at` must fail loudly rather than return an empty fleet history")
	}
	if len(querier.sqls) != 0 {
		t.Fatal("the guard must run before any SQL")
	}
}

func TestStatesAtLogsAndWrapsQueryFailure(t *testing.T) {
	var buf bytes.Buffer
	querier := &recordingQuerier{err: errors.New("pq: canceling statement due to statement timeout")}
	reader := &LogStateReader{pool: querier, log: zerolog.New(&buf)}

	states, err := reader.StatesAt(context.Background(), []int64{1, 2}, time.Now().UTC())
	if err == nil {
		t.Fatal("a failed set-based read must be an error, never a silently empty history")
	}
	if states != nil {
		t.Fatalf("states = %v, want nil on failure", states)
	}
	if !strings.Contains(buf.String(), "bulk state read failed") {
		t.Fatalf("failure was not logged: %s", buf.String())
	}
}

func TestStatesAtPropagatesScanFailure(t *testing.T) {
	querier := &recordingQuerier{rows: &bulkPgxRows{
		rows:    []bulkRow{bulkFloatRow(1, "Odometer", 100)},
		scanErr: errors.New("unexpected column count"),
	}}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	if _, err := reader.StatesAt(context.Background(), []int64{1}, time.Now().UTC()); err == nil {
		t.Fatal("a scan failure must surface, not be skipped row by row")
	}
}

func TestStatesAtHonoursContextCancellation(t *testing.T) {
	querier := &recordingQuerier{sleep: 250 * time.Millisecond}
	reader := &LogStateReader{pool: querier, log: zerolog.Nop()}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := reader.StatesAt(ctx, []int64{1, 2}, time.Now().UTC()); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want the caller's deadline to be honoured", err)
	}
}
