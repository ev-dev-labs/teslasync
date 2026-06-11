using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the RAG-backed application-help surface — the native mirror of the web
/// <c>AIRAGHelp</c> (web/src/components/ai/AIRAGHelp.tsx) composed with its shared <c>AIFeatureCard</c> scaffold
/// (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams <c>POST /api/v1/ai/help/query</c> through
/// <c>useAiStream</c> with the body <c>{ prompt }</c>, ignores every individual event
/// (<c>onEvent: () =&gt; {}</c>), and renders only the accumulating answer text + lifecycle the
/// <c>AiOutputPanel</c> surfaces; this metadata carries the same feature id, endpoint, render-contract i18n keys
/// and the off-mode test id so the native surface reproduces the web copy verbatim. Every key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects, and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AIRAGHelpRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIRAGHelp";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('rag-help', ...)</c>).</summary>
    public const string FeatureId = "rag-help";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-rag-help-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-rag-help-root";

    /// <summary>
    /// The SSE endpoint the help answer streams from (web <c>useAiStream({ url: '/ai/help/query' })</c>; the
    /// client adds the <c>/api/v1</c> prefix once). The natural-language question flows through the JSON body,
    /// not the URL.
    /// </summary>
    public const string QueryPath = "/ai/help/query";

    /// <summary>i18n key for the card title (web <c>help.aiHelp.title</c>).</summary>
    public const string TitleKey = "translation.help.aiHelp.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Ask the help assistant";

    /// <summary>i18n key for the card description (web <c>help.aiHelp.description</c>).</summary>
    public const string DescriptionKey = "translation.help.aiHelp.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Ask a natural-language question about the application and the assistant will answer using the " +
        "project\u2019s own documentation, runbooks, and i18n strings \u2014 with explicit citations to each " +
        "source.";

    /// <summary>i18n key for the per-feature action verb (web <c>help.aiHelp.askButton</c>).</summary>
    public const string AskButtonKey = "translation.help.aiHelp.askButton";

    /// <summary>English fallback for <see cref="AskButtonKey"/> (web second arg).</summary>
    public const string AskButtonFallback = "Ask the assistant";

    /// <summary>i18n key for the badge text (web <c>help.aiHelp.badge</c>).</summary>
    public const string BadgeKey = "translation.help.aiHelp.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the prompt placeholder (web <c>help.aiHelp.placeholder</c>).</summary>
    public const string PromptPlaceholderKey = "translation.help.aiHelp.placeholder";

    /// <summary>English fallback for <see cref="PromptPlaceholderKey"/> (web second arg).</summary>
    public const string PromptPlaceholderFallback = "e.g. How do I enable energy cost forecasting?";

    /// <summary>
    /// i18n key for the prompt's Narrator name. The web textarea has no explicit label (its placeholder is the
    /// only hint); the native surface adds a dedicated accessible name so Narrator announces the field.
    /// </summary>
    public const string PromptLabelKey = "translation.help.aiHelp.promptLabel";

    /// <summary>English fallback for <see cref="PromptLabelKey"/>.</summary>
    public const string PromptLabelFallback = "Help question";

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

    /// <summary>i18n key for the offline message shown when the stream fails for lack of connectivity.</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and try again";

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of <c>withAiFeature</c> throwing on an unknown id at module load. Guards against a typo
    /// silently rendering nothing forever.
    /// </summary>
    /// <param name="featureId">The AI feature id to check.</param>
    /// <returns>True when the id is present in the canonical AI feature registry.</returns>
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
/// tool-confirmation (the help endpoint does not use it, but the union is reproduced for parity),
/// <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiHelpStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiHelpStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiHelpEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); this surface ignores it (web onEvent no-op).</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); this surface ignores it (web onEvent no-op).</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a help stream ended in <see cref="AiHelpEventKind.Error"/>. The web hook records only the message; the
/// native transport additionally classifies the failure so the view can show the connectivity-aware offline
/// affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiHelpErrorReason
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
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this help surface consumes. Like the web
/// component (whose <c>onEvent</c> is a no-op) the surface reads only the accumulating <see cref="Text"/> and the
/// terminal frames; <c>tool_call</c> / <c>tool_result</c> frames are parsed (so a tool frame never corrupts the
/// stream) but carry no payload here. Pure data, so the parser and the view-model state machine are unit-tested
/// headlessly. Construct via the static factories, never directly.
/// </summary>
public sealed class AiHelpStreamEvent
{
    private AiHelpStreamEvent(AiHelpEventKind kind, string text, string message, AiHelpErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiHelpEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="AiHelpEventKind.Error"/>.</summary>
    public AiHelpErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    /// <param name="text">The chunk of answer text.</param>
    /// <returns>A delta event.</returns>
    public static AiHelpStreamEvent Delta(string text) =>
        new(AiHelpEventKind.Delta, text ?? string.Empty, string.Empty, AiHelpErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    /// <returns>A tool-call event.</returns>
    public static AiHelpStreamEvent ToolCall() =>
        new(AiHelpEventKind.ToolCall, string.Empty, string.Empty, AiHelpErrorReason.Unknown);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    /// <returns>A tool-result event.</returns>
    public static AiHelpStreamEvent ToolResult() =>
        new(AiHelpEventKind.ToolResult, string.Empty, string.Empty, AiHelpErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    /// <returns>A confirm-request event.</returns>
    public static AiHelpStreamEvent ConfirmRequest() =>
        new(AiHelpEventKind.ConfirmRequest, string.Empty, string.Empty, AiHelpErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    /// <returns>A done event.</returns>
    public static AiHelpStreamEvent Done() =>
        new(AiHelpEventKind.Done, string.Empty, string.Empty, AiHelpErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    /// <param name="message">The human-readable error message.</param>
    /// <param name="reason">The classified failure reason.</param>
    /// <returns>An error event.</returns>
    public static AiHelpStreamEvent Error(string message, AiHelpErrorReason reason) =>
        new(AiHelpEventKind.Error, string.Empty, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the help endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ prompt }</c> (web AIRAGHelp L16). The route carries no path parameter and no vehicle scope; the explicit
/// <see cref="JsonPropertyNameAttribute"/> pins the snake_case wire name regardless of the serializer policy.
/// </summary>
public sealed class AiHelpRequest
{
    /// <summary>Creates the request body for the given free-form question.</summary>
    /// <param name="prompt">The natural-language help question.</param>
    public AiHelpRequest(string prompt) => Prompt = prompt ?? string.Empty;

    /// <summary>The free-form natural-language help question (web <c>prompt</c>).</summary>
    [JsonPropertyName("prompt")]
    public string Prompt { get; }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiHelpStreamEvent"/>s — the native port of the web
/// <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are blank-line
/// delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c> lines. A
/// malformed frame, an unknown event type, or a payload missing its required discriminator fields yields
/// <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). UI-free + allocation-light so it is
/// unit-tested without a host.
/// </summary>
public static class AiHelpSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    /// <param name="rawFrame">The raw frame text (event/data lines joined by newlines).</param>
    /// <returns>The typed event, or <see langword="null"/>.</returns>
    public static AiHelpStreamEvent? ParseFrame(string rawFrame)
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

        // web parseSSEFrame: `if (!event) return null;`
        if (eventName.Length == 0)
        {
            return null;
        }

        var dataStr = string.Join("\n", dataParts);

        // web parseSSEFrame: an empty data payload yields `data = null`, which toTypedEvent rejects below.
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
            // web parseSSEFrame: `JSON.parse` throwing returns null so the loop skips the frame.
            return null;
        }

        return ToTypedEvent(eventName, data);
    }

    /// <summary>
    /// Narrows an <c>(event, data)</c> pair into a typed event — the web <c>toTypedEvent</c> contract. A missing
    /// event name, an empty / non-object / malformed JSON payload, or a missing required field all yield
    /// <see langword="null"/>.
    /// </summary>
    /// <param name="eventName">The SSE <c>event:</c> field (web <c>event</c>).</param>
    /// <param name="payload">The parsed SSE <c>data:</c> payload (web <c>data</c>), or null.</param>
    /// <returns>The typed event, or <see langword="null"/>.</returns>
    public static AiHelpStreamEvent? ToTypedEvent(string? eventName, JsonElement? payload)
    {
        if (string.IsNullOrEmpty(eventName))
        {
            return null;
        }

        // web toTypedEvent: `if (data === null || typeof data !== 'object') return null;`
        if (payload is not { ValueKind: JsonValueKind.Object } data)
        {
            return null;
        }

        switch (eventName)
        {
            case "delta":
                return TryGetString(data, "text", out var text)
                    ? AiHelpStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiHelpStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !HasString(data, "name") ||
                    !data.TryGetProperty("ok", out var okEl) ||
                    (okEl.ValueKind != JsonValueKind.True && okEl.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                return AiHelpStreamEvent.ToolResult();

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiHelpStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiHelpStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiHelpStreamEvent.Error(message, AiHelpErrorReason.Stream);

            default:
                return null;
        }
    }

    private static bool HasString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String;

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
}

/// <summary>
/// PII-safe diagnostics for the AIRAGHelp surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> signal with the surface slug — never the user's question, the streamed answer, or any
/// token usage — so a diagnostics line can never leak help content. Thread-safe.
/// </summary>
public sealed class AIRAGHelpDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIRAGHelpDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIRAGHelp</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIRAGHelpRegistration.Slug}");
    }
}
