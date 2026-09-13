package tco

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// LedgerHandler serves fixed-cost ledger CRUD. Kept separate from Handler
// so the pinned TCO summary contract is untouched.
type LedgerHandler struct {
	store LedgerStore
	now   func() time.Time
}

// NewLedgerHandler wires the handler. Panics on nil (fail-fast wiring).
func NewLedgerHandler(store LedgerStore) *LedgerHandler {
	if store == nil {
		panic("tco: nil ledger store")
	}
	return &LedgerHandler{store: store, now: time.Now}
}

// List serves GET /analytics/tco/ledger?vehicle_id=.
func (h *LedgerHandler) List(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	entries, err := h.store.List(r.Context(), vehicleID)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Msg("tco.ledger: list failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list ledger entries")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"vehicle_id": vehicleID,
		"entries":    entries,
		"totals":     SummarizeLedger(entries),
	})
}

type createLedgerRequest struct {
	VehicleID int64   `json:"vehicle_id"`
	Category  string  `json:"category"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Incurred  string  `json:"incurred_on"`
	Note      string  `json:"note"`
}

// Create serves POST /analytics/tco/ledger.
func (h *LedgerHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createLedgerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Currency == "" {
		req.Currency = "USD"
	}
	e := LedgerEntry{
		VehicleID: req.VehicleID,
		Category:  req.Category,
		Amount:    req.Amount,
		Currency:  req.Currency,
		Incurred:  req.Incurred,
		Note:      req.Note,
	}
	if err := ValidateLedgerEntry(e, h.now()); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.store.Create(r.Context(), &e); err != nil {
		log.Error().Err(err).Int64("vehicle_id", e.VehicleID).Msg("tco.ledger: create failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save ledger entry")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, &e)
}

// Delete serves DELETE /analytics/tco/ledger/{id}?vehicle_id=.
func (h *LedgerHandler) Delete(w http.ResponseWriter, r *http.Request) {
	vehicleID, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "id must be a positive integer")
		return
	}
	found, err := h.store.Delete(r.Context(), vehicleID, id)
	if err != nil {
		log.Error().Err(err).Int64("vehicle_id", vehicleID).Int64("id", id).Msg("tco.ledger: delete failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete ledger entry")
		return
	}
	if !found {
		httpx.WriteError(w, http.StatusNotFound, "ledger entry not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
