package datarepair

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// Explicit apply path for a reviewed repair suggestion.
//
// Nothing here runs on its own. It only executes because an operator opened
// /data-repair, read the evidence for one specific session, and confirmed the
// action — and only after RequireSudo has already passed at the router.
//
// Safety properties, in the order they are enforced:
//
//  1. The session is re-read at apply time (never trusted from the request).
//  2. The proposed timestamp is bounded: strictly after the session start and
//     never in the future.
//  3. Optimistic concurrency: suggestion applies must pin the ended_at they
//     saw, and the database update repeats that comparison atomically.
//  4. Idempotency: re-applying the same boundary is a 200 "already_applied",
//     not a duplicate write and not an error.
//  5. Evidence re-validation: the diagnosis is re-run and the requested
//     timestamp and rule must exactly match the server's current suggestion.
//  6. Overlap guard: the boundary may not run past the start of the next
//     session of the same kind.
//  7. Audit: one append-only audit_logs row per applied mutation.

// closeStatus is the machine token returned in the response body.
type closeStatus string

const (
	closeStatusClosed         closeStatus = "closed"
	closeStatusAlreadyApplied closeStatus = "already_applied"
)

// futureSkewTolerance allows a request stamped from a client clock that is
// marginally ahead of the server without rejecting it as "in the future".
const futureSkewTolerance = time.Minute

// driveRecomputedFields lists exactly which columns a drive close rewrites.
// Measured aggregates are NOT in this list and are NOT touched — the response
// carries it so the UI can state that honestly instead of implying a full
// recomputation.
var driveRecomputedFields = []string{"ended_at", "duration_s"}

// closeRequest is the required body of POST /data-repair/{kind}/{id}/close.
type closeRequest struct {
	// CaseID links the source mutation to a durable reviewed case. It is
	// optional for backwards-compatible suggestion applies and omitted for
	// manual closes.
	CaseID *int64 `json:"case_id,omitempty"`
	// EndedAt is the proposed boundary as an RFC3339 timestamp.
	EndedAt *string `json:"ended_at"`
	// Rule is either the machine token shown during review or "manual" for an
	// explicitly entered operator boundary. Suggestion rules must still match
	// the server-derived diagnosis.
	Rule *string `json:"rule"`
	// ExpectedStoredEndedAt pins the ended_at the operator saw:
	//   - ""                → assert the session is still OPEN
	//   - RFC3339 timestamp → assert the stored ended_at still equals it
	ExpectedStoredEndedAt *string `json:"expected_stored_ended_at"`
}

// closeResponse is the success shape for both close endpoints.
type closeResponse struct {
	Status    string `json:"status"`
	SessionID int64  `json:"session_id"`
	EndedAt   string `json:"ended_at"`
	// DurationS is present for drives only (charging duration is derived).
	DurationS *int64 `json:"duration_s,omitempty"`
	// Recomputed names every column the apply actually rewrote.
	Recomputed []string `json:"recomputed_fields,omitempty"`
}

// maxCloseBodyBytes caps the request body. The shape is three short strings
// and one optional integer; anything larger is a client bug or an attack.
const maxCloseBodyBytes = 4 << 10

// decodeCloseRequest parses the required body. Unknown fields are rejected so
// a typo cannot silently weaken a reviewed repair.
func decodeCloseRequest(r *http.Request) (closeRequest, error) {
	var req closeRequest
	if r.Body == nil {
		return req, errors.New("request body is required")
	}
	payload, err := io.ReadAll(io.LimitReader(r.Body, maxCloseBodyBytes+1))
	if err != nil {
		return closeRequest{}, fmt.Errorf("read request body: %w", err)
	}
	if len(payload) > maxCloseBodyBytes {
		return closeRequest{}, fmt.Errorf("request body exceeds %d bytes", maxCloseBodyBytes)
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			return closeRequest{}, errors.New("request body is required")
		}
		return closeRequest{}, fmt.Errorf("invalid JSON body: %w", err)
	}
	var trailing json.RawMessage
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return closeRequest{}, errors.New("request body must contain one JSON object")
		}
		return closeRequest{}, fmt.Errorf("invalid trailing JSON data: %w", err)
	}
	if req.CaseID != nil && *req.CaseID <= 0 {
		return closeRequest{}, errors.New("case_id must be a positive integer")
	}
	if req.CaseID != nil && req.Rule != nil && strings.TrimSpace(*req.Rule) == "manual" {
		return closeRequest{}, errors.New("case_id cannot be used with a manual repair")
	}
	return req, nil
}

