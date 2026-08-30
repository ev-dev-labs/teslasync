package datarepair

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/rs/zerolog/log"
)

const (
	defaultCaseListLimit = 50
	maxCaseListLimit     = 200
	maxBulkCaseIDs       = 100

	maxCaseAssigneeChars       = 255
	maxCaseResolutionNoteChars = 4000
	maxCaseCommentChars        = 4000
	// 64 KiB admits 4,000 Unicode characters even when clients encode every
	// rune as JSON escape sequences, while still imposing a small hard cap.
	maxCaseRequestBodyBytes = 64 << 10
)

var errCaseRepositoryUnavailable = errors.New("data-repair case repository is unavailable")

// CaseRepository is the narrow persistence surface used by the case-management
// HTTP handlers.
type CaseRepository interface {
	UpsertCase(context.Context, database.DBTX, *systemmodel.RepairCase) (int64, error)
	ListCases(context.Context, systemmodel.RepairCaseListFilter) ([]systemmodel.RepairCase, error)
	GetStats(context.Context, *int64) (*systemmodel.RepairCaseStats, error)
	GetCase(context.Context, int64) (*systemmodel.RepairCase, error)
	GetCaseForUpdate(context.Context, database.DBTX, int64) (*systemmodel.RepairCase, error)
	FindActiveCaseByFingerprint(context.Context, string) (*systemmodel.RepairCase, error)
	TransitionStatus(context.Context, database.DBTX, int64, systemmodel.RepairCaseStatus, *string, time.Time) error
	AssignCase(context.Context, database.DBTX, int64, *string) error
	AddComment(context.Context, database.DBTX, *systemmodel.RepairCaseComment) (int64, error)
	// ListComments is repository-bounded (currently the newest 500 rows).
	ListComments(context.Context, int64) ([]systemmodel.RepairCaseComment, error)
	CreateQuarantine(context.Context, database.DBTX, *systemmodel.RepairQuarantine) (int64, error)
	GetQuarantineForUpdate(context.Context, database.DBTX, int64) (*systemmodel.RepairQuarantine, error)
	GetQuarantineByCase(context.Context, int64) (*systemmodel.RepairQuarantine, error)
	ListQuarantines(context.Context, systemmodel.RepairQuarantineListFilter) ([]systemmodel.RepairQuarantine, error)
	MarkQuarantineRestored(context.Context, database.DBTX, int64, string) error
}

var _ CaseRepository = (*datarepairdb.CaseRepo)(nil)

type repairCaseCursor struct {
	LastSeenAt time.Time `json:"last_seen_at"`
	ID         int64     `json:"id"`
}

type repairCaseListResponse struct {
	Cases      []systemmodel.RepairCase `json:"cases"`
	HasMore    bool                     `json:"has_more"`
	NextCursor *repairCaseCursor        `json:"next_cursor,omitempty"`
}

type repairCaseDetailResponse struct {
	Case       *systemmodel.RepairCase         `json:"case"`
	Comments   []systemmodel.RepairCaseComment `json:"comments"`
	Quarantine *systemmodel.RepairQuarantine   `json:"quarantine"`
}

type transitionCaseRequest struct {
	Status            *systemmodel.RepairCaseStatus `json:"status"`
	ExpectedUpdatedAt *string                       `json:"expected_updated_at"`
	ResolutionNote    *string                       `json:"resolution_note,omitempty"`
}

type assignmentCaseRequest struct {
	AssignedTo json.RawMessage `json:"assigned_to"`
}

type commentCaseRequest struct {
	Body *string `json:"body"`
}

type bulkTransitionCaseRequest struct {
	CaseIDs        []int64                       `json:"case_ids"`
	Status         *systemmodel.RepairCaseStatus `json:"status"`
	ResolutionNote *string                       `json:"resolution_note,omitempty"`
}

type bulkTransitionCaseResponse struct {
	Updated int `json:"updated"`
	Skipped int `json:"skipped"`
}

