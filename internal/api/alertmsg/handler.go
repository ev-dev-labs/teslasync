package alertmsg

import (
	"encoding/json"
	"io"
	"net/http"

	alertmsgcore "github.com/ev-dev-labs/teslasync/internal/alertmsg"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
	"github.com/rs/zerolog/log"
)

const maxAlertRequestBodyBytes = 1 << 20

// AlertMessageHandler serves the three read-only helper endpoints the
// Alert Studio editor uses to render the message-template picker:
//
//   - GET  /api/v1/alerts/message-presets    -> []alertmsg.Preset
//   - GET  /api/v1/alerts/message-placeholders -> []alertmsg.Placeholder
//   - POST /api/v1/alerts/message-preview    -> {title, body}
//
// Each endpoint accepts the same rule-shaped query/body the editor
// already builds for createAlertRuleRequest, so the frontend can call
// them with the draft rule the user is editing — no special preview DTO is needed.
type AlertMessageHandler struct{}

// NewAlertMessageHandler returns a stateless handler. Endpoints only
// read from the embedded preset catalog + the protomodel signal map,
// neither of which require any per-request dependency.
func NewAlertMessageHandler() *AlertMessageHandler {
	return &AlertMessageHandler{}
}

// alertMessagePreviewRequest accepts the editor's draft rule shape
// plus an optional sample-signals map. The handler builds an
// alertmsg.Context from these inputs and returns the title/body the
// dispatch layer would emit.
//
// The fields mirror createAlertRuleRequest where they overlap so the
// frontend can pass the form state directly; everything is optional
// because the editor may call this before all required fields are
// filled in.
type alertMessagePreviewRequest struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	SignalName  string `json:"signal_name"`
	Op          string `json:"op"`
	Severity    string `json:"severity"`
	VehicleName string `json:"vehicle_name"`

	ValueNum  *float64 `json:"value_num"`
	ValueText *string  `json:"value_text"`
	ValueBool *bool    `json:"value_bool"`
	ValueMin  *float64 `json:"value_min"`
	ValueMax  *float64 `json:"value_max"`

	MetricID        *string  `json:"metric_id"`
	MetricWindow    *string  `json:"metric_window"`
	MetricThreshold *float64 `json:"metric_threshold"`
	MetricOp        *string  `json:"metric_op"`

	MsgTemplate  *string `json:"msg_template"`
	IncludeTitle *bool   `json:"include_title"`

	// Signals is an optional sample-data map. Keys are signal names
	// (matching protomodel field names); values can be anything that
	// json.Unmarshal produces (numbers, strings, bools). Missing keys
	// fall back to a hard-coded sample value per the triggering
	// signal's ValueKind so the preview is never visually empty.
	Signals map[string]any `json:"signals"`
}

type alertMessagePreviewResponse struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// MessagePresets returns the curated preset gallery, filtered by the
// requested rule kind. Query parameter `kind` is optional; when
// omitted, all presets (signal + computed_metric + universal) are
// returned. Used by the editor's "Pick a preset" dialog.
func (h *AlertMessageHandler) MessagePresets(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	var rule *alertmodel.AlertRule
	if kind != "" {
		rule = &alertmodel.AlertRule{Kind: kind}
	}
	out := alertmsgcore.Presets(rule)
	httpx.WriteJSON(w, http.StatusOK, out)
}

// MessagePlaceholders returns the autocomplete catalog for the given
// rule shape. Query params: `kind`, `signal_name`, `op`. Used by the
// editor's `{{` popover and the "Insert placeholder" toolbar button.
func (h *AlertMessageHandler) MessagePlaceholders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rule := &alertmodel.AlertRule{
		Kind:       q.Get("kind"),
		SignalName: q.Get("signal_name"),
		Op:         q.Get("op"),
	}
	if mid := q.Get("metric_id"); mid != "" {
		rule.MetricID = &mid
	}
	out := alertmsgcore.Placeholders(rule)
	httpx.WriteJSON(w, http.StatusOK, out)
}

