using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>SlowQueriesPage</c> surface — the native mirror of the four
/// data states the web page renders (web/src/features/admin/pages/SlowQueriesPage.tsx). The web page runs the
/// <c>useSlowQueries</c> query and renders, in precedence order, the loading surface (web <c>query.isLoading</c>
/// via <c>PageContainer</c>), the failure surface (a non-503 <c>query.error</c>), then the table's own
/// <c>rows.length === 0 &amp;&amp; !isLoading &amp;&amp; !subsystemMissing ? EmptyState : DataTable</c> branch. The
/// <c>SUBSYSTEM_NOT_CONFIGURED</c> (HTTP 503) case is NOT an error — it surfaces the warning banner above an empty
/// table. This enum is the top-level summary the ledger/Narrator key off; per-region visibility is still driven by
/// the projected flags so the warning banner can sit above any table branch exactly as the web composes them.
/// </summary>
public enum SlowQueriesState
{
    /// <summary>The query is in flight (web <c>isLoading</c>) — the table area shows the spinner.</summary>
    Loading,

    /// <summary>The query resolved with no rows (web <c>!isLoading &amp;&amp; rows.length === 0</c>).</summary>
    Empty,

    /// <summary>The query failed with a non-503 error (web <c>query.error</c>) — the failure surface is shown.</summary>
    Error,

    /// <summary>The query produced rows (web <c>rows.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// One slow-query row — the native mirror of the web <c>SlowQueryRow</c> (web/src/types/admin-operator-confidence.ts).
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// <see cref="SharedBlksHit"/>/<see cref="SharedBlksRead"/> are optional (nullable) exactly as the contract declares.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SlowQueryRow(
    long QueryId,
    string Fingerprint,
    long Calls,
    double TotalTimeMs,
    double MeanTimeMs,
    double MaxTimeMs,
    long RowsReturned,
    long? SharedBlksHit,
    long? SharedBlksRead)
{
    /// <summary>Parse a slow-queries JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<SlowQueryRow> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SlowQueryRow>();
        }

        var list = new List<SlowQueryRow>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one slow-query row from a JSON object, tolerating missing / null fields.</summary>
    public static SlowQueryRow FromJson(JsonElement o) => new(
        QueryId: JsonReadHelpers.Long(o, "query_id") ?? 0,
        Fingerprint: JsonReadHelpers.Str(o, "fingerprint") ?? string.Empty,
        Calls: JsonReadHelpers.Long(o, "calls") ?? 0,
        TotalTimeMs: JsonReadHelpers.Double(o, "total_time_ms") ?? 0,
        MeanTimeMs: JsonReadHelpers.Double(o, "mean_time_ms") ?? 0,
        MaxTimeMs: JsonReadHelpers.Double(o, "max_time_ms") ?? 0,
        RowsReturned: JsonReadHelpers.Long(o, "rows_returned") ?? 0,
        SharedBlksHit: JsonReadHelpers.Long(o, "shared_blks_hit"),
        SharedBlksRead: JsonReadHelpers.Long(o, "shared_blks_read"));
}

/// <summary>
/// One resolved slow-queries response plus the soft-failure flag — the native mirror of the web
/// <c>SlowQueriesResponse</c> (web/src/types/admin-operator-confidence.ts) read through the
/// <c>fetchEnvelope</c>-unwrapped <c>{ data: … }</c> body. <see cref="SubsystemMissing"/> captures the web
/// <c>error.status === 503</c> / <c>SUBSYSTEM_NOT_CONFIGURED</c> branch (pg_stat_statements not installed) which is
/// rendered as a warning, not an error. Pure data; parsing is null-tolerant and unwraps the platform envelope.
/// </summary>
public sealed record SlowQueriesSnapshot(
    string OrderBy,
    IReadOnlyList<SlowQueryRow> Rows,
    bool SubsystemMissing)
{
    /// <summary>An empty, resolved snapshot (no rows) — the default local-state feed result.</summary>
    public static SlowQueriesSnapshot Empty { get; } =
        new(SlowQueriesRegistration.DefaultOrderBy, Array.Empty<SlowQueryRow>(), false);

    /// <summary>The pg_stat_statements-not-configured snapshot (web HTTP 503 / SUBSYSTEM_NOT_CONFIGURED).</summary>
    public static SlowQueriesSnapshot NotConfigured { get; } =
        new(SlowQueriesRegistration.DefaultOrderBy, Array.Empty<SlowQueryRow>(), true);

    /// <summary>
    /// Read the slow-queries response from JSON, unwrapping the platform <c>{ data: … }</c> envelope (web
    /// <c>fetchEnvelope</c>) and tolerating missing / null fields.
    /// </summary>
    public static SlowQueriesSnapshot FromJson(JsonElement root)
    {
        var o = Unwrap(root);
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var rows = o.TryGetProperty("slow_queries", out var arr)
            ? SlowQueryRow.ParseList(arr)
            : Array.Empty<SlowQueryRow>();

        return new SlowQueriesSnapshot(
            OrderBy: JsonReadHelpers.Str(o, "order_by") ?? SlowQueriesRegistration.DefaultOrderBy,
            Rows: rows,
            SubsystemMissing: false);
    }

    private static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("data", out var data)
            && data.ValueKind == JsonValueKind.Object)
        {
            return data;
        }

        return root;
    }
}

