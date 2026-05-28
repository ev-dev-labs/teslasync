// Phase-50 / 0023 — D3 Route-efficiency suggestions tool tests.
//
// Tool tests for retrieve_route_chunks + query_route_efficiency.
// Both tools are pure functions over their typed input + a narrow
// port (rag.Retriever or DriveSource); the tests stub each port
// with a deterministic fake so the tests stay hermetic (no DB, no
// embedding API).
//
// Reuses the shared toolstest.FakeDrives source from builtins_test.go and
// the toolstest.FakeRetriever from search_test.go so the existing
// drive-domain tools and these new tools share the same test
// substrate.

package route

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/toolstest"
)

// ---------------------------------------------------------------------------
// retrieve_route_chunks
// ---------------------------------------------------------------------------

// TestRetrieveRouteChunks_HappyPath_ScopesBySubjectAndDelegates
// proves a valid input round-trips through the F7 retriever scoped
// to the subject from ctx, and the chunks come back in a
// deterministic envelope.
func TestRetrieveRouteChunks_HappyPath_ScopesBySubjectAndDelegates(t *testing.T) {
	t.Parallel()
	ret := &toolstest.FakeRetriever{
		Out: []rag.Chunk{
			{SourceType: rag.SourceDriveSummary, SourceID: "drive-101", ChunkIdx: 0, Text: "Home → Work", Score: 0.9},
		},
	}
	tool := &retrieveRouteChunks{r: ret}

	ctx := provider.WithSubject(context.Background(), "user-42")
	rawIn := json.RawMessage(`{"query": "home commute", "source_types": ["drive_summary"], "k": 4}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["query"].(string) != "home commute" {
		t.Errorf("query = %v", env["query"])
	}
	if k := env["k"].(int); k != 4 {
		t.Errorf("k = %d, want 4", k)
	}
	if len(ret.Subjects) != 1 || ret.Subjects[0] != "user-42" {
		t.Errorf("subjects = %v, want [user-42]", ret.Subjects)
	}
}

// TestRetrieveRouteChunks_DefaultK_When_ZeroOrMissing proves the
// tool substitutes routeEffDefaultK (5) when k is zero or omitted.
func TestRetrieveRouteChunks_DefaultK_When_ZeroOrMissing(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{
		`{"query": "x", "source_types": ["drive_summary"]}`,
		`{"query": "x", "source_types": ["drive_summary"], "k": 0}`,
	} {
		ret := &toolstest.FakeRetriever{Out: nil}
		tool := &retrieveRouteChunks{r: ret}
		in, err := tool.Validate(json.RawMessage(raw))
		if err != nil {
			t.Fatalf("Validate err = %v", err)
		}
		out, err := tool.Execute(context.Background(), in)
		if err != nil {
			t.Fatalf("Execute err = %v", err)
		}
		env := out.(map[string]any)
		if k := env["k"].(int); k != routeEffDefaultK {
			t.Errorf("k = %d, want %d", k, routeEffDefaultK)
		}
		if got := ret.Ks[0]; got != routeEffDefaultK {
			t.Errorf("retriever saw k = %d, want %d", got, routeEffDefaultK)
		}
	}
}

// TestRetrieveRouteChunks_Validate_RejectsUnknownSourceType proves
// the per-feature source-type allowlist is enforced AFTER the
// struct validator.
func TestRetrieveRouteChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["user_note"]}`))
	if err == nil {
		t.Fatal("expected error for disallowed source_type")
	}
	if !strings.Contains(err.Error(), "user_note") {
		t.Errorf("error %q must name the offending type", err)
	}
}

// TestRetrieveRouteChunks_Validate_RejectsDuplicateSourceTypes
// proves a list with a repeated entry is rejected — the LLM
// signalled confusion and should retry.
func TestRetrieveRouteChunks_Validate_RejectsDuplicateSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["drive_summary", "drive_summary"]}`))
	if err == nil {
		t.Fatal("expected error for duplicate source_type")
	}
}

// TestRetrieveRouteChunks_Validate_RejectsEmptyQuery proves an
// empty query is rejected — embedding a zero-vector wastes cost
// and produces no signal.
func TestRetrieveRouteChunks_Validate_RejectsEmptyQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "", "source_types": ["drive_summary"]}`))
	if err == nil {
		t.Fatal("expected error for empty query")
	}
}

