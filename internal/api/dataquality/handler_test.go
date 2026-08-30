// Data-quality + lineage handler tests.
//
// Exercises the HTTP layer directly with httptest recorders. The Score
// endpoint is driven through a real dqpkg.Scorer wired to a fake
// dqpkg.Querier/dqpkg.Rows so every branch — 503 (nil handler, nil
// scorer, not-configured pool), 500 (query/scan/rows.Err failures) and
// 200 (populated + empty snapshots) — is covered without a database.
// The Lineage endpoint is exercised against the embedded routing.yaml
// for the happy path and an injected failing builder for the 500 path.

package dataquality

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	dqpkg "github.com/ev-dev-labs/teslasync/internal/dataquality"
)

// ----- fakes -----------------------------------------------------------

var (
	_ dqpkg.Querier = (*fakeQuerier)(nil)
	_ dqpkg.Rows    = (*fakeRows)(nil)
)

// fakeRow mirrors one firmware/field aggregate scanned by Snapshot.
type fakeRow struct {
	field       string
	count       int64
	lastSeen    time.Time
	maxGap      float64
	dupRatio    float64
	versioned   int64
	unversioned int64
}

// fakeRows implements dqpkg.Rows over an in-memory slice.
type fakeRows struct {
	rows    []fakeRow
	idx     int
	scanErr error // returned by Scan when set (before any assignment)
	iterErr error // returned by Err (simulates an iteration failure)
	closed  bool
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
	*firmwarep = nil
	*vehiclesp = 1
	*fieldp, *countp, *seenp, *gapp = row.field, row.count, row.lastSeen, row.maxGap
	*comparisonp = 1000
	*duplicatep = int64(row.dupRatio * float64(*comparisonp))
	*versionedp, *unversionedp = row.versioned, row.unversioned
	return nil
}

func (r *fakeRows) Close()     { r.closed = true }
func (r *fakeRows) Err() error { return r.iterErr }

// fakeVersionRow mirrors one bucket of the bounded
// GROUP BY normalization_version aggregate Snapshot issues second.
type fakeVersionRow struct {
	version *int16
	count   int64
}

// fakeVersionRows implements dqpkg.Rows for the normalization aggregate.
type fakeVersionRows struct {
	rows    []fakeVersionRow
	idx     int
	scanErr error
	iterErr error
	closed  bool
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

func (r *fakeVersionRows) Close()     { r.closed = true }
func (r *fakeVersionRows) Err() error { return r.iterErr }

func versionOf(v int16) *int16 { return &v }

// fakeQuerier implements dqpkg.Querier and records the queries it saw. It
// routes on the SQL text because Snapshot issues two bounded aggregates.
type fakeQuerier struct {
	rows            *fakeRows
	versionRows     *fakeVersionRows
	queryErr        error
	versionQueryErr error
	gotSQL          string
	gotArgs         []any
	gotVersionSQL   string
	gotVersionArgs  []any
}

func (q *fakeQuerier) Query(_ context.Context, sql string, args ...any) (dqpkg.Rows, error) {
	if strings.Contains(sql, "GROUP BY normalization_version") {
		q.gotVersionSQL = sql
		q.gotVersionArgs = args
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
	return q.rows, nil
}

// ----- helpers ---------------------------------------------------------

func scorerWith(q *fakeQuerier, windowMins int) *dqpkg.Scorer {
	return dqpkg.NewScorer(q, windowMins)
}

func doScore(h *Handler) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/observability/data-quality", nil)
	h.Score(rec, req)
	return rec
}

func doLineage(h *Handler) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/observability/lineage", nil)
	h.Lineage(rec, req)
	return rec
}

func decodeErrBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("error body not JSON: %v (raw=%s)", err, rec.Body.String())
	}
	return body
}

// wantSeverity mirrors the documented composite->severity contract so
// the handler response can be validated against it.
func wantSeverity(score float64) string {
	switch {
	case score >= 80:
		return "ok"
	case score >= 50:
		return "warn"
	default:
		return "critical"
	}
}

// ----- NewHandler ------------------------------------------------------

func TestNewHandler(t *testing.T) {
	if got := NewHandler(nil); got == nil {
		t.Fatal("NewHandler(nil) returned nil")
	}
	// The lineage builder must be wired so a handler built via the
	// constructor serves the static graph.
	h := NewHandler(nil)
	if h.buildLineage == nil {
		t.Fatal("NewHandler must wire buildLineage")
	}
	rec := doLineage(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("constructed handler Lineage = %d, want 200", rec.Code)
	}
}

