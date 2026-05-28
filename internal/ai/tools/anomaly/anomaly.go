// Phase-50 / 0014 — U4 Anomaly explanation narration.
//
// anomaly.go ships ONE new read-only tool:
// `query_anomaly_context`. The tool is the single F4 surface the
// anomaly-explanations strategy is allowed to call (see
// internal/ai/strategies/anomaly-explanations/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL written.**"
//     The tool does not query Postgres directly — it calls
//     [AnomalySource.DetectAnomalies], which is satisfied at boot by
//     the existing *apianomaly.Handler whose Z-score / range / trend
//     SQL is unchanged from the pre-refactor handler. The Phase-50/0014
//     refactor extracted those SQL queries into a method without
//     adding, modifying, or duplicating any of them.
//
//   - The tool is a READ — Mutates() returns false. The dispatcher's
//     deny-all confirm gate refuses anything mutating; this slice
//     ships zero mutating tools and adds nothing to the alerting or
//     detection pipeline. The narrator only EXPLAINS already-detected
//     anomalies; it never CREATES, MUTATES, or SUPPRESSES them.
//
//   - One tool, multiple strategies: the tool is registered on the
//     process-wide tools.Registry alongside the 12 builtins + the
//     digest tool + the year-review tool, so a future strategy that
//     also wants anomaly context (e.g. a maintenance-suggestion
//     coach) can declare it without re-registration. The dispatcher's
//     per-strategy whitelist still gates which strategies can call it.
//
// The tool's output is a deterministic envelope mirroring the
// AnomalyContextResult shape:
//
//	{
//	  "vehicle_id":          int64,
//	  "days":                int,
//	  "anomalies":           [<AnomalyContextEntry>...],
//	  "health_summary":      map[string]string,
//	  "signals_monitored":   int,
//	  "anomalies_last_7d":   int,
//	  "anomalies_last_24h":  int,
//	}

package anomaly

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// AnomalyContextEntry is the shared DTO for one detected anomaly. It
// is the single source of truth shared by:
//
//   - the legacy HTTP wire shape served by GET /analytics/anomalies
//     (the api package's anomalyEntry maps field-for-field from this);
//   - the AI tool's output envelope (Execute below);
//   - the eval harness's canned mock provider replies.
//
// All fields have explicit JSON tags so the tool's output marshals
// identically to the HTTP wire shape — useful for a future test that
// asserts byte-equality between the two paths.
type AnomalyContextEntry struct {
	Signal     string  `json:"signal"`
	Type       string  `json:"type"`
	Severity   string  `json:"severity"`
	Value      float64 `json:"value"`
	Baseline   float64 `json:"baseline"`
	ZScore     float64 `json:"z_score"`
	DetectedAt string  `json:"detected_at"`
	Message    string  `json:"message"`
}

// AnomalyContextResult is the shared aggregate the detector returns.
// Anomalies is non-nil even when empty; HealthSummary always includes
// the five canonical category keys; counts default to zero. These
// invariants are enforced by (*apianomaly.Handler).DetectAnomalies — both
// the HTTP path and the AI tool rely on them.
type AnomalyContextResult struct {
	Anomalies        []AnomalyContextEntry `json:"anomalies"`
	HealthSummary    map[string]string     `json:"health_summary"`
	SignalsMonitored int                   `json:"signals_monitored"`
	AnomaliesLast7d  int                   `json:"anomalies_last_7d"`
	AnomaliesLast24h int                   `json:"anomalies_last_24h"`
}

// AnomalySource is the narrow read interface the anomaly tool needs.
// In production it is satisfied by *apianomaly.Handler (compile-time
// assertion in internal/api/anomaly_handler.go); tests substitute a
// deterministic fake.
//
// The interface MUST NOT grow methods that mutate state — the tool's
// Mutates() returns false, and a future "DetectAnomalies + write
// suppression" combo would silently violate the deny-all confirm
// gate. Add a separate mutating tool for any such extension.
type AnomalySource interface {
	// DetectAnomalies runs the full detection pipeline (Z-score
	// outliers, range violations, trend deltas) for one vehicle
	// over the last `days` days. Per the apianomaly.Handler contract,
	// the returned pointer is always non-nil; per-stage query
	// failures are logged and swallowed (graceful degradation).
	DetectAnomalies(ctx context.Context, vehicleID int64, days int) (*AnomalyContextResult, error)
}