type validatedCaseTransition struct {
	status            systemmodel.RepairCaseStatus
	expectedUpdatedAt time.Time
	resolutionNote    *string
}

func decodeCaseRequest(w http.ResponseWriter, r *http.Request, dst interface{}) error {
	if r.Body == nil {
		return errors.New("request body is required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCaseRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("request body is required")
		}
		return fmt.Errorf("decode request body: %w", err)
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON object")
		}
		return fmt.Errorf("decode trailing request data: %w", err)
	}
	return nil
}

func caseStringTooLong(value string, maxChars int) bool {
	return utf8.RuneCountInString(value) > maxChars
}

func invalidCaseText(value string) bool {
	return strings.ContainsRune(value, '\x00')
}

func parsePositiveInt64(raw, field string) (int64, error) {
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", field)
	}
	return value, nil
}

func parseCaseID(r *http.Request) (int64, error) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		return 0, errors.New("case id must be a positive integer")
	}
	return id, nil
}

func parseCaseListFilter(r *http.Request) (systemmodel.RepairCaseListFilter, int, error) {
	var filter systemmodel.RepairCaseListFilter
	query := r.URL.Query()

	if query.Has("vehicle_id") {
		vehicleID, err := parsePositiveInt64(query.Get("vehicle_id"), "vehicle_id")
		if err != nil {
			return filter, 0, err
		}
		filter.VehicleID = &vehicleID
	}
	if query.Has("status") {
		status := systemmodel.RepairCaseStatus(query.Get("status"))
		if !status.IsValid() {
			return filter, 0, errors.New("status is invalid")
		}
		filter.Status = &status
	}
	if query.Has("kind") {
		kind := systemmodel.RepairCaseKind(query.Get("kind"))
		if !kind.IsValid() {
			return filter, 0, errors.New("kind is invalid")
		}
		filter.Kind = &kind
	}
	if query.Has("confidence") {
		confidence := systemmodel.RepairCaseConfidence(query.Get("confidence"))
		if !confidence.IsValid() {
			return filter, 0, errors.New("confidence is invalid")
		}
		filter.Confidence = &confidence
	}
	if query.Has("assigned_to") {
		assignedTo := strings.TrimSpace(query.Get("assigned_to"))
		if assignedTo == "" {
			return filter, 0, errors.New("assigned_to must not be blank")
		}
		if caseStringTooLong(assignedTo, maxCaseAssigneeChars) || invalidCaseText(assignedTo) {
			return filter, 0, errors.New("assigned_to is invalid or too long")
		}
		filter.AssignedTo = &assignedTo
	}

	hasCursorTime := query.Has("cursor_last_seen_at")
	hasCursorID := query.Has("cursor_id")
	if hasCursorTime != hasCursorID {
		return filter, 0, errors.New("cursor_last_seen_at and cursor_id must be provided together")
	}
	if hasCursorTime {
		cursorTime, err := time.Parse(time.RFC3339, query.Get("cursor_last_seen_at"))
		if err != nil {
			return filter, 0, errors.New("cursor_last_seen_at must be an RFC3339 timestamp")
		}
		cursorID, err := parsePositiveInt64(query.Get("cursor_id"), "cursor_id")
		if err != nil {
			return filter, 0, err
		}
		cursorTime = cursorTime.UTC()
		filter.CursorLastSeenAt = &cursorTime
		filter.CursorID = &cursorID
	}

	limit := defaultCaseListLimit
	if query.Has("limit") {
		parsed, err := strconv.Atoi(query.Get("limit"))
		if err != nil || parsed <= 0 {
			return filter, 0, errors.New("limit must be a positive integer")
		}
		if parsed > maxCaseListLimit {
			parsed = maxCaseListLimit
		}
		limit = parsed
	}
	filter.Limit = limit + 1
	if filter.Limit > maxCaseListLimit {
		filter.Limit = maxCaseListLimit
	}
	return filter, limit, nil
}

