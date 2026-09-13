package automation

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// RoutineAction is one command in a routine template.
type RoutineAction struct {
	Command string         `json:"command"`
	Params  map[string]any `json:"params,omitempty"`
}

// RoutineTemplate is a parameterized geofence routine: an enter/exit trigger
// plus commands, instantiated for a user-chosen place. Unlike static presets
// (which must work without per-user FK references), routines take a place_id
// at install time — the guided-wizard path the presets catalogue defers to.
type RoutineTemplate struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Event       string          `json:"event"` // enter | exit
	Actions     []RoutineAction `json:"actions"`
}

// RoutineTemplates is the static catalogue of geofence routines.
func RoutineTemplates() []RoutineTemplate {
	return []RoutineTemplate{
		{
			ID:          "arrive_home",
			Name:        "Arrive Home",
			Description: "When you arrive at home: turn Sentry off and lock the doors.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "sentry_off"}, {Command: "lock"}},
		},
		{
			ID:          "leave_home",
			Name:        "Leave Home",
			Description: "When you leave home: turn Sentry on and lock the doors.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "sentry_on"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_charger",
			Name:        "Arrive at Charger",
			Description: "When you arrive at a charger: cap the charge limit at 80% for battery health.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "set_charge_limit", Params: map[string]any{"percent": 80}}},
		},
		{
			ID:          "leave_work",
			Name:        "Leave Work",
			Description: "When you leave work: start climate so the cabin is comfortable.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_on"}},
		},
		{
			ID:          "arrive_work",
			Name:        "Arrive at Work",
			Description: "When you arrive at work: turn Sentry off and climate off.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "sentry_off"}, {Command: "climate_off"}},
		},
		{
			ID:          "leave_home_climate",
			Name:        "Leave Home — Pre-condition",
			Description: "When you leave home: start climate and lock the doors.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_on"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_climate_off",
			Name:        "Arrive Home — Climate Off",
			Description: "When you arrive home: stop HVAC and lock.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "climate_off"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_windows",
			Name:        "Arrive Home — Close Windows",
			Description: "When you arrive home: close windows and lock.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "close_windows"}, {Command: "lock"}},
		},
		{
			ID:          "leave_home_windows",
			Name:        "Leave Home — Close Windows",
			Description: "When you leave home: close windows, arm Sentry, lock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "close_windows"}, {Command: "sentry_on"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_charger_port",
			Name:        "Arrive at Charger — Open Port",
			Description: "When you arrive at a charger: open the charge port and cap at 80%.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "open_charge_port"}, {Command: "set_charge_limit", Params: map[string]any{"percent": 80}}},
		},
		{
			ID:          "leave_charger",
			Name:        "Leave Charger",
			Description: "When you leave a charger: stop charging, close the port, lock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "charge_stop"}, {Command: "close_charge_port"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_homelink",
			Name:        "Arrive Home — HomeLink",
			Description: "When you arrive home: trigger HomeLink and disarm Sentry.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "trigger_homelink"}, {Command: "sentry_off"}},
		},
		{
			ID:          "leave_home_homelink",
			Name:        "Leave Home — HomeLink",
			Description: "When you leave home: trigger HomeLink and arm Sentry.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "trigger_homelink"}, {Command: "sentry_on"}},
		},
		{
			ID:          "arrive_work_lock",
			Name:        "Arrive at Work — Lock",
			Description: "When you arrive at work: lock, close windows, arm Sentry.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "lock"}, {Command: "close_windows"}, {Command: "sentry_on"}},
		},
		{
			ID:          "leave_work_seats",
			Name:        "Leave Work — Climate + Seat Heat",
			Description: "When you leave work: start climate and heat the driver seat.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_on"}, {Command: "seat_heater", Params: map[string]any{"seat": 0, "level": 2}}},
		},
		{
			ID:          "arrive_supercharger",
			Name:        "Arrive at Supercharger",
			Description: "When you arrive at a Supercharger: open the port and set limit 80%.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "open_charge_port"}, {Command: "set_charge_limit", Params: map[string]any{"percent": 80}}},
		},
		{
			ID:          "leave_supercharger",
			Name:        "Leave Supercharger",
			Description: "When you leave a Supercharger: close the port and lock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "close_charge_port"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_wake",
			Name:        "Arrive Home — Flash Lights",
			Description: "When you arrive home: flash lights so you can find the stall.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "flash_lights"}},
		},
		{
			ID:          "leave_home_wake_climate",
			Name:        "Leave Home — Wake + Climate",
			Description: "When you leave home: start climate and unlock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_on"}, {Command: "unlock"}},
		},
		{
			ID:          "arrive_school",
			Name:        "Arrive at School",
			Description: "When you arrive at school: lock and arm Sentry.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "lock"}, {Command: "sentry_on"}},
		},
		{
			ID:          "leave_school",
			Name:        "Leave School",
			Description: "When you leave school: start climate for the drive home.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_on"}},
		},
		{
			ID:          "arrive_airport",
			Name:        "Arrive at Airport",
			Description: "When you arrive at the airport: lock, close windows, arm Sentry.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "lock"}, {Command: "close_windows"}, {Command: "sentry_on"}},
		},
		{
			ID:          "leave_airport",
			Name:        "Leave Airport",
			Description: "When you leave the airport: disarm Sentry and start climate.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "sentry_off"}, {Command: "climate_on"}},
		},
		{
			ID:          "arrive_home_frunk",
			Name:        "Arrive Home — Open Frunk",
			Description: "When you arrive home: open the frunk for groceries.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "frunk_open"}},
		},
		{
			ID:          "arrive_home_trunk",
			Name:        "Arrive Home — Open Trunk",
			Description: "When you arrive home: open the rear trunk.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "trunk_open"}},
		},
		{
			ID:          "arrive_grocery_frunk",
			Name:        "Arrive at Grocery — Open Frunk",
			Description: "When you arrive at a grocery store: open the frunk.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "frunk_open"}},
		},
		{
			ID:          "leave_grocery_lock",
			Name:        "Leave Grocery — Lock",
			Description: "When you leave a grocery store: lock and close windows.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "lock"}, {Command: "close_windows"}},
		},
		{
			ID:          "leave_home_guest_off",
			Name:        "Leave Home — Guest Off",
			Description: "When you leave home: disable Guest Mode and lock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "guest_mode_off"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_work_guest_off",
			Name:        "Arrive at Work — Guest Off",
			Description: "When you arrive at work: disable Guest Mode and lock.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "guest_mode_off"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_boombox",
			Name:        "Arrive Home — Boombox Ping",
			Description: "When you arrive home: play a boombox ping so you can find the stall.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "boombox_ping"}},
		},
		{
			ID:          "leave_home_flash",
			Name:        "Leave Home — Flash Lights",
			Description: "When you leave home: flash the lights.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "flash_lights"}},
		},
		{
			ID:          "arrive_cabin_camp",
			Name:        "Arrive at Cabin — Camp Mode",
			Description: "When you arrive at a cabin: enable Camp Mode.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "camp_mode"}},
		},
		{
			ID:          "leave_cabin_keeper_off",
			Name:        "Leave Cabin — Climate Keeper Off",
			Description: "When you leave a cabin: disable Climate Keeper and lock.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "climate_keeper_off"}, {Command: "lock"}},
		},
		{
			ID:          "arrive_home_honk",
			Name:        "Arrive Home — Honk",
			Description: "When you arrive home: honk once to confirm arrival.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "honk_horn"}},
		},
		{
			ID:          "leave_work_flash",
			Name:        "Leave Work — Flash Lights",
			Description: "When you leave work: flash lights so you can find the car.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "flash_lights"}},
		},
		{
			ID:          "arrive_charger_honk",
			Name:        "Arrive at Charger — Honk",
			Description: "When you arrive at a charger: honk and open the charge port.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "honk_horn"}, {Command: "open_charge_port"}},
		},
		{
			ID:          "arrive_park_sentry",
			Name:        "Arrive at Park — Sentry On",
			Description: "When you arrive at a park: lock and arm Sentry.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "lock"}, {Command: "sentry_on"}},
		},
		{
			ID:          "leave_park_sentry_off",
			Name:        "Leave Park — Sentry Off",
			Description: "When you leave a park: disarm Sentry and start climate.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "sentry_off"}, {Command: "climate_on"}},
		},
		{
			ID:          "arrive_home_sunroof_close",
			Name:        "Arrive Home — Close Sunroof",
			Description: "When you arrive home: close the sunroof and lock.",
			Event:       "enter",
			Actions:     []RoutineAction{{Command: "sunroof_close"}, {Command: "lock"}},
		},
		{
			ID:          "leave_home_sunroof_vent",
			Name:        "Leave Home — Vent Sunroof",
			Description: "When you leave home: vent the sunroof.",
			Event:       "exit",
			Actions:     []RoutineAction{{Command: "sunroof_vent"}},
		},
	}
}

