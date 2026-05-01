package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// dashboardLayoutRepo is the small slice of *database.DashboardLayoutRepo the
// handler depends on. Keeping it as an interface means the unit tests can
// drop in an in-memory fake without standing up a real Postgres pool.
type dashboardLayoutRepo interface {
	List(ctx context.Context, userID *int64, vehicleID *int64) ([]*models.DashboardLayout, error)
	GetByID(ctx context.Context, id int64) (*models.DashboardLayout, error)
	Create(ctx context.Context, l *models.DashboardLayout) error
	Update(ctx context.Context, id int64, name string, layout []byte, isDefault bool) error
	Delete(ctx context.Context, id int64) error
	SetDefault(ctx context.Context, id int64) error
}

// DashboardLayoutHandler exposes per-row CRUD over the named layout library
// introduced in Phase 40 / Prompt 30. It backs the new LayoutSwitcher and
// the "Save as preset" / "Apply preset" flows in the dashboard frontend.
//
// The legacy /settings/dashboard-layouts blob endpoint stays in place as the
// in-app sync path; this handler is purely additive.
type DashboardLayoutHandler struct {
	repo dashboardLayoutRepo
}

func NewDashboardLayoutHandler(db *database.DB) *DashboardLayoutHandler {
	return &DashboardLayoutHandler{repo: database.NewDashboardLayoutRepo(db)}
}

// maxDashboardLayoutBodyBytes caps each request body. The whole layout
// (widgets + grid placement + per-widget config) historically fits in well
// under 100 KB; 1 MB leaves comfortable headroom for future widget growth
// without letting clients smuggle through arbitrarily large blobs.
const maxDashboardLayoutBodyBytes = 1 << 20

// dashboardLayoutWriteRequest is the wire shape for POST and PUT bodies.
// All fields are optional on PUT (empty/zero values mean "leave alone");
// the handler enforces required fields on POST.
type dashboardLayoutWriteRequest struct {
	Name      *string         `json:"name,omitempty"`
	VehicleID *int64          `json:"vehicle_id,omitempty"`
	IsDefault *bool           `json:"is_default,omitempty"`
	Layout    json.RawMessage `json:"layout,omitempty"`
}

// List returns the user's saved layouts, optionally filtered to a single
// vehicle scope via `?vehicle_id=N`.
//
//	GET /api/v1/dashboard/layouts
//	GET /api/v1/dashboard/layouts?vehicle_id=42
func (h *DashboardLayoutHandler) List(w http.ResponseWriter, r *http.Request) {
	var vehicleID *int64
	if raw := r.URL.Query().Get("vehicle_id"); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v <= 0 {
			writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
			return
		}
		vehicleID = &v
	}

	layouts, err := h.repo.List(r.Context(), nil, vehicleID)
	if err != nil {
		log.Error().Err(err).Msg("dashboard_layouts list failed")
		writeError(w, http.StatusInternalServerError, "failed to list dashboard layouts")
		return
	}
	if layouts == nil {
		layouts = []*models.DashboardLayout{}
	}
	writeJSON(w, http.StatusOK, layouts)
}