func parseOptionalVehicleID(r *http.Request) (*int64, error) {
	if !r.URL.Query().Has("vehicle_id") {
		return nil, nil
	}
	vehicleID, err := parsePositiveInt64(r.URL.Query().Get("vehicle_id"), "vehicle_id")
	if err != nil {
		return nil, err
	}
	return &vehicleID, nil
}

func validateTransitionRequest(req transitionCaseRequest) (validatedCaseTransition, error) {
	if req.Status == nil {
		return validatedCaseTransition{}, errors.New("status is required")
	}
	switch *req.Status {
	case systemmodel.RepairCaseStatusOpen,
		systemmodel.RepairCaseStatusInReview,
		systemmodel.RepairCaseStatusDismissed,
		systemmodel.RepairCaseStatusResolved:
	default:
		return validatedCaseTransition{}, errors.New("status is not permitted for a metadata transition")
	}
	if req.ExpectedUpdatedAt == nil || strings.TrimSpace(*req.ExpectedUpdatedAt) == "" {
		return validatedCaseTransition{}, errors.New("expected_updated_at is required")
	}
	expected, err := time.Parse(time.RFC3339, strings.TrimSpace(*req.ExpectedUpdatedAt))
	if err != nil {
		return validatedCaseTransition{}, errors.New("expected_updated_at must be an RFC3339 timestamp")
	}

	var note *string
	if req.ResolutionNote != nil {
		trimmed := strings.TrimSpace(*req.ResolutionNote)
		if trimmed == "" {
			return validatedCaseTransition{}, errors.New("resolution_note must not be blank")
		}
		if caseStringTooLong(trimmed, maxCaseResolutionNoteChars) || invalidCaseText(trimmed) {
			return validatedCaseTransition{}, errors.New("resolution_note is invalid or too long")
		}
		note = &trimmed
	}
	if (*req.Status == systemmodel.RepairCaseStatusDismissed ||
		*req.Status == systemmodel.RepairCaseStatusResolved) && note == nil {
		return validatedCaseTransition{}, errors.New("resolution_note is required for dismissed or resolved cases")
	}

	return validatedCaseTransition{
		status:            *req.Status,
		expectedUpdatedAt: expected.UTC(),
		resolutionNote:    note,
	}, nil
}

func caseTransitionAllowed(from, to systemmodel.RepairCaseStatus) bool {
	switch from {
	case systemmodel.RepairCaseStatusOpen:
		return to == systemmodel.RepairCaseStatusInReview ||
			to == systemmodel.RepairCaseStatusDismissed ||
			to == systemmodel.RepairCaseStatusResolved
	case systemmodel.RepairCaseStatusInReview:
		return to == systemmodel.RepairCaseStatusOpen ||
			to == systemmodel.RepairCaseStatusDismissed ||
			to == systemmodel.RepairCaseStatusResolved
	case systemmodel.RepairCaseStatusDismissed, systemmodel.RepairCaseStatusResolved:
		return to == systemmodel.RepairCaseStatusOpen
	default:
		return false
	}
}

func (h *DataRepairHandler) caseRepositoryReady(w http.ResponseWriter, r *http.Request) bool {
	if h.caseRepo != nil {
		return true
	}
	recordHandlerError(r.Context(), errCaseRepositoryUnavailable)
	httpx.WriteError(w, http.StatusServiceUnavailable, "data-repair case management is unavailable")
	return false
}

func caseRepositoryUnavailable(err error) bool {
	return errors.Is(err, datarepairdb.ErrNoCaseDatabase) ||
		errors.Is(err, errCaseRepositoryUnavailable)
}

func writeCaseOperationError(
	w http.ResponseWriter,
	r *http.Request,
	operation string,
	caseID int64,
	err error,
) {
	ctx := r.Context()
	recordHandlerError(ctx, err)
	event := log.Error().
		Err(err).
		Str("trace_id", activeTraceID(ctx)).
		Str("operation", operation)
	if caseID > 0 {
		event = event.Int64("case_id", caseID)
	}
	event.Msg("data-repair case operation failed")

	if caseRepositoryUnavailable(err) {
		httpx.WriteError(w, http.StatusServiceUnavailable, "data-repair case management is unavailable")
		return
	}
	httpx.WriteError(w, http.StatusInternalServerError, "data-repair case operation failed")
}

