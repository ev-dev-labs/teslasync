package smartreadiness

import (
	"net/http"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

func (h *Handler) PublicFeeDecision(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.public_fee_decision")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "public charging fee review")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	var sessionID int64
	if raw := r.URL.Query().Get("session_id"); raw != "" {
		sessionID, err = positiveID(raw)
		if err != nil {
			h.handleError(w, span, err)
			return
		}
	}
	decision, err := h.service.FindPublicFeeDecision(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if decision != nil && sessionID != 0 && sessionID != decision.SessionID {
		decision = nil
	}
	httputil.Respond(w, http.StatusOK, struct {
		Decision *domain.PublicFeeDecision `json:"decision"`
	}{Decision: decision})
}

func (h *Handler) PublicFeeTerms(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.public_fee_terms")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "public charging fee review")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	settings, err := h.service.PublicFeeSettings(ctx, subject, vehicleID)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, settings)
}

func (h *Handler) SavePublicFeeTerms(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.save_public_fee_terms")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "public charging fee review")
	if !ok {
		return
	}
	type request struct {
		ConfirmedPublicSite    bool      `json:"confirmed_public_site"`
		ConfirmedUnconditional bool      `json:"confirmed_unconditional"`
		VehicleID              int64     `json:"vehicle_id"`
		PlaceID                int64     `json:"place_id"`
		PlaceUpdatedAt         time.Time `json:"place_updated_at"`
		Currency               string    `json:"currency"`
		FeePerMinuteMinor      int64     `json:"fee_per_minute_minor"`
		GraceS                 int       `json:"grace_s"`
		SourceURL              string    `json:"source_url"`
		ValidUntil             time.Time `json:"valid_until"`
		PushDeviceID           *int64    `json:"push_device_id"`
		PushTitle              string    `json:"push_title"`
		PushBody               string    `json:"push_body"`
	}
	body, err := decode[request](w, r)
	if err != nil || !body.ConfirmedPublicSite {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	err = h.service.SetPublicFeeTerms(ctx, subject, domain.PublicFeeTerms{
		ConfirmedUnconditional: body.ConfirmedUnconditional, VehicleID: body.VehicleID,
		PlaceID: body.PlaceID, PlaceUpdatedAt: body.PlaceUpdatedAt, Currency: body.Currency,
		FeePerMinuteMinor: body.FeePerMinuteMinor, GraceS: body.GraceS, SourceURL: body.SourceURL,
		ValidUntil: body.ValidUntil, PushDeviceID: body.PushDeviceID, PushTitle: body.PushTitle, PushBody: body.PushBody,
	})
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) RevokePublicFeeTerms(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_charging.revoke_public_fee_terms")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "public charging fee review")
	if !ok {
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.RevokePublicFeeTerms(ctx, subject, vehicleID); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
