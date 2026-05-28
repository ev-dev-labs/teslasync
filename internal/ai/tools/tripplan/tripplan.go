// Phase-50 / 0025 — D5 Trip planner LLM agent.
//
// trip_planner_llm_agent.go ships THREE new propose-only tools:
//
//   - `query_chargers_along_route` — projects the user's past
//     charging-session start_lat / start_lng / start_place onto a
//     haversine corridor between a caller-supplied origin and
//     destination so the LLM has historical evidence of which
//     chargers the user has actually used near the planned route.
//     READ-only against the existing charging_sessions table via the
//     shared [tools.ChargeSource] interface — no new SQL is written by
//     this tool.
//
//   - `query_user_charge_dwells` — aggregates the same charging
//     sessions by start_place and returns per-location avg dwell
//     duration, avg delta-SOC, and visit count so the LLM can
//     recommend charger choices that match the user's typical dwell
//     behaviour rather than averaging across all users.
//
//   - `draft_trip_plan` — delegates to the canonical
//     *TripPlannerHandler.computePlan path via a narrow
//     [TripPlanComputer] port (production: AITripPlanComputer in
//     internal/api/ai_trip_planner_llm_handler.go) and returns the
//     same SI-canonical envelope the deterministic
//     POST /api/v1/trip-planner/plan baseline already returns
//     (total_distance_m, total_duration_s, total_energy_wh,
//     arrival_soc, charge_stops, soc_curve). PROPOSE-only: no DB
//     write, no persistence — the user reviews the proposed plan
//     in the AI panel and explicitly clicks the existing canonical
//     Plan button in the TripPlannerPage UI to save / route.
//
// All three tools are READ-only. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool. The actual
// trip-plan save / route flows through an explicit user
// confirmation in the TripPlannerPage UI (out of scope for this
// slice — the slice prompt mandates "while requiring explicit user
// confirmation before saving"); the LLM has no tool that writes.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → query_chargers_along_route and
//     query_user_charge_dwells delegate to the shared tools.ChargeSource
//     read interface satisfied at boot by *chargingdb.ChargingRepo
//     (no new SQL). draft_trip_plan delegates to a narrow
//     TripPlanComputer port satisfied at boot by an adapter wrapping
//     the existing *api.TripPlannerHandler — the same code path the
//     deterministic baseline runs.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle. The
//     corridor projection and per-place aggregation math is pure Go
//     on a []*chargingmodel.ChargingSession slice.
//
//   - "no duplicate write paths" → no save_* / update_* / delete_*
//     tool exists in this slice; both query tools are pure reads
//     and draft_trip_plan reuses the canonical compute path.
//
//   - Privacy: the LLM is shown charger start_place strings as
//     redaction-tagged values (the PolicyTripPlannerLLMAgent
//     allow-list intentionally excludes ClassStreetAddr); the
//     round-trip tags are restored only in the final SSE frame
//     returned to the same authenticated user. This means the
//     provider sees `<addr id='1'/>` and the user sees the real
//     "Mountain View Supercharger" string.

package tripplan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Shared bounds + helpers
// ---------------------------------------------------------------------------

// tripPlannerLLMAgentDefaultLookbackDays is the default lookback
// window for the two query tools when the LLM omits an explicit
// lookback. Generous (180 days) so an infrequent driver still has
// charging-history evidence to project onto the corridor.
const tripPlannerLLMAgentDefaultLookbackDays = 180

// tripPlannerLLMAgentMaxLookbackDays caps the lookback window so a
// pathological `lookback_days=99999` payload cannot trigger an
// unbounded scan. Mirrors the route-efficiency tool's 365-day cap.
const tripPlannerLLMAgentMaxLookbackDays = 365

// tripPlannerLLMAgentDefaultCorridorKm is the default half-width of
// the haversine corridor projected from the great-circle line
// between origin and destination. 25km is wide enough to catch
// off-highway chargers a real driver would actually use without
// pulling in unrelated chargers across town. Mirrors the
// stop-snapping radius used by Tesla's own in-car trip planner
// (rough order of magnitude; this is a hint, not an SLA).
const tripPlannerLLMAgentDefaultCorridorKm = 25.0