// parseBoundary parses an RFC3339 timestamp into UTC.
func parseBoundary(raw string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

// closeAuditDetail renders the audit `detail` column. It records what changed
// and why, without any PII.
func closeAuditDetail(rule, source string, startedAt time.Time, previous *time.Time, applied time.Time, durationS *int64) string {
	prev := "open"
	if previous != nil {
		prev = previous.UTC().Format(time.RFC3339)
	}
	detail := fmt.Sprintf(
		"rule=%s source=%s started_at=%s previous_ended_at=%s ended_at=%s",
		rule,
		source,
		startedAt.UTC().Format(time.RFC3339),
		prev,
		applied.Format(time.RFC3339),
	)
	if durationS != nil {
		detail += fmt.Sprintf(" duration_s=%d", *durationS)
	}
	return detail
}

// auditSource distinguishes an applied suggestion from a manual boundary
// button so the audit trail can be filtered by provenance.
func auditSource(rule string) string {
	if rule == "manual" {
		return "manual"
	}
	return "suggestion"
}

type applyCaseTarget struct {
	repairCase *systemmodel.RepairCase
	transition bool
}

func sameOptionalTime(left, right *time.Time) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.UTC().Equal(right.UTC())
}

func expectedStoredBoundary(req closeRequest) (*time.Time, error) {
	if req.ExpectedStoredEndedAt == nil {
		return nil, errors.New("expected_stored_ended_at is required")
	}
	raw := strings.TrimSpace(*req.ExpectedStoredEndedAt)
	if raw == "" {
		return nil, nil
	}
	value, err := parseBoundary(raw)
	if err != nil {
		return nil, errors.New(
			"expected_stored_ended_at must be an RFC3339 timestamp or an empty string",
		)
	}
	return &value, nil
}

func writeApplyCaseConflict(w http.ResponseWriter, r *http.Request, message string) {
	err := errors.New(message)
	recordHandlerError(r.Context(), err)
	httpx.WriteError(w, http.StatusConflict, message)
}

// resolveApplyCase binds an explicit case_id, or a deterministic active case
// when the legacy suggestion request omitted case_id, to the source mutation.
// The source row is still protected by its own optimistic boundary update;
// TransitionStatus repeats the case updated_at comparison inside that same
// transaction.
func (h *DataRepairHandler) resolveApplyCase(
	w http.ResponseWriter,
	r *http.Request,
	req closeRequest,
	kind systemmodel.SessionRepairKind,
	sessionID, vehicleID int64,
	startedAt time.Time,
	endedAt time.Time,
	status closeStatus,
	rule string,
) (*applyCaseTarget, bool) {
	requestedRule := rule
	if req.Rule != nil {
		requestedRule = strings.TrimSpace(*req.Rule)
	}
	if requestedRule == "manual" {
		return nil, false
	}

	// Without the durable repository we cannot honestly determine whether a
	// matching active case exists. Fail closed rather than applying the source
	// while potentially leaving its case open.
	if h.caseRepo == nil {
		if !h.caseRepositoryReady(w, r) {
			return nil, true
		}
	}

	var (
		repairCase *systemmodel.RepairCase
		err        error
	)
	if req.CaseID != nil {
		repairCase, err = h.caseRepo.GetCase(r.Context(), *req.CaseID)
	} else {
		fingerprint := systemmodel.RepairCaseFingerprint(
			systemmodel.RepairCaseKind(kind),
			sessionID,
			requestedRule,
		)
		repairCase, err = h.caseRepo.FindActiveCaseByFingerprint(r.Context(), fingerprint)
	}
	if err != nil {
		caseID := int64(0)
		if req.CaseID != nil {
			caseID = *req.CaseID
		}
		writeCaseOperationError(
			w,
			r,
			"apply_case_load",
			caseID,
			fmt.Errorf("load repair case for apply: %w", err),
		)
		return nil, true
	}
	if repairCase == nil {
		if req.CaseID != nil {
			writeCaseNotFound(w, r)
			return nil, true
		}
		return nil, false
	}

	if repairCase.Kind != systemmodel.RepairCaseKind(kind) ||
		repairCase.SessionID != sessionID ||
		repairCase.VehicleID != vehicleID ||
		repairCase.Rule != requestedRule {
		writeApplyCaseConflict(
			w,
			r,
			"repair case no longer matches the requested source session and rule",
		)
		return nil, true
	}
	if !repairCase.EvidenceStartedAt.UTC().Equal(startedAt.UTC()) {
		writeApplyCaseConflict(w, r, "repair case evidence no longer matches the source session")
		return nil, true
	}
	expectedStored, err := expectedStoredBoundary(req)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return nil, true
	}
	if !sameOptionalTime(repairCase.EvidenceStoredEndedAt, expectedStored) {
		writeApplyCaseConflict(
			w,
			r,
			"repair case evidence pin no longer matches the reviewed source state",
		)
		return nil, true
	}
	if repairCase.SuggestedEndedAt == nil ||
		!repairCase.SuggestedEndedAt.UTC().Equal(endedAt.UTC()) {
		writeApplyCaseConflict(
			w,
			r,
			"repair case boundary no longer matches the reviewed suggestion",
		)
		return nil, true
	}

	switch repairCase.Status {
	case systemmodel.RepairCaseStatusOpen, systemmodel.RepairCaseStatusInReview:
		if !repairCase.Applicable {
			writeApplyCaseConflict(w, r, "repair case is no longer applicable")
			return nil, true
		}
		return &applyCaseTarget{repairCase: repairCase, transition: true}, false
	case systemmodel.RepairCaseStatusApplied:
		if status == closeStatusAlreadyApplied {
			return &applyCaseTarget{repairCase: repairCase}, false
		}
		fallthrough
	default:
		writeApplyCaseConflict(
			w,
			r,
			fmt.Sprintf("repair case status %s cannot be applied", repairCase.Status),
		)
		return nil, true
	}
}

