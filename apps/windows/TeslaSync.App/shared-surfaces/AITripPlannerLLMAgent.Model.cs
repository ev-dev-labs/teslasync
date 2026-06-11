using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The user-facing lifecycle of the trip-planner draft stream — the native port of the web
/// <c>AiStreamState</c> union (web/src/hooks/useAiStream.ts L88). <see cref="PausedConfirm"/> is entered when a
/// <c>confirm_request</c> frame arrives: the server intentionally closes the connection and the surface holds
/// the paused state until a fresh start against the continuation endpoint (the trip-planner surface itself never
/// issues tool confirmations, but the shared lifecycle is reproduced faithfully).
/// </summary>
public enum AiTripPlanStreamState
{
    /// <summary>No stream opened yet (web <c>'idle'</c>).</summary>
    Idle,

    /// <summary>A stream is open and frames are arriving (web <c>'streaming'</c>).</summary>
    Streaming,

    /// <summary>A <c>confirm_request</c> frame paused the stream (web <c>'paused-confirm'</c>).</summary>
    PausedConfirm,

    /// <summary>The stream finished with a <c>done</c> frame, or the connection closed cleanly (web <c>'done'</c>).</summary>
    Done,

    /// <summary>The stream failed (HTTP fault, off-mode 404, or an <c>error</c> frame) (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// The discriminator of a parsed AI stream frame — the native analogue of the <c>type</c> tag on the web
/// <c>AiStreamEvent</c> union (web/src/hooks/useAiStream.ts L49). Kept in lockstep with the backend SSE writer's
/// event names (the web contract test <c>tools/aistream-contract</c> walks both sides).
/// </summary>
public enum AiTripPlanEventKind
{
    /// <summary>A chunk of streamed plan text (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model asked to call a tool (web <c>'tool_call'</c>).</summary>
    ToolCall,

    /// <summary>The result of a tool call (web <c>'tool_result'</c>).</summary>
    ToolResult,

    /// <summary>A human-in-the-loop confirmation request (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>The terminal success frame with finish reason and token usage (web <c>'done'</c>).</summary>
    Done,

    /// <summary>The terminal error frame, optionally carrying structured rate-limit fields (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// One typed SSE frame decoded from the trip-planner stream — the native analogue of the web
/// <c>AiStreamEvent</c> discriminated union (web/src/hooks/useAiStream.ts L49-L80). A flat record keyed by
/// <see cref="Kind"/> so the parser returns a single type; complex tool payloads are kept as their raw JSON
/// text (the trip-planner surface reads only <see cref="Text"/> and the terminal frames, but the full shape is
/// reproduced for parity with the shared hook). Construct via the static factories, never directly.
/// </summary>
public sealed record AiTripPlanStreamEvent
{
    private AiTripPlanStreamEvent(AiTripPlanEventKind kind) => Kind = kind;

    /// <summary>Which kind of frame this is (web <c>type</c>).</summary>
    public AiTripPlanEventKind Kind { get; }

    /// <summary>The streamed text chunk for a <see cref="AiTripPlanEventKind.Delta"/> frame (web <c>delta.text</c>).</summary>
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

    /// <summary>Builds a <see cref="AiTripPlanEventKind.Delta"/> frame.</summary>
    internal static AiTripPlanStreamEvent Delta(string text) =>
        new(AiTripPlanEventKind.Delta) { Text = text ?? string.Empty };

    /// <summary>Builds a <see cref="AiTripPlanEventKind.ToolCall"/> frame.</summary>
    internal static AiTripPlanStreamEvent ToolCall(string id, string name, string? argumentsJson) =>
        new(AiTripPlanEventKind.ToolCall) { Id = id, Name = name, ArgumentsJson = argumentsJson };

    /// <summary>Builds a <see cref="AiTripPlanEventKind.ToolResult"/> frame.</summary>
    internal static AiTripPlanStreamEvent ToolResult(string id, string name, bool ok, string? dataJson, string? toolError) =>
        new(AiTripPlanEventKind.ToolResult)
        {
            Id = id,
            Name = name,
            Ok = ok,
            DataJson = dataJson,
            ToolError = toolError,
        };

