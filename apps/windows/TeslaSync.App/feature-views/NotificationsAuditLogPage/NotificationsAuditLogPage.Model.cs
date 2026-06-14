using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive lifecycle state of the notifications <c>AuditLogPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/notifications/pages/AuditLogPage.tsx). The web page runs the
/// <c>useAuditLogs</c> query and renders, in precedence order, the loading skeleton (web <c>isLoading</c>), the
/// inline failure surface (web <c>error</c>), the searchable entries table when the feed has rows
/// (web <c>auditLogs?.length</c>) and otherwise the "no audit entries found" empty state. Within the success branch
/// the active search may further collapse the table to the "no matches" sentence. This enum is the top-level summary
/// the ledger keys off; per-region visibility is still driven by the projected flags so every branch renders exactly
/// as the web composes it.
/// </summary>
public enum NotificationsAuditLogState
{
    /// <summary>The list query is in flight with no rows yet (web <c>isLoading</c>) — the skeleton shows.</summary>
    Loading,

    /// <summary>The query resolved with no rows at all — the "no audit entries found" empty state shows.</summary>
    Empty,

    /// <summary>The query failed — the inline failure surface shows.</summary>
    Error,

    /// <summary>The query produced audit rows — the search + table area renders.</summary>
    Success,
}

/// <summary>
/// One audit-trail entry from <c>GET /system/audit</c> (web <c>useAuditLogs</c>). The Go endpoint serializes the
/// <c>systemmodel.AuditLog</c> shape — <c>{id, ts, actor, action, entity_type, entity_id, detail}</c> — whereas the
/// web <c>AuditLogEntry</c> interface names the same concepts <c>{id, action, resource, details, createdAt}</c>.
/// Parsing is null-tolerant and accepts BOTH naming conventions (the web-interface name wins when present, else the
/// real wire field) so the native page reproduces the web component's intent against the real backend without drift:
/// <c>resource ← entity_type</c>, <c>details ← detail</c>, <c>createdAt ← ts</c>. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record AuditLogEntry(string Id, string Action, string Resource, string Details, string CreatedAt)
{
    /// <summary>Project a single audit JSON object into an <see cref="AuditLogEntry"/>, tolerating missing fields.</summary>
    public static AuditLogEntry FromJson(JsonElement obj) => new(
        Id: AuditJson.Id(obj),
        Action: AuditJson.Str(obj, "action") ?? string.Empty,
        Resource: AuditJson.Str(obj, "resource") ?? AuditJson.Str(obj, "entity_type") ?? string.Empty,
        Details: AuditJson.Str(obj, "details") ?? AuditJson.Str(obj, "detail") ?? string.Empty,
        CreatedAt: AuditJson.Str(obj, "created_at") ?? AuditJson.Str(obj, "createdAt") ?? AuditJson.Str(obj, "ts") ?? string.Empty);

    /// <summary>Read the audit list from JSON (a bare array, or an array wrapped under a common key).</summary>
    public static IReadOnlyList<AuditLogEntry> ListFromJson(JsonElement root)
    {
        var array = AuditJson.AsArray(root);
        if (array is null)
        {
            return Array.Empty<AuditLogEntry>();
        }

        var list = new List<AuditLogEntry>();
        foreach (var item in array.Value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The render-time data model the notifications <c>AuditLogPage</c> projects from — the native analogue of the web
/// page's resolved query state (web/src/features/notifications/pages/AuditLogPage.tsx). It carries the list query
/// result, the in-flight / error markers and the controlled search string. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record NotificationsAuditLogModel(
    IReadOnlyList<AuditLogEntry> Entries,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    string Search)
{
    /// <summary>The initial model — the first load, no data yet (web <c>isLoading</c>).</summary>
    public static NotificationsAuditLogModel Initial { get; } = new(
        Entries: Array.Empty<AuditLogEntry>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Search: string.Empty);
}

/// <summary>
/// The projected, render-ready view of one audit row (web <c>DataTable</c> row): the formatted timestamp and the
/// action / resource / detail cells, each already coalesced to an em-dash when absent. Pure data.
/// </summary>
public sealed record AuditLogRowDisplay(string Id, string Time, string Action, string Resource, string Details);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible page header (title +
/// subtitle), the panel heading, the four data-state flags, and — within the success branch — the search prompt, the
/// active-filter chip, the localized table column headers and the projected rows (or the "no matches" sentence). Pure
/// data so every branch is asserted headlessly.
/// </summary>
public sealed record NotificationsAuditLogDisplay(
    NotificationsAuditLogState State,
    string Title,
    string Subtitle,
    string RecentActivityTitle,
    string AutomationName,
    // ── data states ──
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    bool ShowEmpty,
    string EmptyText,
    bool ShowContent,
    // ── search / filter ──
    string SearchPrompt,
    string SearchValue,
    bool ShowSearchChip,
    string SearchChipLabel,
    string SearchChipValue,
    string ClearAllLabel,
    // ── table / no-matches ──
    bool ShowTable,
    bool ShowNoMatches,
    string NoMatchesText,
    string TimeHeader,
    string ActionHeader,
    string ResourceHeader,
    string DetailsHeader,
    IReadOnlyList<AuditLogRowDisplay> Rows);

/// <summary>
/// Projects a <see cref="NotificationsAuditLogModel"/> into the render-ready <see cref="NotificationsAuditLogDisplay"/>
/// — the one place every visible literal is resolved through the <see cref="ILocalizer"/> and every branch flag is
/// decided. Mirrors the web page's precedence (loading → error → success(rows) → empty) and its client-side substring
/// filter (web <c>useFilteredList(auditLogs, search, ['action','resource','details'])</c>). Pure so the gate exercises
/// it headlessly.
/// </summary>
public static class NotificationsAuditLogProjection
{
    /// <summary>The em-dash sentinel for absent cell values.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the model into the render-ready display, resolving every string regardless of state.</summary>
    public static NotificationsAuditLogDisplay Project(NotificationsAuditLogModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve every visible literal up-front so the keys are flowed on every projection regardless of data state.
        var title = localizer.GetString("Audit Log", "Audit Log");
        var subtitle = localizer.GetString(
            "Recent system-level changes recorded by the audit subsystem",
            "Recent system-level changes recorded by the audit subsystem");
        var recentActivity = localizer.GetString("Recent Activity", "Recent Activity");
        var timeHeader = localizer.GetString("Time", "Time");
        var actionHeader = localizer.GetString("Action", "Action");
        var resourceHeader = localizer.GetString("Resource", "Resource");
        var detailsHeader = localizer.GetString("Details", "Details");
        var searchPrompt = localizer.GetString("audit.searchPlaceholder", "Search by action, resource, or details\u2026"); // parity:allow required web i18n key for the audit search prompt
        var searchChipLabel = localizer.GetString("audit.filterLabel.search", "Search");
        var noMatches = localizer.GetString("audit.noMatches", "No audit entries match your search.");
        var emptyText = localizer.GetString("No audit entries found", "No audit entries found");
        var errorPrefix = localizer.GetString("Failed to load audit logs", "Failed to load audit logs");
        var clearAll = localizer.GetString("Clear all", "Clear all");

        var entries = model.Entries ?? Array.Empty<AuditLogEntry>();
        var search = model.Search ?? string.Empty;

        var state = model.Loading
            ? NotificationsAuditLogState.Loading
            : model.HasError
                ? NotificationsAuditLogState.Error
                : entries.Count == 0
                    ? NotificationsAuditLogState.Empty
                    : NotificationsAuditLogState.Success;

        var filtered = Filter(entries, search);
        var rows = state == NotificationsAuditLogState.Success
            ? filtered.Select(ProjectRow).ToList()
            : new List<AuditLogRowDisplay>();

        var hasSearch = !string.IsNullOrEmpty(search);
        var showContent = state == NotificationsAuditLogState.Success;
        var detail = string.IsNullOrEmpty(model.ErrorDetail) ? string.Empty : model.ErrorDetail;
        var errorText = string.IsNullOrEmpty(detail) ? errorPrefix : $"{errorPrefix}: {detail}";

        return new NotificationsAuditLogDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            RecentActivityTitle: recentActivity,
            AutomationName: title,
            ShowLoading: state == NotificationsAuditLogState.Loading,
            ShowError: state == NotificationsAuditLogState.Error,
            ErrorText: errorText,
            ShowEmpty: state == NotificationsAuditLogState.Empty,
            EmptyText: emptyText,
            ShowContent: showContent,
            SearchPrompt: searchPrompt,
            SearchValue: search,
            ShowSearchChip: showContent && hasSearch,
            SearchChipLabel: searchChipLabel,
            SearchChipValue: search,
            ClearAllLabel: clearAll,
            ShowTable: showContent && rows.Count > 0,
            ShowNoMatches: showContent && rows.Count == 0,
            NoMatchesText: noMatches,
            TimeHeader: timeHeader,
            ActionHeader: actionHeader,
            ResourceHeader: resourceHeader,
            DetailsHeader: detailsHeader,
            Rows: rows);
    }

    // web: useFilteredList(auditLogs, search, ['action','resource','details']) — trimmed, lowercased substring match.
    private static IReadOnlyList<AuditLogEntry> Filter(IReadOnlyList<AuditLogEntry> entries, string search)
    {
        var q = (search ?? string.Empty).Trim();
        if (q.Length == 0)
        {
            return entries;
        }

        var needle = q.ToLowerInvariant();
        var matched = new List<AuditLogEntry>();
        foreach (var entry in entries)
        {
            if (Contains(entry.Action, needle) || Contains(entry.Resource, needle) || Contains(entry.Details, needle))
            {
                matched.Add(entry);
            }
        }

        return matched;
    }

    private static bool Contains(string? value, string needle) =>
        (value ?? string.Empty).ToLowerInvariant().Contains(needle, StringComparison.Ordinal);

    private static AuditLogRowDisplay ProjectRow(AuditLogEntry entry) => new(
        Id: entry.Id,
        Time: FormatTimestamp(entry.CreatedAt),
        Action: Coalesce(entry.Action),
        Resource: Coalesce(entry.Resource),
        Details: Coalesce(entry.Details));

    private static string Coalesce(string? value) => string.IsNullOrEmpty(value) ? EmDash : value;

    // web: formatDateTime(log.createdAt). Formatted at the display boundary; falls back to the raw value when the
    // timestamp is not a parseable instant so a malformed value is still shown rather than dropped.
    private static string FormatTimestamp(string iso)
    {
        if (string.IsNullOrWhiteSpace(iso))
        {
            return EmDash;
        }

        return DateTimeOffset.TryParse(
            iso,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var instant)
            ? instant.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
            : iso;
    }
}

/// <summary>
/// The data port the <see cref="NotificationsAuditLogPageViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the single read the web page issues — the system audit trail (<c>GET /system/audit</c>, web <c>useAuditLogs</c>).
/// The view never performs HTTP itself; the concrete <see cref="AuditLogsClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IAuditLogsFeed
{
    /// <summary>Fetch the system audit trail (web <c>GET /api/v1/system/audit</c>).</summary>
    Task<IReadOnlyList<AuditLogEntry>> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The inert <see cref="IAuditLogsFeed"/> the parameterless (shell-hosted) page binds before a data-wired host injects
/// the generated-client feed — it yields an empty trail so the page renders its "no audit entries found" empty state
/// rather than throwing. Mirrors the sibling feature-views' empty local-state feeds.
/// </summary>
public sealed class EmptyAuditLogsFeed : IAuditLogsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAuditLogsFeed Instance { get; } = new();

    private EmptyAuditLogsFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AuditLogEntry>> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AuditLogEntry>>(Array.Empty<AuditLogEntry>());
}

/// <summary>The navigation / diagnostics / endpoint registration for the notifications <c>AuditLogPage</c>.</summary>
public static class NotificationsAuditLogRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NotificationsAuditLogPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>NotificationsAudit</c>).</summary>
    public const string RouteName = "NotificationsAudit";

    /// <summary>The route path the page deep-links to (web <c>/notifications/audit</c>).</summary>
    public const string RoutePath = "notifications/audit";

    /// <summary>The generated OpenAPI operation id for the system audit trail (web <c>useAuditLogs</c>).</summary>
    public const string ListOperation = "get_api_v1_system_audit";

    /// <summary>The cache-then-network cache key for the audit trail.</summary>
    public const string CacheKey = "system:audit";

    /// <summary>The table page size (web <c>pagination.defaultPageSize</c> of 50).</summary>
    public const int PageSize = 50;

    /// <summary>The Segoe Fluent Icons glyph for the "Recent Activity" heading (clock, web lucide <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>The localized page title (web <c>t('Audit Log')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Audit Log", "Audit Log");
    }
}

