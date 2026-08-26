package datarepair

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

const (
	defaultQuarantineListLimit = 50
	maxQuarantineListLimit     = 200
	maxQuarantineReasonChars   = 1000

	operatorQuarantineRule          = "operator_manual_quarantine"
	operatorQuarantineEvidenceSrc   = "operator_manual"
	operatorQuarantineEvidenceField = "quarantine_request"
	operatorQuarantineEvidenceValue = "operator_requested"
	operatorQuarantineBlockedReason = "operator_manual_action"
)

var (
	errQuarantineSourceNotFound = errors.New("data-repair quarantine source not found")
	errQuarantineNotFound       = errors.New("data-repair quarantine record not found")
	errQuarantineCaseNotFound   = errors.New("data-repair quarantine case not found")
	errQuarantineConflict       = errors.New("data-repair quarantine conflict")
)

type quarantineReasonRequest struct {
	Reason *string `json:"reason"`
}

type quarantineCursor struct {
	QuarantinedAt time.Time `json:"quarantined_at"`
	ID            int64     `json:"id"`
}

type quarantineListResponse struct {
	Quarantines []systemmodel.RepairQuarantine `json:"quarantines"`
	HasMore     bool                           `json:"has_more"`
	NextCursor  *quarantineCursor              `json:"next_cursor,omitempty"`
}

type quarantineSnapshotIdentity struct {
	ID        int64      `json:"id"`
	VehicleID int64      `json:"vehicle_id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at"`
}

type quarantineSnapshotEnvelope struct {
	SchemaVersion   int                         `json:"schema_version"`
	Drive           *quarantineSnapshotIdentity `json:"drive"`
	ChargingSession *quarantineSnapshotIdentity `json:"charging_session"`
}

func parseQuarantineReason(req quarantineReasonRequest) (string, error) {
	if req.Reason == nil {
		return "", errors.New("reason is required")
	}
	reason := strings.TrimSpace(*req.Reason)
	if reason == "" {
		return "", errors.New("reason must not be blank")
	}
	if utf8.RuneCountInString(reason) > maxQuarantineReasonChars ||
		strings.ContainsRune(reason, '\x00') {
		return "", fmt.Errorf("reason must be at most %d valid characters", maxQuarantineReasonChars)
	}
	return reason, nil
}

func decodeQuarantineReason(w http.ResponseWriter, r *http.Request) (string, error) {
	var req quarantineReasonRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		return "", err
	}
	return parseQuarantineReason(req)
}

func parseQuarantineID(r *http.Request) (int64, error) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		return 0, errors.New("quarantine id must be a positive integer")
	}
	return id, nil
}

func parseQuarantineListFilter(
	r *http.Request,
) (systemmodel.RepairQuarantineListFilter, int, error) {
	var filter systemmodel.RepairQuarantineListFilter
	query := r.URL.Query()

	if query.Has("vehicle_id") {
		vehicleID, err := parsePositiveInt64(query.Get("vehicle_id"), "vehicle_id")
		if err != nil {
			return filter, 0, err
		}
		filter.VehicleID = &vehicleID
	}
	if query.Has("kind") {
		kind := systemmodel.RepairCaseKind(query.Get("kind"))
		if !kind.IsValid() {
			return filter, 0, errors.New("kind is invalid")
		}
		filter.Kind = &kind
	}
	if query.Has("restored") {
		switch query.Get("restored") {
		case "true":
			restored := true
			filter.Restored = &restored
		case "false":
			restored := false
			filter.Restored = &restored
		default:
			return filter, 0, errors.New("restored must be true or false")
		}
	}

	hasCursorTime := query.Has("cursor_quarantined_at")
	hasCursorID := query.Has("cursor_id")
	if hasCursorTime != hasCursorID {
		return filter, 0, errors.New(
			"cursor_quarantined_at and cursor_id must be provided together",
		)
	}
	if hasCursorTime {
		cursorTime, err := time.Parse(time.RFC3339, query.Get("cursor_quarantined_at"))
		if err != nil {
			return filter, 0, errors.New(
				"cursor_quarantined_at must be an RFC3339 timestamp",
			)
		}
		cursorID, err := parsePositiveInt64(query.Get("cursor_id"), "cursor_id")
		if err != nil {
			return filter, 0, err
		}
		cursorTime = cursorTime.UTC()
		filter.CursorQuarantinedAt = &cursorTime
		filter.CursorID = &cursorID
	}

	limit := defaultQuarantineListLimit
	if query.Has("limit") {
		parsed, err := strconv.Atoi(query.Get("limit"))
		if err != nil || parsed <= 0 {
			return filter, 0, errors.New("limit must be a positive integer")
		}
		if parsed > maxQuarantineListLimit {
			parsed = maxQuarantineListLimit
		}
		limit = parsed
	}
	filter.Limit = limit + 1
	if filter.Limit > maxQuarantineListLimit {
		filter.Limit = maxQuarantineListLimit
	}
	return filter, limit, nil
}

