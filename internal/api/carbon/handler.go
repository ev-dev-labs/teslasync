package carbon

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// carbonDataTimeout bounds each analytics read so a stalled connection cannot
// pin the request goroutine longer than the boundary rule allows. The pool's
// server-side statement_timeout is the backstop; this is the client-side
// deadline. A var (not const) so tests can shorten it (mirrors
// routeeff.routeEffDataTimeout / batterypassport.bpDataTimeout).
var carbonDataTimeout = 15 * time.Second

// carbonQuerier is the minimal pgx surface the handler needs. Declared locally
// so tests can drive every branch with scripted row/rows sources without a live
// database or a vendored pgxmock (mirrors routeeff.routeQuerier /
// batterypassport.passportQuerier). *pgxpool.Pool satisfies it.
type carbonQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Handler serves the Carbon Intelligence endpoints.
type Handler struct {
	db carbonQuerier
}

// NewCarbonHandler wires the handler to the pgx pool. Panics on a nil pool — a
// nil pool is a wiring bug, not a runtime condition, so it surfaces at
// construction rather than as a nil-deref on the first request (mirrors
// routeeff.NewRouteEfficiencyHandler / batterypassport.NewBatteryPassportHandler).
func NewCarbonHandler(db *database.DB) *Handler {
	if db == nil || db.Pool == nil {
		panic("carbon.NewCarbonHandler: db pool must not be nil")
	}
	return &Handler{db: db.Pool}
}

// --- SQL. Package-level constants so tests can pin the critical clauses
// without a live database. ---

// intensityQuery reads the full 24-row diurnal grid model, ascending by hour.
const intensityQuery = `
SELECT hour_of_day, g_co2_per_kwh
FROM grid_carbon_intensity
ORDER BY hour_of_day`

// summaryChargingQuery rolls charged energy up by (month, hour) so a single
// scan drives BOTH the totals and the monthly trend. EXTRACT(HOUR ...) uses the
// session's clock (the intensity model is local-hour). The optional
// [start, end] window is expressed via a NULL-guarded BETWEEN so one prepared
// statement covers "scoped" and "full-history".
const summaryChargingQuery = `
SELECT TO_CHAR(started_at, 'YYYY-MM')        AS month,
       EXTRACT(HOUR FROM started_at)::int     AS hour,
       COALESCE(SUM(total_energy_added_wh), 0) AS energy_wh,
       COUNT(*)                                AS session_count
FROM charging_sessions
WHERE vehicle_id = $1
  AND total_energy_added_wh > 0
  AND ($2::timestamptz IS NULL OR started_at BETWEEN $2 AND $3)
GROUP BY 1, 2
ORDER BY 1, 2`

// summaryDistanceQuery totals drive distance (SI metres → km) for the ICE
// gas-equivalent baseline, over the same optional window.
const summaryDistanceQuery = `
SELECT COALESCE(SUM(distance_m), 0) / 1000.0 AS distance_km
FROM drives
WHERE vehicle_id = $1
  AND distance_m > 0
  AND ($2::timestamptz IS NULL OR started_at BETWEEN $2 AND $3)`

// recommendationChargingQuery rolls charged energy up by hour over the vehicle's
// full charging history — the recommendation compares the driver's realized
// hour distribution to the greenest window, independent of any date window.
const recommendationChargingQuery = `
SELECT EXTRACT(HOUR FROM started_at)::int     AS hour,
       COALESCE(SUM(total_energy_added_wh), 0) AS energy_wh
FROM charging_sessions
WHERE vehicle_id = $1
  AND total_energy_added_wh > 0
GROUP BY 1`

