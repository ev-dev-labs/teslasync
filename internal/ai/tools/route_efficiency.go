// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// route_efficiency.go ships TWO new read-only tools:
//
//   - `retrieve_route_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject, restricted
//     to the route-efficiency slice's per-feature source-type
//     allowlist {drive_summary, route_efficiency, weather_context}.
//     Only drive_summary is wired into the F7 indexer today (slice
//     0008); route_efficiency and weather_context are reserved by
//     string for forward-compatibility — the future
//     `ai_route_indexer` job (registered as JobNames=["ai_route_indexer"]
//     in the registry) will fan-out into those corpora once wired.
//     Until then, retrieve_route_chunks called with
//     source_types=["route_efficiency"] or ["weather_context"]
//     returns zero chunks — which is the correct behaviour: the
//     retriever simply has nothing indexed yet, and the strategy's
//     goldens already cover the zero-matches narration.
//
//   - `query_route_efficiency` — a typed read tool that returns a
//     deterministic SI-canonical envelope of the user's top
//     repeat-driven routes (start_place → end_place groupings) for
//     ONE vehicle. The envelope mirrors the `routes` array surfaced
//     by the existing /api/v1/analytics/route-efficiency baseline
//     handler (RouteEfficiencyHandler.List), with the same shape:
//     start_place, end_place, trip_count, avg_distance_m,
//     avg_duration_s, avg/best/worst kwh_per_100km, avg_speed_mps,
//     ambient_temp_c_avg. Computed in-memory from
//     DriveSource.GetByVehicle — no new SQL is written by this tool.
//     The aggregation matches the SQL in route_efficiency_handler.go
//     bit-for-bit so the LLM sees the same per-route metrics the
//     deterministic baseline UI already shows.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool. The actual rendering of the
// route summaries to the user happens in the SPA via the existing
// /analytics/route-efficiency baseline UI (RouteEfficiencyPage)
// which keeps rendering RouteCards, the comparison chart, and the
// metric bars; the AI surface is an opt-in suggestion panel layered
// alongside (ADR-015 §I3).
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → retrieve_route_chunks delegates to
//     the F7 rag.Retriever (the single canonical retrieval entry
//     point); query_route_efficiency delegates to a narrow
//     DriveSource read interface satisfied at boot by an adapter
//     wrapping the existing *database.DriveRepo (no new SQL).
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     route-aggregation math is pure Go on a *models.Drive slice.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; aggregation is a pure read.
//
//   - Privacy: route identifiers (start/end place names) are the
//     natural key for a "route", so the tool returns them verbatim.
//     The PolicyRouteEfficiencySuggestions allow-list does NOT
//     include ClassStreetAddr — the F8 redact decorator therefore
//     converts each place name into a round-trip tag (e.g.
//     `<addr id='1'/>`) before the LLM call; the addresses are
//     restored only in the final SSE frame returned to the same
//     authenticated user. This means the provider sees
//     `<addr id='1'/> → <addr id='2'/>` and the user sees their
//     real "Home → Work" pair.
//
// The source-type allowlist is enforced at the tool boundary (any
// other rag.Source* constant is refused), so a confused LLM that
// asks the assistant to search e.g. "user_note" cannot accidentally
// expose a corpus the slice did not enumerate.
//
// Forward-compat note: the slice prompt enumerates three source
// types — drive_summary, route_efficiency, weather_context. Only
// drive_summary is wired into the F7 indexer today (see
// internal/ai/rag/rag.go SourceDriveSummary). route_efficiency and
// weather_context are reserved by string so a future indexer slice
// can register them without re-touching the tool boundary.

package tools

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
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// routeEffSourceRouteEfficiency / routeEffSourceWeatherContext are
// the two source-type strings reserved by the slice prompt that
// have no F7 indexer today. They are intentionally NOT exported as
// rag.Source* constants because adding to that package widens the
// global F7 contract beyond this slice's mandate. When a future
// slice adds the indexer it should promote these strings to
// rag.SourceRouteEfficiency / rag.SourceWeatherContext in one
// place.
const (
	routeEffSourceRouteEfficiency = "route_efficiency"
	routeEffSourceWeatherContext  = "weather_context"
)

