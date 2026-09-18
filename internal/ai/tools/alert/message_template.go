// Propose-only tools for Alert Studio message templates.
//
//   - draft_alert_message_template  — accept the user's selected alert
//     dimensions and return the placeholder catalog + related presets
//     that alertmsg would offer for that rule shape. No LLM invention
//     of allowed tokens: the catalog is the same Placeholders()/Presets()
//     surface the deterministic editor already uses.
//   - validate_alert_message_template — accept a proposed template and
//     report whether every {{placeholder}} is in that catalog and the
//     body is within MaxTemplateLength. Nothing is persisted.
//
// The dispatcher deny-all confirm gate is never reached: Mutates() is
// false. Saving still flows through the existing Alert Studio Save
// button (POST/PUT /api/v1/alerts/rules) after the user clicks Apply.

package alert

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/alertmsg"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

const relatedPresetLimit = 8

// alertMessageTemplateInput is the typed shape both tools share.
// Fields mirror the Alert Studio draft the SPA already sends to
// /alerts/message-preview so the LLM cannot invent a different
// rule kind, signal, or operator than the user selected.
type alertMessageTemplateInput struct {
	Kind       string   `json:"kind" validate:"required,oneof=signal computed_metric" desc:"Alert rule kind: signal or computed_metric."`
	SignalName string   `json:"signal_name,omitempty" validate:"omitempty,lte=128" desc:"Canonical signal identifier for kind=signal."`
	Op         string   `json:"op,omitempty" validate:"omitempty,lte=16" desc:"Comparison operator for signal rules."`
	Severity   string   `json:"severity,omitempty" validate:"omitempty,oneof=info warn critical" desc:"Severity tier: info, warn, or critical."`
	Name       string   `json:"name,omitempty" validate:"omitempty,lte=200" desc:"Optional rule name used only as placeholder context."`
	ValueNum   *float64 `json:"value_num,omitempty" desc:"Numeric operand."`
	ValueText  *string  `json:"value_text,omitempty" desc:"Text operand."`
	ValueBool  *bool    `json:"value_bool,omitempty" desc:"Boolean operand."`
	ValueMin   *float64 `json:"value_min,omitempty" desc:"Lower bound for between/outside."`
	ValueMax   *float64 `json:"value_max,omitempty" desc:"Upper bound for between/outside."`

	MetricID        string   `json:"metric_id,omitempty" validate:"omitempty,lte=128" desc:"Computed metric identifier for kind=computed_metric."`
	MetricWindow    string   `json:"metric_window,omitempty" validate:"omitempty,lte=32" desc:"Computed metric window."`
	MetricOp        string   `json:"metric_op,omitempty" validate:"omitempty,lte=32" desc:"Computed metric operator."`
	MetricThreshold *float64 `json:"metric_threshold,omitempty" desc:"Computed metric threshold."`
}

type alertMessageTemplateValidateInput struct {
	Kind            string   `json:"kind" validate:"required,oneof=signal computed_metric" desc:"Alert rule kind: signal or computed_metric."`
	SignalName      string   `json:"signal_name,omitempty" validate:"omitempty,lte=128" desc:"Canonical signal identifier for kind=signal."`
	Op              string   `json:"op,omitempty" validate:"omitempty,lte=16" desc:"Comparison operator for signal rules."`
	Severity        string   `json:"severity,omitempty" validate:"omitempty,oneof=info warn critical" desc:"Severity tier: info, warn, or critical."`
	Name            string   `json:"name,omitempty" validate:"omitempty,lte=200" desc:"Optional rule name used only as placeholder context."`
	ValueNum        *float64 `json:"value_num,omitempty" desc:"Numeric operand."`
	ValueText       *string  `json:"value_text,omitempty" desc:"Text operand."`
	ValueBool       *bool    `json:"value_bool,omitempty" desc:"Boolean operand."`
	ValueMin        *float64 `json:"value_min,omitempty" desc:"Lower bound for between/outside."`
	ValueMax        *float64 `json:"value_max,omitempty" desc:"Upper bound for between/outside."`
	MetricID        string   `json:"metric_id,omitempty" validate:"omitempty,lte=128" desc:"Computed metric identifier for kind=computed_metric."`
	MetricWindow    string   `json:"metric_window,omitempty" validate:"omitempty,lte=32" desc:"Computed metric window."`
	MetricOp        string   `json:"metric_op,omitempty" validate:"omitempty,lte=32" desc:"Computed metric operator."`
	MetricThreshold *float64 `json:"metric_threshold,omitempty" desc:"Computed metric threshold."`
	Template        string   `json:"template" validate:"required,gte=1,lte=1024" desc:"Proposed message template body using {{placeholder}} tokens."`
}

