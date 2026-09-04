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

func compactedSampleScan(
	field string,
	ts time.Time,
	value *float64,
	validCount, invalidCount, untrustedCount int,
	firstValidAt, lastValidAt *time.Time,
) func(dest ...any) error {
	version := trustedSignalLogNormalizationVersion
	return func(dest ...any) error {
		if len(dest) != 10 {
			return errors.New("unexpected compacted sample projection")
		}
		*(dest[0].(*string)) = field
		*(dest[1].(*time.Time)) = ts
		if value != nil {
			*(dest[2].(**float64)) = value
		}
		*(dest[3].(**int16)) = &version
		*(dest[4].(*bool)) = true
		*(dest[5].(*int)) = validCount
		*(dest[6].(*int)) = invalidCount
		*(dest[7].(*int)) = untrustedCount
		if firstValidAt != nil {
			*(dest[8].(**time.Time)) = firstValidAt
		}
		if lastValidAt != nil {
			*(dest[9].(**time.Time)) = lastValidAt
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
		"ts < $4",
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

func TestBaselineSamplesSQL_TakesNewestRawRowPerField(t *testing.T) {
	for _, want := range []string{
		"DISTINCT ON (field)",
		"ts < $3",
		"ORDER BY field, ts DESC",
	} {
		if !strings.Contains(baselineSamplesSQL, want) {
			t.Errorf("baselineSamplesSQL missing %q", want)
		}
	}
	if strings.Contains(baselineSamplesSQL, "normalization_version >=") {
		t.Error("baseline query must return an untrusted latest row as a continuity barrier")
	}
}

func TestCounterFields_AreTheTwoCanonicalCounters(t *testing.T) {
	fields := counterFields()
	if len(fields) != 2 || fields[0] != "SelfDrivingMilesSinceReset" || fields[1] != "MilesSinceReset" {
		t.Fatalf("counterFields() = %v", fields)
	}
}

func TestAnalyticsSQL_UsesHalfOpenSetBasedWindows(t *testing.T) {
	t.Parallel()

	for _, want := range []string{
		"FROM signal_log",
		"vehicle_id = $1",
		"field = ANY($2)",
		"ts >= $3",
		"ts < $5",
		"DISTINCT ON (field)",
		"range_samples AS",
		"date_bin(",
		"INTERVAL '1 minute'",
		"selected_timestamps AS",
		"bucket_first_at",
		"bucket_last_at",
		"paired_bucket_first_at",
		"paired_bucket_last_at",
		"valid_observation_count",
		"untrusted_observation_count",
		"previous_barrier",
		"next_barrier",
		"previous_value IS NULL",
		"ORDER BY ts ASC, field ASC",
	} {
		if !strings.Contains(analyticsCounterSamplesSQL, want) {
			t.Errorf("analyticsCounterSamplesSQL missing %q", want)
		}
	}
	counterBaselineSQL := strings.Split(analyticsCounterSamplesSQL, "raw_values AS")[0]
	if strings.Contains(counterBaselineSQL, "normalization_version >=") {
		t.Error("analytics counter baseline must return the newest raw row as a continuity barrier")
	}
	for _, want := range []string{
		"FROM drives",
		"vehicle_id = $1",
		"started_at < $3",
		"COALESCE(ended_at, $3) > $2",
		"distance_m",
		"energy_used_wh",
	} {
		if !strings.Contains(analyticsDrivesSQL, want) {
			t.Errorf("analyticsDrivesSQL missing %q", want)
		}
	}
	for _, want := range []string{
		"field = 'Version'",
		"ts < $2",
		"ts >= $2",
		"ts < $3",
		"normalization_version",
		"ORDER BY ts",
		"range_samples AS",
	} {
		if !strings.Contains(analyticsVersionSamplesSQL, want) {
			t.Errorf("analyticsVersionSamplesSQL missing %q", want)
		}
	}
	if strings.Contains(analyticsVersionSamplesSQL, "normalization_version >=") {
		t.Error("firmware query must return rejected rows so they can clear stale attribution")
	}

	all := analyticsCounterSamplesSQL + analyticsDrivesSQL + analyticsVersionSamplesSQL
	if strings.Contains(strings.ToUpper(all), "WINDOW AS") {
		t.Error("analytics SQL must not use PostgreSQL's reserved WINDOW keyword as a CTE name")
	}
	for _, forbidden := range []string{
		"start_ts",
		"end_ts",
		"energy_used_kwh",
		"safety_snapshots",
		"vehicle_live_state",
	} {
		if strings.Contains(all, forbidden) {
			t.Errorf("analytics SQL references stale or unrelated schema token %q", forbidden)
		}
	}
}

func TestRepo_LoadAnalyticsInputScansAllThreeSets(t *testing.T) {
	t.Parallel()

	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	split := start.Add(24 * time.Hour)
	end := start.Add(48 * time.Hour)
	previousFirst := start.Add(55 * time.Minute)
	previousLast := start.Add(time.Hour)
	currentFirst := split.Add(55 * time.Minute)
	currentLast := split.Add(time.Hour)
	counterRows := &fakeRows{scans: []func(dest ...any) error{
		compactedSampleScan(
			SignalFSDDistance,
			previousLast,
			fp(1609.344),
			6,
			0,
			0,
			&previousFirst,
			&previousLast,
		),
		compactedSampleScan(
			SignalFSDDistance,
			currentLast,
			fp(3218.688),
			6,
			0,
			0,
			&currentFirst,
			&currentLast,
		),
	}}
	driveEnd := start.Add(3 * time.Hour)
	startPlace := "Home"
	endPlace := "Office"
	startGeofenceID := int64(10)
	endGeofenceID := int64(20)
	distanceM := 12000.0
	energyUsedWh := 2200.0
	driveRows := &fakeRows{scans: []func(dest ...any) error{
		func(dest ...any) error {
			if len(dest) != 9 {
				t.Fatalf("drive scan destinations = %d, want 9", len(dest))
			}
			*(dest[0].(*int64)) = 295
			*(dest[1].(*time.Time)) = start.Add(2 * time.Hour)
			*(dest[2].(**time.Time)) = &driveEnd
			*(dest[3].(**string)) = &startPlace
			*(dest[4].(**string)) = &endPlace
			*(dest[5].(**int64)) = &startGeofenceID
			*(dest[6].(**int64)) = &endGeofenceID
			*(dest[7].(**float64)) = &distanceM
			*(dest[8].(**float64)) = &energyUsedWh
			return nil
		},
	}}
	version := "2026.20.3"
	versionNormalization := int16(trustedSignalLogNormalizationVersion)
	versionRows := &fakeRows{scans: []func(dest ...any) error{
		func(dest ...any) error {
			if len(dest) != 3 {
				t.Fatalf("version scan destinations = %d, want 3", len(dest))
			}
			*(dest[0].(*time.Time)) = start
			*(dest[1].(**string)) = &version
			*(dest[2].(**int16)) = &versionNormalization
			return nil
		},
	}}

	var queries []string
	var args [][]any
	call := 0
	q := &fakeQuerier{queryFn: func(_ context.Context, sql string, queryArgs ...any) (pgx.Rows, error) {
		queries = append(queries, sql)
		args = append(args, append([]any(nil), queryArgs...))
		call++
		switch call {
		case 1:
			return counterRows, nil
		case 2:
			return driveRows, nil
		case 3:
			return versionRows, nil
		default:
			t.Fatalf("unexpected query %d", call)
			return nil, nil
		}
	}}

	input, err := (&Repo{pool: q}).LoadAnalyticsInput(
		context.Background(),
		42,
		start,
		split,
		end,
	)
	if err != nil {
		t.Fatalf("LoadAnalyticsInput: %v", err)
	}
	if len(input.PreviousCounterSamples) != 1 ||
		len(input.CounterSamples) != 2 ||
		len(input.Drives) != 1 ||
		len(input.VersionSamples) != 1 {
		t.Fatalf("input sizes = previous counters %d, current counters %d, drives %d, versions %d",
			len(input.PreviousCounterSamples),
			len(input.CounterSamples),
			len(input.Drives),
			len(input.VersionSamples))
	}
	if !input.CounterSamples[0].TS.Equal(previousLast) ||
		!input.CounterSamples[1].TS.Equal(currentLast) {
		t.Errorf("current samples must contain latest prior baseline plus current range: %+v", input.CounterSamples)
	}
	if !input.CounterSamples[1].Compacted ||
		input.CounterSamples[1].ValidObservationCount != 6 ||
		input.CounterSamples[1].FirstValidObservationAt == nil ||
		!input.CounterSamples[1].FirstValidObservationAt.Equal(currentFirst) {
		t.Errorf("compacted counter metadata = %+v", input.CounterSamples[1])
	}
	if input.Drives[0].ID != 295 ||
		input.Drives[0].DistanceM == nil ||
		*input.Drives[0].DistanceM != distanceM ||
		input.Drives[0].EnergyUsedWh == nil ||
		*input.Drives[0].EnergyUsedWh != energyUsedWh {
		t.Errorf("drive = %+v", input.Drives[0])
	}
	if input.VersionSamples[0].Version != version {
		t.Errorf("version = %+v", input.VersionSamples[0])
	}
	if input.VersionSamples[0].NormalizationVersion == nil ||
		*input.VersionSamples[0].NormalizationVersion != trustedSignalLogNormalizationVersion {
		t.Errorf("version normalization = %+v", input.VersionSamples[0])
	}
	if len(queries) != 3 ||
		queries[0] != analyticsCounterSamplesSQL ||
		queries[1] != analyticsDrivesSQL ||
		queries[2] != analyticsVersionSamplesSQL {
		t.Errorf("queries issued in unexpected order")
	}
	if len(args[0]) != 7 ||
		args[0][0] != int64(42) ||
		args[0][2] != start ||
		args[0][3] != split ||
		args[0][4] != end ||
		args[0][5] != trustedSignalLogNormalizationVersion ||
		args[0][6] != SignalFSDDistance {
		t.Errorf("counter args = %v", args[0])
	}
	if len(args[1]) != 3 || args[1][0] != int64(42) || args[1][1] != start || args[1][2] != end {
		t.Errorf("drive args = %v", args[1])
	}
	if len(args[2]) != 3 || args[2][0] != int64(42) || args[2][1] != split || args[2][2] != end {
		t.Errorf("version args = %v", args[2])
	}
	if !counterRows.closed || !driveRows.closed || !versionRows.closed {
		t.Error("every analytics result set must be closed")
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
	if len(q.lastArgs) != 3 {
		t.Errorf("baseline args = %v, want vehicle, fields, and boundary only", q.lastArgs)
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
