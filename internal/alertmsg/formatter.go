// Package alertmsg owns alert-domain message rendering: title, body, and
// the curated set of substitution placeholders. It is the single source of
// truth shared by the API (rule_engine + telemetry_alerts + preview
// endpoint + Test Message handler) and the computed-metric worker
// (cmd/notification-worker) so every dispatch path produces identical
// output for the same (rule, signals, vehicle) tuple.
//
// Design contract (Phase-50 / ADR-005):
//
//   - The rendered TITLE is canonical: it is always non-empty, is always
//     persisted in notification_logs.title, is always broadcast over SSE
//     and the event bus, and is always passed to transports that REQUIRE a
//     title (WebPush, email Subject, Pushover). The user-facing
//     IncludeTitle toggle does NOT erase the canonical title — it only
//     suppresses the bold-header line on transports that render title +
//     body separately (Discord/Slack/Telegram/ntfy/webhook). Those
//     transports honour the toggle via Request.SuppressTransportTitle in
//     internal/notification.
//
//   - The rendered BODY is op-aware. When rule.MsgTemplate is nil/blank we
//     fall back to RenderDefaultBody, which produces a short
//     human-readable description tailored to the rule's Kind + Op. When
//     rule.MsgTemplate is set we run Substitute against the merged signal
//     context plus the built-in placeholders. Unknown placeholders are
//     left as literal text (NOT rejected) so a typo doesn't silently
//     blank the notification.
//
//   - This package is a LEAF. It depends only on internal/models and
//     internal/tesla/protomodel so cmd/notification-worker can import it
//     without dragging in the HTTP API. Do NOT add imports to
//     internal/api, internal/database, or internal/notification here.
//
// Public surface:
//
//	BuildContext(rule, vehicleName, signals, builtins)  -> map[string]any
//	RenderTitle(rule, ctx)                              -> string
//	RenderBody(rule, ctx)                               -> string
//	RenderDefaultBody(rule, ctx)                        -> string
//	Substitute(template, ctx)                           -> string
//	Placeholders(rule)                                  -> []Placeholder
//	Presets(rule)                                       -> []Preset
//
// See ADR-005 for the rationale on restoring msg_template as typed TEXT.
package alertmsg

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// MaxTemplateLength is the upper bound on the persisted msg_template
// column. The API rejects writes longer than this. Transport limits are
// much tighter (Twilio SMS = 160 chars, Pushover title = 250 chars,
// Discord content = 2000 chars), so 1024 is comfortable headroom for
// rendering without ever overflowing a downstream channel.
const MaxTemplateLength = 1024

// substituteRe matches `{{key}}` with optional surrounding whitespace
// (e.g. `{{ Soc }}`). Keys are word-characters only — letters, digits,
// underscore — matching the existing rule_engine.renderTemplate
// behaviour. No conditionals, pipes, or nested expressions in v1; see
// ADR-005 "Future work" for the deferred Sprig-style upgrade.
var substituteRe = regexp.MustCompile(`\{\{\s*(\w+)\s*\}\}`)

// Context is the merged-signals-plus-builtins map passed to RenderBody,
// RenderTitle and Substitute. Callers construct it via BuildContext and
// then add any per-dispatch built-ins (Severity, MetricValue, ...).
type Context map[string]any

// Placeholder describes a single suggestion shown in the autocomplete
// popover when the user types `{{` in the Message Template editor.
type Placeholder struct {
	// Key is the literal token between `{{` and `}}` (no braces, no
	// whitespace). Example: "Soc", "VehicleName", "Threshold".
	Key string `json:"key"`

	// Label is the human-readable name shown in the picker. Falls back
	// to Key when empty.
	Label string `json:"label"`

	// Description is a one-line hint shown beneath the label.
	Description string `json:"description,omitempty"`

	// Group is the section heading the picker uses to organize
	// suggestions: "Built-in", "Triggering Signal", "Related Signals",
	// "Computed Metric".
	Group string `json:"group"`

	// Example is a sample rendered value displayed alongside the
	// description (e.g. "82.4", "true", "Drive", "Falcon").
	Example string `json:"example,omitempty"`
}

