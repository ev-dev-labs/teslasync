package sleep

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// SleepHandler handles sleep efficiency analytics requests.
//
// vehicle_states and vampire_drain_events were dropped without SI
// replacement. Vehicle-state distribution is now derived from
// fsm_transitions (000187); the sentry-vs-vampire drain comparison is
// preserved as zero-valued JSON keys so the frontend contract is
// unchanged. The drain field is absent from typed signal_log without
// per-park reconstruction; restoring sentry/drain analytics requires a
// follow-on prompt that adds a per-sleep aggregation pass.
//
// The data surface is reached through sleepRepository so the handler can
// be exercised without a live database; clock is injectable so the
// rolling window is deterministic under test.
type SleepHandler struct {
	repo  sleepRepository
	clock func() time.Time
}

// NewSleepHandler binds the handler to the production pgx-backed repo.
func NewSleepHandler(db *database.DB) *SleepHandler {
	return &SleepHandler{repo: newDBSleepRepo(db)}
}

const (
	// sleepDefaultDays is the rolling window used when neither an explicit
	// start/end range nor a valid days param is supplied.
	sleepDefaultDays = 30
	// sleepMaxDays caps the legacy days param. The explicit start/end
	// range is intentionally uncapped so the UI RangePicker can request
	// arbitrary historical windows.
	sleepMaxDays = 365
	// defaultBaseCostPerKWh is the fallback electricity price when the
	// base_cost_per_kwh setting is absent or unreadable.
	defaultBaseCostPerKWh = 0.12
	// defaultBatteryCapacityWh is the fallback pack size when neither VIN
	// nor model yields an estimate.
	defaultBatteryCapacityWh = 75000.0
	// sentryHoursPerMonth projects an hourly sentry drain rate into a
	// monthly kWh / cost figure.
	sentryHoursPerMonth = 730.0
)

// stateEntry is one bucket in the state_distribution response array.
// Snake-case JSON tags match the frontend contract.
type stateEntry struct {
	State        string  `json:"state"`
	Count        int     `json:"count"`
	TotalMinutes float64 `json:"total_minutes"`
}

// sentryGroup preserves the legacy sentry-vs-vampire comparison shape.
// It is emitted as an empty array until per-park drain reconstruction
// returns.
type sentryGroup struct {
	SentryMode     bool    `json:"sentry_mode"`
	Count          int     `json:"count"`
	AvgDrainRate   float64 `json:"avg_drain_rate"`
	AvgDuration    float64 `json:"avg_duration_hours"`
	AvgBatteryLost float64 `json:"avg_battery_lost"`
	AvgTemp        float64 `json:"avg_temp"`
}

// drainEvent preserves the legacy recent-events shape. It is emitted as an
// empty array until per-park drain reconstruction returns.
type drainEvent struct {
	ID            int64    `json:"id"`
	StartDate     string   `json:"start_date"`
	EndDate       string   `json:"end_date"`
	DurationHours float64  `json:"duration_hours"`
	BatteryLost   float64  `json:"battery_lost"`
	DrainRate     float64  `json:"drain_rate"`
	SentryMode    bool     `json:"sentry_mode"`
	OutsideTemp   *float64 `json:"outside_temp"`
	StartBattery  float64  `json:"start_battery"`
	EndBattery    float64  `json:"end_battery"`
}

// now returns the injected clock or wall-clock UTC time. Centralising the
// time source keeps the window start/end and the reported period_days
// derived from a single instant per request and lets tests pin the window.
func (h *SleepHandler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}

