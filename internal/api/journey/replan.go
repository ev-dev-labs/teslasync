package journey

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Deviation thresholds in SI meters, measured as cross-track distance
// from the straight origin→destination corridor (the documented proxy
// until turn-by-turn legs exist). GPS noise is ~10 m and a highway
// corridor is a few hundred meters wide, so 2 km means a deliberate
// detour has started and 10 km means the plan no longer applies.
const (
	driftM    = 2000
	offRouteM = 10000
)

// Deviation verdicts.
const (
	DeviationOnTrack  = "on_track"
	DeviationDrifted  = "drifted"
	DeviationOffRoute = "off_route"
	DeviationUnknown  = "unknown"
)

// Deviation is the pure assessment result.
type Deviation struct {
	DeviationM *float64 `json:"deviation_m"`
	Verdict    string   `json:"verdict"` // on_track, drifted, off_route, unknown
}

// Assessment is the GET response: deviation plus the fix it was
// measured from.
type Assessment struct {
	SessionID int64       `json:"session_id"`
	Deviation *Deviation  `json:"deviation"`
	Latest    *Checkpoint `json:"latest"`
	Evidence  []string    `json:"evidence"`
}

// AssessDeviation grades the latest fix against the straight-line
// corridor. Missing route coordinates or no fix degrades to unknown.
// Pure: no I/O, deterministic.
func AssessDeviation(oLat, oLng, dLat, dLng *float64, fix *Checkpoint) *Deviation {
	if oLat == nil || oLng == nil || dLat == nil || dLng == nil || fix == nil {
		return &Deviation{DeviationM: nil, Verdict: DeviationUnknown}
	}
	dev := corridorDeviationM(*oLat, *oLng, *dLat, *dLng, fix.Lat, fix.Lng)
	verdict := DeviationOnTrack
	switch {
	case dev >= offRouteM:
		verdict = DeviationOffRoute
	case dev >= driftM:
		verdict = DeviationDrifted
	}
	return &Deviation{DeviationM: &dev, Verdict: verdict}
}

