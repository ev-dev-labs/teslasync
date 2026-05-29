// Watch-face natural-language response tools.
//
//   - `query_watch_context` — typed deterministic envelope
//     describing the user's primary vehicle as it would render
//     on the deterministic /watch baseline (battery gauge,
//     status icons, recent alerts). The envelope is the same
//     class of grounding the fixed watch cards have: a single
//     snapshot of the canonical VehicleRepo (primary vehicle
//     name) + the canonical signal.LiveStateReader (battery,
//     range, charging state + time-to-full, locks, sentry mode,
//     inside/outside temperature, climate) + the canonical
//     NotificationRepo (recent non-critical alerts, trailing
//     window, max 5 rows). NO database write is performed.
//
//     Privacy: the envelope is PII-free by construction. We
//     emit:
//       - the user's primary vehicle's display name (already
//         user-visible on every page),
//       - scalar battery / range / charge / climate state
//         (already user-visible on the fixed watch face),
//       - alert {severity, kind, age_seconds} tuples — NO
//         alert title (some users include vehicle or street
//         names in custom rule names), NO alert message
//         body, NO alert resource identifiers.
//     The redaction policy `PolicyChatbot` allows ZERO PII
//     classes — every PII class is tagged round-trip BEFORE
//     the message reaches the provider, so a leaked transcript
//     reveals nothing beyond the deterministic-card state. This
//     is defence in depth in case a future edit widens the
//     schema.
//
// Tool design:
//
//   - NO per-request scope binding is needed because the
//     primary vehicle is install-wide (one row in the
//     `vehicles` table flagged as primary). The voice-mode
//     scope-pattern (vehicle-id from the URL bound into ctx)
//     does not apply here; the watch face is install-scoped.
//
//   - The tool's input schema is intentionally empty: the LLM
//     calls `query_watch_context` with no arguments and
//     receives the install's primary-vehicle snapshot. A
//     per-vehicle filter argument would be misleading for a
//     watch-face surface — the watch face shows ONE vehicle at
//     a time, and the canonical /watch route honours the same
//     primary-vehicle selection.
//
//   - Both °C AND pre-computed °F fields are emitted side by
//     side (`inside_temp_c` + `inside_temp_f`,
//     `outside_temp_c` + `outside_temp_f`) following the
//     cToFPtr precedent in drive_coaching.go — the LLM cannot
//     reliably do arithmetic on negative / fractional
//     temperatures on small local models, so the conversion
//     is performed in Go and the LLM picks whichever matches
//     the user's UnitOfTemp preference. The same applies to
//     `range_km` (SI canonical, computed from miles ×
//     1.60934) and `range_mi` (display, surfaced verbatim from
//     the LiveStateReader's RatedRange field which is
//     persisted in miles).
//
// Design constraints:
//
//   - query_watch_context delegates to two narrow read-only ports:
//     WatchContextSource wraps the canonical VehicleRepo and
//     signal.LiveStateReader used by /watch; AlertHistorySource wraps
//     NotificationRepo. No new SQL is introduced.
//   - The deterministic /watch/summary handler remains the canonical
//     baseline read path; this tool shares the same data sources without
//     duplicating the projection.
//   - The tool has no DB handle, and no save_* / create_* / apply_* /
//     submit_* companion exists.

package nl

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Typed envelope.
// ---------------------------------------------------------------------------

// WatchAlertEntry is one row in the recent-alert projection the
// envelope surfaces. The fields are intentionally narrow — the
// LLM does not need the alert title (a templated string that
// can contain custom rule names / vehicle names / place names —
// any of which would be a PII leak) or the alert message body
// (free-form, may contain PII). The envelope reports
// {severity, age_seconds} only, which is the same class of
// information the watch face's existing alert icon would
// display (severity colour + how long ago).
//
// Field semantics:
//
//   - Severity: the canonical severity enum from
//     internal/models/models.go's NotificationLog
//     ("info", "warn", "critical"). Critical-severity alerts
//     are intentionally EXCLUDED by the production adapter —
//     a watch-face NL narrator is the wrong surface for life-
//     safety alerts (those should fire the deterministic
//     push channel). Critical alerts are still surfaced by
//     the dedicated /alerts route.
//   - AgeSeconds: time since the alert fired, in seconds.
//     Allows the LLM to render natural relative time ("about
//     two hours ago") without doing date arithmetic on a
//     small local model. The adapter computes this from
//     time.Now() at the moment the envelope is built so the
//     LLM does not need to know wall-clock time.
type WatchAlertEntry struct {
	Severity   string `json:"severity"`
	AgeSeconds int64  `json:"age_seconds"`
}