type placeholderRef struct {
	Key   string `json:"key"`
	Group string `json:"group"`
}

type relatedPresetRef struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Template string   `json:"template"`
	Tags     []string `json:"tags,omitempty"`
}

type alertMessageTemplateDraftOutput struct {
	Kind                string             `json:"kind"`
	SignalName          string             `json:"signal_name,omitempty"`
	Op                  string             `json:"op,omitempty"`
	Severity            string             `json:"severity,omitempty"`
	MetricID            string             `json:"metric_id,omitempty"`
	AllowedPlaceholders []placeholderRef   `json:"allowed_placeholders"`
	RelatedPresets      []relatedPresetRef `json:"related_presets"`
	WritingBrief        string             `json:"writing_brief,omitempty"`
	Status              string             `json:"status"`
	ValidationError     string             `json:"validation_error,omitempty"`
}

type alertMessageTemplateValidateOutput struct {
	Status           string   `json:"status"`
	Template         string   `json:"template,omitempty"`
	UsedPlaceholders []string `json:"used_placeholders,omitempty"`
	UnknownKeys      []string `json:"unknown_keys,omitempty"`
	Errors           []string `json:"errors,omitempty"`
	ValidationError  string   `json:"validation_error,omitempty"`
}

type draftAlertMessageTemplate struct{}

func (t *draftAlertMessageTemplate) Name() string { return "draft_alert_message_template" }

func (t *draftAlertMessageTemplate) Description() string {
	return "Return the placeholder catalog, related presets, and writing_brief for the caller's selected alert dimensions (kind, signal_name or metric_id, op, severity, thresholds). " +
		"PROPOSE-ONLY: does not save a template. Call this FIRST. Returns {allowed_placeholders, related_presets, writing_brief, status}. " +
		"Follow writing_brief. Prefer related_presets tagged fun or verbose as inspiration — do not copy concise or threshold-comparison presets. " +
		"Then compose a distinctive Tesla-owner template using ONLY allowed_placeholders keys and call validate_alert_message_template."
}

func (t *draftAlertMessageTemplate) InputSchema() json.RawMessage {
	return tools.CachedSchema(alertMessageTemplateInput{})
}

func (t *draftAlertMessageTemplate) OutputSchema() json.RawMessage { return nil }

func (t *draftAlertMessageTemplate) Mutates() bool { return false }

func (t *draftAlertMessageTemplate) RequiredScope() string { return "" }

func (t *draftAlertMessageTemplate) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[alertMessageTemplateInput](raw)
}

func (t *draftAlertMessageTemplate) Execute(_ context.Context, in any) (any, error) {
	input, ok := in.(alertMessageTemplateInput)
	if !ok {
		return nil, fmt.Errorf("draft_alert_message_template: unexpected input type %T", in)
	}
	rule, err := ruleFromTemplateDimensions(input)
	if err != nil {
		return &alertMessageTemplateDraftOutput{
			Kind:            input.Kind,
			SignalName:      input.SignalName,
			Op:              input.Op,
			Severity:        input.Severity,
			MetricID:        input.MetricID,
			Status:          "invalid",
			ValidationError: err.Error(),
		}, nil
	}
	return &alertMessageTemplateDraftOutput{
		Kind:                rule.Kind,
		SignalName:          rule.SignalName,
		Op:                  rule.Op,
		Severity:            rule.Severity,
		MetricID:            stringPtrValue(rule.MetricID),
		AllowedPlaceholders: placeholderRefs(rule),
		RelatedPresets:      relatedPresetRefs(rule),
		WritingBrief:        writingBrief(rule),
		Status:              "ok",
	}, nil
}

type validateAlertMessageTemplate struct{}

func (t *validateAlertMessageTemplate) Name() string { return "validate_alert_message_template" }

