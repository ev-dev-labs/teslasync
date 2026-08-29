// White-box tests for the Scorer read-side primitive and its scoring
// math. Snapshot is driven through a fake Querier/Rows so every branch —
// nil receiver, nil pool, query/scan/rows.Err failures, populated and
// empty success, window defaulting, context deadline and parameterised
// SQL — is exercised without a database. compositeScore, linearScore and
// severity are table-driven against their documented contracts.

package dataquality

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"
)

// ----- fakes -----------------------------------------------------------

var (
	_ Querier = (*fakeQuerier)(nil)
	_ Rows    = (*fakeRows)(nil)
)

// fakeRow mirrors one firmware/field aggregate scanned by Snapshot.
type fakeRow struct {
	firmware    *string
	vehicles    int64
	field       string
	count       int64
	lastSeen    time.Time
	maxGap      float64
	dupRatio    float64
	versioned   int64
	unversioned int64
}

// fakeRows implements Rows over an in-memory slice.
type fakeRows struct {
	rows       []fakeRow
	idx        int
	scanErr    error // returned by Scan when set (before any assignment)
	iterErr    error // returned by Err (simulates an iteration failure)
	closeCount int
}

func (r *fakeRows) Next() bool { return r.idx < len(r.rows) }

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if r.idx >= len(r.rows) {
		return errors.New("fakeRows: Scan past end")
	}
	if len(dest) != 10 {
		return errors.New("fakeRows: unexpected dest count")
	}
	row := r.rows[r.idx]
	r.idx++
	firmwarep, ok := dest[0].(**string)
	if !ok {
		return errors.New("fakeRows: dest[0] not **string")
	}
	vehiclesp, ok := dest[1].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[1] not *int64")
	}
	fieldp, ok := dest[2].(*string)
	if !ok {
		return errors.New("fakeRows: dest[2] not *string")
	}
	countp, ok := dest[3].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[3] not *int64")
	}
	seenp, ok := dest[4].(*time.Time)
	if !ok {
		return errors.New("fakeRows: dest[4] not *time.Time")
	}
	gapp, ok := dest[5].(*float64)
	if !ok {
		return errors.New("fakeRows: dest[5] not *float64")
	}
	duplicatep, ok := dest[6].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[6] not *int64")
	}
	comparisonp, ok := dest[7].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[7] not *int64")
	}
	versionedp, ok := dest[8].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[8] not *int64")
	}
	unversionedp, ok := dest[9].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[9] not *int64")
	}
	vehicles := row.vehicles
	if vehicles == 0 {
		vehicles = 1
	}
	*firmwarep, *vehiclesp = row.firmware, vehicles
	*fieldp, *countp, *seenp, *gapp = row.field, row.count, row.lastSeen, row.maxGap
	*comparisonp = 1000
	*duplicatep = int64(math.Round(row.dupRatio * float64(*comparisonp)))
	*versionedp, *unversionedp = row.versioned, row.unversioned
	return nil
}

func (r *fakeRows) Close()     { r.closeCount++ }
func (r *fakeRows) Err() error { return r.iterErr }

// fakeVersionRow mirrors one bucket of the GROUP BY normalization_version
// aggregate.
type fakeVersionRow struct {
	version *int16
	count   int64
}

// fakeVersionRows implements Rows for the second (normalization) query.
type fakeVersionRows struct {
	rows       []fakeVersionRow
	idx        int
	scanErr    error
	iterErr    error
	closeCount int
}

func (r *fakeVersionRows) Next() bool { return r.idx < len(r.rows) }

func (r *fakeVersionRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if r.idx >= len(r.rows) {
		return errors.New("fakeVersionRows: Scan past end")
	}
	if len(dest) != 2 {
		return errors.New("fakeVersionRows: unexpected dest count")
	}
	versionp, ok := dest[0].(**int16)
	if !ok {
		return errors.New("fakeVersionRows: dest[0] not **int16")
	}
	countp, ok := dest[1].(*int64)
	if !ok {
		return errors.New("fakeVersionRows: dest[1] not *int64")
	}
	row := r.rows[r.idx]
	r.idx++
	*versionp, *countp = row.version, row.count
	return nil
}

func (r *fakeVersionRows) Close()     { r.closeCount++ }
func (r *fakeVersionRows) Err() error { return r.iterErr }

// versionOf returns a pointer to a normalization_version literal. A nil
// pointer is the legacy/unknown bucket and is never interchangeable with 0.
func versionOf(v int16) *int16 { return &v }