// Intensity serves GET /api/v1/carbon/intensity: the seeded diurnal grid model
// and its derived greenest/dirtiest hours. Read-only, vehicle-independent.
func (h *Handler) Intensity(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), carbonDataTimeout)
	defer cancel()

	curve, err := h.loadCurve(ctx)
	if err != nil {
		log.Error().Err(err).Msg("carbon: failed to load intensity curve")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load grid carbon intensity")
		return
	}

	minV, maxV, greenest, dirtiest := CurveStats(curve)

	// Round the wire values without mutating the loaded curve.
	out := make([]HourIntensity, len(curve))
	for i, hh := range curve {
		out[i] = HourIntensity{HourOfDay: hh.HourOfDay, GCO2PerKWh: round1(hh.GCO2PerKWh)}
	}

	httpx.WriteJSON(w, http.StatusOK, IntensityCurveResponse{
		Curve:         out,
		Min:           round1(minV),
		Max:           round1(maxV),
		GreenestHours: greenest,
		DirtiestHours: dirtiest,
	})
}

// Summary serves GET /api/v1/vehicles/{vehicleID}/carbon/summary?from=&to=.
// It attributes CO2 to each session by its charging hour, compares the lifetime
// total to a distance-based gas-car baseline, and scores the charging timing.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	startTime, endTime := parseFromTo(r)
	hasRange := !startTime.IsZero() && !endTime.IsZero()

	ctx, cancel := context.WithTimeout(r.Context(), carbonDataTimeout)
	defer cancel()

	curve, err := h.loadCurve(ctx)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: summary: failed to load intensity curve")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load grid carbon intensity")
		return
	}
	lookup := intensityLookup(curve)
	minV, maxV, _, _ := CurveStats(curve)

	rows, err := h.db.Query(ctx, summaryChargingQuery, vehicleID,
		apiparams.NullableTime(hasRange, startTime), apiparams.NullableTime(hasRange, endTime))
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: summary: failed to query charging rollup")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute carbon summary")
		return
	}
	defer rows.Close()

	monthEnergy := make(map[string]float64)
	monthCO2 := make(map[string]float64)
	var totalEnergyKwh, totalCO2Kg, weightedNum float64
	var sessionsScored int
	for rows.Next() {
		var month string
		var hour int
		var energyWh float64
		var sessionCount int64
		if err := rows.Scan(&month, &hour, &energyWh, &sessionCount); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: summary: scan charging row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read carbon summary")
			return
		}
		energyKwh := energyWh / 1000.0
		gi := lookup[hour] // seeded 0..23 ⇒ always present; missing ⇒ 0 (unscored)
		co2 := SessionCO2Kg(energyKwh, gi)

		totalEnergyKwh += energyKwh
		totalCO2Kg += co2
		weightedNum += energyKwh * gi
		sessionsScored += int(sessionCount)
		monthEnergy[month] += energyKwh
		monthCO2[month] += co2
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: summary: charging rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read carbon summary")
		return
	}

	realizedAvg := 0.0
	if totalEnergyKwh > 0 {
		realizedAvg = weightedNum / totalEnergyKwh
	}
	greenScore := 0.0
	if sessionsScored > 0 {
		greenScore = GreenScore(realizedAvg, minV, maxV)
	}

	// Distance → ICE gas-equivalent CO2. A missing drives row (no drives yet)
	// scans as 0 via COALESCE, so ErrNoRows is not expected, but guard anyway.
	var totalKm float64
	if err := h.db.QueryRow(ctx, summaryDistanceQuery, vehicleID,
		apiparams.NullableTime(hasRange, startTime), apiparams.NullableTime(hasRange, endTime)).
		Scan(&totalKm); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: summary: failed to query distance")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to compute carbon summary")
			return
		}
	}
	gasEquiv := GasEquivCO2Kg(totalKm)

	// Monthly trend, ascending by month (map iteration order is randomised).
	months := make([]string, 0, len(monthEnergy))
	for m := range monthEnergy {
		months = append(months, m)
	}
	sort.Strings(months)
	monthly := make([]MonthlyCO2, 0, len(months))
	for _, m := range months {
		monthly = append(monthly, MonthlyCO2{
			Month:     m,
			CO2Kg:     safeF(round2(monthCO2[m])),
			EnergyKwh: safeF(round2(monthEnergy[m])),
		})
	}

	httpx.WriteJSON(w, http.StatusOK, SummaryResponse{
		TotalEnergyKwh: safeF(round2(totalEnergyKwh)),
		TotalCO2Kg:     safeF(round2(totalCO2Kg)),
		GasEquivCO2Kg:  safeF(round2(gasEquiv)),
		CO2SavedKg:     safeF(round2(gasEquiv - totalCO2Kg)),
		GreenScore:     safeF(round1(greenScore)),
		SessionsScored: sessionsScored,
		Monthly:        monthly,
	})
}

