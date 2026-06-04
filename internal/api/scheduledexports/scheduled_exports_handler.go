package scheduledexports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	exportdb "github.com/ev-dev-labs/teslasync/internal/database/export"
)

// MaxScheduledExportBodyBytes caps the inbound JSON body. The
// payload is at most a name + a handful of strings + a small
// columns array; we cap to 32 KiB to absorb accidental log-pastes
// without enabling a memory attack.
const MaxScheduledExportBodyBytes int64 = 1 << 15 // 32 KiB

// ScheduledExportStore is the narrow surface ScheduledExportsHandler
// depends on. Production wires *exportdb.ScheduledExportRepo;
// handler tests stub this without touching pgx.
type ScheduledExportStore interface {
	Create(ctx context.Context, owner string, in exportdb.ScheduledExportInput, now time.Time) (*exportdb.ScheduledExportRow, error)
	Get(ctx context.Context, id int64) (*exportdb.ScheduledExportRow, error)
	ListByOwner(ctx context.Context, owner string) ([]exportdb.ScheduledExportRow, error)
	Update(ctx context.Context, id int64, owner string, in exportdb.ScheduledExportInput, now time.Time) (*exportdb.ScheduledExportRow, error)
	Delete(ctx context.Context, id int64, owner string) error
	SetNextRunAt(ctx context.Context, id int64, owner string, when time.Time) error
}

// ScheduledExportsHandler serves the five /scheduled-exports routes.
type ScheduledExportsHandler struct {
	store   ScheduledExportStore
	authHdr string
	now     func() time.Time
}

// NewScheduledExportsHandler wires the production repo and forward-
// auth header. now is injectable for tests; production callers pass
// nil to use time.Now().UTC.
func NewScheduledExportsHandler(store ScheduledExportStore, forwardAuthHeader string, now func() time.Time) *ScheduledExportsHandler {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &ScheduledExportsHandler{
		store:   store,
		authHdr: forwardAuthHeader,
		now:     now,
	}
}

// scheduledExportRequest is the shared JSON body shape for create +
// update. Note the deliberate ABSENCE of an owner_subject field —
// that comes from actorFromRequest only.
type scheduledExportRequest struct {
	Name         string                           `json:"name"`
	ExportType   string                           `json:"export_type"`
	Format       string                           `json:"format"`
	VehicleID    *int64                           `json:"vehicle_id,omitempty"`
	Columns      []string                         `json:"columns,omitempty"`
	ScheduleCron string                           `json:"schedule_cron"`
	Delivery     exportdb.ScheduledExportDelivery `json:"delivery"`
	RangeWindow  string                           `json:"range_window,omitempty"`
	Enabled      *bool                            `json:"enabled,omitempty"`
}

// toInput converts the wire payload into the validated input the
// repo expects. Defaults are applied here so the repo sees the
// caller's intent verbatim.
func (req scheduledExportRequest) toInput() exportdb.ScheduledExportInput {
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	return exportdb.ScheduledExportInput{
		Name:         req.Name,
		ExportType:   req.ExportType,
		Format:       req.Format,
		VehicleID:    req.VehicleID,
		Columns:      req.Columns,
		ScheduleCron: req.ScheduleCron,
		Delivery:     req.Delivery,
		RangeWindow:  req.RangeWindow,
		Enabled:      enabled,
	}
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

func (h *ScheduledExportsHandler) requireOwner(w http.ResponseWriter, r *http.Request) (string, bool) {
	owner := actorFromRequest(r, h.authHdr)
	if owner == "" {
		httpx.WriteErrorCode(w, http.StatusUnauthorized,
			"scheduled exports require an authenticated user",
			"MISSING_IDENTITY")
		return "", false
	}
	return owner, true
}

func (h *ScheduledExportsHandler) decodeBody(w http.ResponseWriter, r *http.Request) (*scheduledExportRequest, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxScheduledExportBodyBytes)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req scheduledExportRequest
	if err := dec.Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			httpx.WriteError(w, http.StatusBadRequest, "request body is required")
			return nil, false
		}
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			httpx.WriteError(w, http.StatusBadRequest,
				fmt.Sprintf("request body exceeds %d bytes", MaxScheduledExportBodyBytes))
			return nil, false
		}
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return nil, false
	}
	return &req, true
}

