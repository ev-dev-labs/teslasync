using System.Globalization;
using System.Text.Json;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the inbox auto-categorization surface — the native mirror of the web
/// <c>AIInboxAutoCategorization</c> (web/src/components/ai/AIInboxAutoCategorization.tsx) composed with its
/// shared <c>AIFeatureCard</c> scaffold (web/src/components/ai/AIFeatureCard.tsx) and the <c>withAiFeature</c>
/// gate (web/src/components/ai/withAiFeature.tsx). The web surface streams
/// <c>POST /api/v1/ai/alerts/inbox/categorize</c> through <c>useAiStream</c>, captures the
/// <c>draft_alert_categories</c> <c>tool_result</c> envelope into a reviewed proposal, and lets the user copy
/// the proposed <c>rule_id</c> set into the canonical inbox filter (it never writes to the API). This metadata
/// carries the same feature id, endpoint, tool name, render-contract i18n keys and the off-mode test id so the
/// native surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the
/// WinUI resource bridge expects (the convention every shipped surface uses), and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class AIInboxAutoCategorizationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AIInboxAutoCategorization";

    /// <summary>The AI feature id this surface is gated on (web <c>withAiFeature('inbox-auto-categorization', ...)</c>).</summary>
    public const string FeatureId = "inbox-auto-categorization";

    /// <summary>
    /// The off-mode root automation id — the native analogue of the web wrapper's
    /// <c>data-testid="ai-feature-inbox-auto-categorization-root"</c> the AI-off invariant test asserts.
    /// </summary>
    public const string RootAutomationId = "ai-feature-inbox-auto-categorization-root";

    /// <summary>The SSE endpoint the categorization streams from (the client adds the <c>/api/v1</c> prefix once).</summary>
    public const string CategorizePath = "/ai/alerts/inbox/categorize";

    /// <summary>The tool whose <c>tool_result</c> envelope carries the category buckets (web <c>draft_alert_categories</c>).</summary>
    public const string CategoriesToolName = "draft_alert_categories";

    /// <summary>The action button's stable automation id (web <c>data-testid</c> on the suggest button).</summary>
    public const string SuggestButtonAutomationId = "ai-feature-inbox-auto-categorization-categorize";

    /// <summary>The apply button's stable automation id (web <c>data-testid</c> on the apply button).</summary>
    public const string ApplyButtonAutomationId = "ai-feature-inbox-auto-categorization-apply";

    /// <summary>i18n key for the card title (web <c>notifications.inbox.aiCategorize.title</c>).</summary>
    public const string TitleKey = "translation.notifications.inbox.aiCategorize.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web second arg).</summary>
    public const string TitleFallback = "Suggest inbox categories";

    /// <summary>i18n key for the card description (web <c>notifications.inbox.aiCategorize.description</c>).</summary>
    public const string DescriptionKey = "translation.notifications.inbox.aiCategorize.description";

    /// <summary>English fallback for <see cref="DescriptionKey"/> (web second arg, verbatim).</summary>
    public const string DescriptionFallback =
        "Bucket recent alerts into categories from your inbox history. Descriptive replay only \u2014 review before applying.";

    /// <summary>i18n key for the per-feature action verb (web <c>notifications.inbox.aiCategorize.suggestButton</c>).</summary>
    public const string SuggestButtonKey = "translation.notifications.inbox.aiCategorize.suggestButton";

    /// <summary>English fallback for <see cref="SuggestButtonKey"/> (web second arg).</summary>
    public const string SuggestButtonFallback = "Suggest categories";

    /// <summary>i18n key for the badge text (web <c>notifications.inbox.aiCategorize.badge</c>).</summary>
    public const string BadgeKey = "translation.notifications.inbox.aiCategorize.badge";

    /// <summary>English fallback for <see cref="BadgeKey"/> (web second arg).</summary>
    public const string BadgeFallback = "Helix";

    /// <summary>i18n key for the apply-as-filter button (web <c>notifications.inbox.aiCategorize.applyButton</c>).</summary>
    public const string ApplyButtonKey = "translation.notifications.inbox.aiCategorize.applyButton";

    /// <summary>English fallback for <see cref="ApplyButtonKey"/> (web second arg).</summary>
    public const string ApplyButtonFallback = "Apply categories as filter";

    /// <summary>i18n key for the proposal preview label (web <c>notifications.inbox.aiCategorize.previewLabel</c>).</summary>
    public const string PreviewLabelKey = "translation.notifications.inbox.aiCategorize.previewLabel";

    /// <summary>English fallback for <see cref="PreviewLabelKey"/> (web second arg).</summary>
    public const string PreviewLabelFallback = "Proposed categories (review before applying):";

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
    public const string OfflineKey = "translation.notifications.inbox.aiCategorize.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You\u2019re offline \u2014 reconnect and ask Helix to suggest categories again";

    /// <summary>i18n key for the friendly empty state shown when a run proposes no categories.</summary>
    public const string EmptyKey = "translation.notifications.inbox.aiCategorize.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "Helix found no categories to propose for the current inbox window.";

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
/// (web/src/hooks/useAiStream.ts L88). <see cref="Idle"/> before the first run (and after a cancel),
/// <see cref="Streaming"/> while the SSE is open, <see cref="PausedConfirm"/> when the server requests a
/// tool-confirmation (the categorize endpoint is read-only and does not use it, but the union is reproduced for
/// parity because the web component gates <c>canStart</c> on it), <see cref="Done"/> on a clean close and
/// <see cref="Error"/> on any failure.
/// </summary>
public enum InboxCategorizationStreamState
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

