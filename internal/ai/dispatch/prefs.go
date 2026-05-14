// User-preference plumbing for the AI dispatcher.
//
// AI features in TeslaSync narrate data that originates from the
// telemetry pipeline in SI canonical units (meters, seconds, m/s,
// watt-hours, Celsius, kPa, etc.). Users, however, configure their
// preferred display units (Miles / mph / Fahrenheit / PSI / locale /
// decimal precision / currency) in the global Application settings.
// Without an explicit signal the LLM defaults to whatever the tool
// fields look like — usually SI — which mismatches the rest of the
// UI and produces a confusing UX.
//
// This package solves it the dispatcher-native way: a single
// [UserPrefs] value is carried through ctx (mirrors the existing
// redact.WithPolicy pattern), and the dispatcher's Run prepends a
// SHORT system message that tells the LLM exactly which units to
// narrate in. Each handler is therefore unchanged; the wiring
// happens once via the userPrefsMiddleware in ai_routes.go.
//
// Design properties:
//   - Cross-cutting (every feature gets it, no per-handler churn).
//   - Cheap to add to existing tests (an empty UserPrefs is a no-op).
//   - Safe by default — a missing/zero UserPrefs produces no system
//     message and the dispatcher behaves exactly as before.
//   - The injected hint is short and assertive so qwen2.5:7b-class
//     models reliably honour it without burning tokens.
package dispatch

import (
	"context"
	"fmt"
	"strings"
)

// UserPrefs captures the subset of the global Application settings
// that affect LLM narration. Field semantics match the canonical
// values stored in [models.Settings] (e.g. "Miles" / "Kilometers"
// for UnitOfLength). Empty strings / zero values are treated as
// "unspecified" and skipped when formatting the system hint.
type UserPrefs struct {
	// UnitOfLength is "Miles" or "Kilometers".
	UnitOfLength string

	// UnitOfTemp is "Fahrenheit" or "Celsius".
	UnitOfTemp string

	// UnitOfPressure is "PSI", "kPa", or "Bar".
	UnitOfPressure string

	// PreferredRange is "Rated" or "Ideal" — relevant for any
	// strategy that mentions range/efficiency narration.
	PreferredRange string

	// CurrencySymbol is the glyph the user sees in cost UI
	// (typically "$", "€", "£"). The LLM should use this when
	// narrating monetary figures (electricity cost, gas-vs-EV
	// comparison, trip-cost estimates).
	CurrencySymbol string

	// DecimalPrecision is the count of digits after the decimal
	// the user prefers in numeric output (0..3 typically).
	DecimalPrecision int

	// Locale is a BCP-47 tag (e.g. "en-US") used to hint thousands
	// / decimal separators when verbalising numbers.
	Locale string

	// Language is the user-facing language label (e.g. "English",
	// "Spanish"). Currently informational; future i18n work may
	// pivot the system prompt on this.
	Language string
}

// ctxKey is the unique type for this package's context.WithValue
// keys. A private type prevents key collisions across packages —
// same pattern as internal/ai/redact/ctx.go.
type ctxKey int

const (
	ctxKeyUserPrefs ctxKey = iota + 1
)

// WithUserPrefs returns a derived context that carries p. The
// userPrefsMiddleware in package api installs the prefs once per
// HTTP request (resolved from the global Settings repo). The
// dispatcher's Run reads them via [UserPrefsFromContext] and
// converts them to a system-message hint before the first
// provider.Chat call.
//
// A nil parent ctx is tolerated to mirror redact.WithPolicy.
func WithUserPrefs(ctx context.Context, p UserPrefs) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, ctxKeyUserPrefs, p)
}

// UserPrefsFromContext returns the prefs stored in ctx by
// [WithUserPrefs]. The second return is false when no prefs have
// been installed; callers should treat that as "no hint — leave the
// model to its defaults".
func UserPrefsFromContext(ctx context.Context) (UserPrefs, bool) {
	if ctx == nil {
		return UserPrefs{}, false
	}
	v := ctx.Value(ctxKeyUserPrefs)
	if v == nil {
		return UserPrefs{}, false
	}
	p, ok := v.(UserPrefs)
	if !ok {
		return UserPrefs{}, false
	}
	return p, true
}

// IsZero reports whether p carries no user-visible preference. A
// zero UserPrefs produces an empty system hint and is therefore
// skipped by the dispatcher.
func (p UserPrefs) IsZero() bool {
	return p.UnitOfLength == "" &&
		p.UnitOfTemp == "" &&
		p.UnitOfPressure == "" &&
		p.PreferredRange == "" &&
		p.CurrencySymbol == "" &&
		p.DecimalPrecision == 0 &&
		p.Locale == "" &&
		p.Language == ""
}

