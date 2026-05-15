// Phase-50 / 0030 — C5 Vampire-drain explanation.
//
// Unit tests for the retrieve_idle_drain_chunks +
// query_vampire_drain_windows tools. Both tools wrap narrow ports
// (rag.Retriever / VampireDrainSource); tests substitute
// deterministic fakes so the unit tests stay hermetic.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ---------------------------------------------------------------------------
// retrieve_idle_drain_chunks
// ---------------------------------------------------------------------------

// fakeIdleDrainRetriever is a hermetic stand-in for rag.Retriever.
// Records the request and returns either a canned chunk slice or a
// forced error.
type fakeIdleDrainRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeIdleDrainRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
	f.calls = append(f.calls, struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}{subject, query, append([]string{}, sourceTypes...), k})
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

// Forget is a no-op for the test fake — the tools the slice
// registers never call it. Required to satisfy [rag.Retriever].
func (f *fakeIdleDrainRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

// Index is a no-op for the test fake — the tools the slice
// registers never call it. Required to satisfy [rag.Retriever].
func (f *fakeIdleDrainRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveIdleDrainChunks_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	if got := tool.Name(); got != "retrieve_idle_drain_chunks" {
		t.Errorf("Name() = %q, want retrieve_idle_drain_chunks", got)
	}
}

func TestRetrieveIdleDrainChunks_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.Description() == "" {
		t.Errorf("Description() = empty, want a non-empty description")
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "idle_drain", "vehicle_state", "climate_state"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveIdleDrainChunks_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"query", "source_types", "k"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() = %s, want substring %q", string(schema), must)
		}
	}
}

func TestRetrieveIdleDrainChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	rawIn := json.RawMessage(`{"query":"sentry parked overnight","source_types":["user_note"],"k":3}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for unknown source_type")
	}
	if !strings.Contains(err.Error(), "user_note") {
		t.Errorf("Validate err = %v, want mention of unknown source_type", err)
	}
}

func TestRetrieveIdleDrainChunks_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain","idle_drain"],"k":3}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for duplicate source_type")
	}
}

func TestRetrieveIdleDrainChunks_Validate_RejectsEmptyQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	rawIn := json.RawMessage(`{"query":"","source_types":["idle_drain"],"k":3}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for empty query")
	}
}

func TestRetrieveIdleDrainChunks_Validate_AcceptsAllAllowedSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain","vehicle_state","climate_state"],"k":3}`)
	if _, err := tool.Validate(rawIn); err != nil {
		t.Fatalf("Validate err = %v, want nil for full allowlist", err)
	}
}

func TestRetrieveIdleDrainChunks_Validate_RejectsKAboveCap(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain"],"k":99}`)
	_, err := tool.Validate(rawIn)
	if err == nil {
		t.Fatal("Validate err = nil, want error for k > 12")
	}
}

func TestRetrieveIdleDrainChunks_Execute_DefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeIdleDrainRetriever{}
	tool := &retrieveIdleDrainChunks{r: fake}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain"]}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].k != vampireDrainDefaultK {
		t.Errorf("retriever calls = %v, want k=%d default", fake.calls, vampireDrainDefaultK)
	}
}