// Preset is a curated message template offered in the "Pick a preset"
// dialog. The catalog is embedded in this package (presets.go +
// presets.json) so the frontend doesn't need to hardcode any wording.
type Preset struct {
	// ID is a stable identifier; safe to use as a React key. Lowercase
	// kebab-case, e.g. "drive-started", "battery-low-friendly".
	ID string `json:"id"`

	// Name is the title shown in the dialog row.
	Name string `json:"name"`

	// Description is a one-line subtitle shown beneath the name.
	Description string `json:"description,omitempty"`

	// Template is the literal msg_template string the preset writes
	// into the editor when the user picks it.
	Template string `json:"template"`

	// Kind narrows which rules this preset is eligible for ("signal",
	// "computed_metric", or empty = both).
	Kind string `json:"kind,omitempty"`

	// Tags are arbitrary discovery hints (e.g. "fun", "concise",
	// "verbose"); the frontend uses them as filter chips.
	Tags []string `json:"tags,omitempty"`
}

// BuildContext is the canonical way to assemble the substitution map
// passed to RenderBody/RenderTitle. It merges the engine's signal batch
// with built-in placeholders that don't live in the signal stream.
//
// vehicleName MAY be empty when the dispatch site cannot resolve it
// (e.g. preview endpoint without a real vehicle). RenderTitle handles
// the fallback.
//
// builtins is an optional extra map that callers use to inject context
// they computed locally — most commonly MetricValue/MetricPrevValue/
// MetricChangePct from the computed-metric worker. Keys in `builtins`
// win over any same-named signal key.
func BuildContext(rule *alertmodel.AlertRule, vehicleName string, signals map[string]any, builtins map[string]any) Context {
	ctx := make(Context, len(signals)+10)
	for k, v := range signals {
		ctx[k] = v
	}
	if rule != nil {
		ctx["RuleName"] = rule.Name
		ctx["Severity"] = rule.Severity
		ctx["SignalName"] = rule.SignalName
		if rule.ValueNum != nil {
			ctx["Threshold"] = *rule.ValueNum
		} else if rule.ValueText != nil {
			ctx["Threshold"] = *rule.ValueText
		} else if rule.ValueBool != nil {
			ctx["Threshold"] = *rule.ValueBool
		}
		if rule.ValueMin != nil {
			ctx["Min"] = *rule.ValueMin
		}
		if rule.ValueMax != nil {
			ctx["Max"] = *rule.ValueMax
		}
		// Triggering signal value mirrored under the stable {{Value}}
		// key so a preset template can be op-agnostic.
		if v, ok := signals[rule.SignalName]; ok {
			ctx["Value"] = v
		}
		// Computed-metric defaults — overwritten by builtins when the
		// worker passes real values.
		if rule.Kind == "computed_metric" {
			if rule.MetricID != nil {
				ctx["MetricID"] = *rule.MetricID
			}
			if rule.MetricWindow != nil {
				ctx["MetricWindow"] = *rule.MetricWindow
			}
			if rule.MetricThreshold != nil {
				ctx["MetricThreshold"] = *rule.MetricThreshold
			}
		}
	}
	if vehicleName != "" {
		ctx["VehicleName"] = vehicleName
	}
	ctx["Now"] = time.Now().UTC().Format(time.RFC3339)
	for k, v := range builtins {
		ctx[k] = v
	}
	return ctx
}

// RenderTitle returns the canonical title for a rule fire. It is always
// non-empty: a vehicle name + rule name when both are known, the rule
// name alone otherwise, and "Alert" as a last-resort floor. This is the
// string persisted in notification_logs.title and broadcast over SSE.
//
// The IncludeTitle toggle does NOT live here — it lives in the
// notification dispatch layer (internal/notification.Request.Suppress
// TransportTitle) so we still have a canonical title to store and to
// hand to transports that require one.
func RenderTitle(rule *alertmodel.AlertRule, ctx Context) string {
	if rule == nil {
		return "Alert"
	}
	name := strings.TrimSpace(rule.Name)
	if name == "" {
		name = "Alert"
	}
	if v, ok := ctx["VehicleName"]; ok {
		if vs := strings.TrimSpace(toString(v)); vs != "" {
			return vs + " — " + name
		}
	}
	return name
}

// RenderBody returns the body text for a rule fire. When the rule has a
// non-blank MsgTemplate we substitute against ctx; otherwise we delegate
// to RenderDefaultBody for the op-aware default. The returned string
// MAY be empty for transition rules with no template + IncludeTitle=true
// — the dispatch layer is responsible for falling back to the rule
// name when IncludeTitle=false (see telemetry_alerts.fireAlert).
func RenderBody(rule *alertmodel.AlertRule, ctx Context) string {
	if rule == nil {
		return ""
	}
	if rule.MsgTemplate != nil {
		tmpl := strings.TrimSpace(*rule.MsgTemplate)
		if tmpl != "" {
			return Substitute(tmpl, ctx)
		}
	}
	return RenderDefaultBody(rule, ctx)
}

