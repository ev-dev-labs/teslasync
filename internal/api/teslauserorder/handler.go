package teslauserorder

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"

	"github.com/rs/zerolog/log"
)

// Handler serves stored Tesla account order data and refreshes it from Tesla.
type Handler struct {
	teslaClient *tesla.Client
	orderRepo   *tesladb.TeslaUserOrderRepo
}

// NewHandler wires Tesla order refresh dependencies.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		orderRepo:   tesladb.NewTeslaUserOrderRepo(db),
	}
}

// ordersEnvelope wraps the order list with sync metadata for the frontend.
type ordersEnvelope struct {
	Orders    []*teslamodel.TeslaUserOrder `json:"orders"`
	FetchedAt *string                      `json:"fetched_at"`
}

// Orders returns stored orders from DB with sync metadata.
// GET /api/v1/tesla/user/orders
func (h *Handler) Orders(w http.ResponseWriter, r *http.Request) {
	orders, err := h.orderRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to fetch tesla user orders")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to fetch orders")
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
	httpx.WriteJSON(w, http.StatusOK, env)
}

// RefreshOrders fetches from Tesla API and replaces DB rows.
// POST /api/v1/tesla/user/orders/refresh
func (h *Handler) RefreshOrders(w http.ResponseWriter, r *http.Request) {
	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	log.Info().Msg("refreshing tesla user orders")

	body, status, err := h.teslaClient.GetUserOrders(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("tesla user orders API error")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch from Tesla")
		return
	}
	if status < 200 || status >= 300 {
		log.Error().Int("status", status).Msg("tesla user orders non-2xx")
		httpx.WriteError(w, http.StatusBadGateway, "Tesla API returned non-success status")
		return
	}

	var envelope struct {
		Response []json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		log.Error().Err(err).Msg("failed to parse tesla orders response")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
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
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save orders")
		return
	}

	// Reuse the read path so refresh and list responses stay identical.
	h.Orders(w, r)
}
