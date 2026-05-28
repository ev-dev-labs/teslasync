// Phase-50 / 0028 — C3 Charging-curve fingerprint clustering.
//
// charge_curve_clustering.go ships TWO new read-only tools:
//
//   - `retrieve_charge_curve_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject, restricted
//     to the slice's per-feature source-type allowlist
//     {charge_curve, charge_session}. Only `charge_session`
//     (rag.SourceChargeSession) is wired into the F7 indexer today
//     (slice 0008); `charge_curve` is reserved by string for
//     forward-compatibility — the gated `ai_charge_curve_indexer`
//     job (registered as JobNames=["ai_charge_curve_indexer"] in
//     the registry) will fan-out into that corpus once a future
//     slice wires the per-curve fingerprint embeddings. Until then,
//     retrieve_charge_curve_chunks called with
//     source_types=["charge_curve"] returns zero chunks — which is
//     the correct behaviour: the retriever simply has nothing
//     indexed yet, and the strategy's goldens already cover the
//     zero-matches narration.
//
//   - `query_charge_curve_features` — a typed read tool that returns
//     a deterministic SI-canonical envelope of per-cluster features
//     for ONE vehicle. The envelope mirrors the deterministic
//     bucketing the SPA's helpers.ts already applies (peak power
//     tier → L1/L2/DC) but adds the per-cluster numeric summary the
//     LLM needs to narrate (session count, peak/avg power averages,
//     total energy averaged per session, ramp shape ratio, dominant
//     charger_type, example session IDs). Computed in-memory from
//     ChargeSource.GetByVehicle — no new SQL is written by this
//     tool. The aggregation does NOT change the bucketing the user
//     already sees on /charging-curve; it just summarises each
//     bucket so the narrator has structured numbers to quote.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool. The actual rendering of the
// charging curves to the user happens in the SPA via the existing
// /charging-curve baseline UI (ChargingCurvePage) which keeps
// rendering SummaryStatsGrid, SessionCurveChart,
// SessionComparisonChart, ChargerTypeChart, SpeedTrendChart and
// TimeToChargeSection; the AI surface is an opt-in narrator panel
// rendered above (ADR-015 §I3).
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_charge_curve_chunks
//     delegates to the F7 rag.Retriever (the single canonical
//     retrieval entry point); query_charge_curve_features delegates
//     to a narrow ChargeSource read interface satisfied at boot by
//     an adapter wrapping the existing *database.ChargingRepo
//     (no new SQL).
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     cluster-aggregation math is pure Go on a *chargingmodel.ChargingSession
//     slice.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; aggregation is a pure read.
//
//   - Privacy: charging-location identifiers (start_place names,
//     lat/long, addresses) are NOT in the
//     PolicyChargingCurveFingerprintClustering allow-list — the F8
//     redact decorator therefore converts each into a round-trip
//     tag (e.g. `<addr id='1'/>`) before the LLM call; the LLM
//     never sees the cleartext, the user sees their real start_place
//     in the final SSE frame.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to search e.g. "user_note" cannot accidentally
// expose a corpus the slice did not enumerate.

package tools

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
)

// chargeCurveSourceCurve is the source-type string reserved by the
// slice prompt for the future per-curve-fingerprint corpus. It is
// intentionally NOT exported as a rag.Source* constant because
// adding to that package widens the global F7 contract beyond this
// slice's mandate. When the future ai_charge_curve_indexer slice
// lands, it should promote this string to rag.SourceChargeCurve in
// one place.
const chargeCurveSourceCurve = "charge_curve"

// chargeCurveAllowedSourceTypes is the per-feature allowlist of
// source-type strings the charging-curve-fingerprint-clustering
// strategy may retrieve over. Any other source type passed via the
// LLM's typed input is refused at validation time — the slice prompt
// explicitly enumerates these two corpora and a future slice that
// adds a new source must add it here AND extend the strategy's
// system prompt + goldens, not silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var chargeCurveAllowedSourceTypes = []string{
	chargeCurveSourceCurve,
	rag.SourceChargeSession,
}

// chargeCurveAllowedSourceTypeSet is the O(1) membership lookup for
// the allowlist above.
var chargeCurveAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(chargeCurveAllowedSourceTypes))
	for _, s := range chargeCurveAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// chargeCurveAllowedSourceTypesHint is the comma-separated
