package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/embedding"
)

// EmbeddingHandler exposes endpoints for generating embeddings and running
// semantic search against the pgvector-backed `embeddings` table.
type EmbeddingHandler struct {
	svc *embedding.Service
}

// NewEmbeddingHandler constructs a handler. svc may be nil when the feature
// is disabled; in that case every endpoint returns 503.
func NewEmbeddingHandler(svc *embedding.Service) *EmbeddingHandler {
	return &EmbeddingHandler{svc: svc}
}

func (h *EmbeddingHandler) enabled(w http.ResponseWriter) bool {
	if h == nil || h.svc == nil || !h.svc.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "embeddings disabled — set EMBEDDING_ENABLED=true and configure EMBEDDING_API_KEY")
		return false
	}
	return true
}

// Generate runs a one-shot batch embedding job. It's intended for ops/backfill
// usage; the background worker normally keeps embeddings up to date.
//
// POST /api/v1/embeddings/generate  body: {"limit": 50}
func (h *EmbeddingHandler) Generate(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	var req struct {
		Limit int `json:"limit"`
	}
	if r.Body != nil && r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	if req.Limit <= 0 {
		req.Limit = 50
	}
	if req.Limit > 500 {
		req.Limit = 500
	}

	n, err := h.svc.RunBatch(r.Context(), req.Limit)
	if err != nil {
		log.Error().Err(err).Msg("embeddings batch failed")
		writeError(w, http.StatusInternalServerError, "embedding batch failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"embedded": n,
		"limit":    req.Limit,
	})
}

// Search performs semantic similarity search.
//
// GET /api/v1/search?q=...&vehicle_id=1&limit=10
func (h *EmbeddingHandler) Search(w http.ResponseWriter, r *http.Request) {
	if !h.enabled(w) {
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		writeError(w, http.StatusBadRequest, "q is required")
		return
	}
	vehicleID, _ := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 10
	}

	results, err := h.svc.Search(r.Context(), q, vehicleID, limit)
	if err != nil {
		log.Error().Err(err).Str("q", q).Msg("semantic search failed")
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}
	if results == nil {
		results = []embedding.SearchResult{}
	}
	writeJSON(w, http.StatusOK, results)
}
