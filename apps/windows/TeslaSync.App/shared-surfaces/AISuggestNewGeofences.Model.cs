using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the suggest-new-geofences surface — the native mirror of the web
/// <c>AISuggestNewGeofences</c> (web/src/components/ai/AISuggestNewGeofences.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/geofences/draft</c> through <c>useAiStream</c>, captures a typed <c>draft_geofence</c>
/// tool envelope, and surfaces a propose-only "Apply to form" action; this metadata carries the same feature
/// id, endpoint, render-contract i18n keys and the off-mode test id so the native surface reproduces the web
/// copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge expects,
/// and resolves against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AISuggestNewGeofencesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AISuggestNewGeofences";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('suggest-new-geofences', ...)</c>).</summary>
    public const string FeatureId = "suggest-new-geofences";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-suggest-new-geofences-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-suggest-new-geofences-root";

    /// <summary>
    /// The SSE endpoint the draft streams from (web <c>useAiStream({ url: '/ai/geofences/draft' })</c>; the
    /// client adds the <c>/api/v1</c> prefix once). The location scope flows through the JSON body, not the
    /// URL — the backend route carries no path parameter.
    /// </summary>
    public const string DraftPath = "/ai/geofences/draft";

    /// <summary>The name of the tool whose typed result envelope carries the proposed geofence draft.</summary>
    public const string DraftToolName = "draft_geofence";

    /// <summary>i18n key for the card title (web <c>geofences.aiSuggest.title</c>).</summary>
    public const string TitleKey = "translation.geofences.aiSuggest.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Suggest a geofence for this location";

    /// <summary>i18n key for the card description (web <c>geofences.aiSuggest.description</c>).</summary>
    public const string DescriptionKey = "translation.geofences.aiSuggest.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Propose a typed geofence draft (centroid, radius, and name) for this visited location based on its " +
        "visit pattern. Review only \u2014 Helix never saves the geofence; you confirm and save via the " +
        "existing baseline Add Geofence form.";

    /// <summary>i18n key for the per-feature action verb (web <c>geofences.aiSuggest.suggestButton</c>).</summary>
    public const string SuggestButtonKey = "translation.geofences.aiSuggest.suggestButton";

    /// <summary>English fallback for <see cref="SuggestButtonKey"/> (web second arg).</summary>
    public const string SuggestButtonFallback = "Suggest geofence";

    /// <summary>i18n key for the badge text (web <c>geofences.aiSuggest.badge</c>).</summary>
    public const string BadgeKey = "translation.geofences.aiSuggest.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the current-label context line (web <c>geofences.aiSuggest.currentLabel</c>).</summary>
    public const string CurrentLabelKey = "translation.geofences.aiSuggest.currentLabel";

    /// <summary>English fallback for <see cref="CurrentLabelKey"/> (web second arg).</summary>
    public const string CurrentLabelFallback = "Current label";

    /// <summary>i18n key for the captured-proposal heading (web <c>geofences.aiSuggest.proposalLabel</c>).</summary>
    public const string ProposalLabelKey = "translation.geofences.aiSuggest.proposalLabel";

    /// <summary>English fallback for <see cref="ProposalLabelKey"/> (web second arg).</summary>
    public const string ProposalLabelFallback = "Proposed geofence";

    /// <summary>i18n key for the radius label (web <c>geofences.aiSuggest.radiusLabel</c>).</summary>
    public const string RadiusLabelKey = "translation.geofences.aiSuggest.radiusLabel";

    /// <summary>English fallback for <see cref="RadiusLabelKey"/> (web second arg).</summary>
    public const string RadiusLabelFallback = "Radius";

    /// <summary>i18n key for the validator-rejected message (web <c>geofences.aiSuggest.rejectedLabel</c>).</summary>
    public const string RejectedLabelKey = "translation.geofences.aiSuggest.rejectedLabel";

    /// <summary>English fallback for <see cref="RejectedLabelKey"/> (web second arg).</summary>
    public const string RejectedLabelFallback = "Proposal rejected by validator";

    /// <summary>i18n key for the apply-to-form action (web <c>geofences.aiSuggest.applyButton</c>).</summary>
    public const string ApplyButtonKey = "translation.geofences.aiSuggest.applyButton";

    /// <summary>English fallback for <see cref="ApplyButtonKey"/> (web second arg).</summary>
    public const string ApplyButtonFallback = "Apply to form";

    /// <summary>i18n key for the universal Helix CTA label (shared AIFeatureCard <c>helix.askHelix</c>).</summary>
    public const string AskHelixKey = "translation.helix.askHelix";

    /// <summary>English fallback for <see cref="AskHelixKey"/>.</summary>
    public const string AskHelixFallback = "Ask Helix";

    /// <summary>i18n key for the streaming button label (shared AIFeatureCard <c>helix.thinking</c>).</summary>
    public const string ThinkingKey = "translation.helix.thinking";

    /// <summary>English fallback for <see cref="ThinkingKey"/>.</summary>
    public const string ThinkingFallback = "Helix is thinking\u2026";

    /// <summary>i18n key for the inline error label (shared AiOutputPanel <c>helix.errorLabel</c>).</summary>
    public const string ErrorLabelKey = "translation.helix.errorLabel";

    /// <summary>English fallback for <see cref="ErrorLabelKey"/>.</summary>
    public const string ErrorLabelFallback = "Helix error:";

    /// <summary>i18n key for the unknown-error fallback token (shared <c>ai.common.errorUnknown</c>).</summary>
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
/// tool-confirmation (the draft endpoint does not use it, but the union is reproduced for parity and to keep
/// <c>canStart</c> honest), <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiGeofenceDraftStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiGeofenceDraftStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiGeofenceDraftEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); this surface ignores the payload.</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); the draft tool's typed envelope is captured.</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a draft stream ended in <see cref="AiGeofenceDraftEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiGeofenceDraftErrorReason
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
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this draft surface consumes. Unlike a
/// narration surface this one CAPTURES the <c>tool_result</c> payload (the typed <c>draft_geofence</c>
/// envelope) so the view can surface a proposal. <c>tool_call</c> / <c>confirm_request</c> frames are parsed
/// for parity but carry no payload here. Pure data, so the parser and the view-model state machine are
/// unit-tested headlessly.
/// </summary>
public sealed class AiGeofenceDraftStreamEvent
{
    private AiGeofenceDraftStreamEvent(
        AiGeofenceDraftEventKind kind,
        string text,
        string toolName,
        bool toolOk,
        JsonElement? toolData,
        string message,
        AiGeofenceDraftErrorReason errorReason)
    {
        Kind = kind;
        Text = text;
        ToolName = toolName;
        ToolOk = toolOk;
        ToolData = toolData;
        Message = message;
        ErrorReason = errorReason;
    }

