package chargeplanner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools/schedule"
	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	vehicledb "github.com/ev-dev-labs/teslasync/internal/database/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// chargePlannerCommandTimeout caps each Tesla SendCommand invocation
// issued by Handler.Apply. Project rule: external Tesla API
// calls must wrap with context.WithTimeout (Tesla API: 30s). Without a
// per-call deadline a stalled Tesla API hangs the request goroutine for
// as long as the inbound HTTP client is willing to wait (forever, by
// default), starving the worker pool and any /charge-planner/apply
// request queueing behind it.
//
// Declared as a package var rather than a const so unit tests can
// substitute a short timeout to exercise the deadline branch
// deterministically without sleeping for 30 seconds.
var chargePlannerCommandTimeout = 30 * time.Second

// Handler provides smart charge scheduling optimization.
//
// The current-SOC lookup that seeds the optimizer (BatteryLevel as
// of now) resolves through the canonical signal.StateReader
// (ADR-002) instead of the legacy
// signaldb.SignalLogReader's per-signal helper. The lookup is a "value
// as of now" forward-folded read, which maps 1:1 onto
// StateReader.SignalAt with identical semantics.
//
// As part of this migration, transport errors from state.SignalAt now
// propagate to the caller as a 500 instead of being silently swallowed.
// The legacy silent-swallow defaulted currentSOC to 0, which made every
// optimize request appear to need a full charge from empty — masking
// real signal-store / pgx outages behind plausible-looking (but wrong)
// charge windows and inflated cost estimates.
type Handler struct {
	db          *database.DB
	teslaClient *tesla.Client
	cfg         *config.Config
	state       signal.StateReader
}

// NewHandler creates a new Handler.
func NewHandler(db *database.DB, teslaClient *tesla.Client, cfg *config.Config, state signal.StateReader) *Handler {
	return &Handler{db: db, teslaClient: teslaClient, cfg: cfg, state: state}
}

// ── Optimize Endpoint ────────────────────────────────────────

// Optimize handles POST /charge-planner/optimize
func (h *Handler) Optimize(w http.ResponseWriter, r *http.Request) {
	var req optimizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	if req.TargetSOC < 1 || req.TargetSOC > 100 {
		httpx.WriteError(w, http.StatusBadRequest, "target_soc must be 1-100")
		return
	}
	if req.RatePlanID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "rate_plan_id is required")
		return
	}

	if _, ok := ratePlans[req.RatePlanID]; !ok {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("unknown rate plan: %s", req.RatePlanID))
		return
	}

	departBy, err := time.Parse(time.RFC3339, req.DepartBy)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "depart_by must be RFC3339 format")
		return
	}
	if departBy.Before(time.Now().UTC()) {
		httpx.WriteError(w, http.StatusBadRequest, "depart_by must be in the future")
		return
	}

	applyOptimizeRequestDefaults(&req)

	// Get current SOC from the canonical state reader (signal_log-backed).
	ctx := r.Context()
	currentSOC := 0
	if h.state != nil {
		val, err := h.state.SignalAt(ctx, req.VehicleID, "BatteryLevel", time.Now())
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", req.VehicleID).Str("signal", "BatteryLevel").Msg("charge planner: failed to read current SOC")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read current battery state")
			return
		}
		if val != nil {
			if v, ok := toFloatOk(val); ok && v > 0 {
				currentSOC = int(v)
			}
		}
	}

	// Delegate the pure-functional planning to computeSchedule so the
	// AI smart-charge-schedule draft_charge_schedule tool can call
	// exactly the same code path. computeSchedule returns
	// either a typed user-facing error (mapped to 400) or a fully
	// populated *optimizeResponse with PlanID=0 (the caller persists
	// + fills in PlanID).
	resp, err := h.computeSchedule(ctx, req, departBy, currentSOC, time.Now().UTC())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Persist draft plan. The AI handler does NOT call into this
	// branch — it only proposes via computeSchedule and lets the user
	// save through the canonical Apply / SmartChargePage Save buttons.
	planRepo := chargingdb.NewChargePlanRepo(h.db)
	estKwh := resp.KWhNeeded
	estCost := resp.Schedule.EstCost
	chargeNowCost := resp.Comparison.ChargeNowCost
	savings := resp.Comparison.Savings
	dbPlan := &chargingdb.ChargePlan{
		VehicleID:      req.VehicleID,
		TargetSOC:      req.TargetSOC,
		DepartBy:       &departBy,
		ScheduledStart: resp.Schedule.StartTime,
		ScheduledEnd:   resp.Schedule.EndTime,
		RatePlan:       req.RatePlanID,
		EstimatedKWh:   &estKwh,
		EstimatedCost:  &estCost,
		ChargeNowCost:  &chargeNowCost,
		Savings:        &savings,
		Status:         "draft",
	}
	if err := planRepo.Create(ctx, dbPlan); err != nil {
		log.Error().Err(err).Msg("failed to create charge plan")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}
	resp.PlanID = dbPlan.ID

	log.Info().
		Int64("vehicle_id", req.VehicleID).
		Int64("plan_id", dbPlan.ID).
		Int("current_soc", currentSOC).
		Int("target_soc", req.TargetSOC).
		Float64("kwh_needed", resp.KWhNeeded).
		Float64("optimized_cost", resp.Schedule.EstCost).
		Float64("savings", resp.Comparison.Savings).
		Msg("charge plan optimized")

	httpx.WriteJSON(w, http.StatusOK, resp)
}