// WatchContextEnvelope is the typed envelope
// query_watch_context returns. Every field is REQUIRED to be
// populated by the production adapter — if a value is genuinely
// unknown the adapter emits a typed nil (any) so the JSON
// encoder writes `null` rather than a misleading zero. The
// strategy's system prompt is wired around the field names
// here, and a future edit that renames a field MUST update the
// strategy prompt + goldens in lockstep.
//
// Field semantics:
//
//   - VehicleName: the primary vehicle's display name as it
//     appears on every other TeslaSync page; the same string
//     the watch face renders in its header.
//   - SOCPercent: state of charge in whole percent (0-100).
//     Typed as `any` so the adapter can emit JSON `null` when
//     the signal store has no recent reading.
//   - RangeKm / RangeMi: the rated range in BOTH SI canonical
//     and display units. The cToFPtr precedent in
//     drive_coaching.go: the LLM cannot reliably do arithmetic
//     on fractional miles ↔ km conversions on small local
//     models, so the adapter emits both values pre-computed.
//   - IsCharging: bool computed from the canonical ChargeState
//     enum ("Charging" / "Disconnected" / etc.). The LLM uses
//     this to phrase the charging state as a verb ("you are
//     charging" / "you are unplugged") rather than quoting the
//     raw enum to the user.
//   - TimeToFullMin: minutes until the battery hits its
//     charge-limit target (the same value the watch face's
//     deterministic card surfaces). Typed `any` so absent
//     readings serialize as `null`.
//   - IsLocked / SentryMode / IsClimateOn: bool flags the watch
//     face's status icons already render.
//   - InsideTempC / InsideTempF / OutsideTempC / OutsideTempF:
//     cabin and outside temperatures in BOTH SI canonical and
//     pre-computed Fahrenheit (cToFPtr precedent). Typed
//     `any` so absent readings serialize as `null`.
//   - RecentAlerts: at most 5 non-critical alert entries from
//     the trailing 24 hours, most-recent first. Each entry is
//     the {severity, age_seconds} pair only — NO title, NO
//     message body, NO kind tag (the canonical notification_log
//     table has no stable "kind" enum; the Title is a templated
//     string that may contain custom rule names / vehicle names
//     / place names — any of which would be a PII leak). NEVER
//     nil — an empty slice serializes as `[]` so the LLM can
//     prove "no recent alerts" by checking the length.
//   - LastUpdated: ISO-8601 timestamp the envelope was built
//     at (server wall-clock, RFC 3339). Surfaces the freshness
//     of the snapshot so the LLM can honestly hedge if asked.
//   - Source: the dispatcher-visible breadcrumb so the LLM's
//     follow-up prose can attribute the values to the
//     canonical readers rather than its own reasoning.
type WatchContextEnvelope struct {
	VehicleName   string            `json:"vehicle_name"`
	SOCPercent    any               `json:"soc_percent"`
	RangeKm       any               `json:"range_km"`
	RangeMi       any               `json:"range_mi"`
	IsCharging    bool              `json:"is_charging"`
	TimeToFullMin any               `json:"time_to_full_min"`
	IsLocked      any               `json:"is_locked"`
	SentryMode    any               `json:"sentry_mode"`
	IsClimateOn   any               `json:"is_climate_on"`
	InsideTempC   any               `json:"inside_temp_c"`
	InsideTempF   any               `json:"inside_temp_f"`
	OutsideTempC  any               `json:"outside_temp_c"`
	OutsideTempF  any               `json:"outside_temp_f"`
	RecentAlerts  []WatchAlertEntry `json:"recent_alerts"`
	LastUpdated   string            `json:"last_updated"`
	Source        string            `json:"source"`
}