// routeEffAllowedSourceTypes is the per-feature allowlist of
// source-type strings the route-efficiency-suggestions strategy may
// retrieve over. Any other source type passed via the LLM's typed
// input is refused at validation time — the slice prompt explicitly
// enumerates these three corpora and a future slice that adds a new
// source must add it here AND extend the strategy's system prompt +
// goldens, not silently widen.
//
// Kept in lex order so error messages list a stable allowed-set.
var routeEffAllowedSourceTypes = []string{
	rag.SourceDriveSummary,
	routeEffSourceRouteEfficiency,
	routeEffSourceWeatherContext,
}

// routeEffAllowedSourceTypeSet is the O(1) membership lookup for
// the allowlist above. Computed at package init so the tool's
// Validate hot path doesn't re-hash on every call.
var routeEffAllowedSourceTypeSet = func() map[string]struct{} {
	out := make(map[string]struct{}, len(routeEffAllowedSourceTypes))
	for _, s := range routeEffAllowedSourceTypes {
		out[s] = struct{}{}
	}
	return out
}()

// routeEffMaxK is the per-call upper bound on the retriever's k
// parameter. A route-efficiency suggestions panel returning >12
// chunks adds no value — the LLM won't cite them all and chunk
// text inflates context cost.
const routeEffMaxK = 12

// routeEffDefaultK is the value substituted when the LLM omits k or
// passes 0.
const routeEffDefaultK = 5

// routeEffMaxQueryChars caps the user-supplied natural-language
// query at the tool boundary. Defensive against an enormous
// payload that would inflate the embedding API cost.
const routeEffMaxQueryChars = 1024

// routeEffAllowedSourceTypesHint is the comma-separated allowlist
// rendered in retrieve_route_chunks's Description so the LLM picks
// from the enumerated set. Computed once at package init.
var routeEffAllowedSourceTypesHint = strings.Join(routeEffAllowedSourceTypes, ", ")

// ---------------------------------------------------------------------------
// retrieve_route_chunks
// ---------------------------------------------------------------------------

// retrieveRouteChunksInput is the typed input shape for
// retrieve_route_chunks. The dispatcher decodes the LLM's tool-call
// arguments JSON into this struct via ValidateStruct so a malformed
// input fails before any rag.Retriever method runs.
type retrieveRouteChunksInput struct {
	// Query is the natural-language search expression. Required +
	// non-empty + bounded — an empty query embeds to a meaningless
	// zero-vector and a 100KB query inflates cost.
	Query string `json:"query" validate:"required" desc:"Natural-language route-efficiency query (required, non-empty)."`

	// SourceTypes is the per-call allowlist of corpora to search.
	// Each entry MUST appear in routeEffAllowedSourceTypes; an
	// unknown source type is refused at validation time. Empty
	// / omitted is rejected — the LLM MUST be explicit about
	// which corpora the user asked about.
	SourceTypes []string `json:"source_types" validate:"required,min=1" desc:"List of source types to search; allowed values: drive_summary, route_efficiency, weather_context."`

	// K is the requested top-k count. Optional; defaults to
	// routeEffDefaultK when zero. Bounded to [0, routeEffMaxK].
	K int `json:"k,omitempty" validate:"gte=0,lte=12" desc:"Top-k count to return; default 5 when omitted, max 12."`
}

// retrievedRouteChunk is the shared envelope for one chunk in the
// retrieve_route_chunks output. Mirrors rag.Chunk but uses explicit
// JSON tags so the tool's output marshals stably regardless of any
// future change to the underlying rag.Chunk shape.
type retrievedRouteChunk struct {
	SourceType string  `json:"source_type"`
	SourceID   string  `json:"source_id"`
	ChunkIdx   int     `json:"chunk_idx"`
	Text       string  `json:"text"`
	Score      float32 `json:"score"`
}

// retrieveRouteChunks is the read-only tool that calls the F7
// retriever for the route-efficiency domain. It is the FIRST tool
// the LLM is expected to call (per the strategy's system prompt)
// before query_route_efficiency, so the suggestions are grounded
// in retrieved context rather than the model's priors.
//
// Execution: typed input → user_subject from ctx →
// rag.Retriever.Retrieve → JSON envelope. No DB write; no SQL
// written by this method.
type retrieveRouteChunks struct {
	r rag.Retriever
}

