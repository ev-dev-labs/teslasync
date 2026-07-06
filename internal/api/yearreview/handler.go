package yearreview

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// yearReviewQueryBudget bounds the whole year-review request. The handler
// fans out ~13 sequential aggregations across drives, charging_sessions,
// settings and vehicles; a single overall deadline guarantees a stuck or
// slow database can never hang the request beyond this budget, independent
// of the per-connection statement_timeout.
const yearReviewQueryBudget = 15 * time.Second

// dbQuerier is the read port Handler depends on: the Query + QueryRow subset
// of database.DBTX that *pgxpool.Pool satisfies directly. Depending on this
// narrow interface (interface segregation) rather than the concrete
// *database.DB keeps the handler unit-testable with an in-memory fake — no
// live Postgres required — while NewHandler still wires the real pool in
// production.
type dbQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Handler serves Spotify Wrapped-style annual driving reports.
type Handler struct {
	q dbQuerier
}

// NewHandler creates an annual report handler.
func NewHandler(db *database.DB) *Handler {
	return &Handler{q: db.Pool}
}

type driveHighlight struct {
	DriveID        int64
	Date           string
	DistanceKm     float64
	DurationS      int64
	StartAddress   string
	EndAddress     string
	EfficiencyWhKm float64
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

func roundYR(v float64, decimals int) float64 {
	p := math.Pow(10, float64(decimals))
	return safeFloat(math.Round(v*p) / p)
}

// GetYearReview returns a full-year aggregation for a single vehicle.
func (h *Handler) GetYearReview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), yearReviewQueryBudget)
	defer cancel()

	vidStr := r.URL.Query().Get("vehicle_id")
	if vidStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vidStr, 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	year := time.Now().Year()
	if y := r.URL.Query().Get("year"); y != "" {
		parsed, err := strconv.Atoi(y)
		if err != nil || parsed < 2010 || parsed > 2100 {
			httpx.WriteError(w, http.StatusBadRequest, "invalid year")
			return
		}
		year = parsed
	}

	log.Info().Int64("vehicle_id", vehicleID).Int("year", year).Msg("year-review: computing")

	yearStart := time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC)
	yearEnd := time.Date(year+1, 1, 1, 0, 0, 0, 0, time.UTC)

	var vDisplayName, vModel string
	err = h.q.QueryRow(ctx,
		`SELECT display_name, COALESCE(model, '') FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vDisplayName, &vModel)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
			return
		}
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: failed to get vehicle")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get vehicle")
		return
	}

	// SI canonical drives (migration 000185): distance_m, duration_s,
	// max_speed_mps, ambient_temp_c_avg, started_at / ended_at. Convert at
	// the SELECT boundary so the in-memory totals carry display units.
	var totalDrives int
	var totalDistKm, totalDrivingMin float64
	var fastestSpeed, coldestTemp, hottestTemp *float64
	err = h.q.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(distance_m) / 1000.0, 0),
		       COALESCE(SUM(duration_s) / 60.0, 0),
		       MAX(max_speed_mps) * 3.6,
		       MIN(ambient_temp_c_avg),
		       MAX(ambient_temp_c_avg)
		FROM drives
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND distance_m > 0
		  AND started_at >= $2
		  AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&totalDrives, &totalDistKm, &totalDrivingMin, &fastestSpeed, &coldestTemp, &hottestTemp)
	if err != nil {
		log.Error().Err(err).Msg("year-review: failed to get drive stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	// Average efficiency (Wh/km) from SI columns: energy_used_wh,
	// distance_m. Wh/km = energy_used_wh / (distance_m / 1000). Filter
	// distance_m > 1609.344 (1 mile, matching the previous threshold).
	var avgEffWhKm float64
	if err = h.q.QueryRow(ctx, `
		SELECT COALESCE(AVG(
			CASE WHEN distance_m > 1609.344 AND energy_used_wh > 0
			THEN energy_used_wh / (distance_m / 1000.0)
			END
		), 0)
		FROM drives
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND started_at >= $2
		  AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&avgEffWhKm); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: failed to get efficiency")
	}

	// SI canonical charging_sessions (migration 000184): total_energy_added_wh,
	// cost_decimal NUMERIC, started_at / ended_at.
	var totalChargeSessions int
	var totalEnergyKwh, totalChargingCost float64
	err = h.q.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(total_energy_added_wh) / 1000.0, 0),
		       COALESCE(SUM(CASE WHEN cost_decimal > 0 THEN cost_decimal::float8 ELSE 0 END), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND started_at >= $2
		  AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&totalChargeSessions, &totalEnergyKwh, &totalChargingCost)
	if err != nil {
		log.Error().Err(err).Msg("year-review: failed to get charging stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	var gasPrice, gasEffMPG float64
	err = h.q.QueryRow(ctx,
		`SELECT
		  COALESCE((SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'), 3.50),
		  COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25)`,
	).Scan(&gasPrice, &gasEffMPG)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
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

	scanHighlight := func(query string, args ...interface{}) *driveHighlight {
		var dh driveHighlight
		var startDate time.Time
		var distM float64
		var durS float64
		var startAddr, endAddr *string
		err := h.q.QueryRow(ctx, query, args...).Scan(
			&dh.DriveID, &startDate, &distM, &durS,
			&startAddr, &endAddr,
		)
		if err != nil {
			// No matching drive (ErrNoRows) is expected when the vehicle
			// has no qualifying drives that year; surface only genuine
			// query/transport failures so a silent DB error stays visible.
			if !errors.Is(err, pgx.ErrNoRows) {
				log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: highlight query failed")
			}
			return nil
		}
		dh.Date = startDate.Format("2006-01-02")
		dh.DistanceKm = distM / 1000.0
		dh.DurationS = int64(durS)
		if startAddr != nil {
			dh.StartAddress = *startAddr
		}
		if endAddr != nil {
			dh.EndAddress = *endAddr
		}
		dh.DistanceKm = roundYR(dh.DistanceKm, 1)
		return &dh
	}

	// SI canonical drives (migration 000185): start_place / end_place replace
	// legacy address columns; distance_m / duration_s replace legacy units;
	// started_at / ended_at replace legacy timestamps.
	highlightBase := `
		SELECT id, started_at, distance_m, duration_s,
		       start_place, end_place
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3`

	longestDrive := scanHighlight(highlightBase+" ORDER BY distance_m DESC LIMIT 1", vehicleID, yearStart, yearEnd)
	shortestDrive := scanHighlight(highlightBase+" AND distance_m >= 1609.344 ORDER BY distance_m ASC LIMIT 1", vehicleID, yearStart, yearEnd)

	// Efficiency extremes unavailable (range columns removed from drives)
	var mostEfficient *driveHighlight
	var leastEfficient *driveHighlight

	monthlyMap := make(map[int]*monthStat)
	for m := 1; m <= 12; m++ {
		monthlyMap[m] = &monthStat{Month: m}
	}

	driveMonthRows, err := h.q.Query(ctx, `
		SELECT EXTRACT(MONTH FROM started_at)::int AS m, COUNT(*),
		       COALESCE(SUM(distance_m) / 1000.0, 0)
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3
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
		if ierr := driveMonthRows.Err(); ierr != nil {
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: drive-month rows iteration failed")
		}
		driveMonthRows.Close()
	}

	chargeMonthRows, err := h.q.Query(ctx, `
		SELECT EXTRACT(MONTH FROM started_at)::int AS m,
		       COALESCE(SUM(total_energy_added_wh) / 1000.0, 0),
		       COALESCE(SUM(CASE WHEN cost_decimal > 0 THEN cost_decimal::float8 ELSE 0 END), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
		  AND started_at >= $2 AND started_at < $3
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
		if ierr := chargeMonthRows.Err(); ierr != nil {
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-month rows iteration failed")
		}
		chargeMonthRows.Close()
	}

	monthlyStats := make([]monthStat, 0, 12)
	for m := 1; m <= 12; m++ {
		monthlyStats = append(monthlyStats, *monthlyMap[m])
	}

	mostActiveDOW := ""
	var dowIdx, dowCnt int
	if err := h.q.QueryRow(ctx, `
		SELECT EXTRACT(DOW FROM started_at)::int AS dow, COUNT(*) AS cnt
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3
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
	if err := h.q.QueryRow(ctx, `
		SELECT EXTRACT(HOUR FROM started_at)::int AS hr, COUNT(*) AS cnt
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3
		GROUP BY hr ORDER BY cnt DESC LIMIT 1`,
		vehicleID, yearStart, yearEnd,
	).Scan(&hrIdx, &hrCnt); err == nil {
		mostActiveHour = hrIdx
	}

	var avgDrivesPerWeek float64
	weeksInYear := 52.0
	now := time.Now().UTC()
	if yearEnd.After(now) {
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

	// SI canonical charging_sessions has charger_type only (no
	// fast_charger_brand). Supercharger detection uses charger_type ILIKE
	// 'Tesla%'; dc_fast = any other non-NULL charger_type; ac_other = NULL.
	var superchargerCnt, dcFastCnt, acOtherCnt int
	chargeTypeRows, err := h.q.Query(ctx, `
		SELECT
			CASE
				WHEN charger_type ILIKE 'Tesla%' THEN 'supercharger'
				WHEN charger_type IS NOT NULL THEN 'dc_fast'
				ELSE 'ac_other'
			END AS ctype,
			COUNT(*)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
		  AND started_at >= $2 AND started_at < $3
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
		if ierr := chargeTypeRows.Err(); ierr != nil {
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-type rows iteration failed")
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

	// Average charge start SOC from SI column start_soc_pct (REAL).
	var avgChargeStartSOC float64
	_ = h.q.QueryRow(ctx, `
		SELECT COALESCE(AVG(start_soc_pct), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND start_soc_pct > 0
		  AND started_at >= $2 AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&avgChargeStartSOC)

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

	result := map[string]interface{}{
		"year": year,
		"vehicle": map[string]interface{}{
			"id":           vehicleID,
			"display_name": vDisplayName,
			"model":        vModel,
		},

		"total_drives":          totalDrives,
		"total_distance_km":     roundYR(totalDistKm, 1),
		"total_energy_kwh":      roundYR(totalEnergyKwh, 1),
		"total_charge_sessions": totalChargeSessions,
		"total_driving_minutes": int(totalDrivingMin),
		"total_charging_cost":   roundYR(totalChargingCost, 2),
		"gas_savings":           roundYR(gasSavings, 2),
		"co2_offset_kg":         roundYR(co2OffsetKg, 1),

		"longest_drive":         longestDrive,
		"shortest_drive":        shortestDrive,
		"most_efficient_drive":  mostEfficient,
		"least_efficient_drive": leastEfficient,
		"fastest_speed_kmh":     roundYR(derefFloat(fastestSpeed), 1),
		"coldest_drive_temp_c":  roundYR(derefFloat(coldestTemp), 1),
		"hottest_drive_temp_c":  roundYR(derefFloat(hottestTemp), 1),

		"monthly_stats": monthlyStats,

		"most_active_day_of_week":   mostActiveDOW,
		"most_active_hour":          mostActiveHour,
		"avg_drives_per_week":       roundYR(avgDrivesPerWeek, 1),
		"avg_distance_per_drive_km": roundYR(avgDistPerDrive, 1),
		"avg_efficiency_wh_km":      roundYR(avgEffWhKm, 1),

		// Charging habits
		"supercharger_pct":     roundYR(superchargerPct, 1),
		"dc_fast_pct":          roundYR(dcFastPct, 1),
		"ac_other_pct":         roundYR(acOtherPct, 1),
		"avg_charge_start_soc": roundYR(avgChargeStartSOC, 1),

		// Fun comparisons
		"comparisons": comparisons,
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func derefFloat(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}
