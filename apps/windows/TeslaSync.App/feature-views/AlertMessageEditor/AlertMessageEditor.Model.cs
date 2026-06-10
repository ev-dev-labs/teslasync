using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state one of the editor's two catalog data sources (the insert-token catalog and the
/// preset gallery) can be in — the native union of the loading / loaded / empty / error / stale /
/// offline branches the web <c>AlertMessageEditor</c> renders for its
/// token-catalog and preset queries
/// (web/src/features/notifications/components/AlertMessageEditor.tsx). Every branch maps onto a visible
/// surface; none is ever hidden.
/// </summary>
public enum AlertMessageCatalogState
{
    /// <summary>Initial fetch with no cached rows — render the skeleton / loading chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no rows — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The lifecycle state of the live preview pane — the native union of the error / loading / empty /
/// rendered branches the web <c>PreviewPanel</c> renders for the debounced
/// <c>useAlertMessagePreview</c> mutation. The preview is a fire-on-edit render (not a cache-then-network
/// read), so it has no stale/offline tiers.
/// </summary>
public enum AlertMessagePreviewState
{
    /// <summary>No preview requested yet — render "Start typing to see a preview".</summary>
    Empty,

    /// <summary>The first preview render is in flight with nothing to show yet.</summary>
    Loading,

    /// <summary>A rendered title/body is available.</summary>
    Rendered,

    /// <summary>The preview render failed — render the error text.</summary>
    Error,
}

/// <summary>
/// The editor draft used by the preview and token endpoints — the native mirror of the web
/// <c>AlertMessageEditorDraft</c>. The rule-shape fields are forwarded verbatim to
/// the preview and insert-token catalog endpoints; they are kept as
/// nullable scalars (and <see cref="Op"/> as a raw string) because the editor only routes them, never
/// interprets them beyond the op-validity preset filter.
/// </summary>
public sealed record AlertRuleDraft
{
    /// <summary>Optional rule name.</summary>
    public string? Name { get; init; }

    /// <summary>Rule kind: <c>signal</c> or <c>computed_metric</c>.</summary>
    public string? Kind { get; init; }

    /// <summary>Triggering telemetry signal name (signal rules).</summary>
    public string? SignalName { get; init; }

    /// <summary>Comparison operator (<c>=</c>, <c>&lt;</c>, <c>between</c>, …). Drives the preset op-validity filter.</summary>
    public string? Op { get; init; }

    /// <summary>Rule severity (<c>info</c> / <c>warn</c> / <c>critical</c>).</summary>
    public string? Severity { get; init; }

    /// <summary>Sample vehicle name fed to the renderer.</summary>
    public string? VehicleName { get; init; }

    /// <summary>Numeric threshold value.</summary>
    public double? ValueNum { get; init; }

    /// <summary>Text threshold value.</summary>
    public string? ValueText { get; init; }

    /// <summary>Boolean threshold value.</summary>
    public bool? ValueBool { get; init; }

    /// <summary>Lower bound for <c>between</c>/<c>outside</c> rules.</summary>
    public double? ValueMin { get; init; }

    /// <summary>Upper bound for <c>between</c>/<c>outside</c> rules.</summary>
    public double? ValueMax { get; init; }

    /// <summary>Computed-metric id (metric rules).</summary>
    public string? MetricId { get; init; }

    /// <summary>Computed-metric rolling window.</summary>
    public string? MetricWindow { get; init; }

    /// <summary>Computed-metric operator.</summary>
    public string? MetricOp { get; init; }

