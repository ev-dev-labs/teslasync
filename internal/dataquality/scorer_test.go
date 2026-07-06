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

// fakeRow mirrors the five columns Scorer.Snapshot scans per field.
type fakeRow struct {
	field    string
	count    int64
	lastSeen time.Time
	maxGap   float64
	dupRatio float64
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
	if len(dest) != 5 {
		return errors.New("fakeRows: unexpected dest count")
	}
	row := r.rows[r.idx]
	r.idx++
	fieldp, ok := dest[0].(*string)
	if !ok {
		return errors.New("fakeRows: dest[0] not *string")
	}
	countp, ok := dest[1].(*int64)
	if !ok {
		return errors.New("fakeRows: dest[1] not *int64")
	}
	seenp, ok := dest[2].(*time.Time)
	if !ok {
		return errors.New("fakeRows: dest[2] not *time.Time")
	}
	gapp, ok := dest[3].(*float64)
	if !ok {
		return errors.New("fakeRows: dest[3] not *float64")
	}
	dupp, ok := dest[4].(*float64)
	if !ok {
		return errors.New("fakeRows: dest[4] not *float64")
	}
	*fieldp, *countp, *seenp, *gapp, *dupp = row.field, row.count, row.lastSeen, row.maxGap, row.dupRatio
	return nil
}

func (r *fakeRows) Close()     { r.closeCount++ }
func (r *fakeRows) Err() error { return r.iterErr }

// fakeQuerier implements Querier and records what it saw.
type fakeQuerier struct {
	rows       *fakeRows
	queryErr   error
	gotSQL     string
	gotArgs    []any
	gotCtx     context.Context
	queryCount int
}

func (q *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	q.queryCount++
	q.gotCtx = ctx
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

	q := &fakeQuerier{rows: &fakeRows{rows: []fakeRow{
		// perfect: fresh, no gap, no dupes -> composite ~100 -> ok
		{field: "FreshField", count: 100, lastSeen: fresh, maxGap: 0, dupRatio: 0},
		// stale only: freshness 0, gap 100, dupe 100 -> ~66.7 -> warn
		{field: "WarnField", count: 80, lastSeen: stale, maxGap: 0, dupRatio: 0},
		// worst: stale, huge gap, half dupes -> composite 0 -> critical
		{field: "CritField", count: 20, lastSeen: stale, maxGap: 600, dupRatio: 0.5},
	}}}

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

	// The query must be issued once, be parameterised, target signal_log,
	// carry the window as a string arg and run under a deadline; rows must
	// be closed exactly once to release the pooled connection.
	if q.queryCount != 1 {
		t.Errorf("queryCount = %d, want 1", q.queryCount)
	}
	if !strings.Contains(q.gotSQL, "signal_log") {
		t.Errorf("SQL missing signal_log: %q", q.gotSQL)
	}
	if !strings.Contains(q.gotSQL, "$1") {
		t.Errorf("SQL must be parameterised with $1: %q", q.gotSQL)
	}
	if len(q.gotArgs) != 1 || q.gotArgs[0] != "60" {
		t.Errorf("args = %v, want [\"60\"]", q.gotArgs)
	}
	if _, ok := q.gotCtx.Deadline(); !ok {
		t.Error("Query ctx must carry a deadline (context.WithTimeout)")
	}
	if q.rows.closeCount != 1 {
		t.Errorf("rows.Close called %d times, want 1", q.rows.closeCount)
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
	if q.rows.closeCount != 1 {
		t.Errorf("rows.Close called %d times, want 1", q.rows.closeCount)
	}
}

// windowMins <= 0 is a boundary handled in NewScorer; the resulting query
// arg must be the defaulted "60".
func TestSnapshot_WindowArg(t *testing.T) {
	tests := []struct {
		name    string
		window  int
		wantArg string
		wantWin int
	}{
		{"zero -> 60", 0, "60", 60},
		{"negative -> 60", -3, "60", 60},
		{"custom kept", 45, "45", 45},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := &fakeQuerier{rows: &fakeRows{}}
			s := NewScorer(q, tt.window)
			snap, err := s.Snapshot(context.Background())
			if err != nil {
				t.Fatalf("Snapshot: %v", err)
			}
			if snap.WindowMins != tt.wantWin {
				t.Errorf("WindowMins = %d, want %d", snap.WindowMins, tt.wantWin)
			}
			if len(q.gotArgs) != 1 || q.gotArgs[0] != tt.wantArg {
				t.Errorf("args = %v, want [%q]", q.gotArgs, tt.wantArg)
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
