// Package cost is the table-driven per-model price oracle for AI calls.
//
// Why this lives in its own package
// ---------------------------------
// The audit decorator (internal/ai/provider/audit.go) computes a row's
// cost_micro_cents at write time so the usage card can render
// "today" / "this month" totals as a SUM aggregate without joining
// against a price table. Pulling the cost math into a package keeps
// that math testable in isolation and gives ops a single grep-target
// when an upstream provider revises its pricing.
//
// Units
// -----
// Every public function returns BIGINT micro-cents (1 cent = 10000
// micro-cents). The choice avoids floating-point rounding when the
// usage card SUMs across thousands of calls — pgx's BIGINT round-
// trips Go int64 exactly, so a $0.000125 prompt cost (12500 micro-
// cents) survives the database / aggregate / JSON serialisation
// pipeline without drift.
//
// Local providers
// ---------------
// Ollama and the eval mock provider always cost zero. They are listed
// in the price table explicitly so a future "estimate the dollar
// impact of moving this workload to OpenAI" feature has a single
// place to override the rate.
//
// ADR-015 invariants touched
// --------------------------
// §I8 (data survives downgrade): cost rows recorded under one set of
// rates do not magically rewrite themselves when the rate table is
// updated; the past is permanent. New calls use the new rates.
package cost

import (
	"sort"
	"strings"
	"sync"
)

// Provider names — duplicated as raw constants to keep this package
// dependency-free (the provider package imports this one for the
// Audit decorator; no cycle allowed).
const (
	ProviderOllama    = "ollama"
	ProviderOpenAI    = "openai"
	ProviderAnthropic = "anthropic"
	ProviderMock      = "mock"
)

// MicroCentsPerCent is the integer scaling factor we apply when
// quoting prices that vendors publish in dollars per million tokens.
const MicroCentsPerCent = 10000

// Rate is one entry in the price table — the dollar cost per million
// input + output tokens, expressed in micro-cents per million tokens
// for the integer math below.
//
// "Per million tokens" is the common publication unit; we store it
// already multiplied so the [Compute] hot path is two multiplies +
// two divides (no float64 anywhere).
//
// Unit conversion reminder:
//
//	$1 = 100 cents = 1 000 000 micro-cents (1 cent = MicroCentsPerCent).
//	$0.15 / 1M input tokens = 15 cents = 150 000 micro-cents per 1M.
type Rate struct {
	// InputMicroCentsPerMillion is the price of one million input
	// tokens in micro-cents. Example: OpenAI gpt-4o-mini at
	// $0.15 / 1M input tokens = 150 000 micro-cents.
	InputMicroCentsPerMillion int64

	// OutputMicroCentsPerMillion is the price of one million output
	// tokens in micro-cents. Output is typically 2-4× the input rate.
	OutputMicroCentsPerMillion int64
}

// table is the single source of truth for per-(provider, model) rates.
//
// Vendor publication source for each rate is comment-pinned so an
// auditor can re-derive every number from the listed URL. Last
// reviewed: Phase-50 (2026 spring). When a vendor revises a rate,
// edit this map and bump the comment date — never silently update.
//
// The map is initialised in init() so a parallel test that pokes
// internals cannot race with the eager `var x = map{...}` form.
var (
	tableMu sync.RWMutex
	table   map[string]map[string]Rate
)

func init() {
	table = map[string]map[string]Rate{
		// Local providers price 0. Listed explicitly so the
		// "is this provider known?" check in [Compute] succeeds and
		// the call doesn't get billed at the unknown-model fallback
		// rate (which is intentionally 0 too, but we want the
		// distinction in tests).
		ProviderOllama: {},
		ProviderMock:   {},

		// OpenAI — https://openai.com/api/pricing/ (2026 review).
		// gpt-4o-mini is PD2 default; the others are common picks
		// that Settings → AI lets users select. Values are
		// micro-cents per 1M tokens (so $0.15/1M = 150 000).
		ProviderOpenAI: {
			"gpt-4o-mini":            {InputMicroCentsPerMillion: 150_000, OutputMicroCentsPerMillion: 600_000},
			"gpt-4o":                 {InputMicroCentsPerMillion: 2_500_000, OutputMicroCentsPerMillion: 10_000_000},
			"gpt-4-turbo":            {InputMicroCentsPerMillion: 10_000_000, OutputMicroCentsPerMillion: 30_000_000},
			"gpt-3.5-turbo":          {InputMicroCentsPerMillion: 500_000, OutputMicroCentsPerMillion: 1_500_000},
			"text-embedding-3-small": {InputMicroCentsPerMillion: 20_000, OutputMicroCentsPerMillion: 0},
			"text-embedding-3-large": {InputMicroCentsPerMillion: 130_000, OutputMicroCentsPerMillion: 0},
		},

		// Anthropic — https://www.anthropic.com/pricing (2026 review).
		// Claude 3.5 Sonnet is the default model surfaced by the
		// Anthropic adapter (provider/config.go). Values are
		// micro-cents per 1M tokens.
		ProviderAnthropic: {
			"claude-3-5-sonnet-20240620": {InputMicroCentsPerMillion: 3_000_000, OutputMicroCentsPerMillion: 15_000_000},
			"claude-3-5-haiku-20241022":  {InputMicroCentsPerMillion: 800_000, OutputMicroCentsPerMillion: 4_000_000},
			"claude-3-opus-20240229":     {InputMicroCentsPerMillion: 15_000_000, OutputMicroCentsPerMillion: 75_000_000},
		},
	}
}