func TestRetrieveIdleDrainChunks_Execute_DelegatesAndShapes(t *testing.T) {
	t.Parallel()
	fake := &fakeIdleDrainRetriever{
		out: []rag.Chunk{
			{SourceType: "idle_drain", SourceID: "evt-7", ChunkIdx: 0, Text: "Sentry on for 10h overnight, ambient -3°C", Score: 0.91},
			{SourceType: "vehicle_state", SourceID: "vs-12", ChunkIdx: 1, Text: "Vehicle parked 14h, no plug", Score: 0.82},
		},
	}
	tool := &retrieveIdleDrainChunks{r: fake}
	rawIn := json.RawMessage(`{"query":"recent overnight drain","source_types":["idle_drain","vehicle_state"],"k":4}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("Execute returned %T, want map[string]any", out)
	}
	chunks, ok := env["chunks"].([]retrievedIdleDrainChunk)
	if !ok {
		t.Fatalf("chunks = %T, want []retrievedIdleDrainChunk", env["chunks"])
	}
	if len(chunks) != 2 {
		t.Fatalf("chunks len = %d, want 2", len(chunks))
	}
	if chunks[0].SourceType != "idle_drain" || chunks[0].Text == "" {
		t.Errorf("chunks[0] = %+v, want non-empty idle_drain row", chunks[0])
	}
}

func TestRetrieveIdleDrainChunks_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveIdleDrainChunks{r: nil}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain"]}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute err = nil, want error for nil retriever")
	}
}

func TestRetrieveIdleDrainChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("vector store unreachable")
	fake := &fakeIdleDrainRetriever{err: sentinel}
	tool := &retrieveIdleDrainChunks{r: fake}
	rawIn := json.RawMessage(`{"query":"q","source_types":["idle_drain"]}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, sentinel) {
		t.Errorf("Execute err = %v, want chain containing sentinel", err)
	}
}

// ---------------------------------------------------------------------------
// query_vampire_drain_windows
// ---------------------------------------------------------------------------

// fakeVampireDrainSource is a hermetic stand-in for the VampireDrainSource
// port. Records the request and returns canned events / stats or
// forced errors.
type fakeVampireDrainSource struct {
	eventCalls []struct {
		vehicleID   int64
		windowStart time.Time
		limit       int
	}
	statCalls []struct {
		vehicleID    int64
		windowStart  time.Time
		sampleDays   int
		limit        int
	}
	events    []database.VampireDrainEvent
	stats     database.VampireDrainStats
	eventsErr error
	statsErr  error
}

func (f *fakeVampireDrainSource) Events(_ context.Context, vehicleID int64, windowStart time.Time, limit int) ([]database.VampireDrainEvent, error) {
	f.eventCalls = append(f.eventCalls, struct {
		vehicleID   int64
		windowStart time.Time
		limit       int
	}{vehicleID, windowStart, limit})
	if f.eventsErr != nil {
		return nil, f.eventsErr
	}
	return f.events, nil
}

func (f *fakeVampireDrainSource) Stats(_ context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (database.VampireDrainStats, error) {
	f.statCalls = append(f.statCalls, struct {
		vehicleID    int64
		windowStart  time.Time
		sampleDays   int
		limit        int
	}{vehicleID, windowStart, sampleWindowDays, limit})
	if f.statsErr != nil {
		return database.VampireDrainStats{}, f.statsErr
	}
	out := f.stats
	out.SampleWindowDays = sampleWindowDays
	return out, nil
}

func TestQueryVampireDrainWindows_Name(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	if got := tool.Name(); got != "query_vampire_drain_windows" {
		t.Errorf("Name() = %q, want query_vampire_drain_windows", got)
	}
}

func TestQueryVampireDrainWindows_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.Description() == "" {
		t.Errorf("Description() = empty, want a non-empty description")
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "vampire-drain"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestQueryVampireDrainWindows_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	for _, must := range []string{"vehicle_id", "lookback_days", "event_limit"} {
		if !strings.Contains(string(schema), must) {
			t.Errorf("InputSchema() = %s, want substring %q", string(schema), must)
		}
	}
}

func TestQueryVampireDrainWindows_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "lookback_days": 30, "event_limit": 25}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	typed := in.(queryVampireDrainWindowsInput)
	if typed.VehicleID != 42 || typed.LookbackDays != 30 || typed.EventLimit != 25 {
		t.Errorf("typed = %+v, want {42 30 25}", typed)
	}
}

func TestQueryVampireDrainWindows_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Fatal("Validate err = nil, want error for missing vehicle_id")
	}
}