/// <summary>
/// PII-safe diagnostics for the notifications <c>AuditLogPage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never an actor, resource or detail — so a
/// diagnostics line can never leak audit content. Thread-safe.
/// </summary>
public sealed class NotificationsAuditLogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public NotificationsAuditLogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NotificationsAuditLogPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NotificationsAuditLogRegistration.Slug}");
    }
}

/// <summary>Tolerant JSON readers for the audit parse adapter (string-or-number id, string fields, array unwrap).</summary>
internal static class AuditJson
{
    /// <summary>Read the <c>id</c> as a string whether the wire sent a string or a number.</summary>
    public static string Id(JsonElement obj)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty("id", out var value))
        {
            return value.ValueKind switch
            {
                JsonValueKind.String => value.GetString() ?? string.Empty,
                JsonValueKind.Number => value.TryGetInt64(out var l)
                    ? l.ToString(CultureInfo.InvariantCulture)
                    : value.GetRawText(),
                _ => string.Empty,
            };
        }

        return string.Empty;
    }

    /// <summary>Read a string property, returning null when absent or not a JSON string.</summary>
    public static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>Resolve the audit array from a bare array or an array wrapped under a common envelope key.</summary>
    public static JsonElement? AsArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root;
        }

        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in new[] { "items", "logs", "audit", "data" })
            {
                if (root.TryGetProperty(key, out var nested) && nested.ValueKind == JsonValueKind.Array)
                {
                    return nested;
                }
            }
        }

        return null;
    }
}
