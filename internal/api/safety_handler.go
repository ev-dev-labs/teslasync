package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SafetyHandler serves safety snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type SafetyHandler struct {
	db *database.DB
}

func NewSafetyHandler(db *database.DB) *SafetyHandler {
	return &SafetyHandler{db: db}
}

func (h *SafetyHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *SafetyHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