// fakeQuerier implements Querier and records what it saw. It routes on the
// SQL text so a single fake can serve both bounded queries Snapshot issues.
type fakeQuerier struct {
	rows        *fakeRows
	versionRows *fakeVersionRows

	queryErr        error
	versionQueryErr error

	gotSQL         string
	gotArgs        []any
	gotVersionSQL  string
	gotVersionArgs []any
	gotCtx         context.Context
	seenSQL        []string
	queryCount     int

	// scoreRowsOpenAtVersionQuery records whether the first cursor was
	// still open when the second query was issued. Snapshot must close
	// the score rows first so one pooled connection never holds two
	// live result sets.
	scoreRowsOpenAtVersionQuery bool
}

func (q *fakeQuerier) isVersionQuery(sql string) bool {
	return strings.Contains(sql, "GROUP BY normalization_version")
}

func (q *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	q.queryCount++
	q.gotCtx = ctx
	q.seenSQL = append(q.seenSQL, sql)

	if q.isVersionQuery(sql) {
		q.gotVersionSQL = sql
		q.gotVersionArgs = args
		q.scoreRowsOpenAtVersionQuery = q.rows != nil && q.rows.closeCount == 0
		if q.versionQueryErr != nil {
			return nil, q.versionQueryErr
		}
		if q.versionRows == nil {
			q.versionRows = &fakeVersionRows{}
		}
		return q.versionRows, nil
	}

	q.gotSQL = sql
	q.gotArgs = args
	if q.queryErr != nil {
		return nil, q.queryErr
	}
	// Return a typed nil-safe value: if rows is nil, hand back an empty
	// non-nil fakeRows so Snapshot's defer rows.Close() never nil-derefs.
	if q.rows == nil {
		q.rows = &fakeRows{}
	}
	return q.rows, nil
}

// ----- helpers ---------------------------------------------------------

const floatTol = 1e-9

func almostEqual(a, b float64) bool { return math.Abs(a-b) <= floatTol }

// fixedClock returns a now func pinned to t so freshness is deterministic.
func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

// ----- NewScorer -------------------------------------------------------

func TestNewScorer_WindowDefaulting(t *testing.T) {
	q := &fakeQuerier{}
	tests := []struct {
		name string
		in   int
		want int
	}{
		{"zero defaults to 60", 0, 60},
		{"negative defaults to 60", -1, 60},
		{"large negative defaults to 60", -9999, 60},
		{"one is kept", 1, 1},
		{"sixty is kept", 60, 60},
		{"custom kept", 120, 120},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewScorer(q, tt.in)
			if s == nil {
				t.Fatal("NewScorer returned nil")
			}
			if s.windowMins != tt.want {
				t.Errorf("windowMins = %d, want %d", s.windowMins, tt.want)
			}
		})
	}
}

func TestNewScorer_Defaults(t *testing.T) {
	s := NewScorer(&fakeQuerier{}, 60)
	if s.now == nil {
		t.Error("now func must be wired")
	}
	if s.queryTime != 10*time.Second {
		t.Errorf("queryTime = %v, want 10s", s.queryTime)
	}
	if s.pool == nil {
		t.Error("pool must be stored")
	}
	// The default clock must be a real wall-clock: within a second of now.
	if d := time.Since(s.now()); d < -time.Second || d > time.Second {
		t.Errorf("default now() drifted from time.Now by %v", d)
	}
}

// ----- Snapshot: not-configured paths ----------------------------------

func TestSnapshot_NotConfigured(t *testing.T) {
	tests := []struct {
		name string
		s    *Scorer
	}{
		{"nil receiver", nil},
		{"nil pool via NewScorer", NewScorer(nil, 60)},
		{"zero-value scorer", &Scorer{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			snap, err := tt.s.Snapshot(context.Background())
			if !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("err = %v, want ErrNotConfigured", err)
			}
			if snap != nil {
				t.Errorf("snap = %+v, want nil", snap)
			}
		})
	}
}

// ----- Snapshot: error paths -------------------------------------------

