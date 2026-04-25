package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TirePressureHandler serves tire pressure snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type TirePressureHandler struct {
	db *database.DB
}

func NewTirePressureHandler(db *database.DB) *TirePressureHandler {
	return &TirePressureHandler{db: db}
}

func (h *TirePressureHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *TirePressureHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