// ---------------------------------------------------------------------------
// Narrow ports.
// ---------------------------------------------------------------------------

// WatchContextSource is the narrow port the
// query_watch_context tool delegates to for the vehicle
// snapshot half of the envelope. In production it is satisfied
// by *api.AIWatchFaceNLContextSource (which wraps the canonical
// VehicleRepo + signal.LiveStateReader the existing /watch
// handler already uses); in tests we substitute deterministic
// fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that
// ADR-015 §I3 mandates.
type WatchContextSource interface {
	// LoadWatchContext returns the typed envelope describing
	// the install's primary vehicle. The adapter is
	// responsible for hydrating every field; absent readings
	// must serialize as `null` (typed-nil `any`), never as
	// a misleading zero. The adapter MUST NOT include the
	// recent_alerts list — that is the AlertHistorySource's
	// responsibility, and the tool merges them at the end.
	LoadWatchContext(ctx context.Context) (*WatchContextEnvelope, error)
}

// AlertHistorySource is the narrow port the query_watch_context
// tool delegates to for the recent-alert half of the envelope.
// In production it is satisfied by
// *api.AIWatchFaceNLAlertHistorySource (which wraps the
// canonical NotificationRepo); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The adapter is responsible for the projection invariants:
//
//   - exclude critical-severity alerts (a watch-face NL
//     narrator is the wrong surface for life-safety alerts;
//     those fire through the deterministic push channel),
//   - cap at `max` entries (the tool passes max=5),
//   - sort most-recent first,
//   - project away any PII-bearing free-text fields (title,
//     message body, resource_id) — only the {severity, kind,
//     age_seconds} triple crosses the tool boundary.
//
// The interface MUST stay read-only.
type AlertHistorySource interface {
	// LoadRecentAlerts returns at most max non-critical alert
	// entries from the trailing window, most-recent first.
	// The slice MUST be non-nil even when empty; the LLM
	// proves "no recent alerts" by checking the length.
	LoadRecentAlerts(ctx context.Context, max int) ([]WatchAlertEntry, error)
}

// ---------------------------------------------------------------------------
// query_watch_context
// ---------------------------------------------------------------------------

// queryWatchContextInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// Intentionally empty: the LLM passes no arguments because the
// envelope is install-scoped (primary vehicle) and complete in
// one call. A future edit MAY add a per-vehicle filter when the
// install supports multiple primary vehicles, but the single-
// vehicle default matches the canonical /watch route.
type queryWatchContextInput struct{}

// maxWatchAlerts caps the recent-alert projection so the
// envelope stays small enough for a small local model to keep
// the relevant entries in working memory. 5 is the same cap
// the deterministic /watch baseline uses for its alert icon
// rotation.
const maxWatchAlerts = 5

// queryWatchContext is the read-only tool that returns the
// watch-face context envelope. Construct via
// RegisterWatchFaceNLResponseTools so both sources are wired
// before the tool reaches the registry.
type queryWatchContext struct {
	source WatchContextSource
	alerts AlertHistorySource
}

// Name implements [Tool].
func (t *queryWatchContext) Name() string { return "query_watch_context" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *queryWatchContext) Description() string {
	return "Return the deterministic typed envelope describing the user's primary vehicle as it would render on the watch face (battery gauge, status icons, recent alerts). " +
		"Reports {vehicle_name, soc_percent, range_km, range_mi, is_charging, time_to_full_min, is_locked, sentry_mode, is_climate_on, inside_temp_c, inside_temp_f, outside_temp_c, outside_temp_f, recent_alerts (max 5, non-critical, trailing window, most-recent first; each entry is the {severity, age_seconds} pair only), last_updated, source}. " +
		"Both °C AND pre-computed °F fields are emitted side by side for every temperature reading; both km AND mi fields are emitted side by side for range — pick whichever matches the user's preferred display unit; do not perform unit arithmetic yourself. " +
		"NO PII (street names, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, MAC addresses) crosses the tool boundary — the envelope contains only the scalar values the deterministic /watch card already surfaces; alert entries are the {severity, age_seconds} pair only, with NO title or message body. " +
		"READ-only — no record is created, mutated, or deleted; NO database write. " +
		"Call this FIRST; the envelope is the ground truth for the watch-face reply you produce — DO NOT recompute, contradict, or invent vehicle state beyond the envelope. " +
		"If a field serializes as null the value is genuinely unknown — say so plainly in the reply and refer the user to the watch-face tap icon rather than fabricating a value."
}

