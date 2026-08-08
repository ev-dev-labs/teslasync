package provider

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tracing"
)

// WithTrace is the OTel tracing decorator. Wraps every Chat / Stream /
// Embed in a span named "ai.<provider>.<op>" with the model + token
// attributes attached on success. F1 ships this; F3 (audit) and F8/F9
// (redaction / rate / cost) chain in front of it.
func WithTrace(p Provider) Provider {
	return &tracedProvider{inner: p, name: p.Name()}
}

type tracedProvider struct {
	inner Provider
	name  string
}

func (t *tracedProvider) Name() string               { return t.inner.Name() }
func (t *tracedProvider) Capabilities() Capabilities { return t.inner.Capabilities() }

func (t *tracedProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	ctx, span := tracing.StartSpan(ctx, "ai."+t.name+".chat",
		attribute.String("ai.provider", t.name),
		attribute.String("ai.model", req.Model),
		attribute.Int("ai.messages", len(req.Messages)),
		attribute.Int("ai.tools", len(req.Tools)),
	)
	resp, err := t.inner.Chat(ctx, req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		span.End()
		return nil, err
	}
	span.SetAttributes(
		attribute.Int("ai.tokens.input", resp.InputTokens),
		attribute.Int("ai.tokens.output", resp.OutputTokens),
		attribute.String("ai.finish_reason", resp.FinishReason),
		attribute.Int("ai.tool_calls", len(resp.ToolCalls)),
	)
	span.End()
	return resp, nil
}

func (t *tracedProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	ctx, span := tracing.StartSpan(ctx, "ai."+t.name+".stream",
		attribute.String("ai.provider", t.name),
		attribute.String("ai.model", req.Model),
		attribute.Int("ai.messages", len(req.Messages)),
		attribute.Int("ai.tools", len(req.Tools)),
	)
	src, err := t.inner.Stream(ctx, req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		span.End()
		return nil, err
	}
	// Forward chunks through a relay goroutine so the span ends only
	// after the upstream channel closes (or ctx cancels). Streams that
	// the consumer never drains would otherwise leak the span.
	out := make(chan Chunk, cap(src))
	go relayChunks(ctx, span, src, out)
	return out, nil
}

func (t *tracedProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	ctx, span := tracing.StartSpan(ctx, "ai."+t.name+".embed",
		attribute.String("ai.provider", t.name),
		attribute.String("ai.model", req.Model),
		attribute.Int("ai.embed.batch", len(req.Input)),
	)
	resp, err := t.inner.Embed(ctx, req)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		span.End()
		return nil, err
	}
	span.SetAttributes(
		attribute.Int("ai.embed.vectors", len(resp.Vectors)),
		attribute.Int("ai.tokens.input", resp.InputTokens),
	)
	span.End()
	return resp, nil
}

// relayChunks copies Chunk values from src to out until src closes or
// ctx is cancelled, then closes out and ends span. Records the first
// error chunk on the span so traces show streaming failures clearly.
func relayChunks(ctx context.Context, span trace.Span, src <-chan Chunk, out chan<- Chunk) {
	defer close(out)
	defer span.End()
	chunkCount := 0
	for {
		select {
		case <-ctx.Done():
			span.RecordError(ctx.Err())
			span.SetStatus(codes.Error, ctx.Err().Error())
			return
		case c, ok := <-src:
			if !ok {
				span.SetAttributes(attribute.Int("ai.stream.chunks", chunkCount))
				return
			}
			chunkCount++
			if c.Err != nil {
				span.RecordError(c.Err)
				span.SetStatus(codes.Error, c.Err.Error())
			}
			if c.Done {
				span.SetAttributes(
					attribute.String("ai.finish_reason", c.FinishReason),
					attribute.Int("ai.tokens.input", c.InputTokens),
					attribute.Int("ai.tokens.output", c.OutputTokens),
				)
			}
			select {
			case out <- c:
			case <-ctx.Done():
				span.RecordError(ctx.Err())
				span.SetStatus(codes.Error, ctx.Err().Error())
				return
			}
			if c.Done || c.Err != nil {
				span.SetAttributes(attribute.Int("ai.stream.chunks", chunkCount))
				return
			}
		}
	}
}