// SystemMessage renders p into a short, assertive system-message
// body the LLM can act on without ambiguity. Returns "" when p is
// zero (the dispatcher then skips the injection entirely).
//
// The phrasing is deliberately imperative ("Narrate distances in
// MILES") because qwen2.5-class local models follow strongly-worded
// constraints more reliably than soft suggestions. The SI→display
// conversion factors are spelled out so the model doesn't have to
// recall them from training data — it just plugs the tool's SI
// value into the formula.
func (p UserPrefs) SystemMessage() string {
	if p.IsZero() {
		return ""
	}

	var lines []string

	if u := normaliseLength(p.UnitOfLength); u != "" {
		switch u {
		case "Miles":
			lines = append(lines,
				"- Distance: MILES. Convert meters → miles by dividing by 1609.344. Convert km → miles by dividing by 1.609344. Worked example: 4150 m ÷ 1609.344 = 2.58 mi.",
				"- Speed: MPH. Convert m/s → mph by multiplying by 2.23694. Convert km/h → mph by dividing by 1.609344. Worked example: 12.87 m/s × 2.23694 = 28.79 mph.",
				"- Efficiency: Wh/mi (or mi/kWh) — never Wh/km.",
			)
		case "Kilometers":
			lines = append(lines,
				"- Distance: KILOMETERS. Convert meters → km by dividing by 1000. Worked example: 4150 m ÷ 1000 = 4.15 km.",
				"- Speed: KM/H. Convert m/s → km/h by multiplying by 3.6. Worked example: 12.87 m/s × 3.6 = 46.33 km/h.",
				"- Efficiency: Wh/km (or km/kWh) — never Wh/mi.",
			)
		}
	}

	if u := normaliseTemp(p.UnitOfTemp); u != "" {
		switch u {
		case "Fahrenheit":
			lines = append(lines,
				"- Temperature: FAHRENHEIT. ALWAYS apply the formula °F = (°C × 9/5) + 32 to the ACTUAL °C value from the tool. Compute step-by-step; do NOT copy any example temperature.",
				"  Formula reference (use the formula, not these illustrative inputs):",
				"    100°C → (100 × 9/5) + 32 = 180 + 32 = 212°F",
				"    37°C  → (37  × 9/5) + 32 = 66.6 + 32 = 98.6°F",
				"  Sign rules for negatives: keep the sign on the multiplication step — e.g. for a negative °C value v, compute (v × 9/5) first (which stays negative) THEN add 32. Do NOT subtract from the °C value to get °F.",
			)
		case "Celsius":
			lines = append(lines, "- Temperature: CELSIUS. Tool fields are already °C; pass through.")
		}
	}

	if u := normalisePressure(p.UnitOfPressure); u != "" {
		switch u {
		case "PSI":
			lines = append(lines, "- Tire pressure: PSI. Convert kPa → psi by dividing by 6.89476.")
		case "kPa":
			lines = append(lines, "- Tire pressure: kPa. Tool fields are already kPa; pass through.")
		case "Bar":
			lines = append(lines, "- Tire pressure: BAR. Convert kPa → bar by dividing by 100.")
		}
	}

	if p.PreferredRange != "" {
		lines = append(lines, fmt.Sprintf("- Range: when mentioning vehicle range, prefer the %s estimate.", p.PreferredRange))
	}

	if p.CurrencySymbol != "" {
		lines = append(lines, fmt.Sprintf("- Currency: prefix monetary values with %q (e.g. %s12.34).", p.CurrencySymbol, p.CurrencySymbol))
	}

	if p.DecimalPrecision > 0 {
		lines = append(lines, fmt.Sprintf("- Decimal precision: round numeric values to %d decimal place(s) in prose (e.g. %s).", p.DecimalPrecision, examplePrecision(p.DecimalPrecision)))
	}

	if p.Locale != "" {
		lines = append(lines, fmt.Sprintf("- Locale: %s — use locale-appropriate thousands/decimal separators when verbalising large numbers.", p.Locale))
	}

	if len(lines) == 0 {
		// Every field was set to an unrecognised alias — emitting
		// just the preamble + footer would waste tokens without
		// instructing the model on anything. Treat as "no hint".
		return ""
	}

	var b strings.Builder
	b.WriteString("User display preferences (apply when narrating numeric values; convert from the SI fields returned by tools before mentioning them):\n")
	for _, l := range lines {
		b.WriteString(l)
		b.WriteByte('\n')
	}
	b.WriteString("Always present the converted (display-unit) value in the narration. You may show the SI value parenthetically if it adds clarity, but the lead figure MUST be in the user's preferred units.")
	return b.String()
}

// normaliseLength accepts case- and synonym-insensitive aliases for
// the two canonical distance unit strings stored in settings. The
// frontend wire vocabulary uses "Miles"/"Kilometers" but vehicle
// telemetry sometimes carries "mi"/"km" — we coerce both to the
// canonical title-cased forms so SystemMessage can switch on a
// stable set.
func normaliseLength(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "miles", "mile", "mi":
		return "Miles"
	case "kilometers", "kilometres", "kilometer", "kilometre", "km":
		return "Kilometers"
	}
	return ""
}

func normaliseTemp(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "fahrenheit", "f", "°f":
		return "Fahrenheit"
	case "celsius", "c", "°c":
		return "Celsius"
	}
	return ""
}

func normalisePressure(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "psi":
		return "PSI"
	case "kpa":
		return "kPa"
	case "bar":
		return "Bar"
	}
	return ""
}

// examplePrecision returns a sample number with n digits after the
// decimal to anchor the LLM ("14.2" / "14.20" / "14.200"). Cheap
// and self-documenting in the prompt.
func examplePrecision(n int) string {
	switch {
	case n <= 0:
		return "14"
	case n == 1:
		return "14.2"
	case n == 2:
		return "14.20"
	case n == 3:
		return "14.200"
	default:
		return fmt.Sprintf("%.*f", n, 14.2)
	}
}
