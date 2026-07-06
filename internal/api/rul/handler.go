package rul

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// rulDataTimeout bounds each analytics read so a stalled connection cannot pin
// the request goroutine longer than the boundary rule allows. The pool's
// server-side statement_timeout is the backstop; this is the client-side
// deadline. A var (not const) so tests can shorten it (mirrors
// carbon.carbonDataTimeout / routeeff.routeEffDataTimeout).
var rulDataTimeout = 15 * time.Second

// rulQuerier is the minimal pgx surface the handler needs. Declared locally so
// tests can drive every branch with scripted row/rows sources without a live
// database or a vendored pgxmock (mirrors carbon.carbonQuerier /
// routeeff.routeQuerier). *pgxpool.Pool satisfies it.
type rulQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Handler serves the Remaining Useful Life endpoints.
type Handler struct {
	db rulQuerier
}

// NewRULHandler wires the handler to the pgx pool. Panics on a nil pool — a nil
// pool is a wiring bug, not a runtime condition, so it surfaces at construction
// rather than as a nil-deref on the first request (mirrors
// carbon.NewCarbonHandler / routeeff.NewRouteEfficiencyHandler).
func NewRULHandler(db *database.DB) *Handler {
	if db == nil || db.Pool == nil {
		panic("rul.NewRULHandler: db pool must not be nil")
	}
	return &Handler{db: db.Pool}
}

// componentSpec is the static description of a tracked component: its stable
// machine key, human label, and which prognosis model applies. The slice is
// ordered so both endpoints and the UI present a stable, deliberate sequence
// (battery first, then the fast-moving wear parts, then calendar parts).
type componentSpec struct {
	Component string
	Label     string
	Kind      componentKind
}

type componentKind int

const (
	kindBattery componentKind = iota // SoH regression on the reconstructed series
	kindWear                         // distance wear from the odometer
	kindAge                          // calendar wear from the enrollment date
)

var componentSpecs = []componentSpec{
	{Component: "hv_battery", Label: "High-Voltage Battery", Kind: kindBattery},
	{Component: "lv_battery", Label: "12V Battery", Kind: kindAge},
	{Component: "tires", Label: "Tires", Kind: kindWear},
	{Component: "brakes", Label: "Brakes", Kind: kindWear},
	{Component: "cabin_filter", Label: "Cabin Air Filter", Kind: kindAge},
}

// specByComponent indexes componentSpecs for O(1) lookup / validation.
var specByComponent = func() map[string]componentSpec {
	m := make(map[string]componentSpec, len(componentSpecs))
	for _, s := range componentSpecs {
		m[s.Component] = s
	}
	return m
}()

// Windowing constants. The SQL below hard-codes these same intervals (pgx
// interval literals cannot be a bound $-param cleanly); keep the two in sync.
const (
	// sohWindowDays bounds the SoH reconstruction lookback — long enough to see
	// a degradation trend without scanning the whole hypertable.
	sohWindowDays = 400
	// recentWindowDays bounds the odometer accumulation window used for km/day.
	recentWindowDays = 90
	// defaultCapacityWh mirrors batterydegradation's fallback pack size.
	defaultCapacityWh = 75000.0
)

// --- SQL. Package-level constants so tests can pin the critical clauses. ---

// configsQuery reads the seeded per-component service-life model (migration
// 000218), ordered for stable output.
const configsQuery = `
SELECT component, nominal_life_km, nominal_life_days, eol_threshold, notes
FROM component_lifespans
ORDER BY component`

// vehicleQuery reads the fields needed to size the pack (VIN/model → nominal
// capacity) and to age the calendar-wear parts (enrolled_at).
const vehicleQuery = `
SELECT vin, model, enrolled_at
FROM vehicles
WHERE id = $1`

// sohSeriesQuery reconstructs a daily State-of-Health series: per day, the peak
// EnergyRemaining (Wh) and peak BatteryLevel (% SoC). cagg_battery_daily is the
// sibling daily roll-up but materialises SoC, not usable capacity, so the SoH
// trend is rebuilt here from the raw energy/SoC pair (batterydegradation's
// approach). The HAVING guarantees both signals are present on a retained day.
const sohSeriesQuery = `
SELECT date_trunc('day', ts)                                   AS day,
       MAX(float_value) FILTER (WHERE field = 'EnergyRemaining') AS max_energy_wh,
       MAX(float_value) FILTER (WHERE field = 'BatteryLevel')    AS max_soc_pct
FROM signal_log
WHERE vehicle_id = $1
  AND field IN ('EnergyRemaining', 'BatteryLevel')
  AND ts > NOW() - INTERVAL '400 days'
  AND float_value IS NOT NULL
GROUP BY 1
HAVING MAX(float_value) FILTER (WHERE field = 'EnergyRemaining') IS NOT NULL
   AND MAX(float_value) FILTER (WHERE field = 'BatteryLevel')    IS NOT NULL
ORDER BY 1`

