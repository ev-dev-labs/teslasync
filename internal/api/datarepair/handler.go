package datarepair

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
)

// chargingRepository is the narrow charging-session data-access surface the
// handler depends on. Declared as an interface at the call site so handler
// tests can inject an in-memory fake without a real database (the codebase has
// no pgxmock harness). *chargingdb.ChargingRepo satisfies this interface.
type chargingRepository interface {
	GetStale(ctx context.Context, cutoff time.Time) ([]*chargingmodel.ChargingSession, error)
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
	PartialUpdateForRepairWithTx(ctx context.Context, tx database.DBTX, id int64, fields map[string]interface{}) (bool, error)
	UpdateRepairBoundaryIfUnchangedWithTx(ctx context.Context, tx database.DBTX, id int64, expectedEndedAt *time.Time, endedAt time.Time) (bool, error)
	DeleteWithTx(ctx context.Context, tx database.DBTX, id int64) (bool, error)
}

// driveRepository is the narrow drive data-access surface the handler depends
// on. *drivedb.DriveRepo satisfies this interface.
type driveRepository interface {
	GetStale(ctx context.Context, cutoff time.Time) ([]*drivemodel.Drive, error)
	GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error)
	PartialUpdateForRepairWithTx(ctx context.Context, tx database.DBTX, id int64, fields map[string]interface{}) (bool, error)
	UpdateRepairBoundaryIfUnchangedWithTx(ctx context.Context, tx database.DBTX, id int64, expectedEndedAt *time.Time, endedAt time.Time, durationS int64) (bool, error)
	DeleteWithTx(ctx context.Context, tx database.DBTX, id int64) (bool, error)
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
type transactionFunc func(context.Context, func(database.DBTX) error) error

var errRepairTargetChanged = errors.New("data-repair target changed during mutation")

// DataRepairHandler handles endpoints for repairing incomplete/stale sessions.
//
// The handler exposes two clearly separated surfaces:
//
//   - READ-ONLY DIAGNOSIS — GetStaleSessions (inventory) and GetSuggestions
//     (evidence-based boundary analysis). Neither writes anything, ever.
//   - EXPLICIT MUTATION — Update*/Close*/Delete*, each gated behind RequireSudo
//     in the router and each audited. A repair is NEVER auto-applied: the
//     operator has to call one of these with an id they reviewed.
type DataRepairHandler struct {
	chargingRepo chargingRepository
	driveRepo    driveRepository
	clock        clockFunc

	// diagnosis is the read-only evidence source behind GetSuggestions and the
	// re-validation the apply path performs. Nil when the composition root has
	// no database, in which case GetSuggestions reports the feature as
	// unavailable rather than pretending the worklist is empty.
	diagnosis diagnosisSource

	// db backs the audit-log writer. Nil-safe.
	db *database.DB
	// forwardAuthHeader names the reverse-proxy header carrying the operator
	// identity written into audit_logs.actor.
	forwardAuthHeader string
	// audit overrides the audit sink; production leaves it nil and falls
	// through to the audit_logs INSERT.
	audit auditFunc
	// transaction overrides transaction execution in tests. Production uses
	// database.DB.WithTx through withTransaction.
	transaction transactionFunc
}

// Option configures a DataRepairHandler at construction.
type Option func(*DataRepairHandler)

// WithDiagnosisSource installs the read-only evidence source used by
// GetSuggestions and by the apply-time re-validation.
func WithDiagnosisSource(src diagnosisSource) Option {
	return func(h *DataRepairHandler) { h.diagnosis = src }
}

// WithForwardAuthHeader names the header that carries the operator identity.
func WithForwardAuthHeader(header string) Option {
	return func(h *DataRepairHandler) { h.forwardAuthHeader = header }
}

// WithAuditFunc replaces the audit sink. Test-only seam.
func WithAuditFunc(fn auditFunc) Option {
	return func(h *DataRepairHandler) { h.audit = fn }
}

