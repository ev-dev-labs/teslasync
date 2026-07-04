package energy

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/rs/zerolog/log"
)

// maxDays bounds the analytical lookback window. Both the explicit `days`
// query parameter and the `start`-date-derived window are clamped to this
// ceiling so a crafted request (e.g. ?start=1900-01-01) cannot force an
// unbounded repository scan.
const maxDays = 3650

// defaultStatsDays / defaultAnalyticsDays are the fallback windows used when
// no valid date selector is supplied. They preserve the pre-carve defaults:
// the vehicle energy view defaults to 30 days, the analytics view to 7.
const (
	defaultStatsDays     = 30
	defaultAnalyticsDays = 7
)

// statsCalculator abstracts *service.EnergyService.CalculateStats so the
// energy handler is unit-testable without standing up a Postgres pool.
// Mirrors the small fetcher-interface seam the analytics handler uses
// (ADR-002): the concrete *service.EnergyService satisfies it, so
// NewEnergyHandler keeps its exported signature.
type statsCalculator interface {
	CalculateStats(ctx context.Context, vehicleID int64, days int) (*service.EnergyStats, error)
}

// EnergyHandler handles energy statistics HTTP requests.
type EnergyHandler struct {
	energySvc statsCalculator
}

func NewEnergyHandler(energySvc *service.EnergyService) *EnergyHandler {
	return &EnergyHandler{energySvc: energySvc}
}

// Stats handles GET /vehicles/{vehicleID}/energy.
//
// The window is selected by, in order of precedence: an inclusive `start`
// date ("YYYY-MM-DD", converted to a day count from today and clamped to
// [1, maxDays]); an explicit `days` count; otherwise defaultStatsDays.
func (h *EnergyHandler) Stats(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := apiparams.URLParamInt64(r, "vehicleID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	days := defaultStatsDays
	if s := r.URL.Query().Get("start"); s != "" {
		if t, perr := time.Parse("2006-01-02", s); perr == nil {
			days = daysSince(t)
		}
	} else {
		days = parseDaysParam(r.URL.Query().Get("days"), days)
	}

	h.writeStats(w, r, vehicleID, days)
}

// AnalyticsStats handles GET /analytics/energy?vehicle_id=X&days=Y
func (h *EnergyHandler) AnalyticsStats(w http.ResponseWriter, r *http.Request) {
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	if vehicleIDStr == "" {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
		return
	}

	days := parseDaysParam(r.URL.Query().Get("days"), defaultAnalyticsDays)

	h.writeStats(w, r, vehicleID, days)
}

// writeStats computes and serialises the energy statistics shared by both
// endpoints. Errors and nil results surface as HTTP 500 with structured
// logs; success writes the pre-carve JSON key set via energyStatsResponse.
func (h *EnergyHandler) writeStats(w http.ResponseWriter, r *http.Request, vehicleID int64, days int) {
	stats, err := h.energySvc.CalculateStats(r.Context(), vehicleID, days)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Int("days", days).Msg("failed to get energy stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}
	if stats == nil {
		log.Error().Int64("vehicleID", vehicleID).Int("days", days).Msg("energy stats calculation returned nil")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get energy stats")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, energyStatsResponse(stats))
}

// daysSince converts an inclusive start date into a day count relative to
// now, clamped to [1, maxDays]. A future start collapses to 1 day; a start
// older than maxDays is capped so the query window stays bounded.
func daysSince(start time.Time) int {
	days := int(time.Since(start).Hours()/24) + 1
	if days < 1 {
		return 1
	}
	if days > maxDays {
		return maxDays
	}
	return days
}

// parseDaysParam parses a `days` query value, returning def when the value
// is absent, non-numeric, non-positive, or exceeds maxDays.
func parseDaysParam(value string, def int) int {
	if value == "" {
		return def
	}
	if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 && parsed <= maxDays {
		return parsed
	}
	return def
}

// energyStatsResponse projects computed EnergyStats onto the exact
// pre-carve JSON key set the SPA energy + analytics views consume.
//
// The duplicated total_energy_used_wh / total_energy_charged_wh / total_wh
// keys are intentional: the service exposes a single TotalEnergy figure and
// all three legacy keys echo it to preserve the wire contract (see the
// package doc). Do not collapse or re-point them without a coordinated
// frontend change.
func energyStatsResponse(stats *service.EnergyStats) map[string]interface{} {
	return map[string]interface{}{
		"vehicle_id":              stats.VehicleID,
		"period_days":             stats.PeriodDays,
		"total_energy_used_wh":    stats.TotalEnergy,
		"total_energy_charged_wh": stats.TotalEnergy,
		"total_wh":                stats.TotalEnergy,
		"total_cost":              stats.TotalCost,
		"total_distance_m":        stats.TotalDistance,
		"avg_efficiency_wh_per_m": stats.AvgEfficiency,
		"co2_saved_kg":            stats.CO2Saved,
		"daily_breakdown":         stats.DailyBreakdown,
	}
}
