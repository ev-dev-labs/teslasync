package api

import (
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type LocationSnapshotHandler struct {
	repo        *database.LocationSnapshotRepo
	signalStore *signal.Store
}

func NewLocationSnapshotHandler(db *database.DB) *LocationSnapshotHandler {
	return &LocationSnapshotHandler{repo: database.NewLocationSnapshotRepo(db)}
}

// SetSignalStore wires the signal store for read-time enrichment of NULL fields.
func (h *LocationSnapshotHandler) SetSignalStore(store *signal.Store) {
	h.signalStore = store
}

func (h *LocationSnapshotHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	limit, _ := pagination(r)
	snaps, err := h.repo.GetByVehicle(r.Context(), vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Msg("failed to get location snapshot data")
		writeError(w, http.StatusInternalServerError, "failed to get location snapshot data")
		return
	}
	if snaps == nil {
		snaps = make([]*models.LocationSnapshot, 0)
	}
	for _, snap := range snaps {
		h.enrichFromSignalStore(vehicleID, snap)
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *LocationSnapshotHandler) Latest(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID == 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id required")
		return
	}
	snap, err := h.repo.GetLatest(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("failed to get latest location snapshot")
		writeError(w, http.StatusInternalServerError, "failed to get location snapshot")
		return
	}
	if snap == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	h.enrichFromSignalStore(vehicleID, snap)
	writeJSON(w, http.StatusOK, snap)
}

// enrichFromSignalStore fills NULL contextual fields on a snapshot from the
// in-memory signalStore. This covers historical rows written before the
// write-time carry-forward fix, and race conditions where the enrichment
// signal arrived after the snapshot was persisted.
func (h *LocationSnapshotHandler) enrichFromSignalStore(vehicleID int64, snap *models.LocationSnapshot) {
	if h.signalStore == nil {
		return
	}
	if snap.LocatedAtHome == nil {
		if v, ok := h.signalStore.GetBool(vehicleID, "LocatedAtHome"); ok {
			snap.LocatedAtHome = &v
		}
	}
	if snap.LocatedAtWork == nil {
		if v, ok := h.signalStore.GetBool(vehicleID, "LocatedAtWork"); ok {
			snap.LocatedAtWork = &v
		}
	}
	if snap.LocatedAtFavorite == nil {
		if v, ok := h.signalStore.GetBool(vehicleID, "LocatedAtFavorite"); ok {
			snap.LocatedAtFavorite = &v
		}
	}
	if snap.DestinationName == nil {
		if v, ok := h.signalStore.GetString(vehicleID, "DestinationName"); ok && v != "" {
			snap.DestinationName = &v
		}
	}
	if snap.GpsState == nil {
		if v, ok := h.signalStore.GetString(vehicleID, "GpsState"); ok && v != "" {
			snap.GpsState = &v
		}
	}
}
