using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the cabin-temperature-impact narration surface — the native mirror of
/// the web <c>AICabinTemperatureImpactNarrative</c> (web/src/components/ai/AICabinTemperatureImpactNarrative.tsx)
/// composed with its shared <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the
/// <c>withAiFeature</c> gate (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/climate/temperature-impact/narrate</c> through <c>useAiStream</c> into the shared
/// <c>AiOutputPanel</c>; this metadata carries the same feature id, endpoint, render-contract i18n keys and the
/// off-mode test id so the native surface reproduces the web copy verbatim. Every key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses), and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AICabinTemperatureImpactNarrativeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AICabinTemperatureImpactNarrative";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('cabin-temperature-impact-narrative', ...)</c>).</summary>
    public const string FeatureId = "cabin-temperature-impact-narrative";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-cabin-temperature-impact-narrative-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-cabin-temperature-impact-narrative-root";

    /// <summary>The SSE endpoint the narration streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string NarratePath = "/ai/climate/temperature-impact/narrate";

    /// <summary>i18n key for the card title (web <c>tempImpact.aiNarrative.title</c>).</summary>
    public const string TitleKey = "translation.tempImpact.aiNarrative.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Narrate the cabin-temperature impact";

    /// <summary>i18n key for the card description (web <c>tempImpact.aiNarrative.description</c>).</summary>
    public const string DescriptionKey = "translation.tempImpact.aiNarrative.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Ask Helix to explain how outside ambient temperature affects this vehicle\u2019s efficiency \u2014 " +
        "which temperature bucket runs most efficiently, how cold-weather months compare with mild-weather " +
        "months, and what the seasonal pattern in the chart implies. The bucket and monthly numbers are the " +
        "same the chart below shows; the narrator only explains them and is honest that these are descriptive " +
        "aggregates of recent drives, not a forecast.";

    /// <summary>i18n key for the per-feature action verb (web <c>tempImpact.aiNarrative.generateButton</c>).</summary>
    public const string ButtonLabelKey = "translation.tempImpact.aiNarrative.generateButton";

    /// <summary>English fallback for <see cref="ButtonLabelKey"/> (web second arg).</summary>
    public const string ButtonLabelFallback = "Narrate impact";

    /// <summary>i18n key for the badge text (web <c>tempImpact.aiNarrative.badge</c>).</summary>
    public const string BadgeKey = "translation.tempImpact.aiNarrative.badge";

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
/// The user-facing stream lifecycle — the native port of the web <c>AiStreamState</c>
/// (web/src/hooks/useAiStream.ts L88). <see cref="Idle"/> before the first run (and after a cancel),
/// <see cref="Streaming"/> while the SSE is open, <see cref="PausedConfirm"/> when the server requests a
/// tool-confirmation (the narrate endpoint does not use it, but the union is reproduced for parity),
/// <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiNarrationStreamState
{
    /// <summary>Before the first run / after a cancel (web <c>'idle'</c>).</summary>
    Idle = 0,

    /// <summary>The SSE stream is open (web <c>'streaming'</c>).</summary>
    Streaming = 1,

    /// <summary>The server paused for a tool confirmation (web <c>'paused-confirm'</c>).</summary>
    PausedConfirm = 2,

    /// <summary>The stream closed cleanly (web <c>'done'</c>).</summary>
    Done = 3,

    /// <summary>The stream ended in failure (web <c>'error'</c>).</summary>
    Error = 4,
}

/// <summary>The kind discriminator for a parsed <see cref="AiNarrationStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiNarrationEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); this surface ignores the payload.</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); this surface ignores the payload.</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a narration stream ended in <see cref="AiNarrationEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiNarrationErrorReason
{
    /// <summary>A non-success HTTP status (web <c>stream_http_&lt;status&gt;</c>), incl. off-mode 404 / rate-limit.</summary>
    Http,

    /// <summary>A transport / connectivity failure (no network, DNS, socket) — drives the offline message.</summary>
    Network,

    /// <summary>The stream body was missing or a frame carried a typed error payload.</summary>
    Stream,

    /// <summary>An unclassified failure.</summary>
    Unknown,
}

