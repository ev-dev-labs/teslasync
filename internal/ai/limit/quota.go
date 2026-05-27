package limit

import "time"

// Quota is the per-feature budget enforced by the [Limiter]. Zero
// values are treated as "unbounded" — a Quota with all-zero fields is
// the same as no quota. The default tier table in [DefaultQuotaForTier]
// never returns a zero Quota; explicit overrides via the constructor
// option [WithQuota] can.
type Quota struct {
	// BurstReq is the maximum number of in-flight calls allowed for
	// the (subject, feature) tuple at any instant. Concurrency above
	// this bound returns Decision.Reason="burst" until a prior call
	// releases its lease.
	BurstReq int

	// PerMinute is the upper bound on call starts per rolling 60s
	// window. A token bucket refills at PerMinute/60 tokens per
	// second; bucket capacity equals PerMinute so the user can spend
	// their budget in one burst then wait.
	PerMinute int

	// PerDay is the upper bound on call starts per UTC calendar day.
	// Reset happens at the next 00:00 UTC tick rather than on a
	// rolling 24h window — matches user mental model of "tomorrow I
	// get a fresh budget" and makes the monthly accounting trivial.
	PerDay int

	// InTokensPM is the upper bound on input tokens observed per
	// rolling 60s window. Best-effort post-call check (see package
	// doc strictness contract).
	InTokensPM int

	// OutTokensPM is the upper bound on output tokens observed per
	// rolling 60s window. Best-effort post-call check.
	OutTokensPM int
}

// IsZero reports whether q would impose no constraint. Used by
// [Limiter.Allow] to short-circuit unbounded buckets without taking
// the per-bucket lock.
func (q Quota) IsZero() bool {
	return q.BurstReq == 0 && q.PerMinute == 0 && q.PerDay == 0 &&
		q.InTokensPM == 0 && q.OutTokensPM == 0
}

// Decision is the verdict the limiter, the cost cap, and the
// provider-health poller all share. The dispatcher emits it verbatim
// into the SSE error frame; the frontend banner reads Reason +
// RetryAfter + BannerLevel directly.
type Decision struct {
	// Allowed is true when the caller may proceed with the
	// underlying provider call. False means the call MUST NOT be
	// dispatched; the decorator wraps the rejection in a [LimitError].
	Allowed bool

	// Reason is a stable lowercase token identifying which check
	// produced this decision. Frontend banner copy is keyed on
	// Reason; new reasons MUST be added to the AiLimitBanner i18n
	// table at the same time. Defined values:
	//   "burst"               — BurstReq exceeded
	//   "per_minute"          — PerMinute token bucket empty
	//   "per_day"             — PerDay budget exhausted
	//   "input_tokens"        — InTokensPM observed exceeded
	//   "output_tokens"       — OutTokensPM observed exceeded
	//   "cost_cap"            — daily cost cap reached
	//   "provider_unavailable"— provider-health poller suspended
	//   "missing_feature_id"  — defence-in-depth: handler forgot ID
	//   "unknown_feature_id"  — defence-in-depth: ID not in registry
	Reason string

	// RetryAfter is the duration the caller should wait before
	// re-attempting. Zero for "do not retry automatically" (cost cap,
	// missing feature ID). The frontend banner renders a countdown
	// when non-zero.
	RetryAfter time.Duration

	// BannerLevel hints to the frontend at the urgency of the user-
	// facing banner. "" (the empty string) means "no banner needed";
	// "warn" is yellow at 80% threshold; "critical" is red on
	// rejection. The cost-cap check produces "warn" even when
	// Allowed=true so the user gets a heads-up before exhaustion.
	BannerLevel string

	// BaselineAvailable is true when the caller's feature has a
	// non-AI baseline (P10) the user can fall back to. The banner
	// shows a "Use baseline" button only when this is true. Defaults
	// to true — features without a baseline are the exception (e.g.
	// pure-additive panels), and the strategy registers itself as
	// such by overriding the decorator construction.
	BaselineAvailable bool
}

// AllowedDecision is the canonical "OK to proceed" decision. The
// limiter returns this from the fast path so call sites don't litter
// with `Decision{Allowed: true}` literals.
func AllowedDecision() Decision {
	return Decision{Allowed: true, BaselineAvailable: true}
}

// FeatureTier is the canonical feature tier code (e.g. "U", "GEN",
// "M") that the per-feature quota table is keyed by. Tier strings
// match the methodology slice prefix exactly so adding a new tier
// requires touching one place in [DefaultQuotaForTier] only.
type FeatureTier string

// Tier constants mirror the Phase-50 methodology slice prefixes.
// Keep in lockstep with [internal/ai/features.Feature.Tier].
const (
	TierFoundation   FeatureTier = "F"
	TierUpgrade      FeatureTier = "U"
	TierNew          FeatureTier = "N"
	TierDriving      FeatureTier = "D"
	TierCharging     FeatureTier = "C"
	TierThermal      FeatureTier = "T"
	TierAlerts       FeatureTier = "A"
	TierGeofence     FeatureTier = "G"
	TierAnalytics    FeatureTier = "X"
	TierSystem       FeatureTier = "S"
	TierMaintenance  FeatureTier = "M"
	TierPrivacy      FeatureTier = "P"
	TierVoice        FeatureTier = "V"
	TierPowerUser    FeatureTier = "PU"
	TierGenerative   FeatureTier = "GEN"
	TierMachineLearn FeatureTier = "ML"
)

// DefaultQuotaForTier returns the conservative default quota for a
// tier per Phase-50 methodology PD6 + the F9 prompt's table:
//
//	Conversational (U/N/D/C/T/A/G/X/S/P/V/PU/F): burst=2, pm=20, pd=200
//	Generative one-shot (GEN):                   burst=1, pm=5,  pd=30
//	Background (M/ML):                           burst=1, pm=1,  pd=10
//
// Token quotas are sized to comfortably cover one verbose prompt per
// call but still throttle a runaway loop. They are NOT exact — see
// the package doc "Strictness contract" — and exist to bound damage
// rather than to enforce per-call size.
//
// An unknown tier returns the conservative conversational default
// rather than a zero Quota; defence-in-depth so a typo at the call
// site still rate-limits.
func DefaultQuotaForTier(t FeatureTier) Quota {
	switch t {
	case TierGenerative:
		return Quota{BurstReq: 1, PerMinute: 5, PerDay: 30, InTokensPM: 30000, OutTokensPM: 30000}
	case TierMaintenance, TierMachineLearn:
		return Quota{BurstReq: 1, PerMinute: 1, PerDay: 10, InTokensPM: 30000, OutTokensPM: 30000}
	default:
		// Conversational tiers — chatbot, NL search, narration, etc.
		// 2 concurrent + 20/min + 200/day is enough for an interactive
		// session without inviting a runaway script.
		return Quota{BurstReq: 2, PerMinute: 20, PerDay: 200, InTokensPM: 50000, OutTokensPM: 20000}
	}
}