// InputSchema implements [Tool].
func (t *queryWatchContext) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryWatchContextInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *queryWatchContext) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. READ-only — never returns true.
// The tool reads the canonical vehicle / signal / notification
// stores but does NOT touch the database.
func (t *queryWatchContext) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *queryWatchContext) RequiredScope() string { return "" }

// Validate implements [Tool]. The input schema is empty so
// there is nothing to validate beyond the structural decode.
// The empty-struct validator (ValidateStruct) succeeds for any
// JSON object (including {}, which is the dispatcher's default
// when the LLM emits no arguments).
func (t *queryWatchContext) Validate(raw json.RawMessage) (any, error) {
	v, err := tools.ValidateStruct[queryWatchContextInput](raw)
	if err != nil {
		return v, err
	}
	in, ok := v.(queryWatchContextInput)
	if !ok {
		return v, fmt.Errorf("query_watch_context: validator returned unexpected type %T", v)
	}
	return in, nil
}

// Execute implements [Tool]. Two reads — the vehicle snapshot
// via the WatchContextSource port and the recent-alert list via
// the AlertHistorySource port — merged into a single envelope.
// Both reads are best-effort: a failure on the alert side does
// NOT prevent the snapshot from being returned (the user's "how
// much battery" question is still answerable when the alert
// store is unavailable). A failure on the snapshot side IS a
// hard failure (the whole envelope is meaningless without it).
//
// Missing-source is a hard failure: if the dispatcher is
// invoked from an unintended path (no source wired at
// registration), the tool refuses. The AI handler is the only
// path that should be loading this tool, and
// RegisterWatchFaceNLResponseTools ALWAYS wires both sources.
func (t *queryWatchContext) Execute(ctx context.Context, in any) (any, error) {
	_ = in.(queryWatchContextInput)
	if t.source == nil {
		return nil, errors.New("query_watch_context: no WatchContextSource wired")
	}
	env, err := t.source.LoadWatchContext(ctx)
	if err != nil {
		return nil, err
	}
	if env == nil {
		return nil, errors.New("query_watch_context: WatchContextSource returned nil envelope")
	}
	// Best-effort alert hydration. A failure here does NOT
	// abort the tool — the snapshot half of the envelope is
	// still useful (the user's "how much battery" question
	// is still answerable when the notification store is
	// unavailable). The LLM proves "no recent alerts" by
	// checking the length of the slice, so we still need to
	// guarantee it is non-nil even on error.
	if t.alerts != nil {
		alerts, alertsErr := t.alerts.LoadRecentAlerts(ctx, maxWatchAlerts)
		if alertsErr == nil && alerts != nil {
			env.RecentAlerts = alerts
		}
	}
	if env.RecentAlerts == nil {
		env.RecentAlerts = []WatchAlertEntry{}
	}
	return env, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// WatchFaceNLResponseSources bundles the narrow ports
// RegisterWatchFaceNLResponseTools needs. Mirrors
// [SafetySettingExplainerSources] and [VoiceModeSources].
//
// Production wiring (router.go) instantiates the production
// adapters (*api.AIWatchFaceNLContextSource and
// *api.AIWatchFaceNLAlertHistorySource); tests substitute
// deterministic fakes.
type WatchFaceNLResponseSources struct {
	Source WatchContextSource
	Alerts AlertHistorySource
}

// RegisterWatchFaceNLResponseTools installs the
// watch-face-nl-response tools on r. Called from
// router.go AFTER all earlier RegisterXxx calls so the
// registry's Names list continues to grow deterministically
// without disturbing earlier registrations or any builtin-names
// pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterWatchFaceNLResponseTools(r *tools.Registry, s WatchFaceNLResponseSources) {
	r.Register(&queryWatchContext{source: s.Source, alerts: s.Alerts})
}
