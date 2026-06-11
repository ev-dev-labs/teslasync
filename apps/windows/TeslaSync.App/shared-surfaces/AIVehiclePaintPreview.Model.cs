using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The user-facing lifecycle of the vehicle-paint-preview stream — the native port of the web
/// <c>AiStreamState</c> union (web/src/hooks/useAiStream.ts L88). <see cref="PausedConfirm"/> is reproduced for
/// parity with the shared hook even though the paint-preview endpoint never issues a tool confirmation (web
/// AIVehiclePaintPreview.tsx: the render contract is PROPOSE-ONLY — Helix drafts an image prompt and never
/// applies a paint). Idle before the first run (and after a cancel), <see cref="Streaming"/> while the SSE is
/// open, <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiPaintPreviewStreamState
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

/// <summary>
/// The discriminator of a parsed AI stream frame — the native analogue of the <c>type</c> tag on the web
/// <c>AiStreamEvent</c> union (web/src/hooks/useAiStream.ts L49). Kept in lockstep with the backend SSE writer's
/// event names (the web contract test <c>tools/aistream-contract</c> walks both sides).
/// </summary>
public enum AiPaintPreviewEventKind
{
    /// <summary>A chunk of streamed image-prompt text (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model asked to call a tool (web <c>'tool_call'</c>); the paint-preview surface ignores the payload.</summary>
    ToolCall,

    /// <summary>The result of a tool call (web <c>'tool_result'</c>); the paint-preview surface ignores the payload.</summary>
    ToolResult,

    /// <summary>A human-in-the-loop confirmation request (web <c>'confirm_request'</c>); reproduced for lifecycle parity.</summary>
    ConfirmRequest,

    /// <summary>The terminal success frame with finish reason and token usage (web <c>'done'</c>).</summary>
    Done,

    /// <summary>The terminal error frame, optionally carrying structured rate-limit fields (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a paint-preview stream ended in <see cref="AiPaintPreviewEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-aware
/// offline affordance the P2 state matrix mandates without inventing data the web surface lacks. An on-demand SSE
/// draft has no cached prior result, so a connectivity loss surfaces as the offline error branch (the native
/// analogue of the P2 "offline" state for a cache-free surface).
/// </summary>
public enum AiPaintPreviewErrorReason
{
    /// <summary>No classification yet / no error (web: error is null).</summary>
    Unknown = 0,

    /// <summary>A non-success HTTP status (<c>stream_http_{status}</c>); off-mode 404 or a server fault (web hook).</summary>
    Http = 1,

    /// <summary>A terminal <c>error</c> SSE frame raised by the backend writer (web <c>error</c> event).</summary>
    Stream = 2,

    /// <summary>A connectivity fault (connection refused, DNS, reset, mid-stream read failure) — the offline branch.</summary>
    Network = 3,
}

/// <summary>
/// One typed SSE frame decoded from the paint-preview stream — the native analogue of the web
/// <c>AiStreamEvent</c> discriminated union (web/src/hooks/useAiStream.ts L49-L80). A flat record keyed by
/// <see cref="Kind"/> so the parser returns a single type; complex tool payloads are kept as their raw JSON text
/// (the paint-preview surface reads only <see cref="Text"/> and the terminal frames, but the full shape is
/// reproduced for parity with the shared hook). Construct via the static factories, never directly.
/// </summary>
public sealed record AiPaintPreviewStreamEvent
{
    private AiPaintPreviewStreamEvent(AiPaintPreviewEventKind kind) => Kind = kind;

    /// <summary>Which kind of frame this is (web <c>type</c>).</summary>
    public AiPaintPreviewEventKind Kind { get; }

    /// <summary>The streamed text chunk for a <see cref="AiPaintPreviewEventKind.Delta"/> frame (web <c>delta.text</c>).</summary>
    public string Text { get; private init; } = string.Empty;

    /// <summary>The tool-call / tool-result id (web <c>id</c>).</summary>
    public string Id { get; private init; } = string.Empty;

