package api

import (
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// SleepHandler handles sleep efficiency analytics requests.
type SleepHandler struct {
	db *database.DB
}

func NewSleepHandler(db *database.DB) *SleepHandler {
	return &SleepHandler{db: db}
}

func (h *SleepHandler) GetSleepAnalytics(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}

	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 365 {
			days = v
		}
	}

	ctx := r.Context()

	// Look up vehicle-specific battery capacity
	batteryCapacityKWh, capacitySource := lookupVehicleCapacity(ctx, h.db, vehicleID)

	// Time in each vehicle state
	type stateEntry struct {
		State        string  `json:"state"`
		Count        int     `json:"count"`
		TotalMinutes float64 `json:"total_minutes"`
	}

	rows, err := h.db.Pool.Query(ctx,
		`SELECT state, COUNT(*) as count,
		        COALESCE(SUM(duration_min), 0) as total_minutes
		 FROM vehicle_states
		 WHERE vehicle_id = $1 AND start_date > NOW() - make_interval(days => $2)
		 GROUP BY state`, vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: failed to get vehicle states")
		writeError(w, http.StatusInternalServerError, "failed to get sleep data")
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

	// Vampire drain events grouped by sentry mode
	type sentryGroup struct {
		SentryMode     bool    `json:"sentry_mode"`
		Count          int     `json:"count"`
		AvgDrainRate   float64 `json:"avg_drain_rate"`
		AvgDuration    float64 `json:"avg_duration_hours"`
		AvgBatteryLost float64 `json:"avg_battery_lost"`
		AvgTemp        float64 `json:"avg_temp"`
	}

	sentryRows, err := h.db.Pool.Query(ctx,
		`SELECT sentry_mode, COUNT(*) as count,
		        AVG(drain_rate_pct_per_hour) as avg_drain_rate,
		        AVG(duration_hours) as avg_duration,
		        AVG(battery_lost) as avg_battery_lost,
		        AVG(outside_temp_avg) as avg_temp
		 FROM vampire_drain_events
		 WHERE vehicle_id = $1 AND start_date > NOW() - make_interval(days => $2)
		 GROUP BY sentry_mode`, vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: failed to get drain by sentry")
		writeError(w, http.StatusInternalServerError, "failed to get sleep data")
		return
	}
	defer sentryRows.Close()

	var sentryComparison []sentryGroup
	var sentryOnDrainRate, sentryOffDrainRate float64
	var sentryOnHours float64
	for sentryRows.Next() {
		var g sentryGroup
		var avgDrain, avgDur, avgBat, avgTemp *float64
		if err := sentryRows.Scan(&g.SentryMode, &g.Count, &avgDrain, &avgDur, &avgBat, &avgTemp); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: sentry comparison row scan failed")
			continue
		}
		if avgDrain != nil {
			g.AvgDrainRate = math.Round(*avgDrain*100) / 100
		}
		if avgDur != nil {
			g.AvgDuration = math.Round(*avgDur*100) / 100
		}
		if avgBat != nil {
			g.AvgBatteryLost = math.Round(*avgBat*100) / 100
		}
		if avgTemp != nil {
			g.AvgTemp = math.Round(*avgTemp*10) / 10
		}
		if g.SentryMode {
			sentryOnDrainRate = g.AvgDrainRate
			sentryOnHours = g.AvgDuration
		} else {
			sentryOffDrainRate = g.AvgDrainRate
		}
		sentryComparison = append(sentryComparison, g)
	}
	if sentryComparison == nil {
		sentryComparison = make([]sentryGroup, 0)
	}

	// Recent drain events
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

	eventRows, err := h.db.Pool.Query(ctx,
		`SELECT id, start_date, end_date, duration_hours, battery_lost,
		        drain_rate_pct_per_hour, sentry_mode, outside_temp_avg,
		        start_battery, end_battery
		 FROM vampire_drain_events
		 WHERE vehicle_id = $1 ORDER BY start_date DESC LIMIT 20`, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: failed to get recent drain events")
		writeError(w, http.StatusInternalServerError, "failed to get sleep data")
		return
	}
	defer eventRows.Close()

	var recentEvents []drainEvent
	for eventRows.Next() {
		var e drainEvent
		var startDate, endDate interface{}
		if err := eventRows.Scan(&e.ID, &startDate, &endDate, &e.DurationHours, &e.BatteryLost,
			&e.DrainRate, &e.SentryMode, &e.OutsideTemp, &e.StartBattery, &e.EndBattery); err != nil {
			log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("sleep: drain event row scan failed")
			continue
		}
		if t, ok := startDate.(interface{ Format(string) string }); ok {
			e.StartDate = t.Format("2006-01-02T15:04:05Z")
		}
		if t, ok := endDate.(interface{ Format(string) string }); ok {
			e.EndDate = t.Format("2006-01-02T15:04:05Z")
		}
		e.DurationHours = math.Round(e.DurationHours*100) / 100
		e.BatteryLost = math.Round(e.BatteryLost*100) / 100
		e.DrainRate = math.Round(e.DrainRate*100) / 100
		recentEvents = append(recentEvents, e)
	}
	if recentEvents == nil {
		recentEvents = make([]drainEvent, 0)
	}

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

	// Estimate sentry monthly cost
	hoursPerMonth := 730.0 // avg hours in a month
	sentryMonthlyKWh := sentryOnDrainRate / 100 * batteryCapacityKWh * hoursPerMonth
	sentryMonthlyCost := sentryMonthlyKWh * baseCostPerKWh

	// Extra drain from sentry = sentry drain - no-sentry drain
	extraDrainRate := sentryOnDrainRate - sentryOffDrainRate
	if extraDrainRate < 0 {
		extraDrainRate = 0
	}
	extraMonthlyKWh := extraDrainRate / 100 * batteryCapacityKWh * hoursPerMonth
	extraMonthlyCost := extraMonthlyKWh * baseCostPerKWh

	// Avg time to sleep (from vehicle_states: time between 'online' and 'asleep')
	var avgTimeToSleepMin *float64
	err = h.db.Pool.QueryRow(ctx,
		`SELECT AVG(duration_min) FROM vehicle_states
		 WHERE vehicle_id = $1 AND state = 'online'
		 AND start_date > NOW() - make_interval(days => $2)`, vehicleID, days,
	).Scan(&avgTimeToSleepMin)
	if err != nil {
		avgTimeToSleepMin = nil
	}

	var timeToSleepAvg float64
	if avgTimeToSleepMin != nil {
		timeToSleepAvg = math.Round(*avgTimeToSleepMin*10) / 10
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":             vehicleID,
		"period_days":            days,
		"state_distribution":     stateDistribution,
		"sleep_efficiency_pct":   math.Round(sleepEfficiencyPct*10) / 10,
		"time_to_sleep_avg_min":  timeToSleepAvg,
		"sentry_comparison":      sentryComparison,
		"sentry_on_drain_rate":   sentryOnDrainRate,
		"sentry_off_drain_rate":  sentryOffDrainRate,
		"sentry_monthly_kwh":     math.Round(sentryMonthlyKWh*100) / 100,
		"sentry_monthly_cost":    math.Round(sentryMonthlyCost*100) / 100,
		"sentry_extra_drain_rate": math.Round(extraDrainRate*100) / 100,
		"sentry_extra_monthly_kwh":  math.Round(extraMonthlyKWh*100) / 100,
		"sentry_extra_monthly_cost": math.Round(extraMonthlyCost*100) / 100,
		"battery_capacity_kwh":  batteryCapacityKWh,
		"capacity_source":       capacitySource,
		"base_cost_per_kwh":     baseCostPerKWh,
		"recent_events":         recentEvents,
		"total_events":          len(recentEvents),
		"avg_sentry_duration_hours": sentryOnHours,
	})
}