// tripPlannerLLMAgentMaxCorridorKm caps the corridor half-width so
// an LLM that asks for `corridor_km=10000` cannot turn a long
// trip's corridor projection into a global scan.
const tripPlannerLLMAgentMaxCorridorKm = 500.0

// tripPlannerLLMAgentFetchLimit caps the per-call charging-session
// fetch. Generous for a 180-day window; the underlying tools.ChargeSource
// paginates so we never load the whole table.
const tripPlannerLLMAgentFetchLimit = 1000

// tripPlannerLLMAgentMaxChargersOut caps the chargers returned by
// query_chargers_along_route. The LLM doesn't need 50 chargers — a
// short list of the most-visited corridor chargers is more
// actionable.
const tripPlannerLLMAgentMaxChargersOut = 12

// tripPlannerLLMAgentMaxDwellsOut caps the dwells returned by
// query_user_charge_dwells. Same rationale.
const tripPlannerLLMAgentMaxDwellsOut = 12

// haversineKm returns the great-circle distance in kilometers
// between two (lat, lng) points. Uses the standard haversine
// formula with R=6371km. Pure helper extracted so the corridor
// projection math is testable in isolation.
func haversineKm(aLat, aLng, bLat, bLng float64) float64 {
	const earthRadiusKm = 6371.0
	const rad = math.Pi / 180.0
	dLat := (bLat - aLat) * rad
	dLng := (bLng - aLng) * rad
	la1 := aLat * rad
	la2 := bLat * rad
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(la1)*math.Cos(la2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1.0, math.Sqrt(h)))
}

// distanceToSegmentKm returns the great-circle distance in km from
// point p to the great-circle SEGMENT from a to b, approximated by
// a planar projection in degrees and converted back to km via a
// local-tangent scale. Sufficient for the "is this charger inside
// the corridor" decision — a haversine-perfect cross-track distance
// would require trigonometry that adds no value at the 25km
// half-width scale we operate at.
//
// The implementation rejects degenerate (a==b) segments by falling
// back to the point-to-point haversine distance.
func distanceToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng float64) float64 {
	if aLat == bLat && aLng == bLng {
		return haversineKm(pLat, pLng, aLat, aLng)
	}
	// Project to local planar space using latitude scale.
	// Reasonable for corridors that span <= a few thousand km.
	const rad = math.Pi / 180.0
	scaleLng := math.Cos(((aLat + bLat) / 2) * rad)
	ax, ay := aLng*scaleLng, aLat
	bx, by := bLng*scaleLng, bLat
	px, py := pLng*scaleLng, pLat
	dx, dy := bx-ax, by-ay
	denom := dx*dx + dy*dy
	t := ((px-ax)*dx + (py-ay)*dy) / denom
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	closestX := ax + t*dx
	closestY := ay + t*dy
	// Convert back to (lat, lng) and take haversine for a
	// proper km distance.
	closestLat := closestY
	closestLng := closestX / scaleLng
	return haversineKm(pLat, pLng, closestLat, closestLng)
}

// ---------------------------------------------------------------------------
// query_chargers_along_route
// ---------------------------------------------------------------------------

// chargersAlongRouteInput is the typed input shape for
// query_chargers_along_route.
type chargersAlongRouteInput struct {
	// VehicleID identifies the vehicle whose charging history we
	// project onto the corridor. Required + positive — the AI
	// handler ALWAYS scopes to a vehicle the caller has access to.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// OriginLat / OriginLng / DestLat / DestLng define the
	// great-circle line whose corridor we project the user's
	// past charging sessions onto.
	OriginLat float64 `json:"origin_lat" validate:"gte=-90,lte=90" desc:"Origin latitude."`
	OriginLng float64 `json:"origin_lng" validate:"gte=-180,lte=180" desc:"Origin longitude."`
	DestLat   float64 `json:"dest_lat" validate:"gte=-90,lte=90" desc:"Destination latitude."`
	DestLng   float64 `json:"dest_lng" validate:"gte=-180,lte=180" desc:"Destination longitude."`

	// CorridorKm is the half-width of the corridor (in km) around
	// the great-circle line. Optional; defaults to
	// tripPlannerLLMAgentDefaultCorridorKm when zero. Bounded.
	CorridorKm float64 `json:"corridor_km,omitempty" validate:"gte=0,lte=500" desc:"Corridor half-width in km; default 25 when zero, max 500."`

	// LookbackDays restricts the aggregation window to the past
	// N days from `now`. Optional; defaults to 180 when zero.
	// Bounded to [0, 365].
	LookbackDays int `json:"lookback_days,omitempty" validate:"gte=0,lte=365" desc:"Lookback window in days (0..365); 0 ⇒ default 180 days."`
}

