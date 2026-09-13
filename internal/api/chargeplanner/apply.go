package chargeplanner

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
)

// Sentinel errors returned by ApplyPlanByID so HTTP callers (the Apply
// handler and Smart Charging Autopilot's Run endpoint) can map failures
// to the correct status code without re-parsing messages.
var (
	// ErrPlanNotFound indicates the plan ID does not exist.
	ErrPlanNotFound = errors.New("charge plan not found")
	// ErrPlanNotDraft indicates the plan was already applied or superseded.
	ErrPlanNotDraft = errors.New("plan is no longer a draft")
	// ErrApplyVehicleNotFound indicates the plan's vehicle does not exist.
	ErrApplyVehicleNotFound = errors.New("vehicle not found")
)

// ApplyPlanByID applies a draft charge plan to its vehicle: it issues the
// two Tesla commands (set_charge_limit, set_scheduled_charging) and marks
// the plan scheduled. It returns the applied plan, plus the canonical
// command name that failed (empty on success or non-command errors) so
// callers can surface per-command failure messages.
func (h *Handler) ApplyPlanByID(ctx context.Context, planID int64) (*chargingdb.ChargePlan, string, error) {
	planRepo := chargingdb.NewChargePlanRepo(h.db)

	plan, err := planRepo.GetByID(ctx, planID)
	if err != nil {
		log.Error().Err(err).Int64("plan_id", planID).Msg("failed to fetch charge plan")
		return nil, "", fmt.Errorf("fetch plan: %w", err)
	}
	if plan == nil {
		return nil, "", ErrPlanNotFound
	}
	if plan.Status != "draft" {
		return nil, "", fmt.Errorf("%w: plan already %s", ErrPlanNotDraft, plan.Status)
	}

	vehicleRepo := vehicledb.NewVehicleRepo(h.db)
	vehicle, err := vehicleRepo.GetByID(ctx, plan.VehicleID)
	if err != nil || vehicle == nil {
		return nil, "", ErrApplyVehicleNotFound
	}

	// Apply the schedule via two Tesla commands, each wrapped in its own
	// per-call context.WithTimeout (project rule — Tesla API: 30s). Each
	// command runs under a fresh deadline derived from the parent so a
	// stuck first call cannot starve the second's budget.
	startMinutes := plan.ScheduledStart.Hour()*60 + plan.ScheduledStart.Minute()
	if failedCmd, err := h.applyChargeScheduleToVehicle(ctx, vehicle.VIN, plan.TargetSOC, startMinutes); err != nil {
		log.Error().Err(err).Str("vin", vehicle.VIN).Str("command", failedCmd).Msg("failed to apply charge schedule")
		return nil, failedCmd, err
	}

	now := time.Now().UTC()
	if err := planRepo.UpdateStatus(ctx, plan.ID, "scheduled", &now, nil); err != nil {
		log.Error().Err(err).Int64("plan_id", plan.ID).Msg("failed to update plan status")
	}

	log.Info().
		Int64("plan_id", plan.ID).
		Str("vin", vehicle.VIN).
		Int("start_minutes", startMinutes).
		Int("target_soc", plan.TargetSOC).
		Msg("charge schedule applied to vehicle")

	return plan, "", nil
}
