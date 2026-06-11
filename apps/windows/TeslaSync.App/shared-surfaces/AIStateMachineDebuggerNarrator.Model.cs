using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the state-machine-debugger narration surface — the native mirror of the
/// web <c>AIStateMachineDebuggerNarrator</c> (web/src/components/ai/AIStateMachineDebuggerNarrator.tsx) composed
/// with its shared <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the
/// <c>withAiFeature</c> gate (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/system/fsm/narrate</c> through <c>useAiStream</c> with the in-scope
/// <c>{ vehicle_id, from_unix, to_unix }</c> body into the shared <c>AiOutputPanel</c>; this metadata carries
/// the same feature id, endpoint, render-contract i18n keys and the off-mode test id so the native surface
/// reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI
/// resource bridge expects (the convention every shipped surface uses) and resolves against the English
/// fallback headlessly (the fallbacks are the catalog values in apps/shared/i18n/catalog/en.json). UI-free so
/// it is asserted without a XAML host.
/// </summary>
public static class AIStateMachineDebuggerNarratorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIStateMachineDebuggerNarrator";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('state-machine-debugger-narrator', …)</c>).</summary>
    public const string FeatureId = "state-machine-debugger-narrator";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-state-machine-debugger-narrator-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-state-machine-debugger-narrator-root";

    /// <summary>The SSE endpoint the narration streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string NarratePath = "/ai/system/fsm/narrate";

    /// <summary>i18n key for the card title (web <c>stateMachineDebugger.aiNarrator.title</c>).</summary>
    public const string TitleKey = "translation.stateMachineDebugger.aiNarrator.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Helix FSM narrator";

    /// <summary>i18n key for the card description (web <c>stateMachineDebugger.aiNarrator.description</c>).</summary>
    public const string DescriptionKey = "translation.stateMachineDebugger.aiNarrator.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Get a 3-6 sentence factual narration of the current vehicle FSM transition trace. The narrator reads " +
        "only the deterministic FSM envelope (vehicle id, window bounds, per-FSM-name counts, per-edge counts, " +
        "flap count, transition stream) \u2014 VINs, coordinates, place names, IPs, and personal identifiers " +
        "are redacted before the message reaches the provider. The narration is informational; the transition " +
        "table, state diagram, and FSM health panel above remain the canonical raw view.";

    /// <summary>i18n key for the per-feature action verb (web <c>stateMachineDebugger.aiNarrator.button</c>).</summary>
    public const string ButtonLabelKey = "translation.stateMachineDebugger.aiNarrator.button";

    /// <summary>English fallback for <see cref="ButtonLabelKey"/> (web second arg).</summary>
    public const string ButtonLabelFallback = "Narrate transitions";

    /// <summary>i18n key for the badge text (web <c>stateMachineDebugger.aiNarrator.badge</c>).</summary>
    public const string BadgeKey = "translation.stateMachineDebugger.aiNarrator.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>
    /// i18n key for the empty-state hint shown when the parent has not supplied a valid (vehicle, window)
    /// triple (web <c>stateMachineDebugger.aiNarrator.emptyHint</c>, surfaced as the AIFeatureCard
    /// <c>emptyHint</c> prop while <c>!canStart</c>).
    /// </summary>
    public const string EmptyHintKey = "translation.stateMachineDebugger.aiNarrator.emptyHint";

    /// <summary>English fallback for <see cref="EmptyHintKey"/> (web second arg).</summary>
    public const string EmptyHintFallback = "Select a vehicle and a valid time window first.";

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

    /// <summary>i18n key for the retry affordance on the error surface (mirrors the shared QueryError retry).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Try again";

    /// <summary>Segoe Fluent glyph — the native stand-in for the web Helix mark on the badge and action button.</summary>
    public const string HelixGlyph = "\uEA80";

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of <c>withAiFeature</c> throwing on an unknown id at module load. Guards against a typo
    /// silently rendering nothing forever.
    /// </summary>
    /// <param name="featureId">The candidate AI feature id.</param>
    /// <returns>True when the id is registered.</returns>
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
public enum FsmNarrateStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="FsmNarrateStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum FsmNarrateEventKind
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
/// Why a narration stream ended in <see cref="FsmNarrateEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum FsmNarrateErrorReason
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
public sealed class FsmNarrateStreamEvent
{
    private FsmNarrateStreamEvent(
        FsmNarrateEventKind kind,
        string text,
        string message,
        FsmNarrateErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public FsmNarrateEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="FsmNarrateEventKind.Error"/>.</summary>
    public FsmNarrateErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    /// <param name="text">The delta text.</param>
    public static FsmNarrateStreamEvent Delta(string text) =>
        new(FsmNarrateEventKind.Delta, text ?? string.Empty, string.Empty, FsmNarrateErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static FsmNarrateStreamEvent ToolCall() =>
        new(FsmNarrateEventKind.ToolCall, string.Empty, string.Empty, FsmNarrateErrorReason.Unknown);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    public static FsmNarrateStreamEvent ToolResult() =>
        new(FsmNarrateEventKind.ToolResult, string.Empty, string.Empty, FsmNarrateErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static FsmNarrateStreamEvent ConfirmRequest() =>
        new(FsmNarrateEventKind.ConfirmRequest, string.Empty, string.Empty, FsmNarrateErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static FsmNarrateStreamEvent Done() =>
        new(FsmNarrateEventKind.Done, string.Empty, string.Empty, FsmNarrateErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    /// <param name="message">The human-readable error message.</param>
    /// <param name="reason">The classified failure reason.</param>
    public static FsmNarrateStreamEvent Error(string message, FsmNarrateErrorReason reason) =>
        new(FsmNarrateEventKind.Error, string.Empty, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the narrate endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ vehicle_id, from_unix, to_unix }</c> (web AIStateMachineDebuggerNarrator L135-L144). The handler binds
/// the in-scope tuple per request and refuses any LLM-supplied tuple outside it; the explicit
/// <see cref="JsonPropertyNameAttribute"/> pins the snake_case wire names regardless of the serializer's naming
/// policy.
/// </summary>
public sealed class FsmNarrateRequest
{
    /// <summary>Creates the request body for the given in-scope vehicle and inclusive Unix-second window.</summary>
    /// <param name="vehicleId">The in-scope vehicle id (web <c>vehicle_id</c>).</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds (web <c>from_unix</c>).</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds (web <c>to_unix</c>).</param>
    public FsmNarrateRequest(long vehicleId, long fromUnix, long toUnix)
    {
        VehicleId = vehicleId;
        FromUnix = fromUnix;
        ToUnix = toUnix;
    }

    /// <summary>The in-scope vehicle id (web <c>vehicle_id</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }

    /// <summary>The inclusive start of the narration window in Unix seconds (web <c>from_unix</c>).</summary>
    [JsonPropertyName("from_unix")]
    public long FromUnix { get; }

    /// <summary>The inclusive end of the narration window in Unix seconds (web <c>to_unix</c>).</summary>
    [JsonPropertyName("to_unix")]
    public long ToUnix { get; }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="FsmNarrateStreamEvent"/>s — the native port of the
/// web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). UI-free + allocation-light so it is
/// unit-tested without a host.
/// </summary>
public static class FsmNarrateSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    /// <param name="rawFrame">The raw SSE block (one or more <c>event:</c> / <c>data:</c> lines).</param>
    /// <returns>The typed event, or <see langword="null"/> when the frame is not a recognized AI event.</returns>
    public static FsmNarrateStreamEvent? ParseFrame(string rawFrame)
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
        if (dataStr.Length == 0)
        {
            return ToTypedEvent(eventName, null);
        }

        JsonElement data;
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

    private static FsmNarrateStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? FsmNarrateStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? FsmNarrateStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                return HasString(data, "id") && HasString(data, "name") &&
                       data.TryGetProperty("ok", out var ok) &&
                       (ok.ValueKind == JsonValueKind.True || ok.ValueKind == JsonValueKind.False)
                    ? FsmNarrateStreamEvent.ToolResult()
                    : null;

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? FsmNarrateStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return FsmNarrateStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return FsmNarrateStreamEvent.Error(message, FsmNarrateErrorReason.Stream);

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
/// PII-safe diagnostics for the state-machine-debugger narration surface (P1/S11 diagnostics contract). The
/// narration is arbitrary operator-facing prose grounded in the vehicle's FSM transition trace, so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never
/// the narration content, the vehicle id, the window bounds, or any prompt input. Thread-safe; mirrors the
/// shipped surfaces' collectors.
/// </summary>
public sealed class AIStateMachineDebuggerNarratorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIStateMachineDebuggerNarratorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIStateMachineDebuggerNarrator</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AIStateMachineDebuggerNarratorRegistration.Slug}"));
    }
}