/// <summary>The query the <c>SlowQueriesPage</c> feed answers — the active order key and row limit (web URL state).</summary>
public sealed record SlowQueriesQuery(string OrderBy, int Limit);

/// <summary>
/// The data port the <see cref="SlowQueriesPageViewModel"/> reads a page of slow queries through. The
/// generated-client implementation (<see cref="SlowQueriesClientFeed"/>) binds to the OpenAPI contract client
/// (ADR-004); the default <see cref="EmptySlowQueriesFeed"/> resolves to the empty state so the view renders
/// without a network host (tests / headless).
/// </summary>
public interface ISlowQueriesFeed
{
    /// <summary>Resolve the snapshot for <paramref name="query"/>.</summary>
    Task<SlowQueriesSnapshot> FetchAsync(SlowQueriesQuery query, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every query to the empty snapshot (the empty data state).</summary>
public sealed class EmptySlowQueriesFeed : ISlowQueriesFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySlowQueriesFeed Instance { get; } = new();

    private EmptySlowQueriesFeed()
    {
    }

    /// <inheritdoc />
    public Task<SlowQueriesSnapshot> FetchAsync(SlowQueriesQuery query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SlowQueriesSnapshot.Empty);
    }
}

/// <summary>One localized <c>order_by</c> / <c>limit</c> dropdown option (value + display label).</summary>
public sealed record SlowQuerySelectOption(string Value, string Label);

/// <summary>The seven localized data-table column headers (web <c>columns</c>).</summary>
public sealed record SlowQueriesColumnLabels(
    string Fingerprint,
    string Calls,
    string Mean,
    string Max,
    string Total,
    string Rows,
    string Cache);

/// <summary>
/// One render-ready slow-query row — every value formatted at the display boundary (web <c>fmtNumber</c> port via
/// <see cref="NumberFormatting"/>) so the WinUI view is a thin renderer. <see cref="HasFingerprint"/> drives the
/// em-dash fallback the web uses for a blank fingerprint.
/// </summary>
public sealed record SlowQueryRowDisplay(
    string Key,
    string Fingerprint,
    bool HasFingerprint,
    string FingerprintTooltip,
    string Calls,
    string Mean,
    string Max,
    string Total,
    string Rows,
    string Cache);

