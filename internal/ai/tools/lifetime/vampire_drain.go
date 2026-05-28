// Phase-50 / 0030 — C5 Vampire-drain explanation.
//
// vampire_drain_explanation.go ships TWO new read-only tools:
//
//   - `retrieve_idle_drain_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject, restricted
//     to the slice's per-feature source-type allowlist
//     {idle_drain, vehicle_state, climate_state}. NONE of the three
//     is wired into the F7 indexer today (slice 0008 only indexes
//     drive_summary + charge_session); they are reserved by string
//     for forward-compatibility — the gated `ai_idle_drain_indexer`
//     job (registered as JobNames=["ai_idle_drain_indexer"] in the
//     registry) will fan out into the idle-drain corpus once a
//     future slice wires the per-event embeddings. Until then,
//     retrieve_idle_drain_chunks called with any of the allowed
//     source types returns zero chunks — which is the correct
//     behaviour: the retriever simply has nothing indexed yet, and
//     the strategy's goldens already cover the zero-matches
//     narration.
//
//   - `query_vampire_drain_windows` — a typed read tool that
//     returns the SAME deterministic envelope the canonical baseline
//     GET /vampire-drain + GET /vampire-drain/stats handlers serve.
//     Composes the existing *drivedb.VampireDrainRepo Events +
//     Stats methods through a narrow [VampireDrainSource] port; NO
//     new SQL is written by this tool. The aggregation
//     (event_count, total_observed_hours, avg / median / p95
//     drain_pct_per_day, sample_window_days, plus the recent
//     events list with their per-event drain math) is identical to
//     what the chart on /vampire-drain renders.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool. The actual rendering of the
// vampire-drain summary to the user happens in the SPA via the
// existing /vampire-drain baseline UI (VampireDrainPage) which keeps
// rendering the summary cards, drain-rate trend chart, daily-drain
// bar chart, drain-sessions table, and tips panel; the AI surface
// is an opt-in narrator panel rendered above (ADR-015 §I3).
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_idle_drain_chunks
//     delegates to the F7 rag.Retriever (the single canonical
//     retrieval entry point); query_vampire_drain_windows delegates
//     to a narrow VampireDrainSource read interface satisfied at
//     boot by an adapter wrapping the existing
//     *drivedb.VampireDrainRepo (no new SQL).
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     The envelope-building math is pure Go on the typed
//     VampireDrainEvent / VampireDrainStats structs the repo
//     already returns.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; both tools are pure reads.
//
//   - Privacy: vampire-drain windows do NOT carry start_place /
//     lat/long / address strings (the deterministic envelope only
//     reports timestamps + battery percentages + ambient temp —
//     NOT a location). Even so, the per-feature redaction policy
//     PolicyVampireDrainExplanation only allows ClassVehicleName;
//     anything else (including any future per-event location field)
//     would be tagged round-trip before reaching the LLM.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to search e.g. "user_note" cannot accidentally
// expose a corpus the slice did not enumerate.

package lifetime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// vampireDrainSourceIdleDrain / vampireDrainSourceVehicleState /
// vampireDrainSourceClimateState are the source-type strings reserved
// by the slice prompt for the future per-event embedding corpora.
// They are intentionally NOT exported as rag.Source* constants
// because adding to that package widens the global F7 contract beyond
// this slice's mandate. When the future ai_idle_drain_indexer slice
// lands, it should promote these strings to rag.SourceIdleDrain /
// rag.SourceVehicleState / rag.SourceClimateState in one place.
const (
	vampireDrainSourceIdleDrain    = "idle_drain"
	vampireDrainSourceVehicleState = "vehicle_state"
	vampireDrainSourceClimateState = "climate_state"
)

// vampireDrainAllowedSourceTypes is the per-feature allowlist of
// source-type strings the vampire-drain-explanation strategy may
// retrieve over. Any other source type passed via the LLM's typed
// input is refused at validation time — the slice prompt explicitly
// enumerates these three corpora and a future slice that adds a new
// source must add it here AND extend the strategy's system prompt +
// goldens, not silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var vampireDrainAllowedSourceTypes = []string{
	vampireDrainSourceClimateState,
	vampireDrainSourceIdleDrain,
	vampireDrainSourceVehicleState,
}

