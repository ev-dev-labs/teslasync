package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/dashboardsvc"
	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
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

// GetStats reads the same shared fleet as /vehicles. The composition root
// mounts both behind ForwardAuth, including its explicit configured dev mode.
func (h *DashboardHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.dashboard.stats")
	defer span.End()

	stats, err := h.svc.GetStats(ctx)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("failed to read dashboard fleet statistics")
		middleware.HandleError(w, err)
		return
	}

	httputil.Respond(w, http.StatusOK, stats)
}
