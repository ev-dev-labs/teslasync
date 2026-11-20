// Package smartdelivery exposes verified personal browser delivery.
package smartdelivery

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type service interface {
	Available() bool
	PublicKey() string
	ListDevices(context.Context, string, int, int) ([]domain.Device, error)
	FindDevice(context.Context, string, string) (*domain.Device, error)
	Enroll(context.Context, string, domain.Subscription, domain.Texts) (*domain.Device, error)
	Verify(context.Context, string, int64, string) (*domain.Notification, error)
	ClaimCharging(context.Context, string, string) (*domain.Notification, error)
	SetChargingEnabled(context.Context, string, int64, bool) error
	DeleteDevice(context.Context, string, int64) error
}

type Handler struct {
	service    service
	headerName string
}

func NewHandler(service service, forwardAuthHeader string) *Handler {
	if service == nil {
		panic("smartdelivery.NewHandler: service must not be nil")
	}
	return &Handler{service: service, headerName: strings.TrimSpace(forwardAuthHeader)}
}

func (h *Handler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(20, time.Minute)
	r.Route("/smart-delivery", func(r chi.Router) {
		r.Get("/devices", h.ListDevices)
		r.With(writeLimit).Post("/devices/lookup", h.FindDevice)
		r.With(writeLimit).Post("/devices", h.Enroll)
		r.With(writeLimit).Post("/devices/{deviceID}/verify", h.Verify)
		r.With(writeLimit).Post("/deliveries/claim", h.ClaimCharging)
		r.With(writeLimit).Put("/devices/{deviceID}/charging", h.SetCharging)
		r.With(writeLimit).Delete("/devices/{deviceID}", h.DeleteDevice)
	})
}

func (h *Handler) ClaimCharging(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.claim_charging")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	request, err := decode[struct {
		Token string `json:"token"`
	}](w, r)
	if err != nil {
		h.handleError(w, span, smartdeliverysvc.ErrInvalidInput)
		return
	}
	notification, err := h.service.ClaimCharging(ctx, subject, request.Token)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, notification)
}

func (h *Handler) ListDevices(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.list_devices")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	devices, err := h.service.ListDevices(ctx, subject, 50, 0)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, struct {
		Available bool            `json:"available"`
		PublicKey string          `json:"public_key"`
		Devices   []domain.Device `json:"devices"`
	}{Available: h.service.Available(), PublicKey: h.service.PublicKey(), Devices: devices})
}

func (h *Handler) FindDevice(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.find_device")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	request, err := decode[struct {
		Endpoint string `json:"endpoint"`
	}](w, r)
	if err != nil {
		h.handleError(w, span, smartdeliverysvc.ErrInvalidInput)
		return
	}
	device, err := h.service.FindDevice(ctx, subject, request.Endpoint)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, device)
}

func (h *Handler) Enroll(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.enroll")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	request, err := decode[struct {
		Subscription domain.Subscription `json:"subscription"`
		Texts        domain.Texts        `json:"texts"`
	}](w, r)
	if err != nil {
		h.handleError(w, span, smartdeliverysvc.ErrInvalidInput)
		return
	}
	device, err := h.service.Enroll(ctx, subject, request.Subscription, request.Texts)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusCreated, device)
}

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.verify")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	id, err := positiveID(chi.URLParam(r, "deviceID"))
	request, decodeErr := decode[struct {
		Token string `json:"token"`
	}](w, r)
	if err != nil || decodeErr != nil {
		h.handleError(w, span, smartdeliverysvc.ErrInvalidInput)
		return
	}
	notification, err := h.service.Verify(ctx, subject, id, request.Token)
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	httputil.Respond(w, http.StatusOK, notification)
}

func (h *Handler) SetCharging(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.set_charging")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	id, err := positiveID(chi.URLParam(r, "deviceID"))
	request, decodeErr := decode[struct {
		Enabled *bool `json:"enabled"`
	}](w, r)
	if err != nil || decodeErr != nil || request.Enabled == nil {
		h.handleError(w, span, smartdeliverysvc.ErrInvalidInput)
		return
	}
	if err := h.service.SetChargingEnabled(ctx, subject, id, *request.Enabled); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "smart_delivery.delete_device")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "personal delivery")
	if !ok {
		return
	}
	id, err := positiveID(chi.URLParam(r, "deviceID"))
	if err != nil {
		h.handleError(w, span, err)
		return
	}
	if err := h.service.DeleteDevice(ctx, subject, id); err != nil {
		h.handleError(w, span, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartdeliverysvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid personal delivery request")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "personal delivery device not found")
	case errors.Is(err, port.ErrOwned):
		httputil.RespondError(w, http.StatusConflict, "DEVICE_IN_USE", "this browser is linked to another account")
	case errors.Is(err, port.ErrLimit):
		httputil.RespondError(w, http.StatusConflict, "DEVICE_LIMIT", "too many personal delivery devices")
	case errors.Is(err, smartdeliverysvc.ErrUnavailable):
		httputil.RespondError(w, http.StatusServiceUnavailable, "DELIVERY_UNAVAILABLE", "personal delivery is not configured")
	case errors.Is(err, smartdeliverysvc.ErrDelivery):
		httputil.RespondError(w, http.StatusBadGateway, "CONFIRMATION_FAILED", "the device confirmation could not be sent")
	default:
		span.RecordError(errors.New("personal delivery request failed"))
		span.SetStatus(codes.Error, "personal delivery request failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("personal delivery request failed")
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "personal delivery request failed")
	}
}

func decode[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	return httputil.DecodeAndValidate[T](r)
}

func positiveID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, smartdeliverysvc.ErrInvalidInput
	}
	return id, nil
}
