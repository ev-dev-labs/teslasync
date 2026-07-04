package regen

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
	"github.com/rs/zerolog/log"
)

// RegenHandler handles regenerative braking analytics HTTP requests.
type RegenHandler struct {
	repo regenRepository
}

// NewRegenHandler builds the handler backed by the production
// pgx-backed repository. The signature is preserved for router wiring;
// the data-access seam lives behind regenRepository so the handler can be
// exercised in tests without a live database.
func NewRegenHandler(db *database.DB) *RegenHandler {
	return &RegenHandler{repo: newRegenRepo(db)}
}

// newRegenHandlerForTest injects a fake repository. Test-only.
func newRegenHandlerForTest(repo regenRepository) *RegenHandler {
	return &RegenHandler{repo: repo}
}

const (
	metersPerMile      = 1609.344
	mpsPerMph          = 0.44704
	wattsPerKilowatt   = 1000.0
	twoMilesMeters     = 2.0 * metersPerMile
	defaultCapacityWh  = 75000.0
	standardCapacityWh = 60000.0
	largeCapacityWh    = 100000.0
)

// driveRegen is one per-drive entry in the Stats response. Distance is
// reported in miles (legacy "distance" field semantics); avg_speed_mps is
// raw SI metres-per-second; duration_s is seconds. JSON keys are stable
// wire contract — do not rename without coordinating the frontend.
type driveRegen struct {
	ID          int64     `json:"id"`
	StartDate   time.Time `json:"start_date"`
	Distance    float64   `json:"distance"`
	DurationS   float64   `json:"duration_s"`
	SpeedAvgMps *float64  `json:"avg_speed_mps"`
	PowerMaxW   *float64  `json:"avg_power_w"`
	PowerMinW   *float64  `json:"min_power_w"`
	StartSocPct *float64  `json:"start_soc_pct"`
	EndSocPct   *float64  `json:"end_soc_pct"`
	Efficiency  float64   `json:"efficiency"`
	RegenScore  float64   `json:"regen_score"`
}

// monthlySummary is one month bucket in the Stats response. AvgRegenPower
// is SI watts despite the avg_regen_power_kw key (see monthlyRegenRow);
// AvgSpeed is mph.
type monthlySummary struct {
	Month         string  `json:"month"`
	DriveCount    int     `json:"drive_count"`
	AvgRegenPower float64 `json:"avg_regen_power_kw"`
	AvgSpeed      float64 `json:"avg_speed"`
	AvgEfficiency float64 `json:"avg_efficiency"`
}

// Stats serves GET /analytics/regen?vehicle_id=...[&start=...&end=...].
//
// Optional date bounds via ?start=YYYY-MM-DD&end=YYYY-MM-DD (or RFC 3339)
// scope every sub-query to the same window so the picker controls the
// whole response uniformly. When omitted: full history, no trailing-window
// fallback. A per-drive list, a monthly summary, and lifetime cagg totals
// are combined into a single envelope.
func (h *RegenHandler) Stats(w http.ResponseWriter, r *http.Request) {
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
	// A non-positive id can never match a real vehicle row (ids are
	// positive BIGSERIAL); reject it up front rather than issue queries
	// that can only ever return empty. Mirrors the sibling mileage handler.
	if vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be positive")
		return
	}

	startTime, endTime := apiparams.ParseDateRange(r)
	hasRange := !startTime.IsZero() && !endTime.IsZero()

	ctx := r.Context()

	capacityWh, capacitySource := h.capacity(ctx, vehicleID)

	driveRows, err := h.repo.DriveRegens(ctx, vehicleID, hasRange, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("regen: failed to get drive data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get regen data")
		return
	}
	drives := buildDriveRegens(driveRows)

	monthRows, err := h.repo.MonthlyRegens(ctx, vehicleID, hasRange, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("regen: failed to get monthly data")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get regen data")
		return
	}
	monthly := buildMonthlyRegens(monthRows)

	// Lifetime regen/drive energy is non-fatal: a cagg read failure
	// degrades the gauges to zero rather than failing the whole response.
	totalRegenWh, totalDriveWh, err := h.repo.LifetimeEnergy(ctx, vehicleID, hasRange, startTime, endTime)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("regen: cagg_fleet_stats query failed")
		totalRegenWh, totalDriveWh = 0, 0
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id":        vehicleID,
		"total_regen_wh":    math.Round(totalRegenWh*100) / 100,
		"total_drive_wh":    math.Round(totalDriveWh*100) / 100,
		"regen_ratio":       math.Round(regenRatio(totalRegenWh, totalDriveWh)*10) / 10,
		"monthly_avg_regen": avgMonthlyRegen(monthly),
		"free_charges":      freeChargesEquivalent(totalRegenWh, capacityWh),
		"monthly_summary":   monthly,
		"drives":            drives,
		// Capacity estimate metadata
		"battery_capacity_wh": capacityWh,
		"capacity_source":     capacitySource,
	})
}