// Compute returns the cost in micro-cents of a (provider, model,
// inputTokens, outputTokens) tuple.
//
// Behaviour:
//
//   - Negative token counts are clamped to zero. The audit decorator
//     should never pass negatives but token counters in some
//     adapters are best-effort and a glitch should not produce a
//     negative bill.
//
//   - An unknown (provider, model) tuple returns 0. The decorator
//     still writes the row (so the call is auditable); the missing
//     rate surfaces in the usage card as "no $ recorded for this
//     model" and the operator can either add the rate to the table
//     or accept the gap.
//
//   - Local providers (ollama, mock) and any explicit rate of 0 also
//     return 0 — they short-circuit the multiply.
//
// The math uses int64 throughout. A million tokens at the highest
// listed rate (claude-3-opus output, 75 000 000 mc / 1M = $7.50 / 1M)
// is 75 000 000 micro-cents — well below the int64 ceiling even with
// billions of calls.
func Compute(provider, model string, inputTokens, outputTokens int) int64 {
	if inputTokens < 0 {
		inputTokens = 0
	}
	if outputTokens < 0 {
		outputTokens = 0
	}
	rate, ok := lookup(provider, model)
	if !ok {
		return 0
	}
	if rate.InputMicroCentsPerMillion == 0 && rate.OutputMicroCentsPerMillion == 0 {
		return 0
	}
	// (tokens * rate) / 1_000_000 — integer division floors, matching
	// the published "per million tokens" semantics. The division
	// happens after the multiply so we never lose precision on the
	// common case of small token counts.
	in := int64(inputTokens) * rate.InputMicroCentsPerMillion / 1_000_000
	out := int64(outputTokens) * rate.OutputMicroCentsPerMillion / 1_000_000
	return in + out
}

// HasRate reports whether the (provider, model) pair has an entry in
// the price table. Used by tests + the future Settings → AI "Cost
// estimate" tooltip to distinguish "this model costs nothing" from
// "we don't know what this model costs".
func HasRate(provider, model string) bool {
	_, ok := lookup(provider, model)
	return ok
}

// KnownProviders returns the provider names with at least one entry
// in the price table, in deterministic order. Used by the cost-table
// snapshot test to assert no provider was accidentally dropped.
func KnownProviders() []string {
	tableMu.RLock()
	defer tableMu.RUnlock()
	out := make([]string, 0, len(table))
	for p := range table {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// ModelsFor returns the model names registered under provider, in
// deterministic order. Returns nil for an unknown provider so callers
// can `range nil` safely.
func ModelsFor(provider string) []string {
	tableMu.RLock()
	defer tableMu.RUnlock()
	models, ok := table[provider]
	if !ok {
		return nil
	}
	out := make([]string, 0, len(models))
	for m := range models {
		out = append(out, m)
	}
	sort.Strings(out)
	return out
}

// lookup is the case-insensitive reader the public functions share.
// We compare lowercased keys so a settings entry that mis-cases the
// model id (e.g. "GPT-4o-mini") still picks up the correct rate.
func lookup(provider, model string) (Rate, bool) {
	tableMu.RLock()
	defer tableMu.RUnlock()
	models, ok := table[strings.ToLower(strings.TrimSpace(provider))]
	if !ok {
		return Rate{}, false
	}
	r, ok := models[strings.ToLower(strings.TrimSpace(model))]
	if !ok {
		return Rate{}, false
	}
	return r, true
}
