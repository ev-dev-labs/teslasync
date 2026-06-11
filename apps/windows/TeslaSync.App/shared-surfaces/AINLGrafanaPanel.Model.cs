using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the natural-language Grafana-panel drafter surface — the native mirror of
/// the web <c>AINLGrafanaPanel</c> (web/src/components/ai/AINLGrafanaPanel.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c> gate
/// (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/power/grafana-panel/draft</c> through <c>useAiStream</c>, captures the typed
/// <c>draft_grafana_panel</c> tool envelope and surfaces a propose-only "Apply to editor" action; this metadata
/// carries the same feature id, endpoint, render-contract i18n keys and the off-mode test id so the native
/// surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI
/// resource bridge expects, and resolves against the English fallback headlessly. UI-free so it is asserted
/// without a XAML host.
/// </summary>
public static class AINLGrafanaPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AINLGrafanaPanel";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('nl-grafana-panel', ...)</c>).</summary>
    public const string FeatureId = "nl-grafana-panel";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-nl-grafana-panel-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-nl-grafana-panel-root";

    /// <summary>
    /// The SSE endpoint the draft streams from (web <c>useAiStream({ url: '/ai/power/grafana-panel/draft' })</c>;
    /// the client adds the <c>/api/v1</c> prefix once). The prompt flows through the JSON body, not the URL.
    /// </summary>
    public const string DraftPath = "/ai/power/grafana-panel/draft";

    /// <summary>The name of the tool whose typed result envelope carries the proposed Grafana panel draft.</summary>
    public const string DraftToolName = "draft_grafana_panel";

    /// <summary>i18n key for the card title (web <c>powerGrafana.aiDrafter.title</c>).</summary>
    public const string TitleKey = "translation.powerGrafana.aiDrafter.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Helix natural-language Grafana panel drafter";

    /// <summary>i18n key for the card description (web <c>powerGrafana.aiDrafter.description</c>).</summary>
    public const string DescriptionKey = "translation.powerGrafana.aiDrafter.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Describe the panel you want in plain English (e.g. \"show me a daily time series of how far I " +
        "drove this month\"). Helix proposes a typed Grafana panel JSON draft you can apply to the editor " +
        "with one click; it never pushes the panel to Grafana directly.";

    /// <summary>i18n key for the per-feature action verb (web <c>powerGrafana.aiDrafter.button</c>).</summary>
    public const string DraftButtonKey = "translation.powerGrafana.aiDrafter.button";

    /// <summary>English fallback for <see cref="DraftButtonKey"/> (web second arg).</summary>
    public const string DraftButtonFallback = "Draft panel";

    /// <summary>i18n key for the badge text (web <c>powerGrafana.aiDrafter.badge</c>).</summary>
    public const string BadgeKey = "translation.powerGrafana.aiDrafter.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the prompt placeholder (web <c>powerGrafana.aiDrafter.promptPlaceholder</c>).</summary>
    public const string PromptPlaceholderKey = "translation.powerGrafana.aiDrafter.promptPlaceholder";

    /// <summary>English fallback for <see cref="PromptPlaceholderKey"/> (web second arg).</summary>
    public const string PromptPlaceholderFallback =
        "e.g. show me a daily time series of how far I drove this month";

    /// <summary>i18n key for the prompt accessible name (web <c>powerGrafana.aiDrafter.promptLabel</c>).</summary>
    public const string PromptLabelKey = "translation.powerGrafana.aiDrafter.promptLabel";

    /// <summary>English fallback for <see cref="PromptLabelKey"/> (web second arg).</summary>
    public const string PromptLabelFallback = "Grafana panel request";

    /// <summary>i18n key for the apply-to-editor action (web <c>powerGrafana.aiDrafter.applyButton</c>).</summary>
    public const string ApplyButtonKey = "translation.powerGrafana.aiDrafter.applyButton";

    /// <summary>English fallback for <see cref="ApplyButtonKey"/> (web second arg).</summary>
    public const string ApplyButtonFallback = "Apply to editor";

    /// <summary>i18n key for the apply tooltip (web <c>powerGrafana.aiDrafter.applyTooltip</c>).</summary>
    public const string ApplyTooltipKey = "translation.powerGrafana.aiDrafter.applyTooltip";

    /// <summary>English fallback for <see cref="ApplyTooltipKey"/> (web second arg, verbatim).</summary>
    public const string ApplyTooltipFallback =
        "Copy the proposed panel JSON into the editor above. You can still edit it before clicking Copy to " +
        "clipboard.";

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
/// tool-confirmation (the grafana-panel endpoint does not use it, but the union is reproduced for parity),
/// <see cref="Done"/> on a clean close and <see cref="Error"/> on any failure.
/// </summary>
public enum AiGrafanaDraftStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="AiGrafanaDraftStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum AiGrafanaDraftEventKind
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
/// Why a draft stream ended in <see cref="AiGrafanaDraftEventKind.Error"/>. The web hook records only the
/// message; the native transport additionally classifies the failure so the view can show the connectivity-
/// aware offline affordance the P2 state matrix mandates without inventing data the web surface lacks.
/// </summary>
public enum AiGrafanaDraftErrorReason
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
/// narration surface this one CAPTURES the <c>tool_result</c> payload (the typed <c>draft_grafana_panel</c>
/// envelope) so the view can surface a proposal. <c>tool_call</c> / <c>confirm_request</c> frames are parsed
/// for parity but carry no payload here. Pure data, so the parser and the view-model state machine are
/// unit-tested headlessly.
/// </summary>
public sealed class AiGrafanaDraftStreamEvent
{
    private AiGrafanaDraftStreamEvent(
        AiGrafanaDraftEventKind kind,
        string text,
        string toolName,
        bool toolOk,
        JsonElement? toolData,
        string message,
        AiGrafanaDraftErrorReason errorReason)
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
    public AiGrafanaDraftEventKind Kind { get; }

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

