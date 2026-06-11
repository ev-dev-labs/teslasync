using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the signal-explorer natural-language filter surface — the native mirror of
/// the web <c>AISignalExplorerNlFilter</c> (web/src/components/ai/AISignalExplorerNlFilter.tsx) composed with its
/// shared <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c>
/// gate (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/signals/filter/draft</c> through <c>useAiStream</c>, captures the typed
/// <c>draft_signal_filter</c> tool envelope (a <c>SignalFilter</c> DTO — see
/// internal/ai/tools/nl/signal_filter.go) and surfaces a propose-only "Apply to filters" action; this metadata
/// carries the same feature id, endpoint, render-contract i18n keys and the off-mode test id so the native
/// surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI
/// resource bridge expects, and resolves against the English fallback headlessly. UI-free so it is asserted
/// without a XAML host.
/// </summary>
public static class AISignalExplorerNlFilterRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AISignalExplorerNlFilter";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('signal-explorer-nl-filter', ...)</c>).</summary>
    public const string FeatureId = "signal-explorer-nl-filter";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-signal-explorer-nl-filter-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-signal-explorer-nl-filter-root";

    /// <summary>
    /// The SSE endpoint the draft streams from (web <c>useAiStream({ url: '/ai/signals/filter/draft' })</c>; the
    /// client adds the <c>/api/v1</c> prefix once). The vehicle id + prompt flow through the JSON body, not the URL.
    /// </summary>
    public const string DraftPath = "/ai/signals/filter/draft";

    /// <summary>The name of the tool whose typed result envelope carries the proposed signal filter draft.</summary>
    public const string DraftToolName = "draft_signal_filter";

    /// <summary>i18n key for the card title (web <c>signalExplorer.aiFilter.title</c>).</summary>
    public const string TitleKey = "translation.signalExplorer.aiFilter.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Helix natural-language filter";

    /// <summary>i18n key for the card description (web <c>signalExplorer.aiFilter.description</c>).</summary>
    public const string DescriptionKey = "translation.signalExplorer.aiFilter.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Describe the filter in plain English (e.g. \"battery level for yesterday\"). The LLM proposes a typed " +
        "filter you can apply with one click; it never edits the form directly.";

    /// <summary>i18n key for the per-feature action verb (web <c>signalExplorer.aiFilter.button</c>).</summary>
    public const string DraftButtonKey = "translation.signalExplorer.aiFilter.button";

    /// <summary>English fallback for <see cref="DraftButtonKey"/> (web second arg).</summary>
    public const string DraftButtonFallback = "Draft filter";

    /// <summary>i18n key for the badge text (web <c>signalExplorer.aiFilter.badge</c>).</summary>
    public const string BadgeKey = "translation.signalExplorer.aiFilter.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the prompt placeholder (web <c>signalExplorer.aiFilter.promptPlaceholder</c>).</summary>
    public const string PromptPlaceholderKey = "translation.signalExplorer.aiFilter.promptPlaceholder";

    /// <summary>English fallback for <see cref="PromptPlaceholderKey"/> (web second arg).</summary>
    public const string PromptPlaceholderFallback = "e.g. show me battery level for yesterday";

    /// <summary>i18n key for the prompt accessible name (web <c>signalExplorer.aiFilter.promptLabel</c>).</summary>
    public const string PromptLabelKey = "translation.signalExplorer.aiFilter.promptLabel";

    /// <summary>English fallback for <see cref="PromptLabelKey"/> (web second arg).</summary>
    public const string PromptLabelFallback = "Filter request";

    /// <summary>i18n key for the apply-to-filters action (web <c>signalExplorer.aiFilter.applyButton</c>).</summary>
    public const string ApplyButtonKey = "translation.signalExplorer.aiFilter.applyButton";

    /// <summary>English fallback for <see cref="ApplyButtonKey"/> (web second arg).</summary>
    public const string ApplyButtonFallback = "Apply to filters";

    /// <summary>i18n key for the apply tooltip (web <c>signalExplorer.aiFilter.applyTooltip</c>).</summary>
    public const string ApplyTooltipKey = "translation.signalExplorer.aiFilter.applyTooltip";

    /// <summary>English fallback for <see cref="ApplyTooltipKey"/> (web second arg, verbatim).</summary>
    public const string ApplyTooltipFallback =
        "Copy the proposed filter into the form above. You can still edit it before clicking Explore.";

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
}

