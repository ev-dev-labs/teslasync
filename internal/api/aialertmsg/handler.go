package aialertmsg

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	alertmsgtemplatesuggestion "github.com/ev-dev-labs/teslasync/internal/ai/strategies/alert-message-template-suggestion"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
)

const maxIterations = 6
const maxBodyBytes = 16 * 1024

type request struct {
	Kind            string   `json:"kind"`
	SignalName      string   `json:"signal_name"`
	Op              string   `json:"op"`
	Severity        string   `json:"severity"`
	Name            string   `json:"name"`
	ValueNum        *float64 `json:"value_num"`
	ValueText       *string  `json:"value_text"`
	ValueBool       *bool    `json:"value_bool"`
	MetricID        string   `json:"metric_id"`
	MetricWindow    string   `json:"metric_window"`
	MetricOp        string   `json:"metric_op"`
	MetricThreshold *float64 `json:"metric_threshold"`
}

// Handler serves POST /api/v1/ai/alerts/message-template/draft.
type Handler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewHandler panics on nil boot wiring.
func NewHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *Handler {
	switch {
	case registry == nil:
		panic("aialertmsg: NewHandler: nil provider.Registry")
	case toolReg == nil:
		panic("aialertmsg: NewHandler: nil tools.Registry")
	case strat == nil:
		panic("aialertmsg: NewHandler: nil strategy.Strategy")
	}
	return &Handler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   maxIterations,
	}
}

func denyAllConfirm(_ context.Context, _ dispatch.ConfirmRequest) (dispatch.ConfirmDecision, error) {
	return dispatch.ConfirmDenied, nil
}

func parseRequest(r *http.Request) (*request, []byte, error) {
	if r.Body == nil {
		return nil, nil, fmt.Errorf("request body is required")
	}
	defer r.Body.Close()
	limited := io.LimitReader(r.Body, maxBodyBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, nil, fmt.Errorf("read body: %w", err)
	}
	if len(raw) > maxBodyBytes {
		return nil, nil, fmt.Errorf("request body too large")
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil, nil, fmt.Errorf("request body is required")
	}
	var body request
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, nil, fmt.Errorf("invalid JSON body")
	}
	body.Kind = strings.TrimSpace(body.Kind)
	body.SignalName = strings.TrimSpace(body.SignalName)
	body.Op = strings.TrimSpace(body.Op)
	body.Severity = strings.TrimSpace(body.Severity)
	body.Name = strings.TrimSpace(body.Name)
	body.MetricID = strings.TrimSpace(body.MetricID)
	body.MetricWindow = strings.TrimSpace(body.MetricWindow)
	body.MetricOp = strings.TrimSpace(body.MetricOp)
	if body.Kind != "signal" && body.Kind != "computed_metric" {
		return nil, nil, fmt.Errorf("kind must be signal or computed_metric")
	}
	if body.Kind == "signal" {
		if body.SignalName == "" {
			return nil, nil, fmt.Errorf("signal_name is required for kind=signal")
		}
		if body.Op == "" {
			return nil, nil, fmt.Errorf("op is required for kind=signal")
		}
	}
	if body.Kind == "computed_metric" && body.MetricID == "" {
		return nil, nil, fmt.Errorf("metric_id is required for kind=computed_metric")
	}
	return &body, raw, nil
}

// ServeHTTP streams a propose-only template suggestion.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, raw, err := parseRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	if _, err := h.registry.For(r.Context(), alertmsgtemplatesuggestion.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai alert-message-template-suggestion: provider.For failed")
		httpx.WriteError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, alertmsgtemplatesuggestion.FeatureID)

	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(alertmsgtemplatesuggestion.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai alert-message-template-suggestion: stream.New failed")
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	prov, err := h.registry.For(ctx, alertmsgtemplatesuggestion.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai alert-message-template-suggestion: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)
	userMsg := fmt.Sprintf(
		"Write a distinctive Tesla-owner notification body for this alert — not a bland threshold line. "+
			"kind=%s signal_name=%q op=%q severity=%q metric_id=%q metric_op=%q. "+
			"Caller JSON (copy numeric operands and range bounds exactly): %s. "+
			"Call draft_alert_message_template FIRST with these exact dimensions, "+
			"follow writing_brief, remix fun/verbose related_presets, "+
			"compose a voiceful 1-2 sentence template using only allowed_placeholders, "+
			"then call validate_alert_message_template. "+
			"Do NOT copy '{{SignalName}} is {{Value}} (threshold {{Threshold}})'. "+
			"Do NOT save the template; the user applies it in Alert Studio.",
		body.Kind, body.SignalName, body.Op, body.Severity, body.MetricID, body.MetricOp,
		string(raw),
	)

	in := strategy.StrategyInput{LastMessage: userMsg}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Str("kind", body.Kind).
			Str("signal_name", body.SignalName).
			Msg("ai alert-message-template-suggestion: dispatcher returned error")
	}
}

var _ http.Handler = (*Handler)(nil)
