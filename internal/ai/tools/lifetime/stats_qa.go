// Phase-50 / 0041 — X2 Lifetime stats Q&A.
//
// lifetime_stats_qa.go ships TWO new read-only tools:
//
//   - `query_lifetime_stats` — typed envelope derived from the
//     SAME deterministic api.ComputeLifetimeStats helper that backs
//     the canonical baseline GET /api/v1/analytics/lifetime handler.
//     Composes the existing helper through a narrow
//     [LifetimeStatsSource] port; NO new SQL is written by this
//     tool. The aggregation (drives totals, charging totals,
//     savings, fun-facts, ownership timeline, personal records,
//     achievements with progress) is identical to what the chart
//     and metric cards on /lifetime-stats render.
//
//   - `retrieve_analytics_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject, restricted
//     to the slice's per-feature source-type allowlist
//     {analytics_lifetime, drive_summary, charge_session}.
//     drive_summary and charge_session are wired into the F7
//     indexer today (slice 0008); analytics_lifetime is reserved
//     by string for forward-compatibility — a future slice will
//     index per-vehicle lifetime-stat rollup chunks. Until then,
//     retrieve_analytics_chunks called with analytics_lifetime in
//     source_types simply returns zero chunks for that corpus —
//     which is the correct behaviour: the strategy's goldens
//     already cover the zero-matches Q&A and the system prompt
//     instructs the LLM to answer gracefully when zero chunks are
//     returned.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → query_lifetime_stats delegates to
//     a narrow LifetimeStatsSource read interface satisfied at boot
//     by *api.AILifetimeStatsSource which calls the SAME shared
//     api.ComputeLifetimeStats helper that backs the baseline
//     handler. retrieve_analytics_chunks delegates to the F7
//     rag.Retriever (the single canonical retrieval entry point).
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     The envelope-building math is pure Go on the typed
//     LifetimeStatsResult struct the helper already returns.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; both tools are pure reads.
//
//   - Privacy: lifetime stats fields are aggregate and contain NO
//     locations, addresses, or place names (only timestamps,
//     distances, and counts). Even so, the per-feature redaction
//     policy PolicyChatbot is deny-by-default — every PII class is
//     tagged round-trip. A confused LLM that asks the user "where
//     is your most active charging location?" cannot leak a
//     charging-place name or street address back through the model.
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
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// lifetimeStatsSourceAnalyticsLifetime is the source-type string
// reserved by the slice prompt for the future per-vehicle lifetime-
// stats rollup embedding corpus. Intentionally NOT exported as a
// rag.Source* constant because adding to that package widens the
// global F7 contract beyond this slice's mandate. When the future
// indexer slice lands, it should promote this string to
// rag.SourceAnalyticsLifetime in one place.
const lifetimeStatsSourceAnalyticsLifetime = "analytics_lifetime"

// lifetimeStatsAllowedSourceTypes is the per-feature allowlist of
// source-type strings the lifetime-stats-qa strategy may retrieve
// over. Any other source type passed via the LLM's typed input is
// refused at validation time — the slice prompt explicitly
// enumerates these three corpora and a future slice that adds a
// new source must add it here AND extend the strategy's system
// prompt + goldens, not silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var lifetimeStatsAllowedSourceTypes = []string{
	lifetimeStatsSourceAnalyticsLifetime,
	rag.SourceChargeSession,
	rag.SourceDriveSummary,
}

// lifetimeStatsAllowedSourceTypeSet is the O(1) membership lookup
// for the allowlist above.
var lifetimeStatsAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(lifetimeStatsAllowedSourceTypes))
	for _, s := range lifetimeStatsAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// lifetimeStatsAllowedSourceTypesHint is the comma-separated
// allowlist rendered in retrieve_analytics_chunks's Description.
var lifetimeStatsAllowedSourceTypesHint = strings.Join(lifetimeStatsAllowedSourceTypes, ", ")

// lifetimeStatsMaxK is the per-call upper bound on the retriever's
// k parameter.
const lifetimeStatsMaxK = 12

// lifetimeStatsDefaultK is the value substituted when the LLM omits
// k.
const lifetimeStatsDefaultK = 5

// lifetimeStatsMaxQueryChars caps the user-supplied natural-language
// query at the tool boundary.
const lifetimeStatsMaxQueryChars = 1024

// ---------------------------------------------------------------------------
// retrieve_analytics_chunks
// ---------------------------------------------------------------------------

