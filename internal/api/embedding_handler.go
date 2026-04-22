package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/embedding"
)

// EmbeddingHandler exposes pgvector semantic-search endpoints.
//
// The handler is intentionally a thin wrapper around embedding.Service so
// that the LLM-backed chatbot path can call the same Search() helper
// directly. When the service is disabled (EMBEDDING_ENABLED=false), every
// route returns 503 with a clear "disabled" message.
type EmbeddingHandler struct {
	svc *embedding.Service
}

// NewEmbeddingHandler constructs the handler. svc may be nil (treated as
// disabled).
func NewEmbeddingHandler(svc *embedding.Service) *EmbeddingHandler {
	return &EmbeddingHandler{svc: svc}
}

func (h *EmbeddingHandler) enabled(w http.ResponseWriter) bool {
	if h.svc == nil || !h.svc.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "embedding service is disabled")
		return false
	}
	return true
}

// Search handles GET /api/v1/search?q=...&vehicle_id=&type=&limit=
func (h *EmbeddingHandler) Search(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}
	opts := embedding.SearchOptions{}
	if v := r.URL.Query().Get("vehicle_id"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			opts.VehicleID = id
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			opts.Limit = n
		}
	}
	if v := r.URL.Query().Get("type"); v != "" {
		opts.EntityTypes = strings.Split(v, ",")
	}

	results, err := h.svc.Search(r.Context(), q, opts)
	if err != nil {
		if errors.Is(err, embedding.ErrDisabled) {
			writeError(w, http.StatusServiceUnavailable, "embedding service is disabled")
			return
		}
		log.Error().Err(err).Msg("embedding search failed")
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	if results == nil {
		results = []embedding.SearchResult{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"query":   q,
		"results": results,
	})
}

// Generate handles POST /api/v1/embeddings/generate
//
// Body: {"entity_type":"drive|charge|alert","limit":50}
//
// Triggers an immediate backfill pass for the requested entity type
// (subject to the configured batch size). Returns the number of items
// processed. Useful as a manual nudge for ops; the background worker
// performs the same work on its own schedule.
func (h *EmbeddingHandler) Generate(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	var body struct {
		EntityType string `json:"entity_type"`
		Limit      int    `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Limit <= 0 {
		body.Limit = 50
	}

	ctx := r.Context()
	count := 0
	switch body.EntityType {
	case embedding.EntityDrive:
		ids, err := h.svc.FindMissingDrives(ctx, body.Limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		count = len(ids)
	case embedding.EntityCharge:
		ids, err := h.svc.FindMissingCharges(ctx, body.Limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		count = len(ids)
	case embedding.EntityAlert:
		ids, err := h.svc.FindMissingAlerts(ctx, body.Limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		count = len(ids)
	default:
		writeError(w, http.StatusBadRequest, "entity_type must be one of: drive, charge, alert")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"entity_type": body.EntityType,
		"queued":      count,
		"message":     "Background worker will embed these on its next tick.",
	})
}