// vampireDrainAllowedSourceTypeSet is the O(1) membership lookup for
// the allowlist above.
var vampireDrainAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(vampireDrainAllowedSourceTypes))
	for _, s := range vampireDrainAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// vampireDrainAllowedSourceTypesHint is the comma-separated allowlist
// rendered in retrieve_idle_drain_chunks's Description.
var vampireDrainAllowedSourceTypesHint = strings.Join(vampireDrainAllowedSourceTypes, ", ")

// vampireDrainMaxK is the per-call upper bound on the retriever's k
// parameter.
const vampireDrainMaxK = 12

// vampireDrainDefaultK is the value substituted when the LLM omits k.
const vampireDrainDefaultK = 5

// vampireDrainMaxQueryChars caps the user-supplied natural-language
// query at the tool boundary.
const vampireDrainMaxQueryChars = 1024

// ---------------------------------------------------------------------------
// retrieve_idle_drain_chunks
// ---------------------------------------------------------------------------

// retrieveIdleDrainChunksInput is the typed input shape for
// retrieve_idle_drain_chunks. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so a
// malformed input fails before any rag.Retriever method runs.
type retrieveIdleDrainChunksInput struct {
	// Query is the natural-language search expression. Required,
	// non-empty, bounded.
	Query string `json:"query" validate:"required" desc:"Natural-language idle-drain query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in vampireDrainAllowedSourceTypes; an
	// unknown source type is refused at validation time.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: climate_state, idle_drain, vehicle_state."`

	// K is the requested top-k count. Optional; defaults to
	// vampireDrainDefaultK when zero. Bounded to [0, vampireDrainMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedIdleDrainChunk is the shared envelope for one chunk in the
// retrieve_idle_drain_chunks output. Mirrors rag.Chunk but uses
// explicit JSON tags so the tool's output marshals stably regardless
// of any future change to the underlying rag.Chunk shape.
type retrievedIdleDrainChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveIdleDrainChunks is the read-only tool that calls the F7
// retriever for the vampire-drain domain. It is the OPTIONAL
// secondary tool the LLM may call (per the strategy's system prompt)
// after query_vampire_drain_windows, so the narration is grounded
// FIRST in the deterministic envelope and only OPTIONALLY enriched
// with retrieved per-event context.
type retrieveIdleDrainChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveIdleDrainChunks) Name() string { return "retrieve_idle_drain_chunks" }