func TestSnapshot_Errors(t *testing.T) {
	sentinel := errors.New("underlying failure")
	tests := []struct {
		name        string
		querier     *fakeQuerier
		wantContext string
	}{
		{
			name:        "query failure",
			querier:     &fakeQuerier{queryErr: sentinel},
			wantContext: "signal_log score query",
		},
		{
			name: "scan failure",
			querier: &fakeQuerier{rows: &fakeRows{
				rows:    []fakeRow{{field: "VehicleSpeed", count: 1, lastSeen: time.Now()}},
				scanErr: sentinel,
			}},
			wantContext: "scan",
		},
		{
			name: "rows iteration failure",
			querier: &fakeQuerier{rows: &fakeRows{
				rows:    nil, // Next() false immediately
				iterErr: sentinel,
			}},
			wantContext: "rows.Err",
		},
		{
			name:        "normalization version query failure",
			querier:     &fakeQuerier{versionQueryErr: sentinel},
			wantContext: "signal_log normalization version query",
		},
		{
			name: "normalization version scan failure",
			querier: &fakeQuerier{versionRows: &fakeVersionRows{
				rows:    []fakeVersionRow{{version: versionOf(1), count: 5}},
				scanErr: sentinel,
			}},
			wantContext: "scan normalization version",
		},
		{
			name: "normalization version iteration failure",
			querier: &fakeQuerier{versionRows: &fakeVersionRows{
				rows:    nil,
				iterErr: sentinel,
			}},
			wantContext: "normalization rows.Err",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewScorer(tt.querier, 60)
			snap, err := s.Snapshot(context.Background())
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if snap != nil {
				t.Errorf("snap = %+v, want nil on error", snap)
			}
			if !errors.Is(err, sentinel) {
				t.Errorf("err = %v, want to wrap sentinel via %%w", err)
			}
			if !strings.Contains(err.Error(), tt.wantContext) {
				t.Errorf("err = %q, want to contain context %q", err.Error(), tt.wantContext)
			}
		})
	}
}

// ----- Snapshot: success -----------------------------------------------

