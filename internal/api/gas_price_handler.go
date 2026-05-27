package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/worker"
	"github.com/rs/zerolog/log"
)

// GasPriceHandler handles gas price auto-poll management endpoints.
type GasPriceHandler struct {
	db     *database.DB
	worker *worker.GasPriceWorker
}

// NewGasPriceHandler creates a new GasPriceHandler.
func NewGasPriceHandler(db *database.DB, w *worker.GasPriceWorker) *GasPriceHandler {
	return &GasPriceHandler{db: db, worker: w}
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
func (h *GasPriceHandler) Status(w http.ResponseWriter, r *http.Request) {
	status := h.worker.Status()
	writeJSON(w, http.StatusOK, status)
}

// Poll triggers an immediate gas price poll.
// POST /api/v1/gas-price/poll
func (h *GasPriceHandler) Poll(w http.ResponseWriter, r *http.Request) {
	go h.worker.Poll(r.Context())
	log.Info().Msg("gas price manual poll triggered")
	writeJSON(w, http.StatusOK, map[string]string{"status": "poll_triggered"})
}

// Toggle starts or stops auto-polling at runtime.
// POST /api/v1/gas-price/toggle
func (h *GasPriceHandler) Toggle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Enabled {
		h.worker.Resume()
	} else {
		h.worker.Stop()
	}

	// Persist the toggle state
	h.persistToggle(r, body.Enabled)

	log.Info().Bool("enabled", body.Enabled).Msg("gas price auto-poll toggled")
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": body.Enabled})
}

// UpdateConfig updates the poll interval.
// PUT /api/v1/gas-price/config
func (h *GasPriceHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PollInterval string `json:"poll_interval"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	valid := map[string]bool{"daily": true, "7d": true, "15d": true, "30d": true}
	if !valid[body.PollInterval] {
		writeError(w, http.StatusBadRequest, "poll_interval must be one of: daily, 7d, 15d, 30d")
		return
	}

	h.worker.SetPollInterval(body.PollInterval)

	// Persist interval change
	_, err := h.db.Pool.Exec(r.Context(), `
		INSERT INTO gas_price_poll_state (id, poll_interval)
		VALUES (1, $1)
		ON CONFLICT (id) DO UPDATE SET poll_interval = EXCLUDED.poll_interval
	`, body.PollInterval)
	if err != nil {
		log.Warn().Err(err).Msg("gas price: failed to persist interval change")
	}

	log.Info().Str("poll_interval", body.PollInterval).Msg("gas price poll interval updated")
	writeJSON(w, http.StatusOK, map[string]string{"poll_interval": body.PollInterval})
}

// History returns gas_price_history records.
// GET /api/v1/gas-price/history
func (h *GasPriceHandler) History(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)

	rows, err := h.db.Pool.Query(r.Context(),
		`SELECT id, price_per_unit, unit, efficiency_mpg, effective_from, effective_to, created_at
		 FROM gas_price_history
		 ORDER BY effective_from DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to query gas price history")
		writeError(w, http.StatusInternalServerError, "failed to query gas price history")
		return
	}
	defer rows.Close()

	var history []gasPriceHistoryRow
	for rows.Next() {
		var row gasPriceHistoryRow
		if err := rows.Scan(&row.ID, &row.PricePerUnit, &row.Unit, &row.EfficiencyMPG,
			&row.EffectiveFrom, &row.EffectiveTo, &row.CreatedAt); err != nil {
			log.Error().Err(err).Msg("failed to scan gas price history row")
			writeError(w, http.StatusInternalServerError, "failed to read gas price history")
			return
		}
		history = append(history, row)
	}

	if history == nil {
		history = []gasPriceHistoryRow{}
	}

	writeJSON(w, http.StatusOK, history)
}

// persistToggle saves the enabled state to the database.
func (h *GasPriceHandler) persistToggle(r *http.Request, enabled bool) {
	_, err := h.db.Pool.Exec(r.Context(), `
		INSERT INTO gas_price_poll_state (id, enabled)
		VALUES (1, $1)
		ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled
	`, enabled)
	if err != nil {
		log.Warn().Err(err).Msg("gas price: failed to persist toggle state")
	}
}
