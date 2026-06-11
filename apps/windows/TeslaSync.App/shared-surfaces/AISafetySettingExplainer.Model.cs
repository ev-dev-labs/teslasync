using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The user-facing lifecycle of the safety-setting-explainer stream — the native port of the web
/// <c>AiStreamState</c> union (web/src/hooks/useAiStream.ts L88). <see cref="PausedConfirm"/> is reproduced for
/// parity with the shared hook even though the narrative explainer endpoint never issues a tool confirmation
/// (web AISafetySettingExplainer.tsx: the render contract is NARRATIVE — it explains existing settings and never
/// proposes or changes one). Idle before the first run (and after a cancel), <see cref="Streaming"/> while the
/// SSE is open, <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiSafetyExplainStreamState
{
    /// <summary>Before the first run / after a cancel (web <c>'idle'</c>).</summary>
    Idle = 0,

    /// <summary>A stream is open and frames are arriving (web <c>'streaming'</c>).</summary>
    Streaming = 1,

    /// <summary>A <c>confirm_request</c> frame paused the stream (web <c>'paused-confirm'</c>).</summary>
    PausedConfirm = 2,

    /// <summary>The stream finished with a <c>done</c> frame, or the connection closed cleanly (web <c>'done'</c>).</summary>
    Done = 3,

    /// <summary>The stream failed (HTTP fault, off-mode 404, connectivity loss, or an <c>error</c> frame) (web <c>'error'</c>).</summary>
    Error = 4,
}

/// <summary>The kind discriminator for a parsed <see cref="AiSafetyExplainStreamEvent"/> (web <c>AiStreamEvent.type</c>, useAiStream.ts L49).</summary>
public enum AiSafetyExplainEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); the narrative explainer ignores the payload.</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); the narrative explainer ignores the payload.</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>); reproduced for lifecycle parity.</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a safety-explainer stream ended in <see cref="AiSafetyExplainEventKind.Error"/>. The web hook records only
/// the message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks. An
/// on-demand SSE narration has no cached prior result, so a connectivity loss surfaces as the offline error
/// branch rather than a stale value.
/// </summary>
public enum AiSafetyExplainErrorReason
{
    /// <summary>A non-success HTTP status (web <c>stream_http_&lt;status&gt;</c>), incl. off-mode 404 / rate-limit.</summary>
    Http,

    /// <summary>A transport / connectivity failure (no network, DNS, socket) — drives the offline message.</summary>
    Network,

    /// <summary>A frame carried a typed <c>error</c> payload.</summary>
    Stream,

    /// <summary>An unclassified failure.</summary>
    Unknown,
}

/// <summary>
/// One parsed SSE event — the native analogue of the web discriminated union <c>AiStreamEvent</c>
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this narrative surface consumes. Tool and
/// confirm frames are parsed for parity (so the lifecycle and parser match the shared hook bit-for-bit) but
/// carry no payload here, because AISafetySettingExplainer's <c>onEvent</c> is a deliberate no-op and the output
/// renders <c>stream.text</c> directly. Pure data, so the parser and the view-model state machine are asserted
/// headlessly. Construct via the static factories, never directly.
/// </summary>
public sealed class AiSafetyExplainStreamEvent
{
    private AiSafetyExplainStreamEvent(AiSafetyExplainEventKind kind, string text, string message)
    {
        Kind = kind;
        Text = text;
        Message = message;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiSafetyExplainEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiSafetyExplainStreamEvent Delta(string text) =>
        new(AiSafetyExplainEventKind.Delta, text ?? string.Empty, string.Empty);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiSafetyExplainStreamEvent ToolCall() =>
        new(AiSafetyExplainEventKind.ToolCall, string.Empty, string.Empty);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    public static AiSafetyExplainStreamEvent ToolResult() =>
        new(AiSafetyExplainEventKind.ToolResult, string.Empty, string.Empty);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>); reproduced for lifecycle parity.</summary>
    public static AiSafetyExplainStreamEvent ConfirmRequest() =>
        new(AiSafetyExplainEventKind.ConfirmRequest, string.Empty, string.Empty);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiSafetyExplainStreamEvent Done() =>
        new(AiSafetyExplainEventKind.Done, string.Empty, string.Empty);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message.</summary>
    public static AiSafetyExplainStreamEvent Error(string message) =>
        new(AiSafetyExplainEventKind.Error, string.Empty, string.IsNullOrEmpty(message) ? "unknown" : message);
}

