package geocode

import (
	"context"
	"net/http"
	"strconv"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
)

const (
	// defaultSearchLimit is used when ?limit= is missing, non-numeric, or
	// outside the accepted range.
	defaultSearchLimit = 5
	// maxSearchLimit bounds ?limit= so a single request can never ask an
	// upstream provider for an unbounded result set.
	maxSearchLimit = 10
)

// Handler provides forward and reverse geocoding.
type Handler struct {
	searcher geocoding.Searcher
	geocoder geocoding.Geocoder
}

// NewHandler creates a Handler with forward search and optional reverse geocoder.
func NewHandler(searcher geocoding.Searcher, geocoder geocoding.Geocoder) *Handler {
	return &Handler{searcher: searcher, geocoder: geocoder}
}

// Search handles GET /geocode/search?q=...&limit=5
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		httpx.WriteJSON(w, http.StatusOK, []geocoding.SearchResult{})
		return
	}

	limit := parseSearchLimit(r.URL.Query().Get("limit"))

	// Bound the upstream provider call so a slow or hung provider can never
	// hold the request goroutine open indefinitely (policy: geocoding = 10s).
	ctx, cancel := context.WithTimeout(r.Context(), config.HTTPClientTimeout)
	defer cancel()

	results, err := h.searcher.Search(ctx, q, limit)
	if err != nil {
		log.Error().Err(err).
			Str("op", "geocode.search").
			Int("limit", limit).
			Msg("geocode: forward search failed")
		httpx.WriteError(w, http.StatusInternalServerError, "geocode search failed")
		return
	}
	if results == nil {
		results = []geocoding.SearchResult{}
	}

	httpx.WriteJSON(w, http.StatusOK, results)
}

// Reverse handles GET /geocode/reverse?lat=X&lon=Y
func (h *Handler) Reverse(w http.ResponseWriter, r *http.Request) {
	lat, latErr := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, lonErr := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if latErr != nil || lonErr != nil {
		log.Debug().
			Str("op", "geocode.reverse").
			Str("lat", r.URL.Query().Get("lat")).
			Str("lon", r.URL.Query().Get("lon")).
			Msg("geocode: reverse rejected invalid coordinates")
		httpx.WriteError(w, http.StatusBadRequest, "lat and lon query parameters are required")
		return
	}

	// Bound the upstream provider call (policy: geocoding = 10s).
	ctx, cancel := context.WithTimeout(r.Context(), config.HTTPClientTimeout)
	defer cancel()

	result, err := h.geocoder.ReverseGeocode(ctx, lat, lon)
	if err != nil {
		log.Error().Err(err).
			Str("op", "geocode.reverse").
			Float64("lat", lat).
			Float64("lon", lon).
			Msg("geocode: reverse lookup failed")
		httpx.WriteError(w, http.StatusInternalServerError, "reverse geocode failed")
		return
	}
	// A provider that reports success but yields no result is a contract
	// violation. Guard it here so ShortName() (and the field reads below)
	// can never dereference a nil *GeoResult.
	if result == nil {
		log.Warn().
			Str("op", "geocode.reverse").
			Float64("lat", lat).
			Float64("lon", lon).
			Msg("geocode: reverse lookup returned no result")
		httpx.WriteError(w, http.StatusInternalServerError, "reverse geocode failed")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"display_name": result.ShortName(),
		"road":         result.Road,
		"city":         result.City,
		"state":        result.State,
		"country":      result.Country,
		"postcode":     result.PostCode,
	})
}

// parseSearchLimit clamps the raw ?limit= query value to the accepted 1–10
// range, falling back to defaultSearchLimit for missing, non-numeric, or
// out-of-range input. It mirrors the defensive clamp the Nominatim searcher
// applies so the handler never forwards a non-positive or unbounded limit
// upstream.
func parseSearchLimit(raw string) int {
	if l, err := strconv.Atoi(raw); err == nil && l > 0 && l <= maxSearchLimit {
		return l
	}
	return defaultSearchLimit
}