// allowlist rendered in retrieve_charge_curve_chunks's Description.
var chargeCurveAllowedSourceTypesHint = strings.Join(chargeCurveAllowedSourceTypes, ", ")

// chargeCurveMaxK is the per-call upper bound on the retriever's k
// parameter.
const chargeCurveMaxK = 12

// chargeCurveDefaultK is the value substituted when the LLM omits k.
const chargeCurveDefaultK = 5

// chargeCurveMaxQueryChars caps the user-supplied natural-language
// query at the tool boundary.
const chargeCurveMaxQueryChars = 1024

// ---------------------------------------------------------------------------
// retrieve_charge_curve_chunks
// ---------------------------------------------------------------------------

// retrieveChargeCurveChunksInput is the typed input shape for
// retrieve_charge_curve_chunks. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so a
// malformed input fails before any rag.Retriever method runs.
type retrieveChargeCurveChunksInput struct {
	// Query is the natural-language search expression. Required,
	// non-empty, bounded.
	Query string `json:"query" validate:"required" desc:"Natural-language charging-curve query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in chargeCurveAllowedSourceTypes; an
	// unknown source type is refused at validation time.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: charge_curve, charge_session."`

	// K is the requested top-k count. Optional; defaults to
	// chargeCurveDefaultK when zero. Bounded to [0, chargeCurveMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedChargeCurveChunk is the shared envelope for one chunk in
// the retrieve_charge_curve_chunks output. Mirrors rag.Chunk but
// uses explicit JSON tags so the tool's output marshals stably
// regardless of any future change to the underlying rag.Chunk shape.
type retrievedChargeCurveChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveChargeCurveChunks is the read-only tool that calls the F7
// retriever for the charging-curve domain. It is the FIRST tool the
// LLM is expected to call (per the strategy's system prompt) before
// query_charge_curve_features, so the cluster narration is grounded
// in retrieved context rather than the model's priors.
type retrieveChargeCurveChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveChargeCurveChunks) Name() string { return "retrieve_charge_curve_chunks" }

// Description implements [Tool].
func (t *retrieveChargeCurveChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"charging-curve history via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + chargeCurveAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a charging session to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveChargeCurveChunks) InputSchema() json.RawMessage {
	return cachedSchema(retrieveChargeCurveChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *retrieveChargeCurveChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *retrieveChargeCurveChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *retrieveChargeCurveChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveChargeCurveChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[retrieveChargeCurveChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveChargeCurveChunksInput)
	if err := assertAllowedChargeCurveSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > chargeCurveMaxQueryChars {
		return nil, fmt.Errorf("retrieve_charge_curve_chunks: query length %d exceeds cap %d",
			len(in.Query), chargeCurveMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool].
func (t *retrieveChargeCurveChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveChargeCurveChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_charge_curve_chunks: no rag.Retriever wired")
	}
	k := input.K
	if k == 0 {
		k = chargeCurveDefaultK
	}
	subject := provider.SubjectFromContext(ctx)
	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_charge_curve_chunks: rag.Retrieve: %w", err)
	}
	out := make([]retrievedChargeCurveChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedChargeCurveChunk{
			SourceType: c.SourceType,
			SourceID:   c.SourceID,
			ChunkIdx:   c.ChunkIdx,
			Text:       c.Text,
			Score:      c.Score,
		})
	}
	return map[string]any{
		"query":        input.Query,
		"source_types": input.SourceTypes,
		"k":            k,
		"chunks":       out,
	}, nil
}

// ---------------------------------------------------------------------------
// query_charge_curve_features
// ---------------------------------------------------------------------------

// queryChargeCurveFeaturesLookbackDays is the default lookback
// window for the in-memory cluster aggregation when the LLM omits
// an explicit date range. Mirrors the SPA charging-curve view
// default (90 days — long enough to surface multiple distinct
// charging contexts).
const queryChargeCurveFeaturesLookbackDays = 90

// queryChargeCurveFeaturesMaxClusters caps the number of cluster
// summaries returned. Three buckets (L1/L2/DC) plus an "uncategorised"
// fallback is the natural ceiling — anything more is a wiring bug.
const queryChargeCurveFeaturesMaxClusters = 6

