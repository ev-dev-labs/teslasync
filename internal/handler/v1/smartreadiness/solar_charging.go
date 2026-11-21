package smartreadiness

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

const (
	solarAuthCookie = "teslasync_solar_state"
	solarAuthPath   = "/api/v1/smart-charging/solar/connection/callback"
	solarSettings   = "/settings/smart-charging"
)

type solarCharging interface {
	SaveSolarChargingPlan(context.Context, string, domain.SolarChargingPlan) error
	DeleteSolarChargingPlan(context.Context, string, int64) error
	FindSolarChargingPlan(context.Context, string, int64) (*domain.SolarChargingPlan, error)
	SolarChargingDecision(context.Context, string, int64) (*domain.SolarSurplusDecision, error)
}

type solarConnections interface {
	Begin(ctx context.Context, subject string, siteID int64) (link, state string, err error)
	Complete(ctx context.Context, subject, state, code string) error
	Site(ctx context.Context, subject string) (int64, error)
	Disconnect(ctx context.Context, subject string) error
	CanConnect() bool
}

func WithSolarCharging(solar solarCharging, energy solarConnections) Option {
	return func(h *Handler) { h.solar, h.energy = solar, energy }
}

func (h *Handler) SolarSettings(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_settings")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	response := struct {
		Available bool                         `json:"available"`
		SiteID    string                       `json:"energy_site_id,omitempty"`
		Plan      *domain.SolarChargingPlan    `json:"plan"`
		Decision  *domain.SolarSurplusDecision `json:"decision"`
	}{Available: h.energy != nil && h.energy.CanConnect()}
	if h.energy != nil && h.solar != nil {
		var siteID int64
		siteID, err = h.energy.Site(ctx, subject)
		if err == nil && siteID != 0 {
			response.SiteID = strconv.FormatInt(siteID, 10)
			response.Plan, err = h.solar.FindSolarChargingPlan(ctx, subject, vehicleID)
		}
		if err == nil && response.Plan != nil && response.Available {
			response.Decision, err = h.solar.SolarChargingDecision(ctx, subject, vehicleID)
		}
		if err != nil {
			h.handleError(w, span, err)
			return
		}
	}
	httputil.Respond(w, http.StatusOK, response)
}

func (h *Handler) StartEnergyConnection(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_connection_start")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	if h.energy == nil {
		h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
		return
	}
	type request struct {
		SiteID    string `json:"energy_site_id"`
		VehicleID int64  `json:"vehicle_id"`
	}
	input, err := decode[request](w, r)
	siteID, siteErr := positiveID(input.SiteID)
	if err != nil || siteErr != nil || input.VehicleID <= 0 {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	link, state, err := h.energy.Begin(ctx, subject, siteID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	writeSolarCookie(w, state+"."+strconv.FormatInt(input.VehicleID, 10), 600)
	httputil.Respond(w, http.StatusOK, map[string]string{"authorization_url": link})
}

func (h *Handler) EnergyConnectionCallback(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_connection_callback")
	defer span.End()
	w.Header().Set("Referrer-Policy", "no-referrer")
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	query := r.URL.Query()
	cookie, cookieErr := r.Cookie(solarAuthCookie)
	if cookieErr != nil {
		http.Redirect(w, r, solarSettings+"?solar=failed#solar-charging", http.StatusSeeOther)
		return
	}
	savedState, vehicle, _ := strings.Cut(cookie.Value, ".")
	vehicleID, err := positiveID(vehicle)
	if err != nil || len(query["state"]) != 1 || len(query.Get("state")) != 43 ||
		subtle.ConstantTimeCompare([]byte(savedState), []byte(query.Get("state"))) != 1 {
		http.Redirect(w, r, solarSettings+"?solar=failed#solar-charging", http.StatusSeeOther)
		return
	}
	writeSolarCookie(w, "", -1)
	outcome := "failed"
	if h.energy != nil && !query.Has("error") && len(query["code"]) == 1 &&
		h.energy.Complete(ctx, subject, query.Get("state"), query.Get("code")) == nil {
		outcome = "connected"
	}
	http.Redirect(w, r, solarSettings+"?vehicle_id="+strconv.FormatInt(vehicleID, 10)+"&solar="+outcome+"#solar-charging", http.StatusSeeOther)
}

func writeSolarCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: solarAuthCookie, Value: value,
		Path: solarAuthPath, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}

func (h *Handler) DisconnectEnergy(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_disconnect")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	if h.energy == nil {
		h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
		return
	}
	if err := h.energy.Disconnect(ctx, subject); err != nil {
		h.handleError(w, span, err)
		return
	}
	writeSolarCookie(w, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SaveSolarConsent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_save_consent")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	if h.energy == nil || !h.energy.CanConnect() || h.solar == nil {
		h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
		return
	}
	type request struct {
		VehicleID      int64     `json:"vehicle_id"`
		PlaceID        int64     `json:"place_id"`
		PlaceUpdatedAt time.Time `json:"place_updated_at"`
		ConfirmedHome  bool      `json:"confirmed_home"`
	}
	input, err := decode[request](w, r)
	if err != nil || !input.ConfirmedHome {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	site, err := h.energy.Site(ctx, subject)
	if err == nil {
		err = h.solar.SaveSolarChargingPlan(ctx, subject, domain.SolarChargingPlan{
			VehicleID: input.VehicleID, EnergySiteID: site, PlaceID: input.PlaceID, PlaceUpdatedAt: input.PlaceUpdatedAt,
		})
	}
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) RevokeSolarConsent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.solar_revoke_consent")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "solar charging")
	if !ok {
		return
	}
	if h.solar == nil {
		h.handleError(w, span, smartreadinesssvc.ErrSolarChargingUnavailable)
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err == nil {
		err = h.solar.DeleteSolarChargingPlan(ctx, subject, vehicleID)
	}
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