func (t *validateAlertMessageTemplate) Description() string {
	return "Validate a proposed alert message template against the placeholder catalog for the selected dimensions. " +
		"PROPOSE-ONLY: nothing is saved. Returns {status: ok|invalid, template, used_placeholders, unknown_keys, errors[]}. " +
		"Call AFTER draft_alert_message_template. If status is invalid, refuse to recommend the template."
}

func (t *validateAlertMessageTemplate) InputSchema() json.RawMessage {
	return tools.CachedSchema(alertMessageTemplateValidateInput{})
}

func (t *validateAlertMessageTemplate) OutputSchema() json.RawMessage { return nil }

func (t *validateAlertMessageTemplate) Mutates() bool { return false }

func (t *validateAlertMessageTemplate) RequiredScope() string { return "" }

func (t *validateAlertMessageTemplate) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[alertMessageTemplateValidateInput](raw)
}

func (t *validateAlertMessageTemplate) Execute(_ context.Context, in any) (any, error) {
	input, ok := in.(alertMessageTemplateValidateInput)
	if !ok {
		return nil, fmt.Errorf("validate_alert_message_template: unexpected input type %T", in)
	}
	rule, err := ruleFromTemplateDimensions(alertMessageTemplateInput{
		Kind:            input.Kind,
		SignalName:      input.SignalName,
		Op:              input.Op,
		Severity:        input.Severity,
		Name:            input.Name,
		ValueNum:        input.ValueNum,
		ValueText:       input.ValueText,
		ValueBool:       input.ValueBool,
		ValueMin:        input.ValueMin,
		ValueMax:        input.ValueMax,
		MetricID:        input.MetricID,
		MetricWindow:    input.MetricWindow,
		MetricOp:        input.MetricOp,
		MetricThreshold: input.MetricThreshold,
	})
	if err != nil {
		return &alertMessageTemplateValidateOutput{
			Status:          "invalid",
			Errors:          []string{err.Error()},
			ValidationError: err.Error(),
		}, nil
	}
	return validateTemplateAgainstRule(rule, input.Template), nil
}