/// <summary>
/// The user-facing stream lifecycle — the native port of the web <c>AiStreamState</c>
/// (web/src/hooks/useAiStream.ts). <see cref="Idle"/> before the first run (and after a cancel),
/// <see cref="Streaming"/> while the SSE is open, <see cref="PausedConfirm"/> when the server requests a
/// tool-confirmation (the propose-only filter endpoint never triggers it, but the union is reproduced for
/// parity), <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiSignalFilterDraftStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiSignalFilterDraftStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiSignalFilterDraftEventKind
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
/// Why a draft stream ended in <see cref="AiSignalFilterDraftEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-aware
/// offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiSignalFilterDraftErrorReason
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
/// (web/src/hooks/useAiStream.ts), narrowed to the fields this draft surface consumes. Unlike a narration
/// surface this one CAPTURES the <c>tool_result</c> payload (the typed <c>draft_signal_filter</c> envelope) so
/// the view can surface a proposal. <c>tool_call</c> / <c>confirm_request</c> frames are parsed for parity but
/// carry no payload here. Pure data, so the parser and the view-model state machine are unit-tested headlessly.
/// </summary>
public sealed class AiSignalFilterDraftStreamEvent
{
    private AiSignalFilterDraftStreamEvent(
        AiSignalFilterDraftEventKind kind,
        string text,
        string toolName,
        bool toolOk,
        JsonElement? toolData,
        string message,
        AiSignalFilterDraftErrorReason errorReason)
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
    public AiSignalFilterDraftEventKind Kind { get; }

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