func writeCaseValidationError(w http.ResponseWriter, r *http.Request, err error) {
	recordHandlerError(r.Context(), err)
	httpx.WriteError(w, http.StatusBadRequest, err.Error())
}

func writeCaseNotFound(w http.ResponseWriter, r *http.Request) {
	recordHandlerError(r.Context(), errors.New("repair case not found"))
	httpx.WriteError(w, http.StatusNotFound, "repair case not found")
}

func listResponseCursor(cases []systemmodel.RepairCase, hasMore bool) *repairCaseCursor {
	if !hasMore || len(cases) == 0 {
		return nil
	}
	last := cases[len(cases)-1]
	return &repairCaseCursor{
		LastSeenAt: last.LastSeenAt,
		ID:         last.ID,
	}
}

// ListCases returns the durable repair worklist with keyset pagination.
func (h *DataRepairHandler) ListCases(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "list_cases")
	defer span.End()

	if !h.caseRepositoryReady(w, r) {
		return
	}
	filter, requestedLimit, err := parseCaseListFilter(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	cases, err := h.caseRepo.ListCases(r.Context(), filter)
	if err != nil {
		writeCaseOperationError(w, r, "list", 0, fmt.Errorf("list repair cases: %w", err))
		return
	}

	hasMore := len(cases) > requestedLimit
	if hasMore {
		cases = cases[:requestedLimit]
	} else if requestedLimit == maxCaseListLimit && len(cases) == requestedLimit {
		// The repository clamps at 200, so a one-row probe is required to
		// distinguish exactly 200 rows from a further page at the public cap.
		last := cases[len(cases)-1]
		probe := filter
		probe.CursorLastSeenAt = &last.LastSeenAt
		probe.CursorID = &last.ID
		probe.Limit = 1
		next, probeErr := h.caseRepo.ListCases(r.Context(), probe)
		if probeErr != nil {
			writeCaseOperationError(w, r, "list_cursor_probe", 0, fmt.Errorf("probe next repair-case page: %w", probeErr))
			return
		}
		hasMore = len(next) > 0
	}
	if cases == nil {
		cases = make([]systemmodel.RepairCase, 0)
	}

	httpx.WriteJSON(w, http.StatusOK, repairCaseListResponse{
		Cases:      cases,
		HasMore:    hasMore,
		NextCursor: listResponseCursor(cases, hasMore),
	})
}

// GetCaseStats returns the unwrapped dashboard summary contract.
func (h *DataRepairHandler) GetCaseStats(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "case_stats")
	defer span.End()

	if !h.caseRepositoryReady(w, r) {
		return
	}
	vehicleID, err := parseOptionalVehicleID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	stats, err := h.caseRepo.GetStats(r.Context(), vehicleID)
	if err != nil {
		writeCaseOperationError(w, r, "stats", 0, fmt.Errorf("get repair-case stats: %w", err))
		return
	}
	if stats == nil {
		err := errors.New("repair-case stats repository returned nil")
		writeCaseOperationError(w, r, "stats", 0, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, stats)
}

// GetCase returns a case together with its bounded comment trail and optional
// active quarantine record.
func (h *DataRepairHandler) GetCase(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "get_case")
	defer span.End()

	caseID, err := parseCaseID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}

	repairCase, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "get", caseID, fmt.Errorf("get repair case %d: %w", caseID, err))
		return
	}
	if repairCase == nil {
		writeCaseNotFound(w, r)
		return
	}
	comments, err := h.caseRepo.ListComments(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "list_comments", caseID, fmt.Errorf("list comments for repair case %d: %w", caseID, err))
		return
	}
	if comments == nil {
		comments = make([]systemmodel.RepairCaseComment, 0)
	}
	quarantine, err := h.caseRepo.GetQuarantineByCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "get_quarantine", caseID, fmt.Errorf("get quarantine for repair case %d: %w", caseID, err))
		return
	}

	httpx.WriteJSON(w, http.StatusOK, repairCaseDetailResponse{
		Case:       repairCase,
		Comments:   comments,
		Quarantine: quarantine,
	})
}