/// <summary>
/// The render-time data model the <c>SlowQueriesPage</c> projects from — the native analogue of the web page's
/// resolved query + URL state (web/src/features/admin/pages/SlowQueriesPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Rows">The current slow-query rows (web <c>query.data?.slow_queries</c>).</param>
/// <param name="OrderBy">The active order key (web <c>orderBy</c>).</param>
/// <param name="Limit">The active row limit (web <c>limit</c>).</param>
/// <param name="Loading">Whether the query is in flight (web <c>query.isLoading</c>).</param>
/// <param name="HasError">Whether the query failed with a non-503 error (web <c>query.error</c>).</param>
/// <param name="ErrorDetail">The failure detail appended to the error message, when present.</param>
/// <param name="SubsystemMissing">Whether pg_stat_statements is not configured (web <c>error.status === 503</c>).</param>
public sealed record SlowQueriesModel(
    IReadOnlyList<SlowQueryRow> Rows,
    string OrderBy,
    int Limit,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static SlowQueriesModel Initial { get; } = new(
        Rows: Array.Empty<SlowQueryRow>(),
        OrderBy: SlowQueriesRegistration.DefaultOrderBy,
        Limit: SlowQueriesRegistration.DefaultLimit,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);
}

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds the page header, the not-configured warning banner, the single GlassPanel's filter controls
/// (order-by + limit), the four data-state flags (each a visible region) and the table column headers / rows. Pure
/// data so every branch is asserted headlessly.
/// </summary>
public sealed record SlowQueriesDisplay(
    SlowQueriesState State,
    string Title,
    string Subtitle,
    bool ShowSubsystemMissing,
    string SubsystemUnavailableTitle,
    string NotConfiguredText,
    string TableTitle,
    string OrderByLabel,
    IReadOnlyList<SlowQuerySelectOption> OrderByOptions,
    string SelectedOrderBy,
    string LimitLabel,
    IReadOnlyList<SlowQuerySelectOption> LimitOptions,
    string SelectedLimit,
    bool HasError,
    string ErrorText,
    string RetryLabel,
    bool ShowLoading,
    string LoadingText,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    bool ShowTable,
    SlowQueriesColumnLabels ColumnLabels,
    IReadOnlyList<SlowQueryRowDisplay> Rows,
    string EmptyTableMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="SlowQueriesModel"/> to its <see cref="SlowQueriesDisplay"/> — the native port
/// of the render logic in web/src/features/admin/pages/SlowQueriesPage.tsx. Every visible literal resolves through
/// the i18n facade using the exact web key names; numbers format through <see cref="NumberFormatting"/> (the web
/// <c>fmtNumber</c> port) so the C# output matches the web truth. Every chrome string is resolved on every
/// projection (visibility is gated by the returned flags), so the i18n contract holds in every data state. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class SlowQueriesProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The display decimal precision the web <c>fmtNumber</c> default (global precision) renders with.</summary>
    public const int DefaultPrecision = 2;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + URL state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SlowQueriesDisplay Project(SlowQueriesModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Header (web PageContainer title + subtitle) ──────────────────────────────────────────────────
        string title = localizer.GetString("admin.slowQueries.pageTitle", "Slow Queries");
        string subtitle = localizer.GetString(
            "admin.slowQueries.subtitle",
            "Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.");

        // ── Not-configured warning banner (web AlertBanner, error.status === 503) ────────────────────────
        string unavailableTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string notConfigured = localizer.GetString(
            "admin.slowQueries.notConfigured",
            "pg_stat_statements is not installed on this PostgreSQL instance. Run `CREATE EXTENSION pg_stat_statements;` and add it to shared_preload_libraries to enable this page.");

        // ── Panel header + filter controls (web GlassPanel) ──────────────────────────────────────────────
        string tableTitle = localizer.GetString("admin.slowQueries.tableTitle", "Top queries");
        string orderByLabel = localizer.GetString("admin.slowQueries.orderBy", "Order by");
        string limitLabel = localizer.GetString("admin.slowQueries.limit", "Limit");
        var orderByOptions = OrderByOptions(localizer);
        var limitOptions = LimitOptions();

        // ── Failure surface (web QueryError; 503 routes to the warning banner, not here) ─────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Loading / empty branches ─────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("admin.slowQueries.emptyTitle", "No slow queries");
        string emptyMessage = localizer.GetString(
            "admin.slowQueries.emptyMessage",
            "pg_stat_statements is empty or has been reset recently. Slow queries will accumulate here as the system processes load.");
        string emptyTableMessage = localizer.GetString("admin.slowQueries.emptyTable", "No slow queries");

        // ── Table column headers (web columns) ───────────────────────────────────────────────────────────
        var columnLabels = new SlowQueriesColumnLabels(
            Fingerprint: localizer.GetString("admin.slowQueries.colFingerprint", "Query fingerprint"),
            Calls: localizer.GetString("admin.slowQueries.colCalls", "Calls"),
            Mean: localizer.GetString("admin.slowQueries.colMean", "Mean (ms)"),
            Max: localizer.GetString("admin.slowQueries.colMax", "Max (ms)"),
            Total: localizer.GetString("admin.slowQueries.colTotal", "Total (ms)"),
            Rows: localizer.GetString("admin.slowQueries.colRows", "Rows"),
            Cache: localizer.GetString("admin.slowQueries.colCache", "Cache hit ratio"));

        // ── Rows ─────────────────────────────────────────────────────────────────────────────────────────
        var rows = new List<SlowQueryRowDisplay>(model.Rows.Count);
        foreach (var row in model.Rows)
        {
            rows.Add(ProjectRow(row));
        }

        // web: rows.length === 0 && !isLoading && !subsystemMissing ? <EmptyState/> : <DataTable/>
        bool showLoading = model.Loading;
        bool showError = model.HasError;
        bool showEmpty = !model.Loading && !model.HasError && !model.SubsystemMissing && rows.Count == 0;
        bool showTable = !model.Loading && !model.HasError && !showEmpty;

        var state = SelectState(model, rows.Count);

        return new SlowQueriesDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowSubsystemMissing: model.SubsystemMissing,
            SubsystemUnavailableTitle: unavailableTitle,
            NotConfiguredText: notConfigured,
            TableTitle: tableTitle,
            OrderByLabel: orderByLabel,
            OrderByOptions: orderByOptions,
            SelectedOrderBy: model.OrderBy,
            LimitLabel: limitLabel,
            LimitOptions: limitOptions,
            SelectedLimit: model.Limit.ToString(CultureInfo.InvariantCulture),
            HasError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowTable: showTable,
            ColumnLabels: columnLabels,
            Rows: rows,
            EmptyTableMessage: emptyTableMessage,
            AutomationName: title);
    }

    /// <summary>The localized <c>order_by</c> dropdown options (web <c>ORDER_BY_OPTIONS</c>).</summary>
    public static IReadOnlyList<SlowQuerySelectOption> OrderByOptions(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new List<SlowQuerySelectOption>(4)
        {
            new("mean_time", localizer.GetString("admin.slowQueries.orderMean", "Mean time")),
            new("total_time", localizer.GetString("admin.slowQueries.orderTotal", "Total time")),
            new("calls", localizer.GetString("admin.slowQueries.orderCalls", "Calls")),
            new("max_time", localizer.GetString("admin.slowQueries.orderMax", "Max time")),
        };
    }

    /// <summary>The fixed <c>limit</c> dropdown options (web <c>LIMIT_OPTIONS</c>).</summary>
    public static IReadOnlyList<SlowQuerySelectOption> LimitOptions()
    {
        var options = new List<SlowQuerySelectOption>(SlowQueriesRegistration.LimitChoices.Count);
        foreach (var n in SlowQueriesRegistration.LimitChoices)
        {
            var s = n.ToString(CultureInfo.InvariantCulture);
            options.Add(new SlowQuerySelectOption(s, s));
        }

        return options;
    }

    /// <summary>
    /// The shared-buffer cache hit ratio (web <c>cacheHitRatio</c>): <c>hit / (hit + read) * 100</c> to one decimal,
    /// or the em-dash when there were no buffer accesses.
    /// </summary>
    public static string CacheHitRatio(SlowQueryRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        long hit = row.SharedBlksHit ?? 0;
        long read = row.SharedBlksRead ?? 0;
        long total = hit + read;
        if (total <= 0)
        {
            return EmDash;
        }

        return $"{FmtNumber((double)hit / total * 100, 1)}%";
    }

    private static SlowQueryRowDisplay ProjectRow(SlowQueryRow row)
    {
        bool hasFingerprint = !string.IsNullOrEmpty(row.Fingerprint);
        return new SlowQueryRowDisplay(
            Key: row.QueryId.ToString(CultureInfo.InvariantCulture),
            Fingerprint: hasFingerprint ? row.Fingerprint : EmDash,
            HasFingerprint: hasFingerprint,
            FingerprintTooltip: row.Fingerprint,
            Calls: FmtNumber(row.Calls, DefaultPrecision),
            Mean: FmtNumber(row.MeanTimeMs, 2),
            Max: FmtNumber(row.MaxTimeMs, 2),
            Total: FmtNumber(row.TotalTimeMs, 0),
            Rows: FmtNumber(row.RowsReturned, DefaultPrecision),
            Cache: CacheHitRatio(row));
    }

    private static SlowQueriesState SelectState(SlowQueriesModel model, int rowCount)
    {
        if (model.Loading)
        {
            return SlowQueriesState.Loading;
        }

        if (model.HasError)
        {
            return SlowQueriesState.Error;
        }

        return rowCount > 0 ? SlowQueriesState.Success : SlowQueriesState.Empty;
    }

    /// <summary>Format a number the web <c>fmtNumber(value, digits)</c> way (en-US grouping, fixed fraction digits).</summary>
    private static string FmtNumber(double value, int digits) => NumberFormatting.Format(value, null, digits);
}

