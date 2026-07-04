package teslauserorder

import (
	"context"
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

// teslaUserOrderAPI is the consumer-side port for the Tesla Fleet API calls the
// order handler makes. Declaring the narrow interface here (rather than
// depending on the concrete *tesla.Client) keeps the handler unit-testable with
// a fake; the concrete client satisfies it unchanged.
type teslaUserOrderAPI interface {
	GetUserOrders(ctx context.Context) ([]byte, int, error)
	HasValidToken() bool
}

// teslaUserOrderStore is the consumer-side port for the persistence the handler
// needs. *tesladb.TeslaUserOrderRepo satisfies it unchanged.
type teslaUserOrderStore interface {
	GetAll(ctx context.Context) ([]*teslamodel.TeslaUserOrder, error)
	ReplaceAll(ctx context.Context, orders []*teslamodel.TeslaUserOrder) error
}

// Compile-time proof the concrete production dependencies still satisfy the
// ports above, so a signature drift is caught at build time, not runtime.
var (
	_ teslaUserOrderAPI   = (*tesla.Client)(nil)
	_ teslaUserOrderStore = (*tesladb.TeslaUserOrderRepo)(nil)
)

// Handler serves stored Tesla account order data and refreshes it from Tesla.
type Handler struct {
	teslaClient teslaUserOrderAPI
	orderRepo   teslaUserOrderStore
}

// NewHandler wires Tesla order refresh dependencies.
func NewHandler(tc *tesla.Client, db *database.DB) *Handler {
	return &Handler{
		teslaClient: tc,
		orderRepo:   tesladb.NewTeslaUserOrderRepo(db),
	}
}

// newHandler builds a handler from explicit ports. Tests use it to inject
// fakes; production code uses NewHandler.
func newHandler(api teslaUserOrderAPI, store teslaUserOrderStore) *Handler {
	return &Handler{teslaClient: api, orderRepo: store}
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
	// orders is sorted updated_at DESC by the repo, so the first row carries
	// the most recent sync timestamp. Guard against a nil element so a future
	// repo change can never turn this metadata read into a nil-deref panic.
	if len(orders) > 0 && orders[0] != nil {
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

	orders := parseUserOrders(envelope.Response)

	if err := h.orderRepo.ReplaceAll(r.Context(), orders); err != nil {
		log.Error().Err(err).Msg("failed to save tesla user orders")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save orders")
		return
	}

	log.Info().Int("orders", len(orders)).Msg("tesla user orders refreshed")

	// Reuse the read path so refresh and list responses stay identical.
	h.Orders(w, r)
}

// parseUserOrders converts the raw Tesla `response` array into order models.
// Entries that fail to unmarshal are logged and skipped so a single malformed
// row cannot fail the whole sync. Delivery dates use Tesla's date-only
// ("2006-01-02") wire format; an empty or unparseable date leaves
// DeliveryDate nil rather than rejecting the order.
func parseUserOrders(raws []json.RawMessage) []*teslamodel.TeslaUserOrder {
	orders := make([]*teslamodel.TeslaUserOrder, 0, len(raws))
	for _, raw := range raws {
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
	return orders
}