func caseTransitionAuditDetail(from, to systemmodel.RepairCaseStatus, reasonProvided, bulk bool) string {
	return fmt.Sprintf(
		"from=%s to=%s reason_provided=%t bulk=%t",
		from,
		to,
		reasonProvided,
		bulk,
	)
}

func (h *DataRepairHandler) fetchUpdatedCase(
	w http.ResponseWriter,
	r *http.Request,
	caseID int64,
	operation string,
) (*systemmodel.RepairCase, bool) {
	updated, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, operation, caseID, fmt.Errorf("get updated repair case %d: %w", caseID, err))
		return nil, false
	}
	if updated == nil {
		err := fmt.Errorf("updated repair case %d was not found", caseID)
		writeCaseOperationError(w, r, operation, caseID, err)
		return nil, false
	}
	return updated, true
}

// TransitionCase applies an operator-allowed metadata lifecycle transition
// with optimistic concurrency and a same-transaction audit row.
func (h *DataRepairHandler) TransitionCase(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "transition_case")
	defer span.End()

	caseID, err := parseCaseID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}
	var req transitionCaseRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	transition, err := validateTransitionRequest(req)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	current, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "transition_load", caseID, fmt.Errorf("load repair case %d for transition: %w", caseID, err))
		return
	}
	if current == nil {
		writeCaseNotFound(w, r)
		return
	}
	if !current.UpdatedAt.Equal(transition.expectedUpdatedAt) {
		err := datarepairdb.ErrConcurrentModification
		recordHandlerError(r.Context(), err)
		httpx.WriteError(w, http.StatusConflict, "repair case changed; reload and try again")
		return
	}
	if !caseTransitionAllowed(current.Status, transition.status) {
		err := fmt.Errorf("transition from %s to %s is not allowed", current.Status, transition.status)
		recordHandlerError(r.Context(), err)
		httpx.WriteError(w, http.StatusConflict, err.Error())
		return
	}

	err = h.withTransaction(r.Context(), func(tx database.DBTX) error {
		if transitionErr := h.caseRepo.TransitionStatus(
			r.Context(),
			tx,
			caseID,
			transition.status,
			transition.resolutionNote,
			transition.expectedUpdatedAt,
		); transitionErr != nil {
			return fmt.Errorf("transition repair case %d: %w", caseID, transitionErr)
		}
		if auditErr := h.writeAudit(
			r,
			tx,
			AuditActionCaseTransition,
			auditEntityDataRepairCase,
			caseID,
			caseTransitionAuditDetail(current.Status, transition.status, transition.resolutionNote != nil, false),
		); auditErr != nil {
			return fmt.Errorf("audit repair case %d transition: %w", caseID, auditErr)
		}
		return nil
	})
	if errors.Is(err, datarepairdb.ErrConcurrentModification) {
		recordHandlerError(r.Context(), err)
		httpx.WriteError(w, http.StatusConflict, "repair case changed; reload and try again")
		return
	}
	if err != nil {
		writeCaseOperationError(w, r, "transition", caseID, err)
		return
	}

	updated, ok := h.fetchUpdatedCase(w, r, caseID, "transition_result")
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

func decodeAssignment(raw json.RawMessage) (*string, error) {
	if len(raw) == 0 {
		return nil, errors.New("assigned_to is required")
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, errors.New("assigned_to must be a string or null")
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("assigned_to must not be blank")
	}
	if caseStringTooLong(value, maxCaseAssigneeChars) || invalidCaseText(value) {
		return nil, errors.New("assigned_to is invalid or too long")
	}
	return &value, nil
}

