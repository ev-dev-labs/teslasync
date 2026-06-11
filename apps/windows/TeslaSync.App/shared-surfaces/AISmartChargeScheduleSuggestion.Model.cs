using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the smart-charge schedule-suggestion surface — the native mirror of the
/// web <c>AISmartChargeScheduleSuggestion</c> (web/src/components/ai/AISmartChargeScheduleSuggestion.tsx)
/// composed with its shared <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the
/// <c>withAiFeature</c> gate (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/charging/schedule/draft</c> through <c>useAiStream</c> into the shared
/// <c>AiOutputPanel</c>; this metadata carries the same feature id, endpoint, render-contract i18n keys and the
/// off-mode test id so the native surface reproduces the web copy verbatim. Every key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects (the convention every shipped surface
/// uses), and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AISmartChargeScheduleSuggestionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AISmartChargeScheduleSuggestion";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('smart-charge-schedule-suggestion', ...)</c>).</summary>
    public const string FeatureId = "smart-charge-schedule-suggestion";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-smart-charge-schedule-suggestion-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-smart-charge-schedule-suggestion-root";

    /// <summary>The SSE endpoint the draft streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string DraftPath = "/ai/charging/schedule/draft";

    /// <summary>i18n key for the card title (web <c>chargePlanner.aiAgent.title</c>).</summary>
    public const string TitleKey = "translation.chargePlanner.aiAgent.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Draft a schedule with Helix";

    /// <summary>i18n key for the card description (web <c>chargePlanner.aiAgent.description</c>).</summary>
    public const string DescriptionKey = "translation.chargePlanner.aiAgent.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Ask Helix to propose a time-of-use-optimized charge schedule grounded in your selected rate plan and " +
        "target departure. The schedule is never saved automatically \u2014 review the proposed window and " +
        "click Schedule below to apply it.";

    /// <summary>i18n key for the per-feature action verb (web <c>chargePlanner.aiAgent.generateButton</c>).</summary>
    public const string ButtonLabelKey = "translation.chargePlanner.aiAgent.generateButton";

    /// <summary>English fallback for <see cref="ButtonLabelKey"/> (web second arg).</summary>
    public const string ButtonLabelFallback = "Draft a schedule";

    /// <summary>i18n key for the badge text (web <c>chargePlanner.aiAgent.badge</c>).</summary>
    public const string BadgeKey = "translation.chargePlanner.aiAgent.badge";

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
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and try the draft again";

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
/// tool-confirmation (the draft endpoint does not use it, but the union is reproduced for parity),
/// <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiScheduleStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiScheduleStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiScheduleEventKind
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
/// Why a draft stream ended in <see cref="AiScheduleEventKind.Error"/>. The web hook records only the message;
/// the native transport additionally classifies the failure so the view can show the connectivity-aware
/// offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiScheduleErrorReason
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
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this draft surface consumes. Tool / confirm
/// frames are parsed for parity (so the lifecycle and parser match the web hook) but carry no payload here.
/// Pure data, so the parser and the view-model state machine are unit-tested headlessly.
/// </summary>
public sealed class AiScheduleStreamEvent
{
    private AiScheduleStreamEvent(
        AiScheduleEventKind kind,
        string text,
        string message,
        AiScheduleErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiScheduleEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="AiScheduleEventKind.Error"/>.</summary>
    public AiScheduleErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiScheduleStreamEvent Delta(string text) =>
        new(AiScheduleEventKind.Delta, text ?? string.Empty, string.Empty, AiScheduleErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiScheduleStreamEvent ToolCall() =>
        new(AiScheduleEventKind.ToolCall, string.Empty, string.Empty, AiScheduleErrorReason.Unknown);

    /// <summary>A tool-result frame (payload ignored by this surface).</summary>
    public static AiScheduleStreamEvent ToolResult() =>
        new(AiScheduleEventKind.ToolResult, string.Empty, string.Empty, AiScheduleErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiScheduleStreamEvent ConfirmRequest() =>
        new(AiScheduleEventKind.ConfirmRequest, string.Empty, string.Empty, AiScheduleErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiScheduleStreamEvent Done() =>
        new(AiScheduleEventKind.Done, string.Empty, string.Empty, AiScheduleErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiScheduleStreamEvent Error(string message, AiScheduleErrorReason reason) =>
        new(AiScheduleEventKind.Error, string.Empty, message ?? string.Empty, reason);
}

/// <summary>
/// The schedule-draft inputs the host feeds the surface — the native analogue of the web component's props
/// (web AISmartChargeScheduleSuggestion <c>InnerSectionProps</c>, L11-L21). Every field is optional, mirroring
/// the web prop optionality, because the active-vehicle / rate-plan context may be unresolved at first paint;
/// the surface still renders (the gate has already passed) but the action stays disabled until both a vehicle
/// and a rate plan are in scope (web <c>canStart = !!vehicleId &amp;&amp; !!ratePlanId</c>). Immutable so a host
/// swaps the whole snapshot atomically through <see cref="AISmartChargeScheduleSuggestionViewModel.Inputs"/>.
/// </summary>
public sealed class AiScheduleDraftInputs
{
    /// <summary>The in-scope vehicle id (web <c>vehicleId</c>); part of the <c>canStart</c> guard.</summary>
    public long? VehicleId { get; init; }

    /// <summary>The selected time-of-use rate plan id (web <c>ratePlanId</c>); part of the <c>canStart</c> guard.</summary>
    public string? RatePlanId { get; init; }

    /// <summary>The target state-of-charge percent (web <c>targetSoc</c>, default 80).</summary>
    public double? TargetSoc { get; init; }

    /// <summary>The current state-of-charge percent (web <c>currentSoc</c>, default 20).</summary>
    public double? CurrentSoc { get; init; }

    /// <summary>The requested departure time (web <c>departBy</c>, a datetime-local string normalized to ISO).</summary>
    public string? DepartBy { get; init; }

    /// <summary>The charge current limit in amps (web <c>maxAmps</c>, default 32).</summary>
    public double? MaxAmps { get; init; }

    /// <summary>
    /// The usable battery capacity in kWh (web <c>batteryCapacityKwh</c>, default 75). The <c>_kwh</c> suffix is
    /// the web wire contract for <c>POST /ai/charging/schedule/draft</c> (web body L52), reproduced verbatim for
    /// request parity — this is an existing AI request field, not a new persisted SI column.
    /// </summary>
    public double? BatteryCapacityKwh { get; init; }

    /// <summary>The charger supply voltage (web <c>chargerVoltage</c>, default 240).</summary>
    public double? ChargerVoltage { get; init; }

    /// <summary>Whether to bias the plan toward off-peak windows (web <c>preferOffPeak</c>, default true).</summary>
    public bool? PreferOffPeak { get; init; }

    /// <summary>True when both a vehicle and a rate plan are in scope (web <c>canStart = !!vehicleId &amp;&amp; !!ratePlanId</c>).</summary>
    public bool HaveInputs => VehicleId is { } id && id != 0 && !string.IsNullOrEmpty(RatePlanId);
}

/// <summary>
/// The JSON request body POSTed to the draft endpoint — the native analogue of the web <c>useMemo</c> body
/// (web AISmartChargeScheduleSuggestion L37-L67). Each explicit <see cref="JsonPropertyNameAttribute"/> pins the
/// snake_case wire name regardless of the serializer's naming policy, so the contract matches the web request
/// field-for-field. Built through <see cref="FromInputs"/>, which applies the same per-field defaults and the
/// same <c>depart_by</c> ISO normalization the web body does.
/// </summary>
public sealed class AiScheduleDraftRequest
{
    /// <summary>The default target state-of-charge percent (web <c>targetSoc ?? 80</c>).</summary>
    public const double DefaultTargetSoc = 80;

    /// <summary>The default current state-of-charge percent (web <c>currentSoc ?? 20</c>).</summary>
    public const double DefaultCurrentSoc = 20;

    /// <summary>The default charge current limit in amps (web <c>maxAmps ?? 32</c>).</summary>
    public const double DefaultMaxAmps = 32;

    /// <summary>The default usable battery capacity in kWh (web <c>batteryCapacityKwh ?? 75</c>).</summary>
    public const double DefaultBatteryCapacityKwh = 75;

    /// <summary>The default charger supply voltage (web <c>chargerVoltage ?? 240</c>).</summary>
    public const double DefaultChargerVoltage = 240;

    private AiScheduleDraftRequest(
        long vehicleId,
        double targetSoc,
        string departBy,
        string ratePlanId,
        double maxAmps,
        double batteryCapacityKwh,
        double chargerVoltage,
        bool preferOffPeak,
        double currentSoc)
    {
        VehicleId = vehicleId;
        TargetSoc = targetSoc;
        DepartBy = departBy;
        RatePlanId = ratePlanId;
        MaxAmps = maxAmps;
        BatteryCapacityKwh = batteryCapacityKwh;
        ChargerVoltage = chargerVoltage;
        PreferOffPeak = preferOffPeak;
        CurrentSoc = currentSoc;
    }

    /// <summary>The in-scope vehicle id (web <c>vehicle_id</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }

    /// <summary>The target state-of-charge percent (web <c>target_soc</c>).</summary>
    [JsonPropertyName("target_soc")]
    public double TargetSoc { get; }

    /// <summary>The normalized ISO-8601 departure timestamp (web <c>depart_by</c>).</summary>
    [JsonPropertyName("depart_by")]
    public string DepartBy { get; }

    /// <summary>The selected rate plan id (web <c>rate_plan_id</c>).</summary>
    [JsonPropertyName("rate_plan_id")]
    public string RatePlanId { get; }

    /// <summary>The charge current limit in amps (web <c>max_amps</c>).</summary>
    [JsonPropertyName("max_amps")]
    public double MaxAmps { get; }

    /// <summary>The usable battery capacity in kWh (web <c>battery_capacity_kwh</c>).</summary>
    [JsonPropertyName("battery_capacity_kwh")]
    public double BatteryCapacityKwh { get; }

    /// <summary>The charger supply voltage (web <c>charger_voltage</c>).</summary>
    [JsonPropertyName("charger_voltage")]
    public double ChargerVoltage { get; }

    /// <summary>Whether to bias the plan toward off-peak windows (web <c>prefer_off_peak</c>).</summary>
    [JsonPropertyName("prefer_off_peak")]
    public bool PreferOffPeak { get; }

    /// <summary>The current state-of-charge percent (web <c>current_soc</c>).</summary>
    [JsonPropertyName("current_soc")]
    public double CurrentSoc { get; }

    /// <summary>
    /// Build the wire body from the host inputs, applying the web body's per-field defaults
    /// (web AISmartChargeScheduleSuggestion L46-L56). <paramref name="now"/> is the clock used to normalize
    /// <c>depart_by</c> (web <c>new Date()</c> at body-build time); injected so the normalization is
    /// deterministically testable.
    /// </summary>
    public static AiScheduleDraftRequest FromInputs(AiScheduleDraftInputs inputs, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(inputs);

        // web: vehicle_id: numericVehicleId || 0 — an unresolved / zero vehicle serializes as 0.
        var vehicleId = inputs.VehicleId.GetValueOrDefault();
        return new AiScheduleDraftRequest(
            vehicleId,
            inputs.TargetSoc ?? DefaultTargetSoc,
            NormalizeDepartBy(inputs.DepartBy, now),
            inputs.RatePlanId ?? string.Empty,
            inputs.MaxAmps ?? DefaultMaxAmps,
            inputs.BatteryCapacityKwh ?? DefaultBatteryCapacityKwh,
            inputs.ChargerVoltage ?? DefaultChargerVoltage,
            inputs.PreferOffPeak ?? true,
            inputs.CurrentSoc ?? DefaultCurrentSoc);
    }

    /// <summary>
    /// Normalize a requested departure to an ISO-8601 UTC timestamp — the native port of the web body's
    /// <c>departIso</c> IIFE (web AISmartChargeScheduleSuggestion L41-L45): an empty / unparseable value falls
    /// back to <paramref name="now"/>, otherwise the parsed instant is emitted. Offset-less datetime-local
    /// strings are interpreted as local time then converted to UTC, mirroring the web's <c>new Date(departBy)</c>.
    /// </summary>
    public static string NormalizeDepartBy(string? departBy, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(departBy))
        {
            return ToIso(now);
        }

        return DateTimeOffset.TryParse(
            departBy,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeLocal,
            out var parsed)
            ? ToIso(parsed)
            : ToIso(now);
    }

    private static string ToIso(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiScheduleStreamEvent"/>s — the native port of the
/// web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). UI-free + allocation-light so it is
/// unit-tested without a host.
/// </summary>
public static class AiScheduleSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiScheduleStreamEvent? ParseFrame(string rawFrame)
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

    private static AiScheduleStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? AiScheduleStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiScheduleStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                return HasString(data, "id") && HasString(data, "name") &&
                       data.TryGetProperty("ok", out var ok) &&
                       (ok.ValueKind == JsonValueKind.True || ok.ValueKind == JsonValueKind.False)
                    ? AiScheduleStreamEvent.ToolResult()
                    : null;

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiScheduleStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiScheduleStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiScheduleStreamEvent.Error(message, AiScheduleErrorReason.Stream);

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
/// PII-safe diagnostics for the smart-charge schedule-suggestion surface (P1/S11 diagnostics contract). The
/// streamed draft is arbitrary user-facing prose grounded in the vehicle's rate plan and departure, and the
/// request body carries home/work-tagged context, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never the draft content, the vehicle id, the
/// rate plan, or any schedule input. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AISmartChargeScheduleSuggestionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AISmartChargeScheduleSuggestionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AISmartChargeScheduleSuggestion</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AISmartChargeScheduleSuggestionRegistration.Slug}"));
    }
}
