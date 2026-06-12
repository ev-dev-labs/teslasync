using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>ApiLogsPage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/admin/pages/ApiLogsPage.tsx). The web page runs two TanStack
/// queries (stats + logs) and renders, in precedence order, a failure banner (web <c>anyError</c>), then the log
/// table's own <c>isLoading ? Spinner : logs.length === 0 ? EmptyState : rows</c> branch. This enum is the
/// top-level summary the ledger/Narrator key off; per-region visibility is still driven by the projected flags so
/// the failure banner can sit above any table branch exactly as the web composes them.
/// </summary>
public enum ApiLogsState
{
    /// <summary>The logs query is in flight (web <c>isLoading</c>) — the table shows the spinner.</summary>
    Loading,

    /// <summary>The logs query resolved with no rows (web <c>!isLoading &amp;&amp; logs.length === 0</c>).</summary>
    Empty,

    /// <summary>A query failed (web <c>anyError</c>) — the failure banner is shown above the table.</summary>
    Error,

    /// <summary>The logs query produced rows (web <c>logs.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// One API-call log row — the native mirror of the web <c>APICallLog</c> (web/src/api/types.ts). Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ApiCallLog(
    long Id,
    string Ts,
    long? VehicleId,
    string Service,
    string HttpMethod,
    string Endpoint,
    int? StatusCode,
    long DurationMs,
    string? ErrorMessage,
    bool RateLimited,
    string? RequestBody,
    string? ResponseBody)
{
    /// <summary>Parse a logs JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<ApiCallLog> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ApiCallLog>();
        }

        var list = new List<ApiCallLog>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one log row from a JSON object, tolerating missing / null fields.</summary>
    public static ApiCallLog FromJson(JsonElement o) => new(
        Id: JsonReadHelpers.Long(o, "id") ?? 0,
        Ts: JsonReadHelpers.Str(o, "ts") ?? string.Empty,
        VehicleId: JsonReadHelpers.Long(o, "vehicle_id"),
        Service: JsonReadHelpers.Str(o, "service") ?? string.Empty,
        HttpMethod: JsonReadHelpers.Str(o, "http_method") ?? string.Empty,
        Endpoint: JsonReadHelpers.Str(o, "endpoint") ?? string.Empty,
        StatusCode: JsonReadHelpers.Int(o, "status_code"),
        DurationMs: JsonReadHelpers.Long(o, "duration_ms") ?? 0,
        ErrorMessage: JsonReadHelpers.Str(o, "error_message"),
        RateLimited: JsonReadHelpers.Bool(o, "rate_limited") ?? false,
        RequestBody: JsonReadHelpers.Str(o, "request_body"),
        ResponseBody: JsonReadHelpers.Str(o, "response_body"));
}

/// <summary>
/// Aggregate API-call statistics — the native mirror of the web <c>APICallLogStats</c> (web/src/api/types.ts),
/// fed by the <c>/api-logs/stats</c> query. Pure data; parsing is null-tolerant.
/// </summary>
public sealed record ApiCallLogStats(
    long TotalCalls,
    IReadOnlyDictionary<string, long> ByMethod,
    IReadOnlyDictionary<string, long> ByService,
    double ErrorRate,
    long ErrorCount,
    double AvgDurationMs,
    long Last24h)
{
    /// <summary>Read the stats object from JSON, tolerating missing / null fields.</summary>
    public static ApiCallLogStats FromJson(JsonElement o) => new(
        TotalCalls: JsonReadHelpers.Long(o, "total_calls") ?? 0,
        ByMethod: JsonReadHelpers.LongMap(o, "by_method"),
        ByService: JsonReadHelpers.LongMap(o, "by_service"),
        ErrorRate: JsonReadHelpers.Double(o, "error_rate") ?? 0,
        ErrorCount: JsonReadHelpers.Long(o, "error_count") ?? 0,
        AvgDurationMs: JsonReadHelpers.Double(o, "avg_duration_ms") ?? 0,
        Last24h: JsonReadHelpers.Long(o, "last_24h") ?? 0);
}

