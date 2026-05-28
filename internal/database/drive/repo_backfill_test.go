package drive

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// txRecorder is an in-file fake satisfying the database.DBTX interface for unit
// testing the BackfillDriveTelemetryDriveIDInTx method without a live
// database. Only Exec is exercised by the method under test; Query and
// QueryRow are present to satisfy the interface and panic if called so
// any future regression that adds an unrelated query path fails loudly.
type txRecorder struct {
	calls    []recordedExecCall
	err      error
	rowsResp int64
}

type recordedExecCall struct {
	SQL  string
	Args []any
}

func (t *txRecorder) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	cp := make([]any, len(args))
	copy(cp, args)
	t.calls = append(t.calls, recordedExecCall{SQL: sql, Args: cp})
	if t.err != nil {
		return pgconn.CommandTag{}, t.err
	}
	return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", t.rowsResp)), nil
}

func (t *txRecorder) Query(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
	panic("txRecorder.Query: unexpected call")
}

func (t *txRecorder) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	panic("txRecorder.QueryRow: unexpected call")
}

// Compile-time guarantee.
var _ database.DBTX = (*txRecorder)(nil)

// TestBackfillDriveTelemetryDriveIDInTx_SQLShape pins the canonical SQL
// the C4 backfill issues:
//   - target table is drive_telemetry (NOT the legacy
//     drive_telemetry_readings dropped by mig 000044)
//   - SET drive_id = $1
//   - WHERE clause filters by vehicle_id, the [start, end] window inclusive,
//     and the drive_id IS NULL guard so already-attributed rows are never
//     overwritten (idempotency requirement of the PE-blocking issue B5)
//   - parameter order: driveID, vehicleID, startTs, endTs
//
// Drift in any of these fields is a CORRECTNESS regression — the bug
// that motivated C4 was every drive_telemetry row landing with NULL
// drive_id, so a future change that flips the IS NULL guard or swaps
// parameter order would re-create that prod-replay symptom silently.
func TestBackfillDriveTelemetryDriveIDInTx_SQLShape(t *testing.T) {
	r := &txRecorder{rowsResp: 50}
	repo := &DriveRepo{} // db pool is not used; method routes through tx.Exec
	driveID := int64(7)
	vehicleID := int64(3)
	startTs := time.Date(2026, 4, 18, 0, 21, 0, 0, time.UTC)
	endTs := time.Date(2026, 4, 18, 0, 46, 0, 0, time.UTC)

	rows, err := repo.BackfillDriveTelemetryDriveIDInTx(context.Background(), r, driveID, vehicleID, startTs, endTs)
	if err != nil {
		t.Fatalf("BackfillDriveTelemetryDriveIDInTx: unexpected err: %v", err)
	}
	if rows != 50 {
		t.Fatalf("rows: want 50, got %d", rows)
	}
	if len(r.calls) != 1 {
		t.Fatalf("expected exactly one Exec, got %d", len(r.calls))
	}
	got := r.calls[0]
	wantSubs := []string{
		"UPDATE drive_telemetry",
		"SET drive_id = $1",
		"WHERE vehicle_id = $2",
		"AND ts >= $3",
		"AND ts <= $4",
		"AND drive_id IS NULL",
	}
	for _, s := range wantSubs {
		if !strings.Contains(got.SQL, s) {
			t.Errorf("SQL missing substring %q\nfull SQL:\n%s", s, got.SQL)
		}
	}
	if strings.Contains(got.SQL, "drive_telemetry_readings") {
		t.Errorf("SQL targets legacy dropped table drive_telemetry_readings:\n%s", got.SQL)
	}
	if len(got.Args) != 4 {
		t.Fatalf("Args len: want 4, got %d (%v)", len(got.Args), got.Args)
	}
	if got.Args[0] != driveID {
		t.Errorf("Args[0] driveID: want %d, got %v", driveID, got.Args[0])
	}
	if got.Args[1] != vehicleID {
		t.Errorf("Args[1] vehicleID: want %d, got %v", vehicleID, got.Args[1])
	}
	if !got.Args[2].(time.Time).Equal(startTs) {
		t.Errorf("Args[2] startTs: want %v, got %v", startTs, got.Args[2])
	}
	if !got.Args[3].(time.Time).Equal(endTs) {
		t.Errorf("Args[3] endTs: want %v, got %v", endTs, got.Args[3])
	}
}

// TestBackfillDriveTelemetryDriveIDInTx_PropagatesError ensures a tx.Exec
// failure surfaces verbatim to the caller so completeDriveLocked's
// db.WithTx callback can ROLLBACK the surrounding completion update.
// PE-blocking issue B5: backfill + completion MUST share fate.
func TestBackfillDriveTelemetryDriveIDInTx_PropagatesError(t *testing.T) {
	want := errors.New("boom")
	r := &txRecorder{err: want}
	repo := &DriveRepo{}
	rows, err := repo.BackfillDriveTelemetryDriveIDInTx(context.Background(), r, 1, 2,
		time.Now(), time.Now().Add(time.Minute))
	if err == nil || !errors.Is(err, want) {
		t.Fatalf("expected wrapped boom error, got %v", err)
	}
	if rows != 0 {
		t.Fatalf("rows on error: want 0, got %d", rows)
	}
}

// TestBackfillDriveTelemetryDriveIDInTx_ZeroAffected verifies the method
// still returns success when no rows match the window — completeDriveLocked
// must not treat a no-op backfill as an error (e.g. when running the writer
// dry-run on a vehicle with no drive_telemetry yet).
func TestBackfillDriveTelemetryDriveIDInTx_ZeroAffected(t *testing.T) {
	r := &txRecorder{rowsResp: 0}
	repo := &DriveRepo{}
	rows, err := repo.BackfillDriveTelemetryDriveIDInTx(context.Background(), r, 1, 2,
		time.Now(), time.Now().Add(time.Minute))
	if err != nil {
		t.Fatalf("zero-affected should not be an error, got %v", err)
	}
	if rows != 0 {
		t.Fatalf("rows: want 0, got %d", rows)
	}
}
