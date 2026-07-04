package gasprice

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/worker"
	"github.com/rs/zerolog/log"
)

// dbOpTimeout bounds each request-triggered database round-trip so a stalled
// pool can never pin a request goroutine open indefinitely when the client
// does not cancel. It derives from the inbound request context, so caller
// cancellation still wins when it fires first.
const dbOpTimeout = 10 * time.Second

// pollTimeout bounds a manually triggered background poll. The poll is run
// detached from the request lifecycle (see Poll) so it needs its own upper
// bound to guarantee the goroutine — and any provider fetch or DB write it
// performs — cannot leak indefinitely.
const pollTimeout = 2 * time.Minute

// gasPoller is the narrow slice of *worker.GasPriceWorker that the handler
// drives. Depending on the interface rather than the concrete worker keeps the
// handler unit-testable without spinning up a live polling loop, price
// provider, or database.
type gasPoller interface {
	Status() worker.GasPriceStatus
	Poll(ctx context.Context)
	Resume()
	Stop()
	SetPollInterval(interval string)
}

var _ gasPoller = (*worker.GasPriceWorker)(nil)

// Handler handles gas price auto-poll management endpoints.
type Handler struct {
	db     database.DBTX
	worker gasPoller
}

// NewHandler creates a new Handler.
//
// A nil db (or a db with a nil pool) is tolerated: History degrades to an
// empty array and the best-effort persistence in Toggle/UpdateConfig is
// skipped, rather than panicking on a nil pool.
func NewHandler(db *database.DB, w *worker.GasPriceWorker) *Handler {
	var q database.DBTX
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return newHandler(q, w)
}

// newHandler is the querier/poller-injecting seam shared by NewHandler and
// tests. Keeping construction here lets tests drive the handler against a fake
// database.DBTX and a fake poller without a live pool or worker.
func newHandler(q database.DBTX, w gasPoller) *Handler {
	return &Handler{db: q, worker: w}
}

// gasPriceHistoryRow represents a row from gas_price_history.
type gasPriceHistoryRow struct {
	ID            int64      `json:"id"`
	PricePerUnit  float64    `json:"price_per_unit"`
	Unit          string     `json:"unit"`
	EfficiencyMPG float64    `json:"efficiency_mpg"`
	EffectiveFrom time.Time  `json:"effective_from"`
	EffectiveTo   *time.Time `json:"effective_to"`
	CreatedAt     time.Time  `json:"created_at"`
}

// Status returns the current gas price poll status.
// GET /api/v1/gas-price/status
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	status := h.worker.Status()
	httpx.WriteJSON(w, http.StatusOK, status)
}

// Poll triggers an immediate gas price poll.
// POST /api/v1/gas-price/poll
func (h *Handler) Poll(w http.ResponseWriter, r *http.Request) {
	// Detach from the request context before polling in the background: net/http
	// cancels r.Context() the moment this handler returns, which would abort the
	// fire-and-forget poll before its provider fetch and DB writes complete.
	// WithoutCancel preserves request-scoped values (e.g. the trace/span) while
	// dropping the cancellation, and WithTimeout bounds the detached poll so the
	// goroutine can never leak.
	go func(parent context.Context) {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), pollTimeout)
		defer cancel()
		h.worker.Poll(ctx)
	}(r.Context())

	log.Info().Msg("gas price manual poll triggered")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "poll_triggered"})
}

// Toggle starts or stops auto-polling at runtime.
// POST /api/v1/gas-price/toggle
func (h *Handler) Toggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Enabled {
		h.worker.Resume()
	} else {
		h.worker.Stop()
	}

	// Persist the toggle state
	h.persistToggle(r.Context(), body.Enabled)

	log.Info().Bool("enabled", body.Enabled).Msg("gas price auto-poll toggled")
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"enabled": body.Enabled})
}

// UpdateConfig updates the poll interval.
// PUT /api/v1/gas-price/config
func (h *Handler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PollInterval string `json:"poll_interval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	valid := map[string]bool{"daily": true, "7d": true, "15d": true, "30d": true}
	if !valid[body.PollInterval] {
		httpx.WriteError(w, http.StatusBadRequest, "poll_interval must be one of: daily, 7d, 15d, 30d")
		return
	}

	h.worker.SetPollInterval(body.PollInterval)

	// Persist interval change (best-effort — the runtime worker is already
	// updated, so a persistence failure only affects restart recovery).
	if h.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
		defer cancel()
		if _, err := h.db.Exec(ctx, `
			INSERT INTO gas_price_poll_state (id, poll_interval)
			VALUES (1, $1)
			ON CONFLICT (id) DO UPDATE SET poll_interval = EXCLUDED.poll_interval
		`, body.PollInterval); err != nil {
			log.Warn().Err(err).Str("poll_interval", body.PollInterval).
				Msg("gas price: failed to persist interval change")
		}
	}

	log.Info().Str("poll_interval", body.PollInterval).Msg("gas price poll interval updated")
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"poll_interval": body.PollInterval})
}

// History returns gas_price_history records.
// GET /api/v1/gas-price/history
func (h *Handler) History(w http.ResponseWriter, r *http.Request) {
	limit, offset := apiparams.Pagination(r)

	// A nil querier (unconfigured pool) degrades to an empty array rather than
	// panicking, mirroring the nil-tolerant contract documented on NewHandler.
	if h.db == nil {
		httpx.WriteJSON(w, http.StatusOK, []gasPriceHistoryRow{})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), dbOpTimeout)
	defer cancel()

	rows, err := h.db.Query(ctx,
		`SELECT id, price_per_unit, unit, efficiency_mpg, effective_from, effective_to, created_at
		 FROM gas_price_history
		 ORDER BY effective_from DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		log.Error().Err(err).Int("limit", limit).Int("offset", offset).
			Msg("gas price: failed to query history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to query gas price history")
		return
	}
	defer rows.Close()

	history := make([]gasPriceHistoryRow, 0, limit)
	for rows.Next() {
		var row gasPriceHistoryRow
		if err := rows.Scan(&row.ID, &row.PricePerUnit, &row.Unit, &row.EfficiencyMPG,
			&row.EffectiveFrom, &row.EffectiveTo, &row.CreatedAt); err != nil {
			log.Error().Err(err).Msg("gas price: failed to scan history row")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to read gas price history")
			return
		}
		history = append(history, row)
	}
	// rows.Next returning false can signal a mid-iteration error (e.g. a dropped
	// connection); surface it instead of silently returning a truncated page.
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("gas price: history row iteration failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to read gas price history")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, history)
}

// persistToggle saves the enabled state to the database. Persistence is
// best-effort: the runtime worker has already been toggled, so a failure here
// only affects restart recovery and must not fail the request.
func (h *Handler) persistToggle(ctx context.Context, enabled bool) {
	if h.db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, dbOpTimeout)
	defer cancel()
	if _, err := h.db.Exec(ctx, `
		INSERT INTO gas_price_poll_state (id, enabled)
		VALUES (1, $1)
		ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled
	`, enabled); err != nil {
		log.Warn().Err(err).Bool("enabled", enabled).
			Msg("gas price: failed to persist toggle state")
	}
}