// Name implements [Tool].
func (t *retrieveRouteChunks) Name() string { return "retrieve_route_chunks" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the source-type
// allowlist appended so the model picks from the curated set.
func (t *retrieveRouteChunks) Description() string {
	return "Find the top-k nearest chunks to a natural-language query across the calling user's " +
		"route-efficiency history via the F7 RAG retriever. " +
		"READ-only: no record is created, mutated, or deleted. " +
		"Allowed source_types: " + routeEffAllowedSourceTypesHint + ". " +
		"Returns {chunks: [{source_type, source_id, chunk_idx, text, score}]}; an empty list means no match — DO NOT fabricate a route observation to fill the void."
}

// InputSchema implements [Tool].
func (t *retrieveRouteChunks) InputSchema() json.RawMessage {
	return cachedSchema(retrieveRouteChunksInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *retrieveRouteChunks) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *retrieveRouteChunks) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream, and the retriever scopes by the
// calling user_subject so cross-tenant leakage is impossible).
func (t *retrieveRouteChunks) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator,
// then enforces the per-feature source-type allowlist that the
// validator's `oneof` tag cannot express for slice fields.
func (t *retrieveRouteChunks) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[retrieveRouteChunksInput](raw)
	if err != nil {
		return nil, err
	}
	in := v.(retrieveRouteChunksInput)
	if err := assertAllowedRouteSourceTypes(in.SourceTypes); err != nil {
		return nil, err
	}
	if len(in.Query) > routeEffMaxQueryChars {
		return nil, fmt.Errorf("retrieve_route_chunks: query length %d exceeds cap %d",
			len(in.Query), routeEffMaxQueryChars)
	}
	return in, nil
}