// AssignCase assigns or unassigns a case and writes its audit row in the same
// transaction.
func (h *DataRepairHandler) AssignCase(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "assign_case")
	defer span.End()

	caseID, err := parseCaseID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}

	var req assignmentCaseRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	assignee, err := decodeAssignment(req.AssignedTo)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	current, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "assignment_load", caseID, fmt.Errorf("load repair case %d for assignment: %w", caseID, err))
		return
	}
	if current == nil {
		writeCaseNotFound(w, r)
		return
	}

	err = h.withTransaction(r.Context(), func(tx database.DBTX) error {
		if assignErr := h.caseRepo.AssignCase(r.Context(), tx, caseID, assignee); assignErr != nil {
			return fmt.Errorf("assign repair case %d: %w", caseID, assignErr)
		}
		detail := "assigned=true"
		if assignee == nil {
			detail = "assigned=false"
		}
		if auditErr := h.writeAudit(
			r,
			tx,
			AuditActionCaseAssignment,
			auditEntityDataRepairCase,
			caseID,
			detail,
		); auditErr != nil {
			return fmt.Errorf("audit repair case %d assignment: %w", caseID, auditErr)
		}
		return nil
	})
	if err != nil {
		writeCaseOperationError(w, r, "assignment", caseID, err)
		return
	}

	updated, ok := h.fetchUpdatedCase(w, r, caseID, "assignment_result")
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

func requestActor(r *http.Request, headerName string) string {
	return actorFromRequest(r, headerName)
}

// AddCaseComment appends a bounded comment and its audit row atomically.
func (h *DataRepairHandler) AddCaseComment(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "add_case_comment")
	defer span.End()

	caseID, err := parseCaseID(r)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if !h.caseRepositoryReady(w, r) {
		return
	}
	var req commentCaseRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	if req.Body == nil {
		writeCaseValidationError(w, r, errors.New("body is required"))
		return
	}
	body := strings.TrimSpace(*req.Body)
	if body == "" {
		writeCaseValidationError(w, r, errors.New("body must not be blank"))
		return
	}
	if caseStringTooLong(body, maxCaseCommentChars) || invalidCaseText(body) {
		writeCaseValidationError(w, r, errors.New("body is invalid or too long"))
		return
	}

	current, err := h.caseRepo.GetCase(r.Context(), caseID)
	if err != nil {
		writeCaseOperationError(w, r, "comment_load", caseID, fmt.Errorf("load repair case %d for comment: %w", caseID, err))
		return
	}
	if current == nil {
		writeCaseNotFound(w, r)
		return
	}

	comment := &systemmodel.RepairCaseComment{
		CaseID: caseID,
		Actor:  requestActor(r, h.forwardAuthHeader),
		Body:   body,
	}
	err = h.withTransaction(r.Context(), func(tx database.DBTX) error {
		if _, addErr := h.caseRepo.AddComment(r.Context(), tx, comment); addErr != nil {
			return fmt.Errorf("add comment to repair case %d: %w", caseID, addErr)
		}
		if auditErr := h.writeAudit(
			r,
			tx,
			AuditActionCaseComment,
			auditEntityDataRepairCase,
			caseID,
			fmt.Sprintf("body_length=%d", utf8.RuneCountInString(body)),
		); auditErr != nil {
			return fmt.Errorf("audit repair case %d comment: %w", caseID, auditErr)
		}
		return nil
	})
	if err != nil {
		writeCaseOperationError(w, r, "comment", caseID, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, comment)
}