    /// <summary>Computed-metric threshold.</summary>
    public double? MetricThreshold { get; init; }
}

/// <summary>
/// One insert-token catalog entry from the token-catalog endpoint (the web token-catalog row). A
/// token is referenced in a template with the double-brace form
/// <c>{{Key}}</c>. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial row never throws.
/// </summary>
public sealed record MessageToken(
    string Key,
    string Label,
    string? Description,
    string Group,
    string? Example)
{
    /// <summary>The canonical double-brace insertion form (<c>{{Key}}</c>).</summary>
    public string InsertText => "{{" + Key + "}}";

    /// <summary>A Narrator automation name combining the insertion form and the human label.</summary>
    public string AutomationName =>
        string.IsNullOrEmpty(Label) ? InsertText : string.Create(CultureInfo.CurrentCulture, $"{InsertText} {Label}");

    /// <summary>Parse a catalog JSON array into a tolerant list of tokens.</summary>
    public static IReadOnlyList<MessageToken> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MessageToken>();
        }

        var list = new List<MessageToken>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single catalog JSON object into a <see cref="MessageToken"/>.</summary>
    public static MessageToken FromJson(JsonElement obj) => new(
        Key: JsonRead.String(obj, "key") ?? string.Empty,
        Label: JsonRead.String(obj, "label") ?? JsonRead.String(obj, "key") ?? string.Empty,
        Description: JsonRead.String(obj, "description"),
        Group: JsonRead.String(obj, "group") ?? string.Empty,
        Example: JsonRead.String(obj, "example"));
}

/// <summary>
/// One curated message-template preset from <c>GET /alerts/message-presets</c> (web
/// <c>AlertMessagePreset</c>, ADR-014). Null-tolerant parsing.
/// </summary>
public sealed record MessagePreset(
    string Id,
    string Name,
    string? Description,
    string Template,
    string? Kind,
    IReadOnlyList<string> Tags)
{
    /// <summary>A Narrator automation name combining the preset name and its description (when present).</summary>
    public string AutomationName =>
        string.IsNullOrEmpty(Description)
            ? Name
            : string.Create(CultureInfo.CurrentCulture, $"{Name}. {Description}");

    /// <summary>Parse a preset JSON array into a tolerant list of presets.</summary>
    public static IReadOnlyList<MessagePreset> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MessagePreset>();
        }

        var list = new List<MessagePreset>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single preset JSON object into a <see cref="MessagePreset"/>.</summary>
    public static MessagePreset FromJson(JsonElement obj) => new(
        Id: JsonRead.String(obj, "id") ?? string.Empty,
        Name: JsonRead.String(obj, "name") ?? string.Empty,
        Description: JsonRead.String(obj, "description"),
        Template: JsonRead.String(obj, "template") ?? string.Empty,
        Kind: JsonRead.String(obj, "kind"),
        Tags: JsonRead.StringList(obj, "tags"));
}

/// <summary>
/// The rendered preview returned by <c>POST /alerts/message-preview</c> (web
/// <c>AlertMessagePreviewResponse</c>): the resolved notification <see cref="Title"/> and
/// <see cref="Body"/>.
/// </summary>
public sealed record MessagePreviewResult(string Title, string Body)
{
    /// <summary>Project the preview JSON object into a <see cref="MessagePreviewResult"/>.</summary>
    public static MessagePreviewResult FromJson(JsonElement obj) => new(
        Title: JsonRead.String(obj, "title") ?? string.Empty,
        Body: JsonRead.String(obj, "body") ?? string.Empty);
}

/// <summary>
/// The request body for <c>POST /alerts/message-preview</c> — the native mirror of the web
/// <c>AlertMessagePreviewRequest</c>. Serialized with snake_case property names to match the Go API
/// (never camelCase). Built from the draft plus the live template and include-title toggle via
/// <see cref="From"/>.
/// </summary>
public sealed record MessagePreviewRequest
{
    /// <summary>Optional rule name.</summary>
    [JsonPropertyName("name")] public string? Name { get; init; }

    /// <summary>Rule kind.</summary>
    [JsonPropertyName("kind")] public string? Kind { get; init; }

    /// <summary>Triggering signal name.</summary>
    [JsonPropertyName("signal_name")] public string? SignalName { get; init; }