// RenderDefaultBody implements the B′ default formatter agreed in the
// architect critique (Phase-50). The wording depends on rule.Kind and
// rule.Op so the body adds *new* information instead of restating the
// title:
//
//   - signal, op =/!=/changed (text/bool)   -> "" (title is the message)
//   - signal, op <,<=,>,>=                  -> "<Signal> <value> · threshold <op> <threshold>"
//   - signal, op between/outside            -> "<Signal> <value> · expected <min>–<max>"
//   - computed_metric, comparisons          -> "<Metric> <value> over <window>"
//   - computed_metric, % change             -> "<Metric> <delta>% vs prior <window>"
//
// The "<unit>" suffix is intentionally omitted from this first cut
// because the unit-history layer stores everything in SI base units and
// we don't yet have the per-user display preference plumbed through to
// the rendering path. Phase-51 work-item: add UnitKind-aware display
// formatting. The current output is still strictly better than the
// pre-Phase-50 "Drive Started: D" wording.
func RenderDefaultBody(rule *alertmodel.AlertRule, ctx Context) string {
	if rule == nil {
		return ""
	}
	if rule.Kind == "computed_metric" {
		return defaultComputedBody(rule, ctx)
	}
	return defaultSignalBody(rule, ctx)
}

func defaultSignalBody(rule *alertmodel.AlertRule, ctx Context) string {
	signal := friendlySignal(rule.SignalName)
	val, hasVal := ctx[rule.SignalName]

	// State-change-style rules against text/bool signals: title IS the
	// message; echoing the raw value (`R`, `true`) is noise. Returning
	// empty is the architect-blessed B″ outcome. The dispatch layer
	// falls back to a sensible value if it ever needs a non-empty body
	// (IncludeTitle=false path).
	if rule.Op == "=" || rule.Op == "!=" || rule.Op == "changed" {
		if rule.ValueText != nil || rule.ValueBool != nil {
			return ""
		}
	}

	switch rule.Op {
	case "<", "<=", ">", ">=":
		threshold := ""
		if rule.ValueNum != nil {
			threshold = trimNumber(*rule.ValueNum)
		}
		if hasVal && threshold != "" {
			return fmt.Sprintf("%s %s · threshold %s %s",
				signal, formatValue(val), rule.Op, threshold)
		}
		if threshold != "" {
			return fmt.Sprintf("%s threshold %s %s", signal, rule.Op, threshold)
		}
	case "between":
		if rule.ValueMin != nil && rule.ValueMax != nil {
			rng := fmt.Sprintf("%s–%s", trimNumber(*rule.ValueMin), trimNumber(*rule.ValueMax))
			if hasVal {
				return fmt.Sprintf("%s %s · expected %s", signal, formatValue(val), rng)
			}
			return fmt.Sprintf("%s expected %s", signal, rng)
		}
	case "outside":
		if rule.ValueMin != nil && rule.ValueMax != nil {
			rng := fmt.Sprintf("%s–%s", trimNumber(*rule.ValueMin), trimNumber(*rule.ValueMax))
			if hasVal {
				return fmt.Sprintf("%s %s · outside %s", signal, formatValue(val), rng)
			}
			return fmt.Sprintf("%s outside %s", signal, rng)
		}
	case "=", "!=":
		// Numeric =/!= falls through to a generic "Signal value · op threshold".
		if rule.ValueNum != nil && hasVal {
			return fmt.Sprintf("%s %s · %s %s",
				signal, formatValue(val), rule.Op, trimNumber(*rule.ValueNum))
		}
	}
	if hasVal {
		return fmt.Sprintf("%s %s", signal, formatValue(val))
	}
	return ""
}

func defaultComputedBody(rule *alertmodel.AlertRule, ctx Context) string {
	metric := friendlySignal(strDeref(rule.MetricID))
	window := strDeref(rule.MetricWindow)
	threshold := ""
	if rule.MetricThreshold != nil {
		threshold = trimNumber(*rule.MetricThreshold)
	}
	op := strDeref(rule.MetricOp)

	val, hasVal := ctx["MetricValue"]
	prev, hasPrev := ctx["MetricPrevValue"]
	chg, hasChg := ctx["MetricChangePct"]

	if op == "%_change_>" || op == "%_change_<" {
		if hasChg {
			prefix := fmt.Sprintf("%s %s%% vs prior %s", metric, formatValue(chg), nonEmpty(window, "window"))
			if hasVal && hasPrev {
				return prefix + fmt.Sprintf(" · %s → %s", formatValue(prev), formatValue(val))
			}
			return prefix
		}
		if hasVal && hasPrev {
			return fmt.Sprintf("%s %s → %s vs prior %s", metric,
				formatValue(prev), formatValue(val), nonEmpty(window, "window"))
		}
	}

	if hasVal {
		body := fmt.Sprintf("%s %s over %s", metric, formatValue(val), nonEmpty(window, "window"))
		if threshold != "" && op != "" {
			body += fmt.Sprintf(" · threshold %s %s", op, threshold)
		}
		return body
	}

	if threshold != "" && op != "" {
		return fmt.Sprintf("%s threshold %s %s", metric, op, threshold)
	}
	return ""
}

