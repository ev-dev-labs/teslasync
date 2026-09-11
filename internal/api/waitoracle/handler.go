package waitoracle

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// HistoryStore is the demand-history port. *Store satisfies it.
type HistoryStore interface {
	ListSites(ctx context.Context, q string, limit int) ([]*Site, error)
	History(ctx context.Context, site string) (SiteHistory, error)
}

// Handler serves the wait oracle. Stateless beyond constructor inputs;
// safe for concurrent use.
type Handler struct {
	store HistoryStore
	now   func() time.Time
}

// NewHandler wires the handler. Panics on nil inputs (fail-fast wiring
// contract, matching sibling handlers).
func NewHandler(store HistoryStore) *Handler {
	if store == nil {
		panic("waitoracle: nil dependency")
	}
	return &Handler{store: store, now: time.Now}
}

// Sites serves GET /waitoracle/sites?q=&limit=: the site directory.
func (h *Handler) Sites(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}
	sites, err := h.store.ListSites(r.Context(), r.URL.Query().Get("q"), limit)
	if err != nil {
		log.Error().Err(err).Msg("waitoracle: sites read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read site directory")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, sites)
}

// Forecast serves GET /waitoracle/forecast?site=&arrive_at=: the wait
// prediction. arrive_at is RFC3339 (any zone); empty means now.
func (h *Handler) Forecast(w http.ResponseWriter, r *http.Request) {
	site := r.URL.Query().Get("site")
	if site == "" {
		httpx.WriteError(w, http.StatusBadRequest, "site must be a non-empty site name")
		return
	}
	arrival := h.now().UTC()
	if s := r.URL.Query().Get("arrive_at"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "arrive_at must be RFC3339")
			return
		}
		arrival = t
	}
	history, err := h.store.History(r.Context(), site)
	if err != nil {
		if errors.Is(err, ErrNoHistory) {
			httpx.WriteError(w, http.StatusNotFound, "site has insufficient charging history for a forecast")
			return
		}
		log.Error().Err(err).Str("site", site).Msg("waitoracle: history read failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read site history")
		return
	}
	f, err := Predict(history, arrival)
	if err != nil {
		if errors.Is(err, ErrNoHistory) {
			httpx.WriteError(w, http.StatusNotFound, "site has insufficient charging history for a forecast")
			return
		}
		log.Error().Err(err).Str("site", site).Msg("waitoracle: forecast failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to compute forecast")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, f)
}

// Compile-time port assertion.
var _ HistoryStore = (*Store)(nil)