func validateBulkTransitionRequest(req bulkTransitionCaseRequest) ([]int64, *string, error) {
	if req.CaseIDs == nil || len(req.CaseIDs) == 0 {
		return nil, nil, errors.New("case_ids must contain at least one id")
	}
	if req.Status == nil {
		return nil, nil, errors.New("status is required")
	}
	if *req.Status != systemmodel.RepairCaseStatusInReview &&
		*req.Status != systemmodel.RepairCaseStatusDismissed {
		return nil, nil, errors.New("bulk status must be in_review or dismissed")
	}

	ids := make([]int64, 0, len(req.CaseIDs))
	seen := make(map[int64]struct{}, len(req.CaseIDs))
	for _, id := range req.CaseIDs {
		if id <= 0 {
			return nil, nil, errors.New("case_ids must contain only positive ids")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
		if len(ids) > maxBulkCaseIDs {
			return nil, nil, fmt.Errorf("case_ids must contain at most %d distinct ids", maxBulkCaseIDs)
		}
	}

	var note *string
	if req.ResolutionNote != nil {
		trimmed := strings.TrimSpace(*req.ResolutionNote)
		if trimmed == "" {
			return nil, nil, errors.New("resolution_note must not be blank")
		}
		if caseStringTooLong(trimmed, maxCaseResolutionNoteChars) || invalidCaseText(trimmed) {
			return nil, nil, errors.New("resolution_note is invalid or too long")
		}
		note = &trimmed
	}
	if *req.Status == systemmodel.RepairCaseStatusDismissed && note == nil {
		return nil, nil, errors.New("resolution_note is required for dismissed cases")
	}
	return ids, note, nil
}

// BulkTransitionCases applies metadata-only in_review/dismissed transitions.
// Missing or lifecycle-incompatible cases are counted as skipped. All
// successful transitions and their audit rows share one transaction, so a
// repository or audit failure cannot leave a partially committed batch.
func (h *DataRepairHandler) BulkTransitionCases(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "bulk_transition_cases")
	defer span.End()

	if !h.caseRepositoryReady(w, r) {
		return
	}
	var req bulkTransitionCaseRequest
	if err := decodeCaseRequest(w, r, &req); err != nil {
		writeCaseValidationError(w, r, err)
		return
	}
	ids, note, err := validateBulkTransitionRequest(req)
	if err != nil {
		writeCaseValidationError(w, r, err)
		return
	}

	type candidate struct {
		id        int64
		from      systemmodel.RepairCaseStatus
		updatedAt time.Time
	}
	candidates := make([]candidate, 0, len(ids))
	skipped := 0
	for _, id := range ids {
		repairCase, getErr := h.caseRepo.GetCase(r.Context(), id)
		if getErr != nil {
			writeCaseOperationError(w, r, "bulk_load", id, fmt.Errorf("load repair case %d for bulk transition: %w", id, getErr))
			return
		}
		if repairCase == nil || !caseTransitionAllowed(repairCase.Status, *req.Status) {
			skipped++
			continue
		}
		candidates = append(candidates, candidate{
			id:        id,
			from:      repairCase.Status,
			updatedAt: repairCase.UpdatedAt,
		})
	}

	updated := 0
	if len(candidates) > 0 {
		err = h.withTransaction(r.Context(), func(tx database.DBTX) error {
			for _, candidate := range candidates {
				transitionErr := h.caseRepo.TransitionStatus(
					r.Context(),
					tx,
					candidate.id,
					*req.Status,
					note,
					candidate.updatedAt,
				)
				if errors.Is(transitionErr, datarepairdb.ErrConcurrentModification) {
					skipped++
					continue
				}
				if transitionErr != nil {
					return fmt.Errorf("bulk transition repair case %d: %w", candidate.id, transitionErr)
				}
				if auditErr := h.writeAudit(
					r,
					tx,
					AuditActionCaseBulkTransition,
					auditEntityDataRepairCase,
					candidate.id,
					caseTransitionAuditDetail(candidate.from, *req.Status, note != nil, true),
				); auditErr != nil {
					return fmt.Errorf("audit bulk transition for repair case %d: %w", candidate.id, auditErr)
				}
				updated++
			}
			return nil
		})
		if err != nil {
			writeCaseOperationError(w, r, "bulk_transition", 0, err)
			return
		}
	}

	httpx.WriteJSON(w, http.StatusOK, bulkTransitionCaseResponse{
		Updated: updated,
		Skipped: skipped,
	})
}