// applyOptimizeRequestDefaults populates the optional charger / battery
// fields of an optimizeRequest. Extracted so computeSchedule and the
// AI smart-charge tool path see the same defaults the canonical
// Optimize handler applies.
func applyOptimizeRequestDefaults(req *optimizeRequest) {
	if req.MaxAmps <= 0 {
		req.MaxAmps = 32
	}
	if req.MaxAmps > 80 {
		req.MaxAmps = 80
	}
	if req.BatteryCapacity <= 0 {
		req.BatteryCapacity = 75.0
	}
	if req.ChargerVoltage <= 0 {
		req.ChargerVoltage = 240
	}
}

// computeSchedule performs the pure-functional charge-plan
// optimization: given the post-validation request, the parsed
// departBy timestamp, the resolved currentSOC, and a "now"
// reference, it computes the cheapest contiguous charging window
// before departure and the cost-comparison envelope.
//
// computeSchedule does NOT persist anything and does NOT touch the
// state reader. Its only side effect is allocating the response
// envelope. The Optimize HTTP handler is the only caller that
// persists the result; the smart-charge-schedule-suggestion AI tool
// path calls computeSchedule via the AIChargeScheduleComputer
// adapter and never persists.
//
// Errors returned here represent user-input / planning-feasibility
// problems (already-at-target SOC, not-enough-time, no-valid-window)
// and are intended to map to 400 Bad Request at the HTTP boundary.
// Persistence and signal-store errors stay in the caller.
func (h *Handler) computeSchedule(_ context.Context, req optimizeRequest, departBy time.Time, currentSOC int, now time.Time) (*optimizeResponse, error) {
	plan, ok := ratePlans[req.RatePlanID]
	if !ok {
		return nil, fmt.Errorf("unknown rate plan: %s", req.RatePlanID)
	}

	if currentSOC >= req.TargetSOC {
		return nil, fmt.Errorf("current SOC (%d%%) already meets target (%d%%)", currentSOC, req.TargetSOC)
	}

	kwhNeeded := float64(req.TargetSOC-currentSOC) / 100.0 * req.BatteryCapacity
	chargeRateKW := float64(req.ChargerVoltage) * float64(req.MaxAmps) / 1000.0
	// Add a conservative charging-loss margin.
	kwhWithLoss := kwhNeeded * 1.10
	durationHours := kwhWithLoss / chargeRateKW
	durationCeilHours := int(math.Ceil(durationHours))

	if durationCeilHours <= 0 {
		durationCeilHours = 1
	}

	hoursUntilDepart := departBy.Sub(now).Hours()
	if float64(durationCeilHours) > hoursUntilDepart {
		return nil, fmt.Errorf(
			"not enough time: need %.1f hours but only %.1f hours until departure",
			durationHours, hoursUntilDepart,
		)
	}

	seasonName := seasonForDate(plan, departBy)
	season := plan.Seasons[seasonName]
	rates := buildHourlyRates(season)

	type candidate struct {
		startHour    int
		cost         float64
		avgRateCents float64
		tier         string
	}

	nowHour := now.Hour()

	var candidates []candidate
	for startH := 0; startH < 24; startH++ {
		startTime := time.Date(departBy.Year(), departBy.Month(), departBy.Day(), startH, 0, 0, 0, departBy.Location())
		if startTime.After(departBy) {
			startTime = startTime.AddDate(0, 0, -1)
		}
		endTime := startTime.Add(time.Duration(durationCeilHours) * time.Hour)

		if startTime.Before(now) || endTime.After(departBy) {
			continue
		}

		cost, avgRate := costForWindow(rates, startH, durationCeilHours, kwhNeeded)

		tierCounts := make(map[string]int)
		for i := 0; i < durationCeilHours; i++ {
			h := (startH + i) % 24
			tierCounts[rates[h].Tier]++
		}
		dominantTier := "unknown"
		maxCount := 0
		for t, c := range tierCounts {
			if c > maxCount {
				dominantTier = t
				maxCount = c
			}
		}

		candidates = append(candidates, candidate{
			startHour:    startH,
			cost:         cost,
			avgRateCents: avgRate,
			tier:         dominantTier,
		})
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("no valid charging window found before departure")
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].cost < candidates[j].cost
	})

	best := candidates[0]

	chargeNowCost, _ := costForWindow(rates, nowHour, durationCeilHours, kwhNeeded)

	savings := chargeNowCost - best.cost
	savingsPct := 0.0
	if chargeNowCost > 0 {
		savingsPct = (savings / chargeNowCost) * 100.0
	}

	bestStart := time.Date(departBy.Year(), departBy.Month(), departBy.Day(), best.startHour, 0, 0, 0, departBy.Location())
	if bestStart.After(departBy) {
		bestStart = bestStart.AddDate(0, 0, -1)
	}
	bestEnd := bestStart.Add(time.Duration(float64(time.Hour) * durationHours))

	var alternatives []chargeWindow
	for i := 1; i < len(candidates) && len(alternatives) < 3; i++ {
		c := candidates[i]
		altStart := time.Date(departBy.Year(), departBy.Month(), departBy.Day(), c.startHour, 0, 0, 0, departBy.Location())
		if altStart.After(departBy) {
			altStart = altStart.AddDate(0, 0, -1)
		}
		altEnd := altStart.Add(time.Duration(float64(time.Hour) * durationHours))
		alternatives = append(alternatives, chargeWindow{
			StartTime:    altStart,
			EndTime:      altEnd,
			RateCentsKWh: c.avgRateCents,
			EstCost:      math.Round(c.cost*100) / 100,
			RateTier:     tierLabel(c.tier),
		})
	}

	return &optimizeResponse{
		// PlanID=0 — caller fills this in after persisting.
		CurrentSOC:       currentSOC,
		TargetSOC:        req.TargetSOC,
		KWhNeeded:        math.Round(kwhNeeded*100) / 100,
		EstDurationHours: math.Round(durationHours*10) / 10,
		Schedule: chargeWindow{
			StartTime:    bestStart,
			EndTime:      bestEnd,
			RateCentsKWh: best.avgRateCents,
			EstCost:      math.Round(best.cost*100) / 100,
			RateTier:     tierLabel(best.tier),
		},
		Comparison: costComparison{
			ChargeNowCost: math.Round(chargeNowCost*100) / 100,
			OptimizedCost: math.Round(best.cost*100) / 100,
			Savings:       math.Round(savings*100) / 100,
			SavingsPct:    math.Round(savingsPct*10) / 10,
		},
		Alternatives: alternatives,
		HourlyRates:  rates,
	}, nil
}

