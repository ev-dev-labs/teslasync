// Unit tests for the retrieve_update_notes and query_vehicle_software tools.
// They use deterministic fakes for the RAG retriever and software source, and
// pin the request-scope checks that prevent cross-vehicle exfiltration.

package summary

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// retrieve_update_notes
// ---------------------------------------------------------------------------

// fakeUpdateNotesRetriever is a hermetic stand-in for
// rag.Retriever. Records the request and returns either a
// canned chunk slice or a forced error.
type fakeUpdateNotesRetriever struct {
	calls []struct {
		subject     string
		query       string
		sourceTypes []string
		k           int
	}
	out []rag.Chunk
	err error
}

func (f *fakeUpdateNotesRetriever) Retrieve(_ context.Context, subject, query string, sourceTypes []string, k int) ([]rag.Chunk, error) {
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

func (f *fakeUpdateNotesRetriever) Forget(_ context.Context, _, _, _ string) error { return nil }

func (f *fakeUpdateNotesRetriever) Index(_ context.Context, _, _, _ string, _ []string) error {
	return nil
}

func TestRetrieveUpdateNotes_Name(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	if got := tool.Name(); got != "retrieve_update_notes" {
		t.Errorf("Name() = %q, want retrieve_update_notes", got)
	}
}

func TestRetrieveUpdateNotes_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
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
	for _, must := range []string{"READ-only", "software_update", "docs"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestRetrieveUpdateNotes_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
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

// TestRetrieveUpdateNotes_InputSchemaOmitsVehicleID pins the
// security contract: the LLM cannot ask the retriever for
// another vehicle's chunks because the tool's input shape does
// NOT accept vehicle_id. Per-vehicle separation is handled by
// the retriever's per-subject filter (subjects scoped to
// the calling operator's session). A future edit that widens
// the input would silently expose a prompt-injection
// exfiltration surface; this test surfaces it.
func TestRetrieveUpdateNotes_InputSchemaOmitsVehicleID(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	schema := string(tool.InputSchema())
	if strings.Contains(schema, "vehicle_id") {
		t.Errorf("InputSchema() unexpectedly contains vehicle_id: %s", schema)
	}
}

func TestRetrieveUpdateNotes_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "2024.32.10", "source_types": ["software_update"], "k": 5}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(retrieveUpdateNotesInput)
	if in.Query != "2024.32.10" {
		t.Errorf("Query = %q, want 2024.32.10", in.Query)
	}
	if len(in.SourceTypes) != 1 || in.SourceTypes[0] != softwareUpdateSourceUpdate {
		t.Errorf("SourceTypes = %v, want [%s]", in.SourceTypes, softwareUpdateSourceUpdate)
	}
}

func TestRetrieveUpdateNotes_Validate_AcceptsAllAllowedSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "x", "source_types": ["docs", "software_update"]}`)
	if _, err := tool.Validate(raw); err != nil {
		t.Errorf("Validate() err = %v, want nil for full allowlist", err)
	}
}

func TestRetrieveUpdateNotes_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["user_note"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for disallowed source_type, want error")
	}
}

// TestRetrieveUpdateNotes_Validate_RejectsMaintenanceEvent guards
// against a copy-paste mistake from the predictive-maintenance tools (whose allowlist includes
// maintenance_event) silently widening this feature's surface.
func TestRetrieveUpdateNotes_Validate_RejectsMaintenanceEvent(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["maintenance_event"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for maintenance_event, want error")
	}
}

func TestRetrieveUpdateNotes_Validate_RejectsDuplicateSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "hi", "source_types": ["software_update", "software_update"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for duplicate source_type, want error")
	}
}

func TestRetrieveUpdateNotes_Validate_RejectsEmptySourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	raw := json.RawMessage(`{"query": "hi", "source_types": []}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for empty source_types, want error")
	}
}