// GetSleepAnalytics serves GET /analytics/sleep?vehicle_id=...&days=N (or
// &start=&end=). It returns 400 for a missing/invalid vehicle_id, 500 when
// the fsm_transitions read fails, and 200 with the analytics envelope
// otherwise. Battery-capacity and electricity-price enrichment degrade to
// defaults rather than failing the request.
func (h *SleepHandler) GetSleepAnalytics(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	days, from, to := resolveWindow(r, h.now())

	ctx := r.Context()

	vin, model, capErr := h.repo.VehicleVINModel(ctx, vehicleID)
	batteryCapacityWh, capacitySource := resolveCapacity(vin, model, capErr)

	states, err := h.repo.StateDistribution(ctx, vehicleID, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: failed to get fsm_transitions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get sleep data")
		return
	}
	stateDistribution, sleepEfficiencyPct := summarizeStates(states)

	baseCostPerKWh := h.baseCost(ctx, vehicleID)

	// Sentry-vs-vampire drain comparison is unavailable because
	// vampire_drain_events was dropped. Frontend keys are preserved with
	// empty/zero values to avoid breaking the contract until per-park
	// drain reconstruction returns.
	sentryComparison := make([]sentryGroup, 0)
	recentEvents := make([]drainEvent, 0)
	var sentryOnDrainRate, sentryOffDrainRate, sentryOnHours float64

	// Estimate sentry monthly cost — zero until per-park drain
	// reconstruction repopulates sentryOnDrainRate / sentryOffDrainRate.
	sentryMonthlyKWh := sentryOnDrainRate / 100 * (batteryCapacityWh / 1000.0) * sentryHoursPerMonth
	sentryMonthlyCost := sentryMonthlyKWh * baseCostPerKWh

	extraDrainRate := sentryOnDrainRate - sentryOffDrainRate
	if extraDrainRate < 0 {
		extraDrainRate = 0
	}
	extraMonthlyKWh := extraDrainRate / 100 * (batteryCapacityWh / 1000.0) * sentryHoursPerMonth
	extraMonthlyCost := extraMonthlyKWh * baseCostPerKWh

	// The avg-time-to-sleep query against vehicle_states is gone; the
	// value is preserved at 0 until it can be re-derived from
	// fsm_transitions Online→Asleep pairing.
	var timeToSleepAvg float64

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":                vehicleID,
		"period_days":               days,
		"state_distribution":        stateDistribution,
		"sleep_efficiency_pct":      math.Round(sleepEfficiencyPct*10) / 10,
		"time_to_sleep_avg_min":     timeToSleepAvg,
		"sentry_comparison":         sentryComparison,
		"sentry_on_drain_rate":      sentryOnDrainRate,
		"sentry_off_drain_rate":     sentryOffDrainRate,
		"sentry_monthly_kwh":        math.Round(sentryMonthlyKWh*100) / 100,
		"sentry_monthly_cost":       math.Round(sentryMonthlyCost*100) / 100,
		"sentry_extra_drain_rate":   math.Round(extraDrainRate*100) / 100,
		"sentry_extra_monthly_kwh":  math.Round(extraMonthlyKWh*100) / 100,
		"sentry_extra_monthly_cost": math.Round(extraMonthlyCost*100) / 100,
		"battery_capacity_wh":       batteryCapacityWh,
		"capacity_source":           capacitySource,
		"base_cost_per_kwh":         baseCostPerKWh,
		"recent_events":             recentEvents,
		"total_events":              len(recentEvents),
		"avg_sentry_duration_hours": sentryOnHours,
	})
}

// resolveWindow derives the reporting window from the request. Explicit
// start/end (YYYY-MM-DD or RFC 3339 via apiparams.ParseDateRange) takes
// precedence so the UI RangePicker can request arbitrary historical
// windows; the legacy days param is the backward-compatible
// rolling-from-now fallback. now is injected so the window is
// deterministic under test.
func resolveWindow(r *http.Request, now time.Time) (days int, from, to time.Time) {
	days = sleepDefaultDays
	if s, e := apiparams.ParseDateRange(r); !s.IsZero() {
		from = s
		if !e.IsZero() {
			to = e
		} else {
			to = now
		}
		if d := int(math.Round(to.Sub(from).Hours() / 24)); d > 0 {
			days = d
		}
	} else {
		if d := r.URL.Query().Get("days"); d != "" {
			if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= sleepMaxDays {
				days = v
			}
		}
		from = now.Add(-time.Duration(days) * 24 * time.Hour)
		to = now
	}
	return days, from, to
}

// summarizeStates converts repo state buckets into the response array and
// computes sleep efficiency as asleep-minutes over total-minutes. The
// current SI query pins total_minutes to 0, so efficiency stays 0 until
// per-transition dwell reconstruction lands; the math is retained so the
// value populates automatically once the repo supplies real dwell times.
func summarizeStates(states []stateCount) (distribution []stateEntry, efficiencyPct float64) {
	distribution = make([]stateEntry, 0, len(states))
	var totalMinutesAll, sleepMinutes float64
	for _, s := range states {
		distribution = append(distribution, stateEntry{
			State:        s.State,
			Count:        s.Count,
			TotalMinutes: s.TotalMinutes,
		})
		totalMinutesAll += s.TotalMinutes
		if s.State == enums.StateAsleep {
			sleepMinutes = s.TotalMinutes
		}
	}
	if totalMinutesAll > 0 {
		efficiencyPct = (sleepMinutes / totalMinutesAll) * 100
	}
	return distribution, efficiencyPct
}

// baseCost reads the operator electricity price, falling back to
// defaultBaseCostPerKWh on any error. A genuine transport error (not
// pgx.ErrNoRows, which the COALESCE query cannot return) is logged so the
// silent fallback is observable.
func (h *SleepHandler) baseCost(ctx context.Context, vehicleID int64) float64 {
	cost, err := h.repo.BaseCostPerKWh(ctx)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: base_cost_per_kwh lookup failed, using default")
		}
		return defaultBaseCostPerKWh
	}
	return cost
}

// resolveCapacity turns a VIN/model lookup result into a battery capacity
// estimate. A lookup error (including an unknown vehicle) degrades to the
// default pack size rather than failing the request — capacity is an
// enrichment field, not the primary payload.
func resolveCapacity(vin string, model *string, lookupErr error) (float64, string) {
	if lookupErr != nil {
		return defaultBatteryCapacityWh, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return estimateBatteryCapacityWh(vin, m)
}

// estimateBatteryCapacityWh returns the best-effort battery capacity in Wh
// and a source string indicating how the estimate was derived.
func estimateBatteryCapacityWh(vin string, model string) (float64, string) {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A':
			return 100000.0, "vin_estimate"
		case 'P':
			return 100000.0, "vin_estimate"
		}
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
}
