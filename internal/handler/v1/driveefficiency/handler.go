// Package driveefficiency serves private, opt-in weekly drive reviews.
package driveefficiency

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveefficiencysvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	personalhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/driveefficiency"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
)

type reviewService interface {
	Read(context.Context, port.Scope) (port.State, error)
	Save(context.Context, port.Scope, domain.Settings) error
	Dismiss(context.Context, port.Scope, int64, time.Time) error
	Clear(context.Context, port.Scope, int64) error
}

type Handler struct {
	service    reviewService
	headerName string
}

func NewHandler(service reviewService, header string) *Handler {
	return &Handler{service: service, headerName: header}
}

func (h *Handler) Review(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "driving.weekly_efficiency_digest")
	defer span.End()
	subject, ok := personalhandler.Subject(w, r, h.headerName, "weekly drive efficiency digest")
	if !ok {
		return
	}
	if subject == personal.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "weekly drive reviews require a verified sign-in")
		return
	}
	vehicle, err := strconv.ParseInt(r.URL.Query().Get("vehicle_id"), 10, 64)
	if err != nil || vehicle <= 0 {
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "vehicle_id must be positive")
		return
	}
	scope := port.Scope{Subject: subject, VehicleID: vehicle}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var outcome string
	switch r.Method {
	case http.MethodGet:
		var state port.State
		state, err = h.service.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, state)
		}
	case http.MethodPut:
		body, decodeErr := httputil.DecodeAndValidate[struct {
			Revision  *int64 `json:"expected_revision"`
			TimeZone  string `json:"time_zone"`
			Paused    bool   `json:"paused"`
			Confirmed bool   `json:"confirmed"`
		}](r)
		if decodeErr != nil || body.Revision == nil || !body.Paused && !body.Confirmed {
			err = driveefficiencysvc.ErrInvalid
			break
		}
		err = h.service.Save(ctx, scope, domain.Settings{Revision: *body.Revision, TimeZone: body.TimeZone, Paused: body.Paused})
		outcome = "confirmed"
		if body.Paused {
			outcome = "paused"
		}
	case http.MethodPatch:
		body, decodeErr := httputil.DecodeAndValidate[struct {
			Revision int64     `json:"expected_revision"`
			Until    time.Time `json:"recent_until"`
		}](r)
		if decodeErr != nil {
			err = driveefficiencysvc.ErrInvalid
			break
		}
		err = h.service.Dismiss(ctx, scope, body.Revision, body.Until)
		outcome = "dismissed"
	case http.MethodDelete:
		var revision int64
		revision, err = strconv.ParseInt(r.URL.Query().Get("expected_revision"), 10, 64)
		if err != nil {
			err = driveefficiencysvc.ErrInvalid
			break
		}
		err = h.service.Clear(ctx, scope, revision)
		outcome = "cleared"
	}
	switch {
	case errors.Is(err, port.ErrNotFound):
		httputil.RespondError(w, http.StatusNotFound, "NOT_FOUND", "vehicle not available")
	case errors.Is(err, port.ErrChanged):
		httputil.RespondError(w, http.StatusConflict, "WEEKLY_EFFICIENCY_CHANGED", "refresh the private weekly digest before acting")
	case errors.Is(err, driveefficiencysvc.ErrParked):
		httputil.RespondError(w, http.StatusConflict, "WEEKLY_EFFICIENCY_PARKED_REQUIRED", "park the scoped vehicle before reviewing the weekly digest")
	case errors.Is(err, driveefficiencysvc.ErrInvalid):
		httputil.RespondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "provide valid private review settings")
	case err != nil:
		failure := errors.New("private weekly efficiency operation failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		httputil.RespondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", failure.Error())
	case outcome != "":
		metrics.RecordWeeklyDriveEfficiency(outcome, 1)
		w.WriteHeader(http.StatusNoContent)
	}
}