// Substitute replaces every `{{key}}` occurrence in tmpl with the
// string form of ctx[key]. Unknown keys are left as literal `{{key}}`
// rather than rejected so a small typo doesn't silently blank the
// notification. Whitespace inside the braces (`{{ key }}`) is
// permitted — the matcher trims it before the lookup.
func Substitute(tmpl string, ctx Context) string {
	if tmpl == "" {
		return ""
	}
	return substituteRe.ReplaceAllStringFunc(tmpl, func(match string) string {
		sub := substituteRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		key := sub[1]
		if v, ok := ctx[key]; ok {
			return toString(v)
		}
		return match
	})
}

// Placeholders returns the autocomplete catalog the editor should show
// when the user opens the placeholder picker. The list is the single
// source of truth for "what {{key}} tokens substitute to a real value
// for this rule's shape" — the frontend uses it to drive both the
// `{{`-trigger autocomplete and the preset-gallery op-validity filter.
//
//  1. Built-in keys that always work for the given rule kind.
//  2. Op-conditional keys (Threshold for single-value ops; Min/Max for
//     between/outside) so the catalog matches what BuildContext sets.
//  3. Per-kind keys: SignalName for signal rules; MetricID + window +
//     threshold + computed defaults for computed_metric rules.
//  4. The triggering signal itself ({{SignalName}} or {{MetricID}}).
//  5. Sibling signals in the same protomodel Category (a deliberately
//     narrow scope so the picker doesn't list 600+ entries).
//
// The slice is sorted alphabetically inside each group; the frontend
// groups by Placeholder.Group when rendering.
func Placeholders(rule *alertmodel.AlertRule) []Placeholder {
	out := make([]Placeholder, 0, 16)

	// Built-ins common to all rule kinds and ops.
	out = append(out,
		Placeholder{Key: "VehicleName", Label: "Vehicle name", Description: "Name of the vehicle that triggered the rule.", Group: "Built-in", Example: "Falcon"},
		Placeholder{Key: "RuleName", Label: "Rule name", Description: "Name field of the alert rule.", Group: "Built-in", Example: "Battery Low"},
		Placeholder{Key: "Severity", Label: "Severity", Description: "Severity level the rule fired at.", Group: "Built-in", Example: "warn"},
		Placeholder{Key: "Value", Label: "Triggering value", Description: "Current value of the signal that triggered the rule.", Group: "Built-in", Example: "18.2"},
		Placeholder{Key: "Now", Label: "Timestamp", Description: "RFC3339 UTC timestamp of the fire.", Group: "Built-in", Example: time.Now().UTC().Format(time.RFC3339)},
	)

	// Op-conditional keys mirror what BuildContext sets:
	//   - between/outside  -> Min, Max  (no single Threshold)
	//   - changed          -> nothing extra (threshold is the prior value)
	//   - everything else  -> Threshold (single comparand)
	if rule != nil {
		switch rule.Op {
		case "between", "outside":
			out = append(out,
				Placeholder{Key: "Min", Label: "Range min", Description: "Lower bound of the configured range.", Group: "Built-in"},
				Placeholder{Key: "Max", Label: "Range max", Description: "Upper bound of the configured range.", Group: "Built-in"},
			)
		case "changed", "":
			// no extra threshold key
		default:
			out = append(out, Placeholder{Key: "Threshold", Label: "Threshold", Description: "Configured threshold the rule compared against.", Group: "Built-in", Example: "20"})
		}
	} else {
		// Skeleton call (no rule yet) — surface Threshold optimistically
		// so the autocomplete picker isn't empty in the New Rule wizard
		// before the user picks an op.
		out = append(out, Placeholder{Key: "Threshold", Label: "Threshold", Description: "Configured threshold the rule compared against.", Group: "Built-in", Example: "20"})
	}

	if rule == nil {
		return out
	}

	if rule.Kind == "computed_metric" {
		out = append(out,
			Placeholder{Key: "MetricID", Label: "Metric ID", Description: "Identifier of the configured computed metric.", Group: "Computed Metric"},
			Placeholder{Key: "MetricWindow", Label: "Metric window", Description: "Rolling window the metric is computed over (e.g. 1h).", Group: "Computed Metric"},
			Placeholder{Key: "MetricThreshold", Label: "Metric threshold", Description: "Configured threshold the metric is compared against.", Group: "Computed Metric"},
			Placeholder{Key: "MetricValue", Label: "Metric current value", Description: "Computed-metric result over the configured window.", Group: "Computed Metric"},
			Placeholder{Key: "MetricPrevValue", Label: "Metric prior value", Description: "Result over the prior window (only set for %-change rules).", Group: "Computed Metric"},
			Placeholder{Key: "MetricChangePct", Label: "Metric % change", Description: "Percent change between the prior window and this one.", Group: "Computed Metric"},
		)
		if rule.MetricID != nil && *rule.MetricID != "" {
			out = append(out, Placeholder{
				Key: *rule.MetricID, Label: friendlySignal(*rule.MetricID),
				Description: "Configured metric ID.", Group: "Computed Metric",
			})
		}
		return out
	}

	// Signal rules: surface the abstract {{SignalName}} key (always
	// substitutable to rule.SignalName), then the triggering signal,
	// then sibling signals in the same Category. We intentionally cap
	// to the same Category — the full signal list is 600+ entries and
	// overwhelms the picker.
	out = append(out, Placeholder{
		Key:         "SignalName",
		Label:       "Signal name",
		Description: "Name of the signal the rule monitors (substituted to the configured signal).",
		Group:       "Built-in",
		Example:     rule.SignalName,
	})
	trigger, triggerOK := protomodel.SignalsByName[rule.SignalName]
	if rule.SignalName != "" {
		out = append(out, Placeholder{
			Key:         rule.SignalName,
			Label:       friendlySignal(rule.SignalName),
			Description: signalDescription(trigger, triggerOK),
			Group:       "Triggering Signal",
		})
	}
	if triggerOK && trigger.Category != "" {
		siblings := make([]Placeholder, 0, 32)
		for name, meta := range protomodel.SignalsByName {
			if meta == nil || meta.Category != trigger.Category || name == rule.SignalName {
				continue
			}
			siblings = append(siblings, Placeholder{
				Key:         name,
				Label:       friendlySignal(name),
				Description: signalDescription(meta, true),
				Group:       "Related Signals",
			})
		}
		sort.Slice(siblings, func(i, j int) bool { return siblings[i].Key < siblings[j].Key })
		out = append(out, siblings...)
	}
	return out
}