// Description implements [Tool].
func (t *retrieveIdleDrainChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"idle-drain / vehicle-state / climate-state history via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + vampireDrainAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate an idle-drain event to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveIdleDrainChunks) InputSchema() json.RawMessage {
	return tools.CachedSchema(retrieveIdleDrainChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *retrieveIdleDrainChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *retrieveIdleDrainChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *retrieveIdleDrainChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveIdleDrainChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[retrieveIdleDrainChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveIdleDrainChunksInput)
	if err := assertAllowedIdleDrainSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > vampireDrainMaxQueryChars {
		return nil, fmt.Errorf("retrieve_idle_drain_chunks: query length %d exceeds cap %d",
			len(in.Query), vampireDrainMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool].
func (t *retrieveIdleDrainChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveIdleDrainChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_idle_drain_chunks: no rag.Retriever wired")
	}
	k := input.K
	if k == 0 {
		k = vampireDrainDefaultK
	}
	subject := provider.SubjectFromContext(ctx)
	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_idle_drain_chunks: rag.Retrieve: %w", err)
	}
	out := make([]retrievedIdleDrainChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedIdleDrainChunk{
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
// query_vampire_drain_windows
// ---------------------------------------------------------------------------

// vampireDrainWindowsDefaultLookbackDays mirrors the canonical
// /vampire-drain handler's default window. A 90-day window catches
// seasonal drain patterns (cold-weather ambient temperature drives
// elevated vampire drain) without dragging in stale history.
const vampireDrainWindowsDefaultLookbackDays = 90

// vampireDrainWindowsMaxLookbackDays caps the lookback at one year.
// Beyond a year, the deterministic chart already truncates and the
// narration stops being meaningful.
const vampireDrainWindowsMaxLookbackDays = 365

// vampireDrainWindowsDefaultEventLimit caps the number of events
// the tool returns inline in the envelope. Mirrors the canonical
// /vampire-drain endpoint's default page size: enough events for the
// LLM to recognise "the worst recent window" without bloating the
// prompt.
const vampireDrainWindowsDefaultEventLimit = 50

// vampireDrainWindowsMaxEventLimit caps the inline event list.
const vampireDrainWindowsMaxEventLimit = 200

// vampireDrainWindowsStatsLimit is the bounded page size used when
// the tool computes the rollup stats. Mirrors the canonical
// /vampire-drain/stats handler's behaviour: take a generous slice
// (up to 1000 events) so percentile_cont's median / p95 are not
// truncated when the user has many windows in 90 days.
const vampireDrainWindowsStatsLimit = 1000

// VampireDrainSource is the narrow port the
// query_vampire_drain_windows tool delegates to. In production it is
// satisfied by *api.AIVampireDrainSource (which composes
// *drivedb.VampireDrainRepo); in tests we substitute deterministic
// fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the read-only contract that ADR-015 §I3 + the
// slice prompt mandate.
type VampireDrainSource interface {
	// Events returns drain events for vehicleID since
	// windowStart, capped at limit rows (ordered started_at
	// DESC). Mirrors *drivedb.VampireDrainRepo.Events.
	Events(ctx context.Context, vehicleID int64, windowStart time.Time, limit int) ([]drivedb.VampireDrainEvent, error)

	// Stats returns the aggregate rollup for vehicleID over the
	// same windowStart cut-off. sampleWindowDays is echoed back
	// in the rollup's SampleWindowDays field. Mirrors
	// *drivedb.VampireDrainRepo.Stats.
	Stats(ctx context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (drivedb.VampireDrainStats, error)
}

// queryVampireDrainWindowsInput is the typed input shape.
type queryVampireDrainWindowsInput struct {
	// VehicleID identifies the vehicle to summarise. Required +
	// positive — the AI handler ALWAYS scopes to a vehicle the
	// caller has access to via the existing typed auth path.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// LookbackDays restricts the aggregation window to the past
	// N days from `now`. Optional; defaults to 90 (mirrors the
	// canonical /vampire-drain default) when zero. Bounded to
	// [0, 365].
	LookbackDays int `json:"lookback_days,omitempty" validate:"gte=0,lte=365" desc:"Lookback window in days (0..365); 0 ⇒ default 90 days."`

	// EventLimit caps the number of events returned inline in
	// the envelope. Optional; defaults to 50 when zero.
	// Bounded to [0, 200].
	EventLimit int `json:"event_limit,omitempty" validate:"gte=0,lte=200" desc:"Inline events cap (0..200); 0 ⇒ default 50."`
}

// queryVampireDrainWindows is the read-only tool that returns the
// deterministic vampire-drain envelope.
type queryVampireDrainWindows struct {
	src VampireDrainSource
	// now returns the reference timestamp for the lookback
	// window. Injectable so tests can pin a deterministic
	// reference instant. Defaults to time.Now in
	// RegisterVampireDrainExplanationTools.
	now func() time.Time
}

// Name implements [Tool].
func (t *queryVampireDrainWindows) Name() string { return "query_vampire_drain_windows" }

// Description implements [Tool].
func (t *queryVampireDrainWindows) Description() string {
	return "Return the SAME deterministic vampire-drain envelope the canonical baseline " +
		"GET /vampire-drain + GET /vampire-drain/stats handlers serve for ONE vehicle. " +
		"Reports event_count, total_observed_hours, avg / median / p95 drain_pct_per_day, " +
		"sample_window_days, and the recent events list (timestamps, duration_hours, " +
		"start/end battery_pct, drain_pct, drain_pct_per_day, ambient_temp_c_avg). " +
		"READ-only — no record is created, mutated, or deleted. Call this FIRST; the " +
		"envelope is the ground truth for any narration you produce — DO NOT recompute " +
		"or contradict the figures."
}

// InputSchema implements [Tool].
func (t *queryVampireDrainWindows) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryVampireDrainWindowsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryVampireDrainWindows) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryVampireDrainWindows) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryVampireDrainWindows) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryVampireDrainWindows) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryVampireDrainWindowsInput](raw)
}

