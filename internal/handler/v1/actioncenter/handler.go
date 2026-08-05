package actioncenter

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
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
)

const (
	maxActionBodyBytes = 16 << 10
	openModeSubject    = "open-mode"
)

type actionCenterService interface {
	List(context.Context, string, actioncentersvc.ListFilter) (*domain.Response, error)
	ApplyAction(context.Context, string, actioncentersvc.ActionRequest) (*domain.ActionResult, error)
	History(context.Context, string, string, int, int) (*domain.HistoryPage, error)
}

type ActionCenterHandler struct {
	service    actionCenterService
	headerName string
}

func NewHandler(service actionCenterService, forwardAuthHeader string) *ActionCenterHandler {
	if service == nil {
		panic("actioncenter.NewHandler: service must not be nil")
	}
	return &ActionCenterHandler{
		service:    service,
		headerName: strings.TrimSpace(forwardAuthHeader),
	}
}

func (h *ActionCenterHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "action_center.list")
	defer span.End()

	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	filter, err := parseListFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	if filter.VehicleID != nil {
		span.SetAttributes(attribute.Int64("vehicle_id", *filter.VehicleID))
	}
	response, err := h.service.List(ctx, subject, filter)
	if err != nil {
		h.handleError(w, span, "list action center recommendations", err)
		return
	}
	span.SetAttributes(attribute.Int("action_center.item_count", len(response.Items)))
	writeJSON(w, http.StatusOK, response)
}

type actionRequest struct {
	Fingerprint     string            `json:"fingerprint"`
	Action          domain.ActionType `json:"action"`
	ExpectedVersion int               `json:"expected_version"`
	Confirmed       bool              `json:"confirmed"`
	SnoozedUntil    *time.Time        `json:"snoozed_until"`
}

func (h *ActionCenterHandler) ApplyAction(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "action_center.apply_action")
	defer span.End()

	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	recommendationID := chi.URLParam(r, "recommendationID")
	var body actionRequest
	if err := decodeActionBody(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	span.SetAttributes(
		attribute.String("action_center.recommendation_id", recommendationID),
		attribute.String("action_center.action", string(body.Action)),
	)
	result, err := h.service.ApplyAction(ctx, subject, actioncentersvc.ActionRequest{
		RecommendationID: recommendationID,
		Fingerprint:      body.Fingerprint,
		Action:           body.Action,
		ExpectedVersion:  body.ExpectedVersion,
		Confirmed:        body.Confirmed,
		SnoozedUntil:     body.SnoozedUntil,
	})
	if err != nil {
		h.handleError(w, span, "apply action center action", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *ActionCenterHandler) History(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "action_center.history")
	defer span.End()

	subject, ok := h.subject(w, r)
	if !ok {
		return
	}
	recommendationID := chi.URLParam(r, "recommendationID")
	limit, err := parseBoundedInt(r.URL.Query().Get("limit"), 25, 1, 100, "limit")
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	offset, err := parseBoundedInt(r.URL.Query().Get("offset"), 0, 0, 100000, "offset")
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}
	span.SetAttributes(attribute.String("action_center.recommendation_id", recommendationID))
	page, err := h.service.History(ctx, subject, recommendationID, limit, offset)
	if err != nil {
		h.handleError(w, span, "list action center history", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h *ActionCenterHandler) subject(w http.ResponseWriter, r *http.Request) (string, bool) {
	subject, ok := tsauth.SubjectFromRequest(r, h.headerName)
	if ok {
		return subject, true
	}
	if tsauth.IsOpenMode(h.headerName) {
		return openModeSubject, true
	} else {
		writeError(w, http.StatusUnauthorized, tsauth.MissingIdentityCode,
			"missing identity header")
	}
	return "", false
}

func (h *ActionCenterHandler) handleError(
	w http.ResponseWriter,
	span trace.Span,
	message string,
	err error,
) {
	span.RecordError(err)
	span.SetStatus(codes.Error, message)
	switch {
	case errors.Is(err, actioncentersvc.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
	case errors.Is(err, actioncentersvc.ErrStaleFingerprint),
		errors.Is(err, port.ErrStateConflict):
		writeError(w, http.StatusConflict, "RECOMMENDATION_STALE",
			"recommendation changed; refresh before applying this action")
	case errors.Is(err, actioncentersvc.ErrNotFound),
		errors.Is(err, port.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "recommendation not found")
	default:
		traceID := span.SpanContext().TraceID().String()
		log.Error().Err(err).Str("trace_id", traceID).Msg(message)
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR",
			"action center request failed")
	}
}

func parseListFilter(r *http.Request) (actioncentersvc.ListFilter, error) {
	filter := actioncentersvc.ListFilter{}
	if value := r.URL.Query().Get("vehicle_id"); value != "" {
		vehicleID, err := strconv.ParseInt(value, 10, 64)
		if err != nil || vehicleID <= 0 {
			return filter, errors.New("vehicle_id must be a positive integer")
		}
		filter.VehicleID = &vehicleID
	}
	if value := r.URL.Query().Get("priority"); value != "" {
		priority := domain.Priority(value)
		if !priority.Valid() {
			return filter, errors.New("priority is invalid")
		}
		filter.Priority = &priority
	}
	if value := r.URL.Query().Get("source_feature"); value != "" {
		source := domain.SourceFeature(value)
		if !source.Valid() {
			return filter, errors.New("source_feature is invalid")
		}
		filter.SourceFeature = &source
	}
	if value := r.URL.Query().Get("state"); value != "" {
		state := domain.State(value)
		if !state.Valid() {
			return filter, errors.New("state is invalid")
		}
		filter.State = &state
	}
	limit, err := parseBoundedInt(r.URL.Query().Get("limit"), 25, 1, 100, "limit")
	if err != nil {
		return filter, err
	}
	offset, err := parseBoundedInt(r.URL.Query().Get("offset"), 0, 0, 100000, "offset")
	if err != nil {
		return filter, err
	}
	filter.Limit = limit
	filter.Offset = offset
	return filter, nil
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

func decodeActionBody(w http.ResponseWriter, r *http.Request, target *actionRequest) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxActionBodyBytes)
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

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": message, "code": code})
}
