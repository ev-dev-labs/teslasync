using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="ApiUsageViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>APIUsageWidget</c> renders
/// through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/APIUsageWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. <see cref="Empty"/> mirrors the web <c>!data</c> gate (the query has resolved
/// to no payload) rather than an all-zero object — the backend returns a populated stats object even
/// for an idle fleet, which the web renders with zero values rather than as empty.
/// </summary>
public enum ApiUsageState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with data to show.</summary>
    Loaded,

    /// <summary>The query resolved to no payload (web <c>!data</c>) — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The API call-log rollup from <c>GET /api-logs/stats</c> (web <c>useApiLogStats</c>, shape
/// <c>APICallLogStats</c> in web/src/types/admin.ts). Field names mirror the Go API's snake_case wire
/// tags emitted by <c>APICallLogRepo.GetStats</c> (<c>last_24h</c>, <c>avg_duration_ms</c>,
/// <c>error_rate</c>, <c>error_count</c>, <c>total_calls</c>); parsing is null-tolerant so a partial
/// body never throws. Response time is milliseconds and the error rate is an already-computed
/// percentage (0..100) — both dimensionless at the display boundary, so no unit conversion applies.
/// </summary>
public sealed record ApiUsageStats(
    int Last24h,
    double AvgDurationMs,
    double ErrorRate,
    int ErrorCount,
    int TotalCalls)
{
    /// <summary>An all-zero snapshot flagged as having no payload — the parse fallback for an absent/non-object body.</summary>
    public static ApiUsageStats Empty { get; } = new(0, 0, 0, 0, 0) { HasData = false };

    /// <summary>
    /// True when a stats payload is present (web <c>data</c> truthiness). The backend always returns a
    /// populated object — including for an idle fleet — so this is true for every real snapshot and
    /// only false for the <see cref="Empty"/> fallback (an absent body). Gates the empty state.
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>Project a <c>GET /api-logs/stats</c> JSON object into a tolerant snapshot.</summary>
    public static ApiUsageStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new ApiUsageStats(
            Last24h: GetInt(element, "last_24h"),
            AvgDurationMs: GetDouble(element, "avg_duration_ms") ?? 0,
            ErrorRate: GetDouble(element, "error_rate") ?? 0,
            ErrorCount: GetInt(element, "error_count"),
            TotalCalls: GetInt(element, "total_calls"));
    }

    private static int GetInt(JsonElement obj, string name) =>
        (int)Math.Round(GetDouble(obj, name) ?? 0, MidpointRounding.AwayFromZero);

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/APIUsageWidget.tsx.
/// Note the wide threshold is three columns here (web <c>size.cols &gt;= 3</c>), unlike the four-column
/// threshold used by some other surfaces.
/// </summary>
public readonly record struct ApiUsageSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ApiUsageSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big call-volume number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): render the stat grid 4-up.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>Stat-grid column count: 4 when wide, otherwise 2 (web <c>cols={isWide ? 4 : 2}</c>).</summary>
    public int GridColumns => IsWide ? 4 : 2;
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view. Holds the localized label, the
/// already-formatted value, the optional unit suffix, the resolved Fluent glyph, an <see cref="IsAlert"/>
/// flag (the value renders in the danger colour — web <c>valueColor: 'text-red-400'</c>), an optional
/// trend chip label (web <c>trendValue</c>, only the "High" error-rate badge), and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ApiUsageStat(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    bool IsAlert,
    string? TrendLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the API-usage stats for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// four stat tiles plus the compact big-number call volume and its optional error sub-line, plus the
/// footprint flags. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ApiUsageDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    IReadOnlyList<ApiUsageStat> Stats,
    string CompactValue,
    string CompactLabel,
    bool ShowCompactError,
    string CompactErrorText,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ApiUsageStats"/> to the display model — the native port of the
/// <c>coreStats</c> <c>useMemo</c> and the compact branch in
/// web/src/features/dashboard/widgets/APIUsageWidget.tsx. Counts and rates are dimensionless (no SI
/// conversion); every label resolves through the i18n facade.
/// </summary>
public static class ApiUsageProjection
{
    /// <summary>Error-rate percentage above which the value turns red and the "High" chip shows (web <c>errorRate &gt; 5</c>).</summary>
    public const double ErrorRateAlertThreshold = 5.0;

