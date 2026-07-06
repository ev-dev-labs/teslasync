package visitedlocation

import (
	"context"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"
)

// visitedLocationRepo is the narrow port the handler depends on. Declaring it
// at the call site lets handler tests inject an in-memory fake without standing
// up a real Postgres pool. *tripdb.VisitedLocationRepo satisfies this interface.
type visitedLocationRepo interface {
	GetAll(ctx context.Context, limit int) ([]*geomodel.VisitedLocation, error)
	GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*geomodel.VisitedLocation, error)
}

// Compile-time guard that the production repo still satisfies the port. A
// method-signature drift fails the build here rather than at runtime.
var _ visitedLocationRepo = (*tripdb.VisitedLocationRepo)(nil)

// Handler serves GET /locations — the read-only visited-location listing,
// optionally scoped by vehicle_id.
type Handler struct {
	repo visitedLocationRepo
}

// NewHandler wires the production repo. Panics on a nil db (fail-fast at
// startup) so a misconfigured router crashes before serving traffic rather
// than nil-dereferencing on the first request.
func NewHandler(db *database.DB) *Handler {
	if db == nil {
		panic("visitedlocation: NewHandler requires non-nil db")
	}
	return newHandler(tripdb.NewVisitedLocationRepo(db))
}

// newHandler injects an arbitrary visitedLocationRepo. Kept unexported so the
// public surface stays db-based while handler tests can supply a fake.
func newHandler(repo visitedLocationRepo) *Handler {
	if repo == nil {
		panic("visitedlocation: newHandler requires non-nil repo")
	}
	return &Handler{repo: repo}
}

// List serves GET /locations. With ?vehicle_id=<id> it scopes to a single
// vehicle; without it, it returns the fleet-wide most-visited places.
//
// Results are aggregated top-N by visit_count (LIMIT only), so offset-style
// pagination is not meaningful for this endpoint — the offset returned by
// apiparams.Pagination is intentionally discarded.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := apiparams.Pagination(r)

	if vehicleIDStr := r.URL.Query().Get("vehicle_id"); vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil || vehicleID <= 0 {
			httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		locs, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
		if err != nil {
			log.Error().Err(err).
				Int64("vehicle_id", vehicleID).
				Int("limit", limit).
				Msg("failed to get visited locations by vehicle")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, nonNilLocations(locs))
		return
	}

	locs, err := h.repo.GetAll(r.Context(), limit)
	if err != nil {
		log.Error().Err(err).
			Int("limit", limit).
			Msg("failed to get visited locations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, nonNilLocations(locs))
}

// nonNilLocations guarantees a non-nil slice so the JSON body encodes as []
// rather than null. The frontend list rendering iterates the response array
// directly, and a null payload would throw a runtime error.
func nonNilLocations(locs []*geomodel.VisitedLocation) []*geomodel.VisitedLocation {
	if locs == nil {
		return make([]*geomodel.VisitedLocation, 0)
	}
	return locs
}
