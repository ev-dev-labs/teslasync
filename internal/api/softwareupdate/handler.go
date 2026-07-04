package softwareupdate

import (
	"context"
	"net/http"
	"strconv"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/rs/zerolog/log"
)

// softwareUpdateRepository is the minimal repo surface Handler needs.
// Defined as an interface so the handler tests can supply a fake without
// standing up a database — mirroring the port pattern used by the sibling
// vehiclestates handler. *systemdb.SoftwareUpdateRepo satisfies it.
type softwareUpdateRepository interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error)
	GetAll(ctx context.Context, limit int, start, end time.Time) ([]*vehiclemodel.SoftwareUpdate, error)
}

type Handler struct {
	repo softwareUpdateRepository
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{repo: systemdb.NewSoftwareUpdateRepo(db)}
}

// List serves GET /api/v1/software-updates.
//
// With ?vehicle_id=<positive int64> the durable firmware history is scoped
// to a single vehicle via GetByVehicle; without it GetAll returns the
// fleet-wide history. Both modes honour ?limit= pagination and the
// ?start=&end= date range. A nil result set is normalised to an empty JSON
// array so the frontend safeArray helpers never encounter `null`.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	limit, _ := apiparams.Pagination(r)
	vehicleIDStr := r.URL.Query().Get("vehicle_id")
	startTime, endTime := apiparams.ParseDateRange(r)

	if vehicleIDStr != "" {
		// A parse failure OR a non-positive value is a client error:
		// treating vehicle_id=0/-5 as a valid scope would issue a query
		// for a sentinel/impossible vehicle rather than surfacing the bad
		// input (matches the sibling vehiclestates contract).
		vehicleID, err := strconv.ParseInt(vehicleIDStr, 10, 64)
		if err != nil || vehicleID <= 0 {
			httpx.WriteError(w, http.StatusBadRequest, "invalid vehicle_id")
			return
		}
		updates, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit, startTime, endTime)
		if err != nil {
			log.Error().Err(err).Int64("vehicle_id", vehicleID).Int("limit", limit).Msg("software_updates.list: GetByVehicle failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get software updates")
			return
		}
		if updates == nil {
			updates = make([]*vehiclemodel.SoftwareUpdate, 0)
		}
		httpx.WriteJSON(w, http.StatusOK, updates)
		return
	}

	updates, err := h.repo.GetAll(r.Context(), limit, startTime, endTime)
	if err != nil {
		log.Error().Err(err).Int("limit", limit).Msg("software_updates.list: GetAll failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get software updates")
		return
	}
	if updates == nil {
		updates = make([]*vehiclemodel.SoftwareUpdate, 0)
	}
	httpx.WriteJSON(w, http.StatusOK, updates)
}