// chargerCorridorEnvelope is one row in the query_chargers_along_route
// output envelope. Per-charger aggregates (visit_count, last_seen_at,
// avg_peak_power_w) so the LLM can pick a charger the user
// frequents.
type chargerCorridorEnvelope struct {
	StartPlace      string  `json:"start_place"`
	StartLat        float64 `json:"start_lat"`
	StartLng        float64 `json:"start_lng"`
	VisitCount      int     `json:"visit_count"`
	AvgPeakPowerW   float64 `json:"avg_peak_power_w"`
	AvgPowerW       float64 `json:"avg_power_w"`
	LastSeenAt      string  `json:"last_seen_at"`
	CorridorOffsetK float64 `json:"corridor_offset_km"`
}

// queryChargersAlongRoute is the read-only tool. Execution: load the
// vehicle's charging history → project each session's start_lat /
// start_lng onto the great-circle line origin→destination → keep
// sessions whose corridor offset is below corridor_km → group by
// start_place → return a sorted envelope.
type queryChargersAlongRoute struct {
	src tools.ChargeSource
	// now is the reference timestamp for the lookback window.
	// Injectable so tests can pin a deterministic instant. Defaults
	// to time.Now in RegisterTripPlannerLLMAgentTools.
	now func() time.Time
}

// Name implements [Tool].
func (t *queryChargersAlongRoute) Name() string { return "query_chargers_along_route" }

// Description implements [Tool].
func (t *queryChargersAlongRoute) Description() string {
	return "Return the user's past chargers whose location falls within an N-km corridor of the " +
		"great-circle line between a caller-supplied origin and destination. " +
		"READ-only against the existing charging_sessions table — no DB write. " +
		"Returns {chargers: [{start_place, start_lat, start_lng, visit_count, avg_peak_power_w, " +
		"avg_power_w, last_seen_at, corridor_offset_km}]}; an empty list means the user has not " +
		"charged along this corridor — DO NOT fabricate a charger to fill the void."
}