/// <summary>
/// The pure SSE-frame adapter for the safety-explainer stream — the native port of the web <c>toTypedEvent</c> /
/// <c>parseSSEFrame</c> narrowing (web/src/hooks/useAiStream.ts L364-L468). It maps a decoded
/// <see cref="SseFrame"/> (reassembled by the shared <see cref="SseFrameParser"/>) to a typed
/// <see cref="AiSafetyExplainStreamEvent"/>, returning <see langword="null"/> for an unknown event name, a
/// non-object or malformed JSON payload, or a frame missing a required discriminator field — so a future server
/// event can never crash an older client (the hook simply drops what it cannot understand). UI-free and
/// allocation-light; the whole surface's parse logic is asserted here without a host.
/// </summary>
public static class AiSafetyExplainStreamParser
{
    /// <summary>Maps a reassembled <see cref="SseFrame"/> to a typed event (web <c>parseSSEFrame</c> tail).</summary>
    /// <param name="frame">The frame produced by <see cref="SseFrameParser.Feed"/>.</param>
    /// <returns>The typed event, or <see langword="null"/> if the frame is not a recognized AI event.</returns>
    public static AiSafetyExplainStreamEvent? ParseFrame(SseFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        return ToTypedEvent(frame.Event, frame.Data);
    }

    /// <summary>
    /// Narrows an <c>(event, data)</c> pair into a typed event — the web <c>toTypedEvent</c> contract. A missing
    /// event name, an empty / non-object / malformed JSON payload, or a missing required field all yield
    /// <see langword="null"/>.
    /// </summary>
    /// <param name="eventName">The SSE <c>event:</c> field (web <c>event</c>).</param>
    /// <param name="data">The SSE <c>data:</c> payload as JSON text (web <c>dataStr</c>).</param>
    /// <returns>The typed event, or <see langword="null"/>.</returns>
    public static AiSafetyExplainStreamEvent? ToTypedEvent(string? eventName, string? data)
    {
        // web parseSSEFrame: `if (!event) return null;`
        if (string.IsNullOrEmpty(eventName))
        {
            return null;
        }

        // web parseSSEFrame: an empty data payload yields `data = null`, which toTypedEvent rejects below.
        if (string.IsNullOrEmpty(data))
        {
            return null;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(data);
        }
        catch (JsonException)
        {
            // web parseSSEFrame: a `JSON.parse` throw returns null so the loop skips the frame.
            return null;
        }

        using (document)
        {
            JsonElement root = document.RootElement;

            // web toTypedEvent: `if (data === null || typeof data !== 'object') return null;`
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            return eventName switch
            {
                "delta" => TryGetString(root, "text", out var text)
                    ? AiSafetyExplainStreamEvent.Delta(text)
                    : null,
                "tool_call" => HasString(root, "id") && HasString(root, "name")
                    ? AiSafetyExplainStreamEvent.ToolCall()
                    : null,
                "tool_result" => HasString(root, "id") && HasString(root, "name") && HasBool(root, "ok")
                    ? AiSafetyExplainStreamEvent.ToolResult()
                    : null,
                "confirm_request" => HasString(root, "continuation_id") && HasString(root, "tool") && HasString(root, "summary")
                    ? AiSafetyExplainStreamEvent.ConfirmRequest()
                    : null,
                "done" => AiSafetyExplainStreamEvent.Done(),
                "error" => AiSafetyExplainStreamEvent.Error(
                    TryGetString(root, "message", out var message) ? message : "unknown"),
                _ => null,
            };
        }
    }

    private static bool TryGetString(JsonElement obj, string name, out string value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            value = prop.GetString() ?? string.Empty;
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static bool HasString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String;

    private static bool HasBool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var prop) &&
        (prop.ValueKind == JsonValueKind.True || prop.ValueKind == JsonValueKind.False);
}