    /// <summary>Builds a <see cref="AiTripPlanEventKind.ConfirmRequest"/> frame.</summary>
    internal static AiTripPlanStreamEvent ConfirmRequest(string continuationId, string tool, string? argsJson, string summary) =>
        new(AiTripPlanEventKind.ConfirmRequest)
        {
            ContinuationId = continuationId,
            Tool = tool,
            ArgsJson = argsJson,
            Summary = summary,
        };

    /// <summary>Builds a <see cref="AiTripPlanEventKind.Done"/> frame.</summary>
    internal static AiTripPlanStreamEvent DoneEvent(string finishReason, long usageIn, long usageOut) =>
        new(AiTripPlanEventKind.Done)
        {
            FinishReason = string.IsNullOrEmpty(finishReason) ? "stop" : finishReason,
            UsageIn = usageIn,
            UsageOut = usageOut,
        };

    /// <summary>Builds a <see cref="AiTripPlanEventKind.Error"/> frame.</summary>
    internal static AiTripPlanStreamEvent ErrorEvent(
        string message,
        string? reason,
        double? retryAfterS,
        string? bannerLevel,
        bool? baselineAvailable) =>
        new(AiTripPlanEventKind.Error)
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
/// <see cref="AiTripPlanStreamEvent.Reason"/>; a plain error frame yields no limit and the surface falls back to
/// the generic error display.
/// </summary>
/// <param name="Reason">The closed-set limit reason the backend wrote (web <c>reason</c>).</param>
/// <param name="RetryAfterS">The retry countdown in seconds (web <c>retry_after_s</c>, default 0).</param>
/// <param name="BannerLevel">The banner severity: <c>"warn"</c>, <c>"critical"</c> or <c>""</c> (web <c>banner_level</c>).</param>
/// <param name="BaselineAvailable">Whether a non-AI baseline is available (web <c>baseline_available</c>, default true).</param>
/// <param name="Message">The human-readable error message (web <c>message</c>).</param>
public sealed record AiTripPlanLimitInfo(
    string Reason,
    double RetryAfterS,
    string BannerLevel,
    bool BaselineAvailable,
    string Message);

/// <summary>
/// The pure SSE-frame adapter for the trip-planner stream — the native port of the web <c>toTypedEvent</c> /
/// <c>parseSSEFrame</c> narrowing (web/src/hooks/useAiStream.ts L364-L468). It maps a decoded
/// <see cref="SseFrame"/> (reassembled by the shared <see cref="SseFrameParser"/>) to a typed
/// <see cref="AiTripPlanStreamEvent"/>, returning <see langword="null"/> for an unknown event name, a non-object
/// or malformed JSON payload, or a frame missing a required field — so a future server event can never crash an
/// older client (the hook simply drops what it cannot understand). UI-free and allocation-light; the whole
/// surface's parse logic is asserted here without a host.
/// </summary>
public static class AiTripPlanStreamParser
{
    /// <summary>Maps a reassembled <see cref="SseFrame"/> to a typed event (web <c>parseSSEFrame</c> tail).</summary>
    /// <param name="frame">The frame produced by <see cref="SseFrameParser.Feed"/>.</param>
    /// <returns>The typed event, or <see langword="null"/> if the frame is not a recognized AI event.</returns>
    public static AiTripPlanStreamEvent? ParseFrame(SseFrame frame)
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
    public static AiTripPlanStreamEvent? ToTypedEvent(string? eventName, string? data)
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

    private static AiTripPlanStreamEvent? ParseDelta(JsonElement d)
    {
        string? text = StringField(d, "text");
        return text is null ? null : AiTripPlanStreamEvent.Delta(text);
    }

    private static AiTripPlanStreamEvent? ParseToolCall(JsonElement d)
    {
        string? id = StringField(d, "id");
        string? name = StringField(d, "name");
        if (id is null || name is null)
        {
            return null;
        }

        return AiTripPlanStreamEvent.ToolCall(id, name, RawField(d, "arguments"));
    }

