package api

import (
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// GeocodeHandler provides forward geocoding (address search).
type GeocodeHandler struct {
	searcher geocoding.Searcher
}

// NewGeocodeHandler creates a GeocodeHandler with the given forward geocoder.
func NewGeocodeHandler(searcher geocoding.Searcher) *GeocodeHandler {
	return &GeocodeHandler{searcher: searcher}
}

// Search handles GET /geocode/search?q=...&limit=5
func (h *GeocodeHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, []geocoding.SearchResult{})
		return
	}

	limit := 5
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 10 {
		limit = l
	}

	results, err := h.searcher.Search(r.Context(), q, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "geocode search failed")
		return
	}
	if results == nil {
		results = []geocoding.SearchResult{}
	}

	writeJSON(w, http.StatusOK, results)
}