// ListRoutineTemplates serves GET /automations/routine-templates.
func (h *AutomationHandler) ListRoutineTemplates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, RoutineTemplates())
}

type installRoutineRequest struct {
	PlaceID   int64  `json:"place_id"`
	VehicleID *int64 `json:"vehicle_id"`
	Name      string `json:"name"`
}

// InstallRoutine serves POST /automations/routine-templates/{id}/install.
// It builds the same validated create path as Create (typed steps →
// CreateWithSteps → conflict detection → audit → worker reload).
func (h *AutomationHandler) InstallRoutine(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var tmpl *RoutineTemplate
	for _, t := range RoutineTemplates() {
		if t.ID == id {
			c := t
			tmpl = &c
			break
		}
	}
	if tmpl == nil {
		writeError(w, http.StatusNotFound, "routine template not found")
		return
	}
	var req installRoutineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PlaceID <= 0 {
		writeError(w, http.StatusBadRequest, "place_id is required")
		return
	}

	name := req.Name
	if name == "" {
		name = tmpl.Name
	}
	steps, err := routineSteps(*tmpl, req.PlaceID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid routine: "+err.Error())
		return
	}
	creq := &createAutomationRequest{
		Name:        name,
		Description: tmpl.Description,
		VehicleID:   req.VehicleID,
		Triggers:    []automationTypedStep{steps.trigger},
		Actions:     steps.actions,
	}
	writes, err := automationStepWrites(creq)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid routine steps: "+err.Error())
		return
	}
	a := &models.Automation{
		Name:        name,
		Description: &tmpl.Description,
		VehicleID:   req.VehicleID,
		Enabled:     true,
	}
	if err := h.repo.CreateWithSteps(r.Context(), a, writes); err != nil {
		log.Error().Err(err).Str("routine", tmpl.ID).Msg("failed to install routine")
		writeError(w, http.StatusInternalServerError, "failed to install routine")
		return
	}

	resp := newAutomationResponse(a)
	resp.Conflicts = h.detectConflicts(r, a)
	if h.auditor != nil {
		h.auditor.LogCreated(r.Context(), a.ID, a.Name, firstTriggerKind(creq), a.Enabled, r.RemoteAddr)
	}
	h.notifyReload(r.Context(), "created", a.ID)

	log.Info().Int64("automation_id", a.ID).Str("routine", tmpl.ID).Msg("routine installed")
	writeJSON(w, http.StatusCreated, resp)
}

