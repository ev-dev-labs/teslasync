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
	"go.opentelemetry.io/otel"
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
	DriveID         int64   `json:"drive_id"`
	Date            string  `json:"date"`
	DistanceKm      float64 `json:"distance_km"`
	DurationMinutes float64 `json:"duration_min"`
	StartAddress    string  `json:"start_address"`
	EndAddress      string  `json:"end_address"`
	EfficiencyWhKm  float64 `json:"efficiency_wh_km"`
}

type monthStat struct {
	Month      int      `json:"month"`
	Drives     *int     `json:"drives"`
	DistanceKm *float64 `json:"distance_km"`
	EnergyKwh  *float64 `json:"energy_kwh"`
	Cost       *float64 `json:"cost"`
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
	ctx, span := otel.Tracer("api").Start(r.Context(), "yearreview.GetYearReview")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, yearReviewQueryBudget)
	defer cancel()
	logger := log.With().Str("trace_id", span.SpanContext().TraceID().String()).Logger()

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
		logger.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: failed to get vehicle")
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
		logger.Error().Err(err).Msg("year-review: failed to get drive stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	// Average efficiency (Wh/km) from SI columns: energy_used_wh,
	// distance_m. Wh/km = energy_used_wh / (distance_m / 1000). Filter
	// distance_m > 1609.344 (1 mile, matching the previous threshold).
	var avgEffWhKm *float64
	if err = h.q.QueryRow(ctx, `
		SELECT AVG(
			CASE WHEN distance_m > 1609.344
			THEN energy_used_wh / (distance_m / 1000.0)
			END
		)
		FROM drives
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND started_at >= $2
		  AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&avgEffWhKm); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: failed to get efficiency")
		avgEffWhKm = nil
	}

	// SI canonical charging_sessions (migration 000184): total_energy_added_wh,
	// cost_decimal NUMERIC, started_at / ended_at.
	var totalChargeSessions int
	var totalEnergyKwh, totalChargingCost float64
	err = h.q.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(total_energy_added_wh) / 1000.0, 0),
		       COALESCE(SUM(cost_decimal::float8), 0)
		FROM charging_sessions
		WHERE vehicle_id = $1
		  AND ended_at IS NOT NULL
		  AND started_at >= $2
		  AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&totalChargeSessions, &totalEnergyKwh, &totalChargingCost)
	if err != nil {
		logger.Error().Err(err).Msg("year-review: failed to get charging stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute year review")
		return
	}

	var gasPrice, gasEffMPG *float64
	err = h.q.QueryRow(ctx,
		`SELECT
		  (SELECT value_num FROM settings WHERE key = 'gas_price_per_unit'),
		  (SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg')`,
	).Scan(&gasPrice, &gasEffMPG)
	if err != nil {
		log.Warn().Err(err).Msg("year-review: failed to get settings")
		gasPrice, gasEffMPG = nil, nil
	}

	var gasSavings *float64
	if gasPrice != nil && gasEffMPG != nil && finiteYR(*gasPrice) && finiteYR(*gasEffMPG) &&
		*gasPrice >= 0 && *gasEffMPG > 0 && finiteYR(totalDistKm) && finiteYR(totalChargingCost) {
		totalMiles := totalDistKm / 1.60934
		gasEquivCost := (totalMiles / *gasEffMPG) * *gasPrice
		savings := gasEquivCost - totalChargingCost
		gasSavings = roundNullableYR(&savings, 2)
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
		// This report's existing wire contract uses minutes; storage remains seconds.
		dh.DurationMinutes = durS / 60.0
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

	// Null means unavailable; zero is published only after a complete query.
	monthlyMap := make(map[int]*monthStat)
	for m := 1; m <= 12; m++ {
		monthlyMap[m] = &monthStat{Month: m}
	}

	driveMonthRows, err := h.q.Query(ctx, `
		SELECT EXTRACT(MONTH FROM started_at)::int AS m, COUNT(*),
		       SUM(distance_m) / 1000.0
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3
		GROUP BY m`,
		vehicleID, yearStart, yearEnd)
	driveMonthsOK := err == nil
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: drive-month query failed")
	} else {
		defer driveMonthRows.Close()
		for _, ms := range monthlyMap {
			zeroCount, zeroDistance := 0, 0.0
			ms.Drives, ms.DistanceKm = &zeroCount, &zeroDistance
		}
		for driveMonthRows.Next() {
			var m, cnt int
			var dist *float64
			if scanErr := driveMonthRows.Scan(&m, &cnt, &dist); scanErr != nil {
				log.Warn().Err(scanErr).Int64("vehicle_id", vehicleID).Msg("year-review: drive-month scan failed")
				driveMonthsOK = false
			} else {
				if ms, ok := monthlyMap[m]; ok {
					if cnt >= 0 {
						ms.Drives = &cnt
					} else {
						ms.Drives = nil
					}
					ms.DistanceKm = roundNullableYR(dist, 1)
				} else {
					driveMonthsOK = false
				}
			}
		}
		if ierr := driveMonthRows.Err(); ierr != nil {
			driveMonthsOK = false
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: drive-month rows iteration failed")
		}
		driveMonthRows.Close()
	}
	if !driveMonthsOK {
		for _, ms := range monthlyMap {
			ms.Drives, ms.DistanceKm = nil, nil
		}
	}

	chargeMonthRows, err := h.q.Query(ctx, `
		SELECT EXTRACT(MONTH FROM started_at)::int AS m,
		       SUM(total_energy_added_wh) / 1000.0,
		       SUM(cost_decimal::float8)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL
		  AND started_at >= $2 AND started_at < $3
		GROUP BY m`,
		vehicleID, yearStart, yearEnd)
	chargeMonthsOK := err == nil
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: charge-month query failed")
	} else {
		defer chargeMonthRows.Close()
		for _, ms := range monthlyMap {
			zeroEnergy, zeroCost := 0.0, 0.0
			ms.EnergyKwh, ms.Cost = &zeroEnergy, &zeroCost
		}
		for chargeMonthRows.Next() {
			var m int
			var energy, cost *float64
			if scanErr := chargeMonthRows.Scan(&m, &energy, &cost); scanErr != nil {
				log.Warn().Err(scanErr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-month scan failed")
				chargeMonthsOK = false
			} else {
				if ms, ok := monthlyMap[m]; ok {
					ms.EnergyKwh = roundNullableYR(energy, 1)
					ms.Cost = roundNullableYR(cost, 2)
				} else {
					chargeMonthsOK = false
				}
			}
		}
		if ierr := chargeMonthRows.Err(); ierr != nil {
			chargeMonthsOK = false
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-month rows iteration failed")
		}
		chargeMonthRows.Close()
	}
	if !chargeMonthsOK {
		for _, ms := range monthlyMap {
			ms.EnergyKwh, ms.Cost = nil, nil
		}
	}

	monthlyStats := make([]monthStat, 0, 12)
	for m := 1; m <= 12; m++ {
		monthlyStats = append(monthlyStats, *monthlyMap[m])
	}

	var mostActiveDOW *string
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
		if dowIdx >= 0 && dowIdx < 7 && dowCnt > 0 {
			mostActiveDOW = &dayNames[dowIdx]
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		log.Warn().Err(err).Msg("year-review: active-day query failed")
	}

	var mostActiveHour *int
	var hrIdx, hrCnt int
	if err := h.q.QueryRow(ctx, `
		SELECT EXTRACT(HOUR FROM started_at)::int AS hr, COUNT(*) AS cnt
		FROM drives
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND distance_m > 0
		  AND started_at >= $2 AND started_at < $3
		GROUP BY hr ORDER BY cnt DESC LIMIT 1`,
		vehicleID, yearStart, yearEnd,
	).Scan(&hrIdx, &hrCnt); err == nil {
		if hrIdx >= 0 && hrIdx < 24 && hrCnt > 0 {
			mostActiveHour = &hrIdx
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		log.Warn().Err(err).Msg("year-review: active-hour query failed")
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
	chargeTypesOK := err == nil
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: charge-type query failed")
	} else {
		defer chargeTypeRows.Close()
		for chargeTypeRows.Next() {
			var ct string
			var cnt int
			if scanErr := chargeTypeRows.Scan(&ct, &cnt); scanErr != nil {
				log.Warn().Err(scanErr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-type scan failed")
				chargeTypesOK = false
			} else if cnt < 0 {
				chargeTypesOK = false
			} else {
				switch ct {
				case "supercharger":
					superchargerCnt = cnt
				case "dc_fast":
					dcFastCnt = cnt
				case "ac_other":
					acOtherCnt = cnt
				default:
					chargeTypesOK = false
				}
			}
		}
		if ierr := chargeTypeRows.Err(); ierr != nil {
			chargeTypesOK = false
			log.Warn().Err(ierr).Int64("vehicle_id", vehicleID).Msg("year-review: charge-type rows iteration failed")
		}
		chargeTypeRows.Close()
	}

	totalChargeForPct := superchargerCnt + dcFastCnt + acOtherCnt
	var superchargerPct, dcFastPct, acOtherPct *float64
	if chargeTypesOK {
		sc, dc, ac := 0.0, 0.0, 0.0
		if totalChargeForPct > 0 {
			sc = float64(superchargerCnt) / float64(totalChargeForPct) * 100
			dc = float64(dcFastCnt) / float64(totalChargeForPct) * 100
			ac = float64(acOtherCnt) / float64(totalChargeForPct) * 100
		}
		superchargerPct, dcFastPct, acOtherPct = &sc, &dc, &ac
	}

	// Average charge start SOC from SI column start_soc_pct (REAL).
	var avgChargeStartSOC *float64
	if err := h.q.QueryRow(ctx, `
		SELECT AVG(start_soc_pct)
		FROM charging_sessions
		WHERE vehicle_id = $1 AND ended_at IS NOT NULL AND start_soc_pct >= 0 AND start_soc_pct <= 100
		  AND started_at >= $2 AND started_at < $3`,
		vehicleID, yearStart, yearEnd,
	).Scan(&avgChargeStartSOC); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("year-review: charge-start SOC query failed")
		avgChargeStartSOC = nil
	}
	if avgChargeStartSOC != nil && (*avgChargeStartSOC < 0 || *avgChargeStartSOC > 100) {
		avgChargeStartSOC = nil
	}

	km := totalDistKm
	comparisons := []comparison{
		{Label: "Paris round-trips", Value: fmt.Sprintf("%.1f", km/1085), Emoji: "🗼"},
		{Label: "Times around Central Park", Value: fmt.Sprintf("%.0f", km/10.4), Emoji: "🌳"},
		{Label: "Marathons", Value: fmt.Sprintf("%.0f", km/42.195), Emoji: "🏃"},
		{Label: "CO₂ offset", Value: fmt.Sprintf("%.0f kg — like planting %d trees", co2OffsetKg, int(co2OffsetKg/21)), Emoji: "🌱"},
	}
	if gasSavings != nil && *gasSavings > 0 {
		comparisons = append(comparisons,
			comparison{Label: "Gas money saved", Value: fmt.Sprintf("$%.0f — that's %d cups of coffee!", *gasSavings, int(*gasSavings/5)), Emoji: "☕"},
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
		"total_driving_minutes": roundYR(totalDrivingMin, 1),
		"total_charging_cost":   roundYR(totalChargingCost, 2),
		"gas_savings":           gasSavings,
		"co2_offset_kg":         roundYR(co2OffsetKg, 1),

		"longest_drive":         longestDrive,
		"shortest_drive":        shortestDrive,
		"most_efficient_drive":  mostEfficient,
		"least_efficient_drive": leastEfficient,
		"fastest_speed_kmh":     roundNullableYR(fastestSpeed, 1),
		"coldest_drive_temp_c":  roundNullableYR(coldestTemp, 1),
		"hottest_drive_temp_c":  roundNullableYR(hottestTemp, 1),

		"monthly_stats": monthlyStats,

		"most_active_day_of_week":   mostActiveDOW,
		"most_active_hour":          mostActiveHour,
		"avg_drives_per_week":       roundYR(avgDrivesPerWeek, 1),
		"avg_distance_per_drive_km": roundYR(avgDistPerDrive, 1),
		"avg_efficiency_wh_km":      roundNullableYR(avgEffWhKm, 1),

		// Charging habits
		"supercharger_pct":     roundNullableYR(superchargerPct, 1),
		"dc_fast_pct":          roundNullableYR(dcFastPct, 1),
		"ac_other_pct":         roundNullableYR(acOtherPct, 1),
		"avg_charge_start_soc": roundNullableYR(avgChargeStartSOC, 1),

		// Fun comparisons
		"comparisons": comparisons,
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func finiteYR(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0)
}

// Missing or invalid extremes remain null, distinct from measured zero.
func roundNullableYR(p *float64, decimals int) *float64 {
	if p == nil {
		return nil
	}
	scale := math.Pow(10, float64(decimals))
	v := math.Round(*p*scale) / scale
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}
