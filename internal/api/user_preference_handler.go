package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// UserPreferenceHandler serves user preference snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type UserPreferenceHandler struct {
	db *database.DB
}

func NewUserPreferenceHandler(db *database.DB) *UserPreferenceHandler {
	return &UserPreferenceHandler{db: db}
}

func (h *UserPreferenceHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *UserPreferenceHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
