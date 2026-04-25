package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ChargingTelemetryHandler serves charging telemetry endpoints.
// Repo removed in phase-14/12 — returns empty results pending rewire (prompt 14).
type ChargingTelemetryHandler struct {
	db *database.DB
}

func NewChargingTelemetryHandler(db *database.DB) *ChargingTelemetryHandler {
	return &ChargingTelemetryHandler{db: db}
}

func (h *ChargingTelemetryHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []struct{}{})
}

func (h *ChargingTelemetryHandler) Latest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, nil)
}