    /// <summary>The classified error reason; meaningful only for <see cref="AiGrafanaDraftEventKind.Error"/>.</summary>
    public AiGrafanaDraftErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static AiGrafanaDraftStreamEvent Delta(string text) =>
        new(AiGrafanaDraftEventKind.Delta, text ?? string.Empty, string.Empty, false, null, string.Empty, AiGrafanaDraftErrorReason.Unknown);

    /// <summary>A tool-call frame (payload ignored by this surface).</summary>
    public static AiGrafanaDraftStreamEvent ToolCall() =>
        new(AiGrafanaDraftEventKind.ToolCall, string.Empty, string.Empty, false, null, string.Empty, AiGrafanaDraftErrorReason.Unknown);

    /// <summary>A tool-result frame carrying the tool name, its success flag and (when present) its typed data payload.</summary>
    public static AiGrafanaDraftStreamEvent ToolResult(string name, bool ok, JsonElement? data) =>
        new(AiGrafanaDraftEventKind.ToolResult, string.Empty, name ?? string.Empty, ok, data, string.Empty, AiGrafanaDraftErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static AiGrafanaDraftStreamEvent ConfirmRequest() =>
        new(AiGrafanaDraftEventKind.ConfirmRequest, string.Empty, string.Empty, false, null, string.Empty, AiGrafanaDraftErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static AiGrafanaDraftStreamEvent Done() =>
        new(AiGrafanaDraftEventKind.Done, string.Empty, string.Empty, false, null, string.Empty, AiGrafanaDraftErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static AiGrafanaDraftStreamEvent Error(string message, AiGrafanaDraftErrorReason reason) =>
        new(AiGrafanaDraftEventKind.Error, string.Empty, string.Empty, false, null, message ?? string.Empty, reason);
}

/// <summary>
/// The JSON request body POSTed to the draft endpoint — the native analogue of the web <c>useMemo</c> body
/// <c>{ prompt }</c> (web AINLGrafanaPanel L134). The route carries no path parameter and no vehicle scope; the
/// explicit <see cref="JsonPropertyNameAttribute"/> pins the snake_case wire name regardless of the serializer
/// policy.
/// </summary>
public sealed class AiGrafanaDraftRequest
{
    /// <summary>Creates the request body for the given free-form prompt.</summary>
    public AiGrafanaDraftRequest(string prompt) => Prompt = prompt ?? string.Empty;

    /// <summary>The free-form natural-language prompt (web <c>prompt</c>).</summary>
    [JsonPropertyName("prompt")]
    public string Prompt { get; }
}

/// <summary>
/// The Grafana datasource reference a panel target binds to — the native port of the web
/// <c>GrafanaDatasourceRef</c> (web AINLGrafanaPanel L40-L43). Both fields are required by
/// <c>parseGrafanaPanelDraft</c>.
/// </summary>
public sealed class GrafanaDatasourceRef
{
    /// <summary>Creates the datasource reference from its validated parts.</summary>
    public GrafanaDatasourceRef(string type, string uid)
    {
        Type = type ?? string.Empty;
        Uid = uid ?? string.Empty;
    }

    /// <summary>The datasource type (web <c>datasource.type</c>; e.g. <c>postgres</c>, <c>prometheus</c>).</summary>
    public string Type { get; }

    /// <summary>The datasource canonical UID (web <c>datasource.uid</c>).</summary>
    public string Uid { get; }
}

/// <summary>
/// One panel target — the native port of the web <c>GrafanaPanelTarget</c> (web AINLGrafanaPanel L45-L50). Only
/// <see cref="RefId"/> is required; the optional SQL / PromQL / format fields are preserved verbatim for the
/// apply handoff.
/// </summary>
public sealed class GrafanaPanelTarget
{
    /// <summary>Creates a panel target from its validated parts.</summary>
    public GrafanaPanelTarget(string refId, string? rawSql, string? expr, string? format)
    {
        RefId = refId ?? string.Empty;
        RawSql = rawSql;
        Expr = expr;
        Format = format;
    }

    /// <summary>The target ref id (web <c>ref_id</c>); required.</summary>
    public string RefId { get; }

    /// <summary>The raw SQL for postgres targets (web <c>raw_sql</c>); null when omitted.</summary>
    public string? RawSql { get; }

    /// <summary>The PromQL expression for prometheus targets (web <c>expr</c>); null when omitted.</summary>
    public string? Expr { get; }

    /// <summary>The target format (web <c>format</c>); null when omitted.</summary>
    public string? Format { get; }
}

/// <summary>
/// The panel grid position — the native port of the web <c>GrafanaPanelGridPos</c> (web AINLGrafanaPanel
/// L52-L57). All four fields are required numbers (web <c>typeof === 'number'</c>); stored as
/// <see cref="double"/> to faithfully mirror the JS <c>number</c> type.
/// </summary>
public sealed class GrafanaPanelGridPos
{
    /// <summary>Creates the grid position from its validated coordinates.</summary>
    public GrafanaPanelGridPos(double x, double y, double w, double h)
    {
        X = x;
        Y = y;
        W = w;
        H = h;
    }

    /// <summary>The panel x coordinate on the Grafana grid (web <c>grid_pos.x</c>).</summary>
    public double X { get; }

    /// <summary>The panel y coordinate on the Grafana grid (web <c>grid_pos.y</c>).</summary>
    public double Y { get; }

    /// <summary>The panel width on the Grafana grid (web <c>grid_pos.w</c>).</summary>
    public double W { get; }

    /// <summary>The panel height on the Grafana grid (web <c>grid_pos.h</c>).</summary>
    public double H { get; }
}

/// <summary>
/// The proposed Grafana panel envelope — the native port of the web <c>GrafanaPanelEnvelope</c> (web
/// AINLGrafanaPanel L32-L38): the deterministic panel-builder envelope fields the Grafana panel editor owns.
/// </summary>
public sealed class GrafanaPanelEnvelope
{
    /// <summary>Creates the panel envelope from its validated parts.</summary>
    public GrafanaPanelEnvelope(
        string title,
        string type,
        GrafanaDatasourceRef datasource,
        IReadOnlyList<GrafanaPanelTarget> targets,
        GrafanaPanelGridPos gridPos)
    {
        Title = title ?? string.Empty;
        Type = type ?? string.Empty;
        Datasource = datasource;
        Targets = targets ?? Array.Empty<GrafanaPanelTarget>();
        GridPos = gridPos;
    }

    /// <summary>The proposed panel title (web <c>panel.title</c>).</summary>
    public string Title { get; }

    /// <summary>The proposed panel type (web <c>panel.type</c>; e.g. <c>timeseries</c>, <c>stat</c>).</summary>
    public string Type { get; }

    /// <summary>The proposed panel datasource (web <c>panel.datasource</c>).</summary>
    public GrafanaDatasourceRef Datasource { get; }

    /// <summary>The proposed panel targets (web <c>panel.targets</c>); empty when the LLM omits them.</summary>
    public IReadOnlyList<GrafanaPanelTarget> Targets { get; }

    /// <summary>The proposed panel grid position (web <c>panel.grid_pos</c>).</summary>
    public GrafanaPanelGridPos GridPos { get; }
}

/// <summary>
/// A captured Grafana-panel proposal — the native port of the web <c>GrafanaPanelDraft</c> envelope (web
/// AINLGrafanaPanel L25-L30): the prompt that produced it, the typed <see cref="Panel"/>, the LLM's
/// <see cref="Rationale"/> and the <see cref="ReferencedTables"/> it grounded the panel on. Built only by
/// <see cref="TryParse"/>, which mirrors the web <c>parseGrafanaPanelDraft</c> defence-in-depth narrowing
/// bit-for-bit — including the contract that ONLY a <c>status === 'ok'</c> envelope yields a draft (a rejected
/// or malformed envelope yields nothing, so a bad draft never reaches the editor and the apply action stays
/// hidden).
/// </summary>
public sealed class GrafanaPanelDraft
{
    private const string OkStatus = "ok";

    private GrafanaPanelDraft(
        string prompt,
        GrafanaPanelEnvelope panel,
        string rationale,
        IReadOnlyList<string> referencedTables)
    {
        Prompt = prompt;
        Panel = panel;
        Rationale = rationale;
        ReferencedTables = referencedTables;
    }

    /// <summary>The prompt the LLM produced the draft from (web <c>draft.prompt</c>).</summary>
    public string Prompt { get; }

    /// <summary>The typed proposed panel envelope (web <c>draft.panel</c>).</summary>
    public GrafanaPanelEnvelope Panel { get; }

    /// <summary>The LLM's plain-language rationale (web <c>draft.rationale</c>).</summary>
    public string Rationale { get; }

    /// <summary>The tables the panel references (web <c>draft.referenced_tables</c>); empty when omitted.</summary>
    public IReadOnlyList<string> ReferencedTables { get; }

    /// <summary>
    /// Parse the <c>draft_grafana_panel</c> tool's typed envelope (web <c>{ status, draft }</c>) into a captured
    /// proposal, or return <see langword="false"/> when the wire shape cannot be positively proven — the native
    /// port of the web <c>parseGrafanaPanelDraft</c>. Crucially this rejects any envelope whose
    /// <c>status !== 'ok'</c> (so the propose-only apply action only ever surfaces a validator-accepted panel)
    /// and any envelope missing a required field (status, draft, prompt, rationale, panel.title, panel.type,
    /// panel.datasource.{type,uid}, panel.grid_pos.{x,y,w,h}). Targets and referenced_tables default to empty.
    /// </summary>
    public static bool TryParse(JsonElement envelope, out GrafanaPanelDraft? draft)
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

        if (!TryGetString(d, "prompt", out var prompt) ||
            !TryGetString(d, "rationale", out var rationale) ||
            !d.TryGetProperty("panel", out var panelEl) || panelEl.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (!TryGetString(panelEl, "title", out var title) ||
            !TryGetString(panelEl, "type", out var type) ||
            !panelEl.TryGetProperty("datasource", out var dsEl) || dsEl.ValueKind != JsonValueKind.Object ||
            !TryGetString(dsEl, "type", out var dsType) ||
            !TryGetString(dsEl, "uid", out var dsUid))
        {
            return false;
        }

        // web: grid_pos is required and every coordinate must be a number.
        if (!panelEl.TryGetProperty("grid_pos", out var gpEl) || gpEl.ValueKind != JsonValueKind.Object ||
            !TryGetNumber(gpEl, "x", out var x) || !TryGetNumber(gpEl, "y", out var y) ||
            !TryGetNumber(gpEl, "w", out var w) || !TryGetNumber(gpEl, "h", out var h))
        {
            return false;
        }

        var targets = ParseTargets(panelEl);
        var tables = ParseReferencedTables(d);

        draft = new GrafanaPanelDraft(
            prompt,
            new GrafanaPanelEnvelope(
                title,
                type,
                new GrafanaDatasourceRef(dsType, dsUid),
                targets,
                new GrafanaPanelGridPos(x, y, w, h)),
            rationale,
            tables);
        return true;
    }

    private static IReadOnlyList<GrafanaPanelTarget> ParseTargets(JsonElement panel)
    {
        // web: Array.isArray(p.targets) ? p.targets.map(...).filter(notNull) : [] — a target missing its
        // required ref_id is dropped rather than rejecting the whole draft.
        if (!panel.TryGetProperty("targets", out var targetsEl) || targetsEl.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<GrafanaPanelTarget>();
        }

        var list = new List<GrafanaPanelTarget>(targetsEl.GetArrayLength());
        foreach (var t in targetsEl.EnumerateArray())
        {
            if (t.ValueKind != JsonValueKind.Object || !TryGetString(t, "ref_id", out var refId))
            {
                continue;
            }

            list.Add(new GrafanaPanelTarget(
                refId,
                TryGetString(t, "raw_sql", out var rawSql) ? rawSql : null,
                TryGetString(t, "expr", out var expr) ? expr : null,
                TryGetString(t, "format", out var format) ? format : null));
        }

        return list;
    }

    private static IReadOnlyList<string> ParseReferencedTables(JsonElement draft)
    {
        // web: Array.isArray(d.referenced_tables) ? filter(string) : [].
        if (!draft.TryGetProperty("referenced_tables", out var rtEl) || rtEl.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(rtEl.GetArrayLength());
        foreach (var s in rtEl.EnumerateArray())
        {
            if (s.ValueKind == JsonValueKind.String)
            {
                list.Add(s.GetString() ?? string.Empty);
            }
        }

        return list;
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

    private static bool TryGetNumber(JsonElement obj, string name, out double value)
    {
        if (obj.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.Number &&
            prop.TryGetDouble(out value))
        {
            return true;
        }

        value = 0;
        return false;
    }
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="AiGrafanaDraftStreamEvent"/>s — the native port of
/// the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). Crucially the <c>tool_result</c> branch
/// preserves the <c>data</c> payload so the view can capture the proposed panel. UI-free + allocation-light so
/// it is unit-tested without a host.
/// </summary>
public static class AiGrafanaDraftSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port
    /// of the web <c>parseSSEFrame</c>.
    /// </summary>
    public static AiGrafanaDraftStreamEvent? ParseFrame(string rawFrame)
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

    private static AiGrafanaDraftStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? AiGrafanaDraftStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && HasString(data, "name")
                    ? AiGrafanaDraftStreamEvent.ToolCall()
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
                return AiGrafanaDraftStreamEvent.ToolResult(data.GetProperty("name").GetString() ?? string.Empty, ok, toolData);

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? AiGrafanaDraftStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return AiGrafanaDraftStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return AiGrafanaDraftStreamEvent.Error(message, AiGrafanaDraftErrorReason.Stream);

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
/// PII-safe diagnostics for the natural-language Grafana-panel drafter surface (P1/S11 diagnostics contract).
/// The prompt is arbitrary user-authored text and the captured draft can embed table names and SQL grounded in
/// the user's schema, so the collector records ONLY the operational <see cref="RecordViewOpened"/> signal with
/// the surface slug — never the prompt, the streamed rationale, the proposed SQL/PromQL, or any table name.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AINLGrafanaPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AINLGrafanaPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AINLGrafanaPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AINLGrafanaPanelRegistration.Slug}"));
    }
}
