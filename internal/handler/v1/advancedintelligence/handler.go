// Package advancedintelligence exposes the advanced intelligence v1 HTTP
// contract. MountRoutes is intended to be called from the shared /api/v1
// composition root.
package advancedintelligence

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/advancedintelligencesvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	port "github.com/ev-dev-labs/teslasync/internal/port/advancedintelligence"
)

const (
	maxRequestBodyBytes = 64 << 10
	openModeSubject     = "open-mode"
)

type service interface {
	TwinLab(context.Context, domain.TwinLabRequest) (*domain.TwinLabResponse, error)
	FirmwareCanary(context.Context, int64, int, int) (*domain.Page[domain.FirmwareCanary], error)
	ComponentSurvival(context.Context, int64, int, int) (*domain.Page[domain.ComponentSurvival], error)
	RoadHazards(context.Context, int64, int, int) (*domain.HazardPage, error)
	BehavioralSentinel(context.Context, int64, int, int) (*domain.SentinelPage, error)
	ChargingForensics(context.Context, int64, int, int) (*domain.ChargingForensicsPage, error)
	JourneyAssurance(context.Context, domain.JourneyAssuranceRequest) (*domain.JourneyAssuranceResponse, error)
	ChargingSiteTwin(context.Context, domain.ChargingSiteTwinRequest) (*domain.ChargingSiteTwinResponse, error)
	FederatedStatus(context.Context, string, int64, int, int) (*domain.FederatedStatusPage, error)
	StartFederatedRound(context.Context, string, domain.StartFederatedRoundRequest) (*domain.FederatedRoundResult, error)
	ResiliencePlan(context.Context, domain.ResiliencePlanRequest) (*domain.ResiliencePlanResponse, error)
	ListCausalExperiments(context.Context, string, int64, int, int) (*domain.Page[domain.CausalExperiment], error)
	CreateCausalExperiment(context.Context, string, domain.CreateCausalExperimentRequest) (*domain.CausalExperiment, error)
	TCOOptimizer(context.Context, domain.TCOOptimizerRequest) (*domain.TCOOptimizerResponse, error)
}

type Handler struct {
	service    service
	headerName string
}

func NewHandler(service service, forwardAuthHeader string) *Handler {
	if service == nil {
		panic("advancedintelligence.NewHandler: service must not be nil")
	}
	return &Handler{
		service:    service,
		headerName: strings.TrimSpace(forwardAuthHeader),
	}
}

// MountRoutes mounts one stable route prefix. The caller should invoke this on
// the /api/v1 chi group.
func (h *Handler) MountRoutes(r chi.Router) {
	writeLimit := httprate.LimitByIP(10, time.Minute)
	r.Route("/advanced-intelligence", func(r chi.Router) {
		r.With(writeLimit).Post("/twin-lab/scenarios", h.TwinLab)
		r.Get("/firmware-canary", h.FirmwareCanary)
		r.Get("/component-survival", h.ComponentSurvival)
		r.Get("/road-hazards", h.RoadHazards)
		r.Get("/behavioral-sentinel", h.BehavioralSentinel)
		r.Get("/charging-forensics", h.ChargingForensics)
		r.With(writeLimit).Post("/journey-assurance/scenarios", h.JourneyAssurance)
		r.With(writeLimit).Post("/charging-site-twin/scenarios", h.ChargingSiteTwin)
		r.Get("/federated-learning/model-cards", h.FederatedStatus)
		r.With(writeLimit).Post("/federated-learning/rounds", h.StartFederatedRound)
		r.With(writeLimit).Post("/resilience/plans", h.ResiliencePlan)
		r.Get("/causal-experiments", h.ListCausalExperiments)
		r.With(writeLimit).Post("/causal-experiments", h.CreateCausalExperiment)
		r.With(writeLimit).Post("/tco-optimizer/scenarios", h.TCOOptimizer)
	})
}

