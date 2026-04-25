package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ClimateHandler serves climate/HVAC snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type ClimateHandler struct {
	db *database.DB
}

func NewClimateHandler(db *database.DB) *ClimateHandler {
	return &ClimateHandler{db: db}
}

func (h *ClimateHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *ClimateHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