// queryAnomalyContextInput is the typed input shape for the tool.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails before
// any AnomalySource method runs.
type queryAnomalyContextInput struct {
	// VehicleID identifies the vehicle whose anomalies we summarise.
	// Required + positive — the AI handler ALWAYS scopes to the
	// caller's own vehicle, so a missing or nonsense ID is a
	// programming error rather than a user-facing case.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// Days is the lookback window for the detection. Optional;
	// defaults to 7 (matches the HTTP handler's default) when zero.
	// Bounded to [0,30] — zero is the "use default" sentinel; the
	// upper clamp mirrors the HTTP handler so a confused LLM that
	// asks for 365 days cannot silently produce a nonsense aggregate
	// that takes seconds to compute.
	//
	// Note: the package-level validator does not special-case the
	// `omitempty` keyword, so we use `gte=0` (the zero sentinel
	// passes; Execute substitutes the default) instead of `gte=1`
	// (which would reject the zero sentinel even for absent fields).
	Days int `json:"days,omitempty" validate:"gte=0,lte=30" desc:"Lookback window in days; default 7 when omitted, max 30."`
}

// queryAnomalyContext is the read-only tool that fetches the
// already-detected anomaly state for a single vehicle. It is the
// ONE tool the anomaly-explanations strategy is allowed to call.
type queryAnomalyContext struct {
	src AnomalySource
}

// Name implements [Tool].
func (t *queryAnomalyContext) Name() string { return "query_anomaly_context" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryAnomalyContext) Description() string {
	return "Return the already-detected anomaly state for one vehicle: a deduplicated severity-sorted list of anomalies plus per-category health summary. " +
		"Use this to EXPLAIN anomalies in plain language; the tool never creates, mutates, or suppresses anomalies. " +
		"Numeric fields are detector-canonical (z_score is dimensionless; value/baseline are in the signal's native unit)."
}

// InputSchema implements [Tool].
func (t *queryAnomalyContext) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryAnomalyContextInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryAnomalyContext) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryAnomalyContext) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryAnomalyContext) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryAnomalyContext) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryAnomalyContextInput](raw)
}

// defaultAnomalyDays mirrors the HTTP handler's default lookback
// window. Kept as a named constant so a future change to the default
// touches one place rather than three (validator, tool, HTTP handler).
const defaultAnomalyDays = 7

// Execute implements [Tool]. One call into AnomalySource.DetectAnomalies
// then envelope build; no SQL is written by this method.
//
// A failure from DetectAnomalies is propagated as-is so the
// dispatcher emits a tool-error frame — but in practice the
// apianomaly.Handler implementation always returns a nil error
// (graceful-degradation contract), so the only real error path here
// is "tool was wired with a nil AnomalySource".
func (t *queryAnomalyContext) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryAnomalyContextInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_anomaly_context: no AnomalySource wired")
	}

	days := input.Days
	if days == 0 {
		days = defaultAnomalyDays
	}

	result, err := t.src.DetectAnomalies(ctx, input.VehicleID, days)
	if err != nil {
		return nil, fmt.Errorf("query_anomaly_context: detect anomalies: %w", err)
	}

	// Convert to a map[string]any envelope so the tool output
	// renders as a flat JSON object (matches the year-review +
	// digest tools' shape, keeping the dispatcher's serialisation
	// path uniform across read tools).
	return map[string]any{
		"vehicle_id":         input.VehicleID,
		"days":               days,
		"anomalies":          result.Anomalies,
		"health_summary":     result.HealthSummary,
		"signals_monitored":  result.SignalsMonitored,
		"anomalies_last_7d":  result.AnomaliesLast7d,
		"anomalies_last_24h": result.AnomaliesLast24h,
	}, nil
}

// AnomalySources bundles the narrow read interface
// RegisterAnomalyTools needs. Mirrors [DigestSources] /
// [YearReviewSources] but exposes only the surface the anomaly
// explanation tool actually consumes.
//
// Production wiring (router.go) reuses the same *apianomaly.Handler
// instance the HTTP path is built around; tests substitute
// deterministic fakes per-source.
type AnomalySources struct {
	Anomaly AnomalySource
}

// RegisterAnomalyTools installs the anomaly-explanations slice's
// tools on r. Called from router.go AFTER Register12Builtins +
// RegisterDigestTools + RegisterYearReviewTools so the registry's
// alphabetical Names list ends with `query_anomaly_context` without
// disturbing the BuiltinNames pin test or any earlier registration.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first request.
func RegisterAnomalyTools(r *tools.Registry, s AnomalySources) {
	r.Register(&queryAnomalyContext{src: s.Anomaly})
}
