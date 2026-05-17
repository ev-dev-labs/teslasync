// Phase-50 / 0028 — C3 Charging-curve fingerprint clustering tool tests.
//
// Tool tests for retrieve_charge_curve_chunks +
// query_charge_curve_features. Both tools are pure functions over
// their typed input + a narrow port (rag.Retriever or
// ChargeSource); the tests stub each port with a deterministic
// fake so the tests stay hermetic (no DB, no embedding API).
//
// Reuses fakeCharges from builtins_test.go and fakeRetriever from
// search_test.go so the existing charging-domain tools and these
// new tools share the same test substrate.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ---------------------------------------------------------------------------
// retrieve_charge_curve_chunks
// ---------------------------------------------------------------------------

// TestRetrieveChargeCurveChunks_HappyPath_ScopesBySubjectAndDelegates
// proves a valid input round-trips through the F7 retriever scoped
// to the subject from ctx.
func TestRetrieveChargeCurveChunks_HappyPath_ScopesBySubjectAndDelegates(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{
		out: []rag.Chunk{
			{SourceType: rag.SourceChargeSession, SourceID: "session-7", ChunkIdx: 0, Text: "DC fast 250kW", Score: 0.91},
		},
	}
	tool := &retrieveChargeCurveChunks{r: ret}

	ctx := provider.WithSubject(context.Background(), "user-77")
	rawIn := json.RawMessage(`{"query": "supercharger sessions", "source_types": ["charge_session"], "k": 4}`)
	in, err := tool.Validate(rawIn)
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	if env["query"].(string) != "supercharger sessions" {
		t.Errorf("query = %v", env["query"])
	}
	if k := env["k"].(int); k != 4 {
		t.Errorf("k = %d, want 4", k)
	}
	if len(ret.subjects) != 1 || ret.subjects[0] != "user-77" {
		t.Errorf("subjects = %v, want [user-77]", ret.subjects)
	}
	chunks := env["chunks"].([]retrievedChargeCurveChunk)
	if len(chunks) != 1 || chunks[0].SourceID != "session-7" {
		t.Errorf("chunks = %+v", chunks)
	}
}

// TestRetrieveChargeCurveChunks_DefaultK_When_ZeroOrMissing proves
// the tool substitutes chargeCurveDefaultK when k is zero or omitted.
func TestRetrieveChargeCurveChunks_DefaultK_When_ZeroOrMissing(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{
		`{"query": "x", "source_types": ["charge_session"]}`,
		`{"query": "x", "source_types": ["charge_session"], "k": 0}`,
	} {
		ret := &fakeRetriever{out: nil}
		tool := &retrieveChargeCurveChunks{r: ret}
		in, err := tool.Validate(json.RawMessage(raw))
		if err != nil {
			t.Fatalf("Validate err = %v", err)
		}
		out, err := tool.Execute(context.Background(), in)
		if err != nil {
			t.Fatalf("Execute err = %v", err)
		}
		env := out.(map[string]any)
		if k := env["k"].(int); k != chargeCurveDefaultK {
			t.Errorf("k = %d, want %d", k, chargeCurveDefaultK)
		}
		if got := ret.ks[0]; got != chargeCurveDefaultK {
			t.Errorf("retriever saw k = %d, want %d", got, chargeCurveDefaultK)
		}
	}
}

