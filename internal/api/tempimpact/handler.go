package tempimpact

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
)

const (
	driveStatsMetersPerMile  = 1609.344
	driveStatsTwoMilesMeters = 2.0 * driveStatsMetersPerMile

	// queryTimeout bounds the three analytics queries so a stalled pool
	// connection can never wedge the request goroutine indefinitely. The
	// pool also sets a per-connection statement_timeout; this is the
	// request-scoped upper bound layered on top.
	queryTimeout = 15 * time.Second
)

// Handler serves temperature-impact analytics.
//
// The data surface is reached through tempImpactRepository so the handler
// can be exercised without a live database, mirroring the sleep handler
// precedent. NewHandler wires the production pgx-backed repo.
type Handler struct {
	repo tempImpactRepository
}

// NewHandler binds the handler to the production pgx-backed repo.
func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: newDBTempImpactRepo(db)}
}

// newHandler is the test seam: it injects an arbitrary repository so the
// HTTP surface can be exercised with an in-memory fake.
func newHandler(repo tempImpactRepository) *Handler {
	return &Handler{repo: repo}
}

type tempEfficiencyBucket struct {
	TempBucket         string  `json:"temp_bucket"`
	DriveCount         int     `json:"drive_count"`
	AvgDistanceKm      float64 `json:"avg_distance_km"`
	AvgDurationS       float64 `json:"avg_duration_s"`
	AvgBatteryPer100km float64 `json:"avg_battery_pct_per_100km"`
	AvgTemp            float64 `json:"avg_temp"`
}

type vampireDrainBucket struct {
	TempBucket   string  `json:"temp_bucket"`
	AvgDrainRate float64 `json:"avg_drain_rate"`
	EventCount   int     `json:"event_count"`
}

type monthlyTempTrend struct {
	Month         string  `json:"month"`
	AvgTemp       float64 `json:"avg_temp"`
	AvgEfficiency float64 `json:"avg_efficiency"`
	DriveCount    int     `json:"drive_count"`
	TotalDistance float64 `json:"total_distance"`
}

type drivePoint struct {
	OutsideTemp    float64 `json:"outside_temp"`
	EfficiencyWhKm float64 `json:"efficiency_wh_km"`
	DistanceKm     float64 `json:"distance_km"`
	DriveDate      string  `json:"drive_date"`
}

// round1 / round2 apply the display rounding the pre-refactor endpoint
// used: one decimal for temperatures/distances, two for the derived
// per-100 and duration figures.
func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }

// roundEfficiency copies the raw buckets applying display rounding and
// guarantees a non-nil slice so the JSON contract stays `[]`, never null.
func roundEfficiency(in []tempEfficiencyBucket) []tempEfficiencyBucket {
	out := make([]tempEfficiencyBucket, 0, len(in))
	for _, b := range in {
		b.AvgDistanceKm = round2(b.AvgDistanceKm)
		b.AvgDurationS = round2(b.AvgDurationS)
		b.AvgBatteryPer100km = round2(b.AvgBatteryPer100km)
		b.AvgTemp = round1(b.AvgTemp)
		out = append(out, b)
	}
	return out
}

// roundTrend copies the raw monthly trend applying display rounding and
// guarantees a non-nil slice.
func roundTrend(in []monthlyTempTrend) []monthlyTempTrend {
	out := make([]monthlyTempTrend, 0, len(in))
	for _, t := range in {
		t.AvgTemp = round1(t.AvgTemp)
		t.AvgEfficiency = round2(t.AvgEfficiency)
		t.TotalDistance = round1(t.TotalDistance)
		out = append(out, t)
	}
	return out
}

// roundPoints copies the raw scatter series applying display rounding and
// guarantees a non-nil slice.
func roundPoints(in []drivePoint) []drivePoint {
	out := make([]drivePoint, 0, len(in))
	for _, p := range in {
		p.OutsideTemp = round1(p.OutsideTemp)
		p.EfficiencyWhKm = round1(p.EfficiencyWhKm)
		p.DistanceKm = round1(p.DistanceKm)
		out = append(out, p)
	}
	return out
}

// parseVehicleID validates the required vehicle_id query parameter. An
// empty value and a non-numeric or non-positive value are distinct 400
// causes; a zero or negative id is rejected outright because filtering
// `WHERE vehicle_id = 0` is never a legitimate request (see the
// apiparams.URLParamInt64 "security footgun" note).
func parseVehicleID(raw string) (int64, error) {
	if raw == "" {
		return 0, errors.New("vehicle_id query parameter required")
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, errors.New("invalid vehicle_id")
	}
	if id <= 0 {
		return 0, errors.New("invalid vehicle_id")
	}
	return id, nil
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := parseVehicleID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), queryTimeout)
	defer cancel()

	efficiency, err := h.repo.EfficiencyBuckets(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query efficiency buckets")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query temperature efficiency")
		return
	}

	monthlyTrend, err := h.repo.MonthlyTrend(ctx, vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query monthly trend")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query monthly trend")
		return
	}

	// Drive points power a best-effort scatter plot; a failure here must
	// not sink the whole response (pre-refactor behaviour), so it is logged
	// and the series degrades to empty while the primary payload is served.
	points, err := h.repo.DrivePoints(ctx, vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicleID", vehicleID).Msg("temp impact: failed to query drive points; serving empty series")
		points = nil
	}

	// vampire_drain_events no longer exists; keep the response key as an
	// empty (non-nil) array until signal_log reconstruction lands.
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"points":        roundPoints(points),
		"efficiency":    roundEfficiency(efficiency),
		"vampire_drain": make([]vampireDrainBucket, 0),
		"monthly_trend": roundTrend(monthlyTrend),
	})
}