func TestSnapshot_Success(t *testing.T) {
	now := time.Date(2026, 7, 5, 20, 0, 0, 0, time.UTC)
	fresh := now.Add(-10 * time.Second) // 10s ago  -> freshness axis 100
	stale := now.Add(-2 * time.Hour)    // 7200s ago -> freshness axis 0

	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			// perfect: fresh, no gap, no dupes -> composite ~100 -> ok
			{field: "FreshField", count: 100, lastSeen: fresh, maxGap: 0, dupRatio: 0, versioned: 100},
			// stale only: freshness 0, gap 100, dupe 100 -> ~66.7 -> warn
			{field: "WarnField", count: 80, lastSeen: stale, maxGap: 0, dupRatio: 0, versioned: 60, unversioned: 20},
			// worst: stale, huge gap, half dupes -> composite 0 -> critical
			{field: "CritField", count: 20, lastSeen: stale, maxGap: 600, dupRatio: 0.5, versioned: 10, unversioned: 10},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: nil, count: 30},
			{version: versionOf(1), count: 170},
		}},
	}

	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snap == nil {
		t.Fatal("snap is nil")
	}
	if !snap.GeneratedAt.Equal(now) {
		t.Errorf("GeneratedAt = %v, want %v", snap.GeneratedAt, now)
	}
	if snap.WindowMins != 60 {
		t.Errorf("WindowMins = %d, want 60", snap.WindowMins)
	}
	if snap.Normalization.CoveragePct == nil || !almostEqual(*snap.Normalization.CoveragePct, 85) {
		t.Errorf("aggregate normalization coverage = %v, want 85", snap.Normalization.CoveragePct)
	}
	if snap.Normalization.TotalSampleCount != 200 ||
		snap.Normalization.VersionedSampleCount != 170 ||
		snap.Normalization.UnversionedSampleCount != 30 {
		t.Errorf("aggregate normalization counts = %d/%d/%d, want 200/170/30",
			snap.Normalization.TotalSampleCount,
			snap.Normalization.VersionedSampleCount,
			snap.Normalization.UnversionedSampleCount)
	}
	if snap.Normalization.CoverageState != "measured" {
		t.Errorf("normalization state = %q, want measured", snap.Normalization.CoverageState)
	}
	if snap.Normalization.RequiredVersion != 1 || snap.RequiredNormalizationVersion != 1 {
		t.Errorf("required version = %d/%d, want 1/1",
			snap.Normalization.RequiredVersion, snap.RequiredNormalizationVersion)
	}
	if len(snap.Normalization.Versions) != 2 {
		t.Fatalf("versions = %d, want 2", len(snap.Normalization.Versions))
	}
	if snap.Normalization.Versions[0].Version != nil {
		t.Errorf("versions[0].Version = %v, want nil (legacy bucket)", *snap.Normalization.Versions[0].Version)
	}
	if snap.Normalization.Versions[0].SampleCount != 30 {
		t.Errorf("versions[0].SampleCount = %d, want 30", snap.Normalization.Versions[0].SampleCount)
	}
	if snap.Normalization.Versions[0].SharePct == nil ||
		!almostEqual(*snap.Normalization.Versions[0].SharePct, 15) {
		t.Errorf("versions[0].SharePct = %v, want 15", snap.Normalization.Versions[0].SharePct)
	}
	if snap.Normalization.Versions[1].Version == nil || *snap.Normalization.Versions[1].Version != 1 {
		t.Errorf("versions[1].Version = %v, want 1", snap.Normalization.Versions[1].Version)
	}
	if snap.Fields == nil {
		t.Fatal("Fields must serialise as [] not nil")
	}
	if len(snap.Fields) != 3 {
		t.Fatalf("len(Fields) = %d, want 3", len(snap.Fields))
	}

	// Worst-first ordering: composite non-decreasing.
	for i := 1; i < len(snap.Fields); i++ {
		if snap.Fields[i-1].CompositeScore > snap.Fields[i].CompositeScore {
			t.Errorf("not sorted ascending at %d: %v > %v",
				i, snap.Fields[i-1].CompositeScore, snap.Fields[i].CompositeScore)
		}
	}
	if snap.Fields[0].Field != "CritField" {
		t.Errorf("worst = %q, want CritField", snap.Fields[0].Field)
	}
	if snap.Fields[len(snap.Fields)-1].Field != "FreshField" {
		t.Errorf("best = %q, want FreshField", snap.Fields[len(snap.Fields)-1].Field)
	}

	// Per-field derived values must match the documented math exactly.
	byField := map[string]FieldScore{}
	for _, f := range snap.Fields {
		byField[f.Field] = f
	}

	if f := byField["FreshField"]; !almostEqual(f.FreshnessSeconds, 10) {
		t.Errorf("FreshField freshness = %v, want 10", f.FreshnessSeconds)
	}
	if f := byField["CritField"]; !almostEqual(f.FreshnessSeconds, 7200) {
		t.Errorf("CritField freshness = %v, want 7200", f.FreshnessSeconds)
	}
	for _, f := range snap.Fields {
		if want := compositeScore(f); !almostEqual(f.CompositeScore, want) {
			t.Errorf("%s composite = %v, want %v", f.Field, f.CompositeScore, want)
		}
		if want := severity(f); f.Severity != want {
			t.Errorf("%s severity = %q, want %q", f.Field, f.Severity, want)
		}
	}
	if s := byField["FreshField"].Severity; s != "ok" {
		t.Errorf("FreshField severity = %q, want ok", s)
	}
	if s := byField["CritField"].Severity; s != "critical" {
		t.Errorf("CritField severity = %q, want critical", s)
	}

	// The score query must be issued once, be parameterised, target
	// signal_log, carry the window as a string arg and run under a
	// deadline; rows must be closed exactly once to release the pooled
	// connection. The normalization query is the second and last query.
	if q.queryCount != 2 {
		t.Errorf("queryCount = %d, want 2 (score + normalization)", q.queryCount)
	}
	if !strings.Contains(q.gotSQL, "signal_log") {
		t.Errorf("SQL missing signal_log: %q", q.gotSQL)
	}
	if !strings.Contains(q.gotSQL, "$1") {
		t.Errorf("SQL must be parameterised with $1: %q", q.gotSQL)
	}
	for _, fragment := range []string{
		"PARTITION BY base.vehicle_id, base.field",
		"str_value",
		"bool_value",
		"int_value",
		"float_value",
		"time_value",
		"normalization_version >= 1",
		"normalization_version IS NULL",
		"$2::timestamptz",
	} {
		if !strings.Contains(q.gotSQL, fragment) {
			t.Errorf("SQL missing typed-schema fragment %q", fragment)
		}
	}
	for _, obsolete := range []string{"value_float", "value_text"} {
		if strings.Contains(q.gotSQL, obsolete) {
			t.Errorf("SQL contains obsolete signal_log column %q", obsolete)
		}
	}
	if len(q.gotArgs) != 2 || q.gotArgs[0] != snap.WindowStart || q.gotArgs[1] != snap.WindowEnd {
		t.Errorf("args = %v, want [%v %v]", q.gotArgs, snap.WindowStart, snap.WindowEnd)
	}
	// The normalization aggregate must reuse the exact same bounded window
	// so the two result sets describe the same rows.
	if len(q.gotVersionArgs) != 2 ||
		q.gotVersionArgs[0] != snap.WindowStart ||
		q.gotVersionArgs[1] != snap.WindowEnd {
		t.Errorf("normalization args = %v, want [%v %v]",
			q.gotVersionArgs, snap.WindowStart, snap.WindowEnd)
	}
	for _, fragment := range []string{
		"FROM signal_log",
		"ts >= $1::timestamptz",
		"ts <= $2::timestamptz",
		"GROUP BY normalization_version",
	} {
		if !strings.Contains(q.gotVersionSQL, fragment) {
			t.Errorf("normalization SQL missing %q", fragment)
		}
	}
	if q.scoreRowsOpenAtVersionQuery {
		t.Error("score rows must be closed before the normalization query is opened")
	}
	if _, ok := q.gotCtx.Deadline(); !ok {
		t.Error("Query ctx must carry a deadline (context.WithTimeout)")
	}
	if q.rows.closeCount != 1 {
		t.Errorf("rows.Close called %d times, want 1", q.rows.closeCount)
	}
	if q.versionRows.closeCount != 1 {
		t.Errorf("versionRows.Close called %d times, want 1", q.versionRows.closeCount)
	}
}