    /// <summary>Comparison operator.</summary>
    [JsonPropertyName("op")] public string? Op { get; init; }

    /// <summary>Rule severity.</summary>
    [JsonPropertyName("severity")] public string? Severity { get; init; }

    /// <summary>Sample vehicle name.</summary>
    [JsonPropertyName("vehicle_name")] public string? VehicleName { get; init; }

    /// <summary>Numeric threshold.</summary>
    [JsonPropertyName("value_num")] public double? ValueNum { get; init; }

    /// <summary>Text threshold.</summary>
    [JsonPropertyName("value_text")] public string? ValueText { get; init; }

    /// <summary>Boolean threshold.</summary>
    [JsonPropertyName("value_bool")] public bool? ValueBool { get; init; }

    /// <summary>Lower bound.</summary>
    [JsonPropertyName("value_min")] public double? ValueMin { get; init; }

    /// <summary>Upper bound.</summary>
    [JsonPropertyName("value_max")] public double? ValueMax { get; init; }

    /// <summary>Computed-metric id.</summary>
    [JsonPropertyName("metric_id")] public string? MetricId { get; init; }

    /// <summary>Computed-metric window.</summary>
    [JsonPropertyName("metric_window")] public string? MetricWindow { get; init; }

    /// <summary>Computed-metric operator.</summary>
    [JsonPropertyName("metric_op")] public string? MetricOp { get; init; }

    /// <summary>Computed-metric threshold.</summary>
    [JsonPropertyName("metric_threshold")] public double? MetricThreshold { get; init; }

    /// <summary>The body template; <see langword="null"/> means "use the op-aware default".</summary>
    [JsonPropertyName("msg_template")] public string? MsgTemplate { get; init; }

    /// <summary>Whether the rendered notification carries a separate title.</summary>
    [JsonPropertyName("include_title")] public bool IncludeTitle { get; init; }

    /// <summary>
    /// Build the preview body from the editor's current <paramref name="draft"/>, <paramref name="msgTemplate"/>
    /// and <paramref name="includeTitle"/>. An all-whitespace template is sent as <see langword="null"/>
    /// (web parity: blank means "use the smart default body").
    /// </summary>
    public static MessagePreviewRequest From(AlertRuleDraft draft, string msgTemplate, bool includeTitle)
    {
        ArgumentNullException.ThrowIfNull(draft);
        return new MessagePreviewRequest
        {
            Name = draft.Name,
            Kind = draft.Kind,
            SignalName = draft.SignalName,
            Op = draft.Op,
            Severity = draft.Severity,
            VehicleName = draft.VehicleName,
            ValueNum = draft.ValueNum,
            ValueText = draft.ValueText,
            ValueBool = draft.ValueBool,
            ValueMin = draft.ValueMin,
            ValueMax = draft.ValueMax,
            MetricId = draft.MetricId,
            MetricWindow = draft.MetricWindow,
            MetricOp = draft.MetricOp,
            MetricThreshold = draft.MetricThreshold,
            MsgTemplate = string.IsNullOrWhiteSpace(msgTemplate) ? null : msgTemplate,
            IncludeTitle = includeTitle,
        };
    }

    /// <summary>
    /// A stable serialization of the inputs that affect the rendered preview — used by the view-model to
    /// debounce redundant preview round-trips (web parity: the <c>previewKey</c> memo).
    /// </summary>
    public string DebounceKey() => string.Create(
        CultureInfo.InvariantCulture,
        $"{MsgTemplate}\u001f{IncludeTitle}\u001f{Name}\u001f{Kind}\u001f{SignalName}\u001f{Op}\u001f{Severity}\u001f{VehicleName}\u001f{ValueNum}\u001f{ValueText}\u001f{ValueBool}\u001f{ValueMin}\u001f{ValueMax}\u001f{MetricId}\u001f{MetricWindow}\u001f{MetricOp}\u001f{MetricThreshold}");
}

