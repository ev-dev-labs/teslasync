using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate / StaticAiFeatureGate / DelegateAiFeatureGate) and the shared
// narration stream primitives (IAiNarrationStreamTransport, AiNarrationStreamState, AiNarrationEventKind,
// AiNarrationErrorReason, AiNarrationStreamEvent, AiNarrationRequest, AiNarrationSseParser) are defined once for
// all AI narration shared surfaces in AICabinTemperatureImpactNarrative.{Model,Source}.cs (the canonical home);
// this surface reuses them rather than redeclaring them, mirroring how the sibling narration surfaces consume the
// shared gate + parser instead of duplicating the SSE state machine.

/// <summary>
/// Canonical metadata + i18n keys for the Total-Cost-of-Ownership narration surface — the native mirror of the
/// web <c>AITCONarration</c> (web/src/components/ai/AITCONarration.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams <c>POST /api/v1/ai/analytics/tco/narrate</c>
/// through <c>useAiStream</c> into the shared <c>AiOutputPanel</c>; this metadata carries the same feature id,
/// endpoint, render-contract i18n keys and the off-mode test id so the native surface reproduces the web copy
/// verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the
/// convention every shipped surface uses), and resolves against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class AITCONarrationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AITCONarration";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('tco-narration', ...)</c>).</summary>
    public const string FeatureId = "tco-narration";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-tco-narration-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-tco-narration-root";

    /// <summary>The SSE endpoint the narration streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string NarratePath = "/ai/analytics/tco/narrate";

    /// <summary>i18n key for the card title (web <c>tco.aiNarration.title</c>).</summary>
    public const string TitleKey = "translation.tco.aiNarration.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Explain my total cost of ownership";

    /// <summary>i18n key for the card description (web <c>tco.aiNarration.description</c>).</summary>
    public const string DescriptionKey = "translation.tco.aiNarration.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Ask Helix to walk through the deterministic operating-cost figures shown below \u2014 the EV charging " +
        "spend, the equivalent gas cost, the cumulative savings, and the cost-per-kilometre comparison. The " +
        "narrator quotes the same numbers the chart shows and is honest about the four limiting assumptions: " +
        "operating cost only (no depreciation, resale, insurance, registration, or financing); a flat $50/month " +
        "maintenance heuristic; equivalent gas cost estimated from charged energy not real-world distance; and " +
        "gas-price / efficiency / electricity-rate defaults from your editable Settings.";

    /// <summary>i18n key for the per-feature action verb (web <c>tco.aiNarration.button</c>).</summary>
    public const string ButtonLabelKey = "translation.tco.aiNarration.button";

    /// <summary>English fallback for <see cref="ButtonLabelKey"/> (web second arg).</summary>
    public const string ButtonLabelFallback = "Explain ownership cost";

    /// <summary>i18n key for the badge text (web <c>tco.aiNarration.badge</c>).</summary>
    public const string BadgeKey = "translation.tco.aiNarration.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>
    /// i18n key for the empty-state hint shown beneath the description while no vehicle is in scope (web
    /// <c>tco.aiNarration.noVehicleHint</c>, passed as <c>emptyHint</c> only when <c>!haveInputs</c>).
    /// </summary>
    public const string NoVehicleHintKey = "translation.tco.aiNarration.noVehicleHint";

    /// <summary>English fallback for <see cref="NoVehicleHintKey"/> (web second arg).</summary>
    public const string NoVehicleHintFallback = "Pick a vehicle above to enable Helix.";

    /// <summary>i18n key for the universal Helix CTA label (web <c>helix.askHelix</c>).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>English fallback for <see cref="AskHelixKey"/>.</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>i18n key for the streaming button label (web <c>helix.thinking</c>).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>English fallback for <see cref="ThinkingKey"/>.</summary>
    public const string ThinkingFallback = "Helix is thinking\u2026";

    /// <summary>i18n key for the inline error label (web <c>helix.errorLabel</c>).</summary>
    public const string ErrorLabelKey = "translation.helix.errorLabel";

    /// <summary>English fallback for <see cref="ErrorLabelKey"/>.</summary>
    public const string ErrorLabelFallback = "Helix error:";

    /// <summary>i18n key for the unknown-error fallback token (web <c>ai.common.errorUnknown</c>).</summary>
    public const string ErrorUnknownKey = "translation.ai.common.errorUnknown";

    /// <summary>English fallback for <see cref="ErrorUnknownKey"/>.</summary>
    public const string ErrorUnknownFallback = "unknown";

    /// <summary>i18n key for the offline error message shown when the stream fails for lack of connectivity.</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and try the narration again";

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of <c>withAiFeature</c> throwing on an unknown id at module load. Guards against a typo
    /// silently rendering nothing forever.
    /// </summary>
    public static bool IsRegisteredFeature(string featureId)
    {
        ArgumentNullException.ThrowIfNull(featureId);
        foreach (var meta in TeslaSync.App.FeatureViews.Settings.AiFeatureRegistry.Features)
        {
            if (string.Equals(meta.Id, featureId, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// PII-safe diagnostics for the Total-Cost-of-Ownership narration surface (P1/S11 diagnostics contract).
/// Narration text is arbitrary user-facing prose grounded in the vehicle's deterministic TCO envelope, so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the
/// narration content, the vehicle id, or any prompt input. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AITCONarrationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AITCONarrationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AITCONarration</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AITCONarrationRegistration.Slug}"));
    }
}