/// <summary>
/// One parsed SSE event — the native analogue of the web discriminated union <c>AiStreamEvent</c>
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this narration surface consumes. Tool /
/// confirm frames are parsed for parity (so the lifecycle and parser match the web hook) but carry no payload
/// here. Pure data, so the parser and the view-model state machine are unit-tested headlessly.
/// </summary>
public sealed class AiNarrationStreamEvent
{
    private AiNarrationStreamEvent(
        AiNarrationEventKind kind,
        string text,
        string message,
        AiNarrationErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiNarrationEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="AiNarrationEventKind.Error"/>.</summary>
    public AiNarrationErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiNarrationStreamEvent Delta(string text) =>
        new(AiNarrationEventKind.Delta, text ?? string.Empty, string.Empty, AiNarrationErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiNarrationStreamEvent ToolCall() =>
        new(AiNarrationEventKind.ToolCall, string.Empty, string.Empty, AiNarrationErrorReason.Unknown);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    public static AiNarrationStreamEvent ToolResult() =>
        new(AiNarrationEventKind.ToolResult, string.Empty, string.Empty, AiNarrationErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiNarrationStreamEvent ConfirmRequest() =>
        new(AiNarrationEventKind.ConfirmRequest, string.Empty, string.Empty, AiNarrationErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiNarrationStreamEvent Done() =>
        new(AiNarrationEventKind.Done, string.Empty, string.Empty, AiNarrationErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiNarrationStreamEvent Error(string message, AiNarrationErrorReason reason) =>
        new(AiNarrationEventKind.Error, string.Empty, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the narrate endpoint — the native analogue of the web
/// <c>useMemo</c> body <c>{ vehicle_id }</c> (web AICabinTemperatureImpactNarrative L47-L52). The handler
/// validates <c>vehicle_id &gt; 0</c>; the explicit <see cref="JsonPropertyNameAttribute"/> pins the snake_case
/// wire name regardless of the serializer's naming policy.
/// </summary>
public sealed class AiNarrationRequest
{
    /// <summary>Creates the request body for the given in-scope vehicle.</summary>
    public AiNarrationRequest(long vehicleId) => VehicleId = vehicleId;

    /// <summary>The in-scope vehicle id (web <c>vehicle_id</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiNarrationStreamEvent"/>s — the native port of
/// the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web
/// hook bit-for-bit so a future server event cannot crash an older client). UI-free + allocation-light so it
/// is unit-tested without a host.
/// </summary>
public static class AiNarrationSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port
    /// of the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiNarrationStreamEvent? ParseFrame(string rawFrame)
    {
        ArgumentNullException.ThrowIfNull(rawFrame);

        string eventName = string.Empty;
        var dataParts = new List<string>();
        foreach (var line in rawFrame.Split(LineSeparators))
        {
            var trimmed = line.EndsWith('\r') ? line[..^1] : line;
            if (trimmed.StartsWith(':'))
            {
                continue; // SSE comment.
            }

            if (trimmed.StartsWith("event: ", StringComparison.Ordinal))
            {
                eventName = trimmed["event: ".Length..];
            }
            else if (trimmed.StartsWith("data: ", StringComparison.Ordinal))
            {
                dataParts.Add(trimmed["data: ".Length..]);
            }
            else if (trimmed.StartsWith("event:", StringComparison.Ordinal))
            {
                eventName = trimmed["event:".Length..].TrimStart();
            }
            else if (trimmed.StartsWith("data:", StringComparison.Ordinal))
            {
                dataParts.Add(trimmed["data:".Length..].TrimStart());
            }
        }

        if (eventName.Length == 0)
        {
            return null;
        }

        var dataStr = string.Join("\n", dataParts);
        JsonElement data;
        if (dataStr.Length == 0)
        {
            return ToTypedEvent(eventName, null);
        }

        try
        {
            using var doc = JsonDocument.Parse(dataStr);
            data = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }

        return ToTypedEvent(eventName, data);
    }

    private static AiNarrationStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
    {
        // web toTypedEvent: a missing/non-object payload narrows nothing.
        if (payload is not { ValueKind: JsonValueKind.Object } data)
        {
            return null;
        }

        switch (eventName)
        {
            case "delta":
                return TryGetString(data, "text", out var text)
                    ? AiNarrationStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiNarrationStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                return HasString(data, "id") && HasString(data, "name") &&
                       data.TryGetProperty("ok", out var ok) &&
                       (ok.ValueKind == JsonValueKind.True || ok.ValueKind == JsonValueKind.False)
                    ? AiNarrationStreamEvent.ToolResult()
                    : null;

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiNarrationStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiNarrationStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiNarrationStreamEvent.Error(message, AiNarrationErrorReason.Stream);

            default:
                return null;
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
}

/// <summary>
/// PII-safe diagnostics for the cabin-temperature-impact narration surface (P1/S11 diagnostics contract).
/// Narration text is arbitrary user-facing prose grounded in the vehicle's drive aggregates, so the collector
/// records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the
/// narration content, the vehicle id, or any prompt input. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class AICabinTemperatureImpactNarrativeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AICabinTemperatureImpactNarrativeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AICabinTemperatureImpactNarrative</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AICabinTemperatureImpactNarrativeRegistration.Slug}"));
    }
}