// capacity resolves the vehicle's estimated usable battery capacity (Wh)
// and the provenance of that estimate. A repository lookup failure (e.g.
// unknown vehicle) is non-fatal and falls back to the platform default —
// the regen endpoint reports data for any id rather than 404ing.
func (h *RegenHandler) capacity(ctx context.Context, vehicleID int64) (float64, string) {
	vin, model, err := h.repo.VehicleModel(ctx, vehicleID)
	if err != nil {
		return defaultCapacityWh, "default"
	}
	return estimateBatteryCapacityWh(vin, model)
}

// buildDriveRegens converts scanned drive rows into the response shape,
// applying the metres→miles distance conversion, the duration cast, and
// the regen-score derivation. Always returns a non-nil slice so the JSON
// field marshals to [] rather than null.
func buildDriveRegens(rows []driveRegenRow) []driveRegen {
	out := make([]driveRegen, 0, len(rows))
	for _, row := range rows {
		d := driveRegen{
			ID:          row.ID,
			StartDate:   row.StartDate,
			SpeedAvgMps: row.SpeedAvgMps,
			PowerMaxW:   row.PowerAvgW,
			PowerMinW:   row.PowerMinW,
			StartSocPct: row.StartSocPct,
			EndSocPct:   row.EndSocPct,
			Efficiency:  row.Efficiency,
		}
		if row.DistanceM != nil {
			d.Distance = *row.DistanceM / metersPerMile
		}
		if row.DurationS != nil {
			d.DurationS = float64(*row.DurationS)
		}
		d.RegenScore = regenScore(row.PowerMinW, row.SpeedAvgMps)
		out = append(out, d)
	}
	return out
}

// buildMonthlyRegens converts scanned month buckets into the response
// shape. AvgRegenPower stays in watts; AvgSpeed is converted m/s→mph. All
// three numeric fields are rounded to one decimal. Always returns a
// non-nil slice.
func buildMonthlyRegens(rows []monthlyRegenRow) []monthlySummary {
	out := make([]monthlySummary, 0, len(rows))
	for _, row := range rows {
		m := monthlySummary{
			Month:      row.Month.Format("2006-01"),
			DriveCount: row.DriveCount,
		}
		if row.AvgPowerW != nil {
			m.AvgRegenPower = math.Round(*row.AvgPowerW*10) / 10
		}
		if row.AvgSpeedMps != nil {
			m.AvgSpeed = math.Round((*row.AvgSpeedMps/mpsPerMph)*10) / 10
		}
		if row.AvgEff != nil {
			m.AvgEfficiency = math.Round(*row.AvgEff*10) / 10
		}
		out = append(out, m)
	}
	return out
}

// regenScore derives a 0–100 regen quality score from the (absolute)
// regen power and average speed. Preserves the legacy ratio shape
// (kW / mph * 10) and caps at 100. When speed is unknown or non-positive
// the score defaults to the legacy 1.0 floor; a nil power yields 0.
func regenScore(powerMinW, speedAvgMps *float64) float64 {
	if powerMinW == nil {
		return 0
	}
	regenW := math.Abs(*powerMinW)
	speedFactor := 1.0
	if speedAvgMps != nil && *speedAvgMps > 0 {
		speedFactor = (regenW / wattsPerKilowatt) / (*speedAvgMps / mpsPerMph) * 10
	}
	return math.Min(math.Round(speedFactor*10)/10, 100)
}

// regenRatio is the share of drive energy recovered via regen, as a
// percentage. Guarded against a zero (or negative) drive-energy divide.
func regenRatio(totalRegenWh, totalDriveWh float64) float64 {
	if totalDriveWh <= 0 {
		return 0
	}
	return totalRegenWh / totalDriveWh * 100
}

// avgMonthlyRegen averages the per-month AvgRegenPower values, rounded to
// one decimal. Empty input yields 0.
func avgMonthlyRegen(monthly []monthlySummary) float64 {
	if len(monthly) == 0 {
		return 0
	}
	sum := 0.0
	for _, m := range monthly {
		sum += m.AvgRegenPower
	}
	return math.Round(sum/float64(len(monthly))*10) / 10
}

// freeChargesEquivalent expresses lifetime regen energy as whole/partial
// battery charges, rounded to one decimal. Zero (or negative) regen
// energy or capacity yields 0.
func freeChargesEquivalent(totalRegenWh, capacityWh float64) float64 {
	if totalRegenWh <= 0 || capacityWh <= 0 {
		return 0
	}
	return math.Round(totalRegenWh/capacityWh*10) / 10
}

// estimateBatteryCapacityWh estimates usable pack capacity (Wh) from the
// VIN's battery-type character (8th position) with a model-name fallback.
// Unknown vehicles fall back to the platform default.
func estimateBatteryCapacityWh(vin string, model string) (float64, string) {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return standardCapacityWh, "vin_estimate"
		case 'K', 'L', 'M':
			return defaultCapacityWh, "vin_estimate"
		case 'S', 'A', 'P':
			return largeCapacityWh, "vin_estimate"
		}
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return largeCapacityWh, "model_estimate"
	}
	return defaultCapacityWh, "default"
}