// --- Helpers --------------------------------------------------------

// friendlySignal converts a CamelCase signal name into a Title Case
// human label: "VehicleSpeed" -> "Vehicle Speed", "TpmsPressureFl" ->
// "Tpms Pressure Fl". It intentionally avoids fancy abbreviation
// handling — the field names in protomodel are stable enough that a
// dumb splitter produces good output, and the editor can always show
// the raw key alongside the label.
func friendlySignal(name string) string {
	if name == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(name) + 4)
	runes := []rune(name)
	for i, r := range runes {
		if i == 0 {
			b.WriteRune(unicode.ToUpper(r))
			continue
		}
		if unicode.IsUpper(r) {
			prev := runes[i-1]
			if unicode.IsLower(prev) || unicode.IsDigit(prev) {
				b.WriteByte(' ')
			}
		}
		b.WriteRune(r)
	}
	return b.String()
}

func signalDescription(meta *protomodel.SignalMeta, ok bool) string {
	if !ok || meta == nil {
		return ""
	}
	parts := make([]string, 0, 3)
	if meta.Category != "" {
		parts = append(parts, "category: "+meta.Category)
	}
	if meta.ValueKind != protomodel.ValueKindUnknown {
		parts = append(parts, "type: "+meta.ValueKind.String())
	}
	if meta.UnitKind != protomodel.UnitKindNone {
		parts = append(parts, "unit: "+meta.UnitKind.String())
	}
	return strings.Join(parts, " · ")
}

func toString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(x)
	case int32:
		return strconv.FormatInt(int64(x), 10)
	case int64:
		return strconv.FormatInt(x, 10)
	case float32:
		return trimNumber(float64(x))
	case float64:
		return trimNumber(x)
	case time.Time:
		return x.UTC().Format(time.RFC3339)
	case fmt.Stringer:
		return x.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

func formatValue(v any) string { return toString(v) }

// trimNumber renders a float without trailing zeros and without
// scientific notation for the range we care about. "82.0" -> "82",
// "82.40" -> "82.4". The 'g' verb would do this but switches to
// scientific notation aggressively; we want plain decimal output.
func trimNumber(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nonEmpty(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