func validateTemplateAgainstRule(rule *alertmodel.AlertRule, template string) *alertMessageTemplateValidateOutput {
	trimmed := strings.TrimSpace(template)
	var errs []string
	if trimmed == "" {
		errs = append(errs, "template must not be empty")
	}
	if utf8.RuneCountInString(trimmed) > alertmsg.MaxTemplateLength {
		errs = append(errs, fmt.Sprintf("template must be at most %d characters", alertmsg.MaxTemplateLength))
	}

	allowed := map[string]struct{}{}
	for _, p := range alertmsg.Placeholders(rule) {
		allowed[p.Key] = struct{}{}
	}
	used := alertmsg.ExtractPlaceholderKeys(trimmed)
	unknown := make([]string, 0)
	for _, key := range used {
		if _, ok := allowed[key]; !ok {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		errs = append(errs, "unknown placeholders: "+strings.Join(unknown, ", "))
	}

	out := &alertMessageTemplateValidateOutput{
		Template:         trimmed,
		UsedPlaceholders: used,
		UnknownKeys:      unknown,
		Errors:           errs,
	}
	if len(errs) > 0 {
		out.Status = "invalid"
		out.ValidationError = strings.Join(errs, "; ")
		return out
	}
	out.Status = "ok"
	return out
}

func ruleFromTemplateDimensions(in alertMessageTemplateInput) (*alertmodel.AlertRule, error) {
	kind := strings.TrimSpace(in.Kind)
	if kind == "" {
		return nil, fmt.Errorf("kind is required")
	}
	if kind != "signal" && kind != "computed_metric" {
		return nil, fmt.Errorf("kind must be signal or computed_metric")
	}
	rule := &alertmodel.AlertRule{
		Name:      strings.TrimSpace(in.Name),
		Kind:      kind,
		Op:        strings.TrimSpace(in.Op),
		Severity:  strings.TrimSpace(in.Severity),
		ValueNum:  in.ValueNum,
		ValueText: in.ValueText,
		ValueBool: in.ValueBool,
		ValueMin:  in.ValueMin,
		ValueMax:  in.ValueMax,
	}
	if kind == "signal" {
		rule.SignalName = strings.TrimSpace(in.SignalName)
		if rule.SignalName == "" {
			return nil, fmt.Errorf("signal_name is required for kind=signal")
		}
		if rule.Op == "" {
			return nil, fmt.Errorf("op is required for kind=signal")
		}
	}
	if kind == "computed_metric" {
		metricID := strings.TrimSpace(in.MetricID)
		if metricID == "" {
			return nil, fmt.Errorf("metric_id is required for kind=computed_metric")
		}
		rule.MetricID = &metricID
		if w := strings.TrimSpace(in.MetricWindow); w != "" {
			rule.MetricWindow = &w
		}
		if op := strings.TrimSpace(in.MetricOp); op != "" {
			rule.MetricOp = &op
		}
		rule.MetricThreshold = in.MetricThreshold
	}
	return rule, nil
}

func placeholderRefs(rule *alertmodel.AlertRule) []placeholderRef {
	src := alertmsg.Placeholders(rule)
	out := make([]placeholderRef, 0, len(src))
	seen := make(map[string]struct{}, len(src))
	for _, p := range src {
		if p.Key == "" {
			continue
		}
		if _, ok := seen[p.Key]; ok {
			continue
		}
		seen[p.Key] = struct{}{}
		out = append(out, placeholderRef{Key: p.Key, Group: p.Group})
	}
	return out
}

func relatedPresetRefs(rule *alertmodel.AlertRule) []relatedPresetRef {
	src := alertmsg.Presets(rule)
	allowed := map[string]struct{}{}
	for _, p := range alertmsg.Placeholders(rule) {
		allowed[p.Key] = struct{}{}
	}
	type scored struct {
		ref  relatedPresetRef
		rank int
	}
	scoredPresets := make([]scored, 0, len(src))
	for _, p := range src {
		if strings.TrimSpace(p.Template) == "" {
			continue
		}
		keys := alertmsg.ExtractPlaceholderKeys(p.Template)
		ok := true
		for _, k := range keys {
			if _, present := allowed[k]; !present {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		tags := append([]string(nil), p.Tags...)
		scoredPresets = append(scoredPresets, scored{
			ref: relatedPresetRef{
				ID:       p.ID,
				Name:     p.Name,
				Template: p.Template,
				Tags:     tags,
			},
			rank: presetInspirationRank(tags),
		})
	}
	sort.SliceStable(scoredPresets, func(i, j int) bool {
		return scoredPresets[i].rank < scoredPresets[j].rank
	})
	if len(scoredPresets) > relatedPresetLimit {
		scoredPresets = scoredPresets[:relatedPresetLimit]
	}
	out := make([]relatedPresetRef, 0, len(scoredPresets))
	for _, s := range scoredPresets {
		out = append(out, s.ref)
	}
	return out
}

func presetInspirationRank(tags []string) int {
	has := func(want string) bool {
		for _, tag := range tags {
			if tag == want {
				return true
			}
		}
		return false
	}
	switch {
	case has("fun"):
		return 0
	case has("verbose"):
		return 1
	case has("concise"), has("default"), has("minimal"):
		return 3
	default:
		return 2
	}
}

func writingBrief(rule *alertmodel.AlertRule) string {
	const forbidden = `Do NOT copy "{{SignalName}} is {{Value}} (threshold {{Threshold}})" or other bland concise/threshold presets.`
	sev := strings.ToLower(strings.TrimSpace(rule.Severity))
	switch sev {
	case "critical":
		return "Tone: urgent, high-stakes Tesla notification a driver would actually read. Name the vehicle and signal, include the live value and limit, make severity unmistakable. " + forbidden
	case "warn":
		return "Tone: sharp human heads-up — specific, not generic. Name the vehicle and signal, include value vs threshold, one concrete next-look. " + forbidden
	default:
		return "Tone: memorable Tesla-owner copy with personality (wit or celebration when severity is info). Ground in this signal or metric. " + forbidden
	}
}

func stringPtrValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// RegisterAlertMessageTemplateTools installs the propose-only message
// template tools. Called from router.go after RegisterAlertBuilderTools.
func RegisterAlertMessageTemplateTools(r *tools.Registry) {
	r.Register(&draftAlertMessageTemplate{})
	r.Register(&validateAlertMessageTemplate{})
}