/// <summary>The kind discriminator for a parsed <see cref="InboxCategorizationStreamEvent"/> (web <c>AiStreamEvent.type</c>).</summary>
public enum InboxCategorizationEventKind
{
    /// <summary>A streamed text chunk (web <c>'delta'</c>).</summary>
    Delta,

    /// <summary>The model invoked a tool (web <c>'tool_call'</c>); the payload is ignored by this surface.</summary>
    ToolCall,

    /// <summary>A tool returned (web <c>'tool_result'</c>); the <c>draft_alert_categories</c> payload is captured.</summary>
    ToolResult,

    /// <summary>The server requested a confirmation (web <c>'confirm_request'</c>).</summary>
    ConfirmRequest,

    /// <summary>Terminal clean close (web <c>'done'</c>).</summary>
    Done,

    /// <summary>Terminal failure (web <c>'error'</c>).</summary>
    Error,
}

/// <summary>
/// Why a categorization stream ended in <see cref="InboxCategorizationEventKind.Error"/>. The web hook records
/// only the message; the native transport additionally classifies the failure so the view can show the
/// connectivity-aware offline affordance the P2 state matrix mandates without inventing data the web surface
/// lacks.
/// </summary>
public enum InboxCategorizationErrorReason
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
/// The typed shape of one reviewed inbox category — the native port of the web <c>CategoryBucket</c>
/// (web/src/components/ai/AIInboxAutoCategorization.tsx L27). Mirrors the backend
/// <c>internal/ai/tools/inbox_auto_categorization.go</c> <c>CategoryBucket</c>; the narrow shape protects the
/// surface from blindly trusting any field the LLM might emit. <see cref="RuleIds"/> and
/// <see cref="SampleTitles"/> are never <see langword="null"/> (empty when absent) so callers can iterate
/// without a null guard.
/// </summary>
public sealed class CategoryBucket
{
    /// <summary>Creates a validated bucket.</summary>
    public CategoryBucket(string category, long count, IReadOnlyList<long>? ruleIds = null, IReadOnlyList<string>? sampleTitles = null)
    {
        Category = category ?? string.Empty;
        Count = count;
        RuleIds = ruleIds ?? Array.Empty<long>();
        SampleTitles = sampleTitles ?? Array.Empty<string>();
    }

    /// <summary>The category label (web <c>category</c>) — drawn from the backend's closed taxonomy.</summary>
    public string Category { get; }

    /// <summary>How many recent notifications fell into this category (web <c>count</c>).</summary>
    public long Count { get; }

    /// <summary>The alert rule ids this category covers (web <c>rule_ids</c>); empty when absent.</summary>
    public IReadOnlyList<long> RuleIds { get; }

    /// <summary>Sample notification titles for this category (web <c>sample_titles</c>); empty when absent.</summary>
    public IReadOnlyList<string> SampleTitles { get; }
}

/// <summary>
/// One parsed SSE event — the native analogue of the web discriminated union <c>AiStreamEvent</c>
/// (web/src/hooks/useAiStream.ts L49-L80), narrowed to the fields this categorization surface consumes. Unlike
/// the narration surfaces, this one keeps the <c>tool_result</c> name / ok / data payload because the proposal
/// is built from the <c>draft_alert_categories</c> envelope (web <c>onEvent</c> handler). Pure data, so the
/// parser and the view-model state machine are unit-tested headlessly.
/// </summary>
public sealed class InboxCategorizationStreamEvent
{
    private InboxCategorizationStreamEvent(
        InboxCategorizationEventKind kind,
        string text,
        string toolName,
        bool toolOk,
        JsonElement? toolData,
        string message,
        InboxCategorizationErrorReason errorReason)
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
    public InboxCategorizationEventKind Kind { get; }

