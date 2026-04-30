package api

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// ChargePlannerHandler provides smart charge scheduling optimization.
type ChargePlannerHandler struct {
	db              *database.DB
	teslaClient     *tesla.Client
	cfg             *config.Config
	signalLogReader *database.SignalLogReader
}

// NewChargePlannerHandler creates a new ChargePlannerHandler.
func NewChargePlannerHandler(db *database.DB, teslaClient *tesla.Client, cfg *config.Config, slr *database.SignalLogReader) *ChargePlannerHandler {
	return &ChargePlannerHandler{db: db, teslaClient: teslaClient, cfg: cfg, signalLogReader: slr}
}

// ── Optimize Endpoint ────────────────────────────────────────

// Optimize handles POST /charge-planner/optimize
func (h *ChargePlannerHandler) Optimize(w http.ResponseWriter, r *http.Request) {
	var req optimizeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate required fields
	if req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	if req.TargetSOC < 1 || req.TargetSOC > 100 {
		writeError(w, http.StatusBadRequest, "target_soc must be 1-100")
		return
	}
	if req.RatePlanID == "" {
		writeError(w, http.StatusBadRequest, "rate_plan_id is required")
		return
	}

	plan, ok := ratePlans[req.RatePlanID]
	if !ok {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown rate plan: %s", req.RatePlanID))
		return
	}

	departBy, err := time.Parse(time.RFC3339, req.DepartBy)
	if err != nil {
		writeError(w, http.StatusBadRequest, "depart_by must be RFC3339 format")
		return
	}
	if departBy.Before(time.Now().UTC()) {
		writeError(w, http.StatusBadRequest, "depart_by must be in the future")
		return
	}

	// Defaults
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

	// Get current SOC from signal_log
	ctx := r.Context()
	currentSOC := 0
	if h.signalLogReader != nil {
		if val, err := h.signalLogReader.SignalAt(ctx, req.VehicleID, "BatteryLevel", time.Now()); err == nil && val != nil {
			if v, ok := toFloatOk(val); ok && v > 0 {
				currentSOC = int(v)
			}
		}
	}

	if currentSOC >= req.TargetSOC {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("current SOC (%d%%) already meets target (%d%%)", currentSOC, req.TargetSOC))
		return
	}

	// Calculate charging requirements
	kwhNeeded := float64(req.TargetSOC-currentSOC) / 100.0 * req.BatteryCapacity
	chargeRateKW := float64(req.ChargerVoltage) * float64(req.MaxAmps) / 1000.0
	// Add ~10% for charging losses
	kwhWithLoss := kwhNeeded * 1.10
	durationHours := kwhWithLoss / chargeRateKW
	durationCeilHours := int(math.Ceil(durationHours))

	if durationCeilHours <= 0 {
		durationCeilHours = 1
	}

	// Check if there's enough time before departure
	hoursUntilDepart := departBy.Sub(time.Now().UTC()).Hours()
	if float64(durationCeilHours) > hoursUntilDepart {
		writeError(w, http.StatusBadRequest, fmt.Sprintf(
			"not enough time: need %.1f hours but only %.1f hours until departure",
			durationHours, hoursUntilDepart,
		))
		return
	}

	// Build per-hour rates for the relevant season
	seasonName := seasonForDate(plan, departBy)
	season := plan.Seasons[seasonName]
	rates := buildHourlyRates(season)

	// Find cheapest contiguous window of durationCeilHours before depart_by
	type candidate struct {
		startHour    int
		cost         float64
		avgRateCents float64
		tier         string
	}

	now := time.Now().UTC()
	nowHour := now.Hour()

	// Build candidate list: all possible start hours
	var candidates []candidate
	for startH := 0; startH < 24; startH++ {
		// Simple feasibility: the window must not start before now or end after depart_by
		startTime := time.Date(departBy.Year(), departBy.Month(), departBy.Day(), startH, 0, 0, 0, departBy.Location())
		// If start is after depart_by, try previous day
		if startTime.After(departBy) {
			startTime = startTime.AddDate(0, 0, -1)
		}
		endTime := startTime.Add(time.Duration(durationCeilHours) * time.Hour)

		if startTime.Before(now) || endTime.After(departBy) {
			continue
		}

		cost, avgRate := costForWindow(rates, startH, durationCeilHours, kwhNeeded)

		// Determine the dominant tier
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
		writeError(w, http.StatusBadRequest, "no valid charging window found before departure")
		return
	}

	// Sort by cost ascending
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].cost < candidates[j].cost
	})

	best := candidates[0]

	// Calculate "charge now" cost
	chargeNowCost, _ := costForWindow(rates, nowHour, durationCeilHours, kwhNeeded)

	savings := chargeNowCost - best.cost
	savingsPct := 0.0
	if chargeNowCost > 0 {
		savingsPct = (savings / chargeNowCost) * 100.0
	}

	// Build schedule times
	bestStart := time.Date(departBy.Year(), departBy.Month(), departBy.Day(), best.startHour, 0, 0, 0, departBy.Location())
	if bestStart.After(departBy) {
		bestStart = bestStart.AddDate(0, 0, -1)
	}
	bestEnd := bestStart.Add(time.Duration(float64(time.Hour) * durationHours))

	// Persist draft plan
	planRepo := database.NewChargePlanRepo(h.db)
	estKwh := kwhNeeded
	estCost := best.cost
	dbPlan := &database.ChargePlan{
		VehicleID:      req.VehicleID,
		TargetSOC:      req.TargetSOC,
		DepartBy:       &departBy,
		ScheduledStart: bestStart,
		ScheduledEnd:   bestEnd,
		RatePlan:       req.RatePlanID,
		EstimatedKWh:   &estKwh,
		EstimatedCost:  &estCost,
		ChargeNowCost:  &chargeNowCost,
		Savings:        &savings,
		Status:         "draft",
	}
	if err := planRepo.Create(ctx, dbPlan); err != nil {
		log.Error().Err(err).Msg("failed to create charge plan")
		writeError(w, http.StatusInternalServerError, "failed to save plan")
		return
	}

	// Build alternatives (up to 3, excluding best)
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

	resp := optimizeResponse{
		PlanID:           dbPlan.ID,
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
	}

	log.Info().
		Int64("vehicle_id", req.VehicleID).
		Int64("plan_id", dbPlan.ID).
		Int("current_soc", currentSOC).
		Int("target_soc", req.TargetSOC).
		Float64("kwh_needed", kwhNeeded).
		Float64("optimized_cost", best.cost).
		Float64("savings", savings).
		Msg("charge plan optimized")

	writeJSON(w, http.StatusOK, resp)
}

