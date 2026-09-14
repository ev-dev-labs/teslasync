package journey

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Pace bounds in SI m/s. Below stopMS the car reads as parked (no
// ETA — a stopped car has none); above implausibleMS the fix pair is
// a GPS jump, not motion (~360 km/h).
const (
	stopMS        = 2.0
	implausibleMS = 100.0
)

// Arrival is the GET response: ETA from recent pace plus the charge
// advice for making the destination with buffer.
type Arrival struct {
	SessionID   int64      `json:"session_id"`
	DestName    string     `json:"dest_name"`
	LeftM       *float64   `json:"left_m"`
	PaceMS      *float64   `json:"pace_ms"`
	EtaAt       *time.Time `json:"eta_at"`
	Moving      bool       `json:"moving"`
	Verdict     string     `json:"verdict"` // ok, attention, action, unknown
	ShortfallWh *float64   `json:"shortfall_wh"`
	Evidence    []string   `json:"evidence"`
}

// PaceMS derives speed from two fixes. Odometer delta wins when both
// fixes carry one (road truth beats coordinates); otherwise the
// haversine gap over elapsed time. Zero/negative time, odometer
// rollback, and implausible speeds all read as no pace. Pure.
func PaceMS(older, newer *Checkpoint) (float64, bool) {
	if older == nil || newer == nil {
		return 0, false
	}
	dt := newer.RecordedAt.Sub(older.RecordedAt).Seconds()
	if dt <= 0 {
		return 0, false
	}
	dist := haversineM(older.Lat, older.Lng, newer.Lat, newer.Lng)
	if older.OdometerM != nil && newer.OdometerM != nil {
		if *newer.OdometerM < *older.OdometerM {
			return 0, false
		}
		dist = *newer.OdometerM - *older.OdometerM
	}
	pace := dist / dt
	if pace < 0 || pace > implausibleMS {
		return 0, false
	}
	return pace, true
}

// ArrivalETA projects arrival from distance left and pace. A stopped
// car (below stopMS) has no ETA — moving=false, eta nil. Pure.
func ArrivalETA(leftM, paceMS float64, now time.Time) (eta *time.Time, moving bool) {
	if paceMS < stopMS || leftM <= 0 {
		return nil, paceMS >= stopMS
	}
	t := now.Add(time.Duration(leftM / paceMS * float64(time.Second)))
	return &t, true
}

// ChargeAdvice grades destination energy (via ComputeRange, the single
// verdict source) and sizes the top-up that restores the buffer when
// short. Shortfall is nil when energy already covers need×buffer or
// when inputs are missing. Pure.
func ChargeAdvice(haveWh *float64, leftM float64, effWhKm *float64) (verdict string, shortfallWh *float64) {
	r := ComputeRange(haveWh, leftM, effWhKm)
	if r.Verdict == ItemOK || r.NeedWh == nil || haveWh == nil {
		return r.Verdict, nil
	}
	short := *r.NeedWh*rangeBuffer - *haveWh
	if short <= 0 {
		return r.Verdict, nil
	}
	return r.Verdict, &short
}

// ArrivalHandler serves arrival prep. Stateless beyond constructor
// inputs; safe for concurrent use.
type ArrivalHandler struct {
	store SessionStore
	trail TrailStore
	live  LiveSignals
	now   func() time.Time
}

// NewArrivalHandler wires the handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewArrivalHandler(store SessionStore, trail TrailStore, live LiveSignals) *ArrivalHandler {
	if store == nil || trail == nil || live == nil {
		panic("journey: nil dependency")
	}
	return &ArrivalHandler{store: store, trail: trail, live: live, now: time.Now}
}

// Prep serves GET /journey/sessions/{id}/arrival: ETA from recent pace
// plus the charge advice for the destination. Degrades honestly — no
// fixes, no pace, or no energy each narrow the answer instead of
// failing it.
func (h *ArrivalHandler) Prep(w http.ResponseWriter, r *http.Request) {
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
	now := h.now().UTC()
	latest, err := h.trail.LatestCheckpoint(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: latest checkpoint failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	progress := ComputeProgress(session.OriginLat, session.OriginLng, session.DestLat, session.DestLng, latest)
	pace, paceOK, err := h.pace(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: trail failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read trail")
		return
	}
	var left *float64
	if progress != nil {
		left = &progress.LeftM
	}
	var eta *time.Time
	moving := false
	if left != nil && paceOK {
		eta, moving = ArrivalETA(*left, pace, now)
	} else if paceOK {
		_, moving = ArrivalETA(1, pace, now)
	}
	verdict, shortfall, err := h.advice(ctx, session, left)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: arrival advice failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
		return
	}
	out := Arrival{
		SessionID: id, DestName: session.DestName, LeftM: left,
		EtaAt: eta, Moving: moving, Verdict: verdict, ShortfallWh: shortfall,
	}
	if paceOK {
		out.PaceMS = &pace
	}
	out.Evidence = arrivalEvidence(session, left, out.PaceMS, eta, moving, verdict, shortfall)
	httpx.WriteJSON(w, http.StatusOK, out)
}

// pace orders the two newest fixes by time (stores order either way)
// and derives speed. False when fewer than two fixes exist.
func (h *ArrivalHandler) pace(ctx context.Context, sessionID int64) (float64, bool, error) {
	pair, err := h.trail.Trail(ctx, sessionID, 2)
	if err != nil {
		return 0, false, err
	}
	if len(pair) < 2 {
		return 0, false, nil
	}
	older, newer := pair[0], pair[1]
	if newer.RecordedAt.Before(older.RecordedAt) {
		older, newer = newer, older
	}
	pace, ok := PaceMS(older, newer)
	return pace, ok, nil
}

func (h *ArrivalHandler) advice(ctx context.Context, session *Session, left *float64) (string, *float64, error) {
	if left == nil {
		return ItemUnknown, nil, nil
	}
	energyKWh, err := signalFloat(h.live, ctx, session.VehicleID, "EnergyRemaining")
	if err != nil {
		return "", nil, err
	}
	var haveWh *float64
	if energyKWh != nil {
		have := *energyKWh * 1000
		haveWh = &have
	}
	eff, ok, err := h.trail.VehicleEfficiency(ctx, session.VehicleID)
	if err != nil {
		return "", nil, err
	}
	var effPtr *float64
	if ok {
		effPtr = &eff
	}
	verdict, shortfall := ChargeAdvice(haveWh, *left, effPtr)
	return verdict, shortfall, nil
}

func arrivalEvidence(session *Session, left, pace *float64, eta *time.Time, moving bool, verdict string, shortfall *float64) []string {
	out := []string{}
	dest := session.DestName
	if dest == "" {
		dest = "the destination"
	}
	if left == nil {
		out = append(out, "route coordinates missing — distance to "+dest+" unavailable")
	} else {
		out = append(out, formatKm("", *left/1000)+" to "+dest)
	}
	switch {
	case pace == nil:
		out = append(out, "need two fixes to read pace")
	case !moving:
		out = append(out, "parked — ETA once moving")
	case eta != nil:
		out = append(out, "ETA "+eta.Format("15:04"))
	}
	switch verdict {
	case ItemOK:
		out = append(out, "arrive with buffer")
	case ItemAttention, ItemAction:
		if shortfall != nil {
			out = append(out, "top up ≈ "+strconv.FormatFloat(*shortfall/1000, 'f', 1, 64)+" kWh en route to hold the buffer")
		} else {
			out = append(out, "arrival energy tight — charge soon")
		}
	default:
		out = append(out, "arrival energy unknown: needs live energy + drive history")
	}
	return out
}