// mapRepoErr translates a repo sentinel into the corresponding
// 4xx / 5xx response. Returns true when the error was handled and
// the caller should bail; false when the error is nil.
func (h *ScheduledExportsHandler) mapRepoErr(w http.ResponseWriter, err error, what string) bool {
	if err == nil {
		return false
	}
	switch {
	case errors.Is(err, exportdb.ErrScheduledExportNotFound):
		httpx.WriteError(w, http.StatusNotFound, "scheduled export not found")
	case errors.Is(err, exportdb.ErrScheduledExportInvalidType),
		errors.Is(err, exportdb.ErrScheduledExportInvalidFormat),
		errors.Is(err, exportdb.ErrScheduledExportInvalidCron),
		errors.Is(err, exportdb.ErrScheduledExportInvalidDeliv),
		errors.Is(err, exportdb.ErrScheduledExportInvalidWindow),
		errors.Is(err, exportdb.ErrScheduledExportEmptyName):
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, exportdb.ErrScheduledExportEmptyOwner):
		httpx.WriteErrorCode(w, http.StatusUnauthorized,
			"scheduled exports require an authenticated user",
			"MISSING_IDENTITY")
	default:
		log.Error().Err(err).Str("op", what).Msg("scheduled exports: repo failure")
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: internal error")
	}
	return true
}

// List returns every schedule belonging to the authenticated user.
func (h *ScheduledExportsHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: store not configured")
		return
	}
	owner, ok := h.requireOwner(w, r)
	if !ok {
		return
	}
	rows, err := h.store.ListByOwner(r.Context(), owner)
	if h.mapRepoErr(w, err, "list") {
		return
	}
	if rows == nil {
		rows = []exportdb.ScheduledExportRow{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// Create inserts a new schedule for the authenticated user.
func (h *ScheduledExportsHandler) Create(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: store not configured")
		return
	}
	owner, ok := h.requireOwner(w, r)
	if !ok {
		return
	}
	req, ok := h.decodeBody(w, r)
	if !ok {
		return
	}
	row, err := h.store.Create(r.Context(), owner, req.toInput(), h.now())
	if h.mapRepoErr(w, err, "create") {
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, row)
}

// Update mutates an existing schedule. Cross-user updates collapse
// to 404 because the SQL filter scopes by (id, owner_subject).
func (h *ScheduledExportsHandler) Update(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: store not configured")
		return
	}
	owner, ok := h.requireOwner(w, r)
	if !ok {
		return
	}
	id, ok := parseScheduledExportID(w, r)
	if !ok {
		return
	}
	req, ok := h.decodeBody(w, r)
	if !ok {
		return
	}
	row, err := h.store.Update(r.Context(), id, owner, req.toInput(), h.now())
	if h.mapRepoErr(w, err, "update") {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, row)
}

// Delete removes a schedule, scoped to the authenticated user.
func (h *ScheduledExportsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: store not configured")
		return
	}
	owner, ok := h.requireOwner(w, r)
	if !ok {
		return
	}
	id, ok := parseScheduledExportID(w, r)
	if !ok {
		return
	}
	err := h.store.Delete(r.Context(), id, owner)
	if h.mapRepoErr(w, err, "delete") {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RunNow advances the schedule's next_run_at to now() so the worker
// tick picks it up on its next iteration. Returns the updated row
// shape so the SPA can refresh the table without a follow-up GET.
func (h *ScheduledExportsHandler) RunNow(w http.ResponseWriter, r *http.Request) {
	if h.store == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "scheduled exports: store not configured")
		return
	}
	owner, ok := h.requireOwner(w, r)
	if !ok {
		return
	}
	id, ok := parseScheduledExportID(w, r)
	if !ok {
		return
	}
	if err := h.store.SetNextRunAt(r.Context(), id, owner, h.now()); h.mapRepoErr(w, err, "run-now") {
		return
	}
	row, err := h.store.Get(r.Context(), id)
	if h.mapRepoErr(w, err, "run-now-get") {
		return
	}
	// Defence in depth: even though SetNextRunAt scopes by owner, a
	// follow-up Get does not. Cross-check to ensure we never echo a
	// row belonging to another user.
	if row == nil || row.OwnerSubject != owner {
		httpx.WriteError(w, http.StatusNotFound, "scheduled export not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, row)
}

func parseScheduledExportID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid schedule id")
		return 0, false
	}
	return id, true
}