// Execute implements [Tool]. Resolves user_subject from the ctx the
// AI handler installed via provider.WithSubject, then calls the F7
// retriever. Returns a deterministic envelope with explicit JSON
// tags so the dispatcher's serialisation path is uniform across
// runs.
//
// A nil retriever is a wiring bug detected at boot via constructor
// panic; this function only nil-checks defensively for tests that
// instantiate the tool directly.
func (t *retrieveRouteChunks) Execute(ctx context.Context, in any) (any, error) {
	input := in.(retrieveRouteChunksInput)
	if t.r == nil {
		return nil, errors.New("retrieve_route_chunks: no rag.Retriever wired")
	}

	k := input.K
	if k == 0 {
		k = routeEffDefaultK
	}

	subject := provider.SubjectFromContext(ctx)

	chunks, err := t.r.Retrieve(ctx, subject, input.Query, input.SourceTypes, k)
	if err != nil {
		return nil, fmt.Errorf("retrieve_route_chunks: rag.Retrieve: %w", err)
	}

	out := make([]retrievedRouteChunk, 0, len(chunks))
	for _, c := range chunks {
		out = append(out, retrievedRouteChunk{
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
// query_route_efficiency
// ---------------------------------------------------------------------------

// queryRouteEfficiencyLookbackDays is the default lookback window
// for the in-memory route aggregation when the LLM omits an
// explicit date range. Mirrors the SPA default
// (30 days, see RouteEfficiencyPage's defaultStartDate).
const queryRouteEfficiencyLookbackDays = 30

// queryRouteEfficiencyMaxRoutes caps the number of route summaries
// returned. Mirrors the existing SQL handler's `LIMIT 15`.
const queryRouteEfficiencyMaxRoutes = 15

// queryRouteEfficiencyMinDistanceMeters is the per-drive distance
// floor below which a row is excluded from the aggregation —
// mirrors the SQL handler's `WHERE distance_m > 1609.344` (the
// `1 mile` minimum, expressed as driveStatsMetersPerMile). Trips
// shorter than this are skipped so single-block errands don't
// dominate the kWh/100 km calculation.
const queryRouteEfficiencyMinDistanceMeters = 1609.344

// queryRouteEfficiencyFetchLimit caps how many drives we pull from
// the repo before grouping. Generous (1000) for a 30-day window;
// the underlying DriveSource paginates so we never load the whole
// table.
const queryRouteEfficiencyFetchLimit = 1000

// queryRouteEfficiencyInput is the typed input shape for
// query_route_efficiency. The dispatcher decodes the LLM's tool-call
// arguments JSON into this struct via ValidateStruct so a malformed
// input fails before any DriveSource method runs.
type queryRouteEfficiencyInput struct {
	// VehicleID identifies the vehicle to summarise. Required +
	// positive — the AI handler ALWAYS scopes to a vehicle the
	// caller has access to via the existing typed auth path, so
	// a missing or nonsense ID is a programming error rather
	// than a user-facing case.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// LookbackDays restricts the aggregation window to the past
	// N days from `now`. Optional; defaults to 30 (mirrors the
	// SPA baseline) when zero. Bounded to [0, 365] — anything
	// longer is rejected so an "all-time" query cannot
	// accidentally dominate the input window.
	LookbackDays int `json:"lookback_days,omitempty" validate:"gte=0,lte=365" desc:"Lookback window in days (0..365); 0 ⇒ default 30 days."`
}

// routeAgg accumulates per-(start_place, end_place) metrics during
// the in-memory group-by. Mirrors the SQL handler's CASE/AVG/MIN/MAX
// expressions but executed in Go on a *models.Drive slice.
type routeAgg struct {
	startPlace    string
	endPlace      string
	tripCount     int
	distanceMSum  float64
	durationSSum  float64
	avgSpeedMpsN  int
	avgSpeedSum   float64
	tempCN        int
	tempCSum      float64
	bestKwhPer100 *float64
	avgKwhSum     float64
	avgKwhN       int
	worstKwhPer100 *float64
}

// queryRouteEfficiency is the read-only tool that returns the
// user's top repeat-driven routes for ONE vehicle. Distinct from
// the existing query_drive_detail builtin so the
// route-efficiency-suggestions strategy's allowed-tool whitelist
// can stay self-contained: future per-feature changes to
// query_route_efficiency (e.g. adding a per-route weather context
// envelope when the weather_context corpus is wired) will not
// bleed into other tools' surfaces.
type queryRouteEfficiency struct {
	src DriveSource
	// now returns the reference timestamp for the lookback
	// window. Injectable so tests can pin a deterministic
	// reference instant. Defaults to time.Now in [New].
	now func() time.Time
}

// Name implements [Tool].
func (t *queryRouteEfficiency) Name() string { return "query_route_efficiency" }

// Description implements [Tool].
func (t *queryRouteEfficiency) Description() string {
	return "Return the SI-canonical top repeat-driven routes (start_place → end_place groupings) " +
		"for ONE vehicle over an optional lookback window. Mirrors the deterministic " +
		"/api/v1/analytics/route-efficiency baseline shape (the same routes the user sees on the " +
		"Route Efficiency page): trip_count, avg_distance_m, avg_duration_s, avg/best/worst " +
		"kwh_per_100km, avg_speed_mps, ambient_temp_c_avg. READ-only — no record is created, " +
		"mutated, or deleted. Call this AFTER retrieve_route_chunks; the per-route metrics are the " +
		"ground truth for any suggestion you make."
}

// InputSchema implements [Tool].
func (t *queryRouteEfficiency) InputSchema() json.RawMessage {
	return cachedSchema(queryRouteEfficiencyInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryRouteEfficiency) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryRouteEfficiency) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryRouteEfficiency) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryRouteEfficiency) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryRouteEfficiencyInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// aggregation; no SQL is written by this method.
func (t *queryRouteEfficiency) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryRouteEfficiencyInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_route_efficiency: no DriveSource wired")
	}

	lookback := input.LookbackDays
	if lookback == 0 {
		lookback = queryRouteEfficiencyLookbackDays
	}

	now := t.now().UTC()
	startTime := now.AddDate(0, 0, -lookback)
	endTime := now

	drives, err := t.src.GetByVehicle(ctx, input.VehicleID, queryRouteEfficiencyFetchLimit, 0, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("query_route_efficiency: load drives vehicle %d: %w", input.VehicleID, err)
	}

	envelope := aggregateRouteEfficiency(drives)
	envelope["vehicle_id"] = input.VehicleID
	envelope["lookback_days"] = lookback
	envelope["window_start"] = startTime.Format("2006-01-02T15:04:05Z07:00")
	envelope["window_end"] = endTime.Format("2006-01-02T15:04:05Z07:00")
	return envelope, nil
}

