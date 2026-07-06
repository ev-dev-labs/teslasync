package weeklydigest

import (
	"context"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

const (
	// costPerKWh is the flat electricity price applied to weekly energy.
	// The per-vehicle price setting is intentionally NOT consulted (see
	// doc.go) so the digest renders on first paint without a settings
	// round-trip.
	costPerKWh = 0.14
	// weekQueryTimeout bounds the two per-week aggregate reads so a slow
	// or wedged pool cannot hold the request open indefinitely.
	weekQueryTimeout = 10 * time.Second
)

// Handler returns aggregated stats comparing current vs previous week.
//
// The data surface is reached through weeklyRepository so the handler can
// be exercised without a live database; clock is injectable so the
// week-boundary math is deterministic under test.
type Handler struct {
	repo  weeklyRepository
	clock func() time.Time
}

// NewHandler binds the handler to the production pgx-backed repo.
func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: newDBWeeklyRepo(db)}
}

// now returns the injected clock or wall-clock local time. Centralising the
// time source keeps both week windows derived from a single instant per
// request and lets tests pin the boundary. Local time (not UTC) is used so
// the week stays anchored to the operator's Sunday (see doc.go).
func (h *Handler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now()
}

// Get serves GET /api/v1/vehicles/{vehicleID}/weekly-digest. It returns
// 400 for a missing/invalid vehicle ID, 500 when a drive-aggregate read
// fails, and 200 with the current-vs-previous-week envelope otherwise.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), weekQueryTimeout)
	defer cancel()

	now := h.now()
	weekStart := startOfWeek(now)
	prevWeekStart := weekStart.AddDate(0, 0, -7)

	// A read failure must surface as a 500: silently returning all-zero
	// stats would mask a database outage as a genuine "no drives" week and
	// corrupt the current-vs-previous comparison.
	curr, err := h.weekStats(ctx, vehicleID, weekStart, now)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("weekly-digest: current-week query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load weekly digest")
		return
	}
	prev, err := h.weekStats(ctx, vehicleID, prevWeekStart, weekStart)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("weekly-digest: previous-week query failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load weekly digest")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"drives":           curr.Drives,
		"distance_km":      curr.DistanceKm,
		"energy_kwh":       curr.EnergyKwh,
		"cost":             curr.Cost,
		"efficiency":       curr.Efficiency,
		"prev_drives":      prev.Drives,
		"prev_distance_km": prev.DistanceKm,
		"prev_energy_kwh":  prev.EnergyKwh,
		"prev_cost":        prev.Cost,
		"prev_efficiency":  prev.Efficiency,
	})
}

// weekStats fetches the raw SI totals for one [start, end) window and
// converts them to the legacy km / kWh / cost / efficiency wire shape.
func (h *Handler) weekStats(ctx context.Context, vehicleID int64, start, end time.Time) (weekStats, error) {
	drives, distanceM, energyWh, err := h.repo.WeekTotals(ctx, vehicleID, start, end)
	if err != nil {
		return weekStats{}, err
	}
	return computeWeekStats(drives, distanceM, energyWh), nil
}

// startOfWeek returns midnight on the Sunday of t's week, in t's location.
// Weekday() is 0 for Sunday, so subtracting it lands on the current week's
// Sunday; the clock component is then truncated to 00:00:00.
func startOfWeek(t time.Time) time.Time {
	weekStart := t.AddDate(0, 0, -int(t.Weekday()))
	return time.Date(weekStart.Year(), weekStart.Month(), weekStart.Day(), 0, 0, 0, 0, t.Location())
}

// computeWeekStats converts raw SI drive totals (metres, watt-hours) into
// the legacy km / kWh wire shape, applying the flat cost multiplier and the
// Wh/km efficiency. DistanceKm is guarded so a zero-distance week never
// divides by zero.
func computeWeekStats(drives int, distanceM, energyWh float64) weekStats {
	s := weekStats{
		Drives:     drives,
		DistanceKm: distanceM / 1000.0,
		EnergyKwh:  energyWh / 1000.0,
	}
	s.Cost = s.EnergyKwh * costPerKWh
	if s.DistanceKm > 0 {
		s.Efficiency = s.EnergyKwh / s.DistanceKm * 1000 // Wh/km
	}
	return s
}