// TestRetrieveChargeCurveChunks_AcceptsForwardCompatChargeCurveSourceType
// proves the per-feature allowlist accepts the
// forward-compat `charge_curve` source string the slice prompt
// reserves for the future indexer fan-out. The retriever returns
// zero chunks today (no rows indexed); the strategy's goldens
// already cover the zero-matches narration.
func TestRetrieveChargeCurveChunks_AcceptsForwardCompatChargeCurveSourceType(t *testing.T) {
	t.Parallel()
	ret := &fakeRetriever{out: nil}
	tool := &retrieveChargeCurveChunks{r: ret}
	in, err := tool.Validate(json.RawMessage(`{"query": "fingerprint", "source_types": ["charge_curve"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	if _, err := tool.Execute(context.Background(), in); err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	if got := ret.sourceTypes[0]; len(got) != 1 || got[0] != chargeCurveSourceCurve {
		t.Errorf("retriever saw source_types = %v, want [charge_curve]", got)
	}
}

// TestRetrieveChargeCurveChunks_Validate_RejectsUnknownSourceType
// proves the per-feature source-type allowlist refuses corpora the
// slice prompt did not enumerate.
func TestRetrieveChargeCurveChunks_Validate_RejectsUnknownSourceType(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["user_note"]}`))
	if err == nil {
		t.Fatal("expected error for disallowed source_type")
	}
	if !strings.Contains(err.Error(), "user_note") {
		t.Errorf("error %q must name the offending type", err)
	}
}

// TestRetrieveChargeCurveChunks_Validate_RejectsDuplicateSourceTypes
// proves a list with a repeated entry is rejected.
func TestRetrieveChargeCurveChunks_Validate_RejectsDuplicateSourceTypes(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["charge_session", "charge_session"]}`))
	if err == nil {
		t.Fatal("expected error for duplicate source_type")
	}
}

// TestRetrieveChargeCurveChunks_Validate_RejectsEmptyQuery proves
// an empty query is rejected.
func TestRetrieveChargeCurveChunks_Validate_RejectsEmptyQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{}}
	_, err := tool.Validate(json.RawMessage(`{"query": "", "source_types": ["charge_session"]}`))
	if err == nil {
		t.Fatal("expected error for empty query")
	}
}

// TestRetrieveChargeCurveChunks_Validate_RejectsOversizedQuery proves
// the chargeCurveMaxQueryChars cap is enforced.
func TestRetrieveChargeCurveChunks_Validate_RejectsOversizedQuery(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{}}
	big := strings.Repeat("a", chargeCurveMaxQueryChars+1)
	_, err := tool.Validate(json.RawMessage(`{"query": "` + big + `", "source_types": ["charge_session"]}`))
	if err == nil {
		t.Fatal("expected error for oversized query")
	}
	if !strings.Contains(err.Error(), "exceeds cap") {
		t.Errorf("error %q must mention the cap", err)
	}
}

// TestRetrieveChargeCurveChunks_Execute_PropagatesRetrieverError
// proves a retriever failure surfaces with context.
func TestRetrieveChargeCurveChunks_Execute_PropagatesRetrieverError(t *testing.T) {
	t.Parallel()
	want := errors.New("rag boom")
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{err: want}}
	in, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["charge_session"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil || !errors.Is(err, want) {
		t.Fatalf("Execute err = %v, want wrapping %v", err, want)
	}
}

// TestRetrieveChargeCurveChunks_Execute_NilRetrieverReturnsError
// proves the tool refuses to run when constructed with no retriever.
func TestRetrieveChargeCurveChunks_Execute_NilRetrieverReturnsError(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: nil}
	in, err := tool.Validate(json.RawMessage(`{"query": "x", "source_types": ["charge_session"]}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("expected error from nil retriever")
	}
}

// TestRetrieveChargeCurveChunks_Mutates_IsFalse pins the read-only
// posture.
func TestRetrieveChargeCurveChunks_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &retrieveChargeCurveChunks{r: &fakeRetriever{}}
	if tool.Mutates() {
		t.Fatal("retrieve_charge_curve_chunks must NOT mutate")
	}
}

// ---------------------------------------------------------------------------
// query_charge_curve_features
// ---------------------------------------------------------------------------

// fixedNowCC returns a deterministic reference timestamp so the
// envelope's window_start / window_end are stable across runs.
// Distinct name from route_efficiency_test.go's fixedNow to avoid
// declaration collisions in the shared tools package test binary.
func fixedNowCC() time.Time { return time.Date(2024, time.June, 15, 12, 0, 0, 0, time.UTC) }

