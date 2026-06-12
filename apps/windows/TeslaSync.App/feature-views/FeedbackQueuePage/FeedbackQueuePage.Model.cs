using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>FeedbackQueuePage</c> surface — the native mirror of the four
/// data states the web page renders (web/src/features/admin/pages/FeedbackQueuePage.tsx). The web page runs the
/// <c>useFeedbackList</c> query and renders, in precedence order, the spinner (web <c>isLoading</c>), the failure
/// surface (web <c>isError</c> → <c>QueryError</c>), the empty state (web <c>items.length === 0</c>) and otherwise
/// the data table. This enum is the top-level summary the ledger/Narrator key off; per-region visibility is still
/// driven by the projected flags so each branch renders exactly as the web composes them.
/// </summary>
public enum FeedbackQueueState
{
    /// <summary>The list query is in flight (web <c>isLoading</c>) — the panel shows the spinner.</summary>
    Loading,

    /// <summary>The list query resolved with no rows (web <c>!isLoading &amp;&amp; items.length === 0</c>).</summary>
    Empty,

    /// <summary>The list query failed (web <c>isError</c>) — the panel shows the query-error surface.</summary>
    Error,

    /// <summary>The list query produced rows (web <c>items.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// One user-feedback row — the native mirror of the web <c>FeedbackEntry</c> (web/src/api/types.ts). Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// <c>RecentErrorsJson</c> captures the raw <c>recent_errors</c> JSON text (the web <c>unknown</c> blob), or null
/// when the API sent null/absent. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FeedbackEntry(
    long Id,
    string CreatedAt,
    string Category,
    string Title,
    string Body,
    string PageRoute,
    string UserAgent,
    string AppVersion,
    string UserEmail,
    string? RecentErrorsJson,
    string ConsoleTail,
    string Status,
    string GithubIssueUrl,
    string SubmitterSubject,
    string SubmitterIp,
    string? TriagedAt,
    string TriagedBy)
{
    /// <summary>Parse a feedback JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<FeedbackEntry> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<FeedbackEntry>();
        }

        var list = new List<FeedbackEntry>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one feedback row from a JSON object, tolerating missing / null fields.</summary>
    public static FeedbackEntry FromJson(JsonElement o) => new(
        Id: JsonReadHelpers.Long(o, "id") ?? 0,
        CreatedAt: JsonReadHelpers.Str(o, "created_at") ?? string.Empty,
        Category: JsonReadHelpers.Str(o, "category") ?? string.Empty,
        Title: JsonReadHelpers.Str(o, "title") ?? string.Empty,
        Body: JsonReadHelpers.Str(o, "body") ?? string.Empty,
        PageRoute: JsonReadHelpers.Str(o, "page_route") ?? string.Empty,
        UserAgent: JsonReadHelpers.Str(o, "user_agent") ?? string.Empty,
        AppVersion: JsonReadHelpers.Str(o, "app_version") ?? string.Empty,
        UserEmail: JsonReadHelpers.Str(o, "user_email") ?? string.Empty,
        RecentErrorsJson: RawJson(o, "recent_errors"),
        ConsoleTail: JsonReadHelpers.Str(o, "console_tail") ?? string.Empty,
        Status: JsonReadHelpers.Str(o, "status") ?? string.Empty,
        GithubIssueUrl: JsonReadHelpers.Str(o, "github_issue_url") ?? string.Empty,
        SubmitterSubject: JsonReadHelpers.Str(o, "submitter_subject") ?? string.Empty,
        SubmitterIp: JsonReadHelpers.Str(o, "submitter_ip") ?? string.Empty,
        TriagedAt: JsonReadHelpers.Str(o, "triaged_at"),
        TriagedBy: JsonReadHelpers.Str(o, "triaged_by") ?? string.Empty);

    // web row.recent_errors is an arbitrary JSON blob (object/array): capture its raw text when present and
    // non-null, mirroring the web `row.recent_errors !== null && !== undefined` gate.
    private static string? RawJson(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v) ||
            v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return v.GetRawText();
    }
}