func TestSnapshot_Empty(t *testing.T) {
	q := &fakeQuerier{rows: &fakeRows{rows: nil}}
	s := NewScorer(q, 15)
	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snap.WindowMins != 15 {
		t.Errorf("WindowMins = %d, want 15", snap.WindowMins)
	}
	if snap.Fields == nil {
		t.Error("Fields should be [] not nil")
	}
	if len(snap.Fields) != 0 {
		t.Errorf("len(Fields) = %d, want 0", len(snap.Fields))
	}
	if snap.Normalization.CoveragePct != nil || snap.Normalization.CoverageState != "unknown" {
		t.Errorf("empty normalization coverage = %v/%q, want nil/unknown",
			snap.Normalization.CoveragePct, snap.Normalization.CoverageState)
	}
	if snap.Normalization.Versions == nil {
		t.Error("Normalization.Versions should be [] not nil")
	}
	if snap.Normalization.TotalSampleCount != 0 ||
		snap.Normalization.VersionedSampleCount != 0 ||
		snap.Normalization.UnversionedSampleCount != 0 {
		t.Errorf("empty window must not fabricate counts: %+v", snap.Normalization)
	}
	if q.rows.closeCount != 1 {
		t.Errorf("rows.Close called %d times, want 1", q.rows.closeCount)
	}
}

// Version 0 is an explicit, below-contract attestation. It must be counted as
// unversioned coverage yet preserved as its own distribution bucket — it is
// NOT the same fact as a NULL (legacy/unknown) row.
func TestSnapshot_NormalizationVersionDistribution(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{field: "VehicleSpeed", count: 400, lastSeen: now.Add(-time.Second)},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: nil, count: 100},
			{version: versionOf(0), count: 100},
			{version: versionOf(1), count: 150},
			{version: versionOf(2), count: 50},
		}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	n := snap.Normalization
	if n.TotalSampleCount != 400 {
		t.Errorf("total = %d, want 400", n.TotalSampleCount)
	}
	if n.VersionedSampleCount != 200 {
		t.Errorf("versioned = %d, want 200 (v1 + v2)", n.VersionedSampleCount)
	}
	if n.UnversionedSampleCount != 200 {
		t.Errorf("unversioned = %d, want 200 (NULL + v0)", n.UnversionedSampleCount)
	}
	if n.VersionedSampleCount+n.UnversionedSampleCount != n.TotalSampleCount {
		t.Errorf("versioned+unversioned must equal total: %+v", n)
	}
	if n.CoveragePct == nil || !almostEqual(*n.CoveragePct, 50) {
		t.Errorf("coverage = %v, want 50", n.CoveragePct)
	}
	if len(n.Versions) != 4 {
		t.Fatalf("versions = %d, want 4", len(n.Versions))
	}
	// NULL and 0 must remain distinguishable buckets.
	if n.Versions[0].Version != nil {
		t.Error("first bucket must be the NULL legacy bucket")
	}
	if n.Versions[1].Version == nil || *n.Versions[1].Version != 0 {
		t.Errorf("second bucket = %v, want explicit 0", n.Versions[1].Version)
	}
	var shareTotal float64
	for _, bucket := range n.Versions {
		if bucket.SharePct == nil {
			t.Fatalf("bucket %+v has nil share despite a non-empty window", bucket)
		}
		shareTotal += *bucket.SharePct
	}
	if !almostEqual(shareTotal, 100) {
		t.Errorf("share percentages sum to %v, want 100", shareTotal)
	}
}

// A window with rows but zero attestation must report a measured 0%, which is
// a different fact from the nil (unknown) an empty window produces.
func TestSnapshot_NormalizationZeroCoverageIsMeasured(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{field: "Gear", count: 10, lastSeen: now, unversioned: 10},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{{version: nil, count: 10}}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snap.Normalization.CoveragePct == nil || *snap.Normalization.CoveragePct != 0 {
		t.Fatalf("coverage = %v, want measured 0", snap.Normalization.CoveragePct)
	}
	if snap.Normalization.CoverageState != "measured" {
		t.Errorf("state = %q, want measured", snap.Normalization.CoverageState)
	}
}