// queryChargeCurveFeaturesFetchLimit caps how many sessions we pull
// from the repo before grouping. Generous (500) for a 90-day window;
// the underlying ChargeSource paginates so we never load the whole
// table.
const queryChargeCurveFeaturesFetchLimit = 500

// queryChargeCurveFeaturesMaxExampleIDs caps the per-cluster
// example_session_ids slice so the envelope stays bounded even for
// very prolific charging users.
const queryChargeCurveFeaturesMaxExampleIDs = 5

// queryChargeCurveFeaturesMinSessionsForData is the threshold below
// which has_enough_data is reported as false. Two sessions can fit
// in any cluster by chance; three is the smallest count that lets
// the narrator reason about a "habit".
const queryChargeCurveFeaturesMinSessionsForData = 3

// Power-tier thresholds — pinned to the same physical regime
// boundaries the SPA's helpers.ts already applies when classifying
// a session into L1/L2/DC. A unit test
// (TestQueryChargeCurveFeatures_PowerTiersMatchFrontend) pins these
// constants so a future drift between backend and frontend would
// fail CI.
//
//   - L1 charging:  ≤ 1.92 kW (120V × 16A US) — overnight wall outlet.
//   - L2 charging:  > 1.92 kW and ≤ 19.2 kW (240V × 80A US).
//   - DC fast:      > 19.2 kW (Tesla destination → Supercharger v3).
//
// Sessions with no peak_power_w or with peak_power_w == 0 fall into
// the "unknown" bucket so the narrator can call them out plainly
// rather than guess.
const (
	chargeCurvePowerL1MaxW = 1920.0
	chargeCurvePowerL2MaxW = 19200.0
)

// queryChargeCurveFeaturesInput is the typed input shape.
type queryChargeCurveFeaturesInput struct {
	// VehicleID identifies the vehicle to summarise. Required +
	// positive — the AI handler ALWAYS scopes to a vehicle the
	// caller has access to via the existing typed auth path.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// LookbackDays restricts the aggregation window to the past
	// N days from `now`. Optional; defaults to 90 (mirrors the
	// SPA default) when zero. Bounded to [0, 365].
	LookbackDays int `json:"lookback_days,omitempty" validate:"gte=0,lte=365" desc:"Lookback window in days (0..365); 0 ⇒ default 90 days."`
}

// chargeCurveClusterAgg accumulates per-cluster metrics during the
// in-memory group-by. Mirrors the SPA's deterministic per-tier
// classification; never recomputes the bucketing.
type chargeCurveClusterAgg struct {
	clusterID         string // canonical: l1_overnight | l2_workplace | dc_fast | unknown
	sessionCount      int
	peakPowerWSum     float64
	peakPowerWN       int
	avgPowerWSum      float64
	avgPowerWN        int
	totalEnergyWhSum  float64
	totalEnergyWhN    int
	durationMinSum    float64
	durationMinN      int
	deltaSocPctSum    float64
	deltaSocPctN      int
	chargerTypeCounts map[string]int
	exampleIDs        []int64
}

// queryChargeCurveFeatures is the read-only tool that returns the
// deterministic per-cluster fingerprint envelope.
type queryChargeCurveFeatures struct {
	src ChargeSource
	// now returns the reference timestamp for the lookback
	// window. Injectable so tests can pin a deterministic
	// reference instant. Defaults to time.Now in
	// RegisterChargingCurveFingerprintClusteringTools.
	now func() time.Time
}

// Name implements [Tool].
func (t *queryChargeCurveFeatures) Name() string { return "query_charge_curve_features" }

// Description implements [Tool].
func (t *queryChargeCurveFeatures) Description() string {
	return "Return the SI-canonical deterministic charging-curve cluster envelope for ONE vehicle " +
		"over an optional lookback window. Mirrors the L1/L2/DC tier classification the user " +
		"already sees on the Charging Curves page; reports per-cluster session_count, " +
		"peak_power_w_avg, avg_power_w_avg, total_energy_wh_avg, ramp_shape (avg/peak ratio), " +
		"dominant_charger_type, and up to 5 example session IDs. READ-only — no record is " +
		"created, mutated, or deleted. Call this AFTER retrieve_charge_curve_chunks; the " +
		"per-cluster metrics are the ground truth for any narration you produce."
}