// ----- Score: 503 paths ------------------------------------------------

func TestScore_ServiceUnavailable(t *testing.T) {
	tests := []struct {
		name    string
		handler *Handler
	}{
		{"nil handler", nil},
		{"nil scorer", NewHandler(nil)},
		// Non-nil scorer whose pool is nil => Snapshot returns
		// ErrNotConfigured, hitting the errors.Is branch. Pass an
		// untyped nil so the Querier interface is genuinely nil (a
		// typed-nil pointer would make the interface non-nil).
		{"scorer without pool", NewHandler(dqpkg.NewScorer(nil, 60))},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := doScore(tt.handler)
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503 (body=%s)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["code"] != "SERVICE_UNAVAILABLE" {
				t.Errorf("code = %q, want SERVICE_UNAVAILABLE", body["code"])
			}
			if body["error"] != "SUBSYSTEM_NOT_CONFIGURED" {
				t.Errorf("error = %q, want SUBSYSTEM_NOT_CONFIGURED", body["error"])
			}
		})
	}
}

// scorerWith(nil, 60) builds a real *dqpkg.Scorer with a nil pool.
func TestScore_ScorerWithoutPool_IsErrNotConfiguredBranch(t *testing.T) {
	// Distinct from the "nil scorer" case: here h.scorer != nil, so the
	// handler proceeds to call Snapshot and must translate the domain
	// ErrNotConfigured into 503 rather than 500. The untyped nil keeps
	// the pool interface genuinely nil.
	sc := dqpkg.NewScorer(nil, 30)
	if sc == nil {
		t.Fatal("NewScorer(nil, 30) unexpectedly returned nil")
	}
	rec := doScore(NewHandler(sc))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

// ----- Score: 500 paths ------------------------------------------------

func TestScore_InternalErrors(t *testing.T) {
	tests := []struct {
		name        string
		querier     *fakeQuerier
		wantErrPart string
	}{
		{
			name:        "query failure",
			querier:     &fakeQuerier{queryErr: errors.New("boom-query")},
			wantErrPart: "boom-query",
		},
		{
			name: "scan failure",
			querier: &fakeQuerier{rows: &fakeRows{
				rows:    []fakeRow{{field: "VehicleSpeed", count: 1, lastSeen: time.Now()}},
				scanErr: errors.New("boom-scan"),
			}},
			wantErrPart: "boom-scan",
		},
		{
			name: "rows iteration failure",
			querier: &fakeQuerier{rows: &fakeRows{
				rows:    nil, // Next() false immediately
				iterErr: errors.New("boom-iter"),
			}},
			wantErrPart: "boom-iter",
		},
		{
			name: "normalization version query failure",
			querier: &fakeQuerier{
				rows:            &fakeRows{},
				versionQueryErr: errors.New("boom-version-query"),
			},
			wantErrPart: "boom-version-query",
		},
		{
			name: "normalization version scan failure",
			querier: &fakeQuerier{
				rows: &fakeRows{},
				versionRows: &fakeVersionRows{
					rows:    []fakeVersionRow{{version: versionOf(1), count: 3}},
					scanErr: errors.New("boom-version-scan"),
				},
			},
			wantErrPart: "boom-version-scan",
		},
		{
			name: "normalization version iteration failure",
			querier: &fakeQuerier{
				rows:        &fakeRows{},
				versionRows: &fakeVersionRows{iterErr: errors.New("boom-version-iter")},
			},
			wantErrPart: "boom-version-iter",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(scorerWith(tt.querier, 60))
			rec := doScore(h)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["code"] != "INTERNAL_ERROR" {
				t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
			}
			// The wrapped error message must propagate to the client so
			// operators can see which stage failed.
			if !strings.Contains(body["error"], tt.wantErrPart) {
				t.Errorf("error = %q, want to contain %q", body["error"], tt.wantErrPart)
			}
		})
	}
}

// ----- Score: 200 paths ------------------------------------------------

