package teslachargehist

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	tesladb "github.com/ev-dev-labs/teslasync/internal/database/tesla"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// teslaChargeHistoryAPI is the consumer-side port for the Tesla Fleet API
// calls the charging-history handler makes. Declaring the narrow interface
// here (rather than depending on the concrete *tesla.Client) keeps the
// handlers unit-testable with a fake; the concrete client satisfies it
// unchanged.
type teslaChargeHistoryAPI interface {
	GetChargingHistory(ctx context.Context, vin, startTime, endTime string, pageNo, pageSize int) ([]byte, int, error)
	GetChargingInvoice(ctx context.Context, contentID string) ([]byte, int, error)
	HasValidToken() bool
}

// teslaChargeHistoryStore is the consumer-side port for the persistence the
// handler needs. *tesladb.TeslaChargingHistoryRepo satisfies it unchanged.
type teslaChargeHistoryStore interface {
	GetAll(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingHistoryEntry, error)
	GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingHistorySummary, error)
	UpsertBatch(ctx context.Context, entries []*teslamodel.TeslaChargingHistoryEntry) (int, error)
}

// Compile-time proof the concrete production dependencies still satisfy the
// ports above, so a signature drift is caught at build time, not runtime.
var (
	_ teslaChargeHistoryAPI   = (*tesla.Client)(nil)
	_ teslaChargeHistoryStore = (*tesladb.TeslaChargingHistoryRepo)(nil)
)

// TeslaChargingHistoryHandler serves Tesla Supercharger/DC charging history.
type TeslaChargingHistoryHandler struct {
	teslaClient teslaChargeHistoryAPI
	repo        teslaChargeHistoryStore
}

// NewTeslaChargingHistoryHandler wires Tesla charging history dependencies.
func NewTeslaChargingHistoryHandler(tc *tesla.Client, db *database.DB) *TeslaChargingHistoryHandler {
	return &TeslaChargingHistoryHandler{
		teslaClient: tc,
		repo:        tesladb.NewTeslaChargingHistoryRepo(db),
	}
}

// newHandler builds a handler from explicit ports. Tests use it to inject
// fakes; production code uses NewTeslaChargingHistoryHandler.
func newHandler(api teslaChargeHistoryAPI, store teslaChargeHistoryStore) *TeslaChargingHistoryHandler {
	return &TeslaChargingHistoryHandler{teslaClient: api, repo: store}
}

// List returns stored charging history from DB with pagination and server-side summary.
func (h *TeslaChargingHistoryHandler) List(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	limit, offset := apiparams.Pagination(r)

	entries, err := h.repo.GetAll(r.Context(), vin, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list tesla charging history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charging history")
		return
	}

	summary, err := h.repo.GetSummary(r.Context(), vin)
	if err != nil {
		log.Error().Err(err).Msg("failed to get tesla charging history summary")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging history summary")
		return
	}

	if entries == nil {
		entries = []*teslamodel.TeslaChargingHistoryEntry{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"entries": entries,
		"summary": summary,
	})
}

// Refresh fetches charging history from Tesla API, upserts to DB, returns fresh data.
func (h *TeslaChargingHistoryHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	startTime := r.URL.Query().Get("start_time")
	endTime := r.URL.Query().Get("end_time")

	// Match Tesla history's common default window when the caller omits dates.
	if startTime == "" {
		startTime = time.Now().UTC().AddDate(0, -3, 0).Format(time.RFC3339)
	}
	if endTime == "" {
		endTime = time.Now().UTC().Format(time.RFC3339)
	}

	log.Info().Str("vin", "***").Str("start", startTime).Str("end", endTime).Msg("refreshing tesla charging history")

	var allEntries []*teslamodel.TeslaChargingHistoryEntry
	pageNo := 1
	pageSize := 50

	for {
		body, status, err := h.teslaClient.GetChargingHistory(r.Context(), vin, startTime, endTime, pageNo, pageSize)
		if err != nil {
			log.Error().Err(err).Int("page", pageNo).Msg("tesla charging history API error")
			httpx.WriteError(w, http.StatusBadGateway, "failed to fetch charging history from Tesla")
			return
		}
		if status < 200 || status >= 300 {
			log.Error().Int("status", status).Str("body", string(body)).Msg("tesla charging history non-2xx response")
			httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
			return
		}

		var resp teslaChargingHistoryResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			log.Error().Err(err).Msg("failed to parse tesla charging history response")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
			return
		}

		entries := parseTeslaChargingEntries(resp.Response.Data)
		allEntries = append(allEntries, entries...)

		if !resp.Response.HasMoreData || len(resp.Response.Data) == 0 {
			break
		}
		pageNo++

		// Safety limit to prevent infinite loops
		if pageNo > 100 {
			log.Warn().Msg("tesla charging history: hit 100-page safety limit")
			break
		}
	}

	upserted, err := h.repo.UpsertBatch(r.Context(), allEntries)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert tesla charging history")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save charging history")
		return
	}

	log.Info().Int("fetched", len(allEntries)).Int("upserted", upserted).Msg("tesla charging history refresh complete")

	// Return fresh data
	limit, offset := apiparams.Pagination(r)
	entries, err := h.repo.GetAll(r.Context(), vin, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list tesla charging history after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charging history")
		return
	}

	summary, err := h.repo.GetSummary(r.Context(), vin)
	if err != nil {
		log.Error().Err(err).Msg("failed to get summary after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging history summary")
		return
	}

	if entries == nil {
		entries = []*teslamodel.TeslaChargingHistoryEntry{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"entries":  entries,
		"summary":  summary,
		"upserted": upserted,
	})
}

