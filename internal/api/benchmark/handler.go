package benchmark

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbbenchmark "github.com/ev-dev-labs/teslasync/internal/database/benchmark"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type benchmarkService interface {
	Status(context.Context, string, int64) (*models.PrivacyBenchmarkStatus, error)
	Consent(context.Context, string, int64) (*models.PrivacyBenchmarkStatus, error)
	Revoke(context.Context, string, int64) error
	CreateRelease(context.Context, string, int64, time.Time) (*models.PrivacyBenchmarkRelease, error)
	ListReleases(context.Context, string, int64, int, int) (*models.PrivacyBenchmarkReleasePage, error)
}

type Handler struct {
	service    benchmarkService
	headerName string
}

func NewBenchmarkHandler(db *database.DB, forwardAuthHeader string) *Handler {
	repo := dbbenchmark.NewRepo(db)
	return &Handler{service: NewService(repo), headerName: strings.TrimSpace(forwardAuthHeader)}
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "benchmark.privacy_status")
	defer span.End()

	subject, ok := h.requireSubject(w, r)
	if !ok {
		return
	}
	vehicleID, ok := queryVehicleID(w, r)
	if !ok {
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	status, err := h.service.Status(ctx, subject, vehicleID)
	if err != nil {
		h.internalError(w, span, "privacy benchmark status failed", err, vehicleID)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

type consentRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

func (h *Handler) Consent(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "benchmark.consent")
	defer span.End()

	subject, ok := h.requireSubject(w, r)
	if !ok {
		return
	}
	var request consentRequest
	if err := decodeBody(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if request.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	status, err := h.service.Consent(ctx, subject, request.VehicleID)
	if err != nil {
		switch {
		case errors.Is(err, ErrVehicleNotFound):
			httpx.WriteError(w, http.StatusNotFound, "vehicle not found")
		case errors.Is(err, ErrVehicleAlreadyOptedIn):
			httpx.WriteError(w, http.StatusConflict, "vehicle already participates under another user")
		default:
			h.internalError(w, span, "privacy benchmark consent failed", err, request.VehicleID)
		}
		return
	}
	httpx.WriteJSON(w, http.StatusOK, status)
}

func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "benchmark.revoke")
	defer span.End()

	subject, ok := h.requireSubject(w, r)
	if !ok {
		return
	}
	vehicleID, ok := queryVehicleID(w, r)
	if !ok {
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", vehicleID))
	if err := h.service.Revoke(ctx, subject, vehicleID); err != nil {
		if errors.Is(err, ErrConsentNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "benchmark consent not found")
			return
		}
		h.internalError(w, span, "privacy benchmark revoke failed", err, vehicleID)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type releaseRequest struct {
	VehicleID int64   `json:"vehicle_id"`
	PeriodEnd *string `json:"period_end"`
}

func (h *Handler) CreateRelease(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "benchmark.create_release")
	defer span.End()

	subject, ok := h.requireSubject(w, r)
	if !ok {
		return
	}
	var request releaseRequest
	if err := decodeBody(r, &request); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if request.VehicleID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return
	}
	periodEnd, err := parsePeriodEnd(request.PeriodEnd, time.Now().UTC())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	span.SetAttributes(attribute.Int64("vehicle_id", request.VehicleID))
	release, err := h.service.CreateRelease(ctx, subject, request.VehicleID, periodEnd)
	if err != nil {
		if errors.Is(err, ErrConsentRequired) {
			httpx.WriteError(w, http.StatusForbidden, "benchmark opt-in is required")
			return
		}
		h.internalError(w, span, "privacy benchmark release failed", err, request.VehicleID)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, release)
}

func (h *Handler) ListReleases(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "benchmark.list_releases")
	defer span.End()

	subject, ok := h.requireSubject(w, r)
	if !ok {
		return
	}
	vehicleID, ok := queryVehicleID(w, r)
	if !ok {
		return
	}
	limit, offset, ok := pagination(w, r)
	if !ok {
		return
	}
	span.SetAttributes(
		attribute.Int64("vehicle_id", vehicleID),
		attribute.Int("limit", limit),
		attribute.Int("offset", offset),
	)
	page, err := h.service.ListReleases(ctx, subject, vehicleID, limit, offset)
	if err != nil {
		if errors.Is(err, ErrConsentRequired) {
			httpx.WriteError(w, http.StatusForbidden, "benchmark opt-in is required")
			return
		}
		h.internalError(w, span, "privacy benchmark release list failed", err, vehicleID)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, page)
}

func (h *Handler) requireSubject(w http.ResponseWriter, r *http.Request) (string, bool) {
	if tsauth.IsOpenMode(h.headerName) {
		httpx.WriteError(w, http.StatusNotImplemented, "privacy benchmarks require forward-auth mode")
		return "", false
	}
	subject, ok := tsauth.SubjectFromRequest(r, h.headerName)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "missing identity header")
		return "", false
	}
	return subject, true
}

func (h *Handler) internalError(
	w http.ResponseWriter,
	span trace.Span,
	message string,
	err error,
	vehicleID int64,
) {
	span.RecordError(err)
	span.SetStatus(codes.Error, message)
	log.Error().
		Err(err).
		Str("trace_id", span.SpanContext().TraceID().String()).
		Int64("vehicle_id", vehicleID).
		Msg(message)
	httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
}

func queryVehicleID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("vehicle_id"))
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "vehicle_id must be a positive integer")
		return 0, false
	}
	return value, true
}

func pagination(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	limit := 20
	offset := 0
	var err error
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			httpx.WriteError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return 0, 0, false
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		offset, err = strconv.Atoi(raw)
		if err != nil || offset < 0 {
			httpx.WriteError(w, http.StatusBadRequest, "offset must be zero or greater")
			return 0, 0, false
		}
	}
	return limit, offset, true
}

func parsePeriodEnd(raw *string, now time.Time) (time.Time, error) {
	maximum := defaultCompletedPeriodEnd(now)
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return maximum, nil
	}
	value, err := time.Parse("2006-01-02", strings.TrimSpace(*raw))
	if err != nil {
		return time.Time{}, errors.New("period_end must use YYYY-MM-DD")
	}
	value = value.UTC()
	if value.Day() != 1 {
		return time.Time{}, errors.New("period_end must be the first day of a UTC month")
	}
	if value.After(maximum) {
		return time.Time{}, errors.New("period_end cannot include the current incomplete month")
	}
	if value.Before(maximum.AddDate(-5, 0, 0)) {
		return time.Time{}, errors.New("period_end is outside the five-year retention window")
	}
	return value, nil
}

func decodeBody(r *http.Request, destination any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain exactly one JSON object")
	}
	return nil
}