// odometerQuery derives the whole-life distance proxy in one aggregate row: the
// lifetime odometer (MAX end_odometer_m), the distance driven in the recent
// window, the drive count backing that rate, and the active span between the
// first and last drive in the window (so km/day reflects real driving, not idle
// calendar days). positions has no odometer column, so drives is the source.
const odometerQuery = `
SELECT COALESCE(MAX(end_odometer_m), 0)                                                       AS total_odometer_m,
       COALESCE(SUM(distance_m) FILTER (WHERE started_at > NOW() - INTERVAL '90 days'), 0)     AS recent_distance_m,
       COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '90 days' AND distance_m IS NOT NULL) AS recent_samples,
       COALESCE(EXTRACT(EPOCH FROM (
             MAX(started_at) FILTER (WHERE started_at > NOW() - INTERVAL '90 days')
           - MIN(started_at) FILTER (WHERE started_at > NOW() - INTERVAL '90 days')
       )) / 86400.0, 0)                                                                        AS recent_span_days
FROM drives
WHERE vehicle_id = $1`

// gathered is the raw material the pure core folds into prognoses.
type gathered struct {
	configs    map[string]ComponentConfig
	enrolledAt time.Time
	capacityWh float64
	sohSeries  []Point
	totalKm    float64
	kmPerDay   float64
	driveCount int
}

// loadConfigs reads the component service-life model. Returned map is keyed by
// component; a missing component (admin deleted a row) is simply absent.
func (h *Handler) loadConfigs(ctx context.Context) (map[string]ComponentConfig, error) {
	rows, err := h.db.Query(ctx, configsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]ComponentConfig, len(componentSpecs))
	for rows.Next() {
		var c ComponentConfig
		var notes *string
		if err := rows.Scan(&c.Component, &c.NominalLifeKm, &c.NominalLifeDays, &c.EOLThreshold, &notes); err != nil {
			return nil, err
		}
		if notes != nil {
			c.Notes = *notes
		}
		out[c.Component] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// loadVehicle reads the enrollment date and derives the nominal pack capacity
// from VIN/model. A missing vehicle is not an error here (mirrors carbon's
// graceful zero-data handling): it degrades to "enrolled today" + default
// capacity so the board renders an all-healthy, low-confidence result rather
// than a 404 for a vehicle that simply has no telemetry yet.
func (h *Handler) loadVehicle(ctx context.Context, vehicleID int64, now time.Time) (enrolledAt time.Time, capacityWh float64, err error) {
	var vin string
	var model *string
	var enrolled time.Time
	scanErr := h.db.QueryRow(ctx, vehicleQuery, vehicleID).Scan(&vin, &model, &enrolled)
	if scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return now, defaultCapacityWh, nil
		}
		return time.Time{}, 0, scanErr
	}
	m := ""
	if model != nil {
		m = *model
	}
	cap, _ := estimateBatteryCapacityWh(vin, m)
	return enrolled, cap, nil
}

// loadSoHSeries reads the daily (max energy, max SoC) pairs and normalises them
// into an SoH series via the pure BuildSoHSeries. Each retained day becomes one
// regression point.
func (h *Handler) loadSoHSeries(ctx context.Context, vehicleID int64, capacityWh float64) ([]Point, error) {
	rows, err := h.db.Query(ctx, sohSeriesQuery, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var daily []DailyBattery
	for rows.Next() {
		var day time.Time
		var energy, soc *float64
		if err := rows.Scan(&day, &energy, &soc); err != nil {
			return nil, err
		}
		if energy == nil || soc == nil {
			continue
		}
		daily = append(daily, DailyBattery{Day: day, MaxEnergyWh: *energy, MaxSocPct: *soc})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return BuildSoHSeries(daily, capacityWh), nil
}

// loadOdometer reads the single aggregate row and folds it into the whole-life
// distance figures. A vehicle with no drives scans as all-zero via COALESCE.
func (h *Handler) loadOdometer(ctx context.Context, vehicleID int64) (totalKm, kmPerDay float64, driveCount int, err error) {
	var totalM, recentM, spanDays float64
	var samples int64
	scanErr := h.db.QueryRow(ctx, odometerQuery, vehicleID).Scan(&totalM, &recentM, &samples, &spanDays)
	if scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return 0, 0, 0, nil
		}
		return 0, 0, 0, scanErr
	}
	totalKm = totalM / 1000.0
	kmPerDay = KmPerDay(recentM/1000.0, spanDays)
	return totalKm, kmPerDay, int(samples), nil
}