// Invoice proxies the PDF invoice download from Tesla.
func (h *TeslaChargingHistoryHandler) Invoice(w http.ResponseWriter, r *http.Request) {
	contentID := chi.URLParam(r, "contentID")
	if contentID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "content_id is required")
		return
	}

	if !h.teslaClient.HasValidToken() {
		httpx.WriteError(w, http.StatusUnauthorized, "not authenticated with Tesla")
		return
	}

	body, status, err := h.teslaClient.GetChargingInvoice(r.Context(), contentID)
	if err != nil {
		log.Error().Err(err).Str("content_id", contentID).Msg("failed to fetch invoice from Tesla")
		httpx.WriteError(w, http.StatusBadGateway, "failed to fetch invoice from Tesla")
		return
	}
	if status != http.StatusOK {
		log.Warn().Int("status", status).Str("content_id", contentID).Msg("tesla invoice API non-200 response")
		httpx.WriteError(w, status, "Tesla API error")
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="tesla-invoice-%s.pdf"`, contentID))
	w.WriteHeader(http.StatusOK)
	w.Write(body) //nolint:errcheck
}

// --- Tesla API response types ---

type teslaChargingHistoryResponse struct {
	Response struct {
		Data         []teslaChargingHistoryItem `json:"data"`
		TotalResults int                        `json:"totalResults"`
		HasMoreData  bool                       `json:"hasMoreData"`
	} `json:"response"`
}

type teslaChargingHistoryItem struct {
	SessionID           int64                  `json:"sessionId"`
	VIN                 string                 `json:"vin"`
	SiteLocationName    string                 `json:"siteLocationName"`
	ChargeStartDateTime string                 `json:"chargeStartDateTime"`
	ChargeStopDateTime  string                 `json:"chargeStopDateTime"`
	Country             string                 `json:"country"`
	State               string                 `json:"state"`
	County              string                 `json:"county"`
	PostalCode          string                 `json:"postalCode"`
	BillingType         string                 `json:"billingType"`
	Fees                []teslaChargingFee     `json:"fees"`
	Invoices            []teslaChargingInvoice `json:"invoices"`
	VehicleMakeType     string                 `json:"vehicleMakeType"`
}

type teslaChargingFee struct {
	FeeType      string   `json:"feeType"`
	CurrencyCode string   `json:"currencyCode"`
	PricingType  string   `json:"pricingType"`
	RateBase     *float64 `json:"rateBase"`
	UsageBase    *float64 `json:"usageBase"`
	TotalDue     *float64 `json:"totalDue"`
}

type teslaChargingInvoice struct {
	FileName    string `json:"fileName"`
	ContentID   string `json:"contentId"`
	InvoiceType string `json:"invoiceType"`
}

// parseTeslaChargingEntries converts Tesla API items to model entries.
func parseTeslaChargingEntries(items []teslaChargingHistoryItem) []*teslamodel.TeslaChargingHistoryEntry {
	results := make([]*teslamodel.TeslaChargingHistoryEntry, 0, len(items))

	for _, item := range items {
		e := &teslamodel.TeslaChargingHistoryEntry{
			SessionID:        item.SessionID,
			VIN:              item.VIN,
			SiteLocationName: item.SiteLocationName,
		}

		// Parse timestamps
		if t, err := time.Parse(time.RFC3339, item.ChargeStartDateTime); err == nil {
			e.ChargeStartDatetime = t
		} else {
			log.Warn().Str("value", item.ChargeStartDateTime).Msg("failed to parse charge start datetime")
			continue
		}
		if item.ChargeStopDateTime != "" {
			if t, err := time.Parse(time.RFC3339, item.ChargeStopDateTime); err == nil {
				e.ChargeStopDatetime = &t
			}
		}

		// Location fields
		if item.Country != "" {
			e.Country = &item.Country
		}
		if item.State != "" {
			e.State = &item.State
		}
		if item.County != "" {
			e.County = &item.County
		}
		if item.PostalCode != "" {
			e.PostalCode = &item.PostalCode
		}
		if item.BillingType != "" {
			e.BillingType = &item.BillingType
		}

		// Find the CHARGING fee by feeType discriminator (not array position)
		for _, fee := range item.Fees {
			if fee.FeeType == "CHARGING" {
				e.FeeType = &fee.FeeType
				e.CurrencyCode = &fee.CurrencyCode
				e.PricingType = &fee.PricingType
				e.RateBase = fee.RateBase
				e.UsageWh = kwhPtrToWhPtr(fee.UsageBase)
				e.TotalDue = fee.TotalDue
				break
			}
		}
		// Fallback: if no CHARGING fee found, use first fee
		if e.FeeType == nil && len(item.Fees) > 0 {
			fee := item.Fees[0]
			e.FeeType = &fee.FeeType
			e.CurrencyCode = &fee.CurrencyCode
			e.PricingType = &fee.PricingType
			e.RateBase = fee.RateBase
			e.UsageWh = kwhPtrToWhPtr(fee.UsageBase)
			e.TotalDue = fee.TotalDue
		}

		// Invoice extraction
		e.HasInvoice = len(item.Invoices) > 0
		if e.HasInvoice {
			e.InvoiceContentID = &item.Invoices[0].ContentID
		}

		results = append(results, e)
	}

	return results
}

func kwhPtrToWhPtr(v *float64) *float64 {
	if v == nil {
		return nil
	}
	wh := *v * 1000.0
	return &wh
}