// aggregateRouteEfficiency is a pure helper: given a slice of
// *models.Drive rows, compute the deterministic route-efficiency
// envelope. Extracted so the unit tests can call it directly
// without spinning up a fake DriveSource and so Execute stays
// focused on IO + error wrapping.
//
// The aggregation matches RouteEfficiencyHandler.List's SQL
// expressions bit-for-bit:
//
//   - Group by (start_place, end_place); a drive is excluded if
//     either is NULL/empty or if distance_m ≤ 1609.344 (one mile).
//   - kwh_per_100km is derived from (start_soc - end_soc) / distance
//     scaled to a 100 km window; the start/end SoC are 0..100 ints.
//   - avg_kwh_per_100km / best_kwh_per_100km / worst_kwh_per_100km
//     reflect the AVG/MIN/MAX of the per-drive value within the
//     route. Rows whose efficiency could not be derived (no SoC
//     delta available) contribute to trip_count but not to the
//     efficiency aggregates.
//   - avg_speed_mps / ambient_temp_c_avg are simple AVGs across
//     non-null rows; rows with NULL contribute to neither numerator
//     nor denominator.
//
// The output is sorted by trip_count DESC (matches the SQL ORDER
// BY) and truncated to queryRouteEfficiencyMaxRoutes.
func aggregateRouteEfficiency(drives []*models.Drive) map[string]any {
	aggs := map[string]*routeAgg{}
	for _, d := range drives {
		if d == nil {
			continue
		}
		if d.StartAddress == nil || *d.StartAddress == "" {
			continue
		}
		if d.EndAddress == nil || *d.EndAddress == "" {
			continue
		}
		if d.DistanceM <= queryRouteEfficiencyMinDistanceMeters {
			continue
		}
		key := *d.StartAddress + "||" + *d.EndAddress
		a, ok := aggs[key]
		if !ok {
			a = &routeAgg{startPlace: *d.StartAddress, endPlace: *d.EndAddress}
			aggs[key] = a
		}
		a.tripCount++
		a.distanceMSum += d.DistanceM
		a.durationSSum += float64(d.DurationS)
		if d.AvgSpeedMps != nil {
			a.avgSpeedMpsN++
			a.avgSpeedSum += *d.AvgSpeedMps
		}
		if d.OutsideTempAvgC != nil {
			a.tempCN++
			a.tempCSum += *d.OutsideTempAvgC
		}
		// kWh / 100km derivation matches the SQL handler:
		// (start_soc - end_soc)::float / (distance_m / driveStatsMetersPerMile) * 100
		// where driveStatsMetersPerMile=1609.344. The unit there is
		// kWh / 100 mi; the SQL uses that unit but the field is
		// labelled "efficiency" without a unit suffix. We expose the
		// derived value as `kwh_per_100mi` in the envelope to make
		// the unit explicit; the strategy's prompt translates to
		// km when narrating.
		if d.StartBatteryPct != nil && d.EndBatteryPct != nil {
			startSoc := float64(*d.StartBatteryPct)
			endSoc := float64(*d.EndBatteryPct)
			// distance in miles: distance_m / 1609.344
			distMi := d.DistanceM / queryRouteEfficiencyMinDistanceMeters
			if distMi > 0 {
				eff := (startSoc - endSoc) / distMi * 100.0
				a.avgKwhSum += eff
				a.avgKwhN++
				if a.bestKwhPer100 == nil || eff < *a.bestKwhPer100 {
					v := eff
					a.bestKwhPer100 = &v
				}
				if a.worstKwhPer100 == nil || eff > *a.worstKwhPer100 {
					v := eff
					a.worstKwhPer100 = &v
				}
			}
		}
	}

	routes := make([]map[string]any, 0, len(aggs))
	for _, a := range aggs {
		row := map[string]any{
			"start_place":    a.startPlace,
			"end_place":      a.endPlace,
			"trip_count":     a.tripCount,
			"avg_distance_m": roundN(a.distanceMSum/float64(a.tripCount), 2),
			"avg_duration_s": roundN(a.durationSSum/float64(a.tripCount), 2),
		}
		if a.avgSpeedMpsN > 0 {
			row["avg_speed_mps"] = roundN(a.avgSpeedSum/float64(a.avgSpeedMpsN), 2)
		} else {
			row["avg_speed_mps"] = nil
		}
		if a.tempCN > 0 {
			tempC := a.tempCSum / float64(a.tempCN)
			row["ambient_temp_c_avg"] = roundN(tempC, 2)
			row["ambient_temp_f_avg"] = roundN(tempC*9.0/5.0+32.0, 2)
		} else {
			row["ambient_temp_c_avg"] = nil
			row["ambient_temp_f_avg"] = nil
		}
		if a.avgKwhN > 0 {
			row["avg_kwh_per_100mi"] = roundN(a.avgKwhSum/float64(a.avgKwhN), 2)
		} else {
			row["avg_kwh_per_100mi"] = nil
		}
		if a.bestKwhPer100 != nil {
			row["best_kwh_per_100mi"] = roundN(*a.bestKwhPer100, 2)
		} else {
			row["best_kwh_per_100mi"] = nil
		}
		if a.worstKwhPer100 != nil {
			row["worst_kwh_per_100mi"] = roundN(*a.worstKwhPer100, 2)
		} else {
			row["worst_kwh_per_100mi"] = nil
		}
		routes = append(routes, row)
	}
	// Sort by trip_count DESC; tie-break on start_place ASC then
	// end_place ASC so the output is deterministic for goldens.
	sort.SliceStable(routes, func(i, j int) bool {
		ti := routes[i]["trip_count"].(int)
		tj := routes[j]["trip_count"].(int)
		if ti != tj {
			return ti > tj
		}
		si := routes[i]["start_place"].(string)
		sj := routes[j]["start_place"].(string)
		if si != sj {
			return si < sj
		}
		return routes[i]["end_place"].(string) < routes[j]["end_place"].(string)
	})
	if len(routes) > queryRouteEfficiencyMaxRoutes {
		routes = routes[:queryRouteEfficiencyMaxRoutes]
	}
	return map[string]any{
		"routes":      routes,
		"route_count": len(routes),
	}
}