// retrieveAnalyticsChunksInput is the typed input shape for
// retrieve_analytics_chunks. The dispatcher decodes the LLM's
// tool-call arguments JSON into this struct via ValidateStruct so a
// malformed input fails before any rag.Retriever method runs.
type retrieveAnalyticsChunksInput struct {
	// Query is the natural-language search expression. Required,
	// non-empty, bounded.
	Query string `json:"query" validate:"required" desc:"Natural-language analytics query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in lifetimeStatsAllowedSourceTypes;
	// an unknown source type is refused at validation time.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: analytics_lifetime, charge_session, drive_summary."`

	// K is the requested top-k count. Optional; defaults to
	// lifetimeStatsDefaultK when zero. Bounded to [0,
	// lifetimeStatsMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedAnalyticsChunk is the shared envelope for one chunk in
// the retrieve_analytics_chunks output. Mirrors rag.Chunk but uses
// explicit JSON tags so the tool's output marshals stably regardless
// of any future change to the underlying rag.Chunk shape.
type retrievedAnalyticsChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveAnalyticsChunks is the read-only tool that calls the F7
// retriever for the lifetime-stats Q&A domain. It is the OPTIONAL
// secondary tool the LLM may call (per the strategy's system prompt)
// after query_lifetime_stats, so the answer is grounded FIRST in
// the deterministic envelope and only OPTIONALLY enriched with
// retrieved per-event context.
type retrieveAnalyticsChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveAnalyticsChunks) Name() string { return "retrieve_analytics_chunks" }

// Description implements [Tool].
func (t *retrieveAnalyticsChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"analytics-lifetime / drive-summary / charge-session history via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + lifetimeStatsAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a drive or charge event to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveAnalyticsChunks) InputSchema() json.RawMessage {
	return tools.CachedSchema(retrieveAnalyticsChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *retrieveAnalyticsChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *retrieveAnalyticsChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *retrieveAnalyticsChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveAnalyticsChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[retrieveAnalyticsChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveAnalyticsChunksInput)
	if err := assertAllowedAnalyticsSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > lifetimeStatsMaxQueryChars {
		return nil, fmt.Errorf("retrieve_analytics_chunks: query length %d exceeds cap %d",
			len(in.Query), lifetimeStatsMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool].
func (t *retrieveAnalyticsChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveAnalyticsChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_analytics_chunks: no rag.Retriever wired")
	}
	k := input.K
	if k == 0 {
		k = lifetimeStatsDefaultK
	}
	subject := provider.SubjectFromContext(ctx)
	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_analytics_chunks: rag.Retrieve: %w", err)
	}
	out := make([]retrievedAnalyticsChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedAnalyticsChunk{
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
// query_lifetime_stats
// ---------------------------------------------------------------------------

// LifetimeStatsEnvelope is the typed envelope query_lifetime_stats
// returns. Mirrors api.LifetimeStatsResult 1:1 with explicit JSON
// tags so the tool's output marshals stably regardless of any future
// internal struct rename. Re-declared in the tools package so the
// envelope is self-contained — the internal/api package is a long-
// running consumer of these types and re-importing them would create
// a layering inversion (the tools package is below internal/api in
// the dependency graph; internal/api imports tools, not the other
// way around).
type LifetimeStatsEnvelope struct {
	// Driving aggregates
	TotalDrives       int     `json:"total_drives"`
	TotalDistanceKm   float64 `json:"total_distance_km"`
	TotalDrivingHours float64 `json:"total_driving_hours"`
	LongestDriveKm    float64 `json:"longest_drive_km"`
	HighestSpeedKmh   float64 `json:"highest_speed_kmh"`
	AvgEfficiencyWhKm float64 `json:"avg_efficiency_wh_km"`

	// Charging aggregates
	TotalChargeSessions int     `json:"total_charge_sessions"`
	TotalEnergyKwh      float64 `json:"total_energy_kwh"`
	TotalChargingHours  float64 `json:"total_charging_hours"`
	TotalChargingCost   float64 `json:"total_charging_cost"`

	// Savings
	GasEquivalentCost float64 `json:"gas_equivalent_cost"`
	TotalSavings      float64 `json:"total_savings"`
	CO2OffsetKg       float64 `json:"co2_offset_kg"`
	TreesEquivalent   int     `json:"trees_equivalent"`

	// Fun facts
	EarthCircumferences float64 `json:"earth_circumferences"`
	MoonTrips           float64 `json:"moon_trips"`
	DaysOnRoad          float64 `json:"days_on_road"`
	HomesEquivalentDays float64 `json:"homes_equivalent_days"`

	// Timeline
	FirstDriveDate      *string `json:"first_drive_date"`
	OwnershipDays       int     `json:"ownership_days"`
	MostActiveDayOfWeek string  `json:"most_active_day_of_week"`
	MostActiveHour      int     `json:"most_active_hour"`

	// Personal records
	LongestDriveRecord LifetimeStatsRecord `json:"longest_drive_record"`
	HighestSpeedRecord LifetimeStatsRecord `json:"highest_speed_record"`
	MaxChargeRecord    LifetimeStatsRecord `json:"max_charge_record"`

	// Achievements (compute-only; UnlockedAt nil here — the
	// canonical handler is the only path that records unlocks
	// and emits SSE celebration events).
	Achievements []LifetimeStatsAchievement `json:"achievements"`
}

// LifetimeStatsRecord mirrors api.PersonalRecord. Re-declared so the
// envelope is self-contained.
type LifetimeStatsRecord struct {
	Value float64 `json:"value"`
	Date  *string `json:"date"`
}

// LifetimeStatsAchievement mirrors api.Achievement. Re-declared so
// the envelope is self-contained. The tool's UnlockedAt is always
// nil because the read-only tool path never persists or broadcasts
// transitions.
type LifetimeStatsAchievement struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Icon        string  `json:"icon"`
	Unlocked    bool    `json:"unlocked"`
	UnlockedAt  *string `json:"unlocked_at"`
	Progress    float64 `json:"progress"`
	Target      float64 `json:"target"`
	Current     float64 `json:"current"`
}

// LifetimeStatsSource is the narrow port the query_lifetime_stats
// tool delegates to. In production it is satisfied by
// *api.AILifetimeStatsSource (which composes
// api.ComputeLifetimeStats); in tests we substitute deterministic
// fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the read-only contract that ADR-015 §I3 + the
// slice prompt mandate.
type LifetimeStatsSource interface {
	// LifetimeStats returns the deterministic lifetime envelope
	// for vehicleID. Implementations SHOULD call the SAME shared
	// api.ComputeLifetimeStats helper that backs the baseline
	// GET /api/v1/analytics/lifetime handler — never a parallel
	// re-implementation.
	LifetimeStats(ctx context.Context, vehicleID int64) (*LifetimeStatsEnvelope, error)
}

// queryLifetimeStatsInput is the typed input shape.
type queryLifetimeStatsInput struct {
	// VehicleID identifies the vehicle to summarise. Required +
	// positive — the AI handler ALWAYS scopes to a vehicle the
	// caller has access to via the existing typed auth path.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
}

// queryLifetimeStats is the read-only tool that returns the
// deterministic lifetime-stats envelope.
type queryLifetimeStats struct {
	src LifetimeStatsSource
}

// Name implements [Tool].
func (t *queryLifetimeStats) Name() string { return "query_lifetime_stats" }

// Description implements [Tool].
func (t *queryLifetimeStats) Description() string {
	return "Return the SAME deterministic lifetime-stats envelope the canonical baseline " +
		"GET /api/v1/analytics/lifetime handler serves for ONE vehicle. " +
		"Reports total_drives, total_distance_km, total_driving_hours, longest_drive_km, " +
		"highest_speed_kmh, avg_efficiency_wh_km, total_charge_sessions, total_energy_kwh, " +
		"total_charging_hours, total_charging_cost, gas_equivalent_cost, total_savings, " +
		"co2_offset_kg, trees_equivalent, earth_circumferences, moon_trips, days_on_road, " +
		"homes_equivalent_days, first_drive_date, ownership_days, most_active_day_of_week, " +
		"most_active_hour, the personal-records (longest_drive_record, highest_speed_record, " +
		"max_charge_record), and the achievements list (id, name, unlocked, progress, target, " +
		"current). READ-only — no record is created, mutated, or deleted. Call this FIRST; the " +
		"envelope is the ground truth for any answer you produce — DO NOT recompute or contradict the figures."
}

// InputSchema implements [Tool].
func (t *queryLifetimeStats) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryLifetimeStatsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryLifetimeStats) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *queryLifetimeStats) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryLifetimeStats) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryLifetimeStats) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryLifetimeStatsInput](raw)
}