func caseApplyAuditDetail(
	from systemmodel.RepairCaseStatus,
	rule string,
	sourceMutated bool,
) string {
	return fmt.Sprintf(
		"from=%s to=%s rule=%s source_mutated=%t",
		from,
		systemmodel.RepairCaseStatusApplied,
		rule,
		sourceMutated,
	)
}

func (h *DataRepairHandler) applyCaseOutcome(
	r *http.Request,
	tx database.DBTX,
	target *applyCaseTarget,
	rule string,
	sourceMutated bool,
) error {
	if target == nil || target.repairCase == nil || !target.transition {
		return nil
	}
	repairCase := target.repairCase
	if err := h.caseRepo.TransitionStatus(
		r.Context(),
		tx,
		repairCase.ID,
		systemmodel.RepairCaseStatusApplied,
		nil,
		repairCase.UpdatedAt,
	); err != nil {
		return fmt.Errorf("transition repair case %d to applied: %w", repairCase.ID, err)
	}
	if err := h.writeAudit(
		r,
		tx,
		AuditActionCaseApply,
		auditEntityDataRepairCase,
		repairCase.ID,
		caseApplyAuditDetail(repairCase.Status, rule, sourceMutated),
	); err != nil {
		return fmt.Errorf("audit applied repair case %d: %w", repairCase.ID, err)
	}
	return nil
}

// resolveCloseBoundary validates the requested boundary and reports the
// timestamp to write.
//
// Returns done=true when it has already written an HTTP error response; the
// caller must return immediately in that case. A closeStatusAlreadyApplied
// status means the write must be skipped and a 200 returned.
func (h *DataRepairHandler) resolveCloseBoundary(
	w http.ResponseWriter,
	r *http.Request,
	req closeRequest,
	kind systemmodel.SessionRepairKind,
	sessionID, vehicleID int64,
	startedAt time.Time,
	storedEndedAt *time.Time,
	label string,
) (time.Time, closeStatus, string, bool) {
	now := h.now()

	if req.EndedAt == nil {
		httpx.WriteError(w, http.StatusBadRequest, "ended_at is required")
		return time.Time{}, "", "", true
	}
	if req.Rule == nil || strings.TrimSpace(*req.Rule) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "rule is required")
		return time.Time{}, "", "", true
	}
	if req.ExpectedStoredEndedAt == nil {
		httpx.WriteError(w, http.StatusBadRequest, "expected_stored_ended_at is required")
		return time.Time{}, "", "", true
	}
	requestedRule := strings.TrimSpace(*req.Rule)

	endedAt, err := parseBoundary(*req.EndedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "ended_at must be an RFC3339 timestamp")
		return time.Time{}, "", "", true
	}

	// --- bounds -------------------------------------------------------------
	if !endedAt.After(startedAt.UTC()) {
		httpx.WriteError(w, http.StatusBadRequest,
			fmt.Sprintf("ended_at must be after the %s start", label))
		return time.Time{}, "", "", true
	}
	if endedAt.After(now.Add(futureSkewTolerance)) {
		httpx.WriteError(w, http.StatusBadRequest, "ended_at must not be in the future")
		return time.Time{}, "", "", true
	}

	// --- idempotency (checked BEFORE concurrency so a double-click on an
	//     already-applied suggestion is a no-op, not a conflict) -------------
	if storedEndedAt != nil && storedEndedAt.UTC().Equal(endedAt) {
		return endedAt, closeStatusAlreadyApplied, requestedRule, false
	}

	// --- optimistic concurrency --------------------------------------------
	if ok := h.assertExpectedEndedAt(w, req, storedEndedAt, label); !ok {
		return time.Time{}, "", "", true
	}

	if requestedRule == "manual" {
		if ok := h.assertNoOverlap(w, r, kind, sessionID, vehicleID, startedAt, endedAt); !ok {
			return time.Time{}, "", "", true
		}
		return endedAt, closeStatusClosed, requestedRule, false
	}

	// --- evidence re-validation --------------------------------------------
	if h.diagnosis == nil {
		recordHandlerError(r.Context(), errors.New("data-repair diagnosis source not configured"))
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"evidence-based repair is unavailable: diagnosis source not configured")
		return time.Time{}, "", "", true
	}

	sug, err := h.diagnoseSession(r.Context(), kind, sessionID)
	if err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Str("kind", string(kind)).
			Int64("session_id", sessionID).
			Msg("data-repair: failed to re-validate repair evidence")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to re-validate repair evidence")
		return time.Time{}, "", "", true
	}
	if sug == nil {
		httpx.WriteError(w, http.StatusConflict,
			fmt.Sprintf("no durable evidence currently supports repairing this %s", label))
		return time.Time{}, "", "", true
	}
	if !sug.Applicable {
		httpx.WriteError(w, http.StatusConflict,
			fmt.Sprintf("this repair cannot be applied: %s", sug.BlockedReason))
		return time.Time{}, "", "", true
	}
	if !endedAt.Equal(sug.SuggestedEndedAt.UTC()) {
		httpx.WriteError(w, http.StatusConflict,
			"the reviewed boundary no longer matches the current suggestion; reload and review it again")
		return time.Time{}, "", "", true
	}
	if requestedRule != string(sug.Rule) {
		httpx.WriteError(w, http.StatusConflict,
			"the reviewed rule no longer matches the current suggestion; reload and review it again")
		return time.Time{}, "", "", true
	}

	// --- overlap guard ------------------------------------------------------
	if ok := h.assertNoOverlap(w, r, kind, sessionID, vehicleID, startedAt, endedAt); !ok {
		return time.Time{}, "", "", true
	}

	return endedAt, closeStatusClosed, string(sug.Rule), false
}

