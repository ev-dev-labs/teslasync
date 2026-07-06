// ArtifactRepo unit tests. The repo talks to Postgres through the unexported
// database.DBTX seam, so these tests substitute a scripted fake (fakeExec +
// fakeRows/fakeRow) and never touch a live database — the codebase vendors no
// pgxmock/testcontainers harness (see achievement/unlock_repo_test.go and
// drive/repo_backfill_test.go for the same precedent). Everything is
// table-driven and safe under -race.
package gdpr

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Fake pgx plumbing.
// ---------------------------------------------------------------------------

// recordedCall captures one SQL round trip so tests can pin the statement and
// its ordered arguments.
type recordedCall struct {
	SQL  string
	Args []any
}

// fakeExec is a scripted database.DBTX. It records every Exec/Query/QueryRow
// and returns the pre-loaded response (or error). A mutex guards the recorders
// so the concurrency test can hammer it under -race.
type fakeExec struct {
	mu sync.Mutex

	execTag  pgconn.CommandTag
	execErr  error
	rows     pgx.Rows
	queryErr error
	row      pgx.Row

	execCalls     []recordedCall
	queryCalls    []recordedCall
	queryRowCalls []recordedCall
}

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

func (f *fakeExec) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.mu.Lock()
	f.execCalls = append(f.execCalls, recordedCall{SQL: sql, Args: cloneArgs(args)})
	f.mu.Unlock()
	return f.execTag, f.execErr
}

func (f *fakeExec) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.mu.Lock()
	f.queryCalls = append(f.queryCalls, recordedCall{SQL: sql, Args: cloneArgs(args)})
	f.mu.Unlock()
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	return f.rows, nil
}

func (f *fakeExec) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.mu.Lock()
	f.queryRowCalls = append(f.queryRowCalls, recordedCall{SQL: sql, Args: cloneArgs(args)})
	f.mu.Unlock()
	return f.row
}

var _ database.DBTX = (*fakeExec)(nil)

// fakeRows is a scripted pgx.Rows. Each element of data is one row's values in
// artifactColumns order, positionally matching the Scan destinations.
type fakeRows struct {
	data      [][]any
	idx       int
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	errVal    error // returned by Err() to simulate mid-stream iteration failure
	closed    bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.idx == r.scanErrAt {
		return r.scanErr
	}
	return assignScan(dest, r.data[r.idx-1])
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errVal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// fakeRow is a scripted pgx.Row for GetByID. It populates the artifactColumns
// destinations from vals, or returns err (e.g. pgx.ErrNoRows) to exercise the
// not-found / scan-failure branches.
type fakeRow struct {
	vals []any
	err  error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScan(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// assignScan copies scripted values into the caller's Scan destinations,
// mimicking pgx's per-type scanning for exactly the column types projected by
// artifactColumns.
func assignScan(dest []any, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i := range dest {
		v := vals[i]
		switch p := dest[i].(type) {
		case *string:
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *string", i, v)
			}
			*p = s
		case *int64:
			n, ok := v.(int64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int64", i, v)
			}
			*p = n
		case *int:
			n, ok := v.(int)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int", i, v)
			}
			*p = n
		case *time.Time:
			t, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *time.Time", i, v)
			}
			*p = t
		case **time.Time:
			// downloaded_at is nullable: a nil *time.Time (or untyped nil)
			// leaves the destination nil; a non-nil pointer/value sets it.
			switch tv := v.(type) {
			case nil:
				*p = nil
			case *time.Time:
				*p = tv
			case time.Time:
				t := tv
				*p = &t
			default:
				return fmt.Errorf("col %d: cannot scan %T into **time.Time", i, v)
			}
		default:
			return fmt.Errorf("col %d: unsupported destination type %T", i, dest[i])
		}
	}
	return nil
}

// rowVals renders an Artifact as a scripted row in artifactColumns order.
func rowVals(a Artifact) []any {
	return []any{
		a.ID, a.ExportJobID, a.VehicleID, string(a.StorageKind), a.StoragePath,
		a.SHA256, a.ByteCount, a.CreatedAt, a.ExpiresAt,
		a.DownloadedAt, a.DownloadCount,
	}
}