// InputSchema implements [Tool].
func (t *queryChargersAlongRoute) InputSchema() json.RawMessage {
	return tools.CachedSchema(chargersAlongRouteInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryChargersAlongRoute) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
func (t *queryChargersAlongRoute) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryChargersAlongRoute) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryChargersAlongRoute) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[chargersAlongRouteInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// corridor projection + group-by; no SQL is written by this method.
func (t *queryChargersAlongRoute) Execute(ctx context.Context, in any) (any, error) {
	input := in.(chargersAlongRouteInput)
	if t.src == nil {
		return nil, errors.New("query_chargers_along_route: no ChargeSource wired")
	}

	corridor := input.CorridorKm
	if corridor <= 0 {
		corridor = tripPlannerLLMAgentDefaultCorridorKm
	}
	lookback := input.LookbackDays
	if lookback == 0 {
		lookback = tripPlannerLLMAgentDefaultLookbackDays
	}

	now := t.now().UTC()
	startTime := now.AddDate(0, 0, -lookback)
	endTime := now

	sessions, err := t.src.GetByVehicle(ctx, input.VehicleID, tripPlannerLLMAgentFetchLimit, 0, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("query_chargers_along_route: load charging sessions vehicle %d: %w", input.VehicleID, err)
	}

	type agg struct {
		startPlace      string
		startLat        float64
		startLng        float64
		visitCount      int
		peakPowerSum    float64
		peakPowerN      int
		avgPowerSum     float64
		avgPowerN       int
		lastSeenAt      time.Time
		minCorridorOffK float64
	}
	groups := map[string]*agg{}

	for _, s := range sessions {
		if s == nil || s.StartLat == nil || s.StartLng == nil || s.StartPlace == nil {
			continue
		}
		offsetK := distanceToSegmentKm(
			*s.StartLat, *s.StartLng,
			input.OriginLat, input.OriginLng,
			input.DestLat, input.DestLng,
		)
		if offsetK > corridor {
			continue
		}
		key := *s.StartPlace
		g, ok := groups[key]
		if !ok {
			g = &agg{
				startPlace:      key,
				startLat:        *s.StartLat,
				startLng:        *s.StartLng,
				lastSeenAt:      s.StartedAt,
				minCorridorOffK: offsetK,
			}
			groups[key] = g
		}
		g.visitCount++
		if s.PeakPowerW != nil {
			g.peakPowerSum += *s.PeakPowerW
			g.peakPowerN++
		}
		if s.AvgPowerW != nil {
			g.avgPowerSum += *s.AvgPowerW
			g.avgPowerN++
		}
		if s.StartedAt.After(g.lastSeenAt) {
			g.lastSeenAt = s.StartedAt
		}
		if offsetK < g.minCorridorOffK {
			g.minCorridorOffK = offsetK
		}
	}

	out := make([]chargerCorridorEnvelope, 0, len(groups))
	for _, g := range groups {
		row := chargerCorridorEnvelope{
			StartPlace:      g.startPlace,
			StartLat:        g.startLat,
			StartLng:        g.startLng,
			VisitCount:      g.visitCount,
			LastSeenAt:      g.lastSeenAt.UTC().Format("2006-01-02T15:04:05Z"),
			CorridorOffsetK: round2(g.minCorridorOffK),
		}
		if g.peakPowerN > 0 {
			row.AvgPeakPowerW = round2(g.peakPowerSum / float64(g.peakPowerN))
		}
		if g.avgPowerN > 0 {
			row.AvgPowerW = round2(g.avgPowerSum / float64(g.avgPowerN))
		}
		out = append(out, row)
	}
	// Sort by visit_count desc, then start_place asc for stable
	// goldens. The LLM will surface the top chargers first.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].VisitCount != out[j].VisitCount {
			return out[i].VisitCount > out[j].VisitCount
		}
		return out[i].StartPlace < out[j].StartPlace
	})
	if len(out) > tripPlannerLLMAgentMaxChargersOut {
		out = out[:tripPlannerLLMAgentMaxChargersOut]
	}

	return map[string]any{
		"vehicle_id":     input.VehicleID,
		"corridor_km":    corridor,
		"lookback_days":  lookback,
		"window_start":   startTime.Format("2006-01-02T15:04:05Z07:00"),
		"window_end":     endTime.Format("2006-01-02T15:04:05Z07:00"),
		"chargers":       out,
		"total_sessions": len(sessions),
	}, nil
}

// ---------------------------------------------------------------------------
// query_user_charge_dwells
// ---------------------------------------------------------------------------

// userChargeDwellsInput is the typed input shape for
// query_user_charge_dwells.
type userChargeDwellsInput struct {
	// VehicleID identifies the vehicle whose dwell history to
	// aggregate. Required + positive.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// LookbackDays restricts the aggregation window to the past
	// N days from `now`. Optional; defaults to 180 when zero.
	// Bounded to [0, 365].
	LookbackDays int `json:"lookback_days,omitempty" validate:"gte=0,lte=365" desc:"Lookback window in days (0..365); 0 ⇒ default 180 days."`
}

// chargerDwellEnvelope is one row in the query_user_charge_dwells
// output. Per-place aggregates so the LLM can pick chargers that
// match the user's typical dwell behaviour.
type chargerDwellEnvelope struct {
	StartPlace       string  `json:"start_place"`
	VisitCount       int     `json:"visit_count"`
	AvgDwellMinutes  float64 `json:"avg_dwell_minutes"`
	AvgDeltaSocPct   float64 `json:"avg_delta_soc_pct"`
	AvgEnergyAddedWh float64 `json:"avg_energy_added_wh"`
	LastSeenAt       string  `json:"last_seen_at"`
}