type routineStepSet struct {
	trigger automationTypedStep
	actions []automationTypedStep
}

// routineSteps builds validated typed steps for a template + place. The
// payload shapes mirror the DTO decoders so automationStepWrites accepts
// them exactly as if they arrived over the wire.
func routineSteps(t RoutineTemplate, placeID int64) (routineStepSet, error) {
	if t.Event != "enter" && t.Event != "exit" {
		return routineStepSet{}, fmt.Errorf("unknown geofence event %q", t.Event)
	}
	out := routineStepSet{
		trigger: automationTypedStep{
			Kind: models.AutomationStepKindTriggerGeofence,
			Payload: automationTriggerGeofenceDTO{
				Kind:    models.AutomationStepKindTriggerGeofence,
				PlaceID: placeID,
				Event:   t.Event,
			},
		},
	}
	for _, act := range t.Actions {
		if act.Command == "" {
			return routineStepSet{}, fmt.Errorf("routine action missing command")
		}
		var raw json.RawMessage
		if act.Params != nil {
			b, err := json.Marshal(act.Params)
			if err != nil {
				return routineStepSet{}, err
			}
			raw = b
		}
		out.actions = append(out.actions, automationTypedStep{
			Kind: models.AutomationStepKindActionCommand,
			Payload: automationActionCommandDTO{
				Kind:          models.AutomationStepKindActionCommand,
				CommandName:   act.Command,
				CommandParams: raw,
			},
		})
	}
	return out, nil
}
