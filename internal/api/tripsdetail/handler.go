package tripsdetail

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
)

// tripsDetailRepository is the narrow interface the handler depends
// on. Declared at the call site so handler tests can inject an
// in-memory fake without reaching into the database package.
// *tripdb.TripsDetailRepo satisfies this interface.
type tripsDetailRepository interface {
	GetTrip(ctx context.Context, tripID int64) (*tripdb.TripDetail, error)
}

// Handler serves GET /trips/{trip_id}.
//
// Decision D9: relies on the router-level authentication middleware
// (Authentik ForwardAuth + bearer-token fallback) for caller identity;
// no per-vehicle ownership check is performed at this layer to mirror
// the existing /drives/{driveID} endpoint behaviour (Decision #5
// in the prompt).
type Handler struct {
	repo tripsDetailRepository
}

// NewHandler panics on a nil repo (fail-fast at startup,
// mirrors Phase-43a/0007 NewSignalsCatalogHandler precedent).
func NewHandler(repo tripsDetailRepository) *Handler {
	if repo == nil {
		panic("tripsdetail: NewHandler requires non-nil repo")
	}
	return &Handler{repo: repo}
}

// tripDriveSummaryDTO is the per-drive entry returned in the
// "drives" array. Nullable fields use *float64 / *int64 / *string
// so JSON nulls (not zeros) surface for genuinely missing data.
type tripDriveSummaryDTO struct {
	ID           int64      `json:"id"`
	StartedAt    time.Time  `json:"started_at"`
	EndedAt      *time.Time `json:"ended_at"`
	DistanceM    *float64   `json:"distance_m"`
	EnergyUsedWh *float64   `json:"energy_used_wh"`
	DurationS    *int64     `json:"duration_s"`
	StartPlace   *string    `json:"start_place"`
	EndPlace     *string    `json:"end_place"`
}

// tripDetailResponse is the wire DTO. SUPERSET shape per Decision D2:
//
//   - frontend Trip interface fields:
//     id, vehicle_id, name, start_date, end_date,
//     total_distance_m, total_energy_wh, total_cost,
//     drive_count, charge_count, created_at
//   - prompt Decision #3 fields:
//     started_at, ended_at, total_duration_s,
//     energy_used_wh (alias), drives:[...]
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
	ID             int64                 `json:"id"`
	VehicleID      int64                 `json:"vehicle_id"`
	Name           *string               `json:"name"`
	StartDate      time.Time             `json:"start_date"`
	StartedAt      time.Time             `json:"started_at"`
	EndDate        *time.Time            `json:"end_date"`
	EndedAt        *time.Time            `json:"ended_at"`
	TotalDistanceM float64               `json:"total_distance_m"`
	TotalEnergyWh  float64               `json:"total_energy_wh"`
	EnergyUsedWh   float64               `json:"energy_used_wh"`
	TotalDurationS int64                 `json:"total_duration_s"`
	TotalCost      float64               `json:"total_cost"`
	DriveCount     int64                 `json:"drive_count"`
	ChargeCount    int64                 `json:"charge_count"`
	Drives         []tripDriveSummaryDTO `json:"drives"`
	CreatedAt      time.Time             `json:"created_at"`
}

// Get serves GET /trips/{trip_id}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	tripID, err := apiparams.URLParamInt64(r, "trip_id")
	if err != nil || tripID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid trip id")
		return
	}

	td, err := h.repo.GetTrip(r.Context(), tripID)
	if err != nil {
		if errors.Is(err, tripdb.ErrTripNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "trip not found")
			return
		}
		log.Error().Err(err).Int64("trip_id", tripID).Msg("failed to load trip detail")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load trip")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, buildTripDetailResponse(td))
}

// buildTripDetailResponse converts the repo-level TripDetail to the SI-canonical
// wire DTO. Pulled out as a free function so handler tests can pin the response
// shape without spinning up a full http test server.
func buildTripDetailResponse(td *tripdb.TripDetail) tripDetailResponse {
	resp := tripDetailResponse{
		ID:             td.ID,
		VehicleID:      td.VehicleID,
		Name:           td.Name,
		StartDate:      td.StartedAt,
		StartedAt:      td.StartedAt,
		EndDate:        td.EndedAt,
		EndedAt:        td.EndedAt,
		TotalDistanceM: td.DistanceM,
		TotalEnergyWh:  td.EnergyUsedWh,
		EnergyUsedWh:   td.EnergyUsedWh,
		TotalDurationS: td.DurationS,
		TotalCost:      td.TotalCost,
		DriveCount:     td.DriveCount,
		ChargeCount:    td.ChargeCount,
		Drives:         make([]tripDriveSummaryDTO, 0, len(td.Drives)),
		CreatedAt:      td.StartedAt,
	}
	for _, d := range td.Drives {
		resp.Drives = append(resp.Drives, tripDriveSummaryDTO{
			ID:           d.ID,
			StartedAt:    d.StartedAt,
			EndedAt:      d.EndedAt,
			DistanceM:    cloneOptFloat(d.DistanceM),
			EnergyUsedWh: cloneOptFloat(d.EnergyUsedWh),
			DurationS:    d.DurationS,
			StartPlace:   d.StartPlace,
			EndPlace:     d.EndPlace,
		})
	}
	return resp
}

// cloneOptFloat preserves nullability — missing per-drive metrics surface as
// JSON null, not zero.
func cloneOptFloat(v *float64) *float64 {
	if v == nil {
		return nil
	}
	out := *v
	return &out
}
