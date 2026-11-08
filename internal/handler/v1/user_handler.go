package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type UserHandler struct {
	headerName string
}

func NewUserHandler(headerName string) *UserHandler {
	return &UserHandler{headerName: headerName}
}

func (h *UserHandler) Register(r chi.Router) {
	r.Get("/users/me", h.GetCurrentUser)
	r.Put("/users/me", h.UpdateCurrentUser)
}

func (h *UserHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "user.current")
	defer span.End()
	r = r.WithContext(ctx)
	subject, ok := tsauth.RequestSubject(r, h.headerName)
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	httputil.Respond(w, http.StatusOK, map[string]string{
		"id": subject,
	})
}

func (h *UserHandler) UpdateCurrentUser(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "user.update")
	defer span.End()
	r = r.WithContext(ctx)
	_, ok := tsauth.RequestSubject(r, h.headerName)
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	httputil.RespondError(w, http.StatusNotImplemented, "PROFILE_PROVIDER_MANAGED", "manage identity attributes in your authentication provider; application preferences use their own settings endpoints")
}
