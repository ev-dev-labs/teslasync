using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the browser-native voice surface — the native mirror of the web
/// <c>AIVoiceMode</c> (web/src/components/ai/AIVoiceMode.tsx) composed with its shared <c>AIFeatureCard</c>
/// scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface dictates a spoken question with on-device speech
/// recognition, streams <c>POST /api/v1/ai/voice/chat</c> through <c>useAiStream</c> with the body
/// <c>{ message, session_id }</c>, reads the streamed reply aloud with on-device speech synthesis, and renders
/// the accumulating answer + lifecycle the <c>AiOutputPanel</c> surfaces; this metadata carries the same feature
/// id, endpoint, render-contract i18n keys and the off-mode test id so the native surface reproduces the web copy
/// verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects, and
/// resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AIVoiceModeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIVoiceMode";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('voice-mode', ...)</c>).</summary>
    public const string FeatureId = "voice-mode";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-voice-mode-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-voice-mode-root";

    /// <summary>
    /// The SSE endpoint the voice reply streams from (web <c>useAiStream({ url: '/ai/voice/chat' })</c>; the
    /// client adds the <c>/api/v1</c> prefix once). The transcribed question + session id flow through the JSON
    /// body, never the raw audio.
    /// </summary>
    public const string ChatPath = "/ai/voice/chat";

    /// <summary>i18n key for the card title (web <c>voiceMode.title</c>).</summary>
    public const string TitleKey = "translation.voiceMode.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Voice mode";

    /// <summary>i18n key for the card description (web <c>voiceMode.description</c>).</summary>
    public const string DescriptionKey = "translation.voiceMode.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Speak to Helix and hear the reply out loud. Voice input and playback both stay on this device \u2014 " +
        "only the transcribed text is sent to the assistant, never the raw audio.";

    /// <summary>i18n key for the per-feature action verb (web <c>voiceMode.button</c>).</summary>
    public const string ButtonKey = "translation.voiceMode.button";

    /// <summary>English fallback for <see cref="ButtonKey"/> (web second arg).</summary>
    public const string ButtonFallback = "Speak to Helix";

    /// <summary>i18n key for the transcript region's accessible name (web <c>voiceMode.transcriptLabel</c>).</summary>
    public const string TranscriptLabelKey = "translation.voiceMode.transcriptLabel";

    /// <summary>English fallback for <see cref="TranscriptLabelKey"/> (web second arg).</summary>
    public const string TranscriptLabelFallback = "Voice transcript";

    /// <summary>i18n key for the transcript hint while listening (web <c>voiceMode.listeningHint</c>).</summary>
    public const string ListeningHintKey = "translation.voiceMode.listeningHint";

    /// <summary>English fallback for <see cref="ListeningHintKey"/> (web second arg).</summary>
    public const string ListeningHintFallback = "Listening \u2014 speak now\u2026";

    /// <summary>i18n key for the transcript hint while idle (web <c>voiceMode.idleHint</c>).</summary>
    public const string IdleHintKey = "translation.voiceMode.idleHint";

    /// <summary>English fallback for <see cref="IdleHintKey"/> (web second arg).</summary>
    public const string IdleHintFallback = "Tap the mic and ask Helix anything about your Tesla.";

    /// <summary>i18n key for the dictation-unavailable hint (web <c>voiceMode.unsupportedHint</c>).</summary>
    public const string UnsupportedHintKey = "translation.voiceMode.unsupportedHint";

    /// <summary>English fallback for <see cref="UnsupportedHintKey"/> (web second arg).</summary>
    public const string UnsupportedHintFallback =
        "Voice input is not available in this browser. You can still type your question into the chatbot below.";

    /// <summary>i18n key for the AIFeatureCard empty hint (web <c>voiceMode.emptyHint</c>).</summary>
    public const string EmptyHintKey = "translation.voiceMode.emptyHint";

    /// <summary>English fallback for <see cref="EmptyHintKey"/> (web second arg).</summary>
    public const string EmptyHintFallback = "Tap the mic and dictate a question first.";

    /// <summary>i18n key for the mic start accessible name (web <c>voiceMode.actions.startListening</c>).</summary>
    public const string StartListeningKey = "translation.voiceMode.actions.startListening";

    /// <summary>English fallback for <see cref="StartListeningKey"/> (web second arg).</summary>
    public const string StartListeningFallback = "Start listening";

    /// <summary>i18n key for the mic start visible label (web <c>voiceMode.actions.startListeningShort</c>).</summary>
    public const string StartListeningShortKey = "translation.voiceMode.actions.startListeningShort";

    /// <summary>English fallback for <see cref="StartListeningShortKey"/> (web second arg).</summary>
    public const string StartListeningShortFallback = "Speak";

    /// <summary>i18n key for the mic stop accessible name (web <c>voiceMode.actions.stopListening</c>).</summary>
    public const string StopListeningKey = "translation.voiceMode.actions.stopListening";

    /// <summary>English fallback for <see cref="StopListeningKey"/> (web second arg).</summary>
    public const string StopListeningFallback = "Stop listening";

    /// <summary>i18n key for the mic stop visible label (web <c>voiceMode.actions.stopListeningShort</c>).</summary>
    public const string StopListeningShortKey = "translation.voiceMode.actions.stopListeningShort";

    /// <summary>English fallback for <see cref="StopListeningShortKey"/> (web second arg).</summary>
    public const string StopListeningShortFallback = "Stop mic";

    /// <summary>i18n key for the mute-replies accessible name (web <c>voiceMode.actions.muteTts</c>).</summary>
    public const string MuteTtsKey = "translation.voiceMode.actions.muteTts";

    /// <summary>English fallback for <see cref="MuteTtsKey"/> (web second arg).</summary>
    public const string MuteTtsFallback = "Mute spoken replies";

    /// <summary>i18n key for the mute-replies visible label (web <c>voiceMode.actions.muteTtsShort</c>).</summary>
    public const string MuteTtsShortKey = "translation.voiceMode.actions.muteTtsShort";

    /// <summary>English fallback for <see cref="MuteTtsShortKey"/> (web second arg).</summary>
    public const string MuteTtsShortFallback = "Mute Helix";

    /// <summary>i18n key for the unmute-replies accessible name (web <c>voiceMode.actions.unmuteTts</c>).</summary>
    public const string UnmuteTtsKey = "translation.voiceMode.actions.unmuteTts";

    /// <summary>English fallback for <see cref="UnmuteTtsKey"/> (web second arg).</summary>
    public const string UnmuteTtsFallback = "Unmute spoken replies";

    /// <summary>i18n key for the unmute-replies visible label (web <c>voiceMode.actions.unmuteTtsShort</c>).</summary>
    public const string UnmuteTtsShortKey = "translation.voiceMode.actions.unmuteTtsShort";

    /// <summary>English fallback for <see cref="UnmuteTtsShortKey"/> (web second arg).</summary>
    public const string UnmuteTtsShortFallback = "Unmute Helix";

    /// <summary>i18n key for the stop-all accessible name (web <c>voiceMode.actions.stopAll</c>).</summary>
    public const string StopAllKey = "translation.voiceMode.actions.stopAll";

    /// <summary>English fallback for <see cref="StopAllKey"/> (web second arg).</summary>
    public const string StopAllFallback = "Stop Helix";

    /// <summary>i18n key for the stop-all visible label (web <c>voiceMode.actions.stopAllShort</c>).</summary>
    public const string StopAllShortKey = "translation.voiceMode.actions.stopAllShort";

    /// <summary>English fallback for <see cref="StopAllShortKey"/> (web second arg).</summary>
    public const string StopAllShortFallback = "Stop";

    /// <summary>i18n key for the dictation-unsupported error (web <c>voiceMode.errors.unsupported</c>).</summary>
    public const string ErrorUnsupportedKey = "translation.voiceMode.errors.unsupported";

    /// <summary>English fallback for <see cref="ErrorUnsupportedKey"/> (web second arg).</summary>
    public const string ErrorUnsupportedFallback =
        "Your browser does not support voice input. Try Chrome, Edge, or Safari.";

    /// <summary>
    /// i18n key for the dictation-failure error (web <c>voiceMode.errors.sttFailed</c>). The web string
    /// interpolates <c>{{reason}}</c>; the catalog form uses the positional <c>{0}</c> the WinUI resource bridge
    /// fills — see <see cref="FormatSttError(string, string)"/>.
    /// </summary>
    public const string ErrorSttFailedKey = "translation.voiceMode.errors.sttFailed";

    /// <summary>English fallback for <see cref="ErrorSttFailedKey"/> (positional form of web <c>{{reason}}</c>).</summary>
    public const string ErrorSttFailedFallback = "Voice input failed: {0}";

    /// <summary>i18n key for the universal Helix CTA label (web <c>helix.askHelix</c>).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>English fallback for <see cref="AskHelixKey"/>.</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>i18n key for the streaming button label (web <c>helix.thinking</c>).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>English fallback for <see cref="ThinkingKey"/>.</summary>
    public const string ThinkingFallback = "Helix is thinking\u2026";

    /// <summary>i18n key for the badge text (web AIBadge default <c>helix.badge</c>).</summary>
    public const string BadgeKey = "translation.helix.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/>.</summary>
    public const string BadgeFallback = "Helix";

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
    /// Compose the dictation-failure message by folding <paramref name="reason"/> into the resolved template
    /// (web <c>t('voiceMode.errors.sttFailed', { reason })</c>). A template missing the positional token is
    /// returned unchanged so a malformed catalog entry never throws.
    /// </summary>
    /// <param name="template">The resolved (or fallback) message template carrying <c>{0}</c>.</param>
    /// <param name="reason">The failure reason reported by the recognizer.</param>
    /// <returns>The composed message.</returns>
    public static string FormatSttError(string template, string reason)
    {
        ArgumentNullException.ThrowIfNull(template);
        var safeReason = reason ?? string.Empty;
        if (!template.Contains("{0}", StringComparison.Ordinal))
        {
            return template;
        }

        return string.Format(CultureInfo.CurrentCulture, template, safeReason);
    }

    /// <summary>
    /// True when <paramref name="featureId"/> is a known AI feature in the canonical registry — the native
    /// analogue of <c>withAiFeature</c> throwing on an unknown id at module load. Guards against a typo silently
    /// rendering nothing forever.
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
/// tool-confirmation (the voice endpoint does not use it, but the union is reproduced for parity),
/// <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiVoiceStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiVoiceStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiVoiceEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); this surface ignores it (web onEvent tees text only).</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); this surface ignores it.</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a voice stream ended in <see cref="AiVoiceEventKind.Error"/>. The web hook records only the message; the
/// native transport additionally classifies the failure so the view can show the connectivity-aware offline
/// affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiVoiceErrorReason
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
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this voice surface consumes. Like the web
/// component (whose <c>onEvent</c> tees only the delta text into the speech buffer) the surface reads the
/// accumulating <see cref="Text"/> and the terminal frames; <c>tool_call</c> / <c>tool_result</c> frames are
/// parsed (so a tool frame never corrupts the stream) but carry no payload here. Pure data, so the parser and
/// the view-model state machine are unit-tested headlessly. Construct via the static factories, never directly.
/// </summary>
public sealed class AiVoiceStreamEvent
{
    private AiVoiceStreamEvent(AiVoiceEventKind kind, string text, string message, AiVoiceErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiVoiceEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="AiVoiceEventKind.Error"/>.</summary>
    public AiVoiceErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    /// <param name="text">The chunk of reply text.</param>
    /// <returns>A delta event.</returns>
    public static AiVoiceStreamEvent Delta(string text) =>
        new(AiVoiceEventKind.Delta, text ?? string.Empty, string.Empty, AiVoiceErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    /// <returns>A tool-call event.</returns>
    public static AiVoiceStreamEvent ToolCall() =>
        new(AiVoiceEventKind.ToolCall, string.Empty, string.Empty, AiVoiceErrorReason.Unknown);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    /// <returns>A tool-result event.</returns>
    public static AiVoiceStreamEvent ToolResult() =>
        new(AiVoiceEventKind.ToolResult, string.Empty, string.Empty, AiVoiceErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    /// <returns>A confirm-request event.</returns>
    public static AiVoiceStreamEvent ConfirmRequest() =>
        new(AiVoiceEventKind.ConfirmRequest, string.Empty, string.Empty, AiVoiceErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    /// <returns>A done event.</returns>
    public static AiVoiceStreamEvent Done() =>
        new(AiVoiceEventKind.Done, string.Empty, string.Empty, AiVoiceErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    /// <param name="message">The human-readable error message.</param>
    /// <param name="reason">The classified failure reason.</param>
    /// <returns>An error event.</returns>
    public static AiVoiceStreamEvent Error(string message, AiVoiceErrorReason reason) =>
        new(AiVoiceEventKind.Error, string.Empty, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the voice endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ message: transcript.trim(), session_id }</c> (web AIVoiceMode L231-L234). The explicit
/// <see cref="JsonPropertyNameAttribute"/>s pin the snake_case wire names regardless of the serializer policy.
/// </summary>
public sealed class AiVoiceRequest
{
    /// <summary>Creates the request body for the dictated question and the per-session id.</summary>
    /// <param name="message">The transcribed question (already trimmed by the caller).</param>
    /// <param name="sessionId">The stable per-mount voice session id.</param>
    public AiVoiceRequest(string message, string sessionId)
    {
        Message = message ?? string.Empty;
        SessionId = sessionId ?? string.Empty;
    }

    /// <summary>The transcribed question (web <c>message</c>).</summary>
    [JsonPropertyName("message")]
    public string Message { get; }

    /// <summary>The stable per-mount voice session id (web <c>session_id</c>).</summary>
    [JsonPropertyName("session_id")]
    public string SessionId { get; }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiVoiceStreamEvent"/>s — the native port of the web
/// <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are blank-line
/// delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c> lines. A
/// malformed frame, an unknown event type, or a payload missing its required discriminator fields yields
/// <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). UI-free + allocation-light so it is
/// unit-tested without a host.
/// </summary>
public static class AiVoiceSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    /// <param name="rawFrame">The raw frame text (event/data lines joined by newlines).</param>
    /// <returns>The typed event, or <see langword="null"/>.</returns>
    public static AiVoiceStreamEvent? ParseFrame(string rawFrame)
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
    public static AiVoiceStreamEvent? ToTypedEvent(string? eventName, JsonElement? payload)
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
                    ? AiVoiceStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiVoiceStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !HasString(data, "name") ||
                    !data.TryGetProperty("ok", out var okEl) ||
                    (okEl.ValueKind != JsonValueKind.True && okEl.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                return AiVoiceStreamEvent.ToolResult();

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiVoiceStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiVoiceStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiVoiceStreamEvent.Error(message, AiVoiceErrorReason.Stream);

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
/// The completed sentences pulled off a text-to-speech buffer plus the trailing remainder — the native return
/// shape of the web <c>popCompleteSentences</c> (web AIVoiceMode L125-L140).
/// </summary>
/// <param name="Spoken">The complete sentences ready to be spoken, in order.</param>
/// <param name="Remainder">The trailing text that has not yet reached a sentence boundary.</param>
public readonly record struct SpeechFlush(IReadOnlyList<string> Spoken, string Remainder);

/// <summary>
/// Splits streamed reply text at sentence boundaries so the synthesizer speaks whole sentences rather than
/// word-by-word (sounds broken) or only after the whole reply (poor latency) — the native port of the web
/// <c>popCompleteSentences</c> (web AIVoiceMode L116-L140). A sentence ends at <c>. ! ?</c> followed by
/// whitespace; the text after the last boundary is returned as the remainder to carry into the next delta. Pure
/// logic, so it is unit-tested without a host.
/// </summary>
public static class VoiceSentenceChunker
{
    // web SENTENCE_BOUNDARY_RE = /([.!?])\s+/
    private static readonly Regex SentenceBoundary =
        new(@"([.!?])\s+", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// Pull every complete sentence off the front of <paramref name="buffer"/>, returning them plus the
    /// not-yet-terminated remainder (web <c>popCompleteSentences</c>).
    /// </summary>
    /// <param name="buffer">The accumulated, not-yet-spoken text.</param>
    /// <returns>The complete sentences and the trailing remainder.</returns>
    public static SpeechFlush PopCompleteSentences(string buffer)
    {
        ArgumentNullException.ThrowIfNull(buffer);

        var spoken = new List<string>();
        var working = buffer;
        var match = SentenceBoundary.Match(working);
        while (match.Success)
        {
            var cutAt = match.Index + match.Groups[1].Length;
            var head = working[..cutAt].Trim();
            if (head.Length > 0)
            {
                spoken.Add(head);
            }

            working = working[cutAt..].TrimStart();
            match = SentenceBoundary.Match(working);
        }

        return new SpeechFlush(spoken, working);
    }
}

/// <summary>
/// PII-safe diagnostics for the AIVoiceMode surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> signal with the surface slug — never the dictated question, the streamed reply, or any
/// token usage — so a diagnostics line can never leak voice content. Thread-safe.
/// </summary>
public sealed class AIVoiceModeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIVoiceModeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIVoiceMode</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIVoiceModeRegistration.Slug}");
    }
}
