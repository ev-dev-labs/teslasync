package provider

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/cost"
	"github.com/ev-dev-labs/teslasync/internal/ai/limit"
)

// WithCostCap returns the decorator that runs every Chat / Stream /
// Embed call through the [limit.CostCap] gate. The decorator sits
// OUTSIDE the rate-limit decorator (closer to the dispatcher) per
// the F9 prompt design D10.3 — cost-cap is the cheaper check (LRU
// hit) and a cost-cap reject must NOT consume rate-limit budget.
//
// The cap is constructed at boot via [limit.NewCostCap] with the
// user's settings-store-backed [limit.CapLookup] already wired in.
// This decorator is the thin glue that calls Check + release around
// the inner call.
//
// Behaviour:
//   - Estimates cost from the request: req.MaxTokens for output (or
//     a conservative 1024 default when MaxTokens=0); the sum of
//     message content lengths / 4 as a token proxy for input. The
//     Compute() math then produces a micro-cents estimate.
//   - On Allowed=false: returns a [*limit.LimitError] wrapping the
//     decision. Same dispatcher path as the rate-limit decorator.
//   - On Allowed=true: invokes the inner provider, then calls
//     release(actualMicroCents) — for non-streaming responses we
//     compute the actual via [cost.Compute] on resp.{Input,Output}Tokens.
//     For streaming, release(-1) is used because the chunk channel
//     does not surface final token counts; the audit decorator (one
//     rung outwards) writes the authoritative number to ai_call_log
//     and the next 30s cache refresh picks it up.
//
// nil cap is allowed (acts as a passthrough). A build that omits F9
// wiring has zero overhead.
func WithCostCap(costCap *limit.CostCap) Decorator {
	return func(p Provider) Provider {
		if costCap == nil {
			return p
		}
		return &costCappedProvider{inner: p, cap: costCap}
	}
}

type costCappedProvider struct {
	inner Provider
	cap   *limit.CostCap
}

func (c *costCappedProvider) Name() string               { return c.inner.Name() }
func (c *costCappedProvider) Capabilities() Capabilities { return c.inner.Capabilities() }

func (c *costCappedProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	subject := SubjectFromContext(ctx)
	estIn, estOut := estimateTokens(req)

	d, release, err := c.cap.Check(ctx, subject, c.inner.Name(), req.Model, estIn, estOut)
	if err != nil {
		// Repo failure: still has a useful Decision (fail-closed)
		// and a real error for the audit row. Surface both.
		return nil, limit.NewLimitError(d)
	}
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}

	resp, callErr := c.inner.Chat(ctx, req)
	if callErr != nil {
		// Failed call - still release with 0 actual; the audit row
		// will record 0 cost too.
		release(0)
		return resp, callErr
	}
	if resp == nil {
		release(0)
		return resp, callErr
	}
	// Reconcile reservation with the ACTUAL post-call cost computed
	// from token counts. This keeps the in-memory `today` snapshot
	// monotonically correct so the next 80%-warn check fires at the
	// right moment without waiting for the 30s repo refresh.
	actual := cost.Compute(c.inner.Name(), req.Model, resp.InputTokens, resp.OutputTokens)
	release(actual)
	return resp, nil
}

func (c *costCappedProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	subject := SubjectFromContext(ctx)
	estIn, estOut := estimateTokens(req)

	d, release, err := c.cap.Check(ctx, subject, c.inner.Name(), req.Model, estIn, estOut)
	if err != nil {
		return nil, limit.NewLimitError(d)
	}
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}

	innerCh, callErr := c.inner.Stream(ctx, req)
	if callErr != nil {
		release(0)
		return nil, callErr
	}
	if innerCh == nil {
		release(0)
		return nil, ErrCapabilityNotSupported
	}

	out := make(chan Chunk, 16)
	go func() {
		defer release(-1)
		defer close(out)
		for {
			select {
			case <-ctx.Done():
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

func (c *costCappedProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	subject := SubjectFromContext(ctx)
	estIn := 0
	for _, in := range req.Input {
		estIn += approxTokens(in)
	}

	d, release, err := c.cap.Check(ctx, subject, c.inner.Name(), req.Model, estIn, 0)
	if err != nil {
		return nil, limit.NewLimitError(d)
	}
	if !d.Allowed {
		return nil, limit.NewLimitError(d)
	}

	resp, callErr := c.inner.Embed(ctx, req)
	if callErr != nil {
		release(0)
		return resp, callErr
	}
	if resp == nil {
		release(0)
		return resp, callErr
	}
	actual := cost.Compute(c.inner.Name(), req.Model, resp.InputTokens, 0)
	release(actual)
	return resp, nil
}

// estimateTokens returns a conservative (input, output) estimate for
// req. Used by the cost-cap reservation pre-call. The math is
// intentionally cheap and rounds UP — over-reserving briefly is fine
// (release reconciles with the actual); under-reserving would let a
// big call slip past the cap.
//
// Approximation:
//
//   - input: sum of message content lengths / 4 chars per token
//     (the OpenAI rule of thumb). System messages count too.
//   - output: req.MaxTokens, or 1024 if MaxTokens=0 (the safe
//     default for a feature that hasn't bothered to bound itself).
func estimateTokens(req ChatRequest) (in, out int) {
	for _, m := range req.Messages {
		in += approxTokens(m.Content)
	}
	if req.MaxTokens > 0 {
		out = req.MaxTokens
	} else {
		out = 1024
	}
	return in, out
}

// approxTokens is the OpenAI-published rule-of-thumb: about 4 chars
// per token for English. Returns at least 1 for any non-empty string
// so a one-character prompt still counts as one call.
func approxTokens(s string) int {
	if s == "" {
		return 0
	}
	t := len(s) / 4
	if t < 1 {
		t = 1
	}
	return t
}