/// <summary>
/// The result of an autocomplete trigger scan: whether the popover should be open and, when it is, the
/// index in the textarea where the <c>{{</c> trigger started and the partial text typed after it. The
/// native port of the <c>{{</c> walk-back in the web <c>handleTextareaChange</c>.
/// </summary>
public readonly record struct AutocompleteHit(bool Open, int TriggerIndex, string Filter)
{
    /// <summary>A closed (no-popover) result.</summary>
    public static AutocompleteHit Closed => new(false, -1, string.Empty);
}

/// <summary>The text + caret produced by splicing a token into a template (<see cref="TemplateLogic.InsertToken"/>).</summary>
public readonly record struct TokenInsertion(string Text, int Caret);

/// <summary>
/// Pure, UI-thread-free template logic shared by the view-model and its tests — the native port of the
/// helper functions and handlers in web/src/features/notifications/components/AlertMessageEditor.tsx:
/// referenced-key extraction, the <c>{{</c> autocomplete trigger scan, and token splicing.
/// </summary>
public static class TemplateLogic
{
    // Mirrors the backend substituteRe (internal/alertmsg/formatter.go) and the web token-reference regex.
    private static readonly Regex TokenReferenceRegex = new(
        @"\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}",
        RegexOptions.CultureInvariant,
        TimeSpan.FromSeconds(1));

    /// <summary>Extract every <c>{{Key}}</c> identifier referenced by <paramref name="template"/>, in order.</summary>
    public static IReadOnlyList<string> ExtractKeys(string? template)
    {
        if (string.IsNullOrEmpty(template))
        {
            return Array.Empty<string>();
        }

        var keys = new List<string>();
        foreach (Match m in TokenReferenceRegex.Matches(template))
        {
            keys.Add(m.Groups[1].Value);
        }

        return keys;
    }

    /// <summary>
    /// Decide whether the autocomplete popover should open given the full <paramref name="text"/> and the
    /// caret (<paramref name="caret"/>). The popover opens only while the caret sits inside an un-closed
    /// <c>{{</c> expression whose partial text contains no whitespace (web <c>handleTextareaChange</c>).
    /// </summary>
    public static AutocompleteHit Scan(string text, int caret)
    {
        if (string.IsNullOrEmpty(text) || caret <= 0 || caret > text.Length)
        {
            return AutocompleteHit.Closed;
        }

        string upToCaret = text[..caret];
        int openIdx = upToCaret.LastIndexOf("{{", StringComparison.Ordinal);
        int closeIdx = upToCaret.LastIndexOf("}}", StringComparison.Ordinal);
        if (openIdx == -1 || openIdx <= closeIdx)
        {
            return AutocompleteHit.Closed;
        }

        string partial = upToCaret[(openIdx + 2)..];
        foreach (char c in partial)
        {
            if (char.IsWhiteSpace(c))
            {
                return AutocompleteHit.Closed;
            }
        }

        return new AutocompleteHit(true, openIdx, partial);
    }

    /// <summary>
    /// Splice the canonical <c>{{key}}</c> form into <paramref name="template"/>, replacing the trigger
    /// window from <paramref name="triggerIndex"/> up to <paramref name="caret"/>, and report the caret
    /// position to restore afterwards (web token-insertion handler).
    /// </summary>
    public static TokenInsertion InsertToken(string template, int triggerIndex, int caret, string key)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(key);

        int safeTrigger = Math.Clamp(triggerIndex, 0, template.Length);
        int safeCaret = Math.Clamp(caret, safeTrigger, template.Length);

        string before = template[..safeTrigger];
        string after = template[safeCaret..];
        string insertion = "{{" + key + "}}";
        string next = before + insertion + after;
        return new TokenInsertion(next, before.Length + insertion.Length);
    }
}

/// <summary>A display group of insert tokens that share a <see cref="Group"/> label (autocomplete catalog).</summary>
public sealed record MessageTokenGroup(string Group, IReadOnlyList<MessageToken> Tokens);