// InputSchema implements [Tool].
func (t *queryChargeCurveFeatures) InputSchema() json.RawMessage {
	return cachedSchema(queryChargeCurveFeaturesInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryChargeCurveFeatures) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryChargeCurveFeatures) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryChargeCurveFeatures) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryChargeCurveFeatures) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryChargeCurveFeaturesInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// aggregation; no SQL is written by this method.
func (t *queryChargeCurveFeatures) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryChargeCurveFeaturesInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_charge_curve_features: no ChargeSource wired")
	}
	lookback := input.LookbackDays
	if lookback == 0 {
		lookback = queryChargeCurveFeaturesLookbackDays
	}
	now := t.now().UTC()
	startTime := now.AddDate(0, 0, -lookback)
	endTime := now

	sessions, err := t.src.GetByVehicle(ctx, input.VehicleID, queryChargeCurveFeaturesFetchLimit, 0, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("query_charge_curve_features: load sessions vehicle %d: %w", input.VehicleID, err)
	}
	envelope := aggregateChargeCurveFeatures(sessions)
	envelope["vehicle_id"] = input.VehicleID
	envelope["lookback_days"] = lookback
	envelope["window_start"] = startTime.Format("2006-01-02T15:04:05Z07:00")
	envelope["window_end"] = endTime.Format("2006-01-02T15:04:05Z07:00")
	return envelope, nil
}

// classifyChargingPowerTier maps a session's peak power (in watts)
// to the canonical cluster bucket. Mirrors the deterministic
// classification the SPA already applies in helpers.ts. Pinned by
// TestQueryChargeCurveFeatures_PowerTiersMatchFrontend.
//
//   - "unknown" — no peak power recorded.
//   - "l1_overnight" — ≤ 1.92 kW (typical 120V outlet).
//   - "l2_workplace" — > 1.92 kW and ≤ 19.2 kW (240V wall connector).
//   - "dc_fast" — > 19.2 kW (Supercharger / DC fast).
//
// Returning the canonical string label (not an opaque index) keeps
// the LLM's narration grounded in human-readable cluster IDs.
func classifyChargingPowerTier(peakW *float64) string {
	if peakW == nil || *peakW <= 0 {
		return "unknown"
	}
	switch {
	case *peakW <= chargeCurvePowerL1MaxW:
		return "l1_overnight"
	case *peakW <= chargeCurvePowerL2MaxW:
		return "l2_workplace"
	default:
		return "dc_fast"
	}
}

// chargeCurveClusterIDs is the deterministic ordering used in the
// envelope output so a golden's expected payload pins to a stable
// cluster sequence regardless of map iteration order.
var chargeCurveClusterIDs = []string{
	"l1_overnight",
	"l2_workplace",
	"dc_fast",
	"unknown",
}