// Execute implements [Tool]. Two repo round-trips (Events + Stats)
// then envelope marshalling; no SQL is written by this method.
func (t *queryVampireDrainWindows) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryVampireDrainWindowsInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_vampire_drain_windows: no VampireDrainSource wired")
	}
	lookback := input.LookbackDays
	if lookback == 0 {
		lookback = vampireDrainWindowsDefaultLookbackDays
	}
	if lookback > vampireDrainWindowsMaxLookbackDays {
		// Validator already caps at 365; defence in depth.
		lookback = vampireDrainWindowsMaxLookbackDays
	}
	limit := input.EventLimit
	if limit == 0 {
		limit = vampireDrainWindowsDefaultEventLimit
	}
	if limit > vampireDrainWindowsMaxEventLimit {
		// Validator already caps at 200; defence in depth.
		limit = vampireDrainWindowsMaxEventLimit
	}

	now := t.now().UTC()
	windowStart := now.AddDate(0, 0, -lookback)

	events, err := t.src.Events(ctx, input.VehicleID, windowStart, limit)
	if err != nil {
		return nil, fmt.Errorf("query_vampire_drain_windows: load events vehicle %d: %w", input.VehicleID, err)
	}
	stats, err := t.src.Stats(ctx, input.VehicleID, windowStart, lookback, vampireDrainWindowsStatsLimit)
	if err != nil {
		return nil, fmt.Errorf("query_vampire_drain_windows: load stats vehicle %d: %w", input.VehicleID, err)
	}

	return buildVampireDrainEnvelope(input.VehicleID, lookback, limit, windowStart, now, events, stats), nil
}

// buildVampireDrainEnvelope is a pure helper: given the inputs and
// the typed events / stats from the repo, build the deterministic
// envelope the LLM narrates. Extracted so the unit tests can call
// it directly without spinning up a fake VampireDrainSource.
//
// The envelope:
//
//   - Echoes vehicle_id, lookback_days, event_limit, window_start /
//     window_end so the narration can quote the exact cut-off.
//   - Reports the rollup stats (event_count, total_observed_hours,
//     avg / median / p95 drain_pct_per_day, sample_window_days)
//     directly from the repo's VampireDrainStats — null pointer
//     fields stay null so the narrator can distinguish "no data"
//     from "actual zero drain".
//   - Reports the recent events inline (capped at event_limit) for
//     per-event narration ("the worst recent window was X% over Y
//     hours at Z°C").
//   - Includes a worst_event handle (the single highest
//     drain_pct_per_day in the inline list) so the narrator does
//     not have to scan the array — picking the worst event in the
//     envelope keeps the narration deterministic.
//   - Reports has_enough_data = (event_count >= 3): three is the
//     minimum sample for a useful average / median; below that the
//     narration must acknowledge insufficient data.
func buildVampireDrainEnvelope(
	vehicleID int64,
	lookbackDays int,
	eventLimit int,
	windowStart time.Time,
	windowEnd time.Time,
	events []drivedb.VampireDrainEvent,
	stats drivedb.VampireDrainStats,
) map[string]any {
	rfc3339 := "2006-01-02T15:04:05Z07:00"

	eventRows := make([]map[string]any, 0, len(events))
	for _, e := range events {
		row := map[string]any{
			"started_at":         e.StartedAt.UTC().Format(rfc3339),
			"ended_at":           e.EndedAt.UTC().Format(rfc3339),
			"duration_hours":     roundVampireDrain(e.DurationHours, 4),
			"start_battery_pct":  roundVampireDrain(e.StartBatteryPct, 2),
			"end_battery_pct":    roundVampireDrain(e.EndBatteryPct, 2),
			"drain_pct":          roundVampireDrain(e.DrainPct, 4),
			"drain_pct_per_day":  roundVampireDrain(e.DrainPctPerDay, 4),
			"ambient_temp_c_avg": nil,
		}
		if e.AmbientTempCAvg != nil {
			row["ambient_temp_c_avg"] = roundVampireDrain(*e.AmbientTempCAvg, 2)
		}
		eventRows = append(eventRows, row)
	}

	// worst_event = the inline event with the highest
	// drain_pct_per_day. If no events, worst_event is nil.
	// Tied rows: pick the most recent (i.e. smallest array
	// index — Events returns started_at DESC).
	//
	// IMPORTANT: declared as `any` (not `map[string]any`) so the
	// nil sentinel is an untyped nil that compares == nil through
	// the envelope's any-valued map. A typed-nil map would marshal
	// as `null` BUT compare != nil through interface{}, breaking
	// the buildVampireDrainEnvelope contract that "no events ⇒
	// worst_event is JSON null AND Go nil-comparable".
	var worst any
	if len(eventRows) > 0 {
		idxs := make([]int, len(eventRows))
		for i := range idxs {
			idxs[i] = i
		}
		sort.SliceStable(idxs, func(i, j int) bool {
			ai, _ := eventRows[idxs[i]]["drain_pct_per_day"].(float64)
			aj, _ := eventRows[idxs[j]]["drain_pct_per_day"].(float64)
			return ai > aj
		})
		worst = eventRows[idxs[0]]
	}

	statsOut := map[string]any{
		"event_count":              stats.EventCount,
		"total_observed_hours":     roundVampireDrain(stats.TotalObservedHours, 4),
		"avg_drain_pct_per_day":    roundVampireDrainPtr(stats.AvgDrainPctPerDay, 4),
		"median_drain_pct_per_day": roundVampireDrainPtr(stats.MedianDrainPctPerDay, 4),
		"p95_drain_pct_per_day":    roundVampireDrainPtr(stats.P95DrainPctPerDay, 4),
		"sample_window_days":       stats.SampleWindowDays,
	}

	hasEnoughData := stats.EventCount >= 3

	return map[string]any{
		"vehicle_id":      vehicleID,
		"lookback_days":   lookbackDays,
		"event_limit":     eventLimit,
		"window_start":    windowStart.UTC().Format(rfc3339),
		"window_end":      windowEnd.UTC().Format(rfc3339),
		"stats":           statsOut,
		"events":          eventRows,
		"event_count":     len(eventRows),
		"worst_event":     worst,
		"has_enough_data": hasEnoughData,
	}
}