func TestRetrieveUpdateNotes_Validate_RejectsLongQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	long := strings.Repeat("x", softwareUpdateChangelogMaxQueryChars+1)
	raw := json.RawMessage(`{"query": "` + long + `", "source_types": ["software_update"]}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap query, want error")
	}
}

func TestRetrieveUpdateNotes_Execute_DelegatesAndDefaultsK(t *testing.T) {
	t.Parallel()
	fake := &fakeUpdateNotesRetriever{
		out: []rag.Chunk{
			{SourceType: softwareUpdateSourceUpdate, SourceID: "ver-2024.32.10", ChunkIdx: 0, Text: "autopilot stack-trace improvements", Score: 0.92},
		},
	}
	tool := &retrieveUpdateNotes{r: fake}
	in := retrieveUpdateNotesInput{
		Query:       "2024.32.10",
		SourceTypes: []string{softwareUpdateSourceUpdate},
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	m := out.(map[string]any)
	if m["k"].(int) != softwareUpdateChangelogDefaultK {
		t.Errorf("k = %v, want %d", m["k"], softwareUpdateChangelogDefaultK)
	}
	chunks := m["chunks"].([]retrievedUpdateNotesChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "ver-2024.32.10" {
		t.Errorf("chunks = %+v, want one ver-2024.32.10 chunk", chunks)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected 1 retrieve call, got %d", len(fake.calls))
	}
	if fake.calls[0].k != softwareUpdateChangelogDefaultK {
		t.Errorf("retriever.k = %d, want %d", fake.calls[0].k, softwareUpdateChangelogDefaultK)
	}
}

func TestRetrieveUpdateNotes_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveUpdateNotes{r: &fakeUpdateNotesRetriever{err: want}}
	in := retrieveUpdateNotesInput{
		Query:       "x",
		SourceTypes: []string{softwareUpdateSourceUpdate},
	}
	if _, err := tool.Execute(context.Background(), in); err == nil || !strings.Contains(err.Error(), "rag boom") {
		t.Errorf("Execute() err = %v, want rag boom", err)
	}
}

func TestRetrieveUpdateNotes_Execute_NoRetrieverWired(t *testing.T) {
	t.Parallel()
	tool := &retrieveUpdateNotes{}
	in := retrieveUpdateNotesInput{Query: "x", SourceTypes: []string{softwareUpdateSourceUpdate}}
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("Execute() with nil retriever returned nil, want error")
	}
}

// ---------------------------------------------------------------------------
// query_vehicle_software
// ---------------------------------------------------------------------------

// fakeVehicleSoftwareSource is a hermetic stand-in for
// VehicleSoftwareSource. Records the request and returns either
// a canned envelope or a forced error.
type fakeVehicleSoftwareSource struct {
	calls []struct {
		vehicleID int64
		limit     int
	}
	envelope *VehicleSoftwareEnvelope
	err      error
}

func (f *fakeVehicleSoftwareSource) VehicleSoftware(_ context.Context, vehicleID int64, limit int) (*VehicleSoftwareEnvelope, error) {
	f.calls = append(f.calls, struct {
		vehicleID int64
		limit     int
	}{vehicleID, limit})
	if f.err != nil {
		return nil, f.err
	}
	return f.envelope, nil
}

func TestQueryVehicleSoftware_Name(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	if got := tool.Name(); got != "query_vehicle_software" {
		t.Errorf("Name() = %q, want query_vehicle_software", got)
	}
}

func TestQueryVehicleSoftware_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
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
	for _, must := range []string{"READ-only", "deterministic", "in-scope"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestQueryVehicleSoftware_InputSchemaNonEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	if !strings.Contains(string(schema), "vehicle_id") {
		t.Errorf("InputSchema() missing vehicle_id: %s", schema)
	}
	if !strings.Contains(string(schema), "limit") {
		t.Errorf("InputSchema() missing limit: %s", schema)
	}
}

func TestQueryVehicleSoftware_Validate_OK(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	raw := json.RawMessage(`{"vehicle_id": 42, "limit": 15}`)
	v, err := tool.Validate(raw)
	if err != nil {
		t.Fatalf("Validate() err = %v, want nil", err)
	}
	in := v.(queryVehicleSoftwareInput)
	if in.VehicleID != 42 || in.Limit != 15 {
		t.Errorf("got = %+v, want vehicle=42 limit=15", in)
	}
}

func TestQueryVehicleSoftware_Validate_RejectsMissingVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	raw := json.RawMessage(`{}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for missing vehicle_id, want error")
	}
}