// savedCandidates reads the rescorable inputs back from a saved plan:
// the candidate echo ScoreStops/Rescore persist plus the charge need.
// Arrivals are deliberately NOT echoed — a replan always predicts waits
// as of now. Pure: never errors, nil-ok on anything unusable.
func savedCandidates(raw json.RawMessage) (cands []Candidate, energyWh float64, ok bool) {
	var plan struct {
		Kind       string  `json:"kind"`
		EnergyWh   float64 `json:"energy_wh"`
		Candidates []struct {
			Site string  `json:"site"`
			Lat  float64 `json:"lat"`
			Lng  float64 `json:"lng"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(raw, &plan); err != nil {
		return nil, 0, false
	}
	if plan.Kind != "stop_scores" && plan.Kind != "replan" {
		return nil, 0, false
	}
	if plan.EnergyWh <= 0 || len(plan.Candidates) == 0 || len(plan.Candidates) > maxCandidates {
		return nil, 0, false
	}
	for _, c := range plan.Candidates {
		if c.Site == "" || c.Lat < -90 || c.Lat > 90 || c.Lng < -180 || c.Lng > 180 {
			return nil, 0, false
		}
		cands = append(cands, Candidate{Site: c.Site, Lat: c.Lat, Lng: c.Lng})
	}
	return cands, plan.EnergyWh, true
}

// latestScoredPlan picks the newest rescorable plan by version (not by
// slice order — stores are free to order either way).
func latestScoredPlan(plans []*PlanVersion) ([]Candidate, float64, bool) {
	best := -1
	for i, p := range plans {
		if _, _, ok := savedCandidates(p.Plan); ok && (best < 0 || p.Version > plans[best].Version) {
			best = i
		}
	}
	if best < 0 {
		return nil, 0, false
	}
	return savedCandidates(plans[best].Plan)
}

// ReplanHandler serves deviation assessment and one-click rescoring.
// Stateless beyond constructor inputs; safe for concurrent use.
type ReplanHandler struct {
	store   SessionStore
	trail   TrailStore
	signals SignalStore
	waits   WaitStore
	now     func() time.Time
}

// NewReplanHandler wires the handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewReplanHandler(store SessionStore, trail TrailStore, signals SignalStore, waits WaitStore) *ReplanHandler {
	if store == nil || trail == nil || signals == nil || waits == nil {
		panic("journey: nil dependency")
	}
	return &ReplanHandler{store: store, trail: trail, signals: signals, waits: waits, now: time.Now}
}

// Assess serves GET /journey/sessions/{id}/replan: how far the latest
// fix sits off the planned corridor and whether a rescore is advised.
func (h *ReplanHandler) Assess(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx := r.Context()
	session, err := h.store.Get(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "journey not found")
		return
	}
	latest, err := h.trail.LatestCheckpoint(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: latest checkpoint failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	dev := AssessDeviation(session.OriginLat, session.OriginLng, session.DestLat, session.DestLng, latest)
	httpx.WriteJSON(w, http.StatusOK, Assessment{
		SessionID: id, Deviation: dev, Latest: latest,
		Evidence: deviationEvidence(dev, latest),
	})
}

func deviationEvidence(dev *Deviation, latest *Checkpoint) []string {
	if latest == nil {
		return []string{"no fixes yet — check in to measure deviation"}
	}
	if dev.DeviationM == nil {
		return []string{"route coordinates missing — deviation unavailable"}
	}
	km := *dev.DeviationM / 1000
	out := []string{formatKm("off the straight-line corridor by ", km)}
	switch dev.Verdict {
	case DeviationOffRoute:
		out = append(out, "off route — rescore from the current position")
	case DeviationDrifted:
		out = append(out, "drifting — watch the next fix or rescore now")
	default:
		out = append(out, "on track — the saved plan still applies")
	}
	return out
}

func formatKm(prefix string, km float64) string {
	if km < 10 {
		return prefix + strconv.FormatFloat(km, 'f', 1, 64) + " km"
	}
	return prefix + strconv.FormatFloat(km, 'f', 0, 64) + " km"
}

type replanRequest struct {
	EnergyWh *float64 `json:"energy_wh"`
}

// Rescore serves POST /journey/sessions/{id}/replan: re-rank the saved
// candidate set from the latest fix with waits predicted as of now,
// then persist the ranking as a new plan version. Only live (active or
// paused) sessions replan; energy_wh overrides the saved charge need
// when positive.
func (h *ReplanHandler) Rescore(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req replanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.EnergyWh != nil && (*req.EnergyWh <= 0 || *req.EnergyWh > 200000) {
		httpx.WriteError(w, http.StatusBadRequest, "energy_wh must be within 0..200000")
		return
	}
	ctx := r.Context()
	session, err := h.store.Get(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read journey")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "journey not found")
		return
	}
	if session.Status != StatusActive && session.Status != StatusPaused {
		httpx.WriteError(w, http.StatusConflict, "replans need a live (active or paused) journey")
		return
	}
	if session.DestLat == nil || session.DestLng == nil {
		httpx.WriteError(w, http.StatusBadRequest, "journey needs destination coordinates to replan")
		return
	}
	latest, err := h.trail.LatestCheckpoint(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: latest checkpoint failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	if latest == nil {
		httpx.WriteError(w, http.StatusBadRequest, "check in first — a replan starts from the latest fix")
		return
	}
	plans, err := h.store.ListPlans(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: list plans failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read plans")
		return
	}
	cands, energyWh, ok := latestScoredPlan(plans)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "score stops first — a replan re-ranks the saved candidates")
		return
	}
	if req.EnergyWh != nil {
		energyWh = *req.EnergyWh
	}
	now := h.now().UTC()
	sigs := make([]Signals, len(cands))
	for i := range cands {
		cands[i].ArriveS = now.Unix()
		sig, err := gatherSiteSignals(ctx, h.signals, h.waits, cands[i].Site, now)
		if err != nil {
			log.Error().Err(err).Str("site", cands[i].Site).Msg("journey: signals failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read stop signals")
			return
		}
		sigs[i] = sig
	}
	stops := RankStops(latest.Lat, latest.Lng, *session.DestLat, *session.DestLng, energyWh, cands, sigs)
	plan, err := json.Marshal(map[string]any{
		"kind": "replan", "energy_wh": energyWh, "stops": stops,
		"candidates": candidateEcho(cands),
		"from":       map[string]any{"lat": latest.Lat, "lng": latest.Lng},
	})
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: plan encode failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	pv, err := h.store.SavePlan(ctx, id, plan, "replan from latest fix")
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			httpx.WriteError(w, http.StatusNotFound, "journey not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("journey: save plan failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	winner := ""
	if len(stops) > 0 {
		winner = stops[0].Site
	}
	httpx.WriteJSON(w, http.StatusOK, scoreResponse{
		SessionID: id, EnergyWh: energyWh, Stops: stops,
		Winner: winner, PlanVersion: pv.Version,
	})
}

// candidateEcho persists the rescorable inputs (site + coords only;
// arrivals are always "now" at replan time).
func candidateEcho(cands []Candidate) []map[string]any {
	out := make([]map[string]any, 0, len(cands))
	for _, c := range cands {
		out = append(out, map[string]any{"site": c.Site, "lat": c.Lat, "lng": c.Lng})
	}
	return out
}
