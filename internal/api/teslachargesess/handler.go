package teslachargesess

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
	"github.com/rs/zerolog/log"
)

// teslaChargingSessionClient is the narrow slice of *tesla.Client the
// fleet-charging-session handlers depend on. Declaring the port at the call
// site lets handler tests inject a fake without standing up a real Tesla HTTP
// client + OAuth token.
type teslaChargingSessionClient interface {
	GetChargingSessions(ctx context.Context, vin, dateFrom, dateTo string, limit, offset int) ([]byte, int, error)
}

// teslaChargingSessionStore is the narrow persistence port used by the
// handlers. It is satisfied by *tesladb.TeslaChargingSessionRepo and declared
// here so tests can substitute an in-memory fake instead of a real pgx pool.
type teslaChargingSessionStore interface {
	GetAll(ctx context.Context, vin string, limit, offset int) ([]*teslamodel.TeslaChargingSession, error)
	GetSummary(ctx context.Context, vin string) (*teslamodel.TeslaChargingSessionSummary, error)
	UpsertBatch(ctx context.Context, sessions []*teslamodel.TeslaChargingSession) (int, error)
}

// Compile-time assertions that the production concrete types satisfy the ports.
var (
	_ teslaChargingSessionClient = (*tesla.Client)(nil)
	_ teslaChargingSessionStore  = (*tesladb.TeslaChargingSessionRepo)(nil)
)

// TeslaChargingSessionHandler serves Tesla fleet charging sessions (business accounts only).
type TeslaChargingSessionHandler struct {
	teslaClient teslaChargingSessionClient
	repo        teslaChargingSessionStore
}

// NewTeslaChargingSessionHandler creates a new handler with the given Tesla client and DB.
func NewTeslaChargingSessionHandler(tc *tesla.Client, db *database.DB) *TeslaChargingSessionHandler {
	return &TeslaChargingSessionHandler{
		teslaClient: tc,
		repo:        tesladb.NewTeslaChargingSessionRepo(db),
	}
}

// List returns stored fleet charging sessions from DB with pagination and server-side summary.
func (h *TeslaChargingSessionHandler) List(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	limit, offset := apiparams.Pagination(r)

	sessions, err := h.repo.GetAll(r.Context(), vin, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list tesla charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charging sessions")
		return
	}

	summary, err := h.repo.GetSummary(r.Context(), vin)
	if err != nil {
		log.Error().Err(err).Msg("failed to get tesla charging session summary")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session summary")
		return
	}

	if sessions == nil {
		sessions = []*teslamodel.TeslaChargingSession{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"sessions": sessions,
		"summary":  summary,
	})
}

// Refresh fetches fleet charging sessions from Tesla API, upserts to DB, returns fresh data.
// Returns 403 gracefully for non-business accounts.
func (h *TeslaChargingSessionHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	vin := r.URL.Query().Get("vin")
	dateFrom := r.URL.Query().Get("date_from")
	dateTo := r.URL.Query().Get("date_to")

	// Default to last 90 days if no date range specified
	if dateFrom == "" {
		dateFrom = time.Now().UTC().AddDate(0, -3, 0).Format("2006-01-02")
	}
	if dateTo == "" {
		dateTo = time.Now().UTC().Format("2006-01-02")
	}

	log.Info().Str("date_from", dateFrom).Str("date_to", dateTo).Msg("refreshing tesla charging sessions")

	var allSessions []*teslamodel.TeslaChargingSession
	limit := 50
	offset := 0

	for {
		body, status, err := h.teslaClient.GetChargingSessions(r.Context(), vin, dateFrom, dateTo, limit, offset)
		if err != nil {
			log.Error().Err(err).Int("offset", offset).Msg("tesla charging sessions API error")
			httpx.WriteError(w, http.StatusBadGateway, "failed to fetch charging sessions from Tesla")
			return
		}

		// Graceful 403 handling for non-business accounts
		if status == http.StatusForbidden {
			log.Warn().Msg("tesla charging sessions returned 403 — business account required")
			httpx.WriteError(w, http.StatusForbidden, "Fleet charging sessions require a Tesla business account")
			return
		}

		if status < 200 || status >= 300 {
			log.Error().Int("status", status).Str("body", string(body)).Msg("tesla charging sessions non-2xx response")
			httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("Tesla API returned status %d", status))
			return
		}

		var resp teslaChargingSessionsResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			log.Error().Err(err).Msg("failed to parse tesla charging sessions response")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to parse Tesla response")
			return
		}

		sessions := parseTeslaChargingSessions(resp.Response.Data)
		allSessions = append(allSessions, sessions...)

		// Stop if we fetched fewer than the limit or reached total
		if len(resp.Response.Data) < limit || offset+limit >= resp.Response.TotalResults {
			break
		}
		offset += limit

		// Safety limit to prevent infinite loops
		if offset > 5000 {
			log.Warn().Msg("tesla charging sessions: hit 5000-offset safety limit")
			break
		}
	}

	upserted, err := h.repo.UpsertBatch(r.Context(), allSessions)
	if err != nil {
		log.Error().Err(err).Msg("failed to upsert tesla charging sessions")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to save charging sessions")
		return
	}

	log.Info().Int("fetched", len(allSessions)).Int("upserted", upserted).Msg("tesla charging sessions refresh complete")

	dbLimit, dbOffset := apiparams.Pagination(r)
	sessions, err := h.repo.GetAll(r.Context(), vin, dbLimit, dbOffset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list tesla charging sessions after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list charging sessions")
		return
	}

	summary, err := h.repo.GetSummary(r.Context(), vin)
	if err != nil {
		log.Error().Err(err).Msg("failed to get summary after refresh")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session summary")
		return
	}

	if sessions == nil {
		sessions = []*teslamodel.TeslaChargingSession{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"sessions": sessions,
		"summary":  summary,
		"upserted": upserted,
	})
}