// roundN rounds v to n decimal places. Defensive against +/-Inf
// and NaN from a bad division (which the callers guard against
// anyway, but a tool boundary is the wrong place to surface
// non-finite JSON).
func roundN(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// RouteEfficiencySuggestionsSources bundles the narrow read
// interfaces RegisterRouteEfficiencySuggestionsTools needs. Mirrors
// [DriveSearchSources] / [SpeedProfileInsightsSources] but exposes
// only the surface the two route-efficiency tools actually consume.
//
// Production wiring (router.go) reuses the same rag.Retriever +
// *database.DriveRepo instances the rest of the AI surface is
// built around; tests substitute deterministic fakes per-source.
type RouteEfficiencySuggestionsSources struct {
	Retriever rag.Retriever
	Drives    DriveSource
}

// RegisterRouteEfficiencySuggestionsTools installs the
// route-efficiency-suggestions slice's tools on r. Called from
// router.go AFTER RegisterSpeedProfileInsightsTools so the
// registry's alphabetical Names list continues to grow
// deterministically without disturbing the BuiltinNames pin test
// or any earlier registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterRouteEfficiencySuggestionsTools(r *Registry, s RouteEfficiencySuggestionsSources) {
	r.Register(&retrieveRouteChunks{r: s.Retriever})
	r.Register(&queryRouteEfficiency{src: s.Drives, now: time.Now})
}

// assertAllowedRouteSourceTypes enforces the per-feature
// source-type allowlist. Returns a deterministic error listing the
// offending entry plus the allowed set so the LLM's tool-error
// reply contains enough context to retry with a corrected payload.
func assertAllowedRouteSourceTypes(types []string) error {
	if len(types) == 0 {
		return errors.New("retrieve_route_chunks: source_types is required and must contain at least one entry")
	}
	seen := make(map[string]struct{}, len(types))
	for _, st := range types {
		if _, ok := routeEffAllowedSourceTypeSet[st]; !ok {
			return fmt.Errorf("retrieve_route_chunks: source_type %q not in allowed set %s",
				st, routeEffAllowedSourceTypesHint)
		}
		if _, dup := seen[st]; dup {
			return fmt.Errorf("retrieve_route_chunks: source_type %q appears more than once in source_types", st)
		}
		seen[st] = struct{}{}
	}
	return nil
}

// AllowedRouteEfficiencySourceTypes returns a defensive copy of
// the per-feature source-type allowlist. Exported so the AI
// handler + tests can reference the same set the tools enforce.
func AllowedRouteEfficiencySourceTypes() []string {
	out := make([]string, len(routeEffAllowedSourceTypes))
	copy(out, routeEffAllowedSourceTypes)
	sort.Strings(out)
	return out
}