func NewDataRepairHandler(db *database.DB, opts ...Option) *DataRepairHandler {
	h := &DataRepairHandler{
		chargingRepo: chargingdb.NewChargingRepo(db),
		driveRepo:    drivedb.NewDriveRepo(db),
		db:           db,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	return h
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

func (h *DataRepairHandler) withTransaction(
	ctx context.Context,
	fn func(database.DBTX) error,
) error {
	if h.transaction != nil {
		return h.transaction(ctx, fn)
	}
	if h.db == nil {
		// In-memory handler tests use repository and audit fakes that do not
		// access the transaction handle.
		return fn(nil)
	}
	return h.db.WithTx(ctx, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

func repairPatchDetail(fields map[string]interface{}) string {
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return "fields=" + strings.Join(keys, ",")
}

func deleteAuditDetail(startedAt time.Time, endedAt *time.Time) string {
	ended := "open"
	if endedAt != nil {
		ended = endedAt.UTC().Format(time.RFC3339)
	}
	return "started_at=" + startedAt.UTC().Format(time.RFC3339) + " ended_at=" + ended
}

func validateRepairPatch(fields map[string]interface{}, allowed map[string]string) error {
	if len(fields) == 0 {
		return errors.New("at least one repair field is required")
	}
	for field := range fields {
		if field == "ended_at" {
			return errors.New("ended_at must be changed through the close action")
		}
		if _, ok := allowed[field]; !ok {
			return errors.New("unsupported repair field: " + field)
		}
	}
	return nil
}

// applyManualCostProvenance prevents the public repair endpoint from forging
// system-owned pricing provenance. A user-supplied cost becomes a manual
// actual and no longer points at the tariff it may have replaced. Clearing a
// cost clears its provenance so a later explicit tariff apply can price it.
func applyManualCostProvenance(existing *chargingmodel.ChargingSession, patch map[string]interface{}) {
	delete(patch, "cost_source")
	delete(patch, "rate_id")
	delete(patch, "geofence_id")

	if cost, supplied := patch["cost_decimal"]; supplied {
		patch["rate_id"] = nil
		if cost == nil {
			patch["cost_currency"] = nil
			patch["cost_source"] = nil
			return
		}
		patch["cost_source"] = systemmodel.CostSourceManual
		return
	}
	if _, supplied := patch["cost_currency"]; supplied &&
		existing != nil && existing.CostDecimal != nil {
		patch["rate_id"] = nil
		patch["cost_source"] = systemmodel.CostSourceManual
	}
}

// StaleSessionsResponse contains charging sessions and drives that are still open.
type StaleSessionsResponse struct {
	StaleCharging []*chargingmodel.ChargingSession `json:"stale_charging"`
	StaleDrives   []*drivemodel.Drive              `json:"stale_drives"`
}

// GetStaleSessions returns sessions with no end_ts that started more than 24 hours ago.
func (h *DataRepairHandler) GetStaleSessions(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "stale_sessions")
	defer span.End()

	ctx := r.Context()
	cutoff := h.now().Add(-24 * time.Hour)

	charging, err := h.chargingRepo.GetStale(ctx, cutoff)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Msg("failed to get stale charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get stale charging sessions")
		return
	}

	drives, err := h.driveRepo.GetStale(ctx, cutoff)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Msg("failed to get stale drives")
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
	r, span := startHandlerSpan(r, "update_charging")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get charging session")
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
	if err := validateRepairPatch(patch, chargingdb.ChargingPartialAllowed); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	applyManualCostProvenance(existing, patch)
	if len(patch) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "at least one mutable repair field is required")
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		applied, updateErr := h.chargingRepo.PartialUpdateForRepairWithTx(ctx, tx, id, patch)
		if updateErr != nil {
			return updateErr
		}
		if !applied {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionUpdateCharging, auditEntityChargingSession, id,
			repairPatchDetail(patch),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict, "charging session changed while the repair was being applied")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to update charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update charging session")
		return
	}

	updated, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get updated charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get updated session")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// UpdateDrive partially updates a drive with user-provided values.
func (h *DataRepairHandler) UpdateDrive(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "update_drive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get drive")
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
	if err := validateRepairPatch(patch, drivedb.DrivePartialAllowed); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		applied, updateErr := h.driveRepo.PartialUpdateForRepairWithTx(ctx, tx, id, patch)
		if updateErr != nil {
			return updateErr
		}
		if !applied {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionUpdateDrive, auditEntityDrive, id,
			repairPatchDetail(patch),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict, "drive changed while the repair was being applied")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to update drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update drive")
		return
	}

	updated, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get updated drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get updated drive")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// CloseCharging applies an explicit end boundary to a charging session.
