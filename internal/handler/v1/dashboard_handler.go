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
func (h *DashboardHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	stats, err := h.svc.GetStats(r.Context(), claims.UserID)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, stats)
}