    private static AiTripPlanStreamEvent? ParseToolResult(JsonElement d)
    {
        string? id = StringField(d, "id");
        string? name = StringField(d, "name");
        bool? ok = BoolField(d, "ok");
        if (id is null || name is null || ok is null)
        {
            return null;
        }

        return AiTripPlanStreamEvent.ToolResult(id, name, ok.Value, RawField(d, "data"), StringField(d, "error"));
    }

    private static AiTripPlanStreamEvent? ParseConfirmRequest(JsonElement d)
    {
        string? continuationId = StringField(d, "continuation_id");
        string? tool = StringField(d, "tool");
        string? summary = StringField(d, "summary");
        if (continuationId is null || tool is null || summary is null)
        {
            return null;
        }

        return AiTripPlanStreamEvent.ConfirmRequest(continuationId, tool, RawField(d, "args"), summary);
    }

    private static AiTripPlanStreamEvent ParseDone(JsonElement d)
    {
        long usageIn = 0;
        long usageOut = 0;
        if (d.TryGetProperty("usage", out JsonElement usage) && usage.ValueKind == JsonValueKind.Object)
        {
            usageIn = LongField(usage, "in");
            usageOut = LongField(usage, "out");
        }

        string finishReason = StringField(d, "finish_reason") ?? "stop";
        return AiTripPlanStreamEvent.DoneEvent(finishReason, usageIn, usageOut);
    }

