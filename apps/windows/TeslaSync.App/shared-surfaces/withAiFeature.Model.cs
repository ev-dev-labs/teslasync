using TeslaSync.App.FeatureViews.Settings;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the AI-feature visibility-gate surface — the native mirror of the web
/// <c>withAiFeature</c> higher-order component (web/src/components/ai/withAiFeature.tsx, ADR-015 "AI-Off
/// Contract"). The web HOC is anonymous: it renders no titles or labels of its own, only a transparent marker
/// wrapper around the gated surface, so this metadata carries the diagnostics slug, the off-mode marker
/// convention, the registry guard and the unknown-feature error text — but no i18n keys (there are none to
/// extract). Every member is WinUI-free so the registration is asserted headlessly without a XAML host.
/// </summary>
public static class WithAiFeatureRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "withAiFeature";

    /// <summary>
    /// The marker-id prefix shared by every gated AI surface — the native analogue of the web wrapper's
    /// <c>data-ai-feature</c> / <c>data-testid</c> base (web <c>`ai-feature-${feature}`</c>).
    /// </summary>
    public const string MarkerPrefix = "ai-feature-";

    /// <summary>
    /// The marker-id suffix the canonical AI surfaces register: web <c>meta.uiTestIds[0]</c> is
    /// <c>ai-feature-&lt;id&gt;-root</c> for every gated feature surface (see web/src/ai/features.ts).
    /// </summary>
    public const string MarkerSuffix = "-root";

    /// <summary>
    /// The root marker automation id for <paramref name="featureId"/> — <c>ai-feature-&lt;id&gt;-root</c>, the
    /// native analogue of the web wrapper's <c>data-testid</c> (<c>meta.uiTestIds[0]</c>) and
    /// <c>data-ai-feature</c> markers the AI-off invariant walk asserts. Matches the existing native surfaces'
    /// root ids (e.g. <c>ai-feature-rag-help-root</c>) and the web <c>withAiFeature.test.tsx</c> assertion
    /// (<c>ai-feature-chatbot-llm-root</c>).
    /// </summary>
    /// <param name="featureId">The AI feature id (web <c>AiFeatureId</c>).</param>
    /// <returns>The root marker automation id.</returns>
    public static string RootAutomationId(string featureId)
    {
        ArgumentException.ThrowIfNullOrEmpty(featureId);
        return string.Concat(MarkerPrefix, featureId, MarkerSuffix);
    }

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of the web HOC's <c>if (!AI_FEATURES[feature]) throw ...</c> guard (and of
    /// <c>useAiEnabled</c>'s <c>if (!AI_FEATURES[feature]) return false</c>). Guards against a typo silently
    /// gating nothing forever.
    /// </summary>
    /// <param name="featureId">The AI feature id to check.</param>
    /// <returns>True when the id is present in the canonical AI feature registry.</returns>
    public static bool IsRegisteredFeature(string featureId)
    {
        ArgumentNullException.ThrowIfNull(featureId);
        foreach (var meta in AiFeatureRegistry.Features)
        {
            if (string.Equals(meta.Id, featureId, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// The message thrown when wrapping an unknown feature id — the native analogue of the web HOC's
    /// module-load throw (<c>withAiFeature: unknown AI feature id ...</c>, web L37-L42). Surfaced at
    /// construction so a typo is caught the first time the surface is built rather than silently rendering
    /// nothing forever.
    /// </summary>
    /// <param name="featureId">The offending feature id.</param>
    /// <returns>The diagnostic message.</returns>
    public static string UnknownFeatureMessage(string featureId) =>
        $"withAiFeature: unknown AI feature id \"{featureId}\". " +
        "Add it to internal/ai/features/registry.go and run `make generate`.";
}

/// <summary>
/// PII-safe diagnostics for the withAiFeature gate surface (P1/S11 diagnostics contract). The surface gates
/// arbitrary inner content, so the collector records only the operational <c>view.opened</c> event with the
/// surface slug — never the wrapped feature id or any inner content. Thread-safe.
/// </summary>
public sealed class WithAiFeatureDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink; null in headless callers that only count opens.</param>
    public WithAiFeatureDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=withAiFeature</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WithAiFeatureRegistration.Slug}");
    }
}