func TestQueryVampireDrainWindows_Validate_RejectsLookbackOverCap(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "lookback_days": 9999}`)
	if _, err := tool.Validate(rawIn); err == nil {
		t.Fatal("Validate err = nil, want error for lookback_days > 365")
	}
}

func TestQueryVampireDrainWindows_Validate_RejectsEventLimitOverCap(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{}
	rawIn := json.RawMessage(`{"vehicle_id": 42, "event_limit": 9999}`)
	if _, err := tool.Validate(rawIn); err == nil {
		t.Fatal("Validate err = nil, want error for event_limit > 200")
	}
}

func TestQueryVampireDrainWindows_Execute_DefaultsLookbackAndLimit(t *testing.T) {
	t.Parallel()
	now := time.Date(2024, 11, 1, 12, 0, 0, 0, time.UTC)
	fake := &fakeVampireDrainSource{}
	tool := &queryVampireDrainWindows{src: fake, now: func() time.Time { return now }}

	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["lookback_days"].(int) != vampireDrainWindowsDefaultLookbackDays {
		t.Errorf("lookback_days = %v, want %d default", env["lookback_days"], vampireDrainWindowsDefaultLookbackDays)
	}
	if env["event_limit"].(int) != vampireDrainWindowsDefaultEventLimit {
		t.Errorf("event_limit = %v, want %d default", env["event_limit"], vampireDrainWindowsDefaultEventLimit)
	}
	wantStart := now.AddDate(0, 0, -vampireDrainWindowsDefaultLookbackDays)
	if len(fake.eventCalls) != 1 || !fake.eventCalls[0].windowStart.Equal(wantStart) {
		t.Errorf("event call windowStart = %v, want %v", fake.eventCalls[0].windowStart, wantStart)
	}
	if len(fake.statCalls) != 1 || fake.statCalls[0].limit != vampireDrainWindowsStatsLimit {
		t.Errorf("stats limit = %v, want %d", fake.statCalls[0].limit, vampireDrainWindowsStatsLimit)
	}
}

func TestQueryVampireDrainWindows_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryVampireDrainWindows{src: nil, now: time.Now}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "no VampireDrainSource") {
		t.Errorf("Execute err = %v, want 'no VampireDrainSource'", err)
	}
}

func TestQueryVampireDrainWindows_Execute_PropagatesEventsError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("signal_log unreachable")
	fake := &fakeVampireDrainSource{eventsErr: sentinel}
	tool := &queryVampireDrainWindows{src: fake, now: time.Now}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, sentinel) {
		t.Errorf("Execute err = %v, want chain containing sentinel", err)
	}
}

func TestQueryVampireDrainWindows_Execute_PropagatesStatsError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("stats query failed")
	fake := &fakeVampireDrainSource{statsErr: sentinel}
	tool := &queryVampireDrainWindows{src: fake, now: time.Now}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 42}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, sentinel) {
		t.Errorf("Execute err = %v, want chain containing sentinel", err)
	}
}

// ---------------------------------------------------------------------------
// buildVampireDrainEnvelope (pure helper)
// ---------------------------------------------------------------------------

func TestBuildVampireDrainEnvelope_HasEnoughDataThreshold(t *testing.T) {
	t.Parallel()
	now := time.Date(2024, 11, 1, 0, 0, 0, 0, time.UTC)
	avg := 1.4
	med := 1.3
	p95 := 3.1
	stats := database.VampireDrainStats{
		EventCount:           5,
		TotalObservedHours:   120,
		AvgDrainPctPerDay:    &avg,
		MedianDrainPctPerDay: &med,
		P95DrainPctPerDay:    &p95,
		SampleWindowDays:     30,
	}
	env := buildVampireDrainEnvelope(42, 30, 50, now.AddDate(0, 0, -30), now, nil, stats)
	if env["has_enough_data"].(bool) != true {
		t.Errorf("has_enough_data = %v, want true (event_count=5 >= 3)", env["has_enough_data"])
	}
}

func TestBuildVampireDrainEnvelope_InsufficientData(t *testing.T) {
	t.Parallel()
	now := time.Date(2024, 11, 1, 0, 0, 0, 0, time.UTC)
	stats := database.VampireDrainStats{
		EventCount:           0,
		TotalObservedHours:   0,
		AvgDrainPctPerDay:    nil,
		MedianDrainPctPerDay: nil,
		P95DrainPctPerDay:    nil,
		SampleWindowDays:     30,
	}
	env := buildVampireDrainEnvelope(42, 30, 50, now.AddDate(0, 0, -30), now, nil, stats)
	if env["has_enough_data"].(bool) != false {
		t.Errorf("has_enough_data = %v, want false (event_count=0)", env["has_enough_data"])
	}
	if env["worst_event"] != nil {
		t.Errorf("worst_event = %v, want nil for empty events", env["worst_event"])
	}
	statsOut := env["stats"].(map[string]any)
	if statsOut["avg_drain_pct_per_day"] != nil {
		t.Errorf("avg_drain_pct_per_day = %v, want nil for nil pointer", statsOut["avg_drain_pct_per_day"])
	}
}

func TestBuildVampireDrainEnvelope_WorstEventIsHighestRate(t *testing.T) {
	t.Parallel()
	now := time.Date(2024, 11, 1, 0, 0, 0, 0, time.UTC)
	events := []database.VampireDrainEvent{
		{StartedAt: now.Add(-10 * time.Hour), EndedAt: now.Add(-2 * time.Hour), DurationHours: 8, StartBatteryPct: 80, EndBatteryPct: 78, DrainPct: 2, DrainPctPerDay: 6.0},
		{StartedAt: now.Add(-30 * time.Hour), EndedAt: now.Add(-20 * time.Hour), DurationHours: 10, StartBatteryPct: 90, EndBatteryPct: 89, DrainPct: 1, DrainPctPerDay: 2.4},
		{StartedAt: now.Add(-50 * time.Hour), EndedAt: now.Add(-40 * time.Hour), DurationHours: 10, StartBatteryPct: 70, EndBatteryPct: 65, DrainPct: 5, DrainPctPerDay: 12.0},
	}
	avg := 6.8
	med := 6.0
	p95 := 11.4
	stats := database.VampireDrainStats{
		EventCount:           3,
		TotalObservedHours:   28,
		AvgDrainPctPerDay:    &avg,
		MedianDrainPctPerDay: &med,
		P95DrainPctPerDay:    &p95,
		SampleWindowDays:     7,
	}
	env := buildVampireDrainEnvelope(42, 7, 50, now.AddDate(0, 0, -7), now, events, stats)
	worst := env["worst_event"].(map[string]any)
	if worst["drain_pct_per_day"].(float64) != 12.0 {
		t.Errorf("worst_event drain_pct_per_day = %v, want 12.0", worst["drain_pct_per_day"])
	}
}

// ---------------------------------------------------------------------------
// Registration + allowlist surface
// ---------------------------------------------------------------------------

func TestRegisterVampireDrainExplanationTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterVampireDrainExplanationTools(r, VampireDrainExplanationSources{
		Retriever: &fakeIdleDrainRetriever{},
		Drains:    &fakeVampireDrainSource{},
	})
	names := r.Names()
	wantSet := map[string]bool{
		"retrieve_idle_drain_chunks":   false,
		"query_vampire_drain_windows":  false,
	}
	for _, n := range names {
		if _, ok := wantSet[n]; ok {
			wantSet[n] = true
		}
	}
	for name, present := range wantSet {
		if !present {
			t.Errorf("Registry missing tool %q after RegisterVampireDrainExplanationTools (got=%v)", name, names)
		}
	}
}

func TestAllowedIdleDrainSourceTypes_IsDefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedIdleDrainSourceTypes()
	first[0] = "MUTATED"
	second := AllowedIdleDrainSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedIdleDrainSourceTypes() leaked mutation: %v", second)
	}
}

func TestAllowedIdleDrainSourceTypes_ContainsAllThree(t *testing.T) {
	t.Parallel()
	got := AllowedIdleDrainSourceTypes()
	want := map[string]bool{"climate_state": false, "idle_drain": false, "vehicle_state": false}
	for _, s := range got {
		if _, ok := want[s]; ok {
			want[s] = true
		}
	}
	for s, present := range want {
		if !present {
			t.Errorf("AllowedIdleDrainSourceTypes() missing %q (got=%v)", s, got)
		}
	}
}