/// <summary>
/// Canonical metadata for the <c>SlowQueriesPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/SlowQueriesPage.tsx</c> (route <c>/admin/slow-queries</c>, nav name
/// <c>SlowQueries</c>).
/// </summary>
public static class SlowQueriesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SlowQueriesPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>SlowQueries</c>).</summary>
    public const string RouteName = "SlowQueries";

    /// <summary>The default order key (web <c>useState&lt;SlowQueryOrderBy&gt;('mean_time')</c>).</summary>
    public const string DefaultOrderBy = "mean_time";

    /// <summary>The default row limit (web <c>useState&lt;number&gt;(25)</c>).</summary>
    public const int DefaultLimit = 25;

    /// <summary>The fixed limit choices (web <c>LIMIT_OPTIONS</c>).</summary>
    public static IReadOnlyList<int> LimitChoices { get; } = new[] { 10, 25, 50, 100 };

    /// <summary>The localized page title (web <c>admin.slowQueries.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.slowQueries.pageTitle", "Slow Queries");
    }

    /// <summary>The localized page subtitle (web <c>admin.slowQueries.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "admin.slowQueries.subtitle",
            "Top queries from pg_stat_statements. Sort by mean time to surface the slowest individual calls, or total time to surface the costliest in aggregate.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SlowQueriesPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a query fingerprint, order key or row count —
/// so a diagnostics line can never leak database-shape detail. Thread-safe.
/// </summary>
public sealed class SlowQueriesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SlowQueriesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SlowQueriesPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SlowQueriesRegistration.Slug}");
    }
}
