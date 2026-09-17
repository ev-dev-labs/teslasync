package journey

import (
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// Nudge window: the recommended slot reads as "now" from 15 minutes
// before (wheels-up prep) to 30 minutes after (still the same calm
// hour). Outside it the driver waits for the slot — or missed it, in
// which case the honest answer is still "go now".
const (
	nudgeEarly = 15 * time.Minute
	nudgeLate  = 30 * time.Minute
)

// Nudge verdicts.
const (
	NudgeLeaveNow = "leave_now"
	NudgeWait     = "wait"
	NudgeDelay    = "delay"
	NudgeUnknown  = "unknown"
)

// Nudge is the GET response: the departure verdict plus the blockers
// and slot behind it.
type Nudge struct {
	SessionID int64      `json:"session_id"`
	Verdict   string     `json:"verdict"` // leave_now, wait, delay, unknown
	SlotAt    *time.Time `json:"slot_at"`
	Blockers  []Item     `json:"blockers"`
	Evidence  []string   `json:"evidence"`
}

// NudgeVerdict folds the recommended calm slot and the readiness
// blockers into one verdict. Action-level blockers always win — a
// calm sky does not fix a flat. Attention-level items never block.
// Pure: no I/O, deterministic.
func NudgeVerdict(now time.Time, recommended *time.Time, blockers []Item) string {
	if len(blockers) > 0 {
		return NudgeWait
	}
	if recommended == nil {
		return NudgeDelay
	}
	if recommended.After(now.Add(nudgeLate)) {
		return NudgeWait
	}
	return NudgeLeaveNow
}

// Blockers filters a run to action-level items. Nil run yields an
// empty slice (JSON []), not nil — the UI reads blockers.length.
// No run is not a blocker; it is flagged separately in evidence so a
// fresh trip does not read as broken. Pure.
func Blockers(run *Run) []Item {
	out := []Item{}
	if run == nil {
		return out
	}
	for _, item := range run.Items {
		if item.Status == ItemAction {
			out = append(out, item)
		}
	}
	return out
}

// NudgeHandler serves the leave-now nudge. Stateless beyond
// constructor inputs; safe for concurrent use.
type NudgeHandler struct {
	store SessionStore
	meteo Meteo
	runs  RunStore
	now   func() time.Time
}

// NewNudgeHandler wires the handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewNudgeHandler(store SessionStore, meteo Meteo, runs RunStore) *NudgeHandler {
	if store == nil || meteo == nil || runs == nil {
		panic("journey: nil dependency")
	}
	return &NudgeHandler{store: store, meteo: meteo, runs: runs, now: time.Now}
}

// Monitor serves GET /journey/sessions/{id}/nudge: leave now, wait for
// the slot, or delay — from the calm-hour ranking plus the readiness
// blockers. Planned sessions only: once rolling, the live panels own
// the drive.
func (h *NudgeHandler) Monitor(w http.ResponseWriter, r *http.Request) {
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
	if session.Status != StatusPlanned {
		httpx.WriteError(w, http.StatusConflict, "the nudge is for planned journeys — this one is "+session.Status)
		return
	}
	now := h.now().UTC()
	run, err := h.runs.LatestChecklistRun(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: latest checklist failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read checklist")
		return
	}
	blockers := Blockers(run)
	var slot *time.Time
	if session.OriginLat != nil && session.OriginLng != nil {
		forecast, err := h.meteo.Fetch(ctx, *session.OriginLat, *session.OriginLng)
		if err != nil {
			log.Error().Err(err).Int64("id", id).Msg("journey: forecast fetch failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read forecast")
			return
		}
		_, slot = RankDepartureSlots(forecast, now, now.Add(defaultDepartureHorizon))
	}
	verdict := NudgeUnknown
	if session.OriginLat != nil && session.OriginLng != nil {
		verdict = NudgeVerdict(now, slot, blockers)
	}
	out := Nudge{SessionID: id, Verdict: verdict, SlotAt: slot, Blockers: blockers}
	out.Evidence = nudgeEvidence(now, slot, blockers, run == nil, session.OriginLat == nil)
	httpx.WriteJSON(w, http.StatusOK, out)
}

func nudgeEvidence(now time.Time, slot *time.Time, blockers []Item, noRun, noCoords bool) []string {
	out := []string{}
	if noCoords {
		out = append(out, "origin coordinates missing — no forecast to rank")
		return out
	}
	if len(blockers) > 0 {
		out = append(out, blockerLine(blockers))
	}
	if noRun {
		out = append(out, "no checklist run yet — blockers may hide")
	}
	switch {
	case slot == nil:
		out = append(out, "no calm hour in the next 12 h — delay")
	case slot.After(now.Add(nudgeLate)):
		out = append(out, "calm window opens "+slot.Format("Mon 15:04"))
	case slot.Before(now.Add(-nudgeEarly)):
		out = append(out, "calm slot passed — go now on the next calm hour")
	default:
		out = append(out, "in the calm window now")
	}
	return out
}

func blockerLine(blockers []Item) string {
	if len(blockers) == 1 {
		return "1 blocker: " + blockers[0].Detail
	}
	return strconv.Itoa(len(blockers)) + " blockers, starting with: " + blockers[0].Detail
}