func (h *Handler) TwinLab(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.twin_lab")
	defer span.End()
	var request domain.TwinLabRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateTwinRequest(request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.TwinLab(ctx, request)
	if err != nil {
		h.handleError(w, span, "run twin lab", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) FirmwareCanary(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.firmware_canary")
	defer span.End()
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.FirmwareCanary(ctx, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "run firmware canary", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ComponentSurvival(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.component_survival")
	defer span.End()
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.ComponentSurvival(ctx, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "run component survival", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) RoadHazards(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.road_hazards")
	defer span.End()
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.RoadHazards(ctx, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list road hazards", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) BehavioralSentinel(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.behavioral_sentinel")
	defer span.End()
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.BehavioralSentinel(ctx, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "run behavioral sentinel", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ChargingForensics(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.charging_forensics")
	defer span.End()
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.ChargingForensics(ctx, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "run charging forensics", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) JourneyAssurance(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.journey_assurance")
	defer span.End()
	var request domain.JourneyAssuranceRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateJourneyRequest(request, time.Now().UTC()); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.JourneyAssurance(ctx, request)
	if err != nil {
		h.handleError(w, span, "run journey assurance", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ChargingSiteTwin(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.charging_site_twin")
	defer span.End()
	var request domain.ChargingSiteTwinRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateChargingSiteRequest(request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.ChargingSiteTwin(ctx, request)
	if err != nil {
		h.handleError(w, span, "run charging site twin", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) FederatedStatus(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.federated_status")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.FederatedStatus(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list federated status", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) StartFederatedRound(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.start_federated_round")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.StartFederatedRoundRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateFederatedRound(subject, request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.StartFederatedRound(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "start federated round", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) ResiliencePlan(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.resilience_plan")
	defer span.End()
	var request domain.ResiliencePlanRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateResilienceRequest(request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.ResiliencePlan(ctx, request)
	if err != nil {
		h.handleError(w, span, "build resilience plan", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) ListCausalExperiments(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.list_causal_experiments")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	vehicleID, limit, offset, err := parseListRequest(r)
	if err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	response, err := h.service.ListCausalExperiments(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list causal experiments", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateCausalExperiment(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.create_causal_experiment")
	defer span.End()
	subject, ok := h.subject(w, r, span)
	if !ok {
		return
	}
	var request domain.CreateCausalExperimentRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateCausalExperiment(
		subject, request, time.Now().UTC(),
	); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.CreateCausalExperiment(ctx, subject, request)
	if err != nil {
		h.handleError(w, span, "create causal experiment", err)
		return
	}
	writeJSON(w, http.StatusCreated, response)
}

func (h *Handler) TCOOptimizer(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "advanced_intelligence.tco_optimizer")
	defer span.End()
	var request domain.TCOOptimizerRequest
	if err := decodeBody(w, r, &request); err != nil {
		validationError(w, span, err)
		return
	}
	if err := advancedintelligencesvc.ValidateTCORequest(request); err != nil {
		validationError(w, span, err)
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	response, err := h.service.TCOOptimizer(ctx, request)
	if err != nil {
		h.handleError(w, span, "run tco optimizer", err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) subject(w http.ResponseWriter, r *http.Request, span trace.Span) (string, bool) {
	if subject, ok := tsauth.SubjectFromRequest(r, h.headerName); ok {
		return subject, true
	}
	if tsauth.IsOpenMode(h.headerName) {
		return openModeSubject, true
	}
	err := errors.New("configured identity header is missing")
	span.RecordError(err)
	span.SetStatus(codes.Error, "missing identity")
	writeError(w, http.StatusUnauthorized, tsauth.MissingIdentityCode, "missing identity header")
	return "", false
}

func (h *Handler) handleError(w http.ResponseWriter, span trace.Span, message string, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, message)
	switch {
	case errors.Is(err, advancedintelligencesvc.ErrInvalidInput),
		errors.Is(err, advancedintelligencesvc.ErrNotConfirmed):
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
	case errors.Is(err, port.ErrConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "resource changed; refresh and retry")
	case errors.Is(err, port.ErrPrivacyBudgetExhausted):
		writeError(w, http.StatusConflict, "PRIVACY_BUDGET_EXHAUSTED", "privacy budget is exhausted")
	default:
		traceID := span.SpanContext().TraceID().String()
		log.Error().Err(err).Str("trace_id", traceID).Msg(message)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "advanced intelligence request failed")
	}
}

func parseListRequest(r *http.Request) (int64, int, int, error) {
	value := r.URL.Query().Get("vehicle_id")
	vehicleID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || vehicleID <= 0 {
		return 0, 0, 0, errors.New("vehicle_id must be a positive integer")
	}
	limit, err := parseBoundedInt(r.URL.Query().Get("limit"), 25, 1, 100, "limit")
	if err != nil {
		return 0, 0, 0, err
	}
	offset, err := parseBoundedInt(r.URL.Query().Get("offset"), 0, 0, 100000, "offset")
	if err != nil {
		return 0, 0, 0, err
	}
	return vehicleID, limit, offset, nil
}

func parseBoundedInt(value string, fallback, low, high int, name string) (int, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < low || parsed > high {
		return 0, errors.New(name + " is outside the allowed range")
	}
	return parsed, nil
}

func decodeBody(w http.ResponseWriter, r *http.Request, target interface{}) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("invalid JSON request body")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}

func validationError(w http.ResponseWriter, span trace.Span, err error) {
	span.RecordError(err)
	span.SetStatus(codes.Error, "request validation failed")
	writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": message, "code": code})
}