    /// <summary>The tool name (web <c>name</c>).</summary>
    public string Name { get; private init; } = string.Empty;

    /// <summary>The raw JSON of a tool call's arguments, or <see langword="null"/> (web <c>tool_call.arguments</c>).</summary>
    public string? ArgumentsJson { get; private init; }

    /// <summary>Whether a tool result succeeded (web <c>tool_result.ok</c>).</summary>
    public bool Ok { get; private init; }

    /// <summary>The raw JSON of a tool result's data, or <see langword="null"/> (web <c>tool_result.data</c>).</summary>
    public string? DataJson { get; private init; }

    /// <summary>A tool result's error string, or <see langword="null"/> (web <c>tool_result.error</c>).</summary>
    public string? ToolError { get; private init; }

    /// <summary>The continuation id of a confirm request (web <c>confirm_request.continuation_id</c>).</summary>
    public string ContinuationId { get; private init; } = string.Empty;

    /// <summary>The tool a confirm request is gating (web <c>confirm_request.tool</c>).</summary>
    public string Tool { get; private init; } = string.Empty;

    /// <summary>The raw JSON of a confirm request's args, or <see langword="null"/> (web <c>confirm_request.args</c>).</summary>
    public string? ArgsJson { get; private init; }

    /// <summary>A confirm request's human-readable summary (web <c>confirm_request.summary</c>).</summary>
    public string Summary { get; private init; } = string.Empty;

    /// <summary>The finish reason of a done frame; defaults to <c>"stop"</c> (web <c>done.finish_reason</c>).</summary>
    public string FinishReason { get; private init; } = "stop";

    /// <summary>Input tokens reported by a done frame (web <c>done.usage.in</c>).</summary>
    public long UsageIn { get; private init; }

    /// <summary>Output tokens reported by a done frame (web <c>done.usage.out</c>).</summary>
    public long UsageOut { get; private init; }

    /// <summary>The error message of an error frame; defaults to <c>"unknown"</c> (web <c>error.message</c>).</summary>
    public string Message { get; private init; } = string.Empty;

    /// <summary>The structured rate-limit / cost-cap reason, or <see langword="null"/> (web <c>error.reason</c>).</summary>
    public string? Reason { get; private init; }

    /// <summary>The suggested retry delay in seconds, or <see langword="null"/> (web <c>error.retry_after_s</c>).</summary>
    public double? RetryAfterS { get; private init; }

    /// <summary>The banner severity (<c>"warn"</c> / <c>"critical"</c> / <c>""</c>), or <see langword="null"/> (web <c>error.banner_level</c>).</summary>
    public string? BannerLevel { get; private init; }

    /// <summary>Whether a non-AI baseline is available, or <see langword="null"/> (web <c>error.baseline_available</c>).</summary>
    public bool? BaselineAvailable { get; private init; }

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.Delta"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent Delta(string text) =>
        new(AiPaintPreviewEventKind.Delta) { Text = text ?? string.Empty };

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.ToolCall"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent ToolCall(string id, string name, string? argumentsJson) =>
        new(AiPaintPreviewEventKind.ToolCall) { Id = id, Name = name, ArgumentsJson = argumentsJson };

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.ToolResult"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent ToolResult(string id, string name, bool ok, string? dataJson, string? toolError) =>
        new(AiPaintPreviewEventKind.ToolResult)
        {
            Id = id,
            Name = name,
            Ok = ok,
            DataJson = dataJson,
            ToolError = toolError,
        };

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.ConfirmRequest"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent ConfirmRequest(string continuationId, string tool, string? argsJson, string summary) =>
        new(AiPaintPreviewEventKind.ConfirmRequest)
        {
            ContinuationId = continuationId,
            Tool = tool,
            ArgsJson = argsJson,
            Summary = summary,
        };

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.Done"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent DoneEvent(string finishReason, long usageIn, long usageOut) =>
        new(AiPaintPreviewEventKind.Done)
        {
            FinishReason = string.IsNullOrEmpty(finishReason) ? "stop" : finishReason,
            UsageIn = usageIn,
            UsageOut = usageOut,
        };