// ── Apply Endpoint ───────────────────────────────────────────

// Apply handles POST /charge-planner/apply
func (h *ChargePlannerHandler) Apply(w http.ResponseWriter, r *http.Request) {
	var req applyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PlanID <= 0 {
		writeError(w, http.StatusBadRequest, "plan_id is required")
		return
	}

	ctx := r.Context()
	planRepo := database.NewChargePlanRepo(h.db)

	plan, err := planRepo.GetByID(ctx, req.PlanID)
	if err != nil {
		log.Error().Err(err).Int64("plan_id", req.PlanID).Msg("failed to fetch charge plan")
		writeError(w, http.StatusInternalServerError, "failed to fetch plan")
		return
	}
	if plan == nil {
		writeError(w, http.StatusNotFound, "charge plan not found")
		return
	}
	if plan.Status != "draft" {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("plan already %s", plan.Status))
		return
	}

	// Look up vehicle VIN
	vehicleRepo := database.NewVehicleRepo(h.db)
	vehicle, err := vehicleRepo.GetByID(ctx, plan.VehicleID)
	if err != nil || vehicle == nil {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}

	// 1. Set charge limit
	if err := h.teslaClient.SendCommand(ctx, vehicle.VIN, "set_charge_limit", map[string]interface{}{
		"percent": plan.TargetSOC,
	}); err != nil {
		log.Error().Err(err).Str("vin", vehicle.VIN).Msg("failed to set charge limit")
		writeError(w, http.StatusInternalServerError, "failed to set charge limit")
		return
	}

	// 2. Set scheduled charging time (minutes since midnight)
	startMinutes := plan.ScheduledStart.Hour()*60 + plan.ScheduledStart.Minute()
	if err := h.teslaClient.SendCommand(ctx, vehicle.VIN, "set_scheduled_charging", map[string]interface{}{
		"enable": true,
		"time":   startMinutes,
	}); err != nil {
		log.Error().Err(err).Str("vin", vehicle.VIN).Msg("failed to set scheduled charging")
		writeError(w, http.StatusInternalServerError, "failed to set scheduled charging")
		return
	}

	// 3. Update plan status
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "scheduled",
		"plan_id": plan.ID,
		"message": fmt.Sprintf("Charging scheduled at %s", plan.ScheduledStart.Format("15:04")),
	})
}

// ── History Endpoint ─────────────────────────────────────────

// ListPlans handles GET /charge-planner/history?vehicle_id=X
func (h *ChargePlannerHandler) ListPlans(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	limit, offset := pagination(r)

	planRepo := database.NewChargePlanRepo(h.db)
	plans, err := planRepo.ListByVehicle(r.Context(), vehicleID, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("failed to list charge plans")
		writeError(w, http.StatusInternalServerError, "failed to list charge plans")
		return
	}

	if plans == nil {
		plans = []*database.ChargePlan{}
	}

	writeJSON(w, http.StatusOK, plans)
}

// ── Rate Plans Endpoint ──────────────────────────────────────

// ListRatePlans handles GET /charge-planner/rate-plans
func (h *ChargePlannerHandler) ListRatePlans(w http.ResponseWriter, r *http.Request) {
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
	writeJSON(w, http.StatusOK, plans)
}
