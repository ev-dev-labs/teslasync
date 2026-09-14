package journey

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Live-view constants: the range buffer and the checkpoint future
// tolerance for clock-skewed companions.
const (
	rangeBuffer     = 1.15
	futureTolerance = 5 * time.Minute
)

// Progress is straight-line trip progress in SI meters. A documented
// proxy until committed turn-by-turn legs exist (replan engine).
type Progress struct {
	TotalM float64 `json:"total_m"`
	DoneM  float64 `json:"done_m"`
	LeftM  float64 `json:"left_m"`
}

// Range ties remaining energy to remaining distance.
type Range struct {
	HaveWh  *float64 `json:"have_wh"`
	NeedWh  *float64 `json:"need_wh"`
	EffWhKm *float64 `json:"eff_wh_km"`
	Verdict string   `json:"verdict"` // ok, attention, action, unknown
}

// NextStop is the head of the latest scored plan, if any.
type NextStop struct {
	Site  string   `json:"site"`
	WaitS *float64 `json:"wait_s"`
}

// LiveView is the glanceable GET response.
type LiveView struct {
	Session  *Session      `json:"session"`
	Latest   *Checkpoint   `json:"latest"`
	Trail    []*Checkpoint `json:"trail"`
	Progress *Progress     `json:"progress"`
	Range    *Range        `json:"range"`
	Next     *NextStop     `json:"next"`
	Evidence []string      `json:"evidence"`
}

// haversineM returns great-circle meters between two points.
func haversineM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthM = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	la1, ln1, la2, ln2 := toRad(lat1), toRad(lng1), toRad(lat2), toRad(lng2)
	h := math.Sin((la2-la1)/2)*math.Sin((la2-la1)/2) +
		math.Cos(la1)*math.Cos(la2)*math.Sin((ln2-ln1)/2)*math.Sin((ln2-ln1)/2)
	return 2 * earthM * math.Asin(math.Min(1, math.Sqrt(math.Max(0, h))))
}

// ComputeProgress derives straight-line progress. Without a fix the
// trip sits at the origin (nothing done); without route coords there
// is no progress at all. Pure: no I/O, deterministic.
func ComputeProgress(oLat, oLng, dLat, dLng *float64, cur *Checkpoint) *Progress {
	if oLat == nil || oLng == nil || dLat == nil || dLng == nil {
		return nil
	}
	total := haversineM(*oLat, *oLng, *dLat, *dLng)
	if cur == nil {
		return &Progress{TotalM: total, DoneM: 0, LeftM: total}
	}
	left := haversineM(cur.Lat, cur.Lng, *dLat, *dLng)
	done := math.Max(0, total-left)
	return &Progress{TotalM: total, DoneM: done, LeftM: left}
}

// ComputeRange grades remaining energy against remaining distance at
// the measured efficiency. Nil energy or efficiency degrades to
// unknown; the 15% buffer separates ok from attention. Pure.
func ComputeRange(haveWh *float64, leftM float64, effWhKm *float64) *Range {
	r := &Range{HaveWh: haveWh, EffWhKm: effWhKm, Verdict: ItemUnknown}
	if haveWh == nil || effWhKm == nil || *effWhKm <= 0 {
		return r
	}
	need := leftM / 1000 * *effWhKm
	r.NeedWh = &need
	switch {
	case *haveWh >= need*rangeBuffer:
		r.Verdict = ItemOK
	case *haveWh >= need:
		r.Verdict = ItemAttention
	default:
		r.Verdict = ItemAction
	}
	return r
}

// ParseNextStop reads the head stop from a saved plan payload. Only
// stop_scores and replan plans carry ranked stops; anything else
// yields nil. Pure: never errors, never panics on malformed JSON.
func ParseNextStop(raw json.RawMessage) *NextStop {
	var plan struct {
		Kind  string `json:"kind"`
		Stops []struct {
			Site  string   `json:"site"`
			WaitS *float64 `json:"wait_s"`
		} `json:"stops"`
	}
	if err := json.Unmarshal(raw, &plan); err != nil {
		return nil
	}
	if plan.Kind != "stop_scores" && plan.Kind != "replan" {
		return nil
	}
	if len(plan.Stops) == 0 || plan.Stops[0].Site == "" {
		return nil
	}
	return &NextStop{Site: plan.Stops[0].Site, WaitS: plan.Stops[0].WaitS}
}

// TrailStore is the checkpoint/efficiency port. *Store satisfies it.
type TrailStore interface {
	AppendCheckpoint(ctx context.Context, sessionID int64, in NewCheckpoint) (*Checkpoint, error)
	LatestCheckpoint(ctx context.Context, sessionID int64) (*Checkpoint, error)
	Trail(ctx context.Context, sessionID int64, limit int) ([]*Checkpoint, error)
	VehicleEfficiency(ctx context.Context, vehicleID int64) (float64, bool, error)
}

// LiveHandler serves the live trip session. Stateless beyond
// constructor inputs; safe for concurrent use.
type LiveHandler struct {
	store SessionStore
	trail TrailStore
	live  LiveSignals
	now   func() time.Time
}

// NewLiveHandler wires the handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewLiveHandler(store SessionStore, trail TrailStore, live LiveSignals) *LiveHandler {
	if store == nil || trail == nil || live == nil {
		panic("journey: nil dependency")
	}
	return &LiveHandler{store: store, trail: trail, live: live, now: time.Now}
}

type checkpointRequest struct {
	RecordedAt *time.Time `json:"recorded_at"`
	Lat        *float64   `json:"lat"`
	Lng        *float64   `json:"lng"`
	SocPct     *float64   `json:"soc_pct"`
	OdometerM  *float64   `json:"odometer_m"`
}