    /// <summary>Builds a <see cref="AiPaintPreviewEventKind.Error"/> frame.</summary>
    internal static AiPaintPreviewStreamEvent ErrorEvent(
        string message,
        string? reason,
        double? retryAfterS,
        string? bannerLevel,
        bool? baselineAvailable) =>
        new(AiPaintPreviewEventKind.Error)
        {
            Message = string.IsNullOrEmpty(message) ? "unknown" : message,
            Reason = reason,
            RetryAfterS = retryAfterS,
            BannerLevel = bannerLevel,
            BaselineAvailable = baselineAvailable,
        };
}

/// <summary>
/// Structured rate-limit / cost-cap information lifted from a terminal <c>error</c> frame — the native port of
/// the web <c>AiLimitInfo</c> (web/src/hooks/useAiStream.ts L129). Present only when the error frame carried a
/// <see cref="AiPaintPreviewStreamEvent.Reason"/>; a plain error frame yields no limit and the surface falls back
/// to the generic error display.
/// </summary>
/// <param name="Reason">The closed-set limit reason the backend wrote (web <c>reason</c>).</param>
/// <param name="RetryAfterS">The retry countdown in seconds (web <c>retry_after_s</c>, default 0).</param>
/// <param name="BannerLevel">The banner severity: <c>"warn"</c>, <c>"critical"</c> or <c>""</c> (web <c>banner_level</c>).</param>
/// <param name="BaselineAvailable">Whether a non-AI baseline is available (web <c>baseline_available</c>, default true).</param>
/// <param name="Message">The human-readable error message (web <c>message</c>).</param>
public sealed record AiPaintPreviewLimitInfo(
    string Reason,
    double RetryAfterS,
    string BannerLevel,
    bool BaselineAvailable,
    string Message);

/// <summary>
/// The pure paint-preview request adapter — the native port of the web InnerSection's <c>numericVehicleId</c>,
/// <c>body</c> (<c>useMemo</c>) and <c>urlPath</c> derivation (web/src/components/ai/AIVehiclePaintPreview.tsx
/// L62-L84). Given the parent page's optional vehicle id and the optional one-word style hint it computes the
/// post-version SSE path (<c>/ai/vehicles/{id}/paint-preview/draft</c>), the JSON request body (<c>{}</c> or
/// <c>{"style_hint":"…"}</c>), and whether the action can fire (<see cref="HasInputs"/>, web <c>haveInputs</c> /
/// <c>canStart</c>). UI-free and HTTP-free so the whole derivation is asserted headlessly; the transport and the
/// state holder both project through it so the URL/body logic lives in exactly one tested place.
/// </summary>
public sealed class AiPaintPreviewRequest
{
    private AiPaintPreviewRequest(int numericVehicleId, string? styleHint)
    {
        NumericVehicleId = numericVehicleId;
        StyleHint = styleHint;
    }

    /// <summary>
    /// The web <c>numericVehicleId</c> (<c>finite ? vehicleId : 0</c>). An int is always finite, so this is the
    /// supplied id or 0 when none was resolved by the parent page.
    /// </summary>
    public int NumericVehicleId { get; }

    /// <summary>
    /// The normalized one-word style hint (web <c>styleHint.trim()</c>), or <see langword="null"/> when the
    /// parent passed nothing or a blank/whitespace value (web omits <c>style_hint</c> from the body in that case).
    /// </summary>
    public string? StyleHint { get; }

    /// <summary>
    /// Whether the action can fire (web <c>haveInputs = numericVehicleId &gt; 0</c> → <c>canStart</c>). The
    /// backend parser validates <c>vehicleID &gt; 0</c>; the button stays disabled until the parent resolves a
    /// vehicle selection.
    /// </summary>
    public bool HasInputs => NumericVehicleId > 0;

