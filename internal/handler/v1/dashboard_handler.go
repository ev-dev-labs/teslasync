package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// DashboardHandler handles dashboard HTTP endpoints.
type DashboardHandler struct {
	svc *dashboardsvc.Service
}

// NewDashboardHandler creates a new dashboard handler.
func NewDashboardHandler(svc *dashboardsvc.Service) *DashboardHandler {
	return &DashboardHandler{svc: svc}
}

// Register registers dashboard routes on the given router.
func (h *DashboardHandler) Register(r chi.Router) {
	r.Get("/dashboard/stats", h.GetStats)
}

// GetStats returns aggregated dashboard statistics.
//
// Open-mode tolerance: TeslaSync supports a provider-agnostic ForwardAuth
// model where AUTH_ENABLED defaults to false and no JWT middleware runs.
// In that mode the request never has a *UserClaims in its context, so we
// fall back to the empty-string subject — the documented open-mode scope
// key already used by other endpoints (notification_quiet_hours.user_id,
// auth_session_handler, etc.). This matches the rest of the platform and
// keeps single-user installs working without any auth provider configured.
func (h *DashboardHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	var userID string
	if claims, ok := middleware.UserFromContext(r.Context()); ok {
		userID = claims.UserID
	}

	stats, err := h.svc.GetStats(r.Context(), userID)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, stats)
}