// roundVampireDrain rounds v to n decimal places. Defensive against
// +/-Inf and NaN.
func roundVampireDrain(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// roundVampireDrainPtr rounds *v to n decimal places, preserving the
// nil → nil convention so the envelope distinguishes "no data" from
// "actual zero drain". Returns any so the JSON marshaller can emit
// JSON null for nil pointers.
func roundVampireDrainPtr(v *float64, n int) any {
	if v == nil {
		return nil
	}
	return roundVampireDrain(*v, n)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// VampireDrainExplanationSources bundles the narrow read interfaces
// RegisterVampireDrainExplanationTools needs.
//
// Production wiring (router.go) reuses the same rag.Retriever +
// *drivedb.VampireDrainRepo instances the rest of the AI surface is
// built around; tests substitute deterministic fakes per-source.
type VampireDrainExplanationSources struct {
	Retriever rag.Retriever
	Drains    VampireDrainSource
}

// RegisterVampireDrainExplanationTools installs the
// vampire-drain-explanation slice's tools on r. Called from
// router.go AFTER RegisterCostForecastNarrationTools so the
// registry's alphabetical Names list continues to grow
// deterministically without disturbing earlier registrations or any
// builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterVampireDrainExplanationTools(r *tools.Registry, s VampireDrainExplanationSources) {
	r.Register(&retrieveIdleDrainChunks{r: s.Retriever})
	r.Register(&queryVampireDrainWindows{src: s.Drains, now: time.Now})
}

// assertAllowedIdleDrainSourceTypes enforces the per-feature
// source-type allowlist.
func assertAllowedIdleDrainSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_idle_drain_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := vampireDrainAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_idle_drain_chunks: source_type %q not in allowed set %s",
				st, vampireDrainAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_idle_drain_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedIdleDrainSourceTypes returns a defensive copy of the
// per-feature source-type allowlist. Exported so the AI handler +
// tests can reference the same set the tools enforce.
func AllowedIdleDrainSourceTypes() []string {
	out := make([]string, len(vampireDrainAllowedSourceTypes))
	copy(out, vampireDrainAllowedSourceTypes)
	sort.Strings(out)
	return out
}
