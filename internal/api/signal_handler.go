package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SignalHandler provides API endpoints for querying signal history from MongoDB.
type SignalHandler struct {
	signalLogRepo *database.SignalLogRepo
}

// NewSignalHandler creates a new SignalHandler.
func NewSignalHandler(repo *database.SignalLogRepo) *SignalHandler {
	return &SignalHandler{signalLogRepo: repo}
}

// History returns signal history for a vehicle and signal name.
// GET /api/v1/signals/{vehicleID}/{signalName}/history?from=...&to=...&limit=...
func (h *SignalHandler) History(w http.ResponseWriter, r *http.Request) {
	if h.signalLogRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "signal log not configured (MongoDB required)"})
		return
	}

	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	signalName := chi.URLParam(r, "signalName")
	if signalName == "" {
		writeError(w, http.StatusBadRequest, "signal name required")
		return
	}

	// Parse time range (defaults to last 24 hours)
	to := time.Now().UTC()
	from := to.Add(-24 * time.Hour)

	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = t
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = t
		}
	}

	limit := int64(1000)
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if l, err := strconv.ParseInt(limitStr, 10, 64); err == nil && l > 0 {
			limit = l
		}
	}

	points, err := h.signalLogRepo.GetHistory(r.Context(), database.SignalHistoryQuery{
		VehicleID: vehicleID,
		Signal:    signalName,
		From:      from,
		To:        to,
		Limit:     limit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query signal history")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"signal":     signalName,
		"from":       from,
		"to":         to,
		"count":      len(points),
		"data":       points,
	})
}

// AvailableSignals returns the list of signal names with data for a vehicle.
// GET /api/v1/signals/{vehicleID}/available
func (h *SignalHandler) AvailableSignals(w http.ResponseWriter, r *http.Request) {
	if h.signalLogRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "signal log not configured"})
		return
	}

	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	signals, err := h.signalLogRepo.GetAvailableSignals(r.Context(), vehicleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query available signals")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      len(signals),
		"signals":    signals,
	})
}

// Stats returns signal log statistics for a vehicle.
// GET /api/v1/signals/{vehicleID}/stats
func (h *SignalHandler) Stats(w http.ResponseWriter, r *http.Request) {
	if h.signalLogRepo == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "signal log not configured"})
		return
	}

	vehicleID, err := strconv.ParseInt(chi.URLParam(r, "vehicleID"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid vehicle ID")
		return
	}

	count, oldest, newest, err := h.signalLogRepo.GetStats(r.Context(), vehicleID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query stats")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"vehicle_id": vehicleID,
		"count":      count,
		"oldest":     oldest,
		"newest":     newest,
	})
}

// LiveState returns the current in-memory signal state for a vehicle.
// GET /api/v1/signals/{vehicleID}/live
func (h *SignalHandler) LiveState(w http.ResponseWriter, r *http.Request) {
	// This will be set by the router when wiring — uses the telemetry handler's signal store
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "live state requires signal store"})
}