func quarantineResponseCursor(
	records []systemmodel.RepairQuarantine,
	hasMore bool,
) *quarantineCursor {
	if !hasMore || len(records) == 0 {
		return nil
	}
	last := records[len(records)-1]
	return &quarantineCursor{QuarantinedAt: last.QuarantinedAt, ID: last.ID}
}

// ListQuarantines returns payload-free quarantine metadata with bounded keyset
// pagination. The opaque recovery snapshot is never selected by the
// repository and is also JSON-hidden on the domain model.
func (h *DataRepairHandler) ListQuarantines(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "list_quarantines")
	defer span.End()

	if !h.caseRepositoryReady(w, r) {
		return
	}
	filter, requestedLimit, err := parseQuarantineListFilter(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	records, err := h.caseRepo.ListQuarantines(r.Context(), filter)
	if err != nil {
		writeQuarantineOperationError(
			w,
			r,
			"list",
			0,
			fmt.Errorf("list repair quarantines: %w", err),
		)
		return
	}
	hasMore := len(records) > requestedLimit
	if hasMore {
		records = records[:requestedLimit]
	} else if requestedLimit == maxQuarantineListLimit && len(records) == requestedLimit {
		last := records[len(records)-1]
		probe := filter
		probe.CursorQuarantinedAt = &last.QuarantinedAt
		probe.CursorID = &last.ID
		probe.Limit = 1
		next, probeErr := h.caseRepo.ListQuarantines(r.Context(), probe)
		if probeErr != nil {
			writeQuarantineOperationError(
				w,
				r,
				"list_cursor_probe",
				0,
				fmt.Errorf("probe next repair-quarantine page: %w", probeErr),
			)
			return
		}
		hasMore = len(next) > 0
	}
	if records == nil {
		records = make([]systemmodel.RepairQuarantine, 0)
	}

	httpx.WriteJSON(w, http.StatusOK, quarantineListResponse{
		Quarantines: records,
		HasMore:     hasMore,
		NextCursor:  quarantineResponseCursor(records, hasMore),
	})
}

func canonicalSnapshotIdentity(
	kind systemmodel.RepairCaseKind,
	payload json.RawMessage,
) (json.RawMessage, quarantineSnapshotIdentity, string, error) {
	canonical, err := repairsnapshot.Canonicalize(payload)
	if err != nil {
		return nil, quarantineSnapshotIdentity{}, "", err
	}
	var envelope quarantineSnapshotEnvelope
	if err := json.Unmarshal(canonical, &envelope); err != nil {
		return nil, quarantineSnapshotIdentity{}, "", fmt.Errorf(
			"%w: decode snapshot identity: %v",
			repairsnapshot.ErrMalformedPayload,
			err,
		)
	}
	if envelope.SchemaVersion != 1 {
		return nil, quarantineSnapshotIdentity{}, "", fmt.Errorf(
			"%w: unsupported schema_version",
			repairsnapshot.ErrMalformedPayload,
		)
	}

	var identity *quarantineSnapshotIdentity
	switch kind {
	case systemmodel.RepairCaseKindDrive:
		identity = envelope.Drive
	case systemmodel.RepairCaseKindCharging:
		identity = envelope.ChargingSession
	default:
		return nil, quarantineSnapshotIdentity{}, "", fmt.Errorf(
			"%w: unsupported kind %q",
			repairsnapshot.ErrMalformedPayload,
			kind,
		)
	}
	if identity == nil || identity.ID <= 0 || identity.VehicleID <= 0 ||
		identity.StartedAt.IsZero() {
		return nil, quarantineSnapshotIdentity{}, "", fmt.Errorf(
			"%w: invalid snapshot identity",
			repairsnapshot.ErrMalformedPayload,
		)
	}
	checksum, err := repairsnapshot.Checksum(canonical)
	if err != nil {
		return nil, quarantineSnapshotIdentity{}, "", err
	}
	return canonical, *identity, checksum, nil
}

