package v1

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/handler/middleware"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// UserHandler handles user HTTP endpoints.
type UserHandler struct{}

// NewUserHandler creates a new user handler.
func NewUserHandler() *UserHandler {
	return &UserHandler{}
}

// Register registers user routes on the given router.
func (h *UserHandler) Register(r chi.Router) {
	r.Get("/users/me", h.GetCurrentUser)
	r.Put("/users/me", h.UpdateCurrentUser)
}

// GetCurrentUser returns the authenticated user's profile.
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

// UpdateCurrentUser updates the authenticated user's profile.
func (h *UserHandler) UpdateCurrentUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.UserFromContext(r.Context())
	if !ok {
		httputil.RespondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing user context")
		return
	}

	// Decode the update request
	_, err := httputil.DecodeAndValidate[updateUserRequest](r)
	if err != nil {
		middleware.HandleError(w, err)
		return
	}

	// For now, return the user as-is (full user service integration in Phase 4 wiring)
	httputil.Respond(w, http.StatusOK, map[string]string{
		"userId": claims.UserID,
		"email":  claims.Email,
	})
}

type updateUserRequest struct {
	DisplayName string `json:"displayName"`
}