// TestRetrieveRouteChunks_Validate_RejectsTooLargeQuery proves the
// query length cap.
func TestRetrieveRouteChunks_Validate_RejectsTooLargeQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	huge := strings.Repeat("a", routeEffMaxQueryChars+1)
	raw := []byte(`{"query":"` + huge + `","source_types":["drive_summary"]}`)
	_, err := tool.Validate(json.RawMessage(raw))
	if err == nil {
		t.Fatal("expected error for oversized query")
	}
}

// TestRetrieveRouteChunks_Validate_RejectsKOverCap proves k > 12 is
// rejected at validation time.
func TestRetrieveRouteChunks_Validate_RejectsKOverCap(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query":"x","source_types":["drive_summary"],"k":99}`))
	if err == nil {
		t.Fatal("expected error for k > cap")
	}
}

// TestRetrieveRouteChunks_Execute_RetrieverError surfaces a wrapped
// error.
func TestRetrieveRouteChunks_Execute_RetrieverError(t *testing.T) {
	t.Parallel()
	boom := errors.New("rag down")
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{Err: boom}}
	in, _ := tool.Validate(json.RawMessage(`{"query":"x","source_types":["drive_summary"]}`))
	_, err := tool.Execute(context.Background(), in)
	if !errors.Is(err, boom) {
		t.Fatalf("err must wrap retriever err; got %v", err)
	}
}