// MessagePreview renders the title/body the dispatch layer would emit
// for the draft rule + sample signal map sent in the request body.
// Used by the editor's live preview panel so the user sees the actual
// rendered output BEFORE saving the rule.
//
// The preview deliberately reuses alertmsg.BuildContext + RenderTitle +
// RenderBody — the exact same code path as production — so it can
// never drift from real notifications.
func (h *AlertMessageHandler) MessagePreview(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, maxAlertRequestBodyBytes))
	if err != nil {
		log.Warn().Err(err).Str("handler", "MessagePreview").Msg("failed to read alert message-preview request body")
		httpx.WriteError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var req alertMessagePreviewRequest
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			log.Warn().Err(err).Str("handler", "MessagePreview").Msg("invalid JSON in alert message-preview request")
			httpx.WriteError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
	}

	rule := previewRuleFromRequest(&req)
	signals := req.Signals
	if signals == nil {
		signals = map[string]any{}
	}
	// Hydrate a sensible default for the triggering signal when the
	// caller didn't supply one, so the preview shows something
	// non-empty even on a fresh form load.
	hydrateSampleValue(rule, signals)

	builtins := map[string]any{}
	if rule.Severity != "" {
		builtins["Severity"] = rule.Severity
	}
	if rule.Kind == "computed_metric" {
		// Sample metric values — chosen to make the percent-change
		// template look right ("12% vs prior 24h") without surprising
		// the user with random numbers.
		if _, ok := signals["MetricValue"]; !ok {
			builtins["MetricValue"] = 92.4
		}
		if _, ok := signals["MetricPrevValue"]; !ok {
			builtins["MetricPrevValue"] = 82.5
		}
		if _, ok := signals["MetricChangePct"]; !ok {
			builtins["MetricChangePct"] = 12.0
		}
	}

	ctx := alertmsgcore.BuildContext(rule, req.VehicleName, signals, builtins)
	title := alertmsgcore.RenderTitle(rule, ctx)
	bodyOut := alertmsgcore.RenderBody(rule, ctx)
	if !rule.IncludeTitle && bodyOut == "" {
		bodyOut = rule.Name
	}
	httpx.WriteJSON(w, http.StatusOK, alertMessagePreviewResponse{Title: title, Body: bodyOut})
}

// previewRuleFromRequest builds a transient *alertmodel.AlertRule from the
// preview request body. It does NOT call validateAlertRule — the
// preview path is for previewing, not validating, so a half-filled
// draft should still render something. Fields not supplied default to
// their zero values.
func previewRuleFromRequest(req *alertMessagePreviewRequest) *alertmodel.AlertRule {
	rule := &alertmodel.AlertRule{
		Name:            req.Name,
		Kind:            req.Kind,
		SignalName:      req.SignalName,
		Op:              req.Op,
		Severity:        req.Severity,
		ValueNum:        req.ValueNum,
		ValueText:       req.ValueText,
		ValueBool:       req.ValueBool,
		ValueMin:        req.ValueMin,
		ValueMax:        req.ValueMax,
		MetricID:        req.MetricID,
		MetricWindow:    req.MetricWindow,
		MetricThreshold: req.MetricThreshold,
		MetricOp:        req.MetricOp,
		MsgTemplate:     req.MsgTemplate,
		// Default IncludeTitle to TRUE so the preview matches the
		// editor's default-on behaviour for new rules. Callers that
		// want the body-only preview must send `"include_title": false`.
		IncludeTitle: req.IncludeTitle == nil || *req.IncludeTitle,
	}
	if rule.Name == "" {
		rule.Name = "Sample Rule"
	}
	return rule
}

// hydrateSampleValue writes a placeholder value into signals[rule.SignalName]
// if the caller didn't supply one. The chosen value tracks the rule's
// configured operator so the rendered body looks realistic:
//
//   - numeric ops (<, <=, >, >=, =, !=)         -> a sample number near the threshold
//   - between / outside                         -> midpoint of [min, max]
//   - state-change against text                 -> the configured text value
//   - state-change against bool                 -> the configured bool value
//   - everything else                           -> "sample"
func hydrateSampleValue(rule *alertmodel.AlertRule, signals map[string]any) {
	if rule == nil || rule.SignalName == "" {
		return
	}
	if _, ok := signals[rule.SignalName]; ok {
		return
	}
	switch rule.Op {
	case "<", "<=", ">", ">=", "=", "!=":
		if rule.ValueNum != nil {
			// Pick a value slightly past the threshold so the
			// rendered body looks like a real trip.
			delta := 1.5
			switch rule.Op {
			case "<", "<=":
				signals[rule.SignalName] = *rule.ValueNum - delta
			case ">", ">=":
				signals[rule.SignalName] = *rule.ValueNum + delta
			default:
				signals[rule.SignalName] = *rule.ValueNum
			}
			return
		}
		if rule.ValueText != nil {
			signals[rule.SignalName] = *rule.ValueText
			return
		}
		if rule.ValueBool != nil {
			signals[rule.SignalName] = *rule.ValueBool
			return
		}
	case "between", "outside":
		if rule.ValueMin != nil && rule.ValueMax != nil {
			signals[rule.SignalName] = (*rule.ValueMin + *rule.ValueMax) / 2
			return
		}
	case "changed":
		if rule.ValueText != nil {
			signals[rule.SignalName] = *rule.ValueText
			return
		}
		if rule.ValueBool != nil {
			signals[rule.SignalName] = *rule.ValueBool
			return
		}
	}
	signals[rule.SignalName] = "sample"
}
