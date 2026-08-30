package fsd

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// pgx test doubles — this codebase does not vendor pgxmock, so the repo's
// scan/iterate logic is exercised through the narrow signalLogQuerier seam.
// ---------------------------------------------------------------------------

type fakeQuerier struct {
	queryFn  func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	lastSQL  string
	lastArgs []any
	calls    int
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.calls++
	f.lastSQL = sql
	f.lastArgs = args
	return f.queryFn(ctx, sql, args...)
}

var _ signalLogQuerier = (*fakeQuerier)(nil)

type fakeRows struct {
	scans   []func(dest ...any) error
	iterErr error
	pos     int
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.scans) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error { return r.scans[r.pos-1](dest...) }
func (r *fakeRows) Close()                 { r.closed = true }
func (r *fakeRows) Err() error             { return r.iterErr }

func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// sampleScan builds a scan closure for a trusted version-1 row matching the
// (field, ts, value, normalization_version) projection.
func sampleScan(field string, ts time.Time, value *float64) func(dest ...any) error {
	version := trustedSignalLogNormalizationVersion
	return sampleScanWithVersion(field, ts, value, &version)
}

// A nil value or version leaves the corresponding pointer destination
// untouched, exactly as pgx surfaces a SQL NULL.
func sampleScanWithVersion(field string, ts time.Time, value *float64, version *int16) func(dest ...any) error {
	return func(dest ...any) error {
		*(dest[0].(*string)) = field
		*(dest[1].(*time.Time)) = ts
		if value != nil {
			*(dest[2].(**float64)) = value
		}
		if version != nil {
			*(dest[3].(**int16)) = version
		}
		return nil
	}
}

// ---------------------------------------------------------------------------
// SQL shape — pinned without a live database so an accidental edit that drops
// the index-aligned predicates or the NULL-safe projection is caught here.
// ---------------------------------------------------------------------------

func TestWindowSamplesSQL_ShapeIsIndexAligned(t *testing.T) {
	for _, want := range []string{
		"FROM signal_log",
		"vehicle_id = $1",
		"field = ANY($2)",
		"ts >= $3",
		"ts <= $4",
		"COALESCE(float_value, int_value::float8)",
		"normalization_version",
	} {
		if !strings.Contains(windowSamplesSQL, want) {
			t.Errorf("windowSamplesSQL missing %q", want)
		}
	}
	// No ORDER BY: the index is DESC on ts, and Aggregate re-sorts every
	// field's samples anyway (it has to — the baseline and window result sets
	// are concatenated). Asking the planner for an ascending order it cannot
	// serve from the index buys a sort node whose output is discarded.
	if strings.Contains(windowSamplesSQL, "ORDER BY") {
		t.Error("windowSamplesSQL must not ORDER BY — Aggregate sorts per field and the index is DESC")
	}
	// The dropped snapshot tables must never reappear in this read path.
	for _, forbidden := range []string{"safety_snapshots", "vehicle_live_state", "value_num", "created_at"} {
		if strings.Contains(windowSamplesSQL, forbidden) {
			t.Errorf("windowSamplesSQL references %q", forbidden)
		}
	}
}

func TestBaselineSamplesSQL_TakesExactlyOneRowPerField(t *testing.T) {
	for _, want := range []string{
		"DISTINCT ON (field)",
		"ts < $3",
		"normalization_version >= $4",
		"ORDER BY field, ts DESC",
	} {
		if !strings.Contains(baselineSamplesSQL, want) {
			t.Errorf("baselineSamplesSQL missing %q", want)
		}
	}
}

func TestCounterFields_AreTheTwoCanonicalCounters(t *testing.T) {
	fields := counterFields()
	if len(fields) != 2 || fields[0] != "SelfDrivingMilesSinceReset" || fields[1] != "MilesSinceReset" {
		t.Fatalf("counterFields() = %v", fields)
	}
}

// ---------------------------------------------------------------------------
// WindowSamples
// ---------------------------------------------------------------------------

