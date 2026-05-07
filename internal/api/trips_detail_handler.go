package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// metersPerKilometer + wattHoursPerKilowattHour are the SI conversion
// constants used to translate the repo's canonical SI units to the
// km / kWh form the frontend Trip type expects. Inlined as named
// constants so the math is self-documenting and a future grep for
// "1000.0" in this file does not produce false positives.
const (
	metersPerKilometer       = 1000.0
	wattHoursPerKilowattHour = 1000.0
)

// tripsDetailRepository is the narrow interface the handler depends
// on. Declared at the call site so handler tests can inject an
// in-memory fake without reaching into the database package.
// *database.TripsDetailRepo satisfies this interface.
type tripsDetailRepository interface {
	GetTrip(ctx context.Context, tripID int64) (*database.TripDetail, error)
}

// TripsDetailHandler serves GET /trips/{trip_id}.
//
// Decision D9: relies on the router-level authentication middleware
// (Authentik ForwardAuth + bearer-token fallback) for caller identity;
// no per-vehicle ownership check is performed at this layer to mirror
// the existing /drives/{driveID} endpoint behaviour (Decision #5
// in the prompt).
type TripsDetailHandler struct {
	repo tripsDetailRepository
}

// NewTripsDetailHandler panics on a nil repo (fail-fast at startup,
// mirrors Phase-43a/0007 NewSignalsCatalogHandler precedent).
func NewTripsDetailHandler(repo tripsDetailRepository) *TripsDetailHandler {
	if repo == nil {
		panic("api: NewTripsDetailHandler requires non-nil repo")
	}
	return &TripsDetailHandler{repo: repo}
}

// tripDriveSummaryDTO is the per-drive entry returned in the
// "drives" array. Nullable fields use *float64 / *int64 / *string
// so JSON nulls (not zeros) surface for genuinely missing data.
type tripDriveSummaryDTO struct {
	ID             int64      `json:"id"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at"`
	DistanceKm     *float64   `json:"distance_km"`
	EnergyUsedKWh  *float64   `json:"energy_used_kwh"`
	DurationS      *int64     `json:"duration_s"`
	StartPlace     *string    `json:"start_place"`
	EndPlace       *string    `json:"end_place"`
}

// tripDetailResponse is the wire DTO. SUPERSET shape per Decision D2:
//
//   - frontend Trip interface fields:
//       id, vehicle_id, name, start_date, end_date,
//       total_distance_km, total_energy_kwh, total_cost,
//       drive_count, charge_count, created_at
//   - prompt Decision #3 fields:
//       started_at, ended_at, total_duration_seconds,
//       energy_used_kwh (alias), drives:[...]
//
// Notes:
//   - created_at is derived from started_at because the SI trips
//     table intentionally has no audit column (rubber-duck issue #4).
//   - end_date and ended_at remain JSON null while a trip is open
//     (rubber-duck issue #7); the SQL window-effective-end is only
//     used inside the repo aggregation, never rendered.
//   - route_polyline from prompt Decision #3 is intentionally OMITTED
//     because the schema has no per-trip polyline source
//     (rubber-duck issue #11).
type tripDetailResponse struct {
	ID                   int64                 `json:"id"`
	VehicleID            int64                 `json:"vehicle_id"`
	Name                 *string               `json:"name"`
	StartDate            time.Time             `json:"start_date"`
	StartedAt            time.Time             `json:"started_at"`
	EndDate              *time.Time            `json:"end_date"`
	EndedAt              *time.Time            `json:"ended_at"`
	TotalDistanceKm      float64               `json:"total_distance_km"`
	TotalEnergyKWh       float64               `json:"total_energy_kwh"`
	EnergyUsedKWh        float64               `json:"energy_used_kwh"`
	TotalDurationSeconds int64                 `json:"total_duration_seconds"`
	TotalCost            float64               `json:"total_cost"`
	DriveCount           int64                 `json:"drive_count"`
	ChargeCount          int64                 `json:"charge_count"`
	Drives               []tripDriveSummaryDTO `json:"drives"`
	CreatedAt            time.Time             `json:"created_at"`
}

// Get serves GET /trips/{trip_id}.
func (h *TripsDetailHandler) Get(w http.ResponseWriter, r *http.Request) {
	tripID, err := urlParamInt64(r, "trip_id")
	if err != nil || tripID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid trip id")
		return
	}

	td, err := h.repo.GetTrip(r.Context(), tripID)
	if err != nil {
		if errors.Is(err, database.ErrTripNotFound) {
			writeError(w, http.StatusNotFound, "trip not found")
			return
		}
		log.Error().Err(err).Int64("trip_id", tripID).Msg("failed to load trip detail")
		writeError(w, http.StatusInternalServerError, "failed to load trip")
		return
	}

	writeJSON(w, http.StatusOK, buildTripDetailResponse(td))
}

// buildTripDetailResponse converts the repo-level TripDetail (raw SI
// units) to the wire DTO with km / kWh + alias fields. Pulled out as
// a free function so handler tests can pin the conversion math
// without spinning up a full http test server.
func buildTripDetailResponse(td *database.TripDetail) tripDetailResponse {
	totalKm := td.DistanceM / metersPerKilometer
	totalKWh := td.EnergyUsedWh / wattHoursPerKilowattHour

	resp := tripDetailResponse{
		ID:                   td.ID,
		VehicleID:            td.VehicleID,
		Name:                 td.Name,
		StartDate:            td.StartedAt,
		StartedAt:            td.StartedAt,
		EndDate:              td.EndedAt,
		EndedAt:              td.EndedAt,
		TotalDistanceKm:      totalKm,
		TotalEnergyKWh:       totalKWh,
		EnergyUsedKWh:        totalKWh,
		TotalDurationSeconds: td.DurationS,
		TotalCost:            td.TotalCost,
		DriveCount:           td.DriveCount,
		ChargeCount:          td.ChargeCount,
		Drives:               make([]tripDriveSummaryDTO, 0, len(td.Drives)),
		CreatedAt:            td.StartedAt,
	}
	for _, d := range td.Drives {
		resp.Drives = append(resp.Drives, tripDriveSummaryDTO{
			ID:            d.ID,
			StartedAt:     d.StartedAt,
			EndedAt:       d.EndedAt,
			DistanceKm:    convertOptMetersToKm(d.DistanceM),
			EnergyUsedKWh: convertOptWhToKWh(d.EnergyUsedWh),
			DurationS:     d.DurationS,
			StartPlace:    d.StartPlace,
			EndPlace:      d.EndPlace,
		})
	}
	return resp
}

// convertOptMetersToKm preserves nullability — a missing distance_m
// for a single drive surfaces as JSON null, not "0".
func convertOptMetersToKm(m *float64) *float64 {
	if m == nil {
		return nil
	}
	v := *m / metersPerKilometer
	return &v
}

// convertOptWhToKWh preserves nullability for energy_used_wh.
func convertOptWhToKWh(wh *float64) *float64 {
	if wh == nil {
		return nil
	}
	v := *wh / wattHoursPerKilowattHour
	return &v
}