// sampleArtifact is a fully-populated, valid manifest used across tests.
func sampleArtifact() Artifact {
	return Artifact{
		ID:            "art-1",
		ExportJobID:   "job-1",
		VehicleID:     7,
		StorageKind:   StorageKindLocalFS,
		StoragePath:   "/exports/art-1.jsonl.gz",
		SHA256:        strings.Repeat("a", 64),
		ByteCount:     1024,
		CreatedAt:     time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
		ExpiresAt:     time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC),
		DownloadCount: 0,
	}
}

func eqArtifact(t *testing.T, ctx string, got, want Artifact) {
	t.Helper()
	if got.ID != want.ID || got.ExportJobID != want.ExportJobID || got.VehicleID != want.VehicleID ||
		got.StorageKind != want.StorageKind || got.StoragePath != want.StoragePath ||
		got.SHA256 != want.SHA256 || got.ByteCount != want.ByteCount || got.DownloadCount != want.DownloadCount {
		t.Errorf("%s: scalar mismatch\n got=%+v\nwant=%+v", ctx, got, want)
	}
	if !got.CreatedAt.Equal(want.CreatedAt) {
		t.Errorf("%s: created_at got %v want %v", ctx, got.CreatedAt, want.CreatedAt)
	}
	if !got.ExpiresAt.Equal(want.ExpiresAt) {
		t.Errorf("%s: expires_at got %v want %v", ctx, got.ExpiresAt, want.ExpiresAt)
	}
	switch {
	case want.DownloadedAt == nil && got.DownloadedAt != nil:
		t.Errorf("%s: downloaded_at got %v want nil", ctx, *got.DownloadedAt)
	case want.DownloadedAt != nil && got.DownloadedAt == nil:
		t.Errorf("%s: downloaded_at got nil want %v", ctx, *want.DownloadedAt)
	case want.DownloadedAt != nil && got.DownloadedAt != nil && !got.DownloadedAt.Equal(*want.DownloadedAt):
		t.Errorf("%s: downloaded_at got %v want %v", ctx, *got.DownloadedAt, *want.DownloadedAt)
	}
}

// ---------------------------------------------------------------------------
// NewArtifactRepo — construction contract.
// ---------------------------------------------------------------------------

func TestNewArtifactRepo(t *testing.T) {
	if got := NewArtifactRepo(nil); got != nil {
		t.Errorf("NewArtifactRepo(nil) = %v, want nil (subsystem disabled)", got)
	}
	if got := NewArtifactRepo(&database.DB{Pool: nil}); got != nil {
		t.Errorf("NewArtifactRepo(nil pool) = %v, want nil", got)
	}

	// A lazily-created pool does not connect (pgxpool.NewWithConfig is lazy),
	// so this needs no live database. It proves the happy path wires db.Pool
	// into the seam unchanged.
	cfg, err := pgxpool.ParseConfig("******127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig (should be lazy): %v", err)
	}
	defer pool.Close()

	repo := NewArtifactRepo(&database.DB{Pool: pool})
	if repo == nil {
		t.Fatal("NewArtifactRepo(valid pool) = nil, want non-nil")
	}
	if repo.exec != database.DBTX(pool) {
		t.Error("NewArtifactRepo did not wire db.Pool into the exec seam")
	}
}

// ---------------------------------------------------------------------------
// Nil-receiver no-op contract — every method must be safe on a nil repo.
// ---------------------------------------------------------------------------