//
// The body must contain an explicit RFC3339 boundary, a repair rule, and an
// optimistic-concurrency pin. Reviewed suggestions are revalidated against
// durable evidence; a manual override is accepted only with rule="manual".
//
// The charging_sessions table stores no duration column (duration is derived
// at read time), so only ended_at is written here.
func (h *DataRepairHandler) CloseCharging(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "close_charging")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	req, err := decodeCloseRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	endedAt, status, rule, done := h.resolveCloseBoundary(
		w, r, req,
		systemmodel.SessionRepairKindCharging,
		id, session.VehicleID,
		session.StartedAt, session.EndedAt,
		"charging session",
	)
	if done {
		return
	}
	if status == closeStatusAlreadyApplied {
		httpx.WriteJSON(w, http.StatusOK, closeResponse{
			Status:    string(closeStatusAlreadyApplied),
			EndedAt:   endedAt.Format(time.RFC3339),
			SessionID: id,
		})
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		applied, updateErr := h.chargingRepo.UpdateRepairBoundaryIfUnchangedWithTx(
			ctx, tx, id, session.EndedAt, endedAt,
		)
		if updateErr != nil {
			return updateErr
		}
		if !applied {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionCloseCharging, auditEntityChargingSession, id,
			closeAuditDetail(rule, auditSource(rule), session.StartedAt, session.EndedAt, endedAt, nil),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict,
			"this charging session changed while the repair was being applied; reload and review it again")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to close charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to close charging session")
		return
	}

	log.Info().
		Int64("charging_session_id", id).
		Int64("vehicle_id", session.VehicleID).
		Time("ended_at", endedAt).
		Str("rule", rule).
		Msg("data-repair: charging session boundary applied")

	httpx.WriteJSON(w, http.StatusOK, closeResponse{
		Status:    string(closeStatusClosed),
		EndedAt:   endedAt.Format(time.RFC3339),
		SessionID: id,
	})
}

// CloseDrive applies an explicit end boundary to a drive and recomputes the
// SI-canonical duration_s aggregate from it.
//
// Measured aggregates (distance_m, energy_used_wh, max_speed_mps, …) are
// deliberately NOT recomputed: they were accumulated over the original,
// possibly-overrun window and there is no durable source that can be replayed
// here without inventing data. The response and the UI say so explicitly.
func (h *DataRepairHandler) CloseDrive(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "close_drive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	req, err := decodeCloseRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	drive, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	endedAt, status, rule, done := h.resolveCloseBoundary(
		w, r, req,
		systemmodel.SessionRepairKindDrive,
		id, drive.VehicleID,
		drive.StartTs, drive.EndTs,
		"drive",
	)
	if done {
		return
	}

	durationS := int64(endedAt.Sub(drive.StartTs).Seconds() + 0.5)
	if status == closeStatusAlreadyApplied {
		httpx.WriteJSON(w, http.StatusOK, closeResponse{
			Status:     string(closeStatusAlreadyApplied),
			EndedAt:    endedAt.Format(time.RFC3339),
			DurationS:  &durationS,
			SessionID:  id,
			Recomputed: driveRecomputedFields,
		})
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		applied, updateErr := h.driveRepo.UpdateRepairBoundaryIfUnchangedWithTx(
			ctx, tx, id, drive.EndTs, endedAt, durationS,
		)
		if updateErr != nil {
			return updateErr
		}
		if !applied {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionCloseDrive, auditEntityDrive, id,
			closeAuditDetail(rule, auditSource(rule), drive.StartTs, drive.EndTs, endedAt, &durationS),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict,
			"this drive changed while the repair was being applied; reload and review it again")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to close drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to close drive")
		return
	}

	log.Info().
		Int64("drive_id", id).
		Int64("vehicle_id", drive.VehicleID).
		Time("ended_at", endedAt).
		Int64("duration_s", durationS).
		Str("rule", rule).
		Msg("data-repair: drive boundary applied")

	httpx.WriteJSON(w, http.StatusOK, closeResponse{
		Status:     string(closeStatusClosed),
		EndedAt:    endedAt.Format(time.RFC3339),
		DurationS:  &durationS,
		SessionID:  id,
		Recomputed: driveRecomputedFields,
	})
}

// DeleteCharging removes a stale charging session.
func (h *DataRepairHandler) DeleteCharging(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "delete_charging")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	ctx := r.Context()
	existing, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		deleted, deleteErr := h.chargingRepo.DeleteWithTx(ctx, tx, id)
		if deleteErr != nil {
			return deleteErr
		}
		if !deleted {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionDeleteCharging, auditEntityChargingSession, id,
			deleteAuditDetail(existing.StartedAt, existing.EndedAt),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict, "charging session changed while it was being discarded")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to delete charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete charging session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteDrive removes a stale drive.
func (h *DataRepairHandler) DeleteDrive(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "delete_drive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	ctx := r.Context()
	existing, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if existing == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		deleted, deleteErr := h.driveRepo.DeleteWithTx(ctx, tx, id)
		if deleteErr != nil {
			return deleteErr
		}
		if !deleted {
			return errRepairTargetChanged
		}
		return h.writeAudit(
			r, tx, AuditActionDeleteDrive, auditEntityDrive, id,
			deleteAuditDetail(existing.StartTs, existing.EndTs),
		)
	})
	if errors.Is(err, errRepairTargetChanged) {
		httpx.WriteError(w, http.StatusConflict, "drive changed while it was being discarded")
		return
	}
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to delete drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete drive")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