    /// <summary>
    /// The id embedded in the SSE URL — the resolved vehicle id when <see cref="HasInputs"/>, else 0 (web
    /// <c>numericVehicleId &gt; 0 ? numericVehicleId : 0</c>). The 0 path is never actually opened because the
    /// action is disabled, but it is reproduced so the URL derivation matches the web hook bit-for-bit.
    /// </summary>
    public int EffectiveVehicleId => NumericVehicleId > 0 ? NumericVehicleId : 0;

    /// <summary>
    /// The post-version SSE path the stream is opened against (web <c>urlPath</c>); the transport prepends the
    /// API version base, mirroring how <c>useAiStream</c> prefixes <c>/api/v1</c>.
    /// </summary>
    public string DraftPath => string.Concat(
        "/ai/vehicles/",
        EffectiveVehicleId.ToString(CultureInfo.InvariantCulture),
        "/paint-preview/draft");

    /// <summary>
    /// The JSON request body (web <c>JSON.stringify(body)</c>): <c>{}</c> when no style hint, else
    /// <c>{"style_hint":"&lt;trimmed&gt;"}</c>. Built with <see cref="Utf8JsonWriter"/> so the value is escaped
    /// exactly as the backend handler expects.
    /// </summary>
    public string BodyJson => BuildBody(StyleHint);

    /// <summary>
    /// Builds a request from the parent page's optional vehicle id and optional style hint, applying the web
    /// finiteness fallback and style-hint trimming.
    /// </summary>
    /// <param name="vehicleId">The vehicle id surfaced by the parent VehicleDetailPage (web prop), or null.</param>
    /// <param name="styleHint">The optional one-word style hint (web prop), or null.</param>
    /// <returns>The derived request.</returns>
    public static AiPaintPreviewRequest Create(int? vehicleId, string? styleHint = null) =>
        new(vehicleId ?? 0, NormalizeStyleHint(styleHint));

    /// <summary>
    /// Normalizes a style hint the way the web <c>useMemo</c> body does: a non-empty trimmed string, or
    /// <see langword="null"/> when the input is null, empty or whitespace.
    /// </summary>
    /// <param name="styleHint">The raw style hint.</param>
    /// <returns>The trimmed non-empty hint, or null.</returns>
    public static string? NormalizeStyleHint(string? styleHint)
    {
        if (styleHint is null)
        {
            return null;
        }

        string trimmed = styleHint.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static string BuildBody(string? styleHint)
    {
        if (styleHint is null)
        {
            return "{}";
        }

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("style_hint", styleHint);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}

/// <summary>
/// The pure SSE-frame adapter for the paint-preview stream — the native port of the web <c>toTypedEvent</c> /
/// <c>parseSSEFrame</c> narrowing (web/src/hooks/useAiStream.ts L364-L468). It maps a decoded
/// <see cref="SseFrame"/> (reassembled by the shared <see cref="SseFrameParser"/>) to a typed
/// <see cref="AiPaintPreviewStreamEvent"/>, returning <see langword="null"/> for an unknown event name, a
/// non-object or malformed JSON payload, or a frame missing a required field — so a future server event can never
/// crash an older client (the hook simply drops what it cannot understand). UI-free and allocation-light; the
/// whole surface's parse logic is asserted here without a host.
/// </summary>
public static class AiPaintPreviewStreamParser
{
    /// <summary>Maps a reassembled <see cref="SseFrame"/> to a typed event (web <c>parseSSEFrame</c> tail).</summary>
    /// <param name="frame">The frame produced by <see cref="SseFrameParser.Feed"/>.</param>
    /// <returns>The typed event, or <see langword="null"/> if the frame is not a recognized AI event.</returns>
    public static AiPaintPreviewStreamEvent? ParseFrame(SseFrame frame)
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
    public static AiPaintPreviewStreamEvent? ToTypedEvent(string? eventName, string? data)
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
            // web parseSSEFrame: `JSON.parse` throwing returns null so the loop skips the frame.
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
                "delta" => ParseDelta(root),
                "tool_call" => ParseToolCall(root),
                "tool_result" => ParseToolResult(root),
                "confirm_request" => ParseConfirmRequest(root),
                "done" => ParseDone(root),
                "error" => ParseError(root),
                _ => null,
            };
        }
    }