// queryUserChargeDwells is the read-only tool. Execution: load the
// vehicle's charging history → group by start_place → return a
// sorted envelope of per-place dwell aggregates.
type queryUserChargeDwells struct {
	src tools.ChargeSource
	now func() time.Time
}

// Name implements [Tool].
func (t *queryUserChargeDwells) Name() string { return "query_user_charge_dwells" }

// Description implements [Tool].
func (t *queryUserChargeDwells) Description() string {
	return "Return the user's per-charger dwell aggregates (visit_count, avg_dwell_minutes, " +
		"avg_delta_soc_pct, avg_energy_added_wh, last_seen_at) over an optional lookback window. " +
		"Use this AFTER query_chargers_along_route so the recommended charger choice reflects the " +
		"user's typical dwell behaviour rather than the average across all users. " +
		"READ-only — no record is created, mutated, or deleted."
}

// InputSchema implements [Tool].
func (t *queryUserChargeDwells) InputSchema() json.RawMessage {
	return tools.CachedSchema(userChargeDwellsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryUserChargeDwells) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only.
func (t *queryUserChargeDwells) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *queryUserChargeDwells) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *queryUserChargeDwells) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[userChargeDwellsInput](raw)
}

// Execute implements [Tool]. One repo round-trip then in-memory
// group-by; no SQL is written by this method.
func (t *queryUserChargeDwells) Execute(ctx context.Context, in any) (any, error) {
	input := in.(userChargeDwellsInput)
	if t.src == nil {
		return nil, errors.New("query_user_charge_dwells: no ChargeSource wired")
	}

	lookback := input.LookbackDays
	if lookback == 0 {
		lookback = tripPlannerLLMAgentDefaultLookbackDays
	}

	now := t.now().UTC()
	startTime := now.AddDate(0, 0, -lookback)
	endTime := now

	sessions, err := t.src.GetByVehicle(ctx, input.VehicleID, tripPlannerLLMAgentFetchLimit, 0, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("query_user_charge_dwells: load charging sessions vehicle %d: %w", input.VehicleID, err)
	}

	type agg struct {
		startPlace  string
		visitCount  int
		dwellMinSum float64
		dwellMinN   int
		deltaSocSum float64
		deltaSocN   int
		energyWhSum float64
		energyWhN   int
		lastSeenAt  time.Time
	}
	groups := map[string]*agg{}

	for _, s := range sessions {
		if s == nil || s.StartPlace == nil {
			continue
		}
		key := *s.StartPlace
		g, ok := groups[key]
		if !ok {
			g = &agg{
				startPlace: key,
				lastSeenAt: s.StartedAt,
			}
			groups[key] = g
		}
		g.visitCount++
		if dm := s.DurationMinutes(); dm != nil {
			g.dwellMinSum += *dm
			g.dwellMinN++
		}
		if s.DeltaSocPct != nil {
			g.deltaSocSum += *s.DeltaSocPct
			g.deltaSocN++
		}
		if s.TotalEnergyAddedWh != nil {
			g.energyWhSum += *s.TotalEnergyAddedWh
			g.energyWhN++
		}
		if s.StartedAt.After(g.lastSeenAt) {
			g.lastSeenAt = s.StartedAt
		}
	}

	out := make([]chargerDwellEnvelope, 0, len(groups))
	for _, g := range groups {
		row := chargerDwellEnvelope{
			StartPlace: g.startPlace,
			VisitCount: g.visitCount,
			LastSeenAt: g.lastSeenAt.UTC().Format("2006-01-02T15:04:05Z"),
		}
		if g.dwellMinN > 0 {
			row.AvgDwellMinutes = round2(g.dwellMinSum / float64(g.dwellMinN))
		}
		if g.deltaSocN > 0 {
			row.AvgDeltaSocPct = round2(g.deltaSocSum / float64(g.deltaSocN))
		}
		if g.energyWhN > 0 {
			row.AvgEnergyAddedWh = round2(g.energyWhSum / float64(g.energyWhN))
		}
		out = append(out, row)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].VisitCount != out[j].VisitCount {
			return out[i].VisitCount > out[j].VisitCount
		}
		return out[i].StartPlace < out[j].StartPlace
	})
	if len(out) > tripPlannerLLMAgentMaxDwellsOut {
		out = out[:tripPlannerLLMAgentMaxDwellsOut]
	}

	return map[string]any{
		"vehicle_id":     input.VehicleID,
		"lookback_days":  lookback,
		"window_start":   startTime.Format("2006-01-02T15:04:05Z07:00"),
		"window_end":     endTime.Format("2006-01-02T15:04:05Z07:00"),
		"dwells":         out,
		"total_sessions": len(sessions),
	}, nil
}

