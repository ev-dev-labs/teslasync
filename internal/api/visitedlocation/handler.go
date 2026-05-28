package visitedlocation

import (
	"net/http"
	"strconv"

	geomodel "github.com/ev-dev-labs/teslasync/internal/models/geo"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tripdb "github.com/ev-dev-labs/teslasync/internal/database/trip"
	"github.com/rs/zerolog/log"
)

type Handler struct {
	repo *tripdb.VisitedLocationRepo
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: tripdb.NewVisitedLocationRepo(db)}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := apiparams.Pagination(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")

	if vehicleIDStr != "" {
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		locs, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
		if err != nil {
			log.Error().Err(err).Msg("failed to get visited locations")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
			return
		}
		if locs == nil {
			locs = make([]*geomodel.VisitedLocation, 0)
		}
		httpx.WriteJSON(w, http.StatusOK, locs)
		return
	}

	locs, err := h.repo.GetAll(r.Context(), limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get visited locations")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get visited locations")
		return
	}
	if locs == nil {
		locs = make([]*geomodel.VisitedLocation, 0)
	}
	httpx.WriteJSON(w, http.StatusOK, locs)
}