// gather runs the four reads in a FIXED order — Query: [configs, soh];
// QueryRow: [vehicle, odometer] — so a fake pool can script results by call
// order. Any read error propagates for the caller to log + 500. Each helper
// closes its own rows (no defer-in-loop).
func (h *Handler) gather(ctx context.Context, vehicleID int64, now time.Time) (*gathered, error) {
	configs, err := h.loadConfigs(ctx)
	if err != nil {
		return nil, err
	}
	enrolledAt, capacityWh, err := h.loadVehicle(ctx, vehicleID, now)
	if err != nil {
		return nil, err
	}
	sohSeries, err := h.loadSoHSeries(ctx, vehicleID, capacityWh)
	if err != nil {
		return nil, err
	}
	totalKm, kmPerDay, driveCount, err := h.loadOdometer(ctx, vehicleID)
	if err != nil {
		return nil, err
	}
	return &gathered{
		configs:    configs,
		enrolledAt: enrolledAt,
		capacityWh: capacityWh,
		sohSeries:  sohSeries,
		totalKm:    totalKm,
		kmPerDay:   kmPerDay,
		driveCount: driveCount,
	}, nil
}

// buildComponents folds the gathered data through the pure per-component
// builders, in componentSpecs order. It returns the prognoses AND their
// projection inputs (keyed by component) so the detail endpoint can render a
// forecast without recomputing. Deterministic given `now`.
func (h *Handler) buildComponents(g *gathered, now time.Time) ([]ComponentRUL, map[string]projInputs) {
	comps := make([]ComponentRUL, 0, len(componentSpecs))
	proj := make(map[string]projInputs, len(componentSpecs))
	ageDays := now.Sub(g.enrolledAt).Hours() / 24.0

	for _, spec := range componentSpecs {
		cfg := g.configs[spec.Component] // zero value if unconfigured
		cfg.Component = spec.Component
		var c ComponentRUL
		var pi projInputs
		switch spec.Kind {
		case kindBattery:
			c, pi = BatteryRUL(cfg, spec.Label, g.sohSeries, now)
		case kindWear:
			c, pi = WearRUL(cfg, spec.Label, g.totalKm, g.kmPerDay, g.driveCount, now)
		case kindAge:
			c, pi = AgeRUL(cfg, spec.Label, ageDays, now)
		}
		comps = append(comps, c)
		proj[spec.Component] = pi
	}
	return comps, proj
}

// RUL serves GET /api/v1/vehicles/{vehicleID}/rul: the full component health
// board plus the single most-urgent upcoming service.
func (h *Handler) RUL(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), rulDataTimeout)
	defer cancel()

	now := time.Now().UTC()
	g, err := h.gather(ctx, vehicleID, now)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("rul: failed to gather prognostics inputs")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute remaining useful life")
		return
	}

	comps, _ := h.buildComponents(g, now)
	httpx.WriteJSON(w, http.StatusOK, RULResponse{
		VehicleID:   vehicleID,
		Components:  comps,
		NextService: NextServiceDue(comps),
	})
}

// Component serves GET /api/v1/vehicles/{vehicleID}/rul/{component}: one
// component's prognosis plus its configured reference figures and a forecast
// series from today to the projected end-of-life for the chart. Unknown
// component keys are a 400; a known component with no seeded config row is a
// 404.
func (h *Handler) Component(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}
	component := strings.TrimSpace(chi.URLParam(r, "component"))
	spec, known := specByComponent[component]
	if !known {
		httpx.WriteError(w, http.StatusBadRequest, "unknown component")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), rulDataTimeout)
	defer cancel()

	now := time.Now().UTC()
	g, err := h.gather(ctx, vehicleID, now)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Str("component", component).Msg("rul: failed to gather component prognostics")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute remaining useful life")
		return
	}

	cfg, configured := g.configs[component]
	if !configured {
		httpx.WriteError(w, http.StatusNotFound, "component not configured")
		return
	}

	comps, proj := h.buildComponents(g, now)
	var target *ComponentRUL
	for i := range comps {
		if comps[i].Component == component {
			target = &comps[i]
			break
		}
	}
	if target == nil { // unreachable: every spec is built, but stay null-safe
		httpx.WriteError(w, http.StatusNotFound, "component not available")
		return
	}

	pi := proj[component]
	series := ProjectHealthSeries(now, pi.currentHealth, pi.wearRatePerDay, pi.eolHealth, pi.horizonDays, pi.confidence, projectionSteps)
	_ = spec // label already carried on the ComponentRUL

	httpx.WriteJSON(w, http.StatusOK, ComponentDetailResponse{
		ComponentRUL:    *target,
		EOLThreshold:    cfg.EOLThreshold,
		NominalLifeKm:   cfg.NominalLifeKm,
		NominalLifeDays: cfg.NominalLifeDays,
		Notes:           cfg.Notes,
		Projection:      series,
	})
}

// estimateBatteryCapacityWh returns the best-effort nominal pack capacity in Wh
// and a source string. Local copy of the battery-degradation helper (the carve
// playbook duplicates small stranded helpers rather than importing across
// handler packages); keep the two in sync.
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
	return defaultCapacityWh, "default"
}