type teslaChargingSessionsResponse struct {
	Response struct {
		Data         []teslaChargingSessionItem `json:"data"`
		TotalResults int                        `json:"totalResults"`
	} `json:"response"`
}

type teslaChargingSessionItem struct {
	SessionID           int64                     `json:"sessionId"`
	VIN                 string                    `json:"vin"`
	ChargerID           string                    `json:"chargerId"`
	SiteLocationName    string                    `json:"siteLocationName"`
	ChargeStartDateTime string                    `json:"chargeStartDateTime"`
	ChargeStopDateTime  string                    `json:"chargeStopDateTime"`
	EnergyAddedKWh      *float64                  `json:"energyAdded_kWh"`
	PeakPowerKW         *float64                  `json:"peakPower_kW"`
	MaxChargeRateKW     *float64                  `json:"maxChargeRate_kW"`
	ChargeDurationS     *int                      `json:"chargeDuration_s"`
	ChargerType         string                    `json:"chargerType"`
	Cost                *teslaChargingSessionCost `json:"cost"`
	Location            *teslaChargingSessionLoc  `json:"location"`
}

type teslaChargingSessionCost struct {
	CurrencyCode  string  `json:"currencyCode"`
	TotalCost     float64 `json:"totalCost"`
	PerKWhRate    float64 `json:"perKwhRate"`
	IdleFee       float64 `json:"idleFee"`
	CongestionFee float64 `json:"congestionFee"`
}

type teslaChargingSessionLoc struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// parseTeslaChargingSessions converts Tesla API items to model entries.
func parseTeslaChargingSessions(items []teslaChargingSessionItem) []*teslamodel.TeslaChargingSession {
	results := make([]*teslamodel.TeslaChargingSession, 0, len(items))

	for _, item := range items {
		s := &teslamodel.TeslaChargingSession{
			SessionID:        item.SessionID,
			VIN:              item.VIN,
			SiteLocationName: item.SiteLocationName,
			EnergyAddedKWh:   item.EnergyAddedKWh,
			PeakPowerKW:      item.PeakPowerKW,
			MaxChargeRateKW:  item.MaxChargeRateKW,
			ChargeDurationS:  item.ChargeDurationS,
		}

		// Parse timestamps
		if t, err := time.Parse(time.RFC3339, item.ChargeStartDateTime); err == nil {
			s.ChargeStartDatetime = t
		} else {
			log.Warn().Str("value", item.ChargeStartDateTime).Msg("failed to parse charge session start datetime")
			continue
		}
		if item.ChargeStopDateTime != "" {
			if t, err := time.Parse(time.RFC3339, item.ChargeStopDateTime); err == nil {
				s.ChargeStopDatetime = &t
			}
		}

		if item.ChargerID != "" {
			s.ChargerID = &item.ChargerID
		}
		if item.ChargerType != "" {
			s.ChargerType = &item.ChargerType
		}

		// Cost fields
		if item.Cost != nil {
			s.CurrencyCode = &item.Cost.CurrencyCode
			s.TotalCost = &item.Cost.TotalCost
			s.PerKWhRate = &item.Cost.PerKWhRate
			s.IdleFee = &item.Cost.IdleFee
			s.CongestionFee = &item.Cost.CongestionFee
		}

		// Location fields
		if item.Location != nil {
			s.Latitude = &item.Location.Latitude
			s.Longitude = &item.Location.Longitude
		}

		results = append(results, s)
	}

	return results
}