    private static AiTripPlanStreamEvent ParseError(JsonElement d)
    {
        string message = StringField(d, "message") ?? "unknown";
        string? reason = StringField(d, "reason");
        double? retryAfterS = DoubleField(d, "retry_after_s");

        string? bannerRaw = StringField(d, "banner_level");
        string? bannerLevel = bannerRaw is "warn" or "critical" or "" ? bannerRaw : null;

        bool? baselineAvailable = BoolField(d, "baseline_available");
        return AiTripPlanStreamEvent.ErrorEvent(message, reason, retryAfterS, bannerLevel, baselineAvailable);
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
/// A geographic endpoint surfaced to the trip-planner agent by the parent page — the native port of the web
/// <c>TripLocationLike</c> (web/src/components/ai/AITripPlannerLLMAgent.tsx L11). The <see cref="Name"/> is the
/// human label of the place (optional, defaults to empty when omitted).
/// </summary>
/// <param name="Lat">The latitude in decimal degrees (web <c>lat</c>).</param>
/// <param name="Lng">The longitude in decimal degrees (web <c>lng</c>).</param>
/// <param name="Name">The optional human-readable place name (web <c>name</c>).</param>
public sealed record TripLocation(double Lat, double Lng, string? Name = null);

/// <summary>
/// The trip-planner inputs the parent page hands the surface — the native port of the web InnerSection props
/// (web/src/components/ai/AITripPlannerLLMAgent.tsx L17-L25). Every field is optional, mirroring the web's
/// <c>?</c> props; the request body builder substitutes the web defaults for any absent value and the gate
/// (<see cref="AiTripPlannerLLMAgentViewModel.CanStart"/>) requires a vehicle id plus both endpoints.
/// </summary>
/// <param name="VehicleId">The selected vehicle id (web <c>vehicleId</c>, <c>string | number | undefined</c>); modeled as the page's string id.</param>
/// <param name="Origin">The corridor start (web <c>origin</c>), or null when not yet chosen.</param>
/// <param name="Destination">The corridor end (web <c>destination</c>), or null when not yet chosen.</param>
/// <param name="CurrentSoc">The current state of charge in percent (web <c>currentSoc</c>, default 80).</param>
/// <param name="MinArrivalSoc">The minimum arrival state of charge in percent (web <c>minArrivalSoc</c>, default 20).</param>
/// <param name="ChargeLimitSoc">The charge-limit state of charge in percent (web <c>chargeLimitSoc</c>, default 90).</param>
/// <param name="SpeedFactor">The driving-speed multiplier (web <c>speedFactor</c>, default 1.0).</param>
public sealed record AiTripPlannerInputs(
    string? VehicleId = null,
    TripLocation? Origin = null,
    TripLocation? Destination = null,
    double? CurrentSoc = null,
    double? MinArrivalSoc = null,
    double? ChargeLimitSoc = null,
    double? SpeedFactor = null);

/// <summary>
/// One endpoint of the draft request body — the native port of the inline origin / destination object the web
/// component posts (web/src/components/ai/AITripPlannerLLMAgent.tsx L42-L55). Serialized with snake_case wire
/// names so the POST body matches the web <c>fetch</c> bit-for-bit.
/// </summary>
/// <param name="Lat">The latitude in decimal degrees (web <c>lat</c>).</param>
/// <param name="Lng">The longitude in decimal degrees (web <c>lng</c>).</param>
/// <param name="Name">The place name; empty when the location carried none (web <c>name ?? ''</c>).</param>
public sealed record TripPoint(
    [property: JsonPropertyName("lat")] double Lat,
    [property: JsonPropertyName("lng")] double Lng,
    [property: JsonPropertyName("name")] string Name)
{
    /// <summary>The all-zero endpoint the web substitutes for an absent origin / destination.</summary>
    public static TripPoint Zero { get; } = new(0, 0, string.Empty);
}

/// <summary>
/// The draft request body POSTed to <c>ai/trips/plan/draft</c> — the native port of the
/// <c>useMemo</c> body the web component builds (web/src/components/ai/AITripPlannerLLMAgent.tsx L39-L70).
/// Every property carries an explicit snake_case wire name so the serialized JSON matches the web request
/// regardless of the shared serializer's naming policy. Build it through <see cref="Build"/> so the web's
/// default substitutions (80 / 90 / 20 / 1.0 and the all-zero endpoint fallback) are applied in one place.
/// </summary>
/// <param name="VehicleId">The numeric vehicle id (web <c>vehicle_id: numericVehicleId || 0</c>).</param>
/// <param name="Origin">The corridor start (web <c>origin</c>).</param>
/// <param name="Destination">The corridor end (web <c>destination</c>).</param>
/// <param name="CurrentSoc">The current state of charge in percent (web <c>current_soc</c>).</param>
/// <param name="ChargeLimitSoc">The charge-limit state of charge in percent (web <c>charge_limit_soc</c>).</param>
/// <param name="MinArrivalSoc">The minimum arrival state of charge in percent (web <c>min_arrival_soc</c>).</param>
/// <param name="SpeedFactor">The driving-speed multiplier (web <c>speed_factor</c>).</param>
public sealed record AiTripPlanRequest(
    [property: JsonPropertyName("vehicle_id")] long VehicleId,
    [property: JsonPropertyName("origin")] TripPoint Origin,
    [property: JsonPropertyName("destination")] TripPoint Destination,
    [property: JsonPropertyName("current_soc")] double CurrentSoc,
    [property: JsonPropertyName("charge_limit_soc")] double ChargeLimitSoc,
    [property: JsonPropertyName("min_arrival_soc")] double MinArrivalSoc,
    [property: JsonPropertyName("speed_factor")] double SpeedFactor)
{
    /// <summary>
    /// Builds the request body from the parent-supplied inputs, applying the web default substitutions: an
    /// absent endpoint becomes <see cref="TripPoint.Zero"/>, an absent state of charge becomes 80 / 90 / 20,
    /// and an absent speed factor becomes 1.0 (web <c>?? 80</c> / <c>?? 90</c> / <c>?? 20</c> / <c>?? 1.0</c>).
    /// </summary>
    /// <param name="inputs">The inputs handed to the surface by the parent page.</param>
    /// <returns>The render-ready, snake_case-serializable request body.</returns>
    public static AiTripPlanRequest Build(AiTripPlannerInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);

        return new AiTripPlanRequest(
            VehicleId: ParseVehicleId(inputs.VehicleId),
            Origin: ToPoint(inputs.Origin),
            Destination: ToPoint(inputs.Destination),
            CurrentSoc: inputs.CurrentSoc ?? 80,
            ChargeLimitSoc: inputs.ChargeLimitSoc ?? 90,
            MinArrivalSoc: inputs.MinArrivalSoc ?? 20,
            SpeedFactor: inputs.SpeedFactor ?? 1.0);
    }

    private static TripPoint ToPoint(TripLocation? location) =>
        location is null ? TripPoint.Zero : new TripPoint(location.Lat, location.Lng, location.Name ?? string.Empty);

    // web: `numericVehicleId = typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)` then
    // `vehicle_id: numericVehicleId || 0`. A non-numeric / absent id becomes 0; vehicle ids are int64.
    private static long ParseVehicleId(string? vehicleId) =>
        long.TryParse(vehicleId, NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed) ? parsed : 0;
}

/// <summary>
/// Canonical identity, i18n keys and label resolution for the AITripPlannerLLMAgent surface — the native mirror
/// of web/src/components/ai/AITripPlannerLLMAgent.tsx and the slice of AIFeatureCard it parameterizes. The web
/// component composes its copy from the <c>tripPlanner.aiAgent.*</c> keys plus the shared <c>helix.*</c> CTA
/// keys; the native keys carry the <c>translation.</c> catalog prefix the WinUI resource bridge expects (the
/// convention the shipped AI surfaces use), so each resolves against <c>Strings/{lang}/Resources.resw</c> in the
/// app and against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AITripPlannerLLMAgentRegistration
{
    /// <summary>The AI feature id this surface is gated by (web <c>withAiFeature('trip-planner-llm-agent', …)</c>).</summary>
    public const string FeatureId = "trip-planner-llm-agent";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AITripPlannerLLMAgent";

    /// <summary>The UI-automation id mirroring the web gate's <c>data-testid="ai-feature-trip-planner-llm-agent-root"</c>.</summary>
    public const string RootAutomationId = "ai-feature-trip-planner-llm-agent-root";

    /// <summary>The draft endpoint the stream is opened against (web <c>'/ai/trips/plan/draft'</c>).</summary>
    public const string DraftPath = "ai/trips/plan/draft";

    /// <summary>The card title i18n key (web <c>tripPlanner.aiAgent.title</c>).</summary>
    public const string TitleKey = "translation.tripPlanner.aiAgent.title";

    /// <summary>The English fallback for the title (the web default literal).</summary>
    public const string TitleFallback = "Draft a plan with Helix";

    /// <summary>The card description i18n key (web <c>tripPlanner.aiAgent.description</c>).</summary>
    public const string DescriptionKey = "translation.tripPlanner.aiAgent.description";

    /// <summary>The English fallback for the description (the web default literal).</summary>
    public const string DescriptionFallback =
        "Ask Helix to draft a trip plan grounded in your past charging history along the corridor. The plan is never saved automatically — review the proposed plan and click Plan in the form below to save it.";

    /// <summary>The per-feature action label i18n key (web <c>tripPlanner.aiAgent.generateButton</c>).</summary>
    public const string GenerateButtonKey = "translation.tripPlanner.aiAgent.generateButton";

    /// <summary>The English fallback for the action label (the web default literal).</summary>
    public const string GenerateButtonFallback = "Draft a plan";

    /// <summary>The badge label i18n key (web <c>tripPlanner.aiAgent.badge</c>).</summary>
    public const string BadgeKey = "translation.tripPlanner.aiAgent.badge";

    /// <summary>The English fallback for the badge (the web default literal).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>The universal Helix CTA i18n key (web <c>helix.askHelix</c>).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>The English fallback for the CTA (the web default literal).</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>The streaming-state CTA i18n key (web <c>helix.thinking</c>).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>The English fallback for the streaming CTA (the web default literal).</summary>
    public const string ThinkingFallback = "Helix is thinking…";

    /// <summary>The friendly error message i18n key (native; the web AiOutputPanel surfaces the failure).</summary>
    public const string ErrorKey = "translation.tripPlanner.aiAgent.error";

    /// <summary>The English fallback for the error message.</summary>
    public const string ErrorFallback = "The plan couldn't be drafted. Try again.";

    /// <summary>The retry affordance i18n key (native; mirrors the QueryError retry).</summary>
    public const string RetryKey = "translation.tripPlanner.aiAgent.retry";

    /// <summary>The English fallback for the retry affordance.</summary>
    public const string RetryFallback = "Try again";

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
/// The fully projected, render-ready labels of the AITripPlannerLLMAgent card — the native analogue of
/// everything the web InnerSection + AIFeatureCard compute before returning JSX. Pure data so the projection is
/// asserted headlessly; the view binds to it and resolves no strings itself.
/// </summary>
/// <param name="Title">The localized card title (web <c>title</c>).</param>
/// <param name="Description">The localized description (web <c>description</c>).</param>
/// <param name="BadgeLabel">The localized badge text (web <c>badgeLabel</c>).</param>
/// <param name="AskHelixLabel">The idle CTA text (web <c>helix.askHelix</c>).</param>
/// <param name="ThinkingLabel">The streaming CTA text (web <c>helix.thinking</c>).</param>
/// <param name="GenerateLabel">The per-feature action verb (web <c>buttonLabel</c>).</param>
/// <param name="ButtonAutomationName">The button's Narrator name (web <c>aria-label</c> <c>"Ask Helix · &lt;verb&gt;"</c>).</param>
/// <param name="ErrorMessage">The friendly error message shown on failure.</param>
/// <param name="RetryLabel">The retry affordance label.</param>
public sealed record AITripPlannerLLMAgentDisplay(
    string Title,
    string Description,
    string BadgeLabel,
    string AskHelixLabel,
    string ThinkingLabel,
    string GenerateLabel,
    string ButtonAutomationName,
    string ErrorMessage,
    string RetryLabel);

/// <summary>
/// Projects the AITripPlannerLLMAgent i18n catalog into a render-ready <see cref="AITripPlannerLLMAgentDisplay"/>
/// — the UI-thread-free core the view-model exposes and the view binds to. Mirrors the web InnerSection label
/// wiring, including the AIFeatureCard accessible-name composition (<c>"Ask Helix · &lt;buttonLabel&gt;"</c>).
/// </summary>
public static class AITripPlannerLLMAgentProjection
{
    /// <summary>Builds the display from the i18n facade.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready label model.</returns>
    public static AITripPlannerLLMAgentDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string title = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.TitleKey, AITripPlannerLLMAgentRegistration.TitleFallback);
        string description = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.DescriptionKey, AITripPlannerLLMAgentRegistration.DescriptionFallback);
        string badge = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.BadgeKey, AITripPlannerLLMAgentRegistration.BadgeFallback);
        string askHelix = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.AskHelixKey, AITripPlannerLLMAgentRegistration.AskHelixFallback);
        string thinking = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.ThinkingKey, AITripPlannerLLMAgentRegistration.ThinkingFallback);
        string generate = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.GenerateButtonKey, AITripPlannerLLMAgentRegistration.GenerateButtonFallback);
        string error = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.ErrorKey, AITripPlannerLLMAgentRegistration.ErrorFallback);
        string retry = AITripPlannerLLMAgentRegistration.Resolve(
            localizer, AITripPlannerLLMAgentRegistration.RetryKey, AITripPlannerLLMAgentRegistration.RetryFallback);

        return new AITripPlannerLLMAgentDisplay(
            Title: title,
            Description: description,
            BadgeLabel: badge,
            AskHelixLabel: askHelix,
            ThinkingLabel: thinking,
            GenerateLabel: generate,
            ButtonAutomationName: ButtonAutomationName(askHelix, generate),
            ErrorMessage: error,
            RetryLabel: retry);
    }

    /// <summary>
    /// Composes the button's accessible name — the web <c>aria-label={`${askHelixLabel} · ${buttonLabel}`}</c>
    /// so a screen reader hears the universal CTA plus the per-feature verb.
    /// </summary>
    /// <param name="askHelixLabel">The universal CTA text.</param>
    /// <param name="generateLabel">The per-feature verb.</param>
    /// <returns>The composed accessible name.</returns>
    private static string ButtonAutomationName(string askHelixLabel, string generateLabel) =>
        string.Create(CultureInfo.InvariantCulture, $"{askHelixLabel} · {generateLabel}");
}

/// <summary>
/// PII-safe diagnostics for the AITripPlannerLLMAgent surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> signal with the surface slug — never the drafted plan text, the corridor
/// coordinates, the vehicle id, or any token usage — so a diagnostics line can never leak trip content.
/// Thread-safe.
/// </summary>
public sealed class AITripPlannerLLMAgentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AITripPlannerLLMAgentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AITripPlannerLLMAgent</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AITripPlannerLLMAgentRegistration.Slug}");
    }
}