func TestArtifactRepo_NilReceiver_NoOp(t *testing.T) {
	var r *ArtifactRepo
	ctx := context.Background()

	if err := r.Insert(ctx, sampleArtifact()); err != nil {
		t.Errorf("Insert on nil repo: got %v, want nil", err)
	}
	if got, err := r.GetByID(ctx, "art-1"); got != nil || err != nil {
		t.Errorf("GetByID on nil repo: got (%v, %v), want (nil, nil)", got, err)
	}
	if got, err := r.ListByVehicle(ctx, 7, 10); got != nil || err != nil {
		t.Errorf("ListByVehicle on nil repo: got (%v, %v), want (nil, nil)", got, err)
	}
	if err := r.RecordDownload(ctx, "art-1"); err != nil {
		t.Errorf("RecordDownload on nil repo: got %v, want nil", err)
	}
	if got, err := r.Expired(ctx, 10); got != nil || err != nil {
		t.Errorf("Expired on nil repo: got (%v, %v), want (nil, nil)", got, err)
	}
	if err := r.Delete(ctx, "art-1"); err != nil {
		t.Errorf("Delete on nil repo: got %v, want nil", err)
	}
}

// ---------------------------------------------------------------------------
// StorageKind.valid + Artifact.validate.
// ---------------------------------------------------------------------------

func TestStorageKind_valid(t *testing.T) {
	cases := []struct {
		kind StorageKind
		want bool
	}{
		{StorageKindLocalFS, true},
		{StorageKindS3, true},
		{"", false},
		{"gcs", false},
		{"S3", false},        // case-sensitive; DB CHECK is lower-case only
		{"local_fs ", false}, // trailing space is not a valid enum member
	}
	for _, c := range cases {
		if got := c.kind.valid(); got != c.want {
			t.Errorf("StorageKind(%q).valid() = %v, want %v", c.kind, got, c.want)
		}
	}
}