/// <summary>
/// One resolved page of feedback plus the total row count and the GitHub-bridge configuration flags — the native
/// mirror of the web <c>FeedbackListResponse</c> (web/src/api/types.ts). Pure data; parsing is null-tolerant.
/// </summary>
public sealed record FeedbackListSnapshot(
    IReadOnlyList<FeedbackEntry> Items,
    int Total,
    bool GithubBridgeEnabled,
    string GithubRepo)
{
    /// <summary>An empty, resolved snapshot (no rows, bridge disabled) — the default local-state feed result.</summary>
    public static FeedbackListSnapshot Empty { get; } = new(Array.Empty<FeedbackEntry>(), 0, false, string.Empty);

    /// <summary>Read the list response from JSON, tolerating missing / null fields.</summary>
    public static FeedbackListSnapshot FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var items = o.TryGetProperty("items", out var arr)
            ? FeedbackEntry.ParseList(arr)
            : Array.Empty<FeedbackEntry>();

        return new FeedbackListSnapshot(
            Items: items,
            Total: (int)(JsonReadHelpers.Long(o, "total") ?? items.Count),
            GithubBridgeEnabled: JsonReadHelpers.Bool(o, "github_bridge_enabled") ?? false,
            GithubRepo: JsonReadHelpers.Str(o, "github_repo") ?? string.Empty);
    }
}

/// <summary>
/// The active filter set — the native union of the web URL-state filters (<c>status</c>, <c>category</c>). Empty
/// strings mean "unset" (the web's "All …" head option, which sends no query param).
/// </summary>
public sealed record FeedbackFilter(string Status, string Category)
{
    /// <summary>The all-empty filter (no active filters, full history).</summary>
    public static FeedbackFilter Empty { get; } = new(string.Empty, string.Empty);

    /// <summary>Whether either filter is active.</summary>
    public bool HasAny => Status.Length > 0 || Category.Length > 0;
}

/// <summary>The query the <c>FeedbackQueuePage</c> feed answers — the active filter set, the zero-based page and the page size.</summary>
public sealed record FeedbackQueueQuery(FeedbackFilter Filter, int Page, int Limit);

/// <summary>
/// The mutation payload for a single feedback row — the native mirror of the web <c>FeedbackUpdateInput</c>
/// (web/src/api/types.ts). Null members are omitted from the PATCH body (the web <c>useUpdateFeedback</c> only
/// sends the touched field): a status change, a manual GitHub-issue URL, or the forward-to-GitHub request.
/// </summary>
public sealed record FeedbackUpdate(string? Status = null, string? GithubIssueUrl = null, bool? ForwardToGithub = null);

/// <summary>
/// The data port the <see cref="FeedbackQueuePageViewModel"/> reads a page of feedback through and writes row
/// updates back through — the native parity of the web <c>useFeedbackList</c> + <c>useUpdateFeedback</c> hooks. The
/// view never performs HTTP itself; the default <see cref="EmptyFeedbackQueueFeed"/> resolves to the empty state and
/// the generated-client-backed <see cref="FeedbackQueueClientFeed"/> binds to <c>GET /admin/feedback</c> +
/// <c>PATCH /admin/feedback/{id}</c> (ADR-004).
/// </summary>
public interface IFeedbackQueueFeed
{
    /// <summary>Resolve the snapshot for <paramref name="query"/> (web <c>useFeedbackList</c>).</summary>
    Task<FeedbackListSnapshot> FetchAsync(FeedbackQueueQuery query, CancellationToken cancellationToken);

    /// <summary>Apply <paramref name="update"/> to feedback row <paramref name="id"/> (web <c>useUpdateFeedback</c>).</summary>
    Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every query to the empty snapshot and no-ops updates (the empty data state).</summary>
public sealed class EmptyFeedbackQueueFeed : IFeedbackQueueFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFeedbackQueueFeed Instance { get; } = new();

