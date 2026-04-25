package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// MotorHandler serves motor/powertrain snapshot endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type MotorHandler struct {
	db *database.DB
}

func NewMotorHandler(db *database.DB) *MotorHandler {
	return &MotorHandler{db: db}
}

func (h *MotorHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *MotorHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