/// <summary>
/// Pure token-catalog logic — filtering by the typed needle and grouping by <see cref="MessageToken.Group"/>
/// for the grouped autocomplete render (web token-filter and grouping memos).
/// </summary>
public static class TokenCatalog
{
    /// <summary>Filter <paramref name="tokens"/> to those whose key or label contains <paramref name="needle"/> (case-insensitive).</summary>
    public static IReadOnlyList<MessageToken> Filter(IReadOnlyList<MessageToken> tokens, string? needle)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        string trimmed = (needle ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return tokens;
        }

        var matched = new List<MessageToken>(tokens.Count);
        foreach (var token in tokens)
        {
            if (token.Key.Contains(trimmed, StringComparison.OrdinalIgnoreCase) ||
                token.Label.Contains(trimmed, StringComparison.OrdinalIgnoreCase))
            {
                matched.Add(token);
            }
        }

        return matched;
    }

    /// <summary>Group <paramref name="tokens"/> by their group label, preserving first-seen order (web <c>grouped</c>).</summary>
    public static IReadOnlyList<MessageTokenGroup> Group(IReadOnlyList<MessageToken> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        var order = new List<string>();
        var byGroup = new Dictionary<string, List<MessageToken>>(StringComparer.Ordinal);
        foreach (var token in tokens)
        {
            if (!byGroup.TryGetValue(token.Group, out var list))
            {
                list = new List<MessageToken>();
                byGroup[token.Group] = list;
                order.Add(token.Group);
            }

            list.Add(token);
        }

        var groups = new List<MessageTokenGroup>(order.Count);
        foreach (var name in order)
        {
            groups.Add(new MessageTokenGroup(name, byGroup[name]));
        }

        return groups;
    }
}

/// <summary>
/// Pure preset-gallery logic — the op-validity filter, tag extraction and tag filtering that keep the
/// preset gallery in lockstep with the available tokens (web <c>opValidPresets</c> / <c>presetTags</c> /
/// <c>filteredPresets</c>).
/// </summary>
public static class PresetGallery
{
    /// <summary>
    /// Filter <paramref name="presets"/> to those whose template references only tokens the current op
    /// populates. Degrades to showing all presets while the token catalog is still loading, the catalog is
    /// empty for any reason, or the rule has no op yet (web parity: better to over-show for one frame than
    /// flash an empty gallery).
    /// </summary>
    public static IReadOnlyList<MessagePreset> OpValid(
        IReadOnlyList<MessagePreset> presets,
        IReadOnlySet<string> availableKeys,
        string? op,
        bool tokensLoading)
    {
        ArgumentNullException.ThrowIfNull(presets);
        ArgumentNullException.ThrowIfNull(availableKeys);

        if (tokensLoading || availableKeys.Count == 0 || string.IsNullOrEmpty(op))
        {
            return presets;
        }

        var valid = new List<MessagePreset>(presets.Count);
        foreach (var preset in presets)
        {
            bool ok = true;
            foreach (var key in TemplateLogic.ExtractKeys(preset.Template))
            {
                if (!availableKeys.Contains(key))
                {
                    ok = false;
                    break;
                }
            }

            if (ok)
            {
                valid.Add(preset);
            }
        }

        return valid;
    }

    /// <summary>The sorted, de-duplicated set of tags across <paramref name="presets"/> (web <c>presetTags</c>).</summary>
    public static IReadOnlyList<string> Tags(IReadOnlyList<MessagePreset> presets)
    {
        ArgumentNullException.ThrowIfNull(presets);
        var set = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var preset in presets)
        {
            foreach (var tag in preset.Tags)
            {
                if (!string.IsNullOrEmpty(tag))
                {
                    set.Add(tag);
                }
            }
        }