func ptrCCF64(v float64) *float64 { return &v }

// TestQueryChargeCurveFeatures_PowerTiersMatchFrontend pins the
// physical regime boundaries the SPA's helpers.ts already applies.
// A future drift would silently disagree with the user's view.
func TestQueryChargeCurveFeatures_PowerTiersMatchFrontend(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		w    *float64
		want string
	}{
		{"nil", nil, "unknown"},
		{"zero", ptrCCF64(0), "unknown"},
		{"l1_max_inclusive", ptrCCF64(chargeCurvePowerL1MaxW), "l1_overnight"},
		{"l1_under", ptrCCF64(1500), "l1_overnight"},
		{"l2_just_over_l1", ptrCCF64(chargeCurvePowerL1MaxW + 1), "l2_workplace"},
		{"l2_max_inclusive", ptrCCF64(chargeCurvePowerL2MaxW), "l2_workplace"},
		{"dc_just_over_l2", ptrCCF64(chargeCurvePowerL2MaxW + 1), "dc_fast"},
		{"dc_supercharger", ptrCCF64(150_000), "dc_fast"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyChargingPowerTier(tc.w); got != tc.want {
				t.Errorf("classifyChargingPowerTier(%v) = %q, want %q", tc.w, got, tc.want)
			}
		})
	}
}

// TestQueryChargeCurveFeatures_HappyPath_BucketsByPowerTier proves
// the aggregation buckets sessions deterministically and reports
// per-cluster summaries with stable cluster_id ordering after the
// sort.
func TestQueryChargeCurveFeatures_HappyPath_BucketsByPowerTier(t *testing.T) {
	t.Parallel()
	rows := []*models.ChargingSession{
		// 4 L2 sessions (≈ 7 kW peak) — should dominate.
		newSession(1, 7000, 6500, 24_000, ptrTime(fixedNowCC().Add(2*time.Hour)), 30, "wall_connector"),
		newSession(2, 7100, 6600, 25_000, ptrTime(fixedNowCC().Add(2*time.Hour)), 31, "wall_connector"),
		newSession(3, 6900, 6300, 23_000, ptrTime(fixedNowCC().Add(2*time.Hour)), 29, "wall_connector"),
		newSession(4, 7050, 6450, 24_500, ptrTime(fixedNowCC().Add(2*time.Hour)), 30, "wall_connector"),
		// 2 DC fast sessions (≈ 150 kW peak).
		newSession(5, 150_000, 90_000, 50_000, ptrTime(fixedNowCC().Add(1*time.Hour)), 45, "supercharger"),
		newSession(6, 145_000, 88_000, 48_000, ptrTime(fixedNowCC().Add(1*time.Hour)), 44, "supercharger"),
		// 1 L1 session (1.4 kW peak).
		newSession(7, 1400, 1200, 6_000, ptrTime(fixedNowCC().Add(8*time.Hour)), 50, "outlet"),
	}
	src := &fakeCharges{rows: rows}
	tool := &queryChargeCurveFeatures{src: src, now: fixedNowCC}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	clusters := env["clusters"].([]map[string]any)
	if len(clusters) != 3 {
		t.Fatalf("clusters = %d, want 3", len(clusters))
	}
	// Top cluster must be l2_workplace (4 sessions); then dc_fast (2);
	// then l1_overnight (1).
	if clusters[0]["cluster_id"].(string) != "l2_workplace" {
		t.Errorf("clusters[0] = %v, want l2_workplace", clusters[0]["cluster_id"])
	}
	if clusters[1]["cluster_id"].(string) != "dc_fast" {
		t.Errorf("clusters[1] = %v, want dc_fast", clusters[1]["cluster_id"])
	}
	if clusters[2]["cluster_id"].(string) != "l1_overnight" {
		t.Errorf("clusters[2] = %v, want l1_overnight", clusters[2]["cluster_id"])
	}
	// Top cluster has ≥ 3 sessions ⇒ has_enough_data.
	if !env["has_enough_data"].(bool) {
		t.Error("has_enough_data = false, want true")
	}
	// Top cluster's dominant_charger_type pinned alphabetically
	// breaking ties — all four sessions are wall_connector.
	if clusters[0]["dominant_charger_type"].(string) != "wall_connector" {
		t.Errorf("dominant_charger_type = %v", clusters[0]["dominant_charger_type"])
	}
	// Each cluster must carry a non-empty fingerprint_hash.
	for i, c := range clusters {
		if h := c["fingerprint_hash"].(string); len(h) != 16 {
			t.Errorf("clusters[%d].fingerprint_hash = %q, want 16 hex chars", i, h)
		}
	}
}

