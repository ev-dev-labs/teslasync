using System.Globalization;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate / StaticAiFeatureGate / DelegateAiFeatureGate) and the shared
// narration stream primitives (AiNarrationStreamState, AiNarrationEventKind, AiNarrationErrorReason,
// AiNarrationStreamEvent, AiNarrationSseParser) are defined once for all AI narration shared surfaces in
// AICabinTemperatureImpactNarrative.{Model,Source}.cs (the canonical home); this surface reuses them rather than
// redeclaring them, mirroring how the sibling narration surfaces (AITCONarration, AIDriveCoaching) consume the
// shared gate + parser instead of duplicating the SSE state machine. Only the request body differs — the
// year-in-review endpoint also carries a calendar year — so this file adds the surface-specific
// <see cref="AiYearReviewNarrationRequest"/> shape (consumed by the dedicated transport seam in the matching
// .Source.cs).

/// <summary>
/// Canonical metadata + i18n keys for the year-in-review narration surface — the native mirror of the web
/// <c>AIYearReviewNarration</c> (web/src/components/ai/AIYearReviewNarration.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/analytics/year-in-review/narrate</c> through <c>useAiStream</c> with a
/// <c>{ vehicle_id, year }</c> body into the shared <c>AiOutputPanel</c>; this metadata carries the same feature
/// id, endpoint, render-contract i18n keys and the off-mode test id so the native surface reproduces the web copy
/// verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the
/// convention every shipped surface uses), and resolves against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class AIYearReviewNarrationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIYearReviewNarration";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('yir-narration', ...)</c>).</summary>
    public const string FeatureId = "yir-narration";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-yir-narration-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-yir-narration-root";

    /// <summary>The SSE endpoint the narration streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string NarratePath = "/ai/analytics/year-in-review/narrate";

    /// <summary>i18n key for the card title (web <c>yearReview.aiNarration.title</c>).</summary>
    public const string TitleKey = "translation.yearReview.aiNarration.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Helix narration";

    /// <summary>i18n key for the card description (web <c>yearReview.aiNarration.description</c>).</summary>
    public const string DescriptionKey = "translation.yearReview.aiNarration.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Get a short, Helix-written recap of your year from the slide data above.";

    /// <summary>i18n key for the per-feature action verb (web <c>yearReview.aiNarration.generateButton</c>).</summary>
    public const string ButtonLabelKey = "translation.yearReview.aiNarration.generateButton";

    /// <summary>English fallback for <see cref="ButtonLabelKey"/> (web second arg).</summary>
    public const string ButtonLabelFallback = "Generate narration";

    /// <summary>i18n key for the badge text (web <c>yearReview.aiNarration.badge</c>).</summary>
    public const string BadgeKey = "translation.yearReview.aiNarration.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

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
    /// <param name="featureId">The AI feature id to look up.</param>
    /// <returns><see langword="true"/> when the id is registered.</returns>
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
/// The JSON request body POSTed to the narrate endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ vehicle_id: vehicleId ?? 0, year }</c> (web AIYearReviewNarration L18-L21). The handler narrates the
/// deterministic year-in-review slides for the in-scope vehicle and calendar year; the explicit
/// <see cref="JsonPropertyNameAttribute"/>s pin the snake_case wire names regardless of the serializer's naming
/// policy.
/// </summary>
public sealed class AiYearReviewNarrationRequest
{
    /// <summary>Creates the request body for the given in-scope vehicle and review year.</summary>
    /// <param name="vehicleId">The in-scope vehicle id (web <c>vehicle_id</c>); <c>0</c> when unresolved.</param>
    /// <param name="year">The calendar year to narrate (web <c>year</c>).</param>
    public AiYearReviewNarrationRequest(long vehicleId, int year)
    {
        VehicleId = vehicleId;
        Year = year;
    }

    /// <summary>The in-scope vehicle id (web <c>vehicle_id</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }

    /// <summary>The calendar year to narrate (web <c>year</c>).</summary>
    [JsonPropertyName("year")]
    public int Year { get; }
}

/// <summary>
/// PII-safe diagnostics for the year-in-review narration surface (P1/S11 diagnostics contract). Narration text is
/// arbitrary user-facing prose grounded in the vehicle's annual slide aggregates, so the collector records ONLY
/// the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the narration content, the
/// vehicle id, the review year, or any prompt input. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AIYearReviewNarrationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink that receives the formatted diagnostic line.</param>
    public AIYearReviewNarrationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIYearReviewNarration</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AIYearReviewNarrationRegistration.Slug}"));
    }
}