// Create inserts a new named layout.
//
//	POST /api/v1/dashboard/layouts
//	body: { "name": "Morning Quick-Glance", "vehicle_id": 42?, "is_default": false?, "layout": {...} }
func (h *DashboardLayoutHandler) Create(w http.ResponseWriter, r *http.Request) {
	body, err := readDashboardLayoutBody(r)
	if err != nil {
		writeError(w, err.status, err.msg)
		return
	}

	var req dashboardLayoutWriteRequest
	if jsonErr := json.Unmarshal(body, &req); jsonErr != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	name := strings.TrimSpace(stringOrEmpty(req.Name))
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(name) > 120 {
		writeError(w, http.StatusBadRequest, "name must be 120 characters or fewer")
		return
	}
	if !isJSONObject(req.Layout) {
		writeError(w, http.StatusBadRequest, "layout must be a JSON object")
		return
	}
	if req.VehicleID != nil && *req.VehicleID <= 0 {
		writeError(w, http.StatusBadRequest, "vehicle_id must be a positive integer when provided")
		return
	}

	now := time.Now().UTC()
	layout := &models.DashboardLayout{
		VehicleID: req.VehicleID,
		Name:      name,
		IsDefault: boolOr(req.IsDefault, false),
		Layout:    cloneRawJSON(req.Layout),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := h.repo.Create(r.Context(), layout); err != nil {
		log.Error().Err(err).Msg("dashboard_layouts create failed")
		writeError(w, http.StatusInternalServerError, "failed to create dashboard layout")
		return
	}
	if layout.IsDefault {
		// Surface a clean default per scope so list views read consistently
		// regardless of insert order.
		if err := h.repo.SetDefault(r.Context(), layout.ID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			log.Warn().Err(err).Int64("id", layout.ID).Msg("dashboard_layouts post-insert SetDefault failed")
		}
	}

	writeJSON(w, http.StatusCreated, layout)
}

// Update mutates an existing layout. Only name / layout / is_default may be
// changed — scope (user_id, vehicle_id) is immutable.
//
//	PUT /api/v1/dashboard/layouts/{id}
func (h *DashboardLayoutHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid layout id")
		return
	}

	body, readErr := readDashboardLayoutBody(r)
	if readErr != nil {
		writeError(w, readErr.status, readErr.msg)
		return
	}

	var req dashboardLayoutWriteRequest
	if jsonErr := json.Unmarshal(body, &req); jsonErr != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	existing, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("dashboard_layouts get_by_id failed")
		writeError(w, http.StatusInternalServerError, "failed to load dashboard layout")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "dashboard layout not found")
		return
	}

	name := existing.Name
	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if trimmed == "" {
			writeError(w, http.StatusBadRequest, "name must not be empty")
			return
		}
		if len(trimmed) > 120 {
			writeError(w, http.StatusBadRequest, "name must be 120 characters or fewer")
			return
		}
		name = trimmed
	}

	layoutBytes := []byte(existing.Layout)
	if len(req.Layout) > 0 {
		if !isJSONObject(req.Layout) {
			writeError(w, http.StatusBadRequest, "layout must be a JSON object")
			return
		}
		layoutBytes = cloneRawJSON(req.Layout)
	}

	isDefault := existing.IsDefault
	if req.IsDefault != nil {
		isDefault = *req.IsDefault
	}

	if err := h.repo.Update(r.Context(), id, name, layoutBytes, isDefault); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "dashboard layout not found")
			return
		}
		log.Error().Err(err).Int64("id", id).Msg("dashboard_layouts update failed")
		writeError(w, http.StatusInternalServerError, "failed to update dashboard layout")
		return
	}
	if isDefault && !existing.IsDefault {
		if err := h.repo.SetDefault(r.Context(), id); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			log.Warn().Err(err).Int64("id", id).Msg("dashboard_layouts post-update SetDefault failed")
		}
	}

	updated, err := h.repo.GetByID(r.Context(), id)
	if err != nil || updated == nil {
		writeError(w, http.StatusInternalServerError, "failed to reload dashboard layout")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// Delete removes a layout.
//
//	DELETE /api/v1/dashboard/layouts/{id}
func (h *DashboardLayoutHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid layout id")
		return
	}

	if delErr := h.repo.Delete(r.Context(), id); delErr != nil {
		if errors.Is(delErr, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "dashboard layout not found")
			return
		}
		log.Error().Err(delErr).Int64("id", id).Msg("dashboard_layouts delete failed")
		writeError(w, http.StatusInternalServerError, "failed to delete dashboard layout")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Apply marks a layout as the default for its (user, vehicle) scope. The
// repo's SetDefault is transactional — at most one default per scope is
// guaranteed even under concurrent applies.
//
//	POST /api/v1/dashboard/layouts/{id}/apply
func (h *DashboardLayoutHandler) Apply(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid layout id")
		return
	}

	if applyErr := h.repo.SetDefault(r.Context(), id); applyErr != nil {
		if errors.Is(applyErr, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "dashboard layout not found")
			return
		}
		log.Error().Err(applyErr).Int64("id", id).Msg("dashboard_layouts apply failed")
		writeError(w, http.StatusInternalServerError, "failed to apply dashboard layout")
		return
	}

	updated, err := h.repo.GetByID(r.Context(), id)
	if err != nil || updated == nil {
		writeError(w, http.StatusInternalServerError, "failed to reload dashboard layout")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// ── helpers ─────────────────────────────────────────────────────────────────

type dashboardLayoutBodyError struct {
	status int
	msg    string
}

func readDashboardLayoutBody(r *http.Request) ([]byte, *dashboardLayoutBodyError) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxDashboardLayoutBodyBytes+1))
	if err != nil {
		return nil, &dashboardLayoutBodyError{http.StatusBadRequest, "failed to read request body"}
	}
	if len(body) > maxDashboardLayoutBodyBytes {
		return nil, &dashboardLayoutBodyError{http.StatusRequestEntityTooLarge, "dashboard layout payload exceeds 1 MB limit"}
	}
	return body, nil
}

func stringOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func boolOr(p *bool, fallback bool) bool {
	if p == nil {
		return fallback
	}
	return *p
}

// isJSONObject returns true when raw decodes to a JSON object literal. We
// reject arrays / scalars so callers can rely on shape downstream.
func isJSONObject(raw json.RawMessage) bool {
	trimmed := strings.TrimLeft(string(raw), " \t\r\n")
	if !strings.HasPrefix(trimmed, "{") {
		return false
	}
	var probe map[string]json.RawMessage
	return json.Unmarshal(raw, &probe) == nil
}

// cloneRawJSON returns a defensive copy of raw so the request body's
// underlying buffer is not retained inside the repo / DB driver.
func cloneRawJSON(raw json.RawMessage) json.RawMessage {
	out := make(json.RawMessage, len(raw))
	copy(out, raw)
	return out
}