    /// <summary>The event discriminator (web <c>type</c>).</summary>
    public AiGeofenceDraftEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The tool name (web <c>tool_result.name</c>); empty for non-tool events.</summary>
    public string ToolName { get; }

    /// <summary>Whether the tool succeeded (web <c>tool_result.ok</c>); meaningful only for tool-result events.</summary>
    public bool ToolOk { get; }

    /// <summary>The tool's <c>data</c> payload (web <c>tool_result.data</c>); present only for a successful tool result.</summary>
    public JsonElement? ToolData { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="AiGeofenceDraftEventKind.Error"/>.</summary>
    public AiGeofenceDraftErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiGeofenceDraftStreamEvent Delta(string text) =>
        new(AiGeofenceDraftEventKind.Delta, text ?? string.Empty, string.Empty, false, null, string.Empty, AiGeofenceDraftErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiGeofenceDraftStreamEvent ToolCall() =>
        new(AiGeofenceDraftEventKind.ToolCall, string.Empty, string.Empty, false, null, string.Empty, AiGeofenceDraftErrorReason.Unknown);

    /// <summary>A tool-result frame carrying the tool name, its success flag and (when present) its typed data payload.</summary>
    public static AiGeofenceDraftStreamEvent ToolResult(string name, bool ok, JsonElement? data) =>
        new(AiGeofenceDraftEventKind.ToolResult, string.Empty, name ?? string.Empty, ok, data, string.Empty, AiGeofenceDraftErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiGeofenceDraftStreamEvent ConfirmRequest() =>
        new(AiGeofenceDraftEventKind.ConfirmRequest, string.Empty, string.Empty, false, null, string.Empty, AiGeofenceDraftErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiGeofenceDraftStreamEvent Done() =>
        new(AiGeofenceDraftEventKind.Done, string.Empty, string.Empty, false, null, string.Empty, AiGeofenceDraftErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiGeofenceDraftStreamEvent Error(string message, AiGeofenceDraftErrorReason reason) =>
        new(AiGeofenceDraftEventKind.Error, string.Empty, string.Empty, false, null, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the draft endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ location_id }</c> (web AISuggestNewGeofences L93-L96). The backend reads the location scope from the
/// body (the route carries no path parameter); the explicit <see cref="JsonPropertyNameAttribute"/> pins the
/// snake_case wire name regardless of the serializer policy.
/// </summary>
public sealed class AiGeofenceDraftRequest
{
    /// <summary>Creates the request body for the given visited-location id.</summary>
    public AiGeofenceDraftRequest(long locationId) => LocationId = locationId;

    /// <summary>The visited-location synthetic id (web <c>location_id</c>).</summary>
    [JsonPropertyName("location_id")]
    public long LocationId { get; }
}

/// <summary>
/// A captured proposal — the native port of the web <c>GeofenceDraft</c> envelope
/// (web AISuggestNewGeofences L39-L48): the proposed name + radius + centroid the LLM produced, the validator
/// <see cref="Status"/> (<c>'ok'</c> enables the apply action), and an optional human-readable
/// <see cref="ValidationError"/>. Built only by <see cref="TryParse"/>, which mirrors the web
/// <c>handleEvent</c> guard's defence-in-depth narrowing so a malformed envelope never corrupts the form.
/// </summary>
public sealed class GeofenceDraft
{
    private const string OkStatus = "ok";

    private GeofenceDraft(
        long locationId,
        long vehicleId,
        string proposedName,
        double radiusMeters,
        double centroidLat,
        double centroidLon,
        string status,
        string? validationError)
    {
        LocationId = locationId;
        VehicleId = vehicleId;
        ProposedName = proposedName;
        RadiusMeters = radiusMeters;
        CentroidLat = centroidLat;
        CentroidLon = centroidLon;
        Status = status;
        ValidationError = validationError;
    }

    /// <summary>The visited-location id the proposal is anchored to (web <c>draft.location_id</c>).</summary>
    public long LocationId { get; }

    /// <summary>The vehicle the proposal references (web <c>draft.vehicle_id</c>).</summary>
    public long VehicleId { get; }

    /// <summary>The proposed geofence name (web <c>draft.proposed_name</c>).</summary>
    public string ProposedName { get; }

    /// <summary>The proposed radius in metres — SI on the wire, shown as metres (web <c>draft.radius_m</c>).</summary>
    public double RadiusMeters { get; }

    /// <summary>The proposed centroid latitude (web <c>draft.centroid_lat</c>).</summary>
    public double CentroidLat { get; }

    /// <summary>The proposed centroid longitude (web <c>draft.centroid_lon</c>).</summary>
    public double CentroidLon { get; }

    /// <summary>The validator status (web <c>status</c>); <c>'ok'</c> or an error discriminator.</summary>
    public string Status { get; }

    /// <summary>The optional human-readable validation error (web <c>validation_error</c>).</summary>
    public string? ValidationError { get; }

    /// <summary>True when the validator accepted the proposal (web <c>draft.status === 'ok'</c>); gates the apply action.</summary>
    public bool IsOk => string.Equals(Status, OkStatus, StringComparison.Ordinal);

    /// <summary>
    /// Project the accepted proposal into the baseline Add-Geofence form payload (web <c>onApplyDraft</c> arg
    /// <c>{ name, latitude, longitude, radius }</c>). The AI surface never writes — the parent copies this into
    /// the canonical form and the user saves via the baseline <c>POST /api/v1/geofences</c> path.
    /// </summary>
    public GeofenceDraftApplication ToApplication() =>
        new(ProposedName, CentroidLat, CentroidLon, RadiusMeters);

    /// <summary>
    /// Parse the <c>draft_geofence</c> tool's typed envelope (web <c>{ draft, status, validation_error }</c>)
    /// into a captured proposal, or return <see langword="false"/> when the wire shape cannot be positively
    /// proven — the native port of the web <c>handleEvent</c> guard. Anything we cannot prove (missing status,
    /// a non-numeric coordinate, a missing field) is rejected so a bad draft never reaches the form.
    /// </summary>
    public static bool TryParse(JsonElement envelope, out GeofenceDraft? draft)
    {
        draft = null;
        if (envelope.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!envelope.TryGetProperty("status", out var statusEl) || statusEl.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        if (!envelope.TryGetProperty("draft", out var inner) || inner.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!TryGetInt64(inner, "location_id", out var locationId) ||
            !TryGetInt64(inner, "vehicle_id", out var vehicleId) ||
            !TryGetString(inner, "proposed_name", out var proposedName) ||
            !TryGetDouble(inner, "radius_m", out var radiusMeters) ||
            !TryGetDouble(inner, "centroid_lat", out var centroidLat) ||
            !TryGetDouble(inner, "centroid_lon", out var centroidLon))
        {
            return false;
        }

        string? validationError = null;
        if (envelope.TryGetProperty("validation_error", out var veEl) && veEl.ValueKind == JsonValueKind.String)
        {
            validationError = veEl.GetString();
        }

        draft = new GeofenceDraft(
            locationId,
            vehicleId,
            proposedName,
            radiusMeters,
            centroidLat,
            centroidLon,
            statusEl.GetString() ?? string.Empty,
            validationError);
        return true;
    }

    private static bool TryGetInt64(JsonElement obj, string name, out long value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number &&
            prop.TryGetInt64(out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static bool TryGetDouble(JsonElement obj, string name, out double value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number &&
            prop.TryGetDouble(out value))
        {
            return true;
        }

        value = 0;
        return false;
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
}

/// <summary>
/// The propose-only payload handed to the parent's baseline form (web <c>onApplyDraft</c> arg). Carries the
/// proposed name, centroid latitude / longitude and radius (metres). The AI surface never persists — the
/// baseline Add-Geofence Save button remains the sole write path.
/// </summary>
/// <param name="Name">The proposed geofence name (web <c>name</c>).</param>
/// <param name="Latitude">The proposed centroid latitude (web <c>latitude</c>).</param>
/// <param name="Longitude">The proposed centroid longitude (web <c>longitude</c>).</param>
/// <param name="Radius">The proposed radius in metres (web <c>radius</c>).</param>
public readonly record struct GeofenceDraftApplication(string Name, double Latitude, double Longitude, double Radius);

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiGeofenceDraftStreamEvent"/>s — the native port
/// of the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). Crucially the <c>tool_result</c> branch
/// preserves the <c>data</c> payload so the view can capture the proposed geofence. UI-free + allocation-light
/// so it is unit-tested without a host.
/// </summary>
public static class AiGeofenceDraftSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port
    /// of the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiGeofenceDraftStreamEvent? ParseFrame(string rawFrame)
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

    private static AiGeofenceDraftStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? AiGeofenceDraftStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiGeofenceDraftStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !TryGetString(data, "name", out var toolName) ||
                    !data.TryGetProperty("ok", out var okEl) ||
                    (okEl.ValueKind != JsonValueKind.True && okEl.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                JsonElement? toolData = data.TryGetProperty("data", out var dataEl) ? dataEl.Clone() : null;
                return AiGeofenceDraftStreamEvent.ToolResult(toolName, okEl.ValueKind == JsonValueKind.True, toolData);

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiGeofenceDraftStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiGeofenceDraftStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiGeofenceDraftStreamEvent.Error(message, AiGeofenceDraftErrorReason.Stream);

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
/// PII-safe diagnostics for the suggest-new-geofences surface (P1/S11 diagnostics contract). The proposed
/// geofence references the user's visited-location id + centroid coordinates through a typed envelope, so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never
/// the location id, the coordinates, the radius, or the proposed name. Thread-safe; mirrors the shipped
/// surfaces' collectors.
/// </summary>
public sealed class AISuggestNewGeofencesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AISuggestNewGeofencesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AISuggestNewGeofences</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AISuggestNewGeofencesRegistration.Slug}"));
    }
}