// Append serves POST /journey/sessions/{id}/checkpoints: snapshot one
// trail point. Missing fields backfill from live telemetry, so a bare
// ping still records the car; without either source the field stays
// null — except position, which is required. Only live (active or
// paused) sessions accept checkpoints.
func (h *LiveHandler) Append(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req checkpointRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	now := h.now().UTC()
	at := now
	if req.RecordedAt != nil {
		at = req.RecordedAt.UTC()
		if at.After(now.Add(futureTolerance)) {
			httpx.WriteError(w, http.StatusBadRequest, "recorded_at is too far in the future")
			return
		}
	}
	if req.SocPct != nil && (*req.SocPct < 0 || *req.SocPct > 100) {
		httpx.WriteError(w, http.StatusBadRequest, "soc_pct must be 0..100")
		return
	}
	if req.OdometerM != nil && *req.OdometerM < 0 {
		httpx.WriteError(w, http.StatusBadRequest, "odometer_m must be non-negative")
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
		httpx.WriteError(w, http.StatusConflict, "checkpoints need a live (active or paused) journey")
		return
	}
	lat, lng, soc, odo := req.Lat, req.Lng, req.SocPct, req.OdometerM
	backfill := func(dst **float64, name string) error {
		if *dst != nil {
			return nil
		}
		v, err := signalFloat(h.live, ctx, session.VehicleID, name)
		if err != nil {
			return err
		}
		*dst = v
		return nil
	}
	for _, b := range []struct {
		dst  **float64
		name string
	}{
		{&lat, "LocationLatitude"},
		{&lng, "LocationLongitude"},
		{&soc, "Soc"},
		{&odo, "Odometer"},
	} {
		if err := backfill(b.dst, b.name); err != nil {
			log.Error().Err(err).Int64("id", id).Msg("journey: checkpoint backfill failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
			return
		}
	}
	if lat == nil || lng == nil {
		httpx.WriteError(w, http.StatusBadRequest, "position required: post lat/lng or wake the vehicle")
		return
	}
	cp, err := h.trail.AppendCheckpoint(ctx, id, NewCheckpoint{
		RecordedAt: at, Lat: *lat, Lng: *lng, SocPct: soc, OdometerM: odo,
	})
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: append checkpoint failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save checkpoint")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, cp)
}

// View serves GET /journey/sessions/{id}/live: the glanceable live
// snapshot — session, latest fix, trail, progress, range, and the head
// of the latest scored plan.
func (h *LiveHandler) View(w http.ResponseWriter, r *http.Request) {
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
	trail, err := h.trail.Trail(ctx, id, 20)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: trail failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	progress := ComputeProgress(session.OriginLat, session.OriginLng, session.DestLat, session.DestLng, latest)
	rng, err := h.rangeFor(ctx, session, progress)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: range failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
		return
	}
	next, err := h.nextStop(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: next stop failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read plan")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, LiveView{
		Session: session, Latest: latest, Trail: trail,
		Progress: progress, Range: rng, Next: next,
		Evidence: liveEvidence(latest, progress, rng, next),
	})
}

func (h *LiveHandler) rangeFor(ctx context.Context, session *Session, progress *Progress) (*Range, error) {
	if progress == nil {
		return &Range{Verdict: ItemUnknown}, nil
	}
	// EnergyRemaining is current usable kWh; Soc × nominal is NOT used
	// as a substitute — a guess here would misgrade range.
	energyKWh, err := signalFloat(h.live, ctx, session.VehicleID, "EnergyRemaining")
	if err != nil {
		return nil, err
	}
	var haveWh *float64
	if energyKWh != nil {
		have := *energyKWh * 1000
		haveWh = &have
	}
	eff, ok, err := h.trail.VehicleEfficiency(ctx, session.VehicleID)
	if err != nil {
		return nil, err
	}
	var effPtr *float64
	if ok {
		effPtr = &eff
	}
	return ComputeRange(haveWh, progress.LeftM, effPtr), nil
}

func (h *LiveHandler) nextStop(ctx context.Context, sessionID int64) (*NextStop, error) {
	plans, err := h.store.ListPlans(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	// Newest ranked plan wins, by version — not slice order, which
	// stores are free to choose.
	var best *PlanVersion
	for _, p := range plans {
		if ParseNextStop(p.Plan) == nil {
			continue
		}
		if best == nil || p.Version > best.Version {
			best = p
		}
	}
	if best == nil {
		return nil, nil
	}
	return ParseNextStop(best.Plan), nil
}

func liveEvidence(latest *Checkpoint, progress *Progress, rng *Range, next *NextStop) []string {
	out := []string{}
	if latest == nil {
		out = append(out, "no fixes yet — check in to start the trail")
	} else {
		out = append(out, "last fix "+latest.RecordedAt.Format("15:04:05"))
	}
	if progress != nil && progress.TotalM > 0 {
		out = append(out, fmt.Sprintf("straight-line progress %.0f%%", progress.DoneM/max1(progress.TotalM)*100))
	} else {
		out = append(out, "route coordinates missing — progress unavailable")
	}
	switch rng.Verdict {
	case ItemOK:
		out = append(out, "energy covers the remainder with buffer")
	case ItemAttention:
		out = append(out, "energy covers the remainder without buffer")
	case ItemAction:
		out = append(out, "energy short of the remainder — charge soon")
	default:
		out = append(out, "range unknown: needs live energy + drive history")
	}
	if next != nil {
		out = append(out, "next stop "+next.Site)
	} else {
		out = append(out, "no scored plan — next stop unset")
	}
	return out
}

func max1(v float64) float64 {
	if v <= 0 {
		return 1
	}
	return v
}

// Compile-time port assertions.
var (
	_ TrailStore = (*Store)(nil)
)
