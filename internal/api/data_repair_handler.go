package api

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// DataRepairHandler handles endpoints for repairing incomplete/stale sessions.
type DataRepairHandler struct {
	chargingRepo *database.ChargingRepo
	driveRepo    *database.DriveRepo
}

func NewDataRepairHandler(db *database.DB) *DataRepairHandler {
	return &DataRepairHandler{
		chargingRepo: database.NewChargingRepo(db),
		driveRepo:    database.NewDriveRepo(db),
	}
}

// StaleSessionsResponse contains charging sessions and drives that are still open.
type StaleSessionsResponse struct {
	StaleCharging []*models.ChargingSession `json:"stale_charging"`
	StaleDrives   []*models.Drive           `json:"stale_drives"`
}

// GetStaleSessions returns sessions with no end_ts that started more than 24 hours ago.
func (h *DataRepairHandler) GetStaleSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cutoff := time.Now().UTC().Add(-24 * time.Hour)

	charging, err := h.chargingRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Error().Err(err).Msg("failed to get stale charging sessions")
		writeError(w, http.StatusInternalServerError, "failed to get stale charging sessions")
		return
	}

	drives, err := h.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Error().Err(err).Msg("failed to get stale drives")
		writeError(w, http.StatusInternalServerError, "failed to get stale drives")
		return
	}

	if charging == nil {
		charging = make([]*models.ChargingSession, 0)
	}
	if drives == nil {
		drives = make([]*models.Drive, 0)
	}

	writeJSON(w, http.StatusOK, StaleSessionsResponse{
		StaleCharging: charging,
		StaleDrives:   drives,
	})
}

// UpdateCharging partially updates a charging session with user-provided values.
func (h *DataRepairHandler) UpdateCharging(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if err := h.chargingRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update charging session")
		writeError(w, http.StatusInternalServerError, "failed to update charging session")
		return
	}

	updated, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get updated charging session")
		writeError(w, http.StatusInternalServerError, "failed to get updated session")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// UpdateDrive partially updates a drive with user-provided values.
func (h *DataRepairHandler) UpdateDrive(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if err := h.driveRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update drive")
		writeError(w, http.StatusInternalServerError, "failed to update drive")
		return
	}

	updated, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get updated drive")
		writeError(w, http.StatusInternalServerError, "failed to get updated drive")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// CloseCharging sets end_ts=NOW() and calculates duration from start_ts.
func (h *DataRepairHandler) CloseCharging(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	now := time.Now().UTC()
	duration := math.Round(now.Sub(session.StartTs).Minutes()*100) / 100

	patch := map[string]interface{}{
		"end_ts":       now.Format(time.RFC3339),
		"duration_min": duration,
	}
	if err := h.chargingRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to close charging session")
		writeError(w, http.StatusInternalServerError, "failed to close charging session")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

// CloseDrive sets end_ts=NOW() and calculates duration from start_ts.
func (h *DataRepairHandler) CloseDrive(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	drive, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	now := time.Now().UTC()
	duration := math.Round(now.Sub(drive.StartTs).Minutes()*100) / 100

	patch := map[string]interface{}{
		"end_ts":       now.Format(time.RFC3339),
		"duration_min": duration,
	}
	if err := h.driveRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to close drive")
		writeError(w, http.StatusInternalServerError, "failed to close drive")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

// DeleteCharging removes a stale charging session.
func (h *DataRepairHandler) DeleteCharging(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		writeError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "charging session not found")
		return
	}

	if err := h.chargingRepo.Delete(ctx, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete charging session")
		writeError(w, http.StatusInternalServerError, "failed to delete charging session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteDrive removes a stale drive.
func (h *DataRepairHandler) DeleteDrive(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		writeError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "drive not found")
		return
	}

	if err := h.driveRepo.Delete(ctx, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete drive")
		writeError(w, http.StatusInternalServerError, "failed to delete drive")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