// assertExpectedEndedAt enforces the optimistic-concurrency pin. Returns false
// after writing a 400/409.
func (h *DataRepairHandler) assertExpectedEndedAt(
	w http.ResponseWriter,
	req closeRequest,
	storedEndedAt *time.Time,
	label string,
) bool {
	expected := strings.TrimSpace(*req.ExpectedStoredEndedAt)

	if expected == "" {
		if storedEndedAt != nil {
			httpx.WriteError(w, http.StatusConflict,
				fmt.Sprintf("this %s is no longer open; reload the suggestions and review it again", label))
			return false
		}
		return true
	}

	want, err := parseBoundary(expected)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest,
			"expected_stored_ended_at must be an RFC3339 timestamp or an empty string")
		return false
	}
	if storedEndedAt == nil || !storedEndedAt.UTC().Equal(want) {
		httpx.WriteError(w, http.StatusConflict,
			fmt.Sprintf("this %s changed since the suggestion was generated; reload and review it again", label))
		return false
	}
	return true
}

// assertNoOverlap refuses a boundary that would leave the session running past
// the start of the next session of the same kind.
func (h *DataRepairHandler) assertNoOverlap(
	w http.ResponseWriter,
	r *http.Request,
	kind systemmodel.SessionRepairKind,
	sessionID, vehicleID int64,
	startedAt, endedAt time.Time,
) bool {
	if h.diagnosis == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable,
			"evidence-based repair is unavailable: diagnosis source not configured")
		return false
	}
	var (
		next *datarepairdb.Observation
		err  error
	)
	switch kind {
	case systemmodel.SessionRepairKindDrive:
		next, err = h.diagnosis.FirstDriveAfter(r.Context(), vehicleID, startedAt.UTC(), sessionID)
	case systemmodel.SessionRepairKindCharging:
		next, err = h.diagnosis.FirstChargingSessionAfter(r.Context(), vehicleID, startedAt.UTC(), sessionID)
	default:
		httpx.WriteError(w, http.StatusBadRequest, "unknown session kind")
		return false
	}
	if err != nil {
		recordHandlerError(r.Context(), err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(r.Context())).
			Str("kind", string(kind)).
			Int64("session_id", sessionID).
			Msg("data-repair: failed to check for overlapping sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to check for overlapping sessions")
		return false
	}
	if next != nil && next.Ts.Before(endedAt) {
		httpx.WriteError(w, http.StatusConflict,
			"the proposed end overlaps the next session for this vehicle")
		return false
	}
	return true
}
