package sleep

import (
	"context"
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
// Phase-42 (prompt 0077): vehicle_states and vampire_drain_events were
// dropped without SI replacement. Vehicle-state distribution is now
// derived from fsm_transitions (000187); the sentry-vs-vampire drain
// comparison is preserved as zero-valued JSON keys so the frontend
// contract is unchanged. The drain field is absent from typed signal_log
// without per-park reconstruction; restoring sentry/drain analytics
// requires a follow-on prompt that adds a per-sleep aggregation pass.
type SleepHandler struct {
	db *database.DB
}

func NewSleepHandler(db *database.DB) *SleepHandler {
	return &SleepHandler{db: db}
}

func (h *SleepHandler) GetSleepAnalytics(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	// Canonical filter shape: explicit start/end (YYYY-MM-DD) takes
	// precedence so the UI's RangePicker can request arbitrary historical
	// windows. The legacy `days` param remains as a backward-compatible
	// fallback for dashboard widgets that pass a rolling-from-now window.
	days := 30
	var from, to time.Time
	if s, e := apiparams.ParseDateRange(r); !s.IsZero() {
		from = s
		if !e.IsZero() {
			to = e
		} else {
			to = time.Now().UTC()
		}
		if d := int(math.Round(to.Sub(from).Hours() / 24)); d > 0 {
			days = d
		}
	} else {
		if d := r.URL.Query().Get("days"); d != "" {
			if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 365 {
				days = v
			}
		}
		from = time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)
		to = time.Now().UTC()
	}

	ctx := r.Context()

	// Look up vehicle-specific battery capacity
	batteryCapacityWh, capacitySource := lookupVehicleCapacityWh(ctx, h.db, vehicleID)

	// Time in each vehicle state — derived from fsm_transitions (000187).
	// Each row represents the count of transitions INTO a given state in
	// the window; total_minutes is left at 0 because the legacy
	// per-row dwell-time field has no direct counterpart in the
	// transition log without a paired next-transition lookup.
	type stateEntry struct {
		State        string  `json:"state"`
		Count        int     `json:"count"`
		TotalMinutes float64 `json:"total_minutes"`
	}

	rows, err := h.db.Pool.Query(ctx,
		`SELECT to_state AS state, COUNT(*) AS count, 0::float AS total_minutes
		 FROM fsm_transitions
		 WHERE vehicle_id = $1
		   AND fsm_name = 'vehicle'
		   AND ts > $2 AND ts <= $3
		 GROUP BY to_state`, vehicleID, from, to)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: failed to get fsm_transitions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get sleep data")
		return
	}
	defer rows.Close()

	var stateDistribution []stateEntry
	var totalMinutesAll float64
	var sleepMinutes float64
	for rows.Next() {
		var e stateEntry
		if err := rows.Scan(&e.State, &e.Count, &e.TotalMinutes); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: state distribution row scan failed")
			continue
		}
		totalMinutesAll += e.TotalMinutes
		if e.State == enums.StateAsleep {
			sleepMinutes = e.TotalMinutes
		}
		stateDistribution = append(stateDistribution, e)
	}
	if stateDistribution == nil {
		stateDistribution = make([]stateEntry, 0)
	}

	sleepEfficiencyPct := 0.0
	if totalMinutesAll > 0 {
		sleepEfficiencyPct = (sleepMinutes / totalMinutesAll) * 100
	}

	// Phase-42 (prompt 0077): sentry-vs-vampire drain comparison removed
	// (vampire_drain_events table dropped). Frontend keys are preserved
	// with empty/zero values to avoid breaking the contract.
	type sentryGroup struct {
		SentryMode     bool    `json:"sentry_mode"`
		Count          int     `json:"count"`
		AvgDrainRate   float64 `json:"avg_drain_rate"`
		AvgDuration    float64 `json:"avg_duration_hours"`
		AvgBatteryLost float64 `json:"avg_battery_lost"`
		AvgTemp        float64 `json:"avg_temp"`
	}
	sentryComparison := make([]sentryGroup, 0)
	var sentryOnDrainRate, sentryOffDrainRate float64
	var sentryOnHours float64

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
	recentEvents := make([]drainEvent, 0)

	// Get settings for cost calculations
	var baseCostPerKWh float64
	err = h.db.Pool.QueryRow(ctx,
		`SELECT COALESCE((SELECT value_num FROM settings WHERE key = 'base_cost_per_kwh'), 0.12)`,
	).Scan(&baseCostPerKWh)
	if err != nil && err != pgx.ErrNoRows {
		baseCostPerKWh = 0.12
	}
	if err == pgx.ErrNoRows {
		baseCostPerKWh = 0.12
	}

	// Estimate sentry monthly cost — preserved as zero-valued cost since
	// sentryOnDrainRate/sentryOffDrainRate are 0 until per-park drain
	// reconstruction is reintroduced.
	hoursPerMonth := 730.0 // avg hours in a month
	sentryMonthlyKWh := sentryOnDrainRate / 100 * (batteryCapacityWh / 1000.0) * hoursPerMonth
	sentryMonthlyCost := sentryMonthlyKWh * baseCostPerKWh

	extraDrainRate := sentryOnDrainRate - sentryOffDrainRate
	if extraDrainRate < 0 {
		extraDrainRate = 0
	}
	extraMonthlyKWh := extraDrainRate / 100 * (batteryCapacityWh / 1000.0) * hoursPerMonth
	extraMonthlyCost := extraMonthlyKWh * baseCostPerKWh

	// Phase-42 (prompt 0077): the avg-time-to-sleep query against
	// vehicle_states is gone; the value is preserved at 0 until a
	// follow-on prompt re-derives it from fsm_transitions Online→Asleep
	// pairing.
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

// lookupVehicleCapacityWh fetches VIN and model for a vehicle ID and estimates
// battery capacity. Falls back to 75000 Wh / "default" on any lookup error.
func lookupVehicleCapacityWh(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75000.0, "default"
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
