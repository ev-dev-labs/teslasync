package v1

// Admin observability handler. Five read-only routes are backed by
// adminobssvc.Service. Each route gracefully returns 503 (with a
// stable error code the SPA can render as "subsystem not configured on
// this deployment") when the backing repo is nil instead of crashing
// on a nil-pointer.

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/adminobssvc"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// AdminObservabilityHandler serves the admin observability routes.
type AdminObservabilityHandler struct {
	svc *adminobssvc.Service
}

// NewAdminObservabilityHandler wires the handler.
func NewAdminObservabilityHandler(svc *adminobssvc.Service) *AdminObservabilityHandler {
	return &AdminObservabilityHandler{svc: svc}
}

// Register mounts all five routes under r. The caller is expected to
// have already applied any rate-limit / auth middleware.
func (h *AdminObservabilityHandler) Register(r chi.Router) {
	r.Get("/admin/observability/schema-drift", h.SchemaDrift)
	r.Get("/admin/observability/slow-queries", h.SlowQueries)
	r.Get("/admin/observability/vehicle-cost", h.VehicleCost)
	r.Get("/admin/observability/disk-forecast", h.DiskForecast)
	r.Get("/admin/observability/secret-rotation", h.SecretRotation)
}

// SchemaDrift surfaces the current vs seed schema fingerprint.
func (h *AdminObservabilityHandler) SchemaDrift(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.SchemaDrift(r.Context())
	if h.handleNotConfigured(w, err, "schema_drift") {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "SCHEMA_DRIFT_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, res)
}

// SlowQueries returns the top-N pg_stat_statements rows.
func (h *AdminObservabilityHandler) SlowQueries(w http.ResponseWriter, r *http.Request) {
	orderBy := adminobssvc.OrderBy(r.URL.Query().Get("order_by"))
	if orderBy == "" {
		orderBy = adminobssvc.OrderByMeanTime
	}
	limit := parseIntDefault(r.URL.Query().Get("limit"), 25)
	rows, err := h.svc.SlowQueries(r.Context(), orderBy, limit)
	if h.handleNotConfigured(w, err, "slow_queries") {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusBadRequest, "SLOW_QUERIES_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{
		"order_by":     orderBy,
		"slow_queries": rows,
	})
}

// VehicleCost returns per-vehicle ingest cost + DLQ failures.
func (h *AdminObservabilityHandler) VehicleCost(w http.ResponseWriter, r *http.Request) {
	limit := parseIntDefault(r.URL.Query().Get("limit"), 100)
	var since time.Time
	if v := r.URL.Query().Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			since = t
		}
	}
	rep, err := h.svc.VehicleCost(r.Context(), since, limit)
	if h.handleNotConfigured(w, err, "vehicle_cost") {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "VEHICLE_COST_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, rep)
}

// DiskForecast returns per-hypertable disk + days-to-quota.
func (h *AdminObservabilityHandler) DiskForecast(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.DiskForecast(r.Context())
	if h.handleNotConfigured(w, err, "disk_forecast") {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "DISK_FORECAST_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{
		"hypertables": rows,
	})
}

// SecretRotation returns the per-(kind, target_id) rotation status.
func (h *AdminObservabilityHandler) SecretRotation(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.SecretRotation(r.Context())
	if h.handleNotConfigured(w, err, "secret_rotation") {
		return
	}
	if err != nil {
		httputil.RespondError(w, http.StatusInternalServerError, "SECRET_ROTATION_FAILED", err.Error())
		return
	}
	httputil.Respond(w, http.StatusOK, map[string]any{
		"items": rows,
	})
}

// handleNotConfigured writes 503 when err signals a missing subsystem.
// Returns true when the response has been written, false when the
// caller should continue with normal error handling.
func (h *AdminObservabilityHandler) handleNotConfigured(w http.ResponseWriter, err error, subsystem string) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, adminobssvc.ErrNotConfigured) {
		httputil.RespondError(w, http.StatusServiceUnavailable, "SUBSYSTEM_NOT_CONFIGURED",
			subsystem+" subsystem not configured on this deployment")
		return true
	}
	return false
}

func parseIntDefault(s string, dflt int) int {
	if s == "" {
		return dflt
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return dflt
	}
	return n
}
