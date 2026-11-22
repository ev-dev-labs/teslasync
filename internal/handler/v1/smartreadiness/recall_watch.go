package smartreadiness

import (
	"context"
	"errors"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/handler/v1/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type recallWatchService interface {
	Read(context.Context, port.RecallWatchScope) (domain.RecallWatch, error)
	Enable(context.Context, port.RecallWatchScope, int64, domain.RecallWatchSetup) error
	Disable(context.Context, port.RecallWatchScope, int64) error
}

func WithRecallWatch(service recallWatchService) Option {
	return func(h *Handler) { h.recallWatch = service }
}

func (h *Handler) RecallWatch(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "service_intelligence.recall_watch")
	defer span.End()
	subject, ok := personal.Subject(w, r, h.headerName, "private recall watch")
	if !ok {
		return
	}
	if subject == personaldomain.OpenSubject || subject == "open-mode" {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_SCOPE_REQUIRED", "recall watch requires verified sign-in")
		return
	}
	vehicleID, err := positiveID(r.URL.Query().Get("vehicle_id"))
	if err != nil {
		h.handleError(w, span, smartreadinesssvc.ErrInvalidInput)
		return
	}
	scope := port.RecallWatchScope{Subject: subject, VehicleID: vehicleID}
	switch r.Method {
	case http.MethodGet:
		var watch domain.RecallWatch
		watch, err = h.recallWatch.Read(ctx, scope)
		if err == nil {
			httputil.Respond(w, http.StatusOK, watch)
		}
	case http.MethodPut:
		type submission struct {
			domain.RecallWatchSetup
			ExpectedID     *int64 `json:"expected_watch_id"`
			ModelConfirmed bool   `json:"model_confirmed"`
			NHTSAConfirmed bool   `json:"nhtsa_confirmed"`
		}
		body, decodeErr := decode[submission](w, r)
		if decodeErr != nil || body.ExpectedID == nil || !body.ModelConfirmed || !body.NHTSAConfirmed {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.recallWatch.Enable(ctx, scope, *body.ExpectedID, body.RecallWatchSetup)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	case http.MethodDelete:
		watchID, idErr := positiveID(r.URL.Query().Get("watch_id"))
		if idErr != nil {
			err = smartreadinesssvc.ErrInvalidInput
			break
		}
		err = h.recallWatch.Disable(ctx, scope, watchID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
		}
	}
	if errors.Is(err, port.ErrRecallWatchChanged) {
		httputil.RespondError(w, http.StatusConflict, "RECALL_WATCH_CHANGED", "refresh the private recall watch before changing it")
	} else if err != nil {
		h.handleError(w, span, err)
	}
}