    /// <summary>The delta text (web <c>delta.text</c>); empty for non-delta events.</summary>
    public string Text { get; }

    /// <summary>The tool name (web <c>tool_call.name</c> / <c>tool_result.name</c>); empty for non-tool events.</summary>
    public string ToolName { get; }

    /// <summary>The tool success flag (web <c>tool_result.ok</c>); meaningful only for <see cref="InboxCategorizationEventKind.ToolResult"/>.</summary>
    public bool ToolOk { get; }

    /// <summary>The tool's returned payload (web <c>tool_result.data</c>); null when absent.</summary>
    public JsonElement? ToolData { get; }

    /// <summary>The terminal error message (web <c>error.message</c>); empty for non-error events.</summary>
    public string Message { get; }

    /// <summary>The classified error reason; meaningful only for <see cref="InboxCategorizationEventKind.Error"/>.</summary>
    public InboxCategorizationErrorReason ErrorReason { get; }

    /// <summary>A streamed text chunk (web <c>{ type:'delta', text }</c>).</summary>
    public static InboxCategorizationStreamEvent Delta(string text) =>
        new(InboxCategorizationEventKind.Delta, text ?? string.Empty, string.Empty, false, null, string.Empty, InboxCategorizationErrorReason.Unknown);

    /// <summary>A tool-call frame (web <c>{ type:'tool_call', name }</c>); payload ignored by this surface.</summary>
    public static InboxCategorizationStreamEvent ToolCall(string name) =>
        new(InboxCategorizationEventKind.ToolCall, string.Empty, name ?? string.Empty, false, null, string.Empty, InboxCategorizationErrorReason.Unknown);

    /// <summary>A tool-result frame (web <c>{ type:'tool_result', name, ok, data? }</c>).</summary>
    public static InboxCategorizationStreamEvent ToolResult(string name, bool ok, JsonElement? data) =>
        new(InboxCategorizationEventKind.ToolResult, string.Empty, name ?? string.Empty, ok, data, string.Empty, InboxCategorizationErrorReason.Unknown);

    /// <summary>A confirm-request frame (web <c>'confirm_request'</c>).</summary>
    public static InboxCategorizationStreamEvent ConfirmRequest() =>
        new(InboxCategorizationEventKind.ConfirmRequest, string.Empty, string.Empty, false, null, string.Empty, InboxCategorizationErrorReason.Unknown);

    /// <summary>The terminal clean-close frame (web <c>'done'</c>).</summary>
    public static InboxCategorizationStreamEvent Done() =>
        new(InboxCategorizationEventKind.Done, string.Empty, string.Empty, false, null, string.Empty, InboxCategorizationErrorReason.Unknown);

    /// <summary>The terminal failure frame (web <c>'error'</c>) carrying a message + classified reason.</summary>
    public static InboxCategorizationStreamEvent Error(string message, InboxCategorizationErrorReason reason) =>
        new(InboxCategorizationEventKind.Error, string.Empty, string.Empty, false, null, message ?? string.Empty, reason);
}

/// <summary>
/// Parses the backend SSE wire format into typed <see cref="InboxCategorizationStreamEvent"/>s — the native port
/// of the web <c>parseSSEFrame</c> + <c>toTypedEvent</c> (web/src/hooks/useAiStream.ts L364-L468). Frames are
/// blank-line delimited; each carries an <c>event: &lt;type&gt;</c> line and one or more <c>data: &lt;json&gt;</c>
/// lines. A malformed frame, an unknown event type, or a payload missing its required discriminator fields
/// yields <see langword="null"/> so the reader skips it instead of corrupting the stream (matching the web hook
/// bit-for-bit so a future server event cannot crash an older client). Unlike the narration parser this one
/// preserves the <c>tool_result</c> <c>data</c> payload. UI-free + allocation-light so it is unit-tested without
/// a host.
/// </summary>
public static class InboxCategorizationSseParser
{
    private static readonly char[] LineSeparators = ['\n'];

    /// <summary>
    /// Parse a single SSE block (the lines between two blank-line delimiters, without the trailing blank line)
    /// into a typed event, or <see langword="null"/> when the frame is malformed / unknown — the native port of
    /// the web <c>parseSSEFrame</c>.
    /// </summary>
    public static InboxCategorizationStreamEvent? ParseFrame(string rawFrame)
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

    private static InboxCategorizationStreamEvent? ToTypedEvent(string eventName, JsonElement? payload)
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
                    ? InboxCategorizationStreamEvent.Delta(text)
                    : null;

            case "tool_call":
                return HasString(data, "id") && TryGetString(data, "name", out var callName)
                    ? InboxCategorizationStreamEvent.ToolCall(callName)
                    : null;