// aggregateChargeCurveFeatures is a pure helper: given a slice of
// *chargingmodel.ChargingSession rows, compute the deterministic
// per-cluster envelope. Extracted so the unit tests can call it
// directly without spinning up a fake ChargeSource and so Execute
// stays focused on IO + error wrapping.
//
// The aggregation:
//
//   - Groups sessions by classifyChargingPowerTier(peak_power_w).
//   - Reports per-cluster session_count, peak_power_w_avg,
//     avg_power_w_avg, total_energy_wh_avg, duration_min_avg,
//     delta_soc_pct_avg, dominant_charger_type, ramp_shape (avg/peak),
//     fingerprint_hash (sha256 over the rounded summary numbers,
//     first 8 hex chars; used by the narrator to detect that two
//     calls observed the same data without quoting raw counts).
//   - Skips clusters with zero sessions.
//   - Sorts clusters by sessionCount DESC; tie-break on the
//     canonical cluster_id ordering above.
//   - Truncates to queryChargeCurveFeaturesMaxClusters.
//   - Reports has_enough_data=true only if the dominant cluster
//     has ≥ queryChargeCurveFeaturesMinSessionsForData sessions.
func aggregateChargeCurveFeatures(sessions []*chargingmodel.ChargingSession) map[string]any {
	aggs := map[string]*chargeCurveClusterAgg{}
	for _, s := range sessions {
		if s == nil {
			continue
		}
		cluster := classifyChargingPowerTier(s.PeakPowerW)
		a, ok := aggs[cluster]
		if !ok {
			a = &chargeCurveClusterAgg{
				clusterID:         cluster,
				chargerTypeCounts: map[string]int{},
			}
			aggs[cluster] = a
		}
		a.sessionCount++
		if s.PeakPowerW != nil {
			a.peakPowerWSum += *s.PeakPowerW
			a.peakPowerWN++
		}
		if s.AvgPowerW != nil {
			a.avgPowerWSum += *s.AvgPowerW
			a.avgPowerWN++
		}
		if s.TotalEnergyAddedWh != nil {
			a.totalEnergyWhSum += *s.TotalEnergyAddedWh
			a.totalEnergyWhN++
		}
		if dur := s.DurationMinutes(); dur != nil {
			a.durationMinSum += *dur
			a.durationMinN++
		}
		if s.DeltaSocPct != nil {
			a.deltaSocPctSum += *s.DeltaSocPct
			a.deltaSocPctN++
		}
		ct := "unspecified"
		if s.ChargerType != nil && *s.ChargerType != "" {
			ct = *s.ChargerType
		}
		a.chargerTypeCounts[ct]++
		if len(a.exampleIDs) < queryChargeCurveFeaturesMaxExampleIDs {
			a.exampleIDs = append(a.exampleIDs, s.ID)
		}
	}

	clusters := make([]map[string]any, 0, len(aggs))
	for _, id := range chargeCurveClusterIDs {
		a, ok := aggs[id]
		if !ok {
			continue
		}
		row := map[string]any{
			"cluster_id":    a.clusterID,
			"session_count": a.sessionCount,
		}
		if a.peakPowerWN > 0 {
			row["peak_power_w_avg"] = roundChargeCurve(a.peakPowerWSum/float64(a.peakPowerWN), 2)
		} else {
			row["peak_power_w_avg"] = nil
		}
		if a.avgPowerWN > 0 {
			row["avg_power_w_avg"] = roundChargeCurve(a.avgPowerWSum/float64(a.avgPowerWN), 2)
		} else {
			row["avg_power_w_avg"] = nil
		}
		if a.totalEnergyWhN > 0 {
			row["total_energy_wh_avg"] = roundChargeCurve(a.totalEnergyWhSum/float64(a.totalEnergyWhN), 2)
		} else {
			row["total_energy_wh_avg"] = nil
		}
		if a.durationMinN > 0 {
			row["duration_min_avg"] = roundChargeCurve(a.durationMinSum/float64(a.durationMinN), 2)
		} else {
			row["duration_min_avg"] = nil
		}
		if a.deltaSocPctN > 0 {
			row["delta_soc_pct_avg"] = roundChargeCurve(a.deltaSocPctSum/float64(a.deltaSocPctN), 2)
		} else {
			row["delta_soc_pct_avg"] = nil
		}
		// ramp_shape = avg_power / peak_power. A ratio close to 1
		// means the curve held near its peak (typical L1 / L2);
		// a ratio close to 0.5 means the DC taper kicked in early.
		if a.avgPowerWN > 0 && a.peakPowerWN > 0 {
			peak := a.peakPowerWSum / float64(a.peakPowerWN)
			avg := a.avgPowerWSum / float64(a.avgPowerWN)
			if peak > 0 {
				row["ramp_shape"] = roundChargeCurve(avg/peak, 4)
			} else {
				row["ramp_shape"] = nil
			}
		} else {
			row["ramp_shape"] = nil
		}
		row["dominant_charger_type"] = dominantString(a.chargerTypeCounts)
		row["example_session_ids"] = append([]int64{}, a.exampleIDs...)
		row["fingerprint_hash"] = chargeCurveFingerprintHash(row)
		clusters = append(clusters, row)
	}

	sort.SliceStable(clusters, func(i, j int) bool {
		ci := clusters[i]["session_count"].(int)
		cj := clusters[j]["session_count"].(int)
		if ci != cj {
			return ci > cj
		}
		return chargeCurveClusterIndex(clusters[i]["cluster_id"].(string)) <
			chargeCurveClusterIndex(clusters[j]["cluster_id"].(string))
	})
	if len(clusters) > queryChargeCurveFeaturesMaxClusters {
		clusters = clusters[:queryChargeCurveFeaturesMaxClusters]
	}

	hasEnough := false
	if len(clusters) > 0 {
		if top, ok := clusters[0]["session_count"].(int); ok &&
			top >= queryChargeCurveFeaturesMinSessionsForData {
			hasEnough = true
		}
	}

	return map[string]any{
		"clusters":        clusters,
		"cluster_count":   len(clusters),
		"has_enough_data": hasEnough,
	}
}