// Per-field coverage is derived from the field aggregate, independently of
// the window-wide distribution. A field with no samples must stay unknown.
func TestSnapshot_PerFieldNormalizationCoverage(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{field: "FullyAttested", count: 40, lastSeen: now, versioned: 40},
			{field: "PartiallyAttested", count: 40, lastSeen: now, versioned: 10, unversioned: 30},
			{field: "NoSamples", count: 0, lastSeen: now},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: versionOf(1), count: 50},
			{version: nil, count: 30},
		}},
	}
	s := NewScorer(q, 60)
	s.now = fixedClock(now)

	snap, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	byField := map[string]FieldScore{}
	for _, f := range snap.Fields {
		byField[f.Field] = f
	}
	full := byField["FullyAttested"]
	if full.VersionedSampleCount != 40 || full.UnversionedSampleCount != 0 {
		t.Errorf("FullyAttested counts = %d/%d, want 40/0",
			full.VersionedSampleCount, full.UnversionedSampleCount)
	}
	if full.NormalizationCoveragePct == nil || !almostEqual(*full.NormalizationCoveragePct, 100) {
		t.Errorf("FullyAttested coverage = %v, want 100", full.NormalizationCoveragePct)
	}
	partial := byField["PartiallyAttested"]
	if partial.NormalizationCoveragePct == nil || !almostEqual(*partial.NormalizationCoveragePct, 25) {
		t.Errorf("PartiallyAttested coverage = %v, want 25", partial.NormalizationCoveragePct)
	}
	if partial.NormalizationCoverageState != "measured" {
		t.Errorf("PartiallyAttested state = %q, want measured", partial.NormalizationCoverageState)
	}
	empty := byField["NoSamples"]
	if empty.NormalizationCoveragePct != nil || empty.NormalizationCoverageState != "unknown" {
		t.Errorf("NoSamples coverage = %v/%q, want nil/unknown",
			empty.NormalizationCoveragePct, empty.NormalizationCoverageState)
	}
}

// The duplicate-detection SQL must compare EVERY typed column against the
// matching value_kind — not just floats and text — and must never re-introduce
// the legacy value_float/value_text columns dropped by migration 000186.
func TestScoreQuery_TypedDuplicateComparisonSemantics(t *testing.T) {
	t.Parallel()
	for _, fragment := range []string{
		"WHEN value_kind <> prev_kind THEN 0",
		"WHEN value_kind = 1 AND str_value IS NOT DISTINCT FROM prev_str THEN 1",
		"WHEN value_kind = 2 AND bool_value IS NOT DISTINCT FROM prev_bool THEN 1",
		"WHEN value_kind IN (3, 4, 7) AND int_value IS NOT DISTINCT FROM prev_int THEN 1",
		"WHEN value_kind IN (5, 6) AND float_value IS NOT DISTINCT FROM prev_float THEN 1",
		"WHEN value_kind = 9 AND time_value IS NOT DISTINCT FROM prev_time THEN 1",
		"LAG(base.value_kind)  OVER signal_stream AS prev_kind",
		"LAG(base.str_value)   OVER signal_stream AS prev_str",
		"LAG(base.bool_value)  OVER signal_stream AS prev_bool",
		"LAG(base.int_value)   OVER signal_stream AS prev_int",
		"LAG(base.float_value) OVER signal_stream AS prev_float",
		"LAG(base.time_value)  OVER signal_stream AS prev_time",
		"LAG(base.ts)          OVER signal_stream AS prev_ts",
		"WINDOW signal_stream AS (PARTITION BY base.vehicle_id, base.field ORDER BY base.ts)",
		"count(*) FILTER (WHERE prev_ts IS NOT NULL) AS comparison_count",
	} {
		if !strings.Contains(scoreQuery, fragment) {
			t.Errorf("scoreQuery missing typed duplicate semantics %q", fragment)
		}
	}
	// A field-only LAG partition would compare consecutive rows across
	// different vehicles and invent duplicates/gaps that never happened.
	if strings.Contains(scoreQuery, "PARTITION BY base.field ORDER BY") ||
		strings.Contains(scoreQuery, "PARTITION BY field ORDER BY") {
		t.Error("scoreQuery must never partition the signal stream by field alone")
	}
	for _, legacy := range []string{"value_float", "value_text"} {
		if strings.Contains(scoreQuery, legacy) {
			t.Errorf("scoreQuery references dropped legacy column %q", legacy)
		}
		if strings.Contains(normalizationVersionQuery, legacy) {
			t.Errorf("normalizationVersionQuery references dropped legacy column %q", legacy)
		}
	}
	// Both aggregates must stay chunk-excludable and parameterised.
	for _, q := range []string{scoreQuery, normalizationVersionQuery} {
		if !strings.Contains(q, "$1::timestamptz") || !strings.Contains(q, "$2::timestamptz") {
			t.Errorf("query is not bounded by parameterised timestamptz literals: %q", q)
		}
	}
}