func quarantineAllowed(status systemmodel.RepairCaseStatus) bool {
	return status == systemmodel.RepairCaseStatusOpen ||
		status == systemmodel.RepairCaseStatusInReview
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func (h *DataRepairHandler) ensureOperatorQuarantineCase(
	ctx context.Context,
	tx database.DBTX,
	kind systemmodel.RepairCaseKind,
	identity quarantineSnapshotIdentity,
) (*systemmodel.RepairCase, error) {
	blockedReason := operatorQuarantineBlockedReason
	now := h.now().UTC()
	candidate := &systemmodel.RepairCase{
		Fingerprint:                systemmodel.RepairCaseFingerprint(kind, identity.ID, operatorQuarantineRule),
		Kind:                       kind,
		SessionID:                  identity.ID,
		VehicleID:                  identity.VehicleID,
		Rule:                       operatorQuarantineRule,
		Confidence:                 systemmodel.RepairCaseConfidenceMedium,
		Status:                     systemmodel.RepairCaseStatusOpen,
		EvidenceStartedAt:          identity.StartedAt.UTC(),
		EvidenceStoredEndedAt:      identity.EndedAt,
		EvidenceContradictionTs:    maxTime(now, identity.StartedAt.UTC()),
		EvidenceContradictionSrc:   operatorQuarantineEvidenceSrc,
		EvidenceContradictionField: operatorQuarantineEvidenceField,
		EvidenceContradictionValue: operatorQuarantineEvidenceValue,
		Applicable:                 false,
		BlockedReason:              &blockedReason,
	}
	caseID, err := h.caseRepo.UpsertCase(ctx, tx, candidate)
	if err != nil {
		return nil, fmt.Errorf("ensure operator quarantine case: %w", err)
	}
	repairCase, err := h.caseRepo.GetCaseForUpdate(ctx, tx, caseID)
	if err != nil {
		return nil, fmt.Errorf("lock operator quarantine case %d: %w", caseID, err)
	}
	if repairCase == nil {
		return nil, fmt.Errorf("%w: operator case %d", errQuarantineCaseNotFound, caseID)
	}
	if repairCase.Status == systemmodel.RepairCaseStatusDismissed {
		if err := h.caseRepo.TransitionStatus(
			ctx,
			tx,
			repairCase.ID,
			systemmodel.RepairCaseStatusOpen,
			nil,
			repairCase.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("reopen operator quarantine case %d: %w", repairCase.ID, err)
		}
		repairCase, err = h.caseRepo.GetCaseForUpdate(ctx, tx, caseID)
		if err != nil {
			return nil, fmt.Errorf("reload operator quarantine case %d: %w", caseID, err)
		}
		if repairCase == nil {
			return nil, fmt.Errorf("%w: reopened operator case %d", errQuarantineCaseNotFound, caseID)
		}
	}
	return repairCase, nil
}

func validateQuarantineCase(
	repairCase *systemmodel.RepairCase,
	kind systemmodel.RepairCaseKind,
	identity quarantineSnapshotIdentity,
) error {
	if repairCase == nil {
		return errQuarantineCaseNotFound
	}
	if !quarantineAllowed(repairCase.Status) {
		return fmt.Errorf(
			"%w: case status %s cannot be quarantined",
			errQuarantineConflict,
			repairCase.Status,
		)
	}
	if repairCase.Kind != kind ||
		repairCase.SessionID != identity.ID ||
		repairCase.VehicleID != identity.VehicleID {
		return fmt.Errorf(
			"%w: case does not match the source session",
			errQuarantineConflict,
		)
	}
	return nil
}

func quarantineSourceAuditIdentity(
	kind systemmodel.RepairCaseKind,
) (string, string, error) {
	switch kind {
	case systemmodel.RepairCaseKindDrive:
		return AuditActionQuarantineDrive, auditEntityDrive, nil
	case systemmodel.RepairCaseKindCharging:
		return AuditActionQuarantineCharging, auditEntityChargingSession, nil
	default:
		return "", "", fmt.Errorf("%w: unsupported case kind %q", errQuarantineConflict, kind)
	}
}

func restoreSourceAuditIdentity(
	kind systemmodel.RepairCaseKind,
) (string, string, error) {
	switch kind {
	case systemmodel.RepairCaseKindDrive:
		return AuditActionRestoreDrive, auditEntityDrive, nil
	case systemmodel.RepairCaseKindCharging:
		return AuditActionRestoreCharging, auditEntityChargingSession, nil
	default:
		return "", "", fmt.Errorf("%w: unsupported quarantine kind %q", errQuarantineConflict, kind)
	}
}

func (h *DataRepairHandler) snapshotSource(
	ctx context.Context,
	tx database.DBTX,
	kind systemmodel.RepairCaseKind,
	sessionID int64,
) (json.RawMessage, error) {
	switch kind {
	case systemmodel.RepairCaseKindDrive:
		return h.driveRepo.SnapshotForQuarantineWithTx(ctx, tx, sessionID)
	case systemmodel.RepairCaseKindCharging:
		return h.chargingRepo.SnapshotForQuarantineWithTx(ctx, tx, sessionID)
	default:
		return nil, fmt.Errorf("%w: unsupported case kind %q", errQuarantineConflict, kind)
	}
}

func (h *DataRepairHandler) deleteQuarantinedSource(
	ctx context.Context,
	tx database.DBTX,
	kind systemmodel.RepairCaseKind,
	sessionID int64,
) error {
	var (
		deleted bool
		err     error
	)
	switch kind {
	case systemmodel.RepairCaseKindDrive:
		deleted, err = h.driveRepo.DeleteWithTx(ctx, tx, sessionID)
	case systemmodel.RepairCaseKindCharging:
		deleted, err = h.chargingRepo.DeleteWithTx(ctx, tx, sessionID)
	default:
		return fmt.Errorf("%w: unsupported case kind %q", errQuarantineConflict, kind)
	}
	if err != nil {
		return fmt.Errorf("delete quarantined %s/%d: %w", kind, sessionID, err)
	}
	if !deleted {
		return fmt.Errorf("%w: source %s/%d changed before delete", errQuarantineConflict, kind, sessionID)
	}
	return nil
}

func (h *DataRepairHandler) restoreQuarantinedSource(
	ctx context.Context,
	tx database.DBTX,
	record *systemmodel.RepairQuarantine,
) error {
	switch record.Kind {
	case systemmodel.RepairCaseKindDrive:
		return h.driveRepo.RestoreSnapshotWithTx(
			ctx,
			tx,
			record.OriginalRow,
			record.Checksum,
		)
	case systemmodel.RepairCaseKindCharging:
		return h.chargingRepo.RestoreSnapshotWithTx(
			ctx,
			tx,
			record.OriginalRow,
			record.Checksum,
		)
	default:
		return fmt.Errorf("%w: unsupported quarantine kind %q", errQuarantineConflict, record.Kind)
	}
}

func quarantineAuditDetail(
	caseID, quarantineID int64,
	kind systemmodel.RepairCaseKind,
	reason string,
	legacy bool,
) string {
	return fmt.Sprintf(
		"case_id=%d quarantine_id=%d kind=%s reason_length=%d legacy_route=%t",
		caseID,
		quarantineID,
		kind,
		utf8.RuneCountInString(reason),
		legacy,
	)
}

func restoreAuditDetail(
	caseID, quarantineID int64,
	kind systemmodel.RepairCaseKind,
	reason string,
) string {
	return fmt.Sprintf(
		"case_id=%d quarantine_id=%d kind=%s reason_length=%d",
		caseID,
		quarantineID,
		kind,
		utf8.RuneCountInString(reason),
	)
}

// quarantineSession is the single orchestration path used by both the
// case-based endpoint and the legacy DELETE routes. Every persistence call is
// passed the same transaction handle.
func (h *DataRepairHandler) quarantineSession(
	r *http.Request,
	kind systemmodel.RepairCaseKind,
	sessionID int64,
	requestedCaseID *int64,
	reason string,
) (*systemmodel.RepairQuarantine, error) {
	ctx := r.Context()
	actor := requestActor(r, h.forwardAuthHeader)
	var result *systemmodel.RepairQuarantine

	err := h.withTransaction(ctx, func(tx database.DBTX) error {
		payload, err := h.snapshotSource(ctx, tx, kind, sessionID)
		if errors.Is(err, repairsnapshot.ErrNotFound) {
			return fmt.Errorf("%w: %s/%d", errQuarantineSourceNotFound, kind, sessionID)
		}
		if err != nil {
			return fmt.Errorf("snapshot %s/%d for quarantine: %w", kind, sessionID, err)
		}
		canonical, identity, checksum, err := canonicalSnapshotIdentity(kind, payload)
		if err != nil {
			return fmt.Errorf("validate %s/%d quarantine snapshot: %w", kind, sessionID, err)
		}
		if identity.ID != sessionID {
			return fmt.Errorf(
				"%w: snapshot identity %d does not match requested session %d",
				errQuarantineConflict,
				identity.ID,
				sessionID,
			)
		}

		var repairCase *systemmodel.RepairCase
		legacy := requestedCaseID == nil
		if legacy {
			repairCase, err = h.ensureOperatorQuarantineCase(ctx, tx, kind, identity)
			if err != nil {
				return err
			}
		} else {
			repairCase, err = h.caseRepo.GetCaseForUpdate(ctx, tx, *requestedCaseID)
			if err != nil {
				return fmt.Errorf("lock repair case %d for quarantine: %w", *requestedCaseID, err)
			}
			if repairCase == nil {
				return fmt.Errorf("%w: case %d", errQuarantineCaseNotFound, *requestedCaseID)
			}
		}
		if err := validateQuarantineCase(repairCase, kind, identity); err != nil {
			return err
		}

		record := &systemmodel.RepairQuarantine{
			CaseID:        repairCase.ID,
			Kind:          kind,
			SessionID:     sessionID,
			VehicleID:     identity.VehicleID,
			OriginalRow:   canonical,
			SchemaVersion: 1,
			Checksum:      checksum,
			Reason:        reason,
			QuarantinedBy: actor,
		}
		if _, err := h.caseRepo.CreateQuarantine(ctx, tx, record); err != nil {
			return fmt.Errorf("create quarantine record: %w", err)
		}
		if err := h.deleteQuarantinedSource(ctx, tx, kind, sessionID); err != nil {
			return err
		}
		if err := h.caseRepo.TransitionStatus(
			ctx,
			tx,
			repairCase.ID,
			systemmodel.RepairCaseStatusQuarantined,
			nil,
			repairCase.UpdatedAt,
		); err != nil {
			return fmt.Errorf("transition case %d to quarantined: %w", repairCase.ID, err)
		}

		sourceAction, sourceEntity, err := quarantineSourceAuditIdentity(kind)
		if err != nil {
			return err
		}
		detail := quarantineAuditDetail(repairCase.ID, record.ID, kind, reason, legacy)
		if err := h.writeAudit(r, tx, sourceAction, sourceEntity, sessionID, detail); err != nil {
			return fmt.Errorf("audit quarantined source %s/%d: %w", kind, sessionID, err)
		}
		if err := h.writeAudit(
			r,
			tx,
			AuditActionCaseQuarantine,
			auditEntityDataRepairCase,
			repairCase.ID,
			detail,
		); err != nil {
			return fmt.Errorf("audit quarantined case %d: %w", repairCase.ID, err)
		}
		result = record
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func writeQuarantineOperationError(
	w http.ResponseWriter,
	r *http.Request,
	operation string,
	id int64,
	err error,
) {
	ctx := r.Context()
	recordHandlerError(ctx, err)
	event := log.Error().
		Err(err).
		Str("trace_id", activeTraceID(ctx)).
		Str("operation", operation)
	if id > 0 {
		event = event.Int64("id", id)
	}
	event.Msg("data-repair quarantine operation failed")

	switch {
	case caseRepositoryUnavailable(err):
		httpx.WriteError(w, http.StatusServiceUnavailable, "data-repair quarantine is unavailable")
	case errors.Is(err, errQuarantineSourceNotFound):
		httpx.WriteError(w, http.StatusNotFound, "source session not found")
	case errors.Is(err, errQuarantineCaseNotFound):
		httpx.WriteError(w, http.StatusNotFound, "repair case not found")
	case errors.Is(err, errQuarantineNotFound):
		httpx.WriteError(w, http.StatusNotFound, "quarantine record not found")
	case errors.Is(err, errQuarantineConflict),
		errors.Is(err, datarepairdb.ErrConcurrentModification),
		errors.Is(err, datarepairdb.ErrActiveQuarantineExists),
		errors.Is(err, datarepairdb.ErrQuarantineNotActive),
		errors.Is(err, repairsnapshot.ErrChecksumMismatch),
		errors.Is(err, repairsnapshot.ErrMalformedPayload),
		errors.Is(err, repairsnapshot.ErrAlreadyExists),
		errors.Is(err, repairsnapshot.ErrConflict):
		httpx.WriteError(w, http.StatusConflict, "data-repair operation conflicts with current state")
	default:
		httpx.WriteError(w, http.StatusInternalServerError, "data-repair quarantine operation failed")
	}
}

// QuarantineCase moves the case's source row into reversible quarantine.
func (h *DataRepairHandler) QuarantineCase(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "quarantine_case")
	defer span.End()

	caseID, err := parseCaseID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}
	reason, err := decodeQuarantineReason(w, r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	current, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeQuarantineOperationError(
			w,
			r,
			"quarantine_case_load",
			caseID,
			fmt.Errorf("load repair case %d: %w", caseID, err),
		)
		return
	}
	if current == nil {
		writeCaseNotFound(w, r)
		return
	}
	if !quarantineAllowed(current.Status) {
		err := fmt.Errorf(
			"%w: case status %s cannot be quarantined",
			errQuarantineConflict,
			current.Status,
		)
		writeQuarantineOperationError(w, r, "quarantine_case", caseID, err)
		return
	}

	record, err := h.quarantineSession(r, current.Kind, current.SessionID, &caseID, reason)
	if err != nil {
		writeQuarantineOperationError(w, r, "quarantine_case", caseID, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// RestoreQuarantine verifies and restores one active quarantine snapshot.
func (h *DataRepairHandler) RestoreQuarantine(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "restore_quarantine")
	defer span.End()

	quarantineID, err := parseQuarantineID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}
	reason, err := decodeQuarantineReason(w, r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	ctx := r.Context()
	actor := requestActor(r, h.forwardAuthHeader)
	var restored *systemmodel.RepairQuarantine
	err = h.withTransaction(ctx, func(tx database.DBTX) error {
		record, err := h.caseRepo.GetQuarantineForUpdate(ctx, tx, quarantineID)
		if err != nil {
			return fmt.Errorf("lock quarantine %d: %w", quarantineID, err)
		}
		if record == nil {
			return fmt.Errorf("%w: %d", errQuarantineNotFound, quarantineID)
		}
		if record.RestoredAt != nil {
			return fmt.Errorf("%w: quarantine %d was already restored", errQuarantineConflict, quarantineID)
		}
		if record.SchemaVersion != 1 {
			return fmt.Errorf(
				"%w: unsupported quarantine schema version %d",
				repairsnapshot.ErrMalformedPayload,
				record.SchemaVersion,
			)
		}

		repairCase, err := h.caseRepo.GetCaseForUpdate(ctx, tx, record.CaseID)
		if err != nil {
			return fmt.Errorf("lock case %d for restore: %w", record.CaseID, err)
		}
		if repairCase == nil {
			return fmt.Errorf(
				"%w: quarantine %d references missing case %d",
				errQuarantineConflict,
				record.ID,
				record.CaseID,
			)
		}
		if repairCase.Status != systemmodel.RepairCaseStatusQuarantined ||
			repairCase.Kind != record.Kind ||
			repairCase.SessionID != record.SessionID ||
			repairCase.VehicleID != record.VehicleID {
			return fmt.Errorf(
				"%w: quarantine and case lifecycle do not match",
				errQuarantineConflict,
			)
		}
		_, identity, _, err := canonicalSnapshotIdentity(record.Kind, record.OriginalRow)
		if err != nil {
			return fmt.Errorf("validate quarantine %d snapshot: %w", record.ID, err)
		}
		if identity.ID != record.SessionID ||
			identity.VehicleID != record.VehicleID ||
			!identity.StartedAt.UTC().Equal(repairCase.EvidenceStartedAt.UTC()) {
			return fmt.Errorf(
				"%w: quarantine snapshot identity does not match its ledger and case",
				errQuarantineConflict,
			)
		}

		if err := h.restoreQuarantinedSource(ctx, tx, record); err != nil {
			return fmt.Errorf("restore source %s/%d: %w", record.Kind, record.SessionID, err)
		}
		if err := h.caseRepo.MarkQuarantineRestored(ctx, tx, record.ID, actor); err != nil {
			return fmt.Errorf("mark quarantine %d restored: %w", record.ID, err)
		}
		if err := h.caseRepo.TransitionStatus(
			ctx,
			tx,
			repairCase.ID,
			systemmodel.RepairCaseStatusRestored,
			nil,
			repairCase.UpdatedAt,
		); err != nil {
			return fmt.Errorf("transition case %d to restored: %w", repairCase.ID, err)
		}

		sourceAction, sourceEntity, err := restoreSourceAuditIdentity(record.Kind)
		if err != nil {
			return err
		}
		detail := restoreAuditDetail(repairCase.ID, record.ID, record.Kind, reason)
		if err := h.writeAudit(
			r,
			tx,
			sourceAction,
			sourceEntity,
			record.SessionID,
			detail,
		); err != nil {
			return fmt.Errorf("audit restored source %s/%d: %w", record.Kind, record.SessionID, err)
		}
		if err := h.writeAudit(
			r,
			tx,
			AuditActionCaseRestore,
			auditEntityDataRepairCase,
			repairCase.ID,
			detail,
		); err != nil {
			return fmt.Errorf("audit restored case %d: %w", repairCase.ID, err)
		}

		restoredAt := h.now().UTC()
		record.RestoredBy = &actor
		record.RestoredAt = &restoredAt
		restored = record
		return nil
	})
	if err != nil {
		writeQuarantineOperationError(w, r, "restore", quarantineID, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, restored)
}

func (h *DataRepairHandler) quarantineLegacySession(
	w http.ResponseWriter,
	r *http.Request,
	kind systemmodel.RepairCaseKind,
	sessionID int64,
) {
	if !h.caseRepositoryReady(w, r) {
		return
	}
	reason, err := decodeQuarantineReason(w, r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if _, err := h.quarantineSession(r, kind, sessionID, nil, reason); err != nil {
		writeQuarantineOperationError(w, r, "legacy_quarantine", sessionID, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