        return set.ToArray();
    }

    /// <summary>Filter <paramref name="presets"/> by the active <paramref name="tag"/> (null = "All").</summary>
    public static IReadOnlyList<MessagePreset> FilterByTag(IReadOnlyList<MessagePreset> presets, string? tag)
    {
        ArgumentNullException.ThrowIfNull(presets);
        if (string.IsNullOrEmpty(tag))
        {
            return presets;
        }

        var matched = new List<MessagePreset>(presets.Count);
        foreach (var preset in presets)
        {
            if (preset.Tags.Contains(tag, StringComparer.Ordinal))
            {
                matched.Add(preset);
            }
        }

        return matched;
    }

    /// <summary>The set of token keys that the available token catalog populates (web <c>availableKeys</c>).</summary>
    public static IReadOnlySet<string> AvailableKeys(IReadOnlyList<MessageToken> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var token in tokens)
        {
            keys.Add(token.Key);
        }

        return keys;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> token emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;MessageToken&gt;&gt;</c>, preserving every freshness flag so
/// the view-model can render the full state matrix. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class MessageTokenResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<MessageToken>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return CatalogResultMapper.Map(raw, MessageToken.ParseList);
    }
}

/// <summary>Token-preserving mapper for the preset catalog (see <see cref="MessageTokenResultMapper"/>).</summary>
public static class MessagePresetResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<MessagePreset>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return CatalogResultMapper.Map(raw, MessagePreset.ParseList);
    }
}