// TestQueryChargeCurveFeatures_HasEnoughData_FalseUnderThreshold
// proves the threshold gate fires for very sparse data.
func TestQueryChargeCurveFeatures_HasEnoughData_FalseUnderThreshold(t *testing.T) {
	t.Parallel()
	rows := []*models.ChargingSession{
		newSession(1, 7000, 6500, 24_000, ptrTime(fixedNowCC().Add(2*time.Hour)), 30, "wall_connector"),
		newSession(2, 7100, 6600, 25_000, ptrTime(fixedNowCC().Add(2*time.Hour)), 31, "wall_connector"),
	}
	tool := &queryChargeCurveFeatures{src: &fakeCharges{rows: rows}, now: fixedNowCC}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	out, _ := tool.Execute(context.Background(), in)
	env := out.(map[string]any)
	if env["has_enough_data"].(bool) {
		t.Fatal("has_enough_data = true with 2 sessions, want false")
	}
}

// TestQueryChargeCurveFeatures_NoSessions_ReturnsEmptyClusters
// proves the zero-data path: empty clusters slice, has_enough_data
// = false, no panic.
func TestQueryChargeCurveFeatures_NoSessions_ReturnsEmptyClusters(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveFeatures{src: &fakeCharges{}, now: fixedNowCC}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("Execute err = %v", err)
	}
	env := out.(map[string]any)
	clusters := env["clusters"].([]map[string]any)
	if len(clusters) != 0 {
		t.Fatalf("clusters = %d, want 0", len(clusters))
	}
	if env["cluster_count"].(int) != 0 {
		t.Errorf("cluster_count = %v", env["cluster_count"])
	}
	if env["has_enough_data"].(bool) {
		t.Errorf("has_enough_data = true, want false")
	}
}

// TestQueryChargeCurveFeatures_DefaultLookback_When_Zero proves the
// tool substitutes queryChargeCurveFeaturesLookbackDays when
// lookback_days is zero or omitted.
func TestQueryChargeCurveFeatures_DefaultLookback_When_Zero(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveFeatures{src: &fakeCharges{}, now: fixedNowCC}
	in, _ := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	out, _ := tool.Execute(context.Background(), in)
	env := out.(map[string]any)
	if env["lookback_days"].(int) != queryChargeCurveFeaturesLookbackDays {
		t.Errorf("lookback_days = %v, want %d", env["lookback_days"], queryChargeCurveFeaturesLookbackDays)
	}
}

