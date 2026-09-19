package aialertpacks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	alertpackbuilder "github.com/ev-dev-labs/teslasync/internal/ai/strategies/alert-pack-builder"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
)

type Handler struct {
	registry *provider.Registry
	tools    *tools.Registry
	header   string
}

func NewHandler(registry *provider.Registry, toolRegistry *tools.Registry, header string) *Handler {
	return &Handler{registry: registry, tools: toolRegistry, header: header}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.ai.alert_packs.draft")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	var body struct {
		Goal string `json:"goal"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&body)
	if err == nil {
		if trailingErr := decoder.Decode(new(any)); !errors.Is(trailingErr, io.EOF) {
			err = errors.New("request must contain one JSON object")
		}
	}
	if err != nil || len([]rune(strings.TrimSpace(body.Goal))) < 5 || len([]rune(body.Goal)) > 2000 {
		if err != nil {
			span.RecordError(err)
		}
		httpx.WriteError(w, http.StatusBadRequest, "goal must contain 5 to 2000 characters")
		return
	}
	subject, _ := tsauth.SubjectFromRequest(r, h.header)
	ctx = provider.WithSubject(ctx, subject)
	ctx = provider.WithFeatureID(ctx, alertpackbuilder.FeatureID)
	prov, err := h.registry.For(ctx, alertpackbuilder.FeatureID)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("alert pack AI provider unavailable")
		httpx.WriteError(w, http.StatusBadGateway, "AI provider unavailable")
		return
	}
	writer, ctx, err := stream.New(ctx, w, stream.WithFeatureID(alertpackbuilder.FeatureID))
	if err != nil {
		span.RecordError(err)
		httpx.WriteError(w, http.StatusInternalServerError, "streaming unavailable")
		return
	}
	deny := func(context.Context, dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
		return dispatch.ConfirmDenied, nil
	}
	dispatcher := dispatch.New(h.tools, prov, deny, 4)
	if err := dispatcher.Run(ctx, alertpackbuilder.New(), strategy.StrategyInput{LastMessage: body.Goal}, writer); err != nil {
		span.RecordError(err)
		log.Error().Err(err).Str("trace_id", span.SpanContext().TraceID().String()).Msg("alert pack proposal failed")
	}
}