func TestRepo_WindowSamples_ScansRowsAndPassesBounds(t *testing.T) {
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 3, 3, 12, 0, 0, 0, time.UTC)
	rows := &fakeRows{scans: []func(dest ...any) error{
		sampleScan(SignalFSDDistance, from.Add(time.Hour), fp(1500)),
		sampleScan(SignalDrivingDistance, from.Add(2*time.Hour), nil),
	}}
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return rows, nil }}
	repo := &Repo{pool: q}

	got, err := repo.WindowSamples(context.Background(), 42, counterFields(), from, to)
	if err != nil {
		t.Fatalf("WindowSamples: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	if got[0].Field != SignalFSDDistance || got[0].Value == nil || *got[0].Value != 1500 {
		t.Errorf("row 0 = %+v", got[0])
	}
	if got[0].NormalizationVersion == nil || *got[0].NormalizationVersion != trustedSignalLogNormalizationVersion {
		t.Errorf("row 0 normalization version = %v", got[0].NormalizationVersion)
	}
	if got[1].Value != nil {
		t.Errorf("SQL NULL must scan to a nil value, got %v", *got[1].Value)
	}
	if !rows.closed {
		t.Error("rows must be closed")
	}
	if q.lastArgs[0] != int64(42) {
		t.Errorf("vehicle_id arg = %v", q.lastArgs[0])
	}
	if q.lastArgs[2] != from || q.lastArgs[3] != to {
		t.Errorf("bounds args = %v / %v", q.lastArgs[2], q.lastArgs[3])
	}
}

func TestRepo_WindowSamples_PreservesUnknownNormalizationProvenance(t *testing.T) {
	at := time.Date(2026, 5, 25, 12, 0, 0, 0, time.UTC)
	rows := &fakeRows{scans: []func(dest ...any) error{
		sampleScanWithVersion(SignalFSDDistance, at, fp(1609.344), nil),
	}}
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return rows, nil }}

	got, err := (&Repo{pool: q}).WindowSamples(context.Background(), 42, counterFields(), at, at)
	if err != nil {
		t.Fatalf("WindowSamples: %v", err)
	}
	if len(got) != 1 || got[0].NormalizationVersion != nil {
		t.Fatalf("got %+v, want one row with unknown provenance", got)
	}
}

func TestRepo_WindowSamples_EmptyResultIsNonNilSlice(t *testing.T) {
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
		return &fakeRows{}, nil
	}}
	repo := &Repo{pool: q}

	got, err := repo.WindowSamples(context.Background(), 1, counterFields(), time.Now(), time.Now())
	if err != nil {
		t.Fatalf("WindowSamples: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("got %v, want empty non-nil slice", got)
	}
}

func TestRepo_WindowSamples_QueryErrorIsWrapped(t *testing.T) {
	sentinel := errors.New("pool exhausted")
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
		return nil, sentinel
	}}
	repo := &Repo{pool: q}

	_, err := repo.WindowSamples(context.Background(), 9, counterFields(), time.Now(), time.Now())
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want wrapped sentinel", err)
	}
	if !strings.Contains(err.Error(), "vehicle 9") {
		t.Errorf("error should name the vehicle: %v", err)
	}
}

func TestRepo_WindowSamples_ScanErrorFailsTheWholeCall(t *testing.T) {
	sentinel := errors.New("bad column")
	rows := &fakeRows{scans: []func(dest ...any) error{
		func(...any) error { return sentinel },
	}}
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return rows, nil }}
	repo := &Repo{pool: q}

	// A dropped row would silently understate distance, so the read fails
	// loudly instead of degrading.
	if _, err := repo.WindowSamples(context.Background(), 1, counterFields(), time.Now(), time.Now()); !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want wrapped sentinel", err)
	}
	if !rows.closed {
		t.Error("rows must be closed even on scan failure")
	}
}

func TestRepo_WindowSamples_IterationErrorIsSurfaced(t *testing.T) {
	sentinel := errors.New("connection reset mid-stream")
	rows := &fakeRows{
		scans:   []func(dest ...any) error{sampleScan(SignalFSDDistance, time.Now(), fp(1))},
		iterErr: sentinel,
	}
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return rows, nil }}
	repo := &Repo{pool: q}

	if _, err := repo.WindowSamples(context.Background(), 1, counterFields(), time.Now(), time.Now()); !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want wrapped sentinel", err)
	}
}