func TestArtifact_validate(t *testing.T) {
	base := sampleArtifact()
	mut := func(f func(*Artifact)) Artifact {
		a := base
		f(&a)
		return a
	}
	cases := []struct {
		name    string
		a       Artifact
		wantErr bool
	}{
		{"valid", base, false},
		{"valid_s3", mut(func(a *Artifact) { a.StorageKind = StorageKindS3 }), false},
		{"valid_zero_bytes", mut(func(a *Artifact) { a.ByteCount = 0 }), false},
		{"valid_zero_created_at", mut(func(a *Artifact) { a.CreatedAt = time.Time{} }), false},
		{"empty_id", mut(func(a *Artifact) { a.ID = "" }), true},
		{"blank_id", mut(func(a *Artifact) { a.ID = "   " }), true},
		{"empty_export_job", mut(func(a *Artifact) { a.ExportJobID = "" }), true},
		{"empty_kind", mut(func(a *Artifact) { a.StorageKind = "" }), true},
		{"bad_kind", mut(func(a *Artifact) { a.StorageKind = "gcs" }), true},
		{"empty_storage_path", mut(func(a *Artifact) { a.StoragePath = " " }), true},
		{"empty_sha", mut(func(a *Artifact) { a.SHA256 = "" }), true},
		{"negative_bytes", mut(func(a *Artifact) { a.ByteCount = -1 }), true},
		{"zero_expires_at", mut(func(a *Artifact) { a.ExpiresAt = time.Time{} }), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.a.validate()
			if c.wantErr {
				if err == nil {
					t.Fatalf("validate() = nil, want error")
				}
				if !errors.Is(err, ErrValidation) {
					t.Errorf("validate() error %v does not wrap ErrValidation", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("validate() = %v, want nil", err)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Insert.
// ---------------------------------------------------------------------------

func TestArtifactRepo_Insert_Success(t *testing.T) {
	pool := &fakeExec{}
	repo := &ArtifactRepo{exec: pool}
	a := sampleArtifact()

	if err := repo.Insert(context.Background(), a); err != nil {
		t.Fatalf("Insert: unexpected error %v", err)
	}
	if len(pool.execCalls) != 1 {
		t.Fatalf("execCalls = %d, want 1", len(pool.execCalls))
	}
	call := pool.execCalls[0]
	if call.SQL != insertArtifactSQL {
		t.Errorf("SQL = %q, want insertArtifactSQL", call.SQL)
	}
	if len(call.Args) != 9 {
		t.Fatalf("args = %d, want 9 (%v)", len(call.Args), call.Args)
	}
	want := []any{a.ID, a.ExportJobID, a.VehicleID, "local_fs", a.StoragePath, a.SHA256, a.ByteCount}
	for i, w := range want {
		if call.Args[i] != w {
			t.Errorf("arg[%d] = %v (%T), want %v (%T)", i, call.Args[i], call.Args[i], w, w)
		}
	}
	createdArg, ok := call.Args[7].(time.Time)
	if !ok || !createdArg.Equal(a.CreatedAt) || createdArg.Location() != time.UTC {
		t.Errorf("arg[7] created_at = %v, want UTC %v", call.Args[7], a.CreatedAt)
	}
	expiresArg, ok := call.Args[8].(time.Time)
	if !ok || !expiresArg.Equal(a.ExpiresAt) || expiresArg.Location() != time.UTC {
		t.Errorf("arg[8] expires_at = %v, want UTC %v", call.Args[8], a.ExpiresAt)
	}
}

func TestArtifactRepo_Insert_NormalisesToUTC(t *testing.T) {
	est := time.FixedZone("EST", -5*60*60)
	a := sampleArtifact()
	a.CreatedAt = time.Date(2026, 6, 1, 7, 0, 0, 0, est) // 12:00 UTC
	a.ExpiresAt = time.Date(2026, 6, 8, 7, 0, 0, 0, est) // 12:00 UTC

	pool := &fakeExec{}
	repo := &ArtifactRepo{exec: pool}
	if err := repo.Insert(context.Background(), a); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	created := pool.execCalls[0].Args[7].(time.Time)
	if created.Location() != time.UTC || created.Hour() != 12 || !created.Equal(a.CreatedAt) {
		t.Errorf("created_at persisted %v, want 12:00 UTC equal to %v", created, a.CreatedAt)
	}
	expires := pool.execCalls[0].Args[8].(time.Time)
	if expires.Location() != time.UTC || expires.Hour() != 12 || !expires.Equal(a.ExpiresAt) {
		t.Errorf("expires_at persisted %v, want 12:00 UTC equal to %v", expires, a.ExpiresAt)
	}
}

func TestArtifactRepo_Insert_Validation_NoDBRoundTrip(t *testing.T) {
	base := sampleArtifact()
	mut := func(f func(*Artifact)) Artifact {
		a := base
		f(&a)
		return a
	}
	cases := []struct {
		name string
		a    Artifact
	}{
		{"empty_id", mut(func(a *Artifact) { a.ID = "" })},
		{"empty_export_job", mut(func(a *Artifact) { a.ExportJobID = "" })},
		{"bad_kind", mut(func(a *Artifact) { a.StorageKind = "gcs" })},
		{"empty_storage_path", mut(func(a *Artifact) { a.StoragePath = "" })},
		{"empty_sha", mut(func(a *Artifact) { a.SHA256 = "" })},
		{"negative_bytes", mut(func(a *Artifact) { a.ByteCount = -5 })},
		{"zero_expires", mut(func(a *Artifact) { a.ExpiresAt = time.Time{} })},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{}
			repo := &ArtifactRepo{exec: pool}
			err := repo.Insert(context.Background(), c.a)
			if !errors.Is(err, ErrValidation) {
				t.Fatalf("Insert error = %v, want wrap ErrValidation", err)
			}
			if !strings.Contains(err.Error(), "gdpr_artifact: insert") {
				t.Errorf("error %q missing operation context", err.Error())
			}
			if len(pool.execCalls) != 0 {
				t.Errorf("validation must fail before the DB round trip; got %d Exec calls", len(pool.execCalls))
			}
		})
	}
}

func TestArtifactRepo_Insert_Conflict(t *testing.T) {
	pool := &fakeExec{execErr: &pgconn.PgError{Code: "23505", Message: "duplicate key value"}}
	repo := &ArtifactRepo{exec: pool}

	err := repo.Insert(context.Background(), sampleArtifact())
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("Insert error = %v, want wrap ErrConflict", err)
	}
	if errors.Is(err, ErrValidation) {
		t.Error("conflict must not be reported as a validation error")
	}
	if len(pool.execCalls) != 1 {
		t.Errorf("execCalls = %d, want 1 (the insert was attempted)", len(pool.execCalls))
	}
}

func TestArtifactRepo_Insert_GenericErrorWrapped(t *testing.T) {
	boom := errors.New("connection reset")
	pool := &fakeExec{execErr: boom}
	repo := &ArtifactRepo{exec: pool}

	err := repo.Insert(context.Background(), sampleArtifact())
	if !errors.Is(err, boom) {
		t.Fatalf("Insert error = %v, want wrap %v", err, boom)
	}
	if errors.Is(err, ErrConflict) {
		t.Error("a non-23505 error must not be mapped to ErrConflict")
	}
	if !strings.Contains(err.Error(), "gdpr_artifact: insert") {
		t.Errorf("error %q missing operation context", err.Error())
	}
}

// ---------------------------------------------------------------------------
// GetByID.
// ---------------------------------------------------------------------------

func TestArtifactRepo_GetByID(t *testing.T) {
	downloaded := time.Date(2026, 6, 2, 9, 30, 0, 0, time.UTC)

	fresh := sampleArtifact()
	fresh.DownloadCount = 0

	downloadedArtifact := sampleArtifact()
	downloadedArtifact.StorageKind = StorageKindS3
	downloadedArtifact.DownloadedAt = &downloaded
	downloadedArtifact.DownloadCount = 3

	scanBoom := errors.New("bad column type")

	cases := []struct {
		name       string
		row        fakeRow
		wantNil    bool
		want       Artifact
		wantErr    error
		wantErrSub string
	}{
		{
			name: "found_never_downloaded",
			row:  fakeRow{vals: rowVals(fresh)},
			want: fresh,
		},
		{
			name: "found_downloaded_s3",
			row:  fakeRow{vals: rowVals(downloadedArtifact)},
			want: downloadedArtifact,
		},
		{
			name:    "not_found_returns_nil_nil",
			row:     fakeRow{err: pgx.ErrNoRows},
			wantNil: true,
		},
		{
			name:       "scan_error_wrapped",
			row:        fakeRow{err: scanBoom},
			wantErr:    scanBoom,
			wantErrSub: "gdpr_artifact: get",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{row: c.row}
			repo := &ArtifactRepo{exec: pool}

			got, err := repo.GetByID(context.Background(), "art-1")

			if pool.queryRowCalls != nil {
				if len(pool.queryRowCalls) != 1 {
					t.Fatalf("queryRowCalls = %d, want 1", len(pool.queryRowCalls))
				}
				if pool.queryRowCalls[0].SQL != getByIDSQL {
					t.Errorf("SQL = %q, want getByIDSQL", pool.queryRowCalls[0].SQL)
				}
				if len(pool.queryRowCalls[0].Args) != 1 || pool.queryRowCalls[0].Args[0] != any("art-1") {
					t.Errorf("args = %v, want [art-1]", pool.queryRowCalls[0].Args)
				}
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error %v does not wrap %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err.Error(), c.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if c.wantNil {
				if got != nil {
					t.Errorf("result = %+v, want nil (not found)", got)
				}
				return
			}
			if got == nil {
				t.Fatal("result = nil, want artifact")
			}
			eqArtifact(t, "GetByID", *got, c.want)
		})
	}
}

// ---------------------------------------------------------------------------
// ListByVehicle.
// ---------------------------------------------------------------------------

func TestArtifactRepo_ListByVehicle(t *testing.T) {
	a1 := sampleArtifact()
	a1.ID = "art-1"
	a2 := sampleArtifact()
	a2.ID = "art-2"
	a2.CreatedAt = a1.CreatedAt.Add(-time.Hour)

	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("bad column")
	iterBoom := errors.New("stream aborted")

	cases := []struct {
		name       string
		vehicleID  int64
		limit      int
		wantLimit  int // effective limit passed to Query after clamping
		rows       *fakeRows
		queryErr   error
		wantLen    int
		wantErr    error
		wantErrSub string
	}{
		{
			name: "two_rows_newest_first", vehicleID: 7, limit: 10, wantLimit: 10,
			rows: &fakeRows{data: [][]any{rowVals(a1), rowVals(a2)}}, wantLen: 2,
		},
		{
			name: "empty_non_nil_slice", vehicleID: 42, limit: 25, wantLimit: 25,
			rows: &fakeRows{data: nil}, wantLen: 0,
		},
		{
			name: "limit_zero_defaults_50", vehicleID: 1, limit: 0, wantLimit: 50,
			rows: &fakeRows{data: nil}, wantLen: 0,
		},
		{
			name: "limit_negative_defaults_50", vehicleID: 1, limit: -3, wantLimit: 50,
			rows: &fakeRows{data: nil}, wantLen: 0,
		},
		{
			name: "limit_over_max_defaults_50", vehicleID: 1, limit: 201, wantLimit: 50,
			rows: &fakeRows{data: nil}, wantLen: 0,
		},
		{
			name: "limit_at_max_passes", vehicleID: 1, limit: 200, wantLimit: 200,
			rows: &fakeRows{data: nil}, wantLen: 0,
		},
		{
			name: "query_error_wrapped", vehicleID: 7, limit: 10, wantLimit: 10,
			queryErr: queryBoom, wantErr: queryBoom, wantErrSub: "gdpr_artifact: list",
		},
		{
			name: "scan_error_wrapped", vehicleID: 7, limit: 10, wantLimit: 10,
			rows:    &fakeRows{data: [][]any{rowVals(a1), rowVals(a2)}, scanErr: scanBoom, scanErrAt: 1},
			wantErr: scanBoom, wantErrSub: "gdpr_artifact: scan",
		},
		{
			name: "rows_err_wrapped", vehicleID: 7, limit: 10, wantLimit: 10,
			rows:    &fakeRows{data: [][]any{rowVals(a1)}, errVal: iterBoom},
			wantErr: iterBoom, wantErrSub: "gdpr_artifact: list rows",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{rows: c.rows, queryErr: c.queryErr}
			repo := &ArtifactRepo{exec: pool}

			got, err := repo.ListByVehicle(context.Background(), c.vehicleID, c.limit)

			if len(pool.queryCalls) != 1 {
				t.Fatalf("queryCalls = %d, want 1", len(pool.queryCalls))
			}
			call := pool.queryCalls[0]
			if call.SQL != listByVehicleSQL {
				t.Errorf("SQL = %q, want listByVehicleSQL", call.SQL)
			}
			if len(call.Args) != 2 || call.Args[0] != any(c.vehicleID) || call.Args[1] != any(c.wantLimit) {
				t.Errorf("args = %v, want [%d %d]", call.Args, c.vehicleID, c.wantLimit)
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error %v does not wrap %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err.Error(), c.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got == nil {
				t.Fatal("result = nil, want non-nil slice (empty allowed)")
			}
			if len(got) != c.wantLen {
				t.Fatalf("len = %d, want %d", len(got), c.wantLen)
			}
			if c.wantLen == 2 {
				eqArtifact(t, "row[0]", got[0], a1)
				eqArtifact(t, "row[1]", got[1], a2)
			}
			if c.rows != nil && !c.rows.closed {
				t.Error("rows.Close() was not called")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Expired.
// ---------------------------------------------------------------------------

func TestArtifactRepo_Expired(t *testing.T) {
	a1 := sampleArtifact()
	a1.ID = "old-1"

	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("bad column")
	iterBoom := errors.New("stream aborted")

	cases := []struct {
		name       string
		limit      int
		wantLimit  int
		rows       *fakeRows
		queryErr   error
		wantLen    int
		wantErr    error
		wantErrSub string
	}{
		{name: "one_row", limit: 100, wantLimit: 100, rows: &fakeRows{data: [][]any{rowVals(a1)}}, wantLen: 1},
		{name: "empty", limit: 50, wantLimit: 50, rows: &fakeRows{data: nil}, wantLen: 0},
		{name: "limit_zero_defaults_100", limit: 0, wantLimit: 100, rows: &fakeRows{data: nil}},
		{name: "limit_negative_defaults_100", limit: -1, wantLimit: 100, rows: &fakeRows{data: nil}},
		{name: "limit_over_max_defaults_100", limit: 1001, wantLimit: 100, rows: &fakeRows{data: nil}},
		{name: "limit_at_max_passes", limit: 1000, wantLimit: 1000, rows: &fakeRows{data: nil}},
		{name: "query_error_wrapped", limit: 100, wantLimit: 100, queryErr: queryBoom, wantErr: queryBoom, wantErrSub: "gdpr_artifact: expired"},
		{
			name: "scan_error_wrapped", limit: 100, wantLimit: 100,
			rows:    &fakeRows{data: [][]any{rowVals(a1)}, scanErr: scanBoom, scanErrAt: 1},
			wantErr: scanBoom, wantErrSub: "gdpr_artifact: scan",
		},
		{
			name: "rows_err_wrapped", limit: 100, wantLimit: 100,
			rows:    &fakeRows{data: [][]any{rowVals(a1)}, errVal: iterBoom},
			wantErr: iterBoom, wantErrSub: "gdpr_artifact: expired rows",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{rows: c.rows, queryErr: c.queryErr}
			repo := &ArtifactRepo{exec: pool}

			got, err := repo.Expired(context.Background(), c.limit)

			if len(pool.queryCalls) != 1 {
				t.Fatalf("queryCalls = %d, want 1", len(pool.queryCalls))
			}
			call := pool.queryCalls[0]
			if call.SQL != expiredSQL {
				t.Errorf("SQL = %q, want expiredSQL", call.SQL)
			}
			if len(call.Args) != 1 || call.Args[0] != any(c.wantLimit) {
				t.Errorf("args = %v, want [%d]", call.Args, c.wantLimit)
			}

			if c.wantErr != nil {
				if !errors.Is(err, c.wantErr) {
					t.Fatalf("error %v does not wrap %v", err, c.wantErr)
				}
				if !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error %q missing context %q", err.Error(), c.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got == nil {
				t.Fatal("result = nil, want non-nil slice")
			}
			if len(got) != c.wantLen {
				t.Fatalf("len = %d, want %d", len(got), c.wantLen)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// RecordDownload + Delete.
// ---------------------------------------------------------------------------

func TestArtifactRepo_RecordDownload(t *testing.T) {
	cases := []struct {
		name       string
		execErr    error
		wantErr    bool
		wantErrSub string
	}{
		{name: "success"},
		{name: "error_wrapped", execErr: errors.New("deadlock"), wantErr: true, wantErrSub: "gdpr_artifact: record download"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{execErr: c.execErr}
			repo := &ArtifactRepo{exec: pool}

			err := repo.RecordDownload(context.Background(), "art-1")

			if len(pool.execCalls) != 1 {
				t.Fatalf("execCalls = %d, want 1", len(pool.execCalls))
			}
			call := pool.execCalls[0]
			if call.SQL != recordDownloadSQL {
				t.Errorf("SQL = %q, want recordDownloadSQL", call.SQL)
			}
			if len(call.Args) != 1 || call.Args[0] != any("art-1") {
				t.Errorf("args = %v, want [art-1]", call.Args)
			}
			if c.wantErr {
				if err == nil || !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error = %v, want containing %q", err, c.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestArtifactRepo_Delete(t *testing.T) {
	cases := []struct {
		name       string
		execErr    error
		wantErr    bool
		wantErrSub string
	}{
		{name: "success"},
		{name: "error_wrapped", execErr: errors.New("fk violation"), wantErr: true, wantErrSub: "gdpr_artifact: delete"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pool := &fakeExec{execErr: c.execErr}
			repo := &ArtifactRepo{exec: pool}

			err := repo.Delete(context.Background(), "art-9")

			if len(pool.execCalls) != 1 {
				t.Fatalf("execCalls = %d, want 1", len(pool.execCalls))
			}
			call := pool.execCalls[0]
			if call.SQL != deleteSQL {
				t.Errorf("SQL = %q, want deleteSQL", call.SQL)
			}
			if len(call.Args) != 1 || call.Args[0] != any("art-9") {
				t.Errorf("args = %v, want [art-9]", call.Args)
			}
			if c.wantErr {
				if err == nil || !strings.Contains(err.Error(), c.wantErrSub) {
					t.Errorf("error = %v, want containing %q", err, c.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// TestArtifactRepo_RecordDownload_Concurrent exercises the documented
// "safe to call concurrently" contract under -race: N goroutines issue the
// atomic UPDATE and every call must reach the pool exactly once.
func TestArtifactRepo_RecordDownload_Concurrent(t *testing.T) {
	pool := &fakeExec{}
	repo := &ArtifactRepo{exec: pool}
	const n = 64

	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			if err := repo.RecordDownload(context.Background(), "art-1"); err != nil {
				t.Errorf("RecordDownload: %v", err)
			}
		}()
	}
	wg.Wait()

	if len(pool.execCalls) != n {
		t.Fatalf("execCalls = %d, want %d", len(pool.execCalls), n)
	}
	for _, c := range pool.execCalls {
		if c.SQL != recordDownloadSQL {
			t.Fatalf("unexpected SQL under concurrency: %q", c.SQL)
		}
	}
}

// ---------------------------------------------------------------------------
// SQL-shape guards. Pin the critical fragments so a column/table/clause typo
// is caught at test time rather than at runtime (matches the sibling repos'
// SQL-shape precedent).
// ---------------------------------------------------------------------------

func TestSQLShapes(t *testing.T) {
	pureSelect := func(t *testing.T, name, sql string) {
		t.Helper()
		for _, mutating := range []string{"INSERT", "UPDATE ", "DELETE"} {
			if strings.Contains(sql, mutating) {
				t.Errorf("%s must be a pure SELECT but contains %q", name, mutating)
			}
		}
	}
	contains := func(t *testing.T, name, sql string, frags ...string) {
		t.Helper()
		for _, f := range frags {
			if !strings.Contains(sql, f) {
				t.Errorf("%s missing %q\nfull SQL:\n%s", name, f, sql)
			}
		}
	}

	// The read paths share the same column projection; assert it once and
	// then again transitively via each SELECT to prove they stayed aligned
	// with scanArtifact's destination order.
	contains(t, "artifactColumns", artifactColumns,
		"id", "export_job_id", "vehicle_id", "storage_kind", "storage_path",
		"sha256", "byte_count", "created_at", "expires_at", "downloaded_at", "download_count")

	contains(t, "insertArtifactSQL", insertArtifactSQL,
		"INSERT INTO gdpr_export_artifact",
		"(id, export_job_id, vehicle_id, storage_kind, storage_path,",
		"sha256, byte_count, created_at, expires_at)",
		"VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")

	contains(t, "getByIDSQL", getByIDSQL, "FROM gdpr_export_artifact", "WHERE id = $1")
	pureSelect(t, "getByIDSQL", getByIDSQL)

	contains(t, "listByVehicleSQL", listByVehicleSQL,
		"FROM gdpr_export_artifact", "WHERE vehicle_id = $1", "ORDER BY created_at DESC", "LIMIT $2")
	pureSelect(t, "listByVehicleSQL", listByVehicleSQL)

	contains(t, "expiredSQL", expiredSQL,
		"FROM gdpr_export_artifact", "WHERE expires_at < now()", "ORDER BY expires_at ASC", "LIMIT $1")
	pureSelect(t, "expiredSQL", expiredSQL)

	contains(t, "recordDownloadSQL", recordDownloadSQL,
		"UPDATE gdpr_export_artifact", "download_count = download_count + 1", "downloaded_at", "now()", "WHERE id = $1")

	contains(t, "deleteSQL", deleteSQL, "DELETE FROM gdpr_export_artifact WHERE id = $1")
}
