package telemetry

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"
)

// ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Raw Telemetry Capture API ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç

// CaptureList returns captured raw telemetry signals, paginated.
// Query params: ?vin=, ?limit=, ?offset=
func (h *Handler) CaptureList(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	vin := r.URL.Query().Get("vin")
	limit := int64(50)
	offset := int64(0)
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			offset = n
		}
	}

	var (
		results []*telemetrymodel.RawTelemetrySignal
		err     error
	)
	if vin != "" {
		results, err = h.rawTelemetryRepo.GetByVIN(r.Context(), vin, limit, offset)
	} else {
		results, err = h.rawTelemetryRepo.GetAll(r.Context(), limit, offset)
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query captured signals")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, results)
}

// CaptureStats returns aggregate statistics about captured signals.
func (h *Handler) CaptureStats(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
			"mongodb_enabled": false,
			"capture_enabled": h.captureEnabled.Load(),
			"total_documents": 0,
			"distinct_vins":   []string{},
		})
		return
	}

	stats, err := h.rawTelemetryRepo.Stats(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get capture stats")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"mongodb_enabled": true,
		"capture_enabled": h.captureEnabled.Load(),
		"total_documents": stats.TotalDocuments,
		"distinct_vins":   stats.DistinctVINs,
	})
}

// CaptureDrop deletes all captured telemetry data.
func (h *Handler) CaptureDrop(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	if err := h.rawTelemetryRepo.Drop(r.Context()); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to drop captured signals")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "dropped"})
}

// CaptureExport streams all captured signals as a JSONL download.
func (h *Handler) CaptureExport(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	cursor, err := h.rawTelemetryRepo.StreamAll(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "failed to export captured signals")
		return
	}
	defer cursor.Close(r.Context())

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", "attachment; filename=telemetry-capture.jsonl")

	enc := json.NewEncoder(w)
	for cursor.Next(r.Context()) {
		var doc telemetrymodel.RawTelemetrySignal
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		enc.Encode(doc)
	}
}
