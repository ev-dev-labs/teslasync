package provider

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/limit"
)

// WithRateLimit returns the decorator that runs every Chat / Stream /
// Embed call through the [limit.Limiter] gate. The decorator:
//
//   - Pulls (subject, featureID) from ctx via the existing
//     [SubjectFromContext] / [FeatureIDFromContext] helpers, exactly
//     like the audit decorator does. The dispatcher installs both
//     before invoking the chain.
//   - Calls limiter.Allow(subject, featureID, p.Name()) — provider
//     name is supplied so the provider-health poller's suspend hook
//     (limit.SuspendProvider) can short-circuit calls to a sick local
//     provider.
//   - On Allowed=false: returns a [*limit.LimitError] wrapping the
//     [limit.Decision]. The dispatcher catches this via errors.As and
//     surfaces it on the SSE stream via [stream.Writer.WriteLimitError]
//     so the frontend banner can pivot to the non-AI baseline.
//   - On Allowed=true: invokes the inner provider, then unconditionally
//     calls release() (the inflight slot must free even when the inner
//     errors, otherwise a panicking adapter starves the bucket forever).
//   - For Stream(): forks a goroutine that drains the inner channel +
//     re-emits chunks; release() runs when the inner closes the channel
//     OR ctx cancels — never on the Stream() return path itself, because
//     the call is "in flight" until the channel drains.
//
// nil limiter is allowed (acts as a passthrough) so a build that
// omits F9 wiring has zero overhead. This matches the WithRedaction
// nil-resolver pattern.
func WithRateLimit(limiter *limit.Limiter) Decorator {
	return func(p Provider) Provider {
		if limiter == nil {
			return p
		}
		return &rateLimitedProvider{inner: p, limiter: limiter}
	}
}

type rateLimitedProvider struct {
	inner   Provider
	limiter *limit.Limiter
}

func (r *rateLimitedProvider) Name() string               { return r.inner.Name() }
func (r *rateLimitedProvider) Capabilities() Capabilities { return r.inner.Capabilities() }

func (r *rateLimitedProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	subject := SubjectFromContext(ctx)
	feature := FeatureIDFromContext(ctx)

	d, release := r.limiter.Allow(subject, feature, r.inner.Name())
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}
	defer release()

	resp, err := r.inner.Chat(ctx, req)
	if err == nil && resp != nil {
		// Best-effort token observation — the audit decorator (one
		// rung outwards) records the same numbers in ai_call_log so
		// the limiter's view stays roughly in sync with the database.
		r.limiter.Observe(subject, feature, resp.InputTokens, resp.OutputTokens)
	}
	return resp, err
}

func (r *rateLimitedProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	subject := SubjectFromContext(ctx)
	feature := FeatureIDFromContext(ctx)

	d, release := r.limiter.Allow(subject, feature, r.inner.Name())
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}

	innerCh, err := r.inner.Stream(ctx, req)
	if err != nil {
		// Inner refused — release the slot before bubbling the error.
		release()
		return nil, err
	}
	if innerCh == nil {
		// Defence in depth: an adapter that returned nil err but no
		// channel would leak the slot forever. Same return contract
		// as Provider.Stream documents.
		release()
		return nil, ErrCapabilityNotSupported
	}

	// Fork: drain inner -> re-emit on outer; release on close OR ctx done.
	out := make(chan Chunk, 16)
	go func() {
		defer release()
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				// Drain remaining chunks so the inner producer is not
				// blocked forever on an un-read send.
				go func() {
					for range innerCh {
					}
				}()
				return
			case chunk, ok := <-innerCh:
				if !ok {
					return
				}
				select {
				case out <- chunk:
				case <-ctx.Done():
					go func() {
						for range innerCh {
						}
					}()
					return
				}
			}
		}
	}()
	return out, nil
}

func (r *rateLimitedProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	subject := SubjectFromContext(ctx)
	feature := FeatureIDFromContext(ctx)

	d, release := r.limiter.Allow(subject, feature, r.inner.Name())
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}
	defer release()

	resp, err := r.inner.Embed(ctx, req)
	if err == nil && resp != nil {
		r.limiter.Observe(subject, feature, resp.InputTokens, 0)
	}
	return resp, err
}