func TestScore_Success(t *testing.T) {
	now := time.Now()
	past := now.Add(-24 * time.Hour)
	q := &fakeQuerier{
		rows: &fakeRows{rows: []fakeRow{
			// composite ~100 (fresh, no gap, no dupes) => ok
			{field: "FreshField", count: 100, lastSeen: now, maxGap: 0, dupRatio: 0, versioned: 100},
			// composite ~66.7 (stale freshness axis 0, gap 100, dupe 100) => warn
			{field: "WarnField", count: 80, lastSeen: past, maxGap: 0, dupRatio: 0, versioned: 80},
			// composite 50 (freshness 0, gap 50, dupe 100) => warn
			{field: "MidField", count: 40, lastSeen: past, maxGap: 165, dupRatio: 0, versioned: 30, unversioned: 10},
			// composite 0 (freshness 0, gap 0, dupe 0) => critical
			{field: "CritField", count: 20, lastSeen: past, maxGap: 300, dupRatio: 0.5, versioned: 10, unversioned: 10},
		}},
		versionRows: &fakeVersionRows{rows: []fakeVersionRow{
			{version: nil, count: 20},
			{version: versionOf(1), count: 220},
		}},
	}

	h := NewHandler(scorerWith(q, 60))
	rec := doScore(h)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var snap dqpkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("body not a Snapshot: %v (raw=%s)", err, rec.Body.String())
	}

	if snap.WindowMins != 60 {
		t.Errorf("window_mins = %d, want 60", snap.WindowMins)
	}
	if snap.GeneratedAt.IsZero() {
		t.Error("generated_at should be populated")
	}
	if snap.Normalization.CoveragePct == nil || snap.Normalization.CoverageState != "measured" {
		t.Errorf("normalization coverage = %v/%q, want measured",
			snap.Normalization.CoveragePct, snap.Normalization.CoverageState)
	}
	if snap.Normalization.TotalSampleCount != 240 ||
		snap.Normalization.VersionedSampleCount != 220 ||
		snap.Normalization.UnversionedSampleCount != 20 {
		t.Errorf("normalization counts = %+v, want 240/220/20", snap.Normalization)
	}
	if len(snap.Normalization.Versions) != 2 {
		t.Errorf("normalization versions = %d, want 2", len(snap.Normalization.Versions))
	}
	if len(snap.Fields) != 4 {
		t.Fatalf("fields len = %d, want 4", len(snap.Fields))
	}

	// Worst-first ordering: composite scores are non-decreasing.
	for i := 1; i < len(snap.Fields); i++ {
		if snap.Fields[i-1].CompositeScore > snap.Fields[i].CompositeScore {
			t.Errorf("fields not sorted ascending at %d: %v > %v",
				i, snap.Fields[i-1].CompositeScore, snap.Fields[i].CompositeScore)
		}
	}

	first, last := snap.Fields[0], snap.Fields[len(snap.Fields)-1]
	if first.Field != "CritField" {
		t.Errorf("worst field = %q, want CritField", first.Field)
	}
	if first.CompositeScore > 1 {
		t.Errorf("CritField composite = %v, want ~0", first.CompositeScore)
	}
	if last.Field != "FreshField" {
		t.Errorf("best field = %q, want FreshField", last.Field)
	}
	if last.CompositeScore < 99 {
		t.Errorf("FreshField composite = %v, want ~100", last.CompositeScore)
	}

	// Severity must be consistent with the composite bucket, and
	// freshness must be derived from last_seen_at.
	for _, f := range snap.Fields {
		if got, want := f.Severity, wantSeverity(f.CompositeScore); got != want {
			t.Errorf("%s severity = %q, want %q (composite=%v)", f.Field, got, want, f.CompositeScore)
		}
		if f.Field == "FreshField" && f.FreshnessSeconds > 60 {
			t.Errorf("FreshField freshness = %v, want < 60s", f.FreshnessSeconds)
		}
		if f.Field == "CritField" && f.FreshnessSeconds < 3600 {
			t.Errorf("CritField freshness = %v, want >= 1h", f.FreshnessSeconds)
		}
	}

	// The scorer must pass an explicit bounded timestamp window.
	if len(q.gotArgs) != 2 {
		t.Errorf("query args = %v, want explicit start/end timestamps", q.gotArgs)
	}
	if !strings.Contains(q.gotSQL, "signal_log") {
		t.Errorf("query did not reference signal_log: %q", q.gotSQL)
	}
	// Rows must be closed to avoid leaking a pooled connection.
	if !q.rows.closed {
		t.Error("rows.Close was not called")
	}
	if !q.versionRows.closed {
		t.Error("normalization rows.Close was not called")
	}
	if !strings.Contains(q.gotVersionSQL, "GROUP BY normalization_version") {
		t.Errorf("normalization query missing GROUP BY: %q", q.gotVersionSQL)
	}
	if len(q.gotVersionArgs) != 2 {
		t.Errorf("normalization query args = %v, want explicit start/end timestamps", q.gotVersionArgs)
	}
}

