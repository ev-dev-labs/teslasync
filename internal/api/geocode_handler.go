package api

import (
	"net/http"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

// GeocodeHandler provides forward and reverse geocoding.
type GeocodeHandler struct {
	searcher geocoding.Searcher
	geocoder geocoding.Geocoder
}

// NewGeocodeHandler creates a GeocodeHandler with forward search and optional reverse geocoder.
func NewGeocodeHandler(searcher geocoding.Searcher, geocoder geocoding.Geocoder) *GeocodeHandler {
	return &GeocodeHandler{searcher: searcher, geocoder: geocoder}
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

// Reverse handles GET /geocode/reverse?lat=X&lon=Y
func (h *GeocodeHandler) Reverse(w http.ResponseWriter, r *http.Request) {
	lat, err := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err != nil || err2 != nil {
		writeError(w, http.StatusBadRequest, "lat and lon query parameters are required")
		return
	}

	result, err := h.geocoder.ReverseGeocode(r.Context(), lat, lon)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "reverse geocode failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"display_name": result.ShortName(),
		"road":         result.Road,
		"city":         result.City,
		"state":        result.State,
		"country":      result.Country,
		"postcode":     result.PostCode,
	})
}