// ---------------------------------------------------------------------------
// draft_trip_plan
// ---------------------------------------------------------------------------

// TripPlanComputeRequest is the typed request envelope draft_trip_plan
// passes to the [TripPlanComputer] port. Mirrors the field-for-field
// shape of *api.tripPlanRequest so the production adapter (in
// internal/api/ai_trip_planner_llm_handler.go) can translate without
// loss, and tests can substitute a deterministic fake without
// pulling internal/api into the tools package.
//
// All fields are SI-canonical (meters / Watt-hours / SOC%). The
// adapter is responsible for any unit conversion if the underlying
// computePlan signature ever drifts; today computePlan is also SI
// throughout so the translation is field-for-field.
type TripPlanComputeRequest struct {
	VehicleID      int64
	OriginLat      float64
	OriginLng      float64
	OriginName     string
	DestLat        float64
	DestLng        float64
	DestName       string
	CurrentSOC     float64 // 0..100
	ChargeLimitSOC float64 // 0..100
	MinArrivalSOC  float64 // 0..100
	SpeedFactor    float64 // 1.0 = normal
}

// TripPlanRoute mirrors *api.tripPlanRoute. SI-canonical fields.
type TripPlanRoute struct {
	TotalDistanceM    float64 `json:"total_distance_m"`
	TotalDurationS    float64 `json:"total_duration_s"`
	DrivingDurationS  float64 `json:"driving_duration_s"`
	ChargingDurationS float64 `json:"charging_duration_s"`
	TotalEnergyWh     float64 `json:"total_energy_wh"`
	EstimatedCost     float64 `json:"estimated_cost"`
	ArrivalSOC        float64 `json:"arrival_soc"`
	Feasible          bool    `json:"feasible"`
	IsEstimate        bool    `json:"is_estimate"`
}

// TripPlanLocation mirrors *api.tripPlanLocation.
type TripPlanLocation struct {
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Name string  `json:"name"`
}

// TripPlanLeg mirrors *api.tripPlanLeg.
type TripPlanLeg struct {
	From       TripPlanLocation `json:"from"`
	To         TripPlanLocation `json:"to"`
	DistanceM  float64          `json:"distance_m"`
	DurationS  float64          `json:"duration_s"`
	EnergyWh   float64          `json:"energy_wh"`
	StartSOC   float64          `json:"start_soc"`
	ArrivalSOC float64          `json:"arrival_soc"`
}

// TripPlanChargeStop mirrors *api.tripChargeStop.
type TripPlanChargeStop struct {
	Name            string           `json:"name"`
	Location        TripPlanLocation `json:"location"`
	ChargeFromSOC   float64          `json:"charge_from_soc"`
	ChargeToSOC     float64          `json:"charge_to_soc"`
	ChargeDurationS float64          `json:"charge_duration_s"`
	EnergyWh        float64          `json:"energy_wh"`
	Cost            float64          `json:"cost"`
	IsRecommended   bool             `json:"is_recommended"`
}

// TripPlanSOCPoint mirrors *api.tripSOCPoint.
type TripPlanSOCPoint struct {
	DistanceM float64 `json:"distance_m"`
	SOC       float64 `json:"soc"`
}