// Recommendation serves
// GET /api/v1/vehicles/{vehicleID}/carbon/recommendation: the driver's realized
// average charging intensity, the greenest contiguous window, and the CO2 that
// shifting into it would save over their observed charging.
func (h *Handler) Recommendation(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), carbonDataTimeout)
	defer cancel()

	curve, err := h.loadCurve(ctx)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: recommendation: failed to load intensity curve")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load grid carbon intensity")
		return
	}
	lookup := intensityLookup(curve)

	rows, err := h.db.Query(ctx, recommendationChargingQuery, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: recommendation: failed to query charging rollup")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute carbon recommendation")
		return
	}
	defer rows.Close()

	energyByHour := make(map[int]float64)
	var totalEnergyKwh float64
	for rows.Next() {
		var hour int
		var energyWh float64
		if err := rows.Scan(&hour, &energyWh); err != nil {
			log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: recommendation: scan charging row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read carbon recommendation")
			return
		}
		energyKwh := energyWh / 1000.0
		energyByHour[hour] += energyKwh
		totalEnergyKwh += energyKwh
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("carbon: recommendation: charging rows iteration")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read carbon recommendation")
		return
	}

	currentAvg := EnergyWeightedIntensity(energyByHour, lookup)
	startH, endH, windowAvg := GreenestWindow(curve, GreenestWindowHours)
	savingKg, savingPct := PotentialSaving(totalEnergyKwh, currentAvg, windowAvg)

	httpx.WriteJSON(w, http.StatusOK, RecommendationResponse{
		CurrentAvgIntensity: safeF(round1(currentAvg)),
		GreenestWindow: GreenestWindowDTO{
			StartHour:    startH,
			EndHour:      endH,
			AvgIntensity: safeF(round1(windowAvg)),
		},
		PotentialCO2SavingKg: safeF(round2(savingKg)),
		PotentialSavingPct:   safeF(round1(savingPct)),
	})
}

// parseFromTo reads the optional [from, to] window this endpoint documents,
// mirroring apiparams.ParseDateRange's two-format handling (RFC 3339 instants
// or YYYY-MM-DD calendar days) but on the `from`/`to` keys. An RFC 3339 `to`
// is treated as an EXCLUSIVE upper bound and nudged back one microsecond so it
// composes with the handler's inclusive BETWEEN. Missing/unparseable values
// yield zero times; the caller detects "unspecified" via IsZero().
func parseFromTo(r *http.Request) (from, to time.Time) {
	if s := r.URL.Query().Get("from"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			from = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			from = t
		}
	}
	if s := r.URL.Query().Get("to"); s != "" {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			to = t.Add(-time.Microsecond) // exclusive → inclusive for BETWEEN
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			to = t.Add(24*time.Hour - time.Second) // end of day (UTC)
		}
	}
	return from, to
}

// loadCurve reads the seeded diurnal grid model. Returned rows are ordered by
// hour; the pure core tolerates a partial curve, but the migration guarantees
// all 24. Any read/scan failure is wrapped for the caller to log + 500.
func (h *Handler) loadCurve(ctx context.Context) ([]HourIntensity, error) {
	rows, err := h.db.Query(ctx, intensityQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	curve := make([]HourIntensity, 0, hoursPerDay)
	for rows.Next() {
		var hour int
		var g float64
		if err := rows.Scan(&hour, &g); err != nil {
			return nil, err
		}
		curve = append(curve, HourIntensity{HourOfDay: hour, GCO2PerKWh: g})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return curve, nil
}