    /// <summary>The classified error reason; meaningful only for <see cref="AiSignalFilterDraftEventKind.Error"/>.</summary>
    public AiSignalFilterDraftErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiSignalFilterDraftStreamEvent Delta(string text) =>
        new(AiSignalFilterDraftEventKind.Delta, text ?? string.Empty, string.Empty, false, null, string.Empty, AiSignalFilterDraftErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiSignalFilterDraftStreamEvent ToolCall() =>
        new(AiSignalFilterDraftEventKind.ToolCall, string.Empty, string.Empty, false, null, string.Empty, AiSignalFilterDraftErrorReason.Unknown);

    /// <summary>A tool-result frame carrying the tool name, its success flag and (when present) its typed data payload.</summary>
    public static AiSignalFilterDraftStreamEvent ToolResult(string name, bool ok, JsonElement? data) =>
        new(AiSignalFilterDraftEventKind.ToolResult, string.Empty, name ?? string.Empty, ok, data, string.Empty, AiSignalFilterDraftErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiSignalFilterDraftStreamEvent ConfirmRequest() =>
        new(AiSignalFilterDraftEventKind.ConfirmRequest, string.Empty, string.Empty, false, null, string.Empty, AiSignalFilterDraftErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiSignalFilterDraftStreamEvent Done() =>
        new(AiSignalFilterDraftEventKind.Done, string.Empty, string.Empty, false, null, string.Empty, AiSignalFilterDraftErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiSignalFilterDraftStreamEvent Error(string message, AiSignalFilterDraftErrorReason reason) =>
        new(AiSignalFilterDraftEventKind.Error, string.Empty, string.Empty, false, null, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the draft endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ vehicle_id, prompt }</c> (web AISignalExplorerNlFilter). Unlike the Grafana drafter this surface is
/// vehicle-scoped: the server binds the per-vehicle signal catalog from this id and refuses any out-of-catalog
/// proposal. The explicit <see cref="JsonPropertyNameAttribute"/>s pin the snake_case wire names regardless of
/// the serializer policy.
/// </summary>
public sealed class AiSignalFilterDraftRequest
{
    /// <summary>Creates the request body for the in-scope vehicle and free-form prompt.</summary>
    public AiSignalFilterDraftRequest(long vehicleId, string prompt)
    {
        VehicleId = vehicleId;
        Prompt = prompt ?? string.Empty;
    }

    /// <summary>The in-scope vehicle id (web <c>vehicle_id: vehicleId</c>).</summary>
    [JsonPropertyName("vehicle_id")]
    public long VehicleId { get; }

    /// <summary>The free-form natural-language prompt (web <c>prompt</c>).</summary>
    [JsonPropertyName("prompt")]
    public string Prompt { get; }
}

/// <summary>
/// A captured signal-filter proposal — the native port of the web <c>SignalFilterDraft</c> (web
/// AISignalExplorerNlFilter) which mirrors the Go <c>SignalFilter</c> DTO
/// (internal/ai/tools/nl/signal_filter.go json tags): the in-scope <see cref="VehicleId"/>, the ordered
/// <see cref="Signals"/>, the <see cref="RangePreset"/> id and the <see cref="PerPage"/> page size. Built only by
/// <see cref="TryParse"/>, which mirrors the web <c>parseSignalFilterDraft</c> defence-in-depth narrowing
/// bit-for-bit — including the contract that ONLY a <c>status === 'ok'</c> envelope yields a draft (a rejected or
/// malformed envelope yields nothing, so a bad draft never reaches the form and the apply action stays hidden).
/// </summary>
public sealed class SignalFilterDraft
{
    private const string OkStatus = "ok";

    private SignalFilterDraft(long vehicleId, IReadOnlyList<string> signals, string rangePreset, int perPage)
    {
        VehicleId = vehicleId;
        Signals = signals;
        RangePreset = rangePreset;
        PerPage = perPage;
    }

    /// <summary>The in-scope vehicle id the filter applies to (web <c>draft.vehicle_id</c>; Go <c>VehicleID int64</c>).</summary>
    public long VehicleId { get; }

    /// <summary>The ordered list of signal names to plot (web <c>draft.signals</c>; Go <c>Signals []string</c>).</summary>
    public IReadOnlyList<string> Signals { get; }

    /// <summary>The range preset id (web <c>draft.range_preset</c>; Go <c>RangePreset string</c>).</summary>
    public string RangePreset { get; }

    /// <summary>The page-size option (web <c>draft.per_page</c>; Go <c>PerPage int</c>).</summary>
    public int PerPage { get; }

    /// <summary>
    /// Parse the <c>draft_signal_filter</c> tool's typed envelope (web <c>{ status, draft }</c>) into a captured
    /// proposal, or return <see langword="false"/> when the wire shape cannot be positively proven — the native
    /// port of the web <c>parseSignalFilterDraft</c>. Crucially this rejects any envelope whose
    /// <c>status !== 'ok'</c> (so the propose-only apply action only ever surfaces a validator-accepted filter)
    /// and any envelope missing or mistyping a required field: <c>draft.vehicle_id</c> (a number),
    /// <c>draft.signals</c> (an array in which EVERY element is a string — a single non-string element rejects
    /// the whole draft, web <c>.every</c>), <c>draft.range_preset</c> (a string) and <c>draft.per_page</c>
    /// (a number).
    /// </summary>
    public static bool TryParse(JsonElement envelope, out SignalFilterDraft? draft)
    {
        draft = null;
        if (envelope.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        // web: obj.status !== 'ok' → return null.
        if (!TryGetString(envelope, "status", out var status) || !string.Equals(status, OkStatus, StringComparison.Ordinal))
        {
            return false;
        }

        if (!envelope.TryGetProperty("draft", out var d) || d.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        // web: typeof d.vehicle_id !== 'number' → return null. The Go DTO types it int64, so a non-integer
        // number (which a vehicle id can never legitimately be) is refused here too.
        if (!TryGetInt64(d, "vehicle_id", out var vehicleId))
        {
            return false;
        }

        // web: !Array.isArray(d.signals) → return null; then .every(typeof === 'string') — a single non-string
        // element rejects the WHOLE draft (it is NOT filtered out).
        if (!d.TryGetProperty("signals", out var signalsEl) || signalsEl.ValueKind != JsonValueKind.Array ||
            !TryReadStringArray(signalsEl, out var signals))
        {
            return false;
        }

        // web: typeof d.range_preset !== 'string' → return null.
        if (!TryGetString(d, "range_preset", out var rangePreset))
        {
            return false;
        }

        // web: typeof d.per_page !== 'number' → return null. The Go DTO types it int.
        if (!TryGetInt32(d, "per_page", out var perPage))
        {
            return false;
        }

        draft = new SignalFilterDraft(vehicleId, signals, rangePreset, perPage);
        return true;
    }

    private static bool TryReadStringArray(JsonElement array, out IReadOnlyList<string> values)
    {
        var list = new List<string>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                values = Array.Empty<string>();
                return false;
            }

            list.Add(item.GetString() ?? string.Empty);
        }

        values = list;
        return true;
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

    private static bool TryGetInt64(JsonElement obj, string name, out long value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number && prop.TryGetInt64(out value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    private static bool TryGetInt32(JsonElement obj, string name, out int value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out value))
        {
            return true;
        }

        value = 0;
        return false;
    }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiSignalFilterDraftStreamEvent"/>s — the native port
/// of the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts). Frames are blank-line
/// delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c> lines. A
/// malformed frame, an unknown event type, or a payload missing its required discriminator fields yields
/// <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). Crucially the <c>tool_result</c> branch
/// preserves the <c>data</c> payload so the view can capture the proposed filter. UI-free + allocation-light so
/// it is unit-tested without a host.
/// </summary>
public static class AiSignalFilterDraftSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiSignalFilterDraftStreamEvent? ParseFrame(string rawFrame)
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

    private static AiSignalFilterDraftStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? AiSignalFilterDraftStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiSignalFilterDraftStreamEvent.ToolCall()
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !HasString(data, "name") ||
                    !data.TryGetProperty("ok", out var okEl) ||
                    (okEl.ValueKind != JsonValueKind.True && okEl.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                var ok = okEl.ValueKind == JsonValueKind.True;
                JsonElement? toolData = ok && data.TryGetProperty("data", out var dataEl)
                    ? dataEl.Clone()
                    : null;
                return AiSignalFilterDraftStreamEvent.ToolResult(data.GetProperty("name").GetString() ?? string.Empty, ok, toolData);

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiSignalFilterDraftStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiSignalFilterDraftStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiSignalFilterDraftStreamEvent.Error(message, AiSignalFilterDraftErrorReason.Stream);

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
/// PII-safe diagnostics for the signal-explorer natural-language filter surface (P1/S11 diagnostics contract).
/// The prompt is arbitrary user-authored text and the captured draft embeds the user's vehicle id and the signal
/// names they want to plot, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal
/// with the surface slug — never the prompt, the streamed rationale, the vehicle id, or any signal name.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AISignalExplorerNlFilterDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AISignalExplorerNlFilterDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AISignalExplorerNlFilter</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AISignalExplorerNlFilterRegistration.Slug}"));
    }
}
