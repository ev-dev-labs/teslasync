package provider

import "errors"

// Sentinel errors returned by the registry and adapters. Callers compare
// with errors.Is so decorator wrapping still preserves the contract.
var (
	// ErrProviderDisabled is returned by [Registry.For] when the user's
	// AI mode is "off" (ADR-015 §I1). The guard short-circuits before
	// reaching here, so this is a defence-in-depth signal for code
	// paths that bypass the HTTP layer (e.g. background jobs that
	// re-check the gate at execution time per ADR-015 §I12 #3).
	ErrProviderDisabled = errors.New("ai/provider: AI is disabled (ai_mode='off')")

	// ErrFeatureDisabled is returned by [Registry.For] when AI mode
	// is on but the per-feature toggle is off (ADR-015 §I7).
	ErrFeatureDisabled = errors.New("ai/provider: feature is disabled by per-feature toggle")

	// ErrUnknownProvider is returned when the resolved provider name
	// is not registered with the [Registry]. Indicates a typo in the
	// settings.ai_provider_config.default key or an unconfigured
	// provider override on a feature.
	ErrUnknownProvider = errors.New("ai/provider: unknown provider name")

	// ErrMissingConfig is returned when the resolved provider name has
	// no configuration entry in settings.ai_provider_config. The
	// Settings UI prevents this for the active mode, but the registry
	// double-checks so a corrupted settings row surfaces a clear error
	// instead of a nil-deref.
	ErrMissingConfig = errors.New("ai/provider: missing provider configuration")

	// ErrLocalModeViolation is returned by [ValidateLocal] when the
	// configured base_url is not on a private (RFC1918 / loopback /
	// link-local / ULA) network.
	ErrLocalModeViolation = errors.New("ai/provider: local mode rejects non-private host")

	// ErrCapabilityNotSupported is returned by an adapter when the
	// caller invokes a method whose corresponding [Capabilities] field
	// is false (e.g. Anthropic.Embed).
	ErrCapabilityNotSupported = errors.New("ai/provider: capability not supported by this adapter")

	// ErrUpstream is the catch-all for non-2xx responses or transport
	// failures from the underlying provider. Wrapped with %w so the
	// raw error remains inspectable; the message includes the HTTP
	// status when available so logs are self-explanatory.
	ErrUpstream = errors.New("ai/provider: upstream request failed")
)

// NormalizeFinishReason maps provider-specific terminal reasons onto the
// portable Finish* constants. An empty return value means the provider did not
// supply a recognized terminal reason.
func NormalizeFinishReason(reason string) string {
	switch reason {
	case FinishStop, "end_turn", "stop_sequence":
		return FinishStop
	case FinishToolCalls, "tool_use":
		return FinishToolCalls
	case FinishLength, "max_tokens":
		return FinishLength
	case FinishContentFilter:
		return FinishContentFilter
	default:
		return ""
	}
}
