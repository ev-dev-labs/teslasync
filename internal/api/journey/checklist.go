package journey

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/api/stormguard"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// Checklist item statuses.
const (
	ItemOK        = "ok"
	ItemAttention = "attention"
	ItemAction    = "action"
	ItemUnknown   = "unknown"
)

// Checklist item keys.
const (
	KeyChargeLevel    = "charge_level"
	KeyChargeLimit    = "charge_limit"
	KeyTirePressure   = "tire_pressure"
	KeyStorm          = "storm"
	KeySoftwareUpdate = "software_update"
)

// Evaluation thresholds. Charge targets follow the trip-ready
// convention (leave at 80%+ with headroom to charge there); tire
// pressures follow the Tesla placard of 42 PSI ≈ 2.9 bar.
const (
	tripReadySoc   = 80.0
	tripLowSoc     = 60.0
	tripReadyLimit = 85.0
	tripLowLimit   = 80.0
	placardBar     = 2.9
	lowTireBar     = 2.7
	stormRecency   = 6 * time.Hour
	tireCorners    = 4
)

// Item is one evaluated checklist row.
type Item struct {
	Key    string `json:"key"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// Inputs are the evaluated signals. Nil means never reported — the
// item degrades to unknown rather than guessing.
type Inputs struct {
	Soc      *float64
	Limit    *float64
	TiresBar [tireCorners]*float64 // FL, FR, RL, RR in bar
	Storm    *stormguard.Event
	Update   *vehiclemodel.SoftwareUpdate
}

// EvaluateChecklist grades trip readiness. Pure: no I/O,
// deterministic. Always returns all five items in key order.
func EvaluateChecklist(in Inputs, now time.Time) []Item {
	return []Item{
		chargeLevelItem(in.Soc),
		chargeLimitItem(in.Limit),
		tireItem(in.TiresBar),
		stormItem(in.Storm, now),
		updateItem(in.Update),
	}
}

func chargeLevelItem(soc *float64) Item {
	if soc == nil {
		return Item{KeyChargeLevel, ItemUnknown, "battery level never reported — wake the vehicle"}
	}
	detail := fmt.Sprintf("%.0f%% (trip-ready is %.0f%%+)", *soc, tripReadySoc)
	switch {
	case *soc >= tripReadySoc:
		return Item{KeyChargeLevel, ItemOK, detail}
	case *soc >= tripLowSoc:
		return Item{KeyChargeLevel, ItemAttention, detail}
	default:
		return Item{KeyChargeLevel, ItemAction, detail}
	}
}

func chargeLimitItem(limit *float64) Item {
	if limit == nil {
		return Item{KeyChargeLimit, ItemUnknown, "charge limit never reported — wake the vehicle"}
	}
	detail := fmt.Sprintf("limit %.0f%% (raise to %.0f%%+ for trips)", *limit, tripReadyLimit)
	switch {
	case *limit >= tripReadyLimit:
		return Item{KeyChargeLimit, ItemOK, detail}
	case *limit >= tripLowLimit:
		return Item{KeyChargeLimit, ItemAttention, detail}
	default:
		return Item{KeyChargeLimit, ItemAction, detail}
	}
}

func tireItem(tires [tireCorners]*float64) Item {
	names := [tireCorners]string{"FL", "FR", "RL", "RR"}
	low, lowName := 0.0, ""
	seen := 0
	for i, t := range tires {
		if t == nil {
			continue
		}
		seen++
		if lowName == "" || *t < low {
			low, lowName = *t, names[i]
		}
	}
	if seen == 0 {
		return Item{KeyTirePressure, ItemUnknown, "no tire reports — drive to wake the sensors"}
	}
	detail := fmt.Sprintf("lowest %s at %.1f bar (placard %.1f)", lowName, low, placardBar)
	switch {
	case low >= placardBar:
		return Item{KeyTirePressure, ItemOK, detail}
	case low >= lowTireBar:
		return Item{KeyTirePressure, ItemAttention, detail}
	default:
		return Item{KeyTirePressure, ItemAction, detail}
	}
}

func stormItem(ev *stormguard.Event, now time.Time) Item {
	if ev == nil || ev.Level == stormguard.LevelNone || now.Sub(ev.CreatedAt) > stormRecency {
		return Item{KeyStorm, ItemOK, "no severe weather on record"}
	}
	detail := fmt.Sprintf("%s %s ago: %s", ev.Level, ago(now.Sub(ev.CreatedAt)), ev.Reason)
	if ev.Level == stormguard.LevelWarning {
		return Item{KeyStorm, ItemAction, detail}
	}
	return Item{KeyStorm, ItemAttention, detail}
}

func updateItem(u *vehiclemodel.SoftwareUpdate) Item {
	if u == nil {
		return Item{KeySoftwareUpdate, ItemOK, "no update on record"}
	}
	switch u.Status {
	case "installing", "downloading":
		return Item{KeySoftwareUpdate, ItemAction, fmt.Sprintf("%s %s in progress — may block departure", u.Version, u.Status)}
	case "available":
		if u.ScheduledAt != nil {
			return Item{KeySoftwareUpdate, ItemAttention, fmt.Sprintf("%s scheduled for %s", u.Version, u.ScheduledAt.Format("Mon 15:04"))}
		}
		return Item{KeySoftwareUpdate, ItemAttention, fmt.Sprintf("%s available — install after the trip", u.Version)}
	default: // installed and anything else
		return Item{KeySoftwareUpdate, ItemOK, fmt.Sprintf("%s %s", u.Version, u.Status)}
	}
}

func ago(d time.Duration) string {
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh", int(d.Hours()))
}

// Run is one persisted checklist evaluation.
type Run struct {
	ID        int64     `json:"id"`
	SessionID int64     `json:"session_id"`
	RunAt     time.Time `json:"run_at"`
	Items     []Item    `json:"items"`
}

// StormEvents is the storm-history port. *stormguard.Store satisfies it.
type StormEvents interface {
	ListEvents(ctx context.Context, vehicleID int64, limit int) ([]*stormguard.Event, error)
}

// UpdateHistory is the software-update port.
// *systemdb.SoftwareUpdateRepo satisfies it.
type UpdateHistory interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error)
}

// RunStore persists checklist runs. *Store satisfies it.
type RunStore interface {
	SaveChecklistRun(ctx context.Context, sessionID int64, items []Item) (*Run, error)
	LatestChecklistRun(ctx context.Context, sessionID int64) (*Run, error)
}

// ChecklistHandler serves the ready-to-roll checklist. Stateless
// beyond constructor inputs; safe for concurrent use.
type ChecklistHandler struct {
	store   SessionStore
	runs    RunStore
	live    LiveSignals
	storm   StormEvents
	updates UpdateHistory
	now     func() time.Time
}

// NewChecklistHandler wires the handler. Panics on nil inputs
// (fail-fast wiring contract, matching sibling handlers).
func NewChecklistHandler(store SessionStore, runs RunStore, live LiveSignals, storm StormEvents, updates UpdateHistory) *ChecklistHandler {
	if store == nil || runs == nil || live == nil || storm == nil || updates == nil {
		panic("journey: nil dependency")
	}
	return &ChecklistHandler{store: store, runs: runs, live: live, storm: storm, updates: updates, now: time.Now}
}

// Refresh serves POST /journey/sessions/{id}/checklist/runs: evaluate
// live readiness and persist the run.
func (h *ChecklistHandler) Refresh(w http.ResponseWriter, r *http.Request) {
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
	inputs, err := h.gather(ctx, session.VehicleID, now)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: checklist gather failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read vehicle state")
		return
	}
	run, err := h.runs.SaveChecklistRun(ctx, id, EvaluateChecklist(inputs, now))
	if err != nil {
		if errors.Is(err, ErrNoSession) {
			httpx.WriteError(w, http.StatusNotFound, "journey not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("journey: checklist save failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save checklist")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, run)
}

// Latest serves GET /journey/sessions/{id}/checklist: the most recent
// run, or 404 when the checklist never ran.
func (h *ChecklistHandler) Latest(w http.ResponseWriter, r *http.Request) {
	id, err := sessionIDParam(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	run, err := h.runs.LatestChecklistRun(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("journey: checklist read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read checklist")
		return
	}
	if run == nil {
		httpx.WriteError(w, http.StatusNotFound, "checklist never ran for this journey")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, run)
}

var tireSignals = [tireCorners]string{
	"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr",
}

func (h *ChecklistHandler) gather(ctx context.Context, vehicleID int64, now time.Time) (Inputs, error) {
	var in Inputs
	var err error
	if in.Soc, err = signalFloat(h.live, ctx, vehicleID, "Soc"); err != nil {
		return in, err
	}
	if in.Limit, err = signalFloat(h.live, ctx, vehicleID, "ChargeLimitSoc"); err != nil {
		return in, err
	}
	for i, name := range tireSignals {
		if in.TiresBar[i], err = signalFloat(h.live, ctx, vehicleID, name); err != nil {
			return in, err
		}
	}
	events, err := h.storm.ListEvents(ctx, vehicleID, 5)
	if err != nil {
		return in, err
	}
	for _, ev := range events {
		if ev != nil && ev.Level != stormguard.LevelNone {
			in.Storm = ev
			break
		}
	}
	updates, err := h.updates.GetByVehicle(ctx, vehicleID, 1, time.Time{}, now)
	if err != nil {
		return in, err
	}
	if len(updates) > 0 {
		in.Update = updates[0]
	}
	return in, nil
}

// Compile-time port assertions.
var (
	_ StormEvents   = (*stormguard.Store)(nil)
	_ LiveSignals   = (signal.LiveStateReader)(nil)
	_ Meteo         = (*stormguard.Client)(nil)
	_ UpdateHistory = (*systemdb.SoftwareUpdateRepo)(nil)
)