// ── Apply Endpoint ───────────────────────────────────────────

// Apply handles POST /charge-planner/apply
func (h *Handler) Apply(w http.ResponseWriter, r *http.Request) {
	var req applyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PlanID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "plan_id is required")
		return
	}

	ctx := r.Context()
	planRepo := chargingdb.NewChargePlanRepo(h.db)

	plan, err := planRepo.GetByID(ctx, req.PlanID)
	if err != nil {
		log.Error().Err(err).Int64("plan_id", req.PlanID).Msg("failed to fetch charge plan")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch plan")
		return
	}
	if plan == nil {
		httpx.WriteError(w, http.StatusNotFound, "charge plan not found")
		return
	}
	if plan.Status != "draft" {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("plan already %s", plan.Status))
		return
	}

	vehicleRepo := vehicledb.NewVehicleRepo(h.db)
	vehicle, err := vehicleRepo.GetByID(ctx, plan.VehicleID)
	if err != nil || vehicle == nil {
		httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	// 1+2. Apply the schedule via two Tesla commands, each wrapped in
	// its own per-call context.WithTimeout (project rule: external
	// Tesla API calls must wrap with context.WithTimeout — Tesla API:
	// 30s). Each command runs under a fresh deadline derived from the
	// parent so a stuck first call cannot starve the second's budget.
	startMinutes := plan.ScheduledStart.Hour()*60 + plan.ScheduledStart.Minute()
	if failedCmd, err := h.applyChargeScheduleToVehicle(ctx, vehicle.VIN, plan.TargetSOC, startMinutes); err != nil {
		log.Error().Err(err).Str("vin", vehicle.VIN).Str("command", failedCmd).Msg("failed to apply charge schedule")
		// Fleet API daily budget errors are a distinct, structured failure
		// mode: ErrBudgetExceeded cannot succeed by retrying until the next
		// UTC reset, and ErrBudgetUnavailable means the budget evidence
		// store itself could not be read. Surface both as their real HTTP
		// status instead of the generic 500 below.
		if failure, matched := httpx.ClassifyTeslaBudgetError(err); matched {
			httpx.WriteError(w, failure.StatusCode, failure.Message)
			return
		}
		switch failedCmd {
		case "set_charge_limit":
			httpx.WriteError(w, http.StatusInternalServerError, "failed to set charge limit")
		case "set_scheduled_charging":
			httpx.WriteError(w, http.StatusInternalServerError, "failed to set scheduled charging")
		default:
			httpx.WriteError(w, http.StatusInternalServerError, "failed to apply charge schedule")
		}
		return
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

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "scheduled",
		"plan_id": plan.ID,
		"message": fmt.Sprintf("Charging scheduled at %s", plan.ScheduledStart.Format("15:04")),
	})
}

