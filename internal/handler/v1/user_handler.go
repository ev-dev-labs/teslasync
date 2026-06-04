package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type UserHandler struct{}

func NewUserHandler() *UserHandler {
	return &UserHandler{}
}

func (h *UserHandler) Register(r chi.Router) {
	r.Get("/users/me", h.GetCurrentUser)
	r.Put("/users/me", h.UpdateCurrentUser)
}

func (h *UserHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	httputil.Respond(w, http.StatusOK, map[string]string{
		"userId": claims.UserID,
		"email":  claims.Email,
	})
}

func (h *UserHandler) UpdateCurrentUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	_, err := httputil.DecodeAndValidate[updateUserRequest](r)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	// Full user-service persistence is not wired here yet.
	httputil.Respond(w, http.StatusOK, map[string]string{
		"userId": claims.UserID,
		"email":  claims.Email,
	})
}

type updateUserRequest struct {
	DisplayName string `json:"displayName"`
}