func TestSnapshotSegmentsQualityByLatestFirmwareContext(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	version := "2026.32.5"
	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			{
				firmware: versionPointer(version), vehicles: 2, field: "VehicleSpeed",
				count: 100, lastSeen: now.Add(-time.Minute), versioned: 90, unversioned: 10,
			},
			{
				firmware: versionPointer(version), vehicles: 2, field: "BatteryLevel",
				count: 50, lastSeen: now.Add(-2 * time.Minute), versioned: 50,
			},
			{
				firmware: nil, vehicles: 1, field: "Gear",
				count: 10, lastSeen: now.Add(-time.Minute), versioned: 5, unversioned: 5,
			},
		}},
	}
	scorer := NewScorer(q, 60)
	scorer.now = fixedClock(now)

	snapshot, err := scorer.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if snapshot.FirmwareAssignment != "latest_version_at_window_end" {
		t.Errorf("firmware assignment = %q", snapshot.FirmwareAssignment)
	}
	if len(snapshot.FirmwareSegments) != 2 {
		t.Fatalf("firmware segment count = %d, want 2", len(snapshot.FirmwareSegments))
	}
	unknown := snapshot.FirmwareSegments[0]
	if unknown.FirmwareVersion != nil || unknown.FirmwareEvidenceState != "unknown" {
		t.Fatalf("unknown segment = %+v", unknown)
	}
	known := snapshot.FirmwareSegments[1]
	if known.FirmwareVersion == nil || *known.FirmwareVersion != version || known.VehicleCount != 2 {
		t.Fatalf("known segment = %+v", known)
	}
	if known.NormalizationCoveragePct == nil ||
		!almostEqual(*known.NormalizationCoveragePct, 140.0/150.0*100) {
		t.Errorf("known segment coverage = %v", known.NormalizationCoveragePct)
	}
	if len(known.Fields) != 2 {
		t.Errorf("known fields = %d, want 2", len(known.Fields))
	}
	if q.queryCount != 2 {
		t.Errorf("queries = %d, want one consolidated score query plus one normalization aggregate", q.queryCount)
	}
	for _, fragment := range []string{
		"window_base AS MATERIALIZED",
		"firmware_context",
		"field = 'Version'",
		"PARTITION BY base.vehicle_id, base.field",
		"normalization_version >= 1",
		"$1::timestamptz",
		"$2::timestamptz",
	} {
		if !strings.Contains(q.gotSQL, fragment) {
			t.Errorf("score query missing %q", fragment)
		}
	}
}

func versionPointer(value string) *string {
	return &value
}

// windowMins <= 0 is a boundary handled in NewScorer; the resulting query
// arg must be the defaulted "60".
func TestSnapshot_WindowArg(t *testing.T) {
	tests := []struct {
		name    string
		window  int
		wantWin int
	}{
		{"zero -> 60", 0, 60},
		{"negative -> 60", -3, 60},
		{"custom kept", 45, 45},
	}
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &fakeQuerier{rows: &fakeRows{}}
			s := NewScorer(q, tt.window)
			s.now = fixedClock(now)
			snap, err := s.Snapshot(context.Background())
			if err != nil {
				t.Fatalf("Snapshot: %v", err)
			}
			if snap.WindowMins != tt.wantWin {
				t.Errorf("WindowMins = %d, want %d", snap.WindowMins, tt.wantWin)
			}
			if len(q.gotArgs) != 2 ||
				q.gotArgs[0] != now.Add(-time.Duration(tt.wantWin)*time.Minute) ||
				q.gotArgs[1] != now {
				t.Errorf("args = %v, want explicit %d-minute UTC window", q.gotArgs, tt.wantWin)
			}
		})
	}
}

// A cancelled parent context still yields a child with a deadline; the
// timeout wrapping must not panic and the fake still receives the ctx.
func TestSnapshot_ContextPropagation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	q := &fakeQuerier{rows: &fakeRows{}}
	s := NewScorer(q, 60)
	if _, err := s.Snapshot(ctx); err != nil {
		t.Fatalf("Snapshot with cancelled parent: %v", err)
	}
	if q.gotCtx == nil {
		t.Fatal("Query never received a context")
	}
	if _, ok := q.gotCtx.Deadline(); !ok {
		t.Error("child ctx must carry a deadline even when parent is cancelled")
	}
}

