package provider

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
)

// PolicyResolver returns the redaction policy that applies to a given
// call. The dispatcher installs the policy in ctx via
// [redact.WithPolicy]; the standard resolver is therefore
// [redact.PolicyFromContext]. Tests can pass a closure that returns a
// hard-coded policy.
type PolicyResolver func(ctx context.Context) (redact.Policy, bool)

// WithRedaction returns the redaction decorator. Wraps every Chat /
// Stream / Embed in PII detection-and-replacement keyed by the policy
// pulled from ctx via resolver. The decorator:
//
//   - Returns inner unchanged when resolver returns ok=false (no
//     policy installed) — defence in depth: the call still goes
//     through, but the audit row is later annotated as bypass=true so
//     an operator notices.
//   - Skips redaction entirely when [redact.Policy.Bypass] is true
//     (local-loopback providers); records bypass=true in the meta
//     sink so the daily report flags any cloud provider that
//     accidentally got tagged local.
//   - Builds a fresh slice + fresh Message values rather than
//     mutating req — the audit decorator (one rung outside) hashes
//     the SAME req variable AFTER inner returns, so an in-place
//     mutation would corrupt the audit hash.
//   - Records the per-call meta in the process-global sink keyed by
//     [redact.MetaKey](featureID, chatRequestHash). The repo's Insert
//     consumes that meta when persisting the ai_call_log row.
//
// nil resolver is allowed (acts as a passthrough) so a build that
// disables F8 via wiring has zero overhead.
func WithRedaction(resolver PolicyResolver) Decorator {
	return func(p Provider) Provider {
		if resolver == nil {
			return p
		}
		return &redactedProvider{inner: p, resolve: resolver}
	}
}

type redactedProvider struct {
	inner   Provider
	resolve PolicyResolver
}

func (r *redactedProvider) Name() string               { return r.inner.Name() }
func (r *redactedProvider) Capabilities() Capabilities { return r.inner.Capabilities() }

func (r *redactedProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	policy, ok := r.resolve(ctx)
	if !ok {
		// Audit-visible bypass when no policy installed.
		r.recordMeta(ctx, req, nil, true)
		return r.inner.Chat(ctx, req)
	}
	if policy.Bypass {
		r.recordMeta(ctx, req, nil, true)
		return r.inner.Chat(ctx, req)
	}
	clean, classes := redactRequest(req, policy)
	r.recordMeta(ctx, req, classes, false)
	return r.inner.Chat(ctx, clean)
}

func (r *redactedProvider) Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error) {
	policy, ok := r.resolve(ctx)
	if !ok {
		r.recordMeta(ctx, req, nil, true)
		return r.inner.Stream(ctx, req)
	}
	if policy.Bypass {
		r.recordMeta(ctx, req, nil, true)
		return r.inner.Stream(ctx, req)
	}
	clean, classes := redactRequest(req, policy)
	r.recordMeta(ctx, req, classes, false)
	return r.inner.Stream(ctx, clean)
}

func (r *redactedProvider) Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error) {
	policy, ok := r.resolve(ctx)
	if !ok {
		recordEmbedMeta(ctx, req, nil, true)
		return r.inner.Embed(ctx, req)
	}
	if policy.Bypass {
		recordEmbedMeta(ctx, req, nil, true)
		return r.inner.Embed(ctx, req)
	}
	clean, classes := redactEmbedRequest(req, policy)
	recordEmbedMeta(ctx, req, classes, false)
	return r.inner.Embed(ctx, clean)
}

// recordMeta is the Chat/Stream meta-sink writer. The audit decorator
// (which lives one decorator outwards) hashes the SAME req variable
// after we return, so we MUST hash off the original (pre-redaction)
// request to keep the keys aligned.
func (r *redactedProvider) recordMeta(ctx context.Context, req ChatRequest, classes []redact.PIIClass, bypass bool) {
	hash := chatRequestHash(req)
	feature := FeatureIDFromContext(ctx)
	redact.RecordMeta(redact.MetaKey(feature, hash), redact.Meta{
		Classes: classes,
		Bypass:  bypass,
	})
}

func recordEmbedMeta(ctx context.Context, req EmbedRequest, classes []redact.PIIClass, bypass bool) {
	hash := embedRequestHash(req)
	feature := FeatureIDFromContext(ctx)
	redact.RecordMeta(redact.MetaKey(feature, hash), redact.Meta{
		Classes: classes,
		Bypass:  bypass,
	})
}

// redactRequest returns a deep copy of req with every Message.Content
// rewritten according to policy. Tool arguments are left in place
// because they are JSON the dispatcher already validated against a
// typed schema (PII flows via tool args only when the schema
// explicitly allows it; the type system is the gatekeeper there).
//
// classes is the union of distinct PIIClass values that were rewritten
// across all messages — flattened so the audit row can record one
// aggregate set per call rather than per message.
func redactRequest(req ChatRequest, policy redact.Policy) (ChatRequest, []redact.PIIClass) {
	if len(req.Messages) == 0 {
		return req, nil
	}
	out := req
	out.Messages = make([]Message, len(req.Messages))
	classSet := make(map[redact.PIIClass]bool, 4)
	for i, msg := range req.Messages {
		clean, _, perMsg := redact.Apply(msg.Content, policy)
		// Copy the message and replace Content; pointers are
		// shallow-copied which is fine because Tool is read-only
		// downstream of the decorator.
		newMsg := msg
		newMsg.Content = clean
		out.Messages[i] = newMsg
		for _, c := range perMsg {
			classSet[c] = true
		}
	}
	if len(classSet) == 0 {
		return out, nil
	}
	classes := make([]redact.PIIClass, 0, len(classSet))
	for c := range classSet {
		classes = append(classes, c)
	}
	return out, classes
}

// redactEmbedRequest mirrors [redactRequest] for the embed path. Each
// input string is rewritten independently so a batch with one PII
// payload does not cross-contaminate the others.
func redactEmbedRequest(req EmbedRequest, policy redact.Policy) (EmbedRequest, []redact.PIIClass) {
	if len(req.Input) == 0 {
		return req, nil
	}
	out := req
	out.Input = make([]string, len(req.Input))
	classSet := make(map[redact.PIIClass]bool, 4)
	for i, in := range req.Input {
		clean, _, perItem := redact.Apply(in, policy)
		out.Input[i] = clean
		for _, c := range perItem {
			classSet[c] = true
		}
	}
	if len(classSet) == 0 {
		return out, nil
	}
	classes := make([]redact.PIIClass, 0, len(classSet))
	for c := range classSet {
		classes = append(classes, c)
	}
	return out, classes
}