/// <summary>
/// Shared cache-then-network result projection for the editor's two JSON-array catalogs. Parses the
/// payload with the supplied <paramref name="parse"/> delegate while preserving the cached / refreshing /
/// stale / offline / loaded / empty status, collapsing a loaded-but-empty array to the Empty state.
/// </summary>
internal static class CatalogResultMapper
{
    public static RepositoryResult<IReadOnlyList<T>> Map<T>(
        RepositoryResult<JsonElement> raw,
        Func<JsonElement, IReadOnlyList<T>> parse)
    {
        IReadOnlyList<T> Parsed() => raw.HasValue ? parse(raw.Value) : Array.Empty<T>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<T>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<T>>.Cached(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<T>>.Refreshing(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parsed(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<T>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<T>>.OfflineCached(Parsed(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<T>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<T>> ToLoadedOrEmpty<T>(IReadOnlyList<T> parsed, DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<T>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<T>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>
/// Canonical registry metadata for the Alert Message Editor surface — the native mirror of the web
/// component's identity. Carries the diagnostics surface slug emitted with the <c>view.opened</c> event.
/// </summary>
public static class AlertMessageEditorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "alert-message-editor";

    /// <summary>Surface category (notifications / Alert Studio).</summary>
    public const string Category = "notifications";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AlertMessageEditor";
}

/// <summary>
/// PII-safe diagnostics for the Alert Message Editor surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a template body, signal value
/// or rendered message — so a diagnostics line can never leak what the alert is about. Thread-safe.
/// </summary>
public sealed class AlertMessageEditorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AlertMessageEditorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertMessageEditor</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertMessageEditorRegistration.Slug}");
    }
}

/// <summary>
/// The single keyed call site for every Alert Message Editor display string (P1/S10 i18n facade). Each
/// member routes its web i18n key through <see cref="ILocalizer"/> with the English fallback from
/// web/src/features/notifications/components/AlertMessageEditor.tsx, so the keys are asserted in tests and
/// resolved for real in the app. No English literal lives anywhere else in the surface.
/// </summary>
public static class AlertMessageEditorText
{
    /// <summary>Checkbox label: "Include title in notifications".</summary>
    public static string IncludeTitleLabel(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.includeTitleLabel", "Include title in notifications");

    /// <summary>Help text for the include-title toggle.</summary>
    public static string IncludeTitleHelp(ILocalizer l) =>
        Get(
            l,
            "notifications.alertStudio.editor.includeTitleHelp",
            "When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title.");

    /// <summary>Message-template field label: "Message Template".</summary>
    public static string MessageTemplateLabel(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.messageTemplateLabel", "Message Template");

    /// <summary>Inline hint next to the message-template label.</summary>
    public static string MessageTemplateHint(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.messageTemplateHint", "Type {{ to insert a placeholder"); // parity:allow web-parity i18n fallback: domain term in user-facing hint (ADR-014)

    /// <summary>Help text for the message-template field.</summary>
    public static string MessageTemplateHelp(ILocalizer l) =>
        Get(
            l,
            "notifications.alertStudio.editor.messageTemplateHelp",
            "Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body."); // parity:allow web-parity i18n fallback: domain term in user-facing help (ADR-014)

    /// <summary>Hint shown inside the empty template field.</summary>
    public static string MessageTemplateHintText(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.messageTemplatePlaceholder", "Battery at {{BatteryLevel}}% \u2014 leave blank for the smart default"); // parity:allow web-parity i18n key id mirrors web catalog key name (ADR-014)

    /// <summary>Preset-gallery trigger button text: "Pick a preset".</summary>
    public static string PresetButton(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.presetButton", "Pick a preset");

    /// <summary>Accessible name for the autocomplete popover.</summary>
    public static string AutocompleteLabel(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.autocompleteLabel", "Placeholder suggestions"); // parity:allow web-parity i18n fallback: domain term for the {{Key}} catalog (ADR-014)

    /// <summary>Empty-state message for the autocomplete popover.</summary>
    public static string AutocompleteEmpty(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.autocompleteEmpty", "No matching placeholders"); // parity:allow web-parity i18n fallback: domain term for the {{Key}} catalog (ADR-014)

    /// <summary>Generic loading label.</summary>
    public static string Loading(ILocalizer l) => Get(l, "common.loading", "Loading\u2026");

    /// <summary>Preview pane header: "Preview".</summary>
    public static string PreviewLabel(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.previewLabel", "Preview");

    /// <summary>Preview empty-state message.</summary>
    public static string PreviewEmpty(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.previewEmpty", "Start typing to see a preview");

    /// <summary>Preview body when the rendered body is empty (title carries the alert).</summary>
    public static string PreviewEmptyBody(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.previewEmptyBody", "(no body \u2014 title carries the alert)");

    /// <summary>Generic preview failure message (fallback when the server gives none).</summary>
    public static string PreviewErrorText(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.previewError", "Preview failed");

    /// <summary>Preset-gallery modal title: "Message Presets".</summary>
    public static string PresetModalTitle(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.presetModalTitle", "Message Presets");

    /// <summary>Intro copy inside the preset gallery.</summary>
    public static string PresetModalIntro(ILocalizer l) =>
        Get(
            l,
            "notifications.alertStudio.editor.presetModalIntro",
            "Curated templates for common alert shapes. Click one to apply it; you can edit it afterwards.");

    /// <summary>The "All" tag chip.</summary>
    public static string PresetAllTag(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.presetAllTag", "All");

    /// <summary>Preset-gallery empty-state message.</summary>
    public static string PresetEmpty(ILocalizer l) =>
        Get(l, "notifications.alertStudio.editor.presetEmpty", "No presets match this filter");

    /// <summary>Close button for the preset gallery.</summary>
    public static string Close(ILocalizer l) => Get(l, "common.close", "Close");

    /// <summary>Retry affordance for a failed catalog load.</summary>
    public static string Retry(ILocalizer l) => Get(l, "common.retry", "Retry");

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>Null-tolerant <see cref="JsonElement"/> readers shared by the editor's parsers.</summary>
internal static class JsonRead
{
    public static string? String(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static IReadOnlyList<string> StringList(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(v.GetArrayLength());
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                string? s = item.GetString();
                if (!string.IsNullOrEmpty(s))
                {
                    list.Add(s);
                }
            }
        }

        return list;
    }
}