// ----- linearScore -----------------------------------------------------

func TestLinearScore(t *testing.T) {
	tests := []struct {
		name       string
		x, ok, bad float64
		want       float64
	}{
		{"below ok clamps 100", 30, 60, 600, 100},
		{"at ok is 100", 60, 60, 600, 100},
		{"at bad is 0", 600, 60, 600, 0},
		{"above bad clamps 0", 700, 60, 600, 0},
		{"midpoint is 50", 330, 60, 600, 50},
		{"quarter is 75", 195, 60, 600, 75},
		{"three-quarter is 25", 465, 60, 600, 25},
		{"zero below ok", 0, 60, 600, 100},
		{"gap axis midpoint", 165, 30, 300, 50},
		{"dupe axis at ok", 1, 1, 50, 100},
		{"dupe axis midpoint", 25.5, 1, 50, 50},
		{"dupe axis at bad", 50, 1, 50, 0},
		{"degenerate ok==bad at boundary", 5, 5, 5, 100},
		{"degenerate ok==bad above", 6, 5, 5, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := linearScore(tt.x, tt.ok, tt.bad)
			if !almostEqual(got, tt.want) {
				t.Errorf("linearScore(%v, %v, %v) = %v, want %v", tt.x, tt.ok, tt.bad, got, tt.want)
			}
			if got < 0 || got > 100 {
				t.Errorf("linearScore out of [0,100]: %v", got)
			}
		})
	}
}

// ----- compositeScore --------------------------------------------------

func TestCompositeScore(t *testing.T) {
	tests := []struct {
		name string
		fs   FieldScore
		want float64
	}{
		{
			name: "perfect",
			fs:   FieldScore{FreshnessSeconds: 0, MaxGapSeconds: 0, DuplicateRatio: 0},
			want: 100,
		},
		{
			name: "worst",
			fs:   FieldScore{FreshnessSeconds: 600, MaxGapSeconds: 300, DuplicateRatio: 0.5},
			want: 0,
		},
		{
			name: "stale only",
			fs:   FieldScore{FreshnessSeconds: 600, MaxGapSeconds: 0, DuplicateRatio: 0},
			want: (0 + 100 + 100) / 3.0,
		},
		{
			name: "all mid",
			fs:   FieldScore{FreshnessSeconds: 330, MaxGapSeconds: 165, DuplicateRatio: 0.255},
			want: 50,
		},
		{
			name: "dupes only",
			fs:   FieldScore{FreshnessSeconds: 0, MaxGapSeconds: 0, DuplicateRatio: 0.5},
			want: (100 + 100 + 0) / 3.0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := compositeScore(tt.fs)
			if !almostEqual(got, tt.want) {
				t.Errorf("compositeScore = %v, want %v", got, tt.want)
			}
			if got < 0 || got > 100 {
				t.Errorf("compositeScore out of [0,100]: %v", got)
			}
		})
	}
}

// ----- severity --------------------------------------------------------

func TestSeverity(t *testing.T) {
	tests := []struct {
		name  string
		score float64
		want  string
	}{
		{"perfect ok", 100, "ok"},
		{"boundary 80 ok", 80, "ok"},
		{"just above warn", 80.0001, "ok"},
		{"just below ok", 79.9999, "warn"},
		{"mid warn", 65, "warn"},
		{"boundary 50 warn", 50, "warn"},
		{"just below warn", 49.9999, "critical"},
		{"low critical", 10, "critical"},
		{"zero critical", 0, "critical"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := severity(FieldScore{CompositeScore: tt.score})
			if got != tt.want {
				t.Errorf("severity(%v) = %q, want %q", tt.score, got, tt.want)
			}
		})
	}
}

// severity must be internally consistent with compositeScore for a range
// of synthetic field scores — no gap between the two contracts.
func TestSeverity_ConsistentWithComposite(t *testing.T) {
	for fresh := 0.0; fresh <= 700; fresh += 100 {
		for gap := 0.0; gap <= 350; gap += 50 {
			fs := FieldScore{FreshnessSeconds: fresh, MaxGapSeconds: gap}
			fs.CompositeScore = compositeScore(fs)
			got := severity(fs)
			var want string
			switch {
			case fs.CompositeScore >= 80:
				want = "ok"
			case fs.CompositeScore >= 50:
				want = "warn"
			default:
				want = "critical"
			}
			if got != want {
				t.Errorf("fresh=%v gap=%v composite=%v: severity %q, want %q",
					fresh, gap, fs.CompositeScore, got, want)
			}
		}
	}
}