// chargeCurveClusterIndex is the canonical sort tie-break: returns
// the index of clusterID in chargeCurveClusterIDs, or len(...) for
// an unknown ID (sorts last but still deterministic).
func chargeCurveClusterIndex(clusterID string) int {
	for i, id := range chargeCurveClusterIDs {
		if id == clusterID {
			return i
		}
	}
	return len(chargeCurveClusterIDs)
}

// dominantString returns the key with the highest count. Tie-break
// alphabetically so the envelope is deterministic for goldens. If
// the map is empty, returns "unspecified".
func dominantString(counts map[string]int) string {
	if len(counts) == 0 {
		return "unspecified"
	}
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	best := keys[0]
	bestN := counts[best]
	for _, k := range keys[1:] {
		if counts[k] > bestN {
			best = k
			bestN = counts[k]
		}
	}
	return best
}

// chargeCurveFingerprintHash returns the first 16 hex chars of a
// SHA-256 over the rounded numeric features in row. Used by the
// narrator to detect that two calls observed the same data — the
// LLM SHOULD NOT quote raw numeric ramp_shape values back to the
// user, but a stable per-cluster hash lets it say "the same
// fingerprint as last week" deterministically.
//
// Implementation note: only the rounded numeric fields contribute;
// session_count and example_session_ids do not, because the
// fingerprint should be stable across "I added one more session of
// the same shape" deltas.
func chargeCurveFingerprintHash(row map[string]any) string {
	keys := []string{
		"peak_power_w_avg",
		"avg_power_w_avg",
		"total_energy_wh_avg",
		"duration_min_avg",
		"delta_soc_pct_avg",
		"ramp_shape",
	}
	h := sha256.New()
	for _, k := range keys {
		var bits uint64
		switch v := row[k].(type) {
		case float64:
			bits = math.Float64bits(v)
		default:
			bits = math.Float64bits(math.NaN())
		}
		var b [8]byte
		binary.LittleEndian.PutUint64(b[:], bits)
		_, _ = h.Write(b[:])
	}
	sum := h.Sum(nil)
	const hex = "0123456789abcdef"
	out := make([]byte, 16)
	for i := 0; i < 8; i++ {
		out[i*2] = hex[sum[i]>>4]
		out[i*2+1] = hex[sum[i]&0x0f]
	}
	return string(out)
}

// roundChargeCurve rounds v to n decimal places. Defensive against
// +/-Inf and NaN.
func roundChargeCurve(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// ChargingCurveFingerprintClusteringSources bundles the narrow read
// interfaces RegisterChargingCurveFingerprintClusteringTools needs.
//
// Production wiring (router.go) reuses the same rag.Retriever +
// *database.ChargingRepo instances the rest of the AI surface is
// built around; tests substitute deterministic fakes per-source.
type ChargingCurveFingerprintClusteringSources struct {
	Retriever rag.Retriever
	Charges   ChargeSource
}

// RegisterChargingCurveFingerprintClusteringTools installs the
// charging-curve-fingerprint-clustering slice's tools on r. Called
// from router.go AFTER RegisterRouteEfficiencySuggestionsTools so
// the registry's alphabetical Names list continues to grow
// deterministically.
//
// Panics on duplicate registration (Registry.Register panics).
func RegisterChargingCurveFingerprintClusteringTools(r *Registry, s ChargingCurveFingerprintClusteringSources) {
	r.Register(&retrieveChargeCurveChunks{r: s.Retriever})
	r.Register(&queryChargeCurveFeatures{src: s.Charges, now: time.Now})
}

// assertAllowedChargeCurveSourceTypes enforces the per-feature
// source-type allowlist.
func assertAllowedChargeCurveSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_charge_curve_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := chargeCurveAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_charge_curve_chunks: source_type %q not in allowed set %s",
				st, chargeCurveAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_charge_curve_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedChargeCurveSourceTypes returns a defensive copy of the
// per-feature source-type allowlist. Exported so the AI handler +
// tests can reference the same set the tools enforce.
func AllowedChargeCurveSourceTypes() []string {
	out := make([]string, len(chargeCurveAllowedSourceTypes))
	copy(out, chargeCurveAllowedSourceTypes)
	sort.Strings(out)
	return out
}
