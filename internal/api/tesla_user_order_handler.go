package api

import (
	"encoding/json"
	"net/http"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// TeslaUserOrderHandler serves Tesla user order data.
type TeslaUserOrderHandler struct {
	teslaClient *tesla.Client
	orderRepo   *database.TeslaUserOrderRepo
}

// NewTeslaUserOrderHandler creates a new handler.
func NewTeslaUserOrderHandler(tc *tesla.Client, db *database.DB) *TeslaUserOrderHandler {
	return &TeslaUserOrderHandler{
		teslaClient: tc,
		orderRepo:   database.NewTeslaUserOrderRepo(db),
	}
}

// ordersEnvelope wraps the order list with sync metadata for the frontend.
type ordersEnvelope struct {
	Orders    []*teslamodel.TeslaUserOrder `json:"orders"`
	FetchedAt *string                      `json:"fetched_at"`
}

// Orders returns stored orders from DB with sync metadata.
// GET /api/v1/tesla/user/orders
func (h *TeslaUserOrderHandler) Orders(w http.ResponseWriter, r *http.Request) {
	orders, err := h.orderRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to fetch tesla user orders")
		writeError(w, http.StatusInternalServerError, "failed to fetch orders")
		return
	}

	env := ordersEnvelope{
		Orders: orders,
	}
	if env.Orders == nil {
		env.Orders = []*teslamodel.TeslaUserOrder{}
	}
	if len(orders) > 0 {
		ts := orders[0].FetchedAt.UTC().Format(time.RFC3339)
		env.FetchedAt = &ts
	}
	writeJSON(w, http.StatusOK, env)
}

// RefreshOrders fetches from Tesla API and replaces DB rows.
// POST /api/v1/tesla/user/orders/refresh
func (h *TeslaUserOrderHandler) RefreshOrders(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		writeError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing tesla user orders")

	body, status, err := h.teslaClient.GetUserOrders(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla user orders API error")
		writeError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Msg("tesla user orders non-2xx")
		writeError(w, http.StatusBadGateway, "Tesla API returned non-success status")
		return
	}

	// Parse Tesla envelope → array of orders
	var envelope struct {
		Response []json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse tesla orders response")
		writeError(w, http.StatusInternalServerError, "failed to parse Tesla response")
		return
	}

	var orders []*teslamodel.TeslaUserOrder
	for _, raw := range envelope.Response {
		var o struct {
			OrderID      string  `json:"order_id"`
			Model        string  `json:"model"`
			Status       string  `json:"status"`
			DeliveryDate *string `json:"delivery_date"`
			VIN          *string `json:"vin"`
			ReferralCode *string `json:"referral_code"`
			IsUpgradable bool    `json:"is_upgradable"`
		}
		if err := json.Unmarshal(raw, &o); err != nil {
			log.Warn().Err(err).Msg("skipping malformed order entry")
			continue
		}
		order := &teslamodel.TeslaUserOrder{
			OrderID:      o.OrderID,
			Model:        o.Model,
			Status:       o.Status,
			VIN:          o.VIN,
			ReferralCode: o.ReferralCode,
			IsUpgradable: o.IsUpgradable,
		}
		if o.DeliveryDate != nil && *o.DeliveryDate != "" {
			if t, err := time.Parse("2006-01-02", *o.DeliveryDate); err == nil {
				order.DeliveryDate = &t
			}
		}
		orders = append(orders, order)
	}

	if err := h.orderRepo.ReplaceAll(r.Context(), orders); err != nil {
		log.Error().Err(err).Msg("failed to save tesla user orders")
		writeError(w, http.StatusInternalServerError, "failed to save orders")
		return
	}

	// Return the freshly saved data via the standard read path
	h.Orders(w, r)
}