// applyChargeScheduleToVehicle issues the two Tesla commands required
// to apply a charge plan: set_charge_limit followed by
// set_scheduled_charging. Each command runs under its OWN
// context.WithTimeout(parent, chargePlannerCommandTimeout) — neither
// inherits the parent's lack of deadline, and a stuck first call cannot
// starve the second's budget.
//
// Returns the canonical command name that failed (empty on success)
// alongside the underlying error so the caller can map it to the
// appropriate user-facing error message and structured log field
// without re-parsing wrapped error strings.
func (h *Handler) applyChargeScheduleToVehicle(parent context.Context, vin string, targetSOC, startMinutes int) (string, error) {
	limitCtx, limitCancel := context.WithTimeout(parent, chargePlannerCommandTimeout)
	limitErr := h.teslaClient.SendCommand(limitCtx, vin, "set_charge_limit", map[string]interface{}{
		"percent": targetSOC,
	})
	limitCancel()
	if limitErr != nil {
		return "set_charge_limit", limitErr
	}

	scheduleCtx, scheduleCancel := context.WithTimeout(parent, chargePlannerCommandTimeout)
	scheduleErr := h.teslaClient.SendCommand(scheduleCtx, vin, "set_scheduled_charging", map[string]interface{}{
		"enable": true,
		"time":   startMinutes,
	})
	scheduleCancel()
	if scheduleErr != nil {
		return "set_scheduled_charging", scheduleErr
	}

	return "", nil
}

// ── History Endpoint ─────────────────────────────────────────

// ListPlans handles GET /charge-planner/history?vehicle_id=X
func (h *Handler) ListPlans(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := apiparams.Pagination(r)

	planRepo := chargingdb.NewChargePlanRepo(h.db)
	plans, err := planRepo.ListByVehicle(r.Context(), vehicleID, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list charge plans")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charge plans")
		return
	}

	if plans == nil {
		plans = []*chargingdb.ChargePlan{}
	}

	httpx.WriteJSON(w, http.StatusOK, plans)
}