// TestQueryChargeCurveFeatures_FingerprintHash_StableForSameInputs
// proves that two cluster rows derived from the same per-session
// inputs produce the same hash, AND that perturbing one numeric
// summary changes the hash. The hash is the narrator's
// "did the fingerprint shift" signal.
func TestQueryChargeCurveFeatures_FingerprintHash_StableForSameInputs(t *testing.T) {
	t.Parallel()
	row1 := map[string]any{
		"peak_power_w_avg":    7000.0,
		"avg_power_w_avg":     6500.0,
		"total_energy_wh_avg": 24000.0,
		"duration_min_avg":    180.0,
		"delta_soc_pct_avg":   30.0,
		"ramp_shape":          0.928,
	}
	row2 := map[string]any{
		"peak_power_w_avg":    7000.0,
		"avg_power_w_avg":     6500.0,
		"total_energy_wh_avg": 24000.0,
		"duration_min_avg":    180.0,
		"delta_soc_pct_avg":   30.0,
		"ramp_shape":          0.928,
	}
	row3 := map[string]any{
		"peak_power_w_avg":    7000.0,
		"avg_power_w_avg":     6500.0,
		"total_energy_wh_avg": 24000.0,
		"duration_min_avg":    181.0, // perturb
		"delta_soc_pct_avg":   30.0,
		"ramp_shape":          0.928,
	}
	h1 := chargeCurveFingerprintHash(row1)
	h2 := chargeCurveFingerprintHash(row2)
	h3 := chargeCurveFingerprintHash(row3)
	if h1 != h2 {
		t.Errorf("identical rows hashed differently: %q vs %q", h1, h2)
	}
	if h1 == h3 {
		t.Errorf("perturbed row hashed the same: %q", h1)
	}
}

// TestQueryChargeCurveFeatures_Mutates_IsFalse pins the read-only
// posture.
func TestQueryChargeCurveFeatures_Mutates_IsFalse(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveFeatures{src: &fakeCharges{}, now: fixedNowCC}
	if tool.Mutates() {
		t.Fatal("query_charge_curve_features must NOT mutate")
	}
}

// TestQueryChargeCurveFeatures_NilSource_ReturnsError proves the
// tool refuses to run when constructed with no source.
func TestQueryChargeCurveFeatures_NilSource_ReturnsError(t *testing.T) {
	t.Parallel()
	tool := &queryChargeCurveFeatures{src: nil, now: fixedNowCC}
	in, err := tool.Validate(json.RawMessage(`{"vehicle_id": 1}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	_, err = tool.Execute(context.Background(), in)
	if err == nil {
		t.Fatal("expected error from nil source")
	}
}

// TestRegisterChargingCurveFingerprintClusteringTools_RegistersBoth
// proves the registration helper installs both tools by their
// canonical names.
func TestRegisterChargingCurveFingerprintClusteringTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	RegisterChargingCurveFingerprintClusteringTools(r, ChargingCurveFingerprintClusteringSources{
		Retriever: &fakeRetriever{},
		Charges:   &fakeCharges{},
	})
	for _, name := range []string{
		"retrieve_charge_curve_chunks",
		"query_charge_curve_features",
	} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("tool %q not registered", name)
		}
	}
}

// TestAllowedChargeCurveSourceTypes_DefensiveCopy proves the
// exported helper returns a copy a caller cannot mutate.
func TestAllowedChargeCurveSourceTypes_DefensiveCopy(t *testing.T) {
	t.Parallel()
	first := AllowedChargeCurveSourceTypes()
	first[0] = "MUTATED"
	second := AllowedChargeCurveSourceTypes()
	if second[0] == "MUTATED" {
		t.Fatalf("AllowedChargeCurveSourceTypes leaked mutation: second = %v", second)
	}
}

// --- helpers ---------------------------------------------------------

// newSession is a small helper for constructing test sessions
// inline. EndedAt is required because DurationMinutes() returns nil
// otherwise.
func newSession(id int64, peakW, avgW, energyWh float64, ended *time.Time, deltaSocPct float64, chargerType string) *models.ChargingSession {
	startedAt := fixedNowCC().Add(-1 * time.Hour)
	if ended == nil {
		end := startedAt.Add(2 * time.Hour)
		ended = &end
	}
	return &models.ChargingSession{
		ID:                 id,
		VehicleID:          1,
		StartedAt:          startedAt,
		EndedAt:            ended,
		DeltaSocPct:        ptrCCF64(deltaSocPct),
		PeakPowerW:         ptrCCF64(peakW),
		AvgPowerW:          ptrCCF64(avgW),
		TotalEnergyAddedWh: ptrCCF64(energyWh),
		ChargerType:        ptrString(chargerType),
	}
}