    private EmptyFeedbackQueueFeed()
    {
    }

    /// <inheritdoc />
    public Task<FeedbackListSnapshot> FetchAsync(FeedbackQueueQuery query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(FeedbackListSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// Maps a feedback category / status to its semantic badge tint — the native port of the web
/// <c>CategoryBadge</c> / <c>StatusBadge</c> variant maps (web/src/features/admin/pages/FeedbackQueuePage.tsx).
/// UI-free so the mappings are unit-tested without a XAML runtime.
/// </summary>
public static class FeedbackBadges
{
    /// <summary>Tint for a category (web: bug → danger, feature → info, other → neutral).</summary>
    public static StatusKind Category(string category) => category switch
    {
        "bug" => StatusKind.Danger,
        "feature" => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

    /// <summary>Tint for a status (web: new → warning, triaged → success, closed → neutral).</summary>
    public static StatusKind Status(string status) => status switch
    {
        "new" => StatusKind.Warning,
        "triaged" => StatusKind.Success,
        _ => StatusKind.Neutral,
    };
}

/// <summary>One <c>&lt;Select&gt;</c> option (value + localized label) — native mirror of the web option objects.</summary>
public sealed record FeedbackSelectOption(string Value, string Label);

/// <summary>The seven localized data-table column headers (web <c>columns</c>).</summary>
public sealed record FeedbackColumnLabels(
    string Created,
    string Category,
    string Title,
    string PageRoute,
    string Reporter,
    string Status,
    string Github);

/// <summary>
/// The localized expanded-detail headings + inline-action labels (web <c>FeedbackExpansion</c>), resolved once and
/// reused by every expanded row, plus the per-row status select options (web <c>statusOptions</c>).
/// </summary>
public sealed record FeedbackDetailLabels(
    string Body,
    string AppVersion,
    string UserAgent,
    string Submitter,
    string UserEmail,
    string RecentErrors,
    string ConsoleTail,
    string ChangeStatus,
    string GithubUrl,
    string SaveUrl,
    string Forward,
    string MaskedEmail,
    string GithubUrlHint,
    IReadOnlyList<FeedbackSelectOption> StatusOptions);

/// <summary>One projected, render-ready feedback row (collapsed table cells + always-built expanded detail).</summary>
public sealed record FeedbackRowDisplay(
    long Id,
    string Created,
    string CategoryLabel,
    StatusKind CategoryVariant,
    string Title,
    string PageRoute,
    bool HasPageRoute,
    string ReporterName,
    string ReporterSecondary,
    string StatusLabel,
    StatusKind StatusVariant,
    string GithubUrl,
    bool HasGithubUrl,
    string OpenIssueLabel,
    bool IsExpanded,
    string Body,
    string AppVersion,
    string UserAgent,
    string Submitter,
    string UserEmail,
    bool HasUserEmail,
    string RecentErrorsJson,
    bool HasRecentErrors,
    string ConsoleTail,
    bool HasConsoleTail,
    string CurrentStatus,
    bool ShowForward,
    string AutomationName);

/// <summary>
/// The render-time data model the <c>FeedbackQueuePage</c> projects from — the native analogue of the web page's
/// resolved query + URL state (web/src/features/admin/pages/FeedbackQueuePage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Items">The current page of feedback rows (web <c>data.items</c>).</param>
/// <param name="Total">The total row count across all pages (web <c>data.total</c>).</param>
/// <param name="GithubBridgeEnabled">Whether the server GitHub bridge is configured (web <c>data.github_bridge_enabled</c>).</param>
/// <param name="Loading">Whether the list query is in flight (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether the list query failed (web <c>isError</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface (web <c>getErrorMessage(error)</c>).</param>
/// <param name="Filter">The active filter set.</param>
/// <param name="Page">The current zero-based page index (web <c>page</c>).</param>
/// <param name="Limit">The page size (web <c>PAGE_SIZE</c> = 25).</param>
/// <param name="ExpandedId">The id of the expanded row, or null when none is expanded.</param>
public sealed record FeedbackQueueModel(
    IReadOnlyList<FeedbackEntry> Items,
    int Total,
    bool GithubBridgeEnabled,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    FeedbackFilter Filter,
    int Page,
    int Limit,
    long? ExpandedId)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static FeedbackQueueModel Initial { get; } = new(
        Items: Array.Empty<FeedbackEntry>(),
        Total: 0,
        GithubBridgeEnabled: false,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Filter: FeedbackFilter.Empty,
        Page: 0,
        Limit: FeedbackQueueRegistration.PageSize,
        ExpandedId: null);
}

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds the single GlassPanel's filters region, the four data-state flags (each a visible region), the
/// table column headers/rows, the per-row expanded detail labels, and the pagination chrome. Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record FeedbackQueueDisplay(
    FeedbackQueueState State,
    string Title,
    string StatusFilterLabel,
    IReadOnlyList<FeedbackSelectOption> StatusFilterOptions,
    string SelectedStatus,
    string CategoryFilterLabel,
    IReadOnlyList<FeedbackSelectOption> CategoryFilterOptions,
    string SelectedCategory,
    string RefreshLabel,
    bool ShowBridgeDisabled,
    string BridgeDisabledText,
    bool HasError,
    string ErrorText,
    string RetryLabel,
    bool ShowLoading,
    string LoadingText,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowRows,
    FeedbackColumnLabels ColumnLabels,
    IReadOnlyList<FeedbackRowDisplay> Rows,
    FeedbackDetailLabels DetailLabels,
    bool ShowPagination,
    string PreviousLabel,
    string NextLabel,
    string PageOfText,
    bool CanGoPrevious,
    bool CanGoNext,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="FeedbackQueueModel"/> to its <see cref="FeedbackQueueDisplay"/> — the native
/// port of the render logic in web/src/features/admin/pages/FeedbackQueuePage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names; timestamps format through <see cref="DateTimeFormatting"/>
/// so the C# output matches the web <c>formatDateTime</c>. Every chrome string is resolved on every projection
/// (visibility is gated by the returned flags), so the i18n contract holds in every data state. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class FeedbackQueueProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    private static readonly JsonSerializerOptions PrettyOptions = new() { WriteIndented = true };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + URL state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static FeedbackQueueDisplay Project(FeedbackQueueModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("feedback.queue.title", "Feedback queue");

        // ── Filters region (web GlassPanel header) ───────────────────────────────────────────────────────
        string statusFilterLabel = localizer.GetString("feedback.queue.filter.status", "Status");
        string categoryFilterLabel = localizer.GetString("feedback.queue.filter.category", "Category");
        string allStatuses = localizer.GetString("feedback.queue.filter.allStatuses", "All statuses");
        string allCategories = localizer.GetString("feedback.queue.filter.allCategories", "All categories");

        // Resolved once and reused for both the badges and the select-option labels.
        var statusLabels = StatusLabels(localizer);
        var categoryLabels = CategoryLabels(localizer);

        var statusFilterOptions = new List<FeedbackSelectOption>(4)
        {
            new(string.Empty, allStatuses),
            new("new", statusLabels["new"]),
            new("triaged", statusLabels["triaged"]),
            new("closed", statusLabels["closed"]),
        };
        var categoryFilterOptions = new List<FeedbackSelectOption>(4)
        {
            new(string.Empty, allCategories),
            new("bug", categoryLabels["bug"]),
            new("feature", categoryLabels["feature"]),
            new("other", categoryLabels["other"]),
        };

        string refreshLabel = localizer.GetString("common.refresh", "Refresh");
        string bridgeDisabledText = localizer.GetString(
            "feedback.queue.bridgeDisabled",
            "GitHub Issues bridge is not configured on this server (set TESLASYNC_GITHUB_REPO + TESLASYNC_GITHUB_TOKEN to enable forwarding).");

        // ── Failure surface (web QueryError) ──────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Empty / loading branches ───────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("feedback.queue.empty", "No feedback yet");
        string emptyMessage = localizer.GetString(
            "feedback.queue.emptyMessage",
            "User-submitted bug reports and feature requests will appear here.");

        // ── Table column headers (web columns) ───────────────────────────────────────────────────────────
        var columnLabels = new FeedbackColumnLabels(
            Created: localizer.GetString("feedback.queue.col.created", "Created"),
            Category: localizer.GetString("feedback.queue.col.category", "Category"),
            Title: localizer.GetString("feedback.queue.col.title", "Title"),
            PageRoute: localizer.GetString("feedback.queue.col.pageRoute", "Page"),
            Reporter: localizer.GetString("feedback.queue.col.reporter", "Reporter"),
            Status: localizer.GetString("feedback.queue.col.status", "Status"),
            Github: localizer.GetString("feedback.queue.col.github", "GitHub"));

        string openIssueLabel = localizer.GetString("feedback.queue.openIssue", "Open issue");

        // ── Expanded-detail labels (web FeedbackExpansion), resolved once ──────────────────────────────────
        var detailLabels = DetailLabels(localizer, statusLabels);

        // ── Rows ──────────────────────────────────────────────────────────────────────────────────────────
        var rows = new List<FeedbackRowDisplay>(model.Items.Count);
        foreach (var entry in model.Items)
        {
            rows.Add(ProjectRow(entry, model, categoryLabels, statusLabels, openIssueLabel, now));
        }

        bool showLoading = model.Loading;
        bool showError = model.HasError;
        bool showEmpty = !model.Loading && !model.HasError && rows.Count == 0;
        bool showRows = !model.Loading && !model.HasError && rows.Count > 0;

        // ── Pagination (web totalPages = max(1, ceil(total / PAGE_SIZE))) ──────────────────────────────────
        int limit = model.Limit <= 0 ? FeedbackQueueRegistration.PageSize : model.Limit;
        int total = model.Total;
        int totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)limit));
        string previousLabel = localizer.GetString("common.previous", "Previous");
        string nextLabel = localizer.GetString("common.next", "Next");
        string pageOfTemplate = localizer.GetString("feedback.queue.pageOf", "Page {0} of {1} ({2} entries)");
        string pageOfText = string.Format(
            CultureInfo.CurrentCulture,
            pageOfTemplate,
            model.Page + 1,
            totalPages,
            total);
        bool canGoPrevious = model.Page > 0;
        bool canGoNext = model.Page + 1 < totalPages;

        var state = SelectState(model, rows.Count);

        return new FeedbackQueueDisplay(
            State: state,
            Title: title,
            StatusFilterLabel: statusFilterLabel,
            StatusFilterOptions: statusFilterOptions,
            SelectedStatus: model.Filter.Status,
            CategoryFilterLabel: categoryFilterLabel,
            CategoryFilterOptions: categoryFilterOptions,
            SelectedCategory: model.Filter.Category,
            RefreshLabel: refreshLabel,
            ShowBridgeDisabled: !model.GithubBridgeEnabled,
            BridgeDisabledText: bridgeDisabledText,
            HasError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowRows: showRows,
            ColumnLabels: columnLabels,
            Rows: rows,
            DetailLabels: detailLabels,
            ShowPagination: showRows,
            PreviousLabel: previousLabel,
            NextLabel: nextLabel,
            PageOfText: pageOfText,
            CanGoPrevious: canGoPrevious,
            CanGoNext: canGoNext,
            AutomationName: title);
    }

    /// <summary>Resolve the expanded-detail headings + action labels (web <c>FeedbackExpansion</c>).</summary>
    public static FeedbackDetailLabels DetailLabels(ILocalizer localizer) =>
        DetailLabels(localizer, StatusLabels(localizer));

    /// <summary>Pretty-print a JSON blob (web <c>JSON.stringify(value, null, 2)</c>); raw on parse failure.</summary>
    public static string PrettyJson(string data)
    {
        try
        {
            using var doc = JsonDocument.Parse(data);
            return JsonSerializer.Serialize(doc.RootElement, PrettyOptions);
        }
        catch (JsonException)
        {
            return data;
        }
    }

    private static FeedbackDetailLabels DetailLabels(ILocalizer localizer, Dictionary<string, string> statusLabels)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var statusOptions = new List<FeedbackSelectOption>(3)
        {
            new("new", statusLabels["new"]),
            new("triaged", statusLabels["triaged"]),
            new("closed", statusLabels["closed"]),
        };

        return new FeedbackDetailLabels(
            Body: localizer.GetString("feedback.queue.expand.body", "Report body"),
            AppVersion: localizer.GetString("feedback.queue.expand.appVersion", "App version"),
            UserAgent: localizer.GetString("feedback.queue.expand.userAgent", "User agent"),
            Submitter: localizer.GetString("feedback.queue.expand.submitter", "Submitter"),
            UserEmail: localizer.GetString("feedback.queue.expand.userEmail", "Email"),
            RecentErrors: localizer.GetString("feedback.queue.expand.recentErrors", "Recent frontend errors"),
            ConsoleTail: localizer.GetString("feedback.queue.expand.consoleTail", "Console tail"),
            ChangeStatus: localizer.GetString("feedback.queue.action.changeStatus", "Status"),
            GithubUrl: localizer.GetString("feedback.queue.action.githubUrl", "GitHub issue URL"),
            SaveUrl: localizer.GetString("feedback.queue.action.saveUrl", "Save URL"),
            Forward: localizer.GetString("feedback.queue.action.forward", "Forward to GitHub"),
            MaskedEmail: localizer.GetString("feedback.queue.maskedEmail", "Reporter email, click to reveal"),
            GithubUrlHint: "https://github.com/owner/repo/issues/123",
            StatusOptions: statusOptions);
    }

    private static FeedbackRowDisplay ProjectRow(
        FeedbackEntry entry,
        FeedbackQueueModel model,
        Dictionary<string, string> categoryLabels,
        Dictionary<string, string> statusLabels,
        string openIssueLabel,
        DateTimeOffset now)
    {
        string created = FormatTimestamp(entry.CreatedAt, now);
        string categoryLabel = categoryLabels.TryGetValue(entry.Category, out var cl) ? cl : entry.Category;
        string statusLabel = statusLabels.TryGetValue(entry.Status, out var sl) ? sl : entry.Status;
        bool hasPageRoute = !string.IsNullOrEmpty(entry.PageRoute);
        bool hasGithub = !string.IsNullOrEmpty(entry.GithubIssueUrl);
        bool hasEmail = !string.IsNullOrEmpty(entry.UserEmail);
        bool hasRecentErrors = !string.IsNullOrEmpty(entry.RecentErrorsJson);
        bool hasConsoleTail = !string.IsNullOrEmpty(entry.ConsoleTail);

        // web UserCell user={{ id: submitter_subject, email: user_email }}: the e-mail is the primary identity
        // line and the subject the secondary line, so an anonymous IP-only report still renders a stable cell.
        string reporterName = hasEmail
            ? entry.UserEmail
            : !string.IsNullOrEmpty(entry.SubmitterSubject) ? entry.SubmitterSubject : EmDash;
        string reporterSecondary = hasEmail && !string.IsNullOrEmpty(entry.SubmitterSubject)
            ? entry.SubmitterSubject
            : string.Empty;

        string submitter = !string.IsNullOrEmpty(entry.SubmitterSubject)
            ? entry.SubmitterSubject
            : !string.IsNullOrEmpty(entry.SubmitterIp) ? entry.SubmitterIp : EmDash;

        return new FeedbackRowDisplay(
            Id: entry.Id,
            Created: created,
            CategoryLabel: categoryLabel,
            CategoryVariant: FeedbackBadges.Category(entry.Category),
            Title: string.IsNullOrEmpty(entry.Title) ? EmDash : entry.Title,
            PageRoute: hasPageRoute ? entry.PageRoute : EmDash,
            HasPageRoute: hasPageRoute,
            ReporterName: reporterName,
            ReporterSecondary: reporterSecondary,
            StatusLabel: statusLabel,
            StatusVariant: FeedbackBadges.Status(entry.Status),
            GithubUrl: entry.GithubIssueUrl,
            HasGithubUrl: hasGithub,
            OpenIssueLabel: openIssueLabel,
            IsExpanded: model.ExpandedId == entry.Id,
            Body: string.IsNullOrEmpty(entry.Body) ? EmDash : entry.Body,
            AppVersion: string.IsNullOrEmpty(entry.AppVersion) ? EmDash : entry.AppVersion,
            UserAgent: string.IsNullOrEmpty(entry.UserAgent) ? EmDash : entry.UserAgent,
            Submitter: submitter,
            UserEmail: entry.UserEmail,
            HasUserEmail: hasEmail,
            RecentErrorsJson: hasRecentErrors ? PrettyJson(entry.RecentErrorsJson!) : string.Empty,
            HasRecentErrors: hasRecentErrors,
            ConsoleTail: entry.ConsoleTail,
            HasConsoleTail: hasConsoleTail,
            CurrentStatus: entry.Status,
            ShowForward: model.GithubBridgeEnabled && !hasGithub,
            AutomationName: string.Join(". ", created, categoryLabel, entry.Title, statusLabel));
    }

    private static Dictionary<string, string> CategoryLabels(ILocalizer localizer) => new(StringComparer.Ordinal)
    {
        ["bug"] = localizer.GetString("feedback.category.bug", "Bug report"),
        ["feature"] = localizer.GetString("feedback.category.feature", "Feature request"),
        ["other"] = localizer.GetString("feedback.category.other", "Other / question"),
    };

    private static Dictionary<string, string> StatusLabels(ILocalizer localizer) => new(StringComparer.Ordinal)
    {
        ["new"] = localizer.GetString("feedback.queue.status.new", "New"),
        ["triaged"] = localizer.GetString("feedback.queue.status.triaged", "Triaged"),
        ["closed"] = localizer.GetString("feedback.queue.status.closed", "Closed"),
    };

    // Top-level state: loading dominates, then failure, then the table's own empty / rows branch (web order).
    private static FeedbackQueueState SelectState(FeedbackQueueModel model, int rowCount)
    {
        if (model.Loading)
        {
            return FeedbackQueueState.Loading;
        }

        if (model.HasError)
        {
            return FeedbackQueueState.Error;
        }

        return rowCount == 0 ? FeedbackQueueState.Empty : FeedbackQueueState.Success;
    }

    // web formatDateTime(row.created_at): absolute date-time, or em-dash for null / unparseable input.
    private static string FormatTimestamp(string? raw, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }
}

/// <summary>
/// Canonical metadata for the <c>FeedbackQueuePage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/FeedbackQueuePage.tsx</c> (route <c>/admin/feedback</c>, nav name
/// <c>FeedbackQueue</c>).
/// </summary>
public static class FeedbackQueueRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FeedbackQueuePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>FeedbackQueue</c>).</summary>
    public const string RouteName = "FeedbackQueue";

    /// <summary>The page size (web <c>PAGE_SIZE</c>).</summary>
    public const int PageSize = 25;

    /// <summary>The localized page title (web <c>feedback.queue.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("feedback.queue.title", "Feedback queue");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FeedbackQueuePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a reporter email, body, IP or feedback id —
/// so a diagnostics line can never leak user-submitted content. Thread-safe.
/// </summary>
public sealed class FeedbackQueueDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FeedbackQueueDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FeedbackQueuePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FeedbackQueueRegistration.Slug}");
    }
}