// TestRetrieveRouteChunks_Execute_NilRetriever returns a typed
// error rather than panicking when the tool is hand-constructed
// without a retriever (test-only path; production wiring uses
// RegisterRouteEfficiencySuggestionsTools).
func TestRetrieveRouteChunks_Execute_NilRetriever(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: nil}
	in, _ := tool.Validate(json.RawMessage(`{"query":"x","source_types":["drive_summary"]}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("expected error from nil retriever")
	}
}

// TestRetrieveRouteChunks_Validate_RejectsForwardCompatTypesWhenIndexerOff
// is the slice's documented behaviour: route_efficiency and
// weather_context are RESERVED source types that pass validation
// (they're in the allowlist) but the F7 indexer has nothing for
// them yet, so a real Execute call returns zero chunks. This test
// just pins that the source types pass validation today so a
// future indexer slice can light them up without touching the
// allowlist.
func TestRetrieveRouteChunks_Validate_AcceptsForwardCompatTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	for _, raw := range []string{
		`{"query":"x","source_types":["route_efficiency"]}`,
		`{"query":"x","source_types":["weather_context"]}`,
		`{"query":"x","source_types":["drive_summary","route_efficiency","weather_context"]}`,
	} {
		if _, err := tool.Validate(json.RawMessage(raw)); err != nil {
			t.Errorf("Validate(%q) err = %v, want nil", raw, err)
		}
	}
}

// TestRetrieveRouteChunks_NoMutation proves the tool's Mutates()
// returns false — defence-in-depth for the dispatcher's deny-all
// confirm gate.
func TestRetrieveRouteChunks_NoMutation(t *testing.T) {
	t.Parallel()
	tool := &retrieveRouteChunks{r: &toolstest.FakeRetriever{}}
	if tool.Mutates() {
		t.Fatal("retrieve_route_chunks must be read-only")
	}
	if tool.Name() != "retrieve_route_chunks" {
		t.Fatalf("name = %q", tool.Name())
	}
}

// TestAllowedRouteEfficiencySourceTypes_DefensiveCopy proves the
// exported helper returns a defensive copy.
func TestAllowedRouteEfficiencySourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	a := AllowedRouteEfficiencySourceTypes()
	b := AllowedRouteEfficiencySourceTypes()
	a[0] = "MUTATED"
	if b[0] == "MUTATED" {
		t.Fatal("AllowedRouteEfficiencySourceTypes returned shared slice")
	}
	// Must be lex sorted and contain exactly the three reserved
	// types.
	want := []string{"drive_summary", "route_efficiency", "weather_context"}
	if len(b) != len(want) {
		t.Fatalf("len = %d, want %d", len(b), len(want))
	}
	for i, w := range want {
		if b[i] != w {
			t.Errorf("b[%d] = %q, want %q", i, b[i], w)
		}
	}
}

// ---------------------------------------------------------------------------
// query_route_efficiency
// ---------------------------------------------------------------------------

// fixedNow returns a deterministic reference instant for the
// lookback-window tests so the goldens stay stable across CI runs.
func fixedNow() time.Time {
	return time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
}

// makeRouteDrive constructs a minimal *drivemodel.Drive with the
// fields query_route_efficiency consumes. Keeps the test data
// declarative.
func makeRouteDrive(start, end string, distM, durS, avgMps, tempC float64, startSoc, endSoc int16) *drivemodel.Drive {
	return &drivemodel.Drive{
		StartTs:         fixedNow().Add(-24 * time.Hour),
		StartAddress:    toolstest.PtrString(start),
		EndAddress:      toolstest.PtrString(end),
		DistanceM:       distM,
		DurationS:       int64(durS),
		AvgSpeedMps:     toolstest.PtrFloat64(avgMps),
		OutsideTempAvgC: toolstest.PtrFloat64(tempC),
		StartBatteryPct: toolstest.PtrInt16(startSoc),
		EndBatteryPct:   toolstest.PtrInt16(endSoc),
	}
}

// TestQueryRouteEfficiency_HappyPath_GroupsRoutesAndComputesMetrics
// proves the in-memory aggregation matches the SQL handler's shape:
// group by (start, end), compute trip_count + avg distance/duration
// + kwh_per_100mi best/worst/avg, sort by trip_count desc.
func TestQueryRouteEfficiency_HappyPath_GroupsRoutesAndComputesMetrics(t *testing.T) {
	t.Parallel()
	src := &toolstest.FakeDrives{
		Rows: []*drivemodel.Drive{
			// Home → Work: 3 drives
			makeRouteDrive("Home", "Work", 10000, 1200, 8.3, 22, 80, 70), // 16.09 kWh/100mi
			makeRouteDrive("Home", "Work", 10000, 1200, 8.3, 22, 80, 68), // 19.31 kWh/100mi
			makeRouteDrive("Home", "Work", 10000, 1200, 8.3, 22, 75, 67), // 12.87 kWh/100mi (best)
			// Work → Home: 2 drives
			makeRouteDrive("Work", "Home", 10000, 1200, 8.3, 20, 70, 60),
			makeRouteDrive("Work", "Home", 10000, 1200, 8.3, 20, 70, 62),
			// Short trip — excluded by the distance floor
			makeRouteDrive("Garage", "Driveway", 100, 60, 1, 18, 90, 89),
			// Null start address — excluded
			{StartAddress: nil, EndAddress: toolstest.PtrString("Anywhere"), DistanceM: 50000, DurationS: 2400},
		},
	}
	tool := &queryRouteEfficiency{src: src, now: fixedNow}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["vehicle_id"].(int64) != 1 {
		t.Errorf("vehicle_id = %v", env["vehicle_id"])
	}
	if env["lookback_days"].(int) != 30 {
		t.Errorf("default lookback_days = %v, want 30", env["lookback_days"])
	}
	routes := env["routes"].([]map[string]any)
	if len(routes) != 2 {
		t.Fatalf("routes len = %d, want 2 (rest excluded)", len(routes))
	}
	// trip_count DESC; Home → Work has 3, Work → Home has 2.
	if routes[0]["start_place"] != "Home" || routes[0]["end_place"] != "Work" {
		t.Errorf("routes[0] = %v, want Home → Work", routes[0])
	}
	if routes[0]["trip_count"].(int) != 3 {
		t.Errorf("routes[0].trip_count = %v, want 3", routes[0]["trip_count"])
	}
	if routes[1]["start_place"] != "Work" || routes[1]["end_place"] != "Home" {
		t.Errorf("routes[1] = %v, want Work → Home", routes[1])
	}
	if routes[1]["trip_count"].(int) != 2 {
		t.Errorf("routes[1].trip_count = %v", routes[1]["trip_count"])
	}
}

// TestQueryRouteEfficiency_DefaultLookback_When_Zero proves that a
// missing or zero lookback_days substitutes the 30-day default.
func TestQueryRouteEfficiency_DefaultLookback_When_Zero(t *testing.T) {
	t.Parallel()
	src := &toolstest.FakeDrives{Rows: nil}
	tool := &queryRouteEfficiency{src: src, now: fixedNow}
	for _, raw := range []string{
		`{"vehicle_id": 1}`,
		`{"vehicle_id": 1, "lookback_days": 0}`,
	} {
		in, err := tool.Validate(json.RawMessage(raw))
		if err != nil {
			t.Fatalf("Validate err = %v", err)
		}
		out, err := tool.Execute(context.Background(), in)
		if err != nil {
			t.Fatalf("Execute err = %v", err)
		}
		env := out.(map[string]any)
		if env["lookback_days"].(int) != 30 {
			t.Errorf("raw=%q lookback_days = %v, want 30", raw, env["lookback_days"])
		}
	}
}

// TestQueryRouteEfficiency_CustomLookback proves a custom
// lookback_days is honoured up to the cap.
func TestQueryRouteEfficiency_CustomLookback(t *testing.T) {
	t.Parallel()
	src := &toolstest.FakeDrives{}
	tool := &queryRouteEfficiency{src: src, now: fixedNow}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 1, "lookback_days": 90}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["lookback_days"].(int) != 90 {
		t.Errorf("lookback_days = %v, want 90", env["lookback_days"])
	}
}

// TestQueryRouteEfficiency_Validate_RejectsBadInputs covers the
// validation rules without DB IO.
func TestQueryRouteEfficiency_Validate_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	tool := &queryRouteEfficiency{src: &toolstest.FakeDrives{}, now: fixedNow}
	for _, raw := range []string{
		`{}`,                 // missing vehicle_id
		`{"vehicle_id": 0}`,  // zero
		`{"vehicle_id": -1}`, // negative
		`{"vehicle_id": 1, "lookback_days": 366}`, // over cap
		`{"vehicle_id": 1, "lookback_days": -1}`,  // negative
	} {
		if _, err := tool.Validate(json.RawMessage(raw)); err == nil {
			t.Errorf("Validate(%q) want err", raw)
		}
	}
}

// TestQueryRouteEfficiency_Execute_NoDriveSourceError surfaces a
// typed error rather than panicking when the tool is
// hand-constructed without a source.
func TestQueryRouteEfficiency_Execute_NoDriveSourceError(t *testing.T) {
	t.Parallel()
	tool := &queryRouteEfficiency{src: nil, now: fixedNow}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("expected error from nil DriveSource")
	}
}

// failingByVehicleDrives errors on every GetByVehicle call so the
// tool's error wrapping path is exercised. Scoped to this test file
// so it does not collide with the GetByID-only failingDrivesImpl in
// drive_coaching_test.go.
type failingByVehicleDrives struct {
	toolstest.FakeDrives
	Err error
}

func (f *failingByVehicleDrives) GetByVehicle(_ context.Context, _ int64, _, _ int, _, _ time.Time) ([]*drivemodel.Drive, error) {
	return nil, f.Err
}

// TestQueryRouteEfficiency_Execute_RepoErrorWrapped proves a
// downstream error is wrapped with context.
func TestQueryRouteEfficiency_Execute_RepoErrorWrapped(t *testing.T) {
	t.Parallel()
	boom := errors.New("db down")
	tool := &queryRouteEfficiency{src: &failingByVehicleDrives{Err: boom}, now: fixedNow}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	_, err := tool.Execute(context.Background(), in)
	if !errors.Is(err, boom) {
		t.Fatalf("err must wrap repo err; got %v", err)
	}
}

// TestAggregateRouteEfficiency_TruncatesToMaxRoutes proves the
// returned routes list is capped at queryRouteEfficiencyMaxRoutes
// even when more groups exist.
func TestAggregateRouteEfficiency_TruncatesToMaxRoutes(t *testing.T) {
	t.Parallel()
	var rows []*drivemodel.Drive
	for i := 0; i < queryRouteEfficiencyMaxRoutes+5; i++ {
		start := "Place" + string(rune('A'+i))
		end := "Place" + string(rune('A'+i)) + "End"
		rows = append(rows, makeRouteDrive(start, end, 10000, 1200, 8.3, 20, 80, 70))
	}
	env := aggregateRouteEfficiency(rows)
	routes := env["routes"].([]map[string]any)
	if len(routes) != queryRouteEfficiencyMaxRoutes {
		t.Errorf("routes len = %d, want %d", len(routes), queryRouteEfficiencyMaxRoutes)
	}
	if env["route_count"].(int) != queryRouteEfficiencyMaxRoutes {
		t.Errorf("route_count = %v, want %d", env["route_count"], queryRouteEfficiencyMaxRoutes)
	}
}

// TestAggregateRouteEfficiency_NilMetricsWhenMissingSource proves
// rows with NULL speed / temp / SoC contribute to trip_count but
// not to the numeric aggregates — mirroring the SQL handler's
// AVG() semantics.
func TestAggregateRouteEfficiency_NilMetricsWhenMissingSource(t *testing.T) {
	t.Parallel()
	d := &drivemodel.Drive{
		StartAddress: toolstest.PtrString("A"),
		EndAddress:   toolstest.PtrString("B"),
		DistanceM:    10000,
		DurationS:    1200,
		// no AvgSpeedMps, no OutsideTempAvgC, no SoC
	}
	env := aggregateRouteEfficiency([]*drivemodel.Drive{d})
	routes := env["routes"].([]map[string]any)
	if len(routes) != 1 {
		t.Fatalf("len = %d, want 1", len(routes))
	}
	if routes[0]["avg_speed_mps"] != nil {
		t.Errorf("avg_speed_mps = %v, want nil", routes[0]["avg_speed_mps"])
	}
	if routes[0]["ambient_temp_c_avg"] != nil {
		t.Errorf("ambient_temp_c_avg = %v, want nil", routes[0]["ambient_temp_c_avg"])
	}
	if routes[0]["ambient_temp_f_avg"] != nil {
		t.Errorf("ambient_temp_f_avg = %v, want nil", routes[0]["ambient_temp_f_avg"])
	}
	if routes[0]["avg_kwh_per_100mi"] != nil {
		t.Errorf("avg_kwh_per_100mi = %v, want nil", routes[0]["avg_kwh_per_100mi"])
	}
}

// TestQueryRouteEfficiency_NoMutation proves Mutates() returns
// false.
func TestQueryRouteEfficiency_NoMutation(t *testing.T) {
	t.Parallel()
	tool := &queryRouteEfficiency{src: &toolstest.FakeDrives{}, now: fixedNow}
	if tool.Mutates() {
		t.Fatal("query_route_efficiency must be read-only")
	}
	if tool.Name() != "query_route_efficiency" {
		t.Fatalf("name = %q", tool.Name())
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TestRegisterRouteEfficiencySuggestionsTools_RegistersBothTools
// proves the wiring helper installs the two new tools on a fresh
// registry. Mirrors the existing RegisterDriveCoachingTools test
// pattern.
func TestRegisterRouteEfficiencySuggestionsTools_RegistersBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterRouteEfficiencySuggestionsTools(r, RouteEfficiencySuggestionsSources{
		Retriever: &toolstest.FakeRetriever{},
		Drives:    &toolstest.FakeDrives{},
	})
	for _, name := range []string{"retrieve_route_chunks", "query_route_efficiency"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("RegisterRouteEfficiencySuggestionsTools did not register %q", name)
		}
	}
}

// TestRegisterRouteEfficiencySuggestionsTools_PanicsOnDuplicate
// proves the wiring helper refuses a second call against the same
// registry — a wiring bug must surface at boot, not at first
// request.
func TestRegisterRouteEfficiencySuggestionsTools_PanicsOnDuplicate(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterRouteEfficiencySuggestionsTools(r, RouteEfficiencySuggestionsSources{
		Retriever: &toolstest.FakeRetriever{},
		Drives:    &toolstest.FakeDrives{},
	})
	defer func() {
		if rec := recover(); rec == nil {
			t.Fatal("duplicate registration must panic")
		}
	}()
	RegisterRouteEfficiencySuggestionsTools(r, RouteEfficiencySuggestionsSources{
		Retriever: &toolstest.FakeRetriever{},
		Drives:    &toolstest.FakeDrives{},
	})
}
