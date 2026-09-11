package fleetops

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

// DriverEvaluation is the GET /fleet-ops/drivers/{id}/evaluate response:
// allow/deny with per-guardrail reasons.
type DriverEvaluation struct {
	DriverID  int64    `json:"driver_id"`
	Allowed   bool     `json:"allowed"`
	Reasons   []string `json:"reasons"`
	ChargeCap *int16   `json:"charge_cap"`
	InCurfew  bool     `json:"in_curfew"`
	Evaluated string   `json:"evaluated_at"`
}

// EvaluateDriverGuardrails is the pure policy check: charge-target cap and
// curfew window (overnight wrap supported). A chargeSOC of 0 skips the cap
// check (the caller isn't proposing a charge target).
func EvaluateDriverGuardrails(d *models.FleetDriver, chargeSOC int, at time.Time) DriverEvaluation {
	ev := DriverEvaluation{
		DriverID:  d.ID,
		Allowed:   true,
		Reasons:   []string{},
		Evaluated: at.UTC().Format(time.RFC3339),
	}
	if d.Status != "active" {
		ev.Allowed = false
		ev.Reasons = append(ev.Reasons, "driver is not active")
	}
	if d.MaxChargeSOC != nil {
		ev.ChargeCap = d.MaxChargeSOC
		if chargeSOC > 0 && chargeSOC > int(*d.MaxChargeSOC) {
			ev.Allowed = false
			ev.Reasons = append(ev.Reasons, fmt.Sprintf(
				"charge target %d%% exceeds driver cap of %d%%", chargeSOC, *d.MaxChargeSOC))
		}
	}
	if d.CurfewStart != nil && d.CurfewEnd != nil {
		if inCurfew(*d.CurfewStart, *d.CurfewEnd, at) {
			ev.Allowed = false
			ev.InCurfew = true
			ev.Reasons = append(ev.Reasons, fmt.Sprintf(
				"inside curfew window %s–%s", *d.CurfewStart, *d.CurfewEnd))
		}
	}
	if ev.Allowed {
		ev.Reasons = append(ev.Reasons, "within driver policy")
	}
	return ev
}

// inCurfew reports whether at falls inside [start, end). When end <= start
// the window wraps overnight (e.g. 22:00–06:00).
func inCurfew(start, end string, at time.Time) bool {
	var sh, sm, eh, em int
	if _, err := fmt.Sscanf(start, "%d:%d", &sh, &sm); err != nil {
		return false
	}
	if _, err := fmt.Sscanf(end, "%d:%d", &eh, &em); err != nil {
		return false
	}
	cur := at.Hour()*60 + at.Minute()
	from, to := sh*60+sm, eh*60+em
	if to <= from {
		return cur >= from || cur < to
	}
	return cur >= from && cur < to
}

// EvaluateDriver serves GET /fleet-ops/drivers/{id}/evaluate?charge_soc=&at=.
// at is an optional RFC3339 instant (defaults to now) so fleet managers can
// test a future departure against the curfew.
func (h *Handler) EvaluateDriver(w http.ResponseWriter, r *http.Request) {
	ctx, span := startHandlerSpan(r, "drivers.evaluate")
	defer span.End()

	id, ok := pathID(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	chargeSOC := 0
	if s := q.Get("charge_soc"); s != "" {
		v, err := strconv.Atoi(s)
		if err != nil || v < 0 || v > 100 {
			httpx.WriteError(w, http.StatusBadRequest, "charge_soc must be 0..100")
			return
		}
		chargeSOC = v
	}
	at := time.Now().UTC()
	if s := q.Get("at"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "at must be RFC3339")
			return
		}
		at = t
	}

	d, err := h.service.GetDriver(ctx, id)
	if err != nil {
		writeHandlerError(ctx, span, w, "drivers.evaluate", err)
		return
	}
	if d == nil {
		writeNotFound(w, "driver")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, EvaluateDriverGuardrails(d, chargeSOC, at))
}