// ---------------------------------------------------------------------------
// BaselineSamples
// ---------------------------------------------------------------------------

func TestRepo_BaselineSamples_PassesTheExclusiveUpperBound(t *testing.T) {
	before := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	rows := &fakeRows{scans: []func(dest ...any) error{
		sampleScan(SignalFSDDistance, before.Add(-time.Hour), fp(4000)),
	}}
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) { return rows, nil }}
	repo := &Repo{pool: q}

	got, err := repo.BaselineSamples(context.Background(), 5, counterFields(), before)
	if err != nil {
		t.Fatalf("BaselineSamples: %v", err)
	}
	if len(got) != 1 || got[0].TS.After(before) {
		t.Fatalf("got %+v", got)
	}
	if q.lastArgs[2] != before {
		t.Errorf("before arg = %v, want %v", q.lastArgs[2], before)
	}
	if q.lastArgs[3] != trustedSignalLogNormalizationVersion {
		t.Errorf("normalization version arg = %v, want %d", q.lastArgs[3], trustedSignalLogNormalizationVersion)
	}
	if q.lastSQL != baselineSamplesSQL {
		t.Error("BaselineSamples must issue the DISTINCT ON statement")
	}
}

func TestRepo_BaselineSamples_QueryErrorIsWrapped(t *testing.T) {
	sentinel := errors.New("timeout")
	q := &fakeQuerier{queryFn: func(context.Context, string, ...any) (pgx.Rows, error) {
		return nil, sentinel
	}}
	repo := &Repo{pool: q}

	if _, err := repo.BaselineSamples(context.Background(), 3, counterFields(), time.Now()); !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want wrapped sentinel", err)
	}
}

func TestNewRepo_NilPoolPanicsAsAWiringBug(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected a panic for a nil pool")
		}
	}()
	_ = NewRepo(nil)
}

// ---------------------------------------------------------------------------
// deadline ownership
// ---------------------------------------------------------------------------

func TestRepo_DoesNotMintItsOwnDeadline(t *testing.T) {
	// The handler owns ONE budget for the whole request. A repo that wrapped
	// its query in another WithTimeout would silently hand the second read a
	// fresh allowance, so the endpoint's worst case would be double what any
	// timeout advertises.
	caller, cancel := context.WithDeadline(context.Background(), time.Now().Add(3*time.Second))
	defer cancel()
	callerDeadline, _ := caller.Deadline()

	var seen []context.Context
	q := &fakeQuerier{queryFn: func(ctx context.Context, _ string, _ ...any) (pgx.Rows, error) {
		seen = append(seen, ctx)
		return &fakeRows{}, nil
	}}
	repo := &Repo{pool: q}

	if _, err := repo.BaselineSamples(caller, 1, counterFields(), time.Now()); err != nil {
		t.Fatalf("BaselineSamples: %v", err)
	}
	if _, err := repo.WindowSamples(caller, 1, counterFields(), time.Now(), time.Now()); err != nil {
		t.Fatalf("WindowSamples: %v", err)
	}

	if len(seen) != 2 {
		t.Fatalf("expected 2 queries, got %d", len(seen))
	}
	for i, ctx := range seen {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatalf("query %d lost the caller's deadline", i)
		}
		if !deadline.Equal(callerDeadline) {
			t.Errorf("query %d deadline = %v, want the caller's %v (repo must not add its own)",
				i, deadline, callerDeadline)
		}
	}
}

func TestRepo_PropagatesCallerCancellation(t *testing.T) {
	caller, cancel := context.WithCancel(context.Background())
	cancel()

	var seenErr error
	q := &fakeQuerier{queryFn: func(ctx context.Context, _ string, _ ...any) (pgx.Rows, error) {
		seenErr = ctx.Err()
		return &fakeRows{}, nil
	}}
	repo := &Repo{pool: q}

	if _, err := repo.WindowSamples(caller, 1, counterFields(), time.Now(), time.Now()); err != nil {
		t.Fatalf("WindowSamples: %v", err)
	}
	if !errors.Is(seenErr, context.Canceled) {
		t.Errorf("query ctx err = %v, want context.Canceled", seenErr)
	}
}