    /// <summary>Fluent glyph for the surface header / empty state (web <c>BarChart2</c>).</summary>
    public const string HeaderGlyph = "\uE9D9";

    private const string TotalCallsGlyph = "\uE945";  // lightning (web Zap)
    private const string AvgResponseGlyph = "\uE823"; // clock (web Clock)
    private const string ErrorRateGlyph = "\uE7BA";   // warning triangle (web AlertTriangle)
    private const string ErrorsGlyph = "\uE9D2";      // activity line (web Activity)

    private const string MsUnit = "ms";
    private const string PercentUnit = "%";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static ApiUsageDisplay Project(ApiUsageStats data, ApiUsageSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: the "Total Calls (24h)" stat and the compact hero both read data.last24h.
        int totalCalls = data.Last24h;
        double avgResponseMs = data.AvgDurationMs;
        double errorRate = data.ErrorRate;
        int errorCount = data.ErrorCount;

        string totalCallsLabel = localizer.GetString("widget.apiUsage.totalCalls", "Total Calls (24h)");
        string avgResponseLabel = localizer.GetString("widget.apiUsage.avgResponse", "Avg Response");
        string errorRateLabel = localizer.GetString("widget.apiUsage.errorRate", "Error Rate");
        string errorsLabel = localizer.GetString("widget.apiUsage.totalErrors", "Errors");
        string highLabel = localizer.GetString("widget.apiUsage.highErrors", "High");

        string totalCallsValue = ScalarFormatters.FormatNumber(totalCalls, 0);
        string avgResponseValue = ScalarFormatters.FormatNumber(avgResponseMs, 1);
        string errorRateValue = ScalarFormatters.FormatNumber(errorRate, 1);
        string errorsValue = ScalarFormatters.FormatNumber(errorCount, 0);

        bool errorRateAlert = errorRate > ErrorRateAlertThreshold;
        bool errorsAlert = errorCount > 0;
        string? errorRateTrend = errorRateAlert ? highLabel : null;

        var stats = new List<ApiUsageStat>(4)
        {
            new(totalCallsLabel, totalCallsValue, null, TotalCallsGlyph, false, null,
                StatAutomationName(totalCallsLabel, totalCallsValue, null)),
            new(avgResponseLabel, avgResponseValue, MsUnit, AvgResponseGlyph, false, null,
                StatAutomationName(avgResponseLabel, avgResponseValue, MsUnit)),
            new(errorRateLabel, errorRateValue, PercentUnit, ErrorRateGlyph, errorRateAlert, errorRateTrend,
                StatAutomationName(errorRateLabel, errorRateValue, PercentUnit)),
            new(errorsLabel, errorsValue, null, ErrorsGlyph, errorsAlert, null,
                StatAutomationName(errorsLabel, errorsValue, null)),
        };

        string compactLabel = localizer.GetString("widget.apiUsage.calls24h", "Calls (24h)");
        string errorsWord = localizer.GetString("widget.apiUsage.errors", "errors");
        bool showCompactError = errorRate > ErrorRateAlertThreshold;
        string compactErrorText = showCompactError
            ? string.Format(CultureInfo.CurrentCulture, "{0}% {1}", errorRateValue, errorsWord)
            : string.Empty;

        string compactAutomationName = showCompactError
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}", totalCallsValue, compactLabel, compactErrorText)
            : string.Format(CultureInfo.CurrentCulture, "{0} {1}", totalCallsValue, compactLabel);

        return new ApiUsageDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            Stats: stats,
            CompactValue: totalCallsValue,
            CompactLabel: compactLabel,
            ShowCompactError: showCompactError,
            CompactErrorText: compactErrorText,
            CompactAutomationName: compactAutomationName);
    }

    private static string StatAutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ApiUsageStats&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ApiUsageResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<ApiUsageStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ApiUsageStats Parse() => raw.HasValue ? ApiUsageStats.FromJson(raw.Value) : ApiUsageStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ApiUsageStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<ApiUsageStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ApiUsageStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ApiUsageStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ApiUsageStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ApiUsageStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ApiUsageStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
