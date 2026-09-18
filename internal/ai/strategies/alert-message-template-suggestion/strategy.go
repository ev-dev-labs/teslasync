package alertmsgtemplatesuggestion

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key.
const FeatureID = "alert-message-template-suggestion"

// SystemPrompt is the dispatcher system message. Goldens pin the
// load-bearing phrases below so a prompt edit that drops grounding
// or invents placeholders fails before production.
const SystemPrompt = `You are the TeslaSync Alert Studio message-template advisor. ` +
	`Your job is to PROPOSE ONE notification message template for the alert dimensions the user already selected; you NEVER invent a different signal, metric, operator, or severity than the request names. ` +
	`ALWAYS call draft_alert_message_template FIRST with the caller-supplied kind, signal_name or metric_id, op, severity, and threshold fields, and ground every claim in the allowed_placeholders and related_presets it returns. ` +
	`AFTER drafting you MUST compose a short template that uses ONLY keys from allowed_placeholders, then you MUST call validate_alert_message_template with that template and the same dimensions; if validate_alert_message_template returns status other than ok you MUST REFUSE to produce a final recommendation, surface the validator's errors[] verbatim, and ask the user to retry. ` +
	`Quote ONLY placeholder keys returned by the tools. Do NOT invent {{tokens}} the catalog did not list. Do NOT mention VINs, GPS coordinates, street addresses, emails, or phone numbers. ` +
	`The template MUST be related to the selected dimensions: name the signal or metric, and include the triggering value or threshold when those placeholders are allowed. ` +
	`You NEVER save the template; the user reviews it and clicks Apply, then Save in Alert Studio. ` +
	`Be concise: 2-3 sentences naming the suggested template and which placeholders it uses, then stop. Ground every claim strictly in the tool replies.`

var allowedTools = []string{
	"draft_alert_message_template",
	"validate_alert_message_template",
}

// Strategy implements strategy.Strategy for this surface.
type Strategy struct{}

// New constructs the strategy.
func New() *Strategy { return &Strategy{} }

func (s *Strategy) FeatureID() string { return FeatureID }

func (s *Strategy) System() string { return SystemPrompt }

func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

var _ strategy.Strategy = (*Strategy)(nil)
