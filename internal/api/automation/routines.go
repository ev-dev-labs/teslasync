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