func TestScore_EmptySnapshot(t *testing.T) {
	q := &fakeQuerier{rows: &fakeRows{rows: nil}}
	h := NewHandler(scorerWith(q, 15))
	rec := doScore(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var snap dqpkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("body not a Snapshot: %v", err)
	}
	if snap.WindowMins != 15 {
		t.Errorf("window_mins = %d, want 15", snap.WindowMins)
	}
	if snap.Fields == nil {
		t.Error("fields should serialise as [] not null")
	}
	if len(snap.Fields) != 0 {
		t.Errorf("fields len = %d, want 0", len(snap.Fields))
	}
}

// windowMins <= 0 is a boundary: the scorer defaults it to 60.
func TestScore_ZeroWindowDefaultsTo60(t *testing.T) {
	q := &fakeQuerier{rows: &fakeRows{rows: nil}}
	h := NewHandler(scorerWith(q, 0))
	rec := doScore(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var snap dqpkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if snap.WindowMins != 60 {
		t.Errorf("window_mins = %d, want default 60", snap.WindowMins)
	}
	if len(q.gotArgs) != 2 {
		t.Errorf("query args = %v, want explicit start/end timestamps", q.gotArgs)
	}
}

// ----- Lineage ---------------------------------------------------------

func TestLineage_Success(t *testing.T) {
	h := NewHandler(nil) // scorer irrelevant to lineage
	rec := doLineage(h)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	var graph dqpkg.LineageGraph
	if err := json.Unmarshal(rec.Body.Bytes(), &graph); err != nil {
		t.Fatalf("body not a LineageGraph: %v", err)
	}
	if len(graph.Nodes) == 0 {
		t.Fatal("expected lineage nodes from embedded routing.yaml")
	}
	if len(graph.Edges) == 0 {
		t.Fatal("expected lineage edges from embedded routing.yaml")
	}

	// Structural invariants: exactly one router node, at least one node
	// of each pipeline kind, sorted node IDs, and referential integrity
	// of every edge.
	ids := make(map[string]dqpkg.LineageNode, len(graph.Nodes))
	kinds := map[string]bool{}
	for i, n := range graph.Nodes {
		ids[n.ID] = n
		kinds[n.Kind] = true
		if i > 0 && graph.Nodes[i-1].ID > n.ID {
			t.Errorf("nodes not sorted by ID at %d: %q > %q", i, graph.Nodes[i-1].ID, n.ID)
		}
	}
	if _, ok := ids["router"]; !ok {
		t.Error("expected a node with ID \"router\"")
	}
	for _, k := range []string{"source", "router", "writer", "table"} {
		if !kinds[k] {
			t.Errorf("expected at least one node of kind %q", k)
		}
	}
	for _, e := range graph.Edges {
		if _, ok := ids[e.From]; !ok {
			t.Errorf("edge From references unknown node %q", e.From)
		}
		if _, ok := ids[e.To]; !ok {
			t.Errorf("edge To references unknown node %q", e.To)
		}
	}
}

func TestLineage_BuilderError_Returns500(t *testing.T) {
	// Inject a failing builder via the DI seam to cover the 500 branch
	// that the embedded (always-valid) routing.yaml can never trigger.
	h := &Handler{buildLineage: func() (*dqpkg.LineageGraph, error) {
		return nil, errors.New("boom-lineage")
	}}
	rec := doLineage(h)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	body := decodeErrBody(t, rec)
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
	if !strings.Contains(body["error"], "boom-lineage") {
		t.Errorf("error = %q, want to contain boom-lineage", body["error"])
	}
}

// A zero-value Handler (no constructor, nil buildLineage) must still
// serve lineage via the package-level fallback rather than nil-deref.
func TestLineage_ZeroValueHandler_FallsBack(t *testing.T) {
	h := &Handler{}
	rec := doLineage(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var graph dqpkg.LineageGraph
	if err := json.Unmarshal(rec.Body.Bytes(), &graph); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(graph.Nodes) == 0 {
		t.Error("fallback builder produced no nodes")
	}
}
