package api

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// YearReviewHandler serves Spotify Wrapped-style annual driving reports.
type YearReviewHandler struct {
	db *database.DB
}

// NewYearReviewHandler creates a new YearReviewHandler.
func NewYearReviewHandler(db *database.DB) *YearReviewHandler {
	return &YearReviewHandler{db: db}
}

type driveHighlight struct {
	DriveID        int64   `json:"drive_id"`
	Date           string  `json:"date"`
	DistanceKm     float64 `json:"distance_km"`
	DurationMin    int     `json:"duration_min"`
	StartAddress   string  `json:"start_address"`
	EndAddress     string  `json:"end_address"`
	EfficiencyWhKm float64 `json:"efficiency_wh_km"`
}

type monthStat struct {
	Month      int     `json:"month"`
	Drives     int     `json:"drives"`
	DistanceKm float64 `json:"distance_km"`
	EnergyKwh  float64 `json:"energy_kwh"`
	Cost       float64 `json:"cost"`
}

type comparison struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Emoji string `json:"emoji"`
}

// safeFloat guards against NaN/Inf which break json.Encode.
func safeFloatYR(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func roundYR(v float64, decimals int) float64 {
	p := math.Pow(10, float64(decimals))
	return safeFloatYR(math.Round(v*p) / p)
}

// GetYearReview returns a full-year aggregation for a single vehicle.
func (h *YearReviewHandler) GetYearReview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse required vehicle_id
	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	// Parse year (default: current year)
	year := time.Now().Year()
	if y := r.URL.Query().Get("year"); y != "" {
		parsed, err := strconv.Atoi(y)
		if err != nil || parsed < 2010 || parsed > 2100 {
			writeError(w, http.StatusBadRequest, "invalid year")
			return
		}
		year = parsed
	}

	log.Info().Int64("vehicle_id", vehicleID).Int("year", year).Msg("year-review: computing")

	yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	yearEnd := time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC)

	// ── Vehicle info ──
	var vDisplayName, vModel string
	err = h.db.Pool.QueryRow(ctx,
		`SELECT display_name, COALESCE(model, '') FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vDisplayName, &vModel)
	if err != nil {
		if err == pgx.ErrNoRows {
			writeError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		log.Error().Err(err).Msg("year-review: failed to get vehicle")
		writeError(w, http.StatusInternalServerError, "failed to get vehicle")
		return
	}

	// ── Driving aggregates ──
	var totalDrives int
	var totalDistKm, totalDrivingMin float64
	var fastestSpeed, coldestTemp, hottestTemp *float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(distance_mi), 0),
		       COALESCE(SUM(duration_min), 0),
		       MAX(max_speed_mph),
		       MIN(outside_temp_avg),
		       MAX(outside_temp_avg)
		FROM drives
		WHERE vehicle_id = $1
		  AND end_ts IS NOT NULL
		  AND distance_mi > 0
		  AND start_ts >= $2
		  AND start_ts < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&totalDrives, &totalDistKm, &totalDrivingMin, &fastestSpeed, &coldestTemp, &hottestTemp)
	if err != nil {
		log.Error().Err(err).Msg("year-review: failed to get drive stats")
		writeError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	// Range-based efficiency unavailable (range columns removed from drives)
	var avgEffWhKm float64

	// ── Charging aggregates ──
	var totalChargeSessions int
	var totalEnergyKwh, totalChargingCost float64
	err = h.db.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(energy_added_kwh), 0),
		       COALESCE(SUM(CASE WHEN cost > 0 THEN cost ELSE 0 END), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		  AND end_ts IS NOT NULL
		  AND start_ts >= $2
		  AND start_ts < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&totalChargeSessions, &totalEnergyKwh, &totalChargingCost)
	if err != nil {
		log.Error().Err(err).Msg("year-review: failed to get charging stats")
		writeError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	// ── Gas savings ──
	var gasPrice, gasEffMPG float64
	err = h.db.Pool.QueryRow(ctx,
		`SELECT
		  COALESCE((SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'), 3.50),
		  COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25)`,
	).Scan(&gasPrice, &gasEffMPG)
	if err != nil && err != pgx.ErrNoRows {
		log.Warn().Err(err).Msg("year-review: failed to get settings, using defaults")
	}
	if gasPrice <= 0 {
		gasPrice = 3.50
	}
	if gasEffMPG <= 0 {
		gasEffMPG = 25
	}

	var gasSavings float64
	if totalDistKm > 0 {
		totalMiles := totalDistKm / 1.60934
		gasEquivCost := (totalMiles / gasEffMPG) * gasPrice
		gasSavings = gasEquivCost - totalChargingCost
		if gasSavings < 0 {
			gasSavings = 0
		}
	}

	// CO₂ offset: avg ICE emits ~192g CO₂/km
	co2OffsetKg := totalDistKm * 0.192

	// ── Drive highlights (extremes) ──
	scanHighlight := func(query string, args ...interface{}) *driveHighlight {
		var dh driveHighlight
		var startDate time.Time
		var durMin float64
		var startAddr, endAddr *string
		err := h.db.Pool.QueryRow(ctx, query, args...).Scan(
			&dh.DriveID, &startDate, &dh.DistanceKm, &durMin,
			&startAddr, &endAddr,
		)
		if err != nil {
			return nil
		}
		dh.Date = startDate.Format("2006-01-02")
		dh.DurationMin = int(durMin)
		if startAddr != nil {
			dh.StartAddress = *startAddr
		}
		if endAddr != nil {
			dh.EndAddress = *endAddr
		}
		dh.DistanceKm = roundYR(dh.DistanceKm, 1)
		return &dh
	}

	highlightBase := `
		SELECT id, start_ts, distance_mi, duration_min,
		       start_address, end_address
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL AND distance_mi > 0
		  AND start_ts >= $2 AND start_ts < $3`

	longestDrive := scanHighlight(highlightBase+" ORDER BY distance_mi DESC LIMIT 1", vehicleID, yearStart, yearEnd)
	shortestDrive := scanHighlight(highlightBase+" AND distance_mi >= 1 ORDER BY distance_mi ASC LIMIT 1", vehicleID, yearStart, yearEnd)

	// Efficiency extremes unavailable (range columns removed from drives)
	var mostEfficient *driveHighlight
	var leastEfficient *driveHighlight

	// ── Monthly breakdown (always 12 entries) ──
	monthlyMap := make(map[int]*monthStat)
	for m := 1; m <= 12; m++ {
		monthlyMap[m] = &monthStat{Month: m}
	}

	// Drives per month
	driveMonthRows, err := h.db.Pool.Query(ctx, `
		SELECT EXTRACT(MONTH FROM start_ts)::int AS m, COUNT(*), COALESCE(SUM(distance_mi), 0)
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL AND distance_mi > 0
		  AND start_ts >= $2 AND start_ts < $3
		GROUP BY m`,
		vehicleID, yearStart, yearEnd)
	if err == nil {
		defer driveMonthRows.Close()
		for driveMonthRows.Next() {
			var m, cnt int
			var dist float64
			if driveMonthRows.Scan(&m, &cnt, &dist) == nil {
				if ms, ok := monthlyMap[m]; ok {
					ms.Drives = cnt
					ms.DistanceKm = roundYR(dist, 1)
				}
			}
		}
		driveMonthRows.Close()
	}

	// Charging per month
	chargeMonthRows, err := h.db.Pool.Query(ctx, `
		SELECT EXTRACT(MONTH FROM start_ts)::int AS m,
		       COALESCE(SUM(energy_added_kwh), 0),
		       COALESCE(SUM(CASE WHEN cost > 0 THEN cost ELSE 0 END), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL
		  AND start_ts >= $2 AND start_ts < $3
		GROUP BY m`,
		vehicleID, yearStart, yearEnd)
	if err == nil {
		defer chargeMonthRows.Close()
		for chargeMonthRows.Next() {
			var m int
			var energy, cost float64
			if chargeMonthRows.Scan(&m, &energy, &cost) == nil {
				if ms, ok := monthlyMap[m]; ok {
					ms.EnergyKwh = roundYR(energy, 1)
					ms.Cost = roundYR(cost, 2)
				}
			}
		}
		chargeMonthRows.Close()
	}

	monthlyStats := make([]monthStat, 0, 12)
	for m := 1; m <= 12; m++ {
		monthlyStats = append(monthlyStats, *monthlyMap[m])
	}

	// ── Patterns: day of week, hour ──
	mostActiveDOW := ""
	var dowIdx, dowCnt int
	if err := h.db.Pool.QueryRow(ctx, `
		SELECT EXTRACT(DOW FROM start_ts)::int AS dow, COUNT(*) AS cnt
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL AND distance_mi > 0
		  AND start_ts >= $2 AND start_ts < $3
		GROUP BY dow ORDER BY cnt DESC LIMIT 1`,
		vehicleID, yearStart, yearEnd,
	).Scan(&dowIdx, &dowCnt); err == nil {
		dayNames := []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
		if dowIdx >= 0 && dowIdx < 7 {
			mostActiveDOW = dayNames[dowIdx]
		}
	}

	mostActiveHour := 0
	var hrIdx, hrCnt int
	if err := h.db.Pool.QueryRow(ctx, `
		SELECT EXTRACT(HOUR FROM start_ts)::int AS hr, COUNT(*) AS cnt
		FROM drives
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL AND distance_mi > 0
		  AND start_ts >= $2 AND start_ts < $3
		GROUP BY hr ORDER BY cnt DESC LIMIT 1`,
		vehicleID, yearStart, yearEnd,
	).Scan(&hrIdx, &hrCnt); err == nil {
		mostActiveHour = hrIdx
	}

	// Average drives per week
	var avgDrivesPerWeek float64
	weeksInYear := 52.0
	now := time.Now().UTC()
	if yearEnd.After(now) {
		// Partial year — compute weeks elapsed
		elapsed := now.Sub(yearStart)
		if elapsed > 0 {
			weeksInYear = elapsed.Hours() / (24 * 7)
			if weeksInYear < 1 {
				weeksInYear = 1
			}
		}
	}
	if totalDrives > 0 {
		avgDrivesPerWeek = float64(totalDrives) / weeksInYear
	}

	avgDistPerDrive := 0.0
	if totalDrives > 0 {
		avgDistPerDrive = totalDistKm / float64(totalDrives)
	}

	// ── Charging habits breakdown ──
	var superchargerCnt, dcFastCnt, acOtherCnt int
	chargeTypeRows, err := h.db.Pool.Query(ctx, `
		SELECT
			CASE
				WHEN fast_charger_type IS NOT NULL AND fast_charger_brand = 'Tesla' THEN 'supercharger'
				WHEN fast_charger_type IS NOT NULL THEN 'dc_fast'
				ELSE 'ac_other'
			END AS ctype,
			COUNT(*)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL
		  AND start_ts >= $2 AND start_ts < $3
		GROUP BY ctype`,
		vehicleID, yearStart, yearEnd)
	if err == nil {
		defer chargeTypeRows.Close()
		for chargeTypeRows.Next() {
			var ct string
			var cnt int
			if chargeTypeRows.Scan(&ct, &cnt) == nil {
				switch ct {
				case "supercharger":
					superchargerCnt = cnt
				case "dc_fast":
					dcFastCnt = cnt
				default:
					acOtherCnt = cnt
				}
			}
		}
		chargeTypeRows.Close()
	}

	totalChargeForPct := superchargerCnt + dcFastCnt + acOtherCnt
	superchargerPct := 0.0
	dcFastPct := 0.0
	acOtherPct := 0.0
	if totalChargeForPct > 0 {
		superchargerPct = float64(superchargerCnt) / float64(totalChargeForPct) * 100
		dcFastPct = float64(dcFastCnt) / float64(totalChargeForPct) * 100
		acOtherPct = float64(acOtherCnt) / float64(totalChargeForPct) * 100
	}

	// Average charge start SOC
	var avgChargeStartSOC float64
	_ = h.db.Pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(start_battery_pct), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND end_ts IS NOT NULL AND start_battery_pct > 0
		  AND start_ts >= $2 AND start_ts < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&avgChargeStartSOC)

	// ── Fun comparisons ──
	km := totalDistKm
	comparisons := []comparison{
		{Label: "Paris round-trips", Value: fmt.Sprintf("%.1f", km/1085), Emoji: "🗼"},
		{Label: "Times around Central Park", Value: fmt.Sprintf("%.0f", km/10.4), Emoji: "🌳"},
		{Label: "Marathons", Value: fmt.Sprintf("%.0f", km/42.195), Emoji: "🏃"},
		{Label: "CO₂ offset", Value: fmt.Sprintf("%.0f kg — like planting %d trees", co2OffsetKg, int(co2OffsetKg/21)), Emoji: "🌱"},
	}
	if gasSavings > 0 {
		comparisons = append(comparisons,
			comparison{Label: "Gas money saved", Value: fmt.Sprintf("$%.0f — that's %d cups of coffee!", gasSavings, int(gasSavings/5)), Emoji: "☕"},
		)
	}
	if totalDrivingMin > 0 {
		comparisons = append(comparisons,
			comparison{Label: "Hours on the road", Value: fmt.Sprintf("%.0f hours — %d movies!", totalDrivingMin/60, int(totalDrivingMin)/120), Emoji: "🎬"},
		)
	}

	// ── Build response ──
	result := map[string]interface{}{
		"year": year,
		"vehicle": map[string]interface{}{
			"id":           vehicleID,
			"display_name": vDisplayName,
			"model":        vModel,
		},

		// Headline stats
		"total_drives":           totalDrives,
		"total_distance_km":      roundYR(totalDistKm, 1),
		"total_energy_kwh":       roundYR(totalEnergyKwh, 1),
		"total_charge_sessions":  totalChargeSessions,
		"total_driving_minutes":  int(totalDrivingMin),
		"total_charging_cost":    roundYR(totalChargingCost, 2),
		"gas_savings":            roundYR(gasSavings, 2),
		"co2_offset_kg":          roundYR(co2OffsetKg, 1),

		// Extremes
		"longest_drive":          longestDrive,
		"shortest_drive":         shortestDrive,
		"most_efficient_drive":   mostEfficient,
		"least_efficient_drive":  leastEfficient,
		"fastest_speed_kmh":      roundYR(derefFloat(fastestSpeed), 1),
		"coldest_drive_temp_c":   roundYR(derefFloat(coldestTemp), 1),
		"hottest_drive_temp_c":   roundYR(derefFloat(hottestTemp), 1),

		// Monthly breakdown
		"monthly_stats": monthlyStats,

		// Patterns
		"most_active_day_of_week":   mostActiveDOW,
		"most_active_hour":          mostActiveHour,
		"avg_drives_per_week":       roundYR(avgDrivesPerWeek, 1),
		"avg_distance_per_drive_km": roundYR(avgDistPerDrive, 1),
		"avg_efficiency_wh_km":      roundYR(avgEffWhKm, 1),

		// Charging habits
		"supercharger_pct":    roundYR(superchargerPct, 1),
		"dc_fast_pct":         roundYR(dcFastPct, 1),
		"ac_other_pct":        roundYR(acOtherPct, 1),
		"avg_charge_start_soc": roundYR(avgChargeStartSOC, 1),

		// Fun comparisons
		"comparisons": comparisons,
	}

	writeJSON(w, http.StatusOK, result)
}

func derefFloat(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
