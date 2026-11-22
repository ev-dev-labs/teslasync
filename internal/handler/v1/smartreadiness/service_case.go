package smartreadiness

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type serviceCaseService interface {
	Read(context.Context, port.ServiceCaseScope) (domain.ServiceCase, error)
	SaveTitle(context.Context, port.ServiceCaseScope, port.ServiceCaseKey, string) error
	Delete(context.Context, port.ServiceCaseScope, port.ServiceCaseKey) error
	AddEvidence(context.Context, port.ServiceCaseScope, port.ServiceCaseKey, domain.ServiceCaseEvidence) error
	RemoveEvidence(context.Context, port.ServiceCaseScope, port.ServiceCaseKey, int64) error
	Preview(context.Context, port.ServiceCaseScope, port.ServiceCaseKey, []domain.ServiceCaseSelection) (domain.ServiceCasePreview, error)
}

func WithServiceCases(service serviceCaseService) Option {
	return func(h *Handler) { h.serviceCases = service }
}

type serviceCaseOperation func(context.Context, http.ResponseWriter, *http.Request, port.ServiceCaseScope) error

func (h *Handler) privateServiceCase(operation serviceCaseOperation) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, span := otel.Tracer("api").Start(r.Context(), "service_intelligence.private_service_case")
		defer span.End()
		subject, ok := personal.Subject(w, r, h.headerName, "service case")
		if !ok {
			return
		}
		if subject == personaldomain.OpenSubject || subject == "open-mode" {
			httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "service cases require verified sign-in")
			return
		}
		vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
		if err == nil {
			err = operation(ctx, w, r, port.ServiceCaseScope{Subject: subject, VehicleID: vehicleID})
		}
		if err != nil {
			respondServiceCaseError(w, span, err)
		}
	}
}

func (h *Handler) readServiceCase(ctx context.Context, w http.ResponseWriter, _ *http.Request, scope port.ServiceCaseScope) error {
	record, err := h.serviceCases.Read(ctx, scope)
	if err == nil {
		switch {
		case record.ID == 0:
			metrics.RecordServiceCaseEvent("no_case")
		case len(record.Evidence) == 0:
			metrics.RecordServiceCaseEvent("no_notes")
		}
		httputil.Respond(w, http.StatusOK, record)
	}
	return err
}

func (h *Handler) saveServiceCase(ctx context.Context, w http.ResponseWriter, r *http.Request, scope port.ServiceCaseScope) error {
	type submission struct {
		ID      *int64 `json:"expected_case_id"`
		Version *int64 `json:"expected_version"`
		Title   string `json:"title"`
	}
	body, err := decode[submission](w, r)
	if err != nil || body.ID == nil || body.Version == nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	return completeServiceCaseWrite(w, h.serviceCases.SaveTitle(ctx, scope, port.ServiceCaseKey{ID: *body.ID, Version: *body.Version}, body.Title))
}

func (h *Handler) deleteServiceCase(ctx context.Context, w http.ResponseWriter, r *http.Request, scope port.ServiceCaseScope) error {
	key, err := serviceCaseKeyQuery(r)
	if err != nil {
		return err
	}
	return completeServiceCaseWrite(w, h.serviceCases.Delete(ctx, scope, key))
}

func (h *Handler) appendServiceCaseEvidence(ctx context.Context, w http.ResponseWriter, r *http.Request, scope port.ServiceCaseScope) error {
	type submission struct {
		port.ServiceCaseKey
		Kind       domain.ServiceCaseKind `json:"kind"`
		ObservedAt time.Time              `json:"observed_at"`
		Detail     string                 `json:"detail"`
	}
	body, err := decode[submission](w, r)
	if err != nil {
		return smartreadinesssvc.ErrInvalidInput
	}
	evidence := domain.ServiceCaseEvidence{Kind: body.Kind, ObservedAt: body.ObservedAt, Detail: body.Detail}
	return completeServiceCaseWrite(w, h.serviceCases.AddEvidence(ctx, scope, body.ServiceCaseKey, evidence))
}

func (h *Handler) removeServiceCaseEvidence(ctx context.Context, w http.ResponseWriter, r *http.Request, scope port.ServiceCaseScope) error {
	key, err := serviceCaseKeyQuery(r)
	if err != nil {
		return err
	}
	id, err := positiveID(chi.URLParam(r, "evidenceID"))
	if err != nil {
		return err
	}
	return completeServiceCaseWrite(w, h.serviceCases.RemoveEvidence(ctx, scope, key, id))
}

func (h *Handler) reviewServiceCase(export bool) serviceCaseOperation {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, scope port.ServiceCaseScope) error {
		type submission struct {
			port.ServiceCaseKey
			Selection []domain.ServiceCaseSelection `json:"selection"`
			Reviewed  string                        `json:"reviewed_digest"`
		}
		body, err := decode[submission](w, r)
		if err != nil {
			return smartreadinesssvc.ErrInvalidInput
		}
		doc, err := h.serviceCases.Preview(ctx, scope, body.ServiceCaseKey, body.Selection)
		if err != nil {
			if errors.Is(err, smartreadinesssvc.ErrInvalidInput) {
				metrics.RecordServiceCaseEvent("selection_rejected")
			}
			return err
		}
		payload, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return fmt.Errorf("encode private service case: %w", err)
		}
		digest := sha256.Sum256(payload)
		reviewed := hex.EncodeToString(digest[:])
		if !export {
			metrics.RecordServiceCaseEvent("preview_ready")
			httputil.Respond(w, http.StatusOK, struct {
				Document domain.ServiceCasePreview `json:"document"`
				Digest   string                    `json:"digest"`
			}{Document: doc, Digest: reviewed})
			return nil
		}
		if body.Reviewed != reviewed {
			return port.ErrServiceCaseChanged
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="service-case-evidence.json"`)
		if _, err := w.Write(payload); err == nil {
			metrics.RecordServiceCaseEvent("download_served")
		}
		return nil
	}
}

func completeServiceCaseWrite(w http.ResponseWriter, err error) error {
	if err == nil {
		w.WriteHeader(http.StatusNoContent)
	}
	return err
}

func serviceCaseKeyQuery(r *http.Request) (port.ServiceCaseKey, error) {
	id, idErr := positiveID(r.URL.Query().Get("case_id"))
	version, versionErr := positiveID(r.URL.Query().Get("version"))
	if idErr != nil || versionErr != nil {
		return port.ServiceCaseKey{}, smartreadinesssvc.ErrInvalidInput
	}
	return port.ServiceCaseKey{ID: id, Version: version}, nil
}

func respondServiceCaseError(w http.ResponseWriter, span trace.Span, err error) {
	switch {
	case errors.Is(err, smartreadinesssvc.ErrInvalidInput):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid service case or evidence selection")
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle is unavailable")
	case errors.Is(err, port.ErrServiceCaseChanged):
		metrics.RecordServiceCaseEvent("case_changed")
		httputil.RespondError(w, http.StatusConflict, "SERVICE_CASE_CHANGED", "refresh and review the current case before proceeding")
	case errors.Is(err, port.ErrServiceCaseFull):
		httputil.RespondError(w, http.StatusConflict, "SERVICE_CASE_FULL", "service case evidence limit reached")
	default:
		const message = "private service case request failed"
		span.RecordError(errors.New(message))
		span.SetStatus(codes.Error, message)
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(message)
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", message)
	}
}