// ── Rate Plans Endpoint ──────────────────────────────────────

// ListRatePlans handles GET /charge-planner/rate-plans
func (h *Handler) ListRatePlans(w http.ResponseWriter, r *http.Request) {
	type ratePlanInfo struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Utility string `json:"utility"`
	}
	var plans []ratePlanInfo
	for _, p := range ratePlans {
		plans = append(plans, ratePlanInfo{ID: p.ID, Name: p.Name, Utility: p.Utility})
	}
	sort.Slice(plans, func(i, j int) bool { return plans[i].ID < plans[j].ID })
	httpx.WriteJSON(w, http.StatusOK, plans)
}

// ComputeChargeSchedule implements schedule.ChargeScheduleComputer by delegating
// to the canonical charge-planner compute path without persisting a plan.
func (h *Handler) ComputeChargeSchedule(ctx context.Context, req schedule.ChargeScheduleComputeRequest) (*schedule.ChargeScheduleComputeResult, error) {
	if h == nil {
		return nil, errors.New("charge planner: nil handler")
	}
	departBy, err := time.Parse(time.RFC3339, req.DepartBy)
	if err != nil {
		return nil, fmt.Errorf("ai smart-charge-schedule-suggestion: depart_by parse: %w", err)
	}
	baselineReq := optimizeRequest{
		VehicleID:       req.VehicleID,
		TargetSOC:       req.TargetSOC,
		DepartBy:        req.DepartBy,
		RatePlanID:      req.RatePlanID,
		MaxAmps:         req.MaxAmps,
		BatteryCapacity: req.BatteryCapacity,
		ChargerVoltage:  req.ChargerVoltage,
		PreferOffPeak:   req.PreferOffPeak,
	}
	applyOptimizeRequestDefaults(&baselineReq)
	resp, err := h.computeSchedule(ctx, baselineReq, departBy, req.CurrentSOC, time.Now().UTC())
	if err != nil {
		return nil, fmt.Errorf("ai smart-charge-schedule-suggestion: computeSchedule: %w", err)
	}
	if resp == nil {
		return nil, errors.New("ai smart-charge-schedule-suggestion: computeSchedule returned nil response")
	}
	out := &schedule.ChargeScheduleComputeResult{
		PlanID:           resp.PlanID,
		CurrentSOC:       resp.CurrentSOC,
		TargetSOC:        resp.TargetSOC,
		KWhNeeded:        resp.KWhNeeded,
		EstDurationHours: resp.EstDurationHours,
		Schedule: schedule.ChargeWindow{
			StartTime:    resp.Schedule.StartTime,
			EndTime:      resp.Schedule.EndTime,
			RateCentsKWh: resp.Schedule.RateCentsKWh,
			EstCost:      resp.Schedule.EstCost,
			RateTier:     resp.Schedule.RateTier,
		},
		Comparison: schedule.CostComparison{
			ChargeNowCost: resp.Comparison.ChargeNowCost,
			OptimizedCost: resp.Comparison.OptimizedCost,
			Savings:       resp.Comparison.Savings,
			SavingsPct:    resp.Comparison.SavingsPct,
		},
		Alternatives: make([]schedule.ChargeWindow, 0, len(resp.Alternatives)),
		HourlyRates:  make([]schedule.HourlyRate, 0, len(resp.HourlyRates)),
	}
	for _, alt := range resp.Alternatives {
		out.Alternatives = append(out.Alternatives, schedule.ChargeWindow{
			StartTime:    alt.StartTime,
			EndTime:      alt.EndTime,
			RateCentsKWh: alt.RateCentsKWh,
			EstCost:      alt.EstCost,
			RateTier:     alt.RateTier,
		})
	}
	for _, hr := range resp.HourlyRates {
		out.HourlyRates = append(out.HourlyRates, schedule.HourlyRate{
			Hour:      hr.Hour,
			RateCents: hr.RateCents,
			Tier:      hr.Tier,
		})
	}
	return out, nil
}

var _ schedule.ChargeScheduleComputer = (*Handler)(nil)