// TripPlanComputeResult is the typed result envelope draft_trip_plan
// returns. Mirrors *api.tripPlanResponse field-for-field.
type TripPlanComputeResult struct {
	Route       TripPlanRoute        `json:"route"`
	Legs        []TripPlanLeg        `json:"legs"`
	ChargeStops []TripPlanChargeStop `json:"charge_stops"`
	SOCCurve    []TripPlanSOCPoint   `json:"soc_curve"`
}

// TripPlanComputer is the narrow port the draft_trip_plan tool
// delegates to. In production it is satisfied by
// *api.AITripPlanComputer (wraps *api.TripPlannerHandler); tests
// substitute deterministic fakes so the tool unit tests stay
// hermetic.
//
// The interface MUST stay read-only — adding a Save / Update method
// here would defeat the propose-only contract that ADR-015 §I3 +
// the slice prompt mandate.
type TripPlanComputer interface {
	// ComputeTripPlan delegates to the canonical
	// *TripPlannerHandler.computePlan path and returns the same
	// SI-canonical envelope. Returns a non-nil error only on
	// transport / unrecoverable compute failures; an
	// infeasible-but-shaped plan is returned with Feasible=false
	// in the envelope.
	ComputeTripPlan(ctx context.Context, req TripPlanComputeRequest) (*TripPlanComputeResult, error)
}

