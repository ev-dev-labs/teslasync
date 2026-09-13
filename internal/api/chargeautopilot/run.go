package chargeautopilot

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
)

// PlanCreator persists a draft charge plan built from an autopilot preview.
// *chargingdb.ChargePlanRepo satisfies it.
type PlanCreator interface {
	Create(ctx context.Context, p *chargingdb.ChargePlan) error
}

// PlanRunner applies a draft charge plan to its vehicle via Tesla commands.
// *chargeplanner.Handler satisfies it through ApplyPlanByID.
type PlanRunner interface {
	ApplyPlanByID(ctx context.Context, planID int64) (*chargingdb.ChargePlan, string, error)
}

// RunHandler serves the one-click autopilot run endpoint. It reuses the
// same Preview computation as the preview endpoint, persists the result
// as a draft charge plan (autopilot provenance), then applies it through
// the charge planner's command path — one code path issues Tesla
// commands, never two.
//
// Stateless beyond its constructor inputs; safe for concurrent use.
type RunHandler struct {
	profiles ProfileStore
	plans    PlanCreator
	runner   PlanRunner
	now      func() time.Time
}

// NewRunHandler wires the run handler. Panics on nil inputs (fail-fast
// wiring contract, matching sibling handlers).
func NewRunHandler(profiles ProfileStore, plans PlanCreator, runner PlanRunner) *RunHandler {
	if profiles == nil || plans == nil || runner == nil {
		panic("chargeautopilot: nil run dependency")
	}
	return &RunHandler{profiles: profiles, plans: plans, runner: runner, now: time.Now}
}

type runRequest struct {
	VehicleID  int64 `json:"vehicle_id"`
	CurrentSOC int   `json:"current_soc"`
}

type runResponse struct {
	Status    string  `json:"status"`
	PlanID    int64   `json:"plan_id"`
	StartTime string  `json:"start_time"`
	TargetSOC int     `json:"target_soc"`
	Savings   float64 `json:"savings"`
	Message   string  `json:"message"`
}

// Run serves POST /charge-autopilot/run: compute the optimal window from
// the stored profile, persist it as a charge plan, and apply it to the
// vehicle immediately. The profile must be enabled; Preview feasibility
// failures (already at target, not enough time) surface as 409 since the
// request is valid but the run cannot proceed.
func (h *RunHandler) Run(w http.ResponseWriter, r *http.Request) {
	var req runRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	if req.CurrentSOC < 0 || req.CurrentSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "current_soc must be 0..100")
		return
	}

	ctx := r.Context()
	p, err := h.profiles.Get(ctx, req.VehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("autopilot: profile read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read autopilot profile")
		return
	}
	if !p.Enabled {
		httpx.WriteError(w, http.StatusConflict, "autopilot is not enabled for this vehicle")
		return
	}

	res, err := Preview(PreviewInput{Profile: *p, CurrentSOC: req.CurrentSOC, Now: h.now()})
	if err != nil {
		httpx.WriteError(w, http.StatusConflict, err.Error())
		return
	}

	plan := &chargingdb.ChargePlan{
		VehicleID:      req.VehicleID,
		TargetSOC:      res.EffectiveTargetSOC,
		DepartBy:       &res.ReadyBy,
		ScheduledStart: res.Window.StartTime,
		ScheduledEnd:   res.Window.EndTime,
		RatePlan:       p.RatePlan,
		EstimatedKWh:   &res.KWhNeeded,
		EstimatedCost:  &res.OptimizedCost,
		ChargeNowCost:  &res.ChargeNowCost,
		Savings:        &res.Savings,
		Status:         "draft",
	}
	if err := h.plans.Create(ctx, plan); err != nil {
		log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Msg("autopilot: plan persist failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save charge plan")
		return
	}

	applied, failedCmd, err := h.runner.ApplyPlanByID(ctx, plan.ID)
	if err != nil {
		// The plan stays a draft, so the run is retryable from the charge
		// planner UI without recomputing.
		log.Error().Err(err).Int64("plan_id", plan.ID).Str("command", failedCmd).Msg("autopilot: plan apply failed")
		if failure, matched := httpx.ClassifyTeslaBudgetError(err); matched {
			httpx.WriteError(w, failure.StatusCode, failure.Message)
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, "failed to apply charge schedule to vehicle")
		return
	}

	log.Info().
		Int64("plan_id", applied.ID).
		Int64("vehicle_id", req.VehicleID).
		Float64("savings", res.Savings).
		Msg("autopilot run applied to vehicle")

	httpx.WriteJSON(w, http.StatusOK, runResponse{
		Status:    "scheduled",
		PlanID:    applied.ID,
		StartTime: applied.ScheduledStart.Format("15:04"),
		TargetSOC: applied.TargetSOC,
		Savings:   res.Savings,
		Message:   "Autopilot scheduled charging at " + applied.ScheduledStart.Format("15:04"),
	})
}