/// <summary>
/// Canonical identity, endpoint, i18n keys and label resolution for the AISafetySettingExplainer surface — the
/// native mirror of web/src/components/ai/AISafetySettingExplainer.tsx and the slice of the shared
/// <c>AIFeatureCard</c> it parameterizes (web/src/components/ai/AIFeatureCard.tsx). The web component composes its
/// copy from the <c>safetySettings.aiExplainer.*</c> keys plus the shared <c>helix.*</c> CTA keys; the native
/// keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects, so each resolves against
/// <c>Strings/{lang}/Resources.resw</c> in the app and against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class AISafetySettingExplainerRegistration
{
    /// <summary>The AI feature id this surface is gated by (web <c>withAiFeature('safety-setting-explainer', …)</c>).</summary>
    public const string FeatureId = "safety-setting-explainer";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AISafetySettingExplainer";

    /// <summary>The off-mode root automation id mirroring the web gate's <c>data-testid="ai-feature-safety-setting-explainer-root"</c>.</summary>
    public const string RootAutomationId = "ai-feature-safety-setting-explainer-root";

    /// <summary>The action-button automation id mirroring the web <c>buttonTestId="ai-feature-safety-setting-explainer-suggest"</c>.</summary>
    public const string ButtonAutomationId = "ai-feature-safety-setting-explainer-suggest";

    /// <summary>The SSE endpoint the narration streams from (the client adds the <c>/api/v1</c> prefix once; web <c>url: '/ai/settings/safety/explain'</c>).</summary>
    public const string ExplainPath = "/ai/settings/safety/explain";

    /// <summary>The card title i18n key (web <c>safetySettings.aiExplainer.title</c>).</summary>
    public const string TitleKey = "translation.safetySettings.aiExplainer.title";

    /// <summary>The English fallback for the title (the web default literal).</summary>
    public const string TitleFallback = "Explain my safety settings";

    /// <summary>The card description i18n key (web <c>safetySettings.aiExplainer.description</c>).</summary>
    public const string DescriptionKey = "translation.safetySettings.aiExplainer.description";

    /// <summary>The English fallback for the description (the web default literal, verbatim).</summary>
    public const string DescriptionFallback =
        "Ask Helix to explain the safety-related TeslaSync settings on this page in plain English. Helix only " +
        "reads the typed envelope of canonical setting values (booleans, enum strings, HH:MM times) \u2014 it " +
        "never reads notification titles, vehicle names, or any other PII, and it never proposes or changes a " +
        "setting. Use the controls below to update a value yourself; Helix only narrates.";

    /// <summary>The per-feature action verb i18n key (web <c>safetySettings.aiExplainer.button</c>).</summary>
    public const string ButtonLabelKey = "translation.safetySettings.aiExplainer.button";

    /// <summary>The English fallback for the action verb (the web default literal).</summary>
    public const string ButtonLabelFallback = "Explain my settings";

    /// <summary>The badge label i18n key (web <c>safetySettings.aiExplainer.badge</c>).</summary>
    public const string BadgeKey = "translation.safetySettings.aiExplainer.badge";

    /// <summary>The English fallback for the badge (the web default literal).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>The universal Helix CTA i18n key (web <c>helix.askHelix</c>, shared by AIFeatureCard).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>The English fallback for the CTA (the web default literal).</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>The streaming-state CTA i18n key (web <c>helix.thinking</c>, shared by AIFeatureCard).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>The English fallback for the streaming CTA (the web default literal).</summary>
    public const string ThinkingFallback = "Helix is thinking\u2026";

    /// <summary>The inline error label i18n key (web <c>helix.errorLabel</c>, shared by AiOutputPanel).</summary>
    public const string ErrorLabelKey = "translation.helix.errorLabel";

    /// <summary>The English fallback for the error label (the web default literal).</summary>
    public const string ErrorLabelFallback = "Helix error:";

    /// <summary>The unknown-error fallback token i18n key (web <c>ai.common.errorUnknown</c>).</summary>
    public const string ErrorUnknownKey = "translation.ai.common.errorUnknown";

    /// <summary>The English fallback for the unknown-error token (the web default literal).</summary>
    public const string ErrorUnknownFallback = "unknown";

    /// <summary>The offline-error message i18n key (shown when the stream fails for lack of connectivity).</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>The English fallback for the offline message.</summary>
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and try the explanation again";

    /// <summary>The retry affordance i18n key (mirrors the shared QueryError retry).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>The English fallback for the retry affordance.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>Segoe Fluent "Light" glyph — the native stand-in for the web Helix mark.</summary>
    public const string HelixGlyph = "\uEA80";

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of <c>withAiFeature</c> throwing on an unknown id at module load. Guards against a typo silently
    /// rendering nothing forever.
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

    /// <summary>Resolve <paramref name="key"/> with its fallback, guarding a null localizer.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="key">The catalog key.</param>
    /// <param name="fallback">The English fallback.</param>
    /// <returns>The localized string, or the fallback.</returns>
    public static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// The fully projected, render-ready labels of the AISafetySettingExplainer card — the native analogue of
/// everything the web InnerSection + AIFeatureCard compute before returning JSX. Pure data so the projection is
/// asserted headlessly; the view binds to it and resolves no strings itself.
/// </summary>
/// <param name="Title">The localized card title (web <c>title</c>).</param>
/// <param name="Description">The localized description (web <c>description</c>).</param>
/// <param name="BadgeLabel">The localized badge text (web <c>badgeLabel</c>).</param>
/// <param name="AskHelixLabel">The idle CTA text (web <c>helix.askHelix</c>).</param>
/// <param name="ThinkingLabel">The streaming CTA text (web <c>helix.thinking</c>).</param>
/// <param name="ButtonLabel">The per-feature action verb (web <c>buttonLabel</c>).</param>
/// <param name="ButtonAutomationName">The button's Narrator name (web <c>aria-label</c> <c>"Ask Helix · &lt;verb&gt;"</c>).</param>
/// <param name="ErrorLabel">The inline error label (web <c>helix.errorLabel</c>).</param>
/// <param name="ErrorUnknown">The unknown-error fallback token (web <c>ai.common.errorUnknown</c>).</param>
/// <param name="OfflineMessage">The connectivity-aware offline message.</param>
/// <param name="RetryLabel">The retry affordance label.</param>
public sealed record AISafetySettingExplainerDisplay(
    string Title,
    string Description,
    string BadgeLabel,
    string AskHelixLabel,
    string ThinkingLabel,
    string ButtonLabel,
    string ButtonAutomationName,
    string ErrorLabel,
    string ErrorUnknown,
    string OfflineMessage,
    string RetryLabel);

/// <summary>
/// Projects the AISafetySettingExplainer i18n catalog into a render-ready <see cref="AISafetySettingExplainerDisplay"/>
/// — the UI-thread-free core the view-model exposes and the view binds to. Mirrors the web InnerSection label
/// wiring, including the AIFeatureCard accessible-name composition (<c>"Ask Helix · &lt;buttonLabel&gt;"</c>).
/// </summary>
public static class AISafetySettingExplainerProjection
{
    /// <summary>Builds the display from the i18n facade.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready label model.</returns>
    public static AISafetySettingExplainerDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string Get(string key, string fallback) =>
            AISafetySettingExplainerRegistration.Resolve(localizer, key, fallback);

        string askHelix = Get(
            AISafetySettingExplainerRegistration.AskHelixKey,
            AISafetySettingExplainerRegistration.AskHelixFallback);
        string buttonLabel = Get(
            AISafetySettingExplainerRegistration.ButtonLabelKey,
            AISafetySettingExplainerRegistration.ButtonLabelFallback);

        return new AISafetySettingExplainerDisplay(
            Title: Get(
                AISafetySettingExplainerRegistration.TitleKey,
                AISafetySettingExplainerRegistration.TitleFallback),
            Description: Get(
                AISafetySettingExplainerRegistration.DescriptionKey,
                AISafetySettingExplainerRegistration.DescriptionFallback),
            BadgeLabel: Get(
                AISafetySettingExplainerRegistration.BadgeKey,
                AISafetySettingExplainerRegistration.BadgeFallback),
            AskHelixLabel: askHelix,
            ThinkingLabel: Get(
                AISafetySettingExplainerRegistration.ThinkingKey,
                AISafetySettingExplainerRegistration.ThinkingFallback),
            ButtonLabel: buttonLabel,
            ButtonAutomationName: ButtonAutomationName(askHelix, buttonLabel),
            ErrorLabel: Get(
                AISafetySettingExplainerRegistration.ErrorLabelKey,
                AISafetySettingExplainerRegistration.ErrorLabelFallback),
            ErrorUnknown: Get(
                AISafetySettingExplainerRegistration.ErrorUnknownKey,
                AISafetySettingExplainerRegistration.ErrorUnknownFallback),
            OfflineMessage: Get(
                AISafetySettingExplainerRegistration.OfflineKey,
                AISafetySettingExplainerRegistration.OfflineFallback),
            RetryLabel: Get(
                AISafetySettingExplainerRegistration.RetryKey,
                AISafetySettingExplainerRegistration.RetryFallback));
    }

    /// <summary>
    /// Composes the button's accessible name — the web <c>aria-label={`${askHelixLabel} · ${buttonLabel}`}</c>
    /// so a screen reader hears the universal CTA plus the per-feature verb.
    /// </summary>
    /// <param name="askHelixLabel">The universal CTA text.</param>
    /// <param name="buttonLabel">The per-feature verb.</param>
    /// <returns>The composed accessible name.</returns>
    private static string ButtonAutomationName(string askHelixLabel, string buttonLabel) =>
        string.Create(CultureInfo.InvariantCulture, $"{askHelixLabel} \u00b7 {buttonLabel}");
}

/// <summary>
/// PII-safe diagnostics for the AISafetySettingExplainer surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> signal with the surface slug — never the streamed narration (which paraphrases
/// the user's safety toggles), nor any setting value or prompt input — so a diagnostics line can never leak the
/// install's configuration. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AISafetySettingExplainerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AISafetySettingExplainerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AISafetySettingExplainer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AISafetySettingExplainerRegistration.Slug}"));
    }
}
