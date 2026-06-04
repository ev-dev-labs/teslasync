// Incidents handler for the status API.
//
// CRUD + timeline-append endpoints for /api/v1/status/incidents. The
// list endpoint is the same one referenced by /api/v1/status (active
// incidents). All write endpoints are auth-gated by the parent
// /api/v1 ForwardAuth middleware; rate-limiting is applied at the
// router layer.
//
// The repository owns validation; this handler owns shape mapping
// and HTTP status code selection.

package status

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	"github.com/go-chi/chi/v5"
)

// StatusIncidentsHandler wires the incidents repo to HTTP.
type StatusIncidentsHandler struct {
	repo *dbobs.IncidentRepo
}

// NewStatusIncidentsHandler builds a handler bound to the shared pool.
func NewStatusIncidentsHandler(repo *dbobs.IncidentRepo) *StatusIncidentsHandler {
	return &StatusIncidentsHandler{repo: repo}
}

// ListActive returns active incidents — used by the StatusV1 snapshot
// pump. Implements the StatusIncidentStore interface in
// v1.go so the snapshot can include incidents inline.
func (h *StatusIncidentsHandler) ListActive(ctx context.Context) ([]StatusIncident, error) {
	if h == nil || h.repo == nil {
		return []StatusIncident{}, nil
	}
	rows, err := h.repo.List(ctx, dbobs.IncidentListParams{ActiveOnly: true, Limit: 50})
	if err != nil {
		return nil, err
	}
	out := make([]StatusIncident, 0, len(rows))
	for _, r := range rows {
		out = append(out, incidentToSnapshot(r))
	}
	return out, nil
}

// List handles GET /api/v1/status/incidents?active=1 and the optional
// ?limit=N query string.
func (h *StatusIncidentsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	activeOnly := q.Get("active") == "1" || strings.EqualFold(q.Get("active"), "true")
	limit, _ := strconv.Atoi(q.Get("limit"))
	rows, err := h.repo.List(r.Context(), dbobs.IncidentListParams{
		ActiveOnly: activeOnly, Limit: limit,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"incidents": rows,
		"count":     len(rows),
	})
}

// Get handles GET /api/v1/status/incidents/{id}.
func (h *StatusIncidentsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := parseInt64Param(r, "id")
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	row, err := h.repo.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, dbobs.ErrIncidentNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "incident not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, row)
}

// IncidentCreatePayload is the POST body shape.
type IncidentCreatePayload struct {
	Title              string   `json:"title"`
	Description        string   `json:"description"`
	Severity           string   `json:"severity"`
	Status             string   `json:"status"`
	AffectedComponents []string `json:"affected_components"`
	InitialMessage     string   `json:"initial_message"`
}

// Create handles POST /api/v1/status/incidents.
func (h *StatusIncidentsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var p IncidentCreatePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	created, err := h.repo.Insert(r.Context(), dbobs.IncidentInsert{
		Title:              p.Title,
		Description:        p.Description,
		Severity:           p.Severity,
		Status:             p.Status,
		Source:             dbobs.IncidentSourceManual,
		AffectedComponents: p.AffectedComponents,
		CreatedBy:          callerSubject(r),
		InitialMessage:     p.InitialMessage,
	})
	if err != nil {
		httpx.WriteError(w, mapIncidentErr(err), err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, created)
}

// IncidentPatchPayload is the PATCH body shape.
type IncidentPatchPayload struct {
	Title              *string   `json:"title,omitempty"`
	Description        *string   `json:"description,omitempty"`
	Severity           *string   `json:"severity,omitempty"`
	Status             *string   `json:"status,omitempty"`
	AffectedComponents *[]string `json:"affected_components,omitempty"`
	Resolved           *bool     `json:"resolved,omitempty"`
}

// Patch handles PATCH /api/v1/status/incidents/{id}.
func (h *StatusIncidentsHandler) Patch(w http.ResponseWriter, r *http.Request) {
	id, ok := parseInt64Param(r, "id")
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var p IncidentPatchPayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	updated, err := h.repo.Patch(r.Context(), id, dbobs.IncidentPatch{
		Title:              p.Title,
		Description:        p.Description,
		Severity:           p.Severity,
		Status:             p.Status,
		AffectedComponents: p.AffectedComponents,
		Resolved:           p.Resolved,
	}, callerSubject(r))
	if err != nil {
		httpx.WriteError(w, mapIncidentErr(err), err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// IncidentUpdatePayload is the POST /updates body shape.
type IncidentUpdatePayload struct {
	Message string `json:"message"`
	Status  string `json:"status"`
}

// AppendUpdate handles POST /api/v1/status/incidents/{id}/updates.
func (h *StatusIncidentsHandler) AppendUpdate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseInt64Param(r, "id")
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var p IncidentUpdatePayload
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	updated, err := h.repo.AppendUpdate(r.Context(), id, p.Message, p.Status, callerSubject(r))
	if err != nil {
		httpx.WriteError(w, mapIncidentErr(err), err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// Delete handles DELETE /api/v1/status/incidents/{id}.
func (h *StatusIncidentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseInt64Param(r, "id")
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil {
		if errors.Is(err, dbobs.ErrIncidentNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "incident not found")
			return
		}
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// incidentToSnapshot maps a database row to the StatusIncident contract.
func incidentToSnapshot(r dbobs.Incident) StatusIncident {
	return StatusIncident{
		ID:         strconv.FormatInt(r.ID, 10),
		Title:      r.Title,
		Status:     r.Status,
		Severity:   r.Severity,
		StartedAt:  r.StartedAt,
		UpdatedAt:  r.UpdatedAt,
		ResolvedAt: r.ResolvedAt,
		Components: r.AffectedComponents,
	}
}

// mapIncidentErr converts repo sentinels to HTTP statuses.
func mapIncidentErr(err error) int {
	switch {
	case errors.Is(err, dbobs.ErrIncidentNotFound):
		return http.StatusNotFound
	case errors.Is(err, dbobs.ErrIncidentInvalidSeverity),
		errors.Is(err, dbobs.ErrIncidentInvalidStatus),
		errors.Is(err, dbobs.ErrIncidentInvalidSource),
		errors.Is(err, dbobs.ErrIncidentTitleLength),
		errors.Is(err, dbobs.ErrIncidentMessageLength):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// parseInt64Param reads a chi URL parameter as int64.
func parseInt64Param(r *http.Request, name string) (int64, bool) {
	v := chi.URLParam(r, name)
	if v == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(v, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// callerSubject returns the ForwardAuth subject when present, falling
// back to "operator" so timeline entries always have an author label.
func callerSubject(r *http.Request) string {
	if s := r.Header.Get("X-Forwarded-User"); s != "" {
		return s
	}
	if s := r.Header.Get("Remote-User"); s != "" {
		return s
	}
	return "operator"
}