/// <summary>
/// The active filter set — the native union of the web URL-state filters (<c>service</c>, <c>method</c>,
/// <c>status</c>, <c>endpoint</c>) plus the unified date range (<c>from</c>/<c>to</c>). Empty strings mean
/// "unset" (the web's absent URL param), so <see cref="HasAny"/> mirrors the web <c>hasFilters</c> gate, which
/// deliberately excludes the date range exactly as the web source does.
/// </summary>
public sealed record ApiLogsFilter(
    string Service,
    string Method,
    string Status,
    string Endpoint,
    string Start,
    string End)
{
    /// <summary>The all-empty filter (no active filters, full history).</summary>
    public static ApiLogsFilter Empty { get; } = new(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Whether any of the chip/dropdown filters are active (web <c>hasFilters</c>; range excluded).</summary>
    public bool HasAny =>
        Service.Length > 0 || Method.Length > 0 || Status.Length > 0 || Endpoint.Length > 0;
}

/// <summary>
/// Static catalog of the services the frontend knows the backend can write — the native port of the web
/// <c>SERVICE_CONFIG</c> map and its <c>KNOWN_SERVICES</c> key list
/// (web/src/features/admin/pages/ApiLogsPage.tsx). Maps each service id to its display label and semantic badge
/// tint; unknown ids fall back to the raw id with a neutral tint, exactly as the web <c>serviceBadgeConfig</c>
/// lookup does. UI-free so it is unit-tested without a XAML runtime.
/// </summary>
public static class ApiLogServiceCatalog
{
    /// <summary>A service's display label and semantic badge tint.</summary>
    public sealed record ServiceConfig(string Label, StatusKind Variant);

    // Insertion order mirrors the web SERVICE_CONFIG literal so KnownServices matches Object.keys(SERVICE_CONFIG).
    private static readonly IReadOnlyList<KeyValuePair<string, ServiceConfig>> Ordered =
    [
        new("teslasync-api", new("TeslaSync API", StatusKind.Info)),
        new("tesla-api", new("Tesla API", StatusKind.Info)),
        new("tesla-auth", new("Tesla Auth", StatusKind.Info)),
        new("geocoder-google", new("Geocoder (Google)", StatusKind.Warning)),
        new("geocoder-nominatim", new("Geocoder (Nominatim)", StatusKind.Warning)),
        new("geocoder-azure", new("Geocoder (Azure)", StatusKind.Warning)),
        new("geocoder-search", new("Geocoder (Search)", StatusKind.Warning)),
        new("github-releases", new("GitHub Releases", StatusKind.Neutral)),
        new("notify-generic", new("Notifications", StatusKind.Neutral)),
        new("system-dns-check", new("DNS Health Check", StatusKind.Neutral)),
        new("eia", new("EIA", StatusKind.Neutral)),
    ];

    private static readonly Dictionary<string, ServiceConfig> Map =
        Ordered.ToDictionary(p => p.Key, p => p.Value, StringComparer.Ordinal);

    /// <summary>The static catalog keys (web <c>KNOWN_SERVICES</c>) in declaration order.</summary>
    public static IReadOnlyList<string> KnownServices { get; } = Ordered.Select(p => p.Key).ToArray();

    /// <summary>Resolve a service id to its config, falling back to the raw id + neutral tint.</summary>
    public static ServiceConfig For(string service) =>
        Map.TryGetValue(service, out var config) ? config : new ServiceConfig(service, StatusKind.Neutral);
}

/// <summary>
/// Maps HTTP method names and status codes to their semantic badge tint — the native port of the web
/// <c>METHOD_VARIANTS</c> map and <c>statusBadgeVariant</c> function (web/src/features/admin/pages/ApiLogsPage.tsx).
/// UI-free so the mappings are unit-tested without a XAML runtime.
/// </summary>
public static class ApiLogBadges
{
    /// <summary>Tint for an HTTP method (web <c>METHOD_VARIANTS[method] ?? 'neutral'</c>).</summary>
    public static StatusKind Method(string method) => method switch
    {
        "GET" => StatusKind.Success,
        "POST" => StatusKind.Info,
        "PUT" => StatusKind.Warning,
        "PATCH" => StatusKind.Warning,
        "DELETE" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Tint for a status code (web <c>statusBadgeVariant</c>: null/0 neutral, 2xx success … 5xx danger).</summary>
    public static StatusKind Status(int? code)
    {
        if (code is not int c || c == 0)
        {
            return StatusKind.Neutral;
        }

        if (c < 300)
        {
            return StatusKind.Success;
        }

        if (c < 400)
        {
            return StatusKind.Info;
        }

        if (c < 500)
        {
            return StatusKind.Warning;
        }

        return StatusKind.Danger;
    }
}

/// <summary>One <c>&lt;Select&gt;</c> option (value + localized label) — native mirror of the web option objects.</summary>
public sealed record ApiLogsSelectOption(string Value, string Label);

/// <summary>
/// Builds the Service-filter dropdown option list — the native port of the web <c>deriveServiceOptions</c>
/// (web/src/features/admin/lib/serviceOptions.ts). The list is the union of the static catalog, the live
/// <c>by_service</c> keys and the active selection, sorted case-insensitively by label, with the "All Services"
/// head pinned first.
/// </summary>
public static class ApiLogServiceOptions
{
    /// <summary>Derive the option list (head = all-services, tail = label-sorted union).</summary>
    public static IReadOnlyList<ApiLogsSelectOption> Derive(
        IReadOnlyDictionary<string, long>? byService,
        string activeService,
        Func<string, string> labelFor,
        string allLabel,
        IReadOnlyList<string> knownServices)
    {
        ArgumentNullException.ThrowIfNull(labelFor);
        ArgumentNullException.ThrowIfNull(knownServices);

        var values = new HashSet<string>(StringComparer.Ordinal);
        foreach (var svc in knownServices)
        {
            values.Add(svc);
        }

        if (byService is not null)
        {
            foreach (var svc in byService.Keys)
            {
                values.Add(svc);
            }
        }

        if (!string.IsNullOrEmpty(activeService))
        {
            values.Add(activeService);
        }

        var tail = values
            .Select(v => new ApiLogsSelectOption(v, labelFor(v)))
            .OrderBy(o => o.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var options = new List<ApiLogsSelectOption>(tail.Count + 1)
        {
            new(string.Empty, allLabel),
        };
        options.AddRange(tail);
        return options;
    }
}

/// <summary>
/// The render-time data model the <c>ApiLogsPage</c> projects from — the native analogue of the web page's
/// resolved query + URL state (web/src/features/admin/pages/ApiLogsPage.tsx). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Stats">The aggregate stats (web <c>stats</c>); null while loading / on error.</param>
/// <param name="Logs">The current page of log rows (web <c>data.data</c>).</param>
/// <param name="Total">The total row count across all pages (web <c>data.total</c>).</param>
/// <param name="Loading">Whether the logs query is in flight (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether either query failed (web <c>anyError</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the banner (web <c>getErrorMessage(anyError)</c>).</param>
/// <param name="Filter">The active filter set.</param>
/// <param name="Page">The current zero-based page index (web <c>page</c>).</param>
/// <param name="Limit">The page size (web <c>limit</c> = 25).</param>
/// <param name="ExpandedId">The id of the expanded row, or null when none is expanded (web <c>expandedId</c>).</param>
public sealed record ApiLogsModel(
    ApiCallLogStats? Stats,
    IReadOnlyList<ApiCallLog> Logs,
    int Total,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    ApiLogsFilter Filter,
    int Page,
    int Limit,
    long? ExpandedId)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static ApiLogsModel Initial { get; } = new(
        Stats: null,
        Logs: Array.Empty<ApiCallLog>(),
        Total: 0,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Filter: ApiLogsFilter.Empty,
        Page: 0,
        Limit: ApiLogsRegistration.PageSize,
        ExpandedId: null);
}

/// <summary>A request/response JSON viewer block (web <c>JsonViewer</c>): a label plus either pretty JSON or the no-data note.</summary>
public sealed record ApiLogJsonDisplay(string Label, string Body, bool HasData);

/// <summary>One projected, render-ready stat tile (web <c>StatCard</c>).</summary>
public sealed record ApiLogStatCardDisplay(string Label, string Value, string Glyph, string? Sublabel, string AutomationName);

/// <summary>One projected by-service chip (web button + <c>Badge</c> + count).</summary>
public sealed record ApiLogServiceChipDisplay(string Service, string Label, StatusKind Variant, string CountText);

/// <summary>One projected, render-ready log row (collapsed header + always-built expanded detail).</summary>
public sealed record ApiLogRowDisplay(
    long Id,
    string Timestamp,
    string ServiceLabel,
    StatusKind ServiceVariant,
    string Method,
    StatusKind MethodVariant,
    string Endpoint,
    string StatusText,
    StatusKind StatusVariant,
    string DurationText,
    string ErrorSummary,
    bool HasError,
    bool IsExpanded,
    string RequestUrlText,
    string ErrorBody,
    ApiLogJsonDisplay RequestBody,
    ApiLogJsonDisplay ResponseBody,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every value formatted at the display
/// boundary. Holds all nine panels (the four stat tiles, the by-service chips, the filters region, the table
/// header/rows, and the per-row request-URL / error / request-body / response-body blocks), the four data-state
/// flags, and the pagination chrome. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ApiLogsDisplay(
    ApiLogsState State,
    string Title,
    string Subtitle,
    bool HasError,
    string ErrorBannerText,
    IReadOnlyList<ApiLogStatCardDisplay> StatCards,
    bool HasByService,
    string ByServiceLabel,
    IReadOnlyList<ApiLogServiceChipDisplay> ServiceChips,
    string FiltersLabel,
    bool HasFilters,
    string ClearLabel,
    string ServiceFilterAria,
    IReadOnlyList<ApiLogsSelectOption> ServiceOptions,
    string SelectedService,
    bool ShowServiceCount,
    string ServiceCountText,
    IReadOnlyList<ApiLogsSelectOption> MethodOptions,
    string SelectedMethod,
    IReadOnlyList<ApiLogsSelectOption> StatusOptions,
    string SelectedStatus,
    string EndpointHint,
    string EndpointValue,
    string TableSummaryText,
    string ExportLabel,
    bool CanExport,
    bool ShowLoading,
    string LoadingText,
    bool ShowEmpty,
    string EmptyText,
    bool ShowEmptyHint,
    string EmptyHintText,
    bool ShowRows,
    IReadOnlyList<ApiLogRowDisplay> Rows,
    bool ShowPagination,
    string PreviousLabel,
    string NextLabel,
    string PageOfText,
    bool CanGoPrevious,
    bool CanGoNext,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="ApiLogsModel"/> to its <see cref="ApiLogsDisplay"/> — the native port of the
/// render logic in web/src/features/admin/pages/ApiLogsPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; numbers format through <see cref="NumberFormatting"/> (the web
/// <c>fmtInt</c>/<c>fmtNumber</c> ports) and timestamps through <see cref="DateTimeFormatting"/> so the C# output
/// matches the web truth. Every chrome string is resolved on every projection (visibility is gated by the
/// returned flags), so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ApiLogsProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    // Segoe Fluent Icons glyphs standing in for the web lucide stat-card icons.
    private const string GlyphTotalCalls = "\uE9D9";   // file / document list
    private const string GlyphErrorRate = "\uE7BA";    // warning
    private const string GlyphAvgDuration = "\uE823";  // clock / history
    private const string GlyphLast24h = "\uE9D2";      // pulse / activity

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query + URL state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static ApiLogsDisplay Project(ApiLogsModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("apiLogs.title", "API Logs");
        string subtitle = localizer.GetString("apiLogs.subtitle", "Record of all API calls with request/response details");

        // ── Failure banner (web anyError) ──────────────────────────────────────────────────────────────
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorBanner = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Stat tiles (web StatCard ×4) ───────────────────────────────────────────────────────────────
        var stats = model.Stats;
        string totalCallsValue = stats is not null ? FmtInt(stats.TotalCalls) : EmDash;
        string errorRateValue = stats is not null ? $"{FmtNumber(stats.ErrorRate)}%" : EmDash;
        string avgDurationValue = stats is not null ? $"{FmtInt((long)stats.AvgDurationMs)}ms" : EmDash;
        string last24hValue = stats is not null ? FmtInt(stats.Last24h) : EmDash;

        string totalCallsLabel = localizer.GetString("apiLogs.totalCalls", "Total Calls");
        string errorRateLabel = localizer.GetString("apiLogs.errorRate", "Error Rate");
        string avgDurationLabel = localizer.GetString("apiLogs.avgDuration", "Avg Duration");
        string last24hLabel = localizer.GetString("apiLogs.last24h", "Last 24h");

        // web: the error-rate StatCard surfaces error_count as a trend when error_rate > 5.
        string? errorRateSub = stats is not null && stats.ErrorRate > 5 ? FmtInt(stats.ErrorCount) : null;

        var statCards = new List<ApiLogStatCardDisplay>(4)
        {
            new(totalCallsLabel, totalCallsValue, GlyphTotalCalls, null, $"{totalCallsLabel}: {totalCallsValue}"),
            new(errorRateLabel, errorRateValue, GlyphErrorRate, errorRateSub, $"{errorRateLabel}: {errorRateValue}"),
            new(avgDurationLabel, avgDurationValue, GlyphAvgDuration, null, $"{avgDurationLabel}: {avgDurationValue}"),
            new(last24hLabel, last24hValue, GlyphLast24h, null, $"{last24hLabel}: {last24hValue}"),
        };

        // ── By-service chips (web stats.by_service map) ──────────────────────────────────────────────────
        string byServiceLabel = localizer.GetString("apiLogs.byService", "By Service");
        var chips = new List<ApiLogServiceChipDisplay>();
        if (stats is not null)
        {
            foreach (var (svc, count) in stats.ByService)
            {
                var config = ApiLogServiceCatalog.For(svc);
                chips.Add(new ApiLogServiceChipDisplay(svc, config.Label, config.Variant, FmtInt(count)));
            }
        }

        bool hasByService = chips.Count > 0;

        // ── Filters region (web GlassPanel) ───────────────────────────────────────────────────────────
        string filtersLabel = localizer.GetString("apiLogs.filters", "Filters");
        string clearLabel = localizer.GetString("apiLogs.clear", "Clear");
        bool hasFilters = model.Filter.HasAny;

        string allServices = localizer.GetString("apiLogs.allServices", "All Services");
        string serviceAria = localizer.GetString("apiLogs.serviceFilterAria", "Filter by service");
        var serviceOptions = ApiLogServiceOptions.Derive(
            stats?.ByService,
            model.Filter.Service,
            svc => ApiLogServiceCatalog.For(svc).Label,
            allServices,
            ApiLogServiceCatalog.KnownServices);

        int trackedCount = stats?.ByService.Count ?? 0;
        string serviceCountTemplate = localizer.GetString("apiLogs.serviceCount", "{0} with data \u00b7 {1} known");
        string serviceCountText = string.Format(
            CultureInfo.CurrentCulture,
            serviceCountTemplate,
            trackedCount,
            ApiLogServiceCatalog.KnownServices.Count);

        string allMethods = localizer.GetString("apiLogs.allMethods", "All Methods");
        var methodOptions = new List<ApiLogsSelectOption>
        {
            new(string.Empty, allMethods),
            new("GET", "GET"),
            new("POST", "POST"),
            new("PUT", "PUT"),
            new("DELETE", "DELETE"),
        };

        string allStatus = localizer.GetString("apiLogs.allStatus", "All Status");
        var statusOptions = new List<ApiLogsSelectOption>
        {
            new(string.Empty, allStatus),
            new("2xx", "2xx Success"),
            new("3xx", "3xx Redirect"),
            new("4xx", "4xx Client Error"),
            new("5xx", "5xx Server Error"),
        };

        string endpointHint = localizer.GetString("apiLogs.filterEndpoint", "Filter by endpoint...");

        // ── Table header (web "showing" / "noLogs") ────────────────────────────────────────────────────
        int limit = model.Limit <= 0 ? ApiLogsRegistration.PageSize : model.Limit;
        int total = model.Total;
        string showingTemplate = localizer.GetString("apiLogs.showing", "Showing {0}\u2013{1} of {2}");
        string noLogs = localizer.GetString("apiLogs.noLogs", "No logs found");
        string tableSummary = total > 0
            ? string.Format(
                CultureInfo.CurrentCulture,
                showingTemplate,
                (model.Page * limit) + 1,
                Math.Min((model.Page + 1) * limit, total),
                FmtInt(total))
            : noLogs;

        string exportLabel = localizer.GetString("apiLogs.exportJson", "Export JSON");

        // ── Table body branch (web isLoading ? Spinner : empty ? EmptyState : rows) ──────────────────────
        string loadingText = localizer.GetString("apiLogs.loading", "Loading logs...");
        string emptyText = localizer.GetString("apiLogs.noLogsFound", "No API call logs found");
        string emptyHintText = localizer.GetString("apiLogs.adjustFilters", "Try adjusting your filters");

        // Per-row JSON-viewer labels (resolved once; reused by every row) — web JsonViewer headings. The
        // request-URL and error section headings are resolved through DetailLabels (consumed by the view).
        string requestBodyLabel = localizer.GetString("apiLogs.requestBody", "Request Body");
        string responseBodyLabel = localizer.GetString("apiLogs.responseBody", "Response Body");
        string noDataTemplate = localizer.GetString("apiLogs.noData", "No {0}");

        var rows = new List<ApiLogRowDisplay>(model.Logs.Count);
        foreach (var log in model.Logs)
        {
            var serviceConfig = ApiLogServiceCatalog.For(log.Service);
            string timestamp = FormatTimestamp(log.Ts, now);
            string statusText = log.StatusCode is int code ? code.ToString(CultureInfo.InvariantCulture) : "N/A";
            string durationText = $"{log.DurationMs.ToString(CultureInfo.InvariantCulture)}ms";
            bool hasError = !string.IsNullOrEmpty(log.ErrorMessage);
            string errorSummary = hasError ? log.ErrorMessage! : EmDash;
            string endpoint = log.Endpoint ?? string.Empty;

            rows.Add(new ApiLogRowDisplay(
                Id: log.Id,
                Timestamp: timestamp,
                ServiceLabel: serviceConfig.Label,
                ServiceVariant: serviceConfig.Variant,
                Method: log.HttpMethod,
                MethodVariant: ApiLogBadges.Method(log.HttpMethod),
                Endpoint: endpoint,
                StatusText: statusText,
                StatusVariant: ApiLogBadges.Status(log.StatusCode),
                DurationText: durationText,
                ErrorSummary: errorSummary,
                HasError: hasError,
                IsExpanded: model.ExpandedId == log.Id,
                RequestUrlText: $"{log.HttpMethod} {endpoint}".Trim(),
                ErrorBody: log.ErrorMessage ?? string.Empty,
                RequestBody: BuildJson(log.RequestBody, requestBodyLabel, noDataTemplate),
                ResponseBody: BuildJson(log.ResponseBody, responseBodyLabel, noDataTemplate),
                AutomationName: string.Join(". ", timestamp, serviceConfig.Label, log.HttpMethod, endpoint, statusText, durationText)));
        }

        bool showLoading = model.Loading;
        bool showEmpty = !model.Loading && rows.Count == 0;
        bool showRows = !model.Loading && rows.Count > 0;
        bool canExport = rows.Count > 0;

        // ── Pagination (web totalPages = ceil(total / limit)) ─────────────────────────────────────────────
        int totalPages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0;
        bool showPagination = totalPages > 1;
        string previousLabel = localizer.GetString("apiLogs.previous", "Previous");
        string nextLabel = localizer.GetString("apiLogs.next", "Next");
        string pageOfTemplate = localizer.GetString("apiLogs.pageOf", "Page {0} of {1}");
        string pageOfText = string.Format(
            CultureInfo.CurrentCulture,
            pageOfTemplate,
            model.Page + 1,
            Math.Max(totalPages, 1));
        bool canGoPrevious = model.Page > 0;
        bool canGoNext = model.Page < totalPages - 1;

        var state = SelectState(model, rows.Count);

        return new ApiLogsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            HasError: model.HasError,
            ErrorBannerText: errorBanner,
            StatCards: statCards,
            HasByService: hasByService,
            ByServiceLabel: byServiceLabel,
            ServiceChips: chips,
            FiltersLabel: filtersLabel,
            HasFilters: hasFilters,
            ClearLabel: clearLabel,
            ServiceFilterAria: serviceAria,
            ServiceOptions: serviceOptions,
            SelectedService: model.Filter.Service,
            ShowServiceCount: stats is not null,
            ServiceCountText: serviceCountText,
            MethodOptions: methodOptions,
            SelectedMethod: model.Filter.Method,
            StatusOptions: statusOptions,
            SelectedStatus: model.Filter.Status,
            EndpointHint: endpointHint,
            EndpointValue: model.Filter.Endpoint,
            TableSummaryText: tableSummary,
            ExportLabel: exportLabel,
            CanExport: canExport,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowEmpty: showEmpty,
            EmptyText: emptyText,
            ShowEmptyHint: showEmpty && hasFilters,
            EmptyHintText: emptyHintText,
            ShowRows: showRows,
            Rows: rows,
            ShowPagination: showPagination,
            PreviousLabel: previousLabel,
            NextLabel: nextLabel,
            PageOfText: pageOfText,
            CanGoPrevious: canGoPrevious,
            CanGoNext: canGoNext,
            AutomationName: title);
    }

    /// <summary>Resolve the four expanded-detail section headings (web JsonViewer labels + detail headings).</summary>
    public static ApiLogDetailLabels DetailLabels(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ApiLogDetailLabels(
            RequestUrl: localizer.GetString("apiLogs.requestUrl", "Request URL"),
            Error: localizer.GetString("apiLogs.error", "Error"),
            RequestBody: localizer.GetString("apiLogs.requestBody", "Request Body"),
            ResponseBody: localizer.GetString("apiLogs.responseBody", "Response Body"));
    }

    /// <summary>Format an integer the web <c>fmtInt</c> way (en-US grouping, zero fraction digits).</summary>
    public static string FmtInt(long value) => NumberFormatting.Format(value, null, 0);

    /// <summary>Format a number the web <c>fmtNumber</c> way (en-US grouping, two fraction digits).</summary>
    public static string FmtNumber(double value) => NumberFormatting.Format(value, null, 2);

    /// <summary>Pretty-print a JSON body (web <c>JSON.stringify(JSON.parse(data), null, 2)</c>); raw on parse failure.</summary>
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

    private static readonly JsonSerializerOptions PrettyOptions = new() { WriteIndented = true };

    // web JsonViewer: null/empty body → "No {label.toLowerCase()}"; otherwise pretty JSON (raw on parse failure).
    private static ApiLogJsonDisplay BuildJson(string? data, string label, string noDataTemplate)
    {
        if (string.IsNullOrEmpty(data))
        {
            string text = string.Format(CultureInfo.CurrentCulture, noDataTemplate, label.ToLowerInvariant());
            return new ApiLogJsonDisplay(label, text, false);
        }

        return new ApiLogJsonDisplay(label, PrettyJson(data), true);
    }

    // Top-level state: failure dominates (banner), then the table's own loading / empty / rows branch.
    private static ApiLogsState SelectState(ApiLogsModel model, int rowCount)
    {
        if (model.HasError)
        {
            return ApiLogsState.Error;
        }

        if (model.Loading)
        {
            return ApiLogsState.Loading;
        }

        return rowCount == 0 ? ApiLogsState.Empty : ApiLogsState.Success;
    }

    // web <DateTime value={log.ts} in="utc" />: absolute date-time, or em-dash for null / unparseable input.
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

/// <summary>The four localized expanded-detail section headings (web JsonViewer labels + detail headings).</summary>
public sealed record ApiLogDetailLabels(string RequestUrl, string Error, string RequestBody, string ResponseBody);

/// <summary>
/// Serializes the current page of log rows to indented, snake_case JSON — the native port of the web export
/// handler's <c>JSON.stringify(logs, null, 2)</c> (web/src/features/admin/pages/ApiLogsPage.tsx). The snake_case
/// naming policy reproduces the web wire shape so an exported file is structurally comparable.
/// </summary>
public static class ApiLogsExport
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Render the logs as the export JSON document.</summary>
    public static string ToJson(IReadOnlyList<ApiCallLog> logs)
    {
        ArgumentNullException.ThrowIfNull(logs);
        return JsonSerializer.Serialize(logs, Options);
    }

    /// <summary>The suggested download file name (web <c>teslasync-api-logs-{yyyy-MM-dd}.json</c>).</summary>
    public static string FileName(DateTimeOffset now) =>
        $"teslasync-api-logs-{now.UtcDateTime:yyyy-MM-dd}.json";
}

/// <summary>
/// Canonical metadata for the <c>ApiLogsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/ApiLogsPage.tsx</c> (route <c>/api-logs</c>, nav name <c>ApiLogs</c>).
/// </summary>
public static class ApiLogsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ApiLogsPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>ApiLogs</c>).</summary>
    public const string RouteName = "ApiLogs";

    /// <summary>The page size (web <c>limit</c>).</summary>
    public const int PageSize = 25;

    /// <summary>The localized page title (web <c>apiLogs.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("apiLogs.title", "API Logs");
    }

    /// <summary>The localized page subtitle (web <c>apiLogs.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("apiLogs.subtitle", "Record of all API calls with request/response details");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ApiLogsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an endpoint, error or request/response body —
/// so a diagnostics line can never leak API traffic. Thread-safe.
/// </summary>
public sealed class ApiLogsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ApiLogsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ApiLogsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ApiLogsRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant JSON readers shared by the log/stats parsers (UI-free, unit-tested).</summary>
internal static class JsonReadHelpers
{
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static int? Int(JsonElement o, string name)
    {
        var value = Long(o, name);
        return value is null ? null : (int)value.Value;
    }

    public static double? Double(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    public static IReadOnlyDictionary<string, long> LongMap(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object)
        {
            return new Dictionary<string, long>(StringComparer.Ordinal);
        }

        var map = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var prop in v.EnumerateObject())
        {
            if (prop.Value.ValueKind == JsonValueKind.Number && prop.Value.TryGetInt64(out var n))
            {
                map[prop.Name] = n;
            }
        }

        return map;
    }
}
