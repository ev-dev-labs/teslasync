package datarepair

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/rs/zerolog/log"
)

// chargingRepository is the narrow charging-session data-access surface the
// handler depends on. Declared as an interface at the call site so handler
// tests can inject an in-memory fake without a real database (the codebase has
// no pgxmock harness). *chargingdb.ChargingRepo satisfies this interface.
type chargingRepository interface {
	GetStale(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, error)
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
	PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error
	Delete(ctx context.Context, id int64) error
}

// driveRepository is the narrow drive data-access surface the handler depends
// on. *drivedb.DriveRepo satisfies this interface.
type driveRepository interface {
	GetStale(ctx context.Context, cutoff time.Time) ([]*drivemodel.Drive, error)
	GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error)
	PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error
	Delete(ctx context.Context, id int64) error
}

// Compile-time assertions that the production repos satisfy the narrow ports.
var (
	_ chargingRepository = (*chargingdb.ChargingRepo)(nil)
	_ driveRepository    = (*drivedb.DriveRepo)(nil)
)

// clockFunc supplies the current time. Injected so tests can pin the
// stale-session cutoff and the drive-close duration; production wiring leaves
// it nil and falls through to time.Now().UTC() via (*DataRepairHandler).now.
type clockFunc func() time.Time

// DataRepairHandler handles endpoints for repairing incomplete/stale sessions.
type DataRepairHandler struct {
	chargingRepo chargingRepository
	driveRepo    driveRepository
	clock        clockFunc
}

func NewDataRepairHandler(db *database.DB) *DataRepairHandler {
	return &DataRepairHandler{
		chargingRepo: chargingdb.NewChargingRepo(db),
		driveRepo:    drivedb.NewDriveRepo(db),
	}
}

// now returns the injected clock value, or wall-clock UTC when no clock is
// configured, so every time-derived computation in the handler reads from a
// single source.
func (h *DataRepairHandler) now() time.Time {
	if h.clock != nil {
		return h.clock()
	}
	return time.Now().UTC()
}

// StaleSessionsResponse contains charging sessions and drives that are still open.
type StaleSessionsResponse struct {
	StaleCharging []*chargingmodel.ChargingSession `json:"stale_charging"`
	StaleDrives   []*drivemodel.Drive              `json:"stale_drives"`
}

// GetStaleSessions returns sessions with no end_ts that started more than 24 hours ago.
func (h *DataRepairHandler) GetStaleSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cutoff := h.now().Add(-24 * time.Hour)

	charging, err := h.chargingRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Error().Err(err).Msg("failed to get stale charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get stale charging sessions")
		return
	}

	drives, err := h.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		log.Error().Err(err).Msg("failed to get stale drives")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get stale drives")
		return
	}

	if charging == nil {
		charging = make([]*chargingmodel.ChargingSession, 0)
	}
	if drives == nil {
		drives = make([]*drivemodel.Drive, 0)
	}

	httpx.WriteJSON(w, http.StatusOK, StaleSessionsResponse{
		StaleCharging: charging,
		StaleDrives:   drives,
	})
}

// UpdateCharging partially updates a charging session with user-provided values.
func (h *DataRepairHandler) UpdateCharging(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if err := h.chargingRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update charging session")
		return
	}

	updated, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get updated charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get updated session")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// UpdateDrive partially updates a drive with user-provided values.
func (h *DataRepairHandler) UpdateDrive(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	var patch map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if err := h.driveRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update drive")
		return
	}

	updated, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get updated drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get updated drive")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// CloseCharging sets ended_at=NOW() on an open charging session. The
// charging_sessions table stores no duration column (duration is derived at
// read time), so only ended_at is written here.
func (h *DataRepairHandler) CloseCharging(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	now := h.now()
	patch := map[string]interface{}{
		"ended_at": now.Format(time.RFC3339),
	}
	if err := h.chargingRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to close charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to close charging session")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

// CloseDrive sets ended_at=NOW() and stores the whole-second duration computed
// from the drive's start_ts.
func (h *DataRepairHandler) CloseDrive(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	drive, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	now := h.now()
	durationS := int64(now.Sub(drive.StartTs).Seconds() + 0.5)

	patch := map[string]interface{}{
		"ended_at":   now.Format(time.RFC3339),
		"duration_s": durationS,
	}
	if err := h.driveRepo.PartialUpdate(ctx, id, patch); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to close drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to close drive")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

// DeleteCharging removes a stale charging session.
func (h *DataRepairHandler) DeleteCharging(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	if err := h.chargingRepo.Delete(ctx, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete charging session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteDrive removes a stale drive.
func (h *DataRepairHandler) DeleteDrive(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	if err := h.driveRepo.Delete(ctx, id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete drive")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
