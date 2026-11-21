package smartcommute

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
)

func (h *Handler) SendNavigation(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_commute.send_navigation")
	defer span.End()
	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	if auth.IsOpenMode(h.headerName) || r.Header.Get(auth.ExpectedPrincipalHeader) == "" {
		httputil.RespondError(w, http.StatusForbidden, "NAVIGATION_IDENTITY_REQUIRED", "Navigation requires a verified operator")
		return
	}
	routineID, err := positiveID(chi.URLParam(r, "routineID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	request, err := decode[domain.NavigationRequest](w, r)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	result, err := h.service.SendNavigation(ctx, subject, routineID, request)
	if errors.Is(err, smartcommutesvc.ErrNavigationUnavailable) {
		httputil.RespondError(w, http.StatusConflict, "NAVIGATION_UNAVAILABLE", "The Tesla command connection is unavailable")
		return
	}
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, result)
}
