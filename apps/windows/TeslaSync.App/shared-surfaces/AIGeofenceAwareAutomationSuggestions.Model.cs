using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the geofence-aware automation-suggestions surface — the native mirror of
/// the web <c>AIGeofenceAwareAutomationSuggestions</c>
/// (web/src/components/ai/AIGeofenceAwareAutomationSuggestions.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/geofences/automations/draft</c> through <c>useAiStream</c>, captures a typed
/// <c>draft_automation_graph</c> tool envelope, and surfaces an "Apply to form" propose-only action; this
/// metadata carries the same feature id, endpoint, render-contract i18n keys and the off-mode test id so the
/// native surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix
/// the WinUI resource bridge expects, and resolves against the English fallback headlessly. UI-free so it is
/// asserted without a XAML host.
/// </summary>
public static class AIGeofenceAwareAutomationSuggestionsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIGeofenceAwareAutomationSuggestions";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('geofence-aware-automation-suggestions', ...)</c>).</summary>
    public const string FeatureId = "geofence-aware-automation-suggestions";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-geofence-aware-automation-suggestions-root"</c> the AI-off invariant test
    /// asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-geofence-aware-automation-suggestions-root";

    /// <summary>
    /// The SSE endpoint the draft streams from (web <c>useAiStream({ url: '/ai/geofences/automations/draft' })</c>;
    /// the client adds the <c>/api/v1</c> prefix once). The vehicle scope + prompt flow through the JSON body,
    /// not the URL — the backend route carries no path parameter.
    /// </summary>
    public const string DraftPath = "/ai/geofences/automations/draft";

    /// <summary>The name of the tool whose typed result envelope carries the proposed automation graph.</summary>
    public const string DraftToolName = "draft_automation_graph";

    /// <summary>i18n key for the card title (web <c>automations.builder.aiGeofenceAware.title</c>).</summary>
    public const string TitleKey = "translation.automations.builder.aiGeofenceAware.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Suggest a geofence-aware automation";

    /// <summary>i18n key for the card description (web <c>automations.builder.aiGeofenceAware.description</c>).</summary>
    public const string DescriptionKey = "translation.automations.builder.aiGeofenceAware.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Describe an automation that uses one of your existing geofences. Helix proposes a typed graph " +
        "anchored to a place_id you already have \u2014 review and apply to the form below before saving.";

    /// <summary>i18n key for the per-feature action verb (web <c>automations.builder.aiGeofenceAware.suggestButton</c>).</summary>
    public const string SuggestButtonKey = "translation.automations.builder.aiGeofenceAware.suggestButton";

    /// <summary>English fallback for <see cref="SuggestButtonKey"/> (web second arg).</summary>
    public const string SuggestButtonFallback = "Suggest automation";

    /// <summary>i18n key for the badge text (web <c>automations.builder.aiGeofenceAware.badge</c>).</summary>
    public const string BadgeKey = "translation.automations.builder.aiGeofenceAware.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the prompt placeholder (web <c>automations.builder.aiGeofenceAware.placeholder</c>).</summary>
    public const string PlaceholderKey = "translation.automations.builder.aiGeofenceAware.placeholder";

    /// <summary>English fallback for <see cref="PlaceholderKey"/> (web second arg, verbatim).</summary>
    public const string PlaceholderFallback =
        "e.g. when I arrive home on a weekday after sunset, turn on cabin overheat protection";

    /// <summary>i18n key for the captured-proposal heading (web <c>automations.builder.aiGeofenceAware.proposalLabel</c>).</summary>
    public const string ProposalLabelKey = "translation.automations.builder.aiGeofenceAware.proposalLabel";

    /// <summary>English fallback for <see cref="ProposalLabelKey"/> (web second arg).</summary>
    public const string ProposalLabelFallback = "Proposed automation";

    /// <summary>i18n key for the unnamed-automation fallback (web <c>automations.builder.aiGeofenceAware.unnamed</c>).</summary>
    public const string UnnamedKey = "translation.automations.builder.aiGeofenceAware.unnamed";

    /// <summary>English fallback for <see cref="UnnamedKey"/> (web second arg).</summary>
    public const string UnnamedFallback = "(unnamed)";

    /// <summary>i18n key for the triggers count label (web <c>automations.builder.aiGeofenceAware.triggersLabel</c>).</summary>
    public const string TriggersLabelKey = "translation.automations.builder.aiGeofenceAware.triggersLabel";

    /// <summary>English fallback for <see cref="TriggersLabelKey"/> (web second arg).</summary>
    public const string TriggersLabelFallback = "Triggers";

    /// <summary>i18n key for the conditions count label (web <c>automations.builder.aiGeofenceAware.conditionsLabel</c>).</summary>
    public const string ConditionsLabelKey = "translation.automations.builder.aiGeofenceAware.conditionsLabel";

    /// <summary>English fallback for <see cref="ConditionsLabelKey"/> (web second arg).</summary>
    public const string ConditionsLabelFallback = "Conditions";

    /// <summary>i18n key for the actions count label (web <c>automations.builder.aiGeofenceAware.actionsLabel</c>).</summary>
    public const string ActionsLabelKey = "translation.automations.builder.aiGeofenceAware.actionsLabel";

    /// <summary>English fallback for <see cref="ActionsLabelKey"/> (web second arg).</summary>
    public const string ActionsLabelFallback = "Actions";

    /// <summary>i18n key for the validator-rejected message (web <c>automations.builder.aiGeofenceAware.rejectedLabel</c>).</summary>
    public const string RejectedLabelKey = "translation.automations.builder.aiGeofenceAware.rejectedLabel";

    /// <summary>English fallback for <see cref="RejectedLabelKey"/> (web second arg).</summary>
    public const string RejectedLabelFallback = "Proposal rejected by validator";

    /// <summary>i18n key for the apply-to-form action (web <c>automations.builder.aiGeofenceAware.applyButton</c>).</summary>
    public const string ApplyButtonKey = "translation.automations.builder.aiGeofenceAware.applyButton";

    /// <summary>English fallback for <see cref="ApplyButtonKey"/> (web second arg).</summary>
    public const string ApplyButtonFallback = "Apply to form";

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
public enum AiAutomationDraftStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiAutomationDraftStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiAutomationDraftEventKind
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
/// Why a draft stream ended in <see cref="AiAutomationDraftEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiAutomationDraftErrorReason
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
/// narration surface this one CAPTURES the <c>tool_result</c> payload (the typed <c>draft_automation_graph</c>
/// envelope) so the view can surface a proposal. <c>tool_call</c> / <c>confirm_request</c> frames are parsed
/// for parity but carry no payload here. Pure data, so the parser and the view-model state machine are
/// unit-tested headlessly.
/// </summary>
public sealed class AiAutomationDraftStreamEvent
{
    private AiAutomationDraftStreamEvent(
        AiAutomationDraftEventKind kind,
        string text,
        string toolName,
        bool toolOk,
        JsonElement? toolData,
        string message,
        AiAutomationDraftErrorReason errorReason)
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
    public AiAutomationDraftEventKind Kind { get; }

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