func TestQueryVehicleSoftware_Validate_RejectsZeroVehicleID(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	raw := json.RawMessage(`{"vehicle_id": 0}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for vehicle_id=0, want error")
	}
}

func TestQueryVehicleSoftware_Validate_RejectsOverCapLimit(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	raw := json.RawMessage(`{"vehicle_id": 42, "limit": 9999}`)
	if _, err := tool.Validate(raw); err == nil {
		t.Fatal("Validate() returned nil error for over-cap limit, want error")
	}
}

func TestQueryVehicleSoftware_Execute_DelegatesAndPropagates(t *testing.T) {
	t.Parallel()
	cadence := 30.0
	src := &fakeVehicleSoftwareSource{
		envelope: &VehicleSoftwareEnvelope{
			VehicleID:          42,
			CurrentVersion:     "2024.32.10",
			TotalUpdates:       3,
			InstallCadenceDays: &cadence,
			RecentUpdates: []SoftwareUpdateEntry{
				{ID: 3, Version: "2024.32.10", Status: "installed", InstalledAt: "2025-01-15T12:00:00Z", CreatedAt: "2025-01-15T12:00:00Z"},
				{ID: 2, Version: "2024.26.5", Status: "installed", InstalledAt: "2024-12-15T12:00:00Z", CreatedAt: "2024-12-15T12:00:00Z"},
			},
		},
	}
	tool := &queryVehicleSoftware{src: src}
	in := queryVehicleSoftwareInput{VehicleID: 42, Limit: 20}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
		Limit:     20,
	})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	got, ok := out.(*VehicleSoftwareEnvelope)
	if !ok {
		t.Fatalf("Execute() = %T, want *VehicleSoftwareEnvelope", out)
	}
	if got.VehicleID != 42 || got.TotalUpdates != 3 || got.CurrentVersion != "2024.32.10" {
		t.Errorf("envelope = %+v, want vehicle=42 total=3 current=2024.32.10", got)
	}
	if len(src.calls) != 1 {
		t.Fatalf("src.calls = %d, want 1", len(src.calls))
	}
	c := src.calls[0]
	if c.vehicleID != 42 || c.limit != 20 {
		t.Errorf("src.calls[0] = %+v, want vehicle=42 limit=20", c)
	}
}

func TestQueryVehicleSoftware_Execute_DefaultsLimit(t *testing.T) {
	t.Parallel()
	src := &fakeVehicleSoftwareSource{envelope: &VehicleSoftwareEnvelope{VehicleID: 42}}
	tool := &queryVehicleSoftware{src: src}
	in := queryVehicleSoftwareInput{VehicleID: 42}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	if src.calls[0].limit != softwareUpdateChangelogDefaultLimit {
		t.Errorf("src.calls[0].limit = %d, want %d", src.calls[0].limit, softwareUpdateChangelogDefaultLimit)
	}
}

func TestQueryVehicleSoftware_Execute_ClampsLimitToScope(t *testing.T) {
	t.Parallel()
	src := &fakeVehicleSoftwareSource{envelope: &VehicleSoftwareEnvelope{VehicleID: 42}}
	tool := &queryVehicleSoftware{src: src}
	in := queryVehicleSoftwareInput{VehicleID: 42, Limit: 50}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
		Limit:     5,
	})
	if _, err := tool.Execute(ctx, in); err != nil {
		t.Fatalf("Execute() err = %v", err)
	}
	if src.calls[0].limit != 5 {
		t.Errorf("src.calls[0].limit = %d, want 5 (clamped to scope.Limit)", src.calls[0].limit)
	}
}

func TestQueryVehicleSoftware_Execute_NoSourceWired(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{}
	in := queryVehicleSoftwareInput{VehicleID: 42}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil source returned nil, want error")
	}
}

func TestQueryVehicleSoftware_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	want := errors.New("source boom")
	tool := &queryVehicleSoftware{src: &fakeVehicleSoftwareSource{err: want}}
	in := queryVehicleSoftwareInput{VehicleID: 42}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil || !strings.Contains(err.Error(), "source boom") {
		t.Errorf("Execute() err = %v, want source boom", err)
	}
}

func TestQueryVehicleSoftware_Execute_NilEnvelopeIsError(t *testing.T) {
	t.Parallel()
	tool := &queryVehicleSoftware{src: &fakeVehicleSoftwareSource{}}
	in := queryVehicleSoftwareInput{VehicleID: 42}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
	})
	if _, err := tool.Execute(ctx, in); err == nil {
		t.Fatal("Execute() with nil envelope returned nil, want error")
	}
}

// TestQueryVehicleSoftware_Execute_RefusesMismatchedScopeVehicle
// pins the security contract: an LLM that proposes a different
// vehicle than the in-scope one (e.g. a prompt-injection attack
// via an operator-authored description / version string) is
// REJECTED at the tool boundary before any source is touched.
// The fake source's calls slice MUST stay empty on a rejected
// call.
func TestQueryVehicleSoftware_Execute_RefusesMismatchedScopeVehicle(t *testing.T) {
	t.Parallel()
	src := &fakeVehicleSoftwareSource{envelope: &VehicleSoftwareEnvelope{VehicleID: 99}}
	tool := &queryVehicleSoftware{src: src}
	in := queryVehicleSoftwareInput{VehicleID: 99}
	ctx := WithScopedSoftwareUpdateChangelogWindow(context.Background(), ScopedSoftwareUpdateChangelogWindow{
		VehicleID: 42,
	})
	_, err := tool.Execute(ctx, in)
	if err == nil {
		t.Fatal("Execute() with mismatched vehicle scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "does not match in-scope vehicle_id") {
		t.Errorf("Execute() err = %v, want a 'does not match' message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite scope mismatch; want 0", len(src.calls))
	}
}

// TestQueryVehicleSoftware_Execute_RefusesMissingScope pins the
// missing-scope contract: if the dispatcher is invoked from an
// unintended path (no scope installed), the tool refuses.
func TestQueryVehicleSoftware_Execute_RefusesMissingScope(t *testing.T) {
	t.Parallel()
	src := &fakeVehicleSoftwareSource{envelope: &VehicleSoftwareEnvelope{}}
	tool := &queryVehicleSoftware{src: src}
	in := queryVehicleSoftwareInput{VehicleID: 42}
	_, err := tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("Execute() with missing scope returned nil, want error")
	}
	if !strings.Contains(err.Error(), "no in-scope software-update-changelog vehicle") {
		t.Errorf("Execute() err = %v, want a missing-scope message", err)
	}
	if len(src.calls) != 0 {
		t.Errorf("source was called %d times despite missing scope; want 0", len(src.calls))
	}
}

// ---------------------------------------------------------------------------
// Registration + helpers
// ---------------------------------------------------------------------------

func TestRegisterSoftwareUpdateChangelogSummarizerTools_AddsBothTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	src := &fakeVehicleSoftwareSource{}
	ret := &fakeUpdateNotesRetriever{}
	RegisterSoftwareUpdateChangelogSummarizerTools(r, SoftwareUpdateChangelogSummarizerSources{
		Retriever:       ret,
		VehicleSoftware: src,
	})
	names := r.Names()
	wantSet := map[string]bool{
		"query_vehicle_software": false,
		"retrieve_update_notes":  false,
	}
	for _, n := range names {
		if _, ok := wantSet[n]; ok {
			wantSet[n] = true
		}
	}
	for k, v := range wantSet {
		if !v {
			t.Errorf("RegisterSoftwareUpdateChangelogSummarizerTools did not register %q (got %v)", k, names)
		}
	}
}

func TestAllowedSoftwareUpdateChangelogSourceTypes_IsDefensiveCopy(t *testing.T) {
	t.Parallel()
	a := AllowedSoftwareUpdateChangelogSourceTypes()
	b := AllowedSoftwareUpdateChangelogSourceTypes()
	if &a[0] == &b[0] {
		t.Error("AllowedSoftwareUpdateChangelogSourceTypes returns the same backing array; should be a copy")
	}
	a[0] = "tampered"
	if AllowedSoftwareUpdateChangelogSourceTypes()[0] == "tampered" {
		t.Error("mutating the returned slice mutates the package-internal allowlist; bug")
	}
}