            case "tool_result":
                if (!HasString(data, "id") || !TryGetString(data, "name", out var resultName) ||
                    !data.TryGetProperty("ok", out var ok) ||
                    (ok.ValueKind != JsonValueKind.True && ok.ValueKind != JsonValueKind.False))
                {
                    return null;
                }

                JsonElement? toolData = data.TryGetProperty("data", out var d) ? d : null;
                return InboxCategorizationStreamEvent.ToolResult(resultName, ok.ValueKind == JsonValueKind.True, toolData);

            case "confirm_request":
                return HasString(data, "continuation_id") && HasString(data, "tool") && HasString(data, "summary")
                    ? InboxCategorizationStreamEvent.ConfirmRequest()
                    : null;

            case "done":
                return InboxCategorizationStreamEvent.Done();

            case "error":
                var message = TryGetString(data, "message", out var m) ? m : "unknown";
                return InboxCategorizationStreamEvent.Error(message, InboxCategorizationErrorReason.Stream);

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
/// Validates and projects the <c>draft_alert_categories</c> tool payload into <see cref="CategoryBucket"/>s —
/// the native port of the web <c>onEvent</c> bucket-building loop (web AIInboxAutoCategorization L100-L151).
/// The payload (the <c>tool_result.data</c> element) must be an object with <c>status === 'ok'</c> and a
/// <c>categories</c> array; each element must be an object with a non-empty <c>category</c> string and a
/// non-negative numeric <c>count</c>. Optional <c>rule_ids</c> keep only positive integers and optional
/// <c>sample_titles</c> keep only non-empty strings. Anything that fails validation is dropped (never trusted),
/// mirroring the web guard so a malformed LLM emission cannot corrupt the proposal. UI-free.
/// </summary>
public static class CategoryBucketParser
{
    /// <summary>Project the tool payload into validated buckets; returns an empty list when nothing is valid.</summary>
    public static IReadOnlyList<CategoryBucket> Parse(JsonElement? toolData)
    {
        if (toolData is not { ValueKind: JsonValueKind.Object } data)
        {
            return Array.Empty<CategoryBucket>();
        }

        if (!data.TryGetProperty("status", out var status) ||
            status.ValueKind != JsonValueKind.String ||
            !string.Equals(status.GetString(), "ok", StringComparison.Ordinal))
        {
            return Array.Empty<CategoryBucket>();
        }

        if (!data.TryGetProperty("categories", out var categories) || categories.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CategoryBucket>();
        }

        var buckets = new List<CategoryBucket>();
        foreach (var raw in categories.EnumerateArray())
        {
            if (raw.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (!raw.TryGetProperty("category", out var categoryEl) ||
                categoryEl.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var category = categoryEl.GetString() ?? string.Empty;
            if (category.Length == 0)
            {
                continue;
            }

            if (!raw.TryGetProperty("count", out var countEl) ||
                countEl.ValueKind != JsonValueKind.Number ||
                !countEl.TryGetInt64(out var count) ||
                count < 0)
            {
                continue;
            }

            buckets.Add(new CategoryBucket(
                category,
                count,
                ParseRuleIds(raw),
                ParseSampleTitles(raw)));
        }

        return buckets;
    }

    private static IReadOnlyList<long> ParseRuleIds(JsonElement raw)
    {
        if (!raw.TryGetProperty("rule_ids", out var ruleIds) || ruleIds.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<long>();
        }

        var ids = new List<long>();
        foreach (var v in ruleIds.EnumerateArray())
        {
            if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var id) && id > 0)
            {
                ids.Add(id);
            }
        }

        return ids.Count > 0 ? ids : Array.Empty<long>();
    }

    private static IReadOnlyList<string> ParseSampleTitles(JsonElement raw)
    {
        if (!raw.TryGetProperty("sample_titles", out var sampleTitles) || sampleTitles.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var titles = new List<string>();
        foreach (var v in sampleTitles.EnumerateArray())
        {
            if (v.ValueKind == JsonValueKind.String)
            {
                var title = v.GetString() ?? string.Empty;
                if (title.Length > 0)
                {
                    titles.Add(title);
                }
            }
        }

        return titles.Count > 0 ? titles : Array.Empty<string>();
    }
}

/// <summary>
/// PII-safe diagnostics for the inbox auto-categorization surface (P1/S11 diagnostics contract). The proposed
/// categories, rule ids, and sample notification titles are all sensitive inbox content, so the collector
/// records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never the proposal
/// content, the scope inputs, or any streamed prose. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class AIInboxAutoCategorizationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AIInboxAutoCategorizationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AIInboxAutoCategorization</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={AIInboxAutoCategorizationRegistration.Slug}"));
    }
}