    private static AiPaintPreviewStreamEvent? ParseDelta(JsonElement d)
    {
        string? text = StringField(d, "text");
        return text is null ? null : AiPaintPreviewStreamEvent.Delta(text);
    }

    private static AiPaintPreviewStreamEvent? ParseToolCall(JsonElement d)
    {
        string? id = StringField(d, "id");
        string? name = StringField(d, "name");
        if (id is null || name is null)
        {
            return null;
        }

        return AiPaintPreviewStreamEvent.ToolCall(id, name, RawField(d, "arguments"));
    }

    private static AiPaintPreviewStreamEvent? ParseToolResult(JsonElement d)
    {
        string? id = StringField(d, "id");
        string? name = StringField(d, "name");
        bool? ok = BoolField(d, "ok");
        if (id is null || name is null || ok is null)
        {
            return null;
        }

        return AiPaintPreviewStreamEvent.ToolResult(id, name, ok.Value, RawField(d, "data"), StringField(d, "error"));
    }

    private static AiPaintPreviewStreamEvent? ParseConfirmRequest(JsonElement d)
    {
        string? continuationId = StringField(d, "continuation_id");
        string? tool = StringField(d, "tool");
        string? summary = StringField(d, "summary");
        if (continuationId is null || tool is null || summary is null)
        {
            return null;
        }

        return AiPaintPreviewStreamEvent.ConfirmRequest(continuationId, tool, RawField(d, "args"), summary);
    }

    private static AiPaintPreviewStreamEvent ParseDone(JsonElement d)
    {
        long usageIn = 0;
        long usageOut = 0;
        if (d.TryGetProperty("usage", out JsonElement usage) && usage.ValueKind == JsonValueKind.Object)
        {
            usageIn = LongField(usage, "in");
            usageOut = LongField(usage, "out");
        }

        string finishReason = StringField(d, "finish_reason") ?? "stop";
        return AiPaintPreviewStreamEvent.DoneEvent(finishReason, usageIn, usageOut);
    }

    private static AiPaintPreviewStreamEvent ParseError(JsonElement d)
    {
        string message = StringField(d, "message") ?? "unknown";
        string? reason = StringField(d, "reason");
        double? retryAfterS = DoubleField(d, "retry_after_s");

        string? bannerRaw = StringField(d, "banner_level");
        string? bannerLevel = bannerRaw is "warn" or "critical" or "" ? bannerRaw : null;

        bool? baselineAvailable = BoolField(d, "baseline_available");
        return AiPaintPreviewStreamEvent.ErrorEvent(message, reason, retryAfterS, bannerLevel, baselineAvailable);
    }