    /// <summary>The classified error reason; meaningful only for <see cref="AiAutomationDraftEventKind.Error"/>.</summary>
    public AiAutomationDraftErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiAutomationDraftStreamEvent Delta(string text) =>
        new(AiAutomationDraftEventKind.Delta, text ?? string.Empty, string.Empty, false, null, string.Empty, AiAutomationDraftErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiAutomationDraftStreamEvent ToolCall() =>
        new(AiAutomationDraftEventKind.ToolCall, string.Empty, string.Empty, false, null, string.Empty, AiAutomationDraftErrorReason.Unknown);

    /// <summary>A tool-result frame carrying the tool name, its success flag and (when present) its typed data payload.</summary>
    public static AiAutomationDraftStreamEvent ToolResult(string name, bool ok, JsonElement? data) =>
        new(AiAutomationDraftEventKind.ToolResult, string.Empty, name ?? string.Empty, ok, data, string.Empty, AiAutomationDraftErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiAutomationDraftStreamEvent ConfirmRequest() =>
        new(AiAutomationDraftEventKind.ConfirmRequest, string.Empty, string.Empty, false, null, string.Empty, AiAutomationDraftErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiAutomationDraftStreamEvent Done() =>
        new(AiAutomationDraftEventKind.Done, string.Empty, string.Empty, false, null, string.Empty, AiAutomationDraftErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiAutomationDraftStreamEvent Error(string message, AiAutomationDraftErrorReason reason) =>
        new(AiAutomationDraftEventKind.Error, string.Empty, string.Empty, false, null, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the draft endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ vehicle_id, prompt }</c> (web AIGeofenceAwareAutomationSuggestions L120-L123). The backend reads both
/// from the body (the route carries no path parameter); the explicit
/// <see cref="JsonPropertyNameAttribute"/> pins the snake_case wire names regardless of the serializer policy.
/// </summary>
public sealed class AiAutomationDraftRequest
{
    /// <summary>Creates the request body for the given in-scope vehicle and free-form prompt.</summary>
    public AiAutomationDraftRequest(long vehicleId, string prompt)
    {
        VehicleId = vehicleId;
        Prompt = prompt ?? string.Empty;
    }

    /// <summary>The in-scope vehicle id (web <c>vehicle_id</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }

    /// <summary>The free-form natural-language prompt (web <c>prompt</c>).</summary>
    [JsonPropertyName("prompt")]
    public string Prompt { get; }
}

/// <summary>
/// The proposed automation graph the LLM produced — the native projection of the web
/// <c>AutomationFullInput</c> the <c>draft_automation_graph</c> tool returns
/// (web/src/api/hooks/useAutomations.ts L24-L32). The view reads the scalar fields + the trigger/condition/
/// action counts; the raw step arrays are preserved so the propose-only "Apply to form" handoff can replay the
/// canonical wire shape into the baseline form (the native analogue of the web <c>onApplyDraft</c> callback).
/// Pure data, validated by <see cref="GeofenceAutomationDraft.TryParse"/>.
/// </summary>
public sealed class GeofenceAutomationGraph
{
    /// <summary>Creates the graph projection from its validated parts.</summary>
    public GeofenceAutomationGraph(
        string name,
        string description,
        long vehicleId,
        bool enabled,
        IReadOnlyList<JsonElement> triggers,
        IReadOnlyList<JsonElement> conditions,
        IReadOnlyList<JsonElement> actions)
    {
        Name = name ?? string.Empty;
        Description = description ?? string.Empty;
        VehicleId = vehicleId;
        Enabled = enabled;
        Triggers = triggers ?? Array.Empty<JsonElement>();
        Conditions = conditions ?? Array.Empty<JsonElement>();
        Actions = actions ?? Array.Empty<JsonElement>();
    }

    /// <summary>The proposed automation name (web <c>draft.name</c>).</summary>
    public string Name { get; }

    /// <summary>The proposed description (web <c>draft.description</c>); empty when omitted.</summary>
    public string Description { get; }

    /// <summary>The vehicle the proposal is anchored to (web <c>draft.vehicle_id</c>).</summary>
    public long VehicleId { get; }

    /// <summary>Whether the proposal would be enabled on save (web <c>draft.enabled</c>).</summary>
    public bool Enabled { get; }

    /// <summary>The proposed trigger steps, preserved for the apply handoff (web <c>draft.triggers</c>).</summary>
    public IReadOnlyList<JsonElement> Triggers { get; }

    /// <summary>The proposed condition steps, preserved for the apply handoff (web <c>draft.conditions</c>).</summary>
    public IReadOnlyList<JsonElement> Conditions { get; }

    /// <summary>The proposed action steps, preserved for the apply handoff (web <c>draft.actions</c>).</summary>
    public IReadOnlyList<JsonElement> Actions { get; }
}

/// <summary>
/// A captured proposal — the native port of the web <c>AutomationDraft</c> envelope
/// (web AIGeofenceAwareAutomationSuggestions L43-L47): the typed <see cref="Graph"/>, the validator
/// <see cref="Status"/> (<c>'ok'</c> enables the apply action), and an optional human-readable
/// <see cref="ValidationError"/>. Built only by <see cref="TryParse"/>, which mirrors the web
/// <c>normalizeAutomationInput</c> defence-in-depth narrowing so a malformed envelope never corrupts the form.
/// </summary>
public sealed class GeofenceAutomationDraft
{
    private const string OkStatus = "ok";

    private GeofenceAutomationDraft(GeofenceAutomationGraph graph, string status, string? validationError)
    {
        Graph = graph;
        Status = status;
        ValidationError = validationError;
    }

    /// <summary>The proposed automation graph.</summary>
    public GeofenceAutomationGraph Graph { get; }

    /// <summary>The validator status (web <c>status</c>); <c>'ok'</c> or an error discriminator.</summary>
    public string Status { get; }

    /// <summary>The optional human-readable validation error (web <c>validation_error</c>).</summary>
    public string? ValidationError { get; }

    /// <summary>True when the validator accepted the proposal (web <c>draft.status === 'ok'</c>); gates the apply action.</summary>
    public bool IsOk => string.Equals(Status, OkStatus, StringComparison.Ordinal);

    /// <summary>
    /// Parse the <c>draft_automation_graph</c> tool's typed envelope (web <c>{ draft, status, validation_error }</c>)
    /// into a captured proposal, or return <see langword="false"/> when the wire shape cannot be positively
    /// proven — the native port of the web <c>handleEvent</c> guard + <c>normalizeAutomationInput</c>. Anything
    /// we cannot prove (missing status, malformed graph) is rejected so a bad draft never reaches the form.
    /// </summary>
    public static bool TryParse(JsonElement envelope, out GeofenceAutomationDraft? draft)
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

        if (!envelope.TryGetProperty("draft", out var draftEl) ||
            !TryNormalizeGraph(draftEl, out var graph) || graph is null)
        {
            return false;
        }

        string? validationError = null;
        if (envelope.TryGetProperty("validation_error", out var veEl) && veEl.ValueKind == JsonValueKind.String)
        {
            validationError = veEl.GetString();
        }

        draft = new GeofenceAutomationDraft(graph, statusEl.GetString() ?? string.Empty, validationError);
        return true;
    }

    private static bool TryNormalizeGraph(JsonElement value, out GeofenceAutomationGraph? graph)
    {
        graph = null;
        if (value.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!TryGetString(value, "name", out var name) ||
            !value.TryGetProperty("vehicle_id", out var vehicleEl) ||
            vehicleEl.ValueKind != JsonValueKind.Number ||
            !vehicleEl.TryGetInt64(out var vehicleId) ||
            !value.TryGetProperty("enabled", out var enabledEl) ||
            (enabledEl.ValueKind != JsonValueKind.True && enabledEl.ValueKind != JsonValueKind.False) ||
            !TryGetArray(value, "triggers", out var triggers) ||
            !TryGetArray(value, "conditions", out var conditions) ||
            !TryGetArray(value, "actions", out var actions))
        {
            return false;
        }

        var description = TryGetString(value, "description", out var d) ? d : string.Empty;
        graph = new GeofenceAutomationGraph(
            name,
            description,
            vehicleId,
            enabledEl.ValueKind == JsonValueKind.True,
            triggers,
            conditions,
            actions);
        return true;
    }

    private static bool TryGetArray(JsonElement obj, string name, out IReadOnlyList<JsonElement> items)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Array)
        {
            var list = new List<JsonElement>(prop.GetArrayLength());
            foreach (var item in prop.EnumerateArray())
            {
                list.Add(item.Clone());
            }

            items = list;
            return true;
        }

        items = Array.Empty<JsonElement>();
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
/// Parses the backend SSE wire format into typed <see cref="AiAutomationDraftStreamEvent"/>s — the native port
/// of the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). Crucially the <c>tool_result</c> branch
/// preserves the <c>data</c> payload so the view can capture the proposed automation. UI-free + allocation-
/// light so it is unit-tested without a host.
/// </summary>
public static class AiAutomationDraftSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port
    /// of the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiAutomationDraftStreamEvent? ParseFrame(string rawFrame)
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

    private static AiAutomationDraftStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? AiAutomationDraftStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiAutomationDraftStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !TryGetString(data, "name", out var toolName) ||
                    !data.TryGetProperty("ok", out var okEl) ||
                    (okEl.ValueKind != JsonValueKind.True && okEl.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                JsonElement? toolData = data.TryGetProperty("data", out var dataEl) ? dataEl.Clone() : null;
                return AiAutomationDraftStreamEvent.ToolResult(toolName, okEl.ValueKind == JsonValueKind.True, toolData);

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiAutomationDraftStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiAutomationDraftStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiAutomationDraftStreamEvent.Error(message, AiAutomationDraftErrorReason.Stream);

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
/// PII-safe diagnostics for the geofence-aware automation-suggestions surface (P1/S11 diagnostics contract).
/// The proposed automation references the user's vehicle + geofence place ids through a typed envelope, so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never
/// the prompt text, the proposed graph, the vehicle id, or any place id. Thread-safe; mirrors the shipped
/// surfaces' collectors.
/// </summary>
public sealed class AIGeofenceAwareAutomationSuggestionsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AIGeofenceAwareAutomationSuggestionsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIGeofenceAwareAutomationSuggestions</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AIGeofenceAwareAutomationSuggestionsRegistration.Slug}"));
    }
}
