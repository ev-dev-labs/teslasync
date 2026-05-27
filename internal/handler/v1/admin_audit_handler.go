package v1

// Phase-45 — Admin audit handler. Wraps auditviewersvc with filter
// parsing for the admin UI's audit log viewer. WRITE access to the
// audit log goes through internal/audit directly; there is no POST
// route here — auditing happens as a side-effect of other actions.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/auditviewersvc"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// AdminAuditHandler serves /admin/audit-log* routes.
type AdminAuditHandler struct {
	svc *auditviewersvc.Service
}

// NewAdminAuditHandler wires the handler.
func NewAdminAuditHandler(svc *auditviewersvc.Service) *AdminAuditHandler {
	return &AdminAuditHandler{svc: svc}
}

// Register mounts the routes.
func (h *AdminAuditHandler) Register(r chi.Router) {
	r.Get("/admin/audit-log", h.List)
	r.Get("/admin/audit-log/categories", h.Categories)
	r.Get("/admin/audit-log/actions", h.Actions)
	r.Get("/admin/audit-log/verify", h.Verify)
}

// List returns audit rows matching the query string filter.
func (h *AdminAuditHandler) List(w http.ResponseWriter, r *http.Request) {
	q := auditviewersvc.Query{
		Limit:  parseIntDefault(r.URL.Query().Get("limit"), 100),
		Offset: parseIntDefault(r.URL.Query().Get("offset"), 0) - 1, // safe: parseIntDefault returns dflt when <=0
	}
	if q.Offset < 0 {
		q.Offset = 0
	}
	if v := r.URL.Query().Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.Since = t
		}
	}
	if v := r.URL.Query().Get("until"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.Until = t
		}
	}
	if v := r.URL.Query().Get("categories"); v != "" {
		q.Categories = splitCSV(v)
	}
	if v := r.URL.Query().Get("actors"); v != "" {
		q.Actors = splitCSV(v)
	}
	if v := r.URL.Query().Get("actions"); v != "" {
		q.Actions = splitCSV(v)
	}
	if v := r.URL.Query().Get("entity_type"); v != "" {
		q.EntityType = v
	}
	if v := r.URL.Query().Get("entity_id"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			q.EntityID = &n
		}
	}

	rows, err := h.svc.Query(r.Context(), q)
	if h.handleNotConfigured(w, err) {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "AUDIT_QUERY_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{
		"rows":  rows,
		"limit": q.Limit,
	})
}

// Categories returns distinct categories for the filter dropdown.
func (h *AdminAuditHandler) Categories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.DistinctCategories(r.Context())
	if h.handleNotConfigured(w, err) {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "AUDIT_CATEGORIES_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{"categories": rows})
}

// Actions returns distinct action names.
func (h *AdminAuditHandler) Actions(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.DistinctActions(r.Context())
	if h.handleNotConfigured(w, err) {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "AUDIT_ACTIONS_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{"actions": rows})
}

// Verify re-derives the SHA256 chain on recent rows.
func (h *AdminAuditHandler) Verify(w http.ResponseWriter, r *http.Request) {
	limit := parseIntDefault(r.URL.Query().Get("limit"), 1000)
	since := time.Now().Add(-30 * 24 * time.Hour)
	if v := r.URL.Query().Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			since = t
		}
	}
	badID, checked, err := h.svc.VerifyChain(r.Context(), since, limit)
	if h.handleNotConfigured(w, err) {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "AUDIT_VERIFY_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{
		"intact":          badID == 0,
		"first_bad_id":    badID,
		"rows_checked":    checked,
		"since":           since.UTC(),
		"limit":           limit,
	})
}

func (h *AdminAuditHandler) handleNotConfigured(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, auditviewersvc.ErrNotConfigured) {
		httputil.RespondError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED",
			"audit viewer not configured on this deployment")
		return true
	}
	return false
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