    private static string? StringField(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool? BoolField(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out JsonElement value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static double? DoubleField(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDouble(out double d)
            ? d
            : null;

    private static long LongField(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt64(out long l)
            ? l
            : 0;

    private static string? RawField(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetRawText() : null;
}

/// <summary>
/// Canonical identity, i18n keys and label resolution for the AIVehiclePaintPreview surface — the native mirror
/// of web/src/components/ai/AIVehiclePaintPreview.tsx and the slice of AIFeatureCard it parameterizes. The web
/// component composes its copy from the <c>vehicles.aiPaintPreview.*</c> keys plus the shared <c>helix.*</c> CTA
/// keys; the native keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects, so each
/// resolves against <c>Strings/{lang}/Resources.resw</c> in the app and against the English fallback headlessly.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class AIVehiclePaintPreviewRegistration
{
    /// <summary>The AI feature id this surface is gated by (web <c>withAiFeature('vehicle-paint-preview', …)</c>).</summary>
    public const string FeatureId = "vehicle-paint-preview";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIVehiclePaintPreview";

    /// <summary>The UI-automation id mirroring the web gate's <c>data-testid="ai-feature-vehicle-paint-preview-root"</c>.</summary>
    public const string RootAutomationId = "ai-feature-vehicle-paint-preview-root";

    /// <summary>The action button's UI-automation id.</summary>
    public const string ButtonAutomationId = "ai-feature-vehicle-paint-preview-preview";

    /// <summary>The card title i18n key (web <c>vehicles.aiPaintPreview.title</c>).</summary>
    public const string TitleKey = "translation.vehicles.aiPaintPreview.title";

    /// <summary>The English fallback for the title (the web default literal).</summary>
    public const string TitleFallback = "Draft a Helix paint preview";

    /// <summary>The card description i18n key (web <c>vehicles.aiPaintPreview.description</c>).</summary>
    public const string DescriptionKey = "translation.vehicles.aiPaintPreview.description";

    /// <summary>The English fallback for the description (the web default literal, propose-only + privacy contract).</summary>
    public const string DescriptionFallback =
        "Ask Helix to draft a propose-only paint-color image prompt for this vehicle. Helix only sees the redacted vehicle context (model, trim, current exterior color) \u2014 never the display name, VIN, license plate, or location. The draft is never applied automatically; review the proposed image prompt here, then use the existing Color setting below to apply the new paint if you\u2019d like to keep it.";

    /// <summary>The per-feature action label i18n key (web <c>vehicles.aiPaintPreview.button</c>).</summary>
    public const string ButtonLabelKey = "translation.vehicles.aiPaintPreview.button";

    /// <summary>The English fallback for the action label (the web default literal).</summary>
    public const string ButtonLabelFallback = "Preview paint color";

    /// <summary>The badge label i18n key (web <c>vehicles.aiPaintPreview.badge</c>).</summary>
    public const string BadgeKey = "translation.vehicles.aiPaintPreview.badge";

    /// <summary>The English fallback for the badge (the web default literal).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>The no-vehicle empty hint i18n key (web <c>vehicles.aiPaintPreview.noVehicleHint</c>).</summary>
    public const string NoVehicleHintKey = "translation.vehicles.aiPaintPreview.noVehicleHint";

    /// <summary>The English fallback for the no-vehicle empty hint (the web default literal).</summary>
    public const string NoVehicleHintFallback = "Open a vehicle detail page to enable Helix.";

    /// <summary>The universal Helix CTA i18n key (web <c>helix.askHelix</c>).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>The English fallback for the CTA (the web default literal).</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>The streaming-state CTA i18n key (web <c>helix.thinking</c>).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>The English fallback for the streaming CTA (the web default literal).</summary>
    public const string ThinkingFallback = "Helix is thinking\u2026";

    /// <summary>The inline error-label i18n key (web AiOutputPanel <c>helix.errorLabel</c>).</summary>
    public const string ErrorLabelKey = "translation.helix.errorLabel";

    /// <summary>The English fallback for the inline error label (the web default literal).</summary>
    public const string ErrorLabelFallback = "Helix error:";

    /// <summary>The unknown-error fallback i18n key (web AiOutputPanel <c>ai.common.errorUnknown</c>).</summary>
    public const string ErrorUnknownKey = "translation.ai.common.errorUnknown";

    /// <summary>The English fallback for the unknown-error message (the web default literal).</summary>
    public const string ErrorUnknownFallback = "unknown";

    /// <summary>The offline-message i18n key (native; the connectivity-aware P2 offline affordance).</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>The English fallback for the offline message.</summary>
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and try the paint preview again";

    /// <summary>The retry affordance i18n key (native; mirrors the QueryError retry).</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>The English fallback for the retry affordance.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>Segoe Fluent "Light" glyph — the native stand-in for the web Helix mark.</summary>
    public const string HelixGlyph = "\uEA80";

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
/// The fully projected, render-ready labels of the AIVehiclePaintPreview card — the native analogue of
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
/// <param name="NoVehicleHint">The empty-state hint shown when no vehicle is resolved (web <c>emptyHint</c>).</param>
/// <param name="ErrorLabel">The inline error label (web <c>helix.errorLabel</c>).</param>
/// <param name="ErrorUnknown">The unknown-error fallback (web <c>ai.common.errorUnknown</c>).</param>
/// <param name="OfflineMessage">The connectivity-aware offline message.</param>
/// <param name="RetryLabel">The retry affordance label.</param>
public sealed record AIVehiclePaintPreviewDisplay(
    string Title,
    string Description,
    string BadgeLabel,
    string AskHelixLabel,
    string ThinkingLabel,
    string ButtonLabel,
    string ButtonAutomationName,
    string NoVehicleHint,
    string ErrorLabel,
    string ErrorUnknown,
    string OfflineMessage,
    string RetryLabel);

/// <summary>
/// Projects the AIVehiclePaintPreview i18n catalog into a render-ready <see cref="AIVehiclePaintPreviewDisplay"/>
/// — the UI-thread-free core the view-model exposes and the view binds to. Mirrors the web InnerSection label
/// wiring, including the AIFeatureCard accessible-name composition (<c>"Ask Helix · &lt;buttonLabel&gt;"</c>).
/// </summary>
public static class AIVehiclePaintPreviewProjection
{
    /// <summary>Builds the display from the i18n facade.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready label model.</returns>
    public static AIVehiclePaintPreviewDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string title = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.TitleKey, AIVehiclePaintPreviewRegistration.TitleFallback);
        string description = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.DescriptionKey, AIVehiclePaintPreviewRegistration.DescriptionFallback);
        string badge = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.BadgeKey, AIVehiclePaintPreviewRegistration.BadgeFallback);
        string askHelix = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.AskHelixKey, AIVehiclePaintPreviewRegistration.AskHelixFallback);
        string thinking = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.ThinkingKey, AIVehiclePaintPreviewRegistration.ThinkingFallback);
        string button = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.ButtonLabelKey, AIVehiclePaintPreviewRegistration.ButtonLabelFallback);
        string noVehicleHint = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.NoVehicleHintKey, AIVehiclePaintPreviewRegistration.NoVehicleHintFallback);
        string errorLabel = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.ErrorLabelKey, AIVehiclePaintPreviewRegistration.ErrorLabelFallback);
        string errorUnknown = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.ErrorUnknownKey, AIVehiclePaintPreviewRegistration.ErrorUnknownFallback);
        string offline = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.OfflineKey, AIVehiclePaintPreviewRegistration.OfflineFallback);
        string retry = AIVehiclePaintPreviewRegistration.Resolve(
            localizer, AIVehiclePaintPreviewRegistration.RetryKey, AIVehiclePaintPreviewRegistration.RetryFallback);

        return new AIVehiclePaintPreviewDisplay(
            Title: title,
            Description: description,
            BadgeLabel: badge,
            AskHelixLabel: askHelix,
            ThinkingLabel: thinking,
            ButtonLabel: button,
            ButtonAutomationName: ButtonAutomationName(askHelix, button),
            NoVehicleHint: noVehicleHint,
            ErrorLabel: errorLabel,
            ErrorUnknown: errorUnknown,
            OfflineMessage: offline,
            RetryLabel: retry);
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
/// PII-safe diagnostics for the AIVehiclePaintPreview surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> signal with the surface slug — never the streamed image prompt, the vehicle id,
/// the style hint, or any token usage — so a diagnostics line can never leak vehicle content. Thread-safe.
/// </summary>
public sealed class AIVehiclePaintPreviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AIVehiclePaintPreviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIVehiclePaintPreview</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AIVehiclePaintPreviewRegistration.Slug}");
    }
}
