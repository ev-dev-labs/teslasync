package provider

// Decorator wraps a [Provider] with cross-cutting behaviour (tracing,
// audit, redaction, rate limiting, cost capping). Decorators MUST
// preserve the [Provider] contract (forward Name + Capabilities, honour
// ctx cancellation in Chat/Stream/Embed) so a feature does not need to
// know whether the provider it received is bare or wrapped.
//
// The [Chain] helper composes decorators left-to-right. Standard order
// at construction time:
//
//	Chain(base, WithRedaction, WithRateLimit, WithCostCap, WithAudit, WithTrace)
//
// reads outer-to-inner: the trace span starts first (so audit + cost
// time live inside it), audit records what got sent, cost cap checks
// budget before rate limiter consumes a token, rate limiter blocks or
// rejects, redaction strips PII as the very last thing before the
// outbound HTTP. F1 ships only [WithTrace]; F3/F8/F9 add the others.
type Decorator func(Provider) Provider

// Chain returns base wrapped by each decorator in slice order. The
// rightmost decorator runs nearest to base; the leftmost runs nearest
// to the caller. nil decorators are silently dropped so a build that
// disables one cross-cut does not need to refactor the call site.
func Chain(base Provider, decorators ...Decorator) Provider {
	wrapped := base
	for _, d := range decorators {
		if d == nil {
			continue
		}
		wrapped = d(wrapped)
	}
	return wrapped
}