// Execute implements [Tool]. Single helper round-trip; no SQL is
// written by this method.
func (t *queryLifetimeStats) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryLifetimeStatsInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_lifetime_stats: no LifetimeStatsSource wired")
	}
	envelope, err := t.src.LifetimeStats(ctx, input.VehicleID)
	if err != nil {
		return nil, fmt.Errorf("query_lifetime_stats: load lifetime stats vehicle %d: %w", input.VehicleID, err)
	}
	if envelope == nil {
		return nil, fmt.Errorf("query_lifetime_stats: source returned nil envelope")
	}
	return envelope, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// LifetimeStatsQASources bundles the narrow read interfaces
// RegisterLifetimeStatsQATools needs.
//
// Production wiring (router.go) reuses the same rag.Retriever +
// LifetimeStatsSource adapter the rest of the AI surface is built
// around; tests substitute deterministic fakes per-source.
type LifetimeStatsQASources struct {
	Retriever     rag.Retriever
	LifetimeStats LifetimeStatsSource
}

// RegisterLifetimeStatsQATools installs the lifetime-stats-qa
// slice's tools on r. Called from router.go AFTER
// RegisterPeriodCompareNarrationTools so the registry's alphabetical
// Names list continues to grow deterministically without disturbing
// earlier registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterLifetimeStatsQATools(r *tools.Registry, s LifetimeStatsQASources) {
	r.Register(&retrieveAnalyticsChunks{r: s.Retriever})
	r.Register(&queryLifetimeStats{src: s.LifetimeStats})
}

// assertAllowedAnalyticsSourceTypes enforces the per-feature
// source-type allowlist.
func assertAllowedAnalyticsSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_analytics_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := lifetimeStatsAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_analytics_chunks: source_type %q not in allowed set %s",
				st, lifetimeStatsAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_analytics_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedAnalyticsSourceTypes returns a defensive copy of the
// per-feature source-type allowlist. Exported so the AI handler +
// tests can reference the same set the tools enforce.
func AllowedAnalyticsSourceTypes() []string {
	out := make([]string, len(lifetimeStatsAllowedSourceTypes))
	copy(out, lifetimeStatsAllowedSourceTypes)
	sort.Strings(out)
	return out
}