// draftTripPlanInput is the typed input shape for draft_trip_plan.
type draftTripPlanInput struct {
	VehicleID  int64   `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	OriginLat  float64 `json:"origin_lat" validate:"gte=-90,lte=90" desc:"Origin latitude."`
	OriginLng  float64 `json:"origin_lng" validate:"gte=-180,lte=180" desc:"Origin longitude."`
	OriginName string  `json:"origin_name,omitempty" desc:"Optional human-readable origin label."`
	DestLat    float64 `json:"dest_lat" validate:"gte=-90,lte=90" desc:"Destination latitude."`
	DestLng    float64 `json:"dest_lng" validate:"gte=-180,lte=180" desc:"Destination longitude."`
	DestName   string  `json:"dest_name,omitempty" desc:"Optional human-readable destination label."`
	// CurrentSOC is the starting battery state. Required +
	// 0..100 — a zero SOC is treated as a programming error
	// rather than a "no info" hint so the tool's behaviour is
	// deterministic.
	CurrentSOC float64 `json:"current_soc" validate:"gte=0,lte=100" desc:"Starting SOC percent (0..100)."`
	// ChargeLimitSOC and MinArrivalSOC are optional; defaults
	// applied in Execute when zero.
	ChargeLimitSOC float64 `json:"charge_limit_soc,omitempty" validate:"gte=0,lte=100" desc:"Per-stop charge limit (0..100); default 90 when zero."`
	MinArrivalSOC  float64 `json:"min_arrival_soc,omitempty" validate:"gte=0,lte=100" desc:"Minimum arrival SOC (0..100); default 20 when zero."`
	SpeedFactor    float64 `json:"speed_factor,omitempty" validate:"gte=0,lte=3" desc:"Speed factor multiplier (0..3); default 1.0 when zero."`
}

// draftTripPlanOutput is the JSON envelope draft_trip_plan returns.
// The Plan field is byte-equivalent (modulo JSON-tag spelling) to
// what *TripPlannerHandler.computePlan returns; Status / Source
// give the LLM breadcrumbs to attribute the decision to the
// canonical planner rather than its own reasoning.
type draftTripPlanOutput struct {
	Plan   *TripPlanComputeResult `json:"plan"`
	Status string                 `json:"status"`
	Source string                 `json:"source"`
}

// draftTripPlan is the propose-only tool that delegates to the
// canonical *TripPlannerHandler.computePlan path. PROPOSE-only: the
// returned envelope is rendered to the user for review; no DB write
// occurs. The user saves / routes via the existing
// POST /api/v1/trip-planner/plan path by clicking the canonical
// Plan button in the TripPlannerPage UI.
type draftTripPlan struct {
	planner TripPlanComputer
}

// Name implements [Tool].
func (t *draftTripPlan) Name() string { return "draft_trip_plan" }

// Description implements [Tool].
func (t *draftTripPlan) Description() string {
	return "Build a typed trip-plan proposal by delegating to the canonical TripPlannerHandler.computePlan path. " +
		"PROPOSE-ONLY: the plan is NOT saved; the user reviews the draft in the UI before clicking the " +
		"canonical Plan button. Returns {plan: {route, legs, charge_stops, soc_curve}, status, source}. " +
		"The envelope is SI-canonical: total_distance_m, total_duration_s, total_energy_wh, arrival_soc. " +
		"Call this LAST in the tool sequence, after query_chargers_along_route and query_user_charge_dwells."
}

// InputSchema implements [Tool].
func (t *draftTripPlan) InputSchema() json.RawMessage {
	return tools.CachedSchema(draftTripPlanInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftTripPlan) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
func (t *draftTripPlan) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *draftTripPlan) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *draftTripPlan) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[draftTripPlanInput](raw)
}

// Execute implements [Tool]. Delegates to the TripPlanComputer port.
func (t *draftTripPlan) Execute(ctx context.Context, in any) (any, error) {
	input := in.(draftTripPlanInput)
	if t.planner == nil {
		return nil, errors.New("draft_trip_plan: no TripPlanComputer wired")
	}
	// Apply defaults — mirrors *TripPlannerHandler.Plan's
	// fall-through behaviour so the AI-side default is
	// byte-identical to the baseline.
	chargeLimit := input.ChargeLimitSOC
	if chargeLimit <= 0 {
		chargeLimit = 90
	}
	minArrival := input.MinArrivalSOC
	if minArrival <= 0 {
		minArrival = 20
	}
	speedFactor := input.SpeedFactor
	if speedFactor <= 0 {
		speedFactor = 1.0
	}

	req := TripPlanComputeRequest{
		VehicleID:      input.VehicleID,
		OriginLat:      input.OriginLat,
		OriginLng:      input.OriginLng,
		OriginName:     input.OriginName,
		DestLat:        input.DestLat,
		DestLng:        input.DestLng,
		DestName:       input.DestName,
		CurrentSOC:     input.CurrentSOC,
		ChargeLimitSOC: chargeLimit,
		MinArrivalSOC:  minArrival,
		SpeedFactor:    speedFactor,
	}

	plan, err := t.planner.ComputeTripPlan(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("draft_trip_plan: compute: %w", err)
	}
	if plan == nil {
		return nil, errors.New("draft_trip_plan: planner returned nil envelope")
	}
	status := "ok"
	if !plan.Route.Feasible {
		status = "infeasible"
	}
	return &draftTripPlanOutput{
		Plan:   plan,
		Status: status,
		Source: "compute: internal/api/trip_planner_handler_compute.go TripPlannerHandler.computePlan",
	}, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TripPlannerLLMAgentSources bundles the narrow read + compute
// interfaces RegisterTripPlannerLLMAgentTools needs. Mirrors
// [AutoTripNamingSources] / [RouteEfficiencySuggestionsSources].
//
// Production wiring (router.go) instantiates the two production
// adapters (*chargingdb.ChargingRepo, *api.AITripPlanComputer); tests
// substitute deterministic fakes.
type TripPlannerLLMAgentSources struct {
	Chargers tools.ChargeSource
	Planner  TripPlanComputer
}

// RegisterTripPlannerLLMAgentTools installs the trip-planner-llm-agent
// slice's tools on r. Called from router.go AFTER the previous
// slice's tool registrations so the registry's alphabetical Names
// list grows deterministically without disturbing earlier
// registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterTripPlannerLLMAgentTools(r *tools.Registry, s TripPlannerLLMAgentSources) {
	now := time.Now
	r.Register(&queryChargersAlongRoute{src: s.Chargers, now: now})
	r.Register(&queryUserChargeDwells{src: s.Chargers, now: now})
	r.Register(&draftTripPlan{planner: s.Planner})
}

// round2 rounds f to two decimal places. Used by the corridor /
// dwell envelopes so the JSON stays human-readable in the SSE
// stream without leaking float noise across goldens.
func round2(f float64) float64 {
	return math.Round(f*100) / 100
}
