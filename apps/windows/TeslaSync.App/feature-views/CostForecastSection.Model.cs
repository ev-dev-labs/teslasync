using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="CostForecastSectionViewModel"/> can be in — the
/// native union of the branches the web Cost-Forecast section renders
/// (web/src/features/charging/components/cost-analysis/CostForecastSection.tsx). The web component is a pure
/// child of the cost-analysis page (it takes <c>forecastData: CostForecastData | undefined</c>); the native
/// surface binds its own cache-then-network read of <c>GET /analytics/cost-forecast</c>, so it owns the full
/// loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. Every value maps
/// onto a visible surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and
/// <see cref="Offline"/> render the two cost panels (each its own chart or its own friendly empty message),
/// <see cref="Empty"/> renders both panels in their empty branches (web parity: not enough months to chart),
/// <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the retry affordance.
/// </summary>
public enum CostForecastSectionState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one chartable panel (forecast or cost-per-kWh trend).</summary>
    Loaded,

    /// <summary>The snapshot resolved but neither panel has enough months to chart.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the panels plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the panels plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One past month of charging cost — the native mirror of the web <c>CostHistoricalMonth</c>
/// (web/src/types/charging.ts). Only the three fields the section reads are projected: the month label, the
/// month's cost, and the blended cost-per-kWh (the cost-per-kWh trend line). Costs are plain currency amounts
/// (already in the user's currency on the wire). Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Month">The month label (web <c>h.month</c>).</param>
/// <param name="Cost">The charging cost for the month (web <c>h.cost</c>).</param>
/// <param name="CostPerKwh">The blended cost per kWh for the month (web <c>h.cost_per_kwh</c>).</param>
public sealed record CostForecastHistoryPoint(string Month, double Cost, double CostPerKwh);

/// <summary>
/// One projected future month of charging cost — the native mirror of the web <c>CostForecastMonth</c>
/// (web/src/types/charging.ts). Carries the projected cost plus the 95% confidence interval bounds the web
/// chart draws as a band (web <c>cost_low</c> / <c>cost_high</c>). Parsing is null-tolerant so a partial row
/// never throws.
/// </summary>
/// <param name="Month">The month label (web <c>f.month</c>).</param>
/// <param name="Cost">The projected charging cost for the month (web <c>f.cost</c>).</param>
/// <param name="CostLow">The lower 95% confidence bound (web <c>f.cost_low</c>).</param>
/// <param name="CostHigh">The upper 95% confidence bound (web <c>f.cost_high</c>).</param>
public sealed record CostForecastProjectionPoint(string Month, double Cost, double CostLow, double CostHigh);

/// <summary>
/// The cost-forecast rollup from <c>GET /analytics/cost-forecast?vehicle_id=…&amp;months=…</c> (web
/// <c>useCostForecast</c>, shape <c>CostForecastData</c> in web/src/types/charging.ts). Only the two arrays
/// the section renders — <c>historical</c> and <c>forecast</c> — are projected; the unused
/// <c>breakdown</c> / <c>gas_comparison</c> / <c>insights</c> fields (owned by the separate ForecastDetails
/// surface) are ignored. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial body never throws. WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
public sealed record CostForecastSectionData(
    IReadOnlyList<CostForecastHistoryPoint> Historical,
    IReadOnlyList<CostForecastProjectionPoint> Forecast)
{
    private const string EmDash = "\u2014";

    /// <summary>An empty snapshot with no months — the parse fallback for an absent/non-object body.</summary>
    public static CostForecastSectionData Empty { get; } = new(
        Array.Empty<CostForecastHistoryPoint>(), Array.Empty<CostForecastProjectionPoint>());

    /// <summary>Project a <c>GET /analytics/cost-forecast</c> JSON object into a tolerant snapshot.</summary>
    public static CostForecastSectionData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new CostForecastSectionData(
            GetHistorical(element, "historical"),
            GetForecast(element, "forecast"));
    }

    private static IReadOnlyList<CostForecastHistoryPoint> GetHistorical(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostForecastHistoryPoint>();
        }

        var list = new List<CostForecastHistoryPoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new CostForecastHistoryPoint(
                GetString(item, "month") ?? EmDash,
                GetDouble(item, "cost") ?? 0,
                GetDouble(item, "cost_per_kwh") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<CostForecastProjectionPoint> GetForecast(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostForecastProjectionPoint>();
        }

        var list = new List<CostForecastProjectionPoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            double cost = GetDouble(item, "cost") ?? 0;
            list.Add(new CostForecastProjectionPoint(
                GetString(item, "month") ?? EmDash,
                cost,
                GetDouble(item, "cost_low") ?? cost,
                GetDouble(item, "cost_high") ?? cost));
        }

        return list;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The fully projected, render-ready view of the Cost-Forecast section — the two cost panels the web
/// component returns: the forecast composed chart (actual-cost area, the 95% confidence envelope and the
/// projected-cost line) and the cost-per-kWh trend line, each with its own localized title, gating flag,
/// ordered month axis and friendly empty message. <see cref="HasForecastChart"/> mirrors the web
/// <c>hasForecast = historical.length &gt;= 3 &amp;&amp; forecast.length &gt; 0</c> gate and
/// <see cref="HasTrendChart"/> the web <c>hasCostPerKwhTrend = historical.length &gt; 1</c> gate. Pure data so
/// every branch is asserted without a UI host.
/// </summary>
public sealed record CostForecastSectionDisplay(
    bool HasForecastChart,
    bool HasTrendChart,
    IReadOnlyList<ChartSeries> ForecastSeries,
    IReadOnlyList<string> ForecastMonths,
    IReadOnlyList<ChartSeries> TrendSeries,
    IReadOnlyList<string> TrendMonths,
    string ForecastTitle,
    string ForecastEmptyMessage,
    string TrendTitle,
    string TrendEmptyMessage,
    string AutomationName)
{
    /// <summary>True when at least one panel has a chart to draw (web — either gate passes).</summary>
    public bool HasData => HasForecastChart || HasTrendChart;

    /// <summary>An all-empty display (both panels in their empty branch) for the loading / empty fallback.</summary>
    public static CostForecastSectionDisplay Empty(string currencySymbol, ILocalizer localizer) =>
        CostForecastSectionProjection.Project(CostForecastSectionData.Empty, currencySymbol, localizer);
}

/// <summary>
/// Pure projection from the parsed cost-forecast snapshot to the <see cref="CostForecastSectionDisplay"/> —
/// the native port of the render logic in
/// web/src/features/charging/components/cost-analysis/CostForecastSection.tsx. It builds the forecast composed
/// chart's three series (the historical "Actual Cost" area, the "95% Confidence" envelope and the
/// "Projected Cost" line) and the "$/kWh" trend line, maps each categorical month onto an ordinal X with the
/// month carried as the point label, and resolves every title / label through the i18n facade. WinUI-free —
/// unit-tested without a UI host.
/// </summary>
public static class CostForecastSectionProjection
{
    /// <summary>Minimum historical months for the forecast chart (web <c>historical.length &gt;= 3</c>).</summary>
    public const int MinForecastHistoryMonths = 3;

    /// <summary>Minimum historical months for the cost-per-kWh trend (web <c>historical.length &gt; 1</c>).</summary>
    public const int MinTrendHistoryMonths = 2;

    /// <summary>Whole-currency fraction digits for cost figures (web <c>YAxis unit="$"</c>, integer ticks).</summary>
    public const int CostDecimals = 0;

    /// <summary>Fraction digits for the blended cost-per-kWh figures (web cents-precision rate).</summary>
    public const int RateDecimals = 2;

    // i18n keys (resolve against the P1/S10 catalog; the fallbacks mirror the web English literals).
    private const string TitleKey = "costAnalysis.forecast.title";
    private const string TitleFallback = "Cost Forecast";
    private const string ConfidenceKey = "costAnalysis.forecast.confidence";
    private const string ConfidenceFallback = "95% Confidence";
    private const string ActualKey = "costAnalysis.forecast.actual";
    private const string ActualFallback = "Actual Cost";
    private const string ProjectedKey = "costAnalysis.forecast.projected";
    private const string ProjectedFallback = "Projected Cost";
    private const string NeedDataKey = "costAnalysis.forecast.needData";
    private const string NeedDataFallback = "Need at least 3 months of charging data for cost forecasting.";
    private const string TrendTitleKey = "costAnalysis.forecast.costPerKwhTrend";
    private const string TrendTitleFallback = "Cost per kWh Trend";
    private const string CostPerKwhKey = "costAnalysis.forecast.costPerKwh";
    private const string CostPerKwhFallback = "$/kWh";
    private const string NeedTrendDataKey = "costAnalysis.forecast.needTrendData";
    private const string NeedTrendDataFallback = "Need at least 2 months of charging data to show the cost per kWh trend.";

    // The web colours map onto cycling brand-palette indices (P1/S9 tokens — Tailwind classes are not ported):
    // actual = palette[0]; the confidence band + projected line share the web's purple; the trend its cyan.
    private const int ActualColorIndex = 0;
    private const int ConfidenceColorIndex = 4;
    private const int ProjectedColorIndex = 4;
    private const int TrendColorIndex = 1;

    /// <summary>Project <paramref name="data"/> using the supplied currency symbol and localizer.</summary>
    /// <param name="data">The parsed cost-forecast snapshot.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>useFormatting().currencySymbol</c>, default "$").</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static CostForecastSectionDisplay Project(
        CostForecastSectionData data,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        bool hasForecast = data.Historical.Count >= MinForecastHistoryMonths && data.Forecast.Count > 0;
        bool hasTrend = data.Historical.Count > MinTrendHistoryMonths - 1;

        string actualLabel = localizer.GetString(ActualKey, ActualFallback);
        string confidenceLabel = localizer.GetString(ConfidenceKey, ConfidenceFallback);
        string projectedLabel = localizer.GetString(ProjectedKey, ProjectedFallback);
        string trendLabel = localizer.GetString(CostPerKwhKey, CostPerKwhFallback);

        ChartSeries[] forecastSeries = hasForecast
            ? BuildForecastSeries(data, symbol, actualLabel, confidenceLabel, projectedLabel)
            : Array.Empty<ChartSeries>();
        IReadOnlyList<string> forecastMonths = hasForecast ? BuildForecastMonths(data) : [];

        ChartSeries[] trendSeries = hasTrend
            ? BuildTrendSeries(data, symbol, trendLabel)
            : Array.Empty<ChartSeries>();
        IReadOnlyList<string> trendMonths = hasTrend ? BuildHistoryMonths(data) : [];

        return new CostForecastSectionDisplay(
            HasForecastChart: hasForecast,
            HasTrendChart: hasTrend,
            ForecastSeries: forecastSeries,
            ForecastMonths: forecastMonths,
            TrendSeries: trendSeries,
            TrendMonths: trendMonths,
            ForecastTitle: localizer.GetString(TitleKey, TitleFallback),
            ForecastEmptyMessage: localizer.GetString(NeedDataKey, NeedDataFallback),
            TrendTitle: localizer.GetString(TrendTitleKey, TrendTitleFallback),
            TrendEmptyMessage: localizer.GetString(NeedTrendDataKey, NeedTrendDataFallback),
            AutomationName: localizer.GetString(TitleKey, TitleFallback));
    }

    /// <summary>
    /// Build the forecast composed chart's three series — the native analogue of the web <c>ComposedChart</c>.
    /// The historical "Actual Cost" area covers the past months; the forecast months carry the projected-cost
    /// line and the 95% confidence envelope. The web stacks two areas (<c>ci_low</c> + <c>ci_band</c>) to draw
    /// the band between the lower and upper bound; the native cartesian surface fills every area to the zero
    /// baseline (it has no stacking), so the confidence is drawn as the upper bound (<c>cost_high</c>)
    /// envelope with the projected line inside it — the lower bound is retained on the model and surfaced in
    /// each chart's accessible summary. Months map onto an ordinal X (historical first, then forecast) with the
    /// month carried as the point label so it reaches tooltips and the accessible summary.
    /// </summary>
    private static ChartSeries[] BuildForecastSeries(
        CostForecastSectionData data,
        string symbol,
        string actualLabel,
        string confidenceLabel,
        string projectedLabel)
    {
        var actualPoints = new List<ChartPoint>(data.Historical.Count);
        for (int i = 0; i < data.Historical.Count; i++)
        {
            var h = data.Historical[i];
            actualPoints.Add(new ChartPoint(i, Safe(h.Cost), h.Month));
        }

        var confidencePoints = new List<ChartPoint>(data.Forecast.Count);
        var projectedPoints = new List<ChartPoint>(data.Forecast.Count);
        for (int j = 0; j < data.Forecast.Count; j++)
        {
            var f = data.Forecast[j];
            int x = data.Historical.Count + j;
            confidencePoints.Add(new ChartPoint(x, Safe(f.CostHigh), f.Month));
            projectedPoints.Add(new ChartPoint(x, Safe(f.Cost), f.Month));
        }

        // Draw order = background-to-foreground: the confidence envelope, then the actual-cost area, then the
        // projected line. This also fixes the legend order (web: 95% Confidence, Actual Cost, Projected Cost).
        return new[]
        {
            new ChartSeries(confidenceLabel, confidencePoints)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = ConfidenceColorIndex,
                Unit = symbol,
                Decimals = CostDecimals,
            },
            new ChartSeries(actualLabel, actualPoints)
            {
                Kind = ChartSeriesKind.Area,
                ColorIndex = ActualColorIndex,
                Unit = symbol,
                Decimals = CostDecimals,
            },
            new ChartSeries(projectedLabel, projectedPoints)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = ProjectedColorIndex,
                Unit = symbol,
                Decimals = CostDecimals,
            },
        };
    }

    /// <summary>
    /// Build the cost-per-kWh trend's single line series — the native analogue of the web <c>LineChart</c>
    /// (one line over the historical months' blended <c>cost_per_kwh</c>). Months map onto an ordinal X with
    /// the month carried as the point label.
    /// </summary>
    private static ChartSeries[] BuildTrendSeries(
        CostForecastSectionData data,
        string symbol,
        string trendLabel)
    {
        var points = new List<ChartPoint>(data.Historical.Count);
        for (int i = 0; i < data.Historical.Count; i++)
        {
            var h = data.Historical[i];
            points.Add(new ChartPoint(i, Safe(h.CostPerKwh), h.Month));
        }

        return new[]
        {
            new ChartSeries(trendLabel, points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = TrendColorIndex,
                Unit = symbol,
                Decimals = RateDecimals,
            },
        };
    }

    private static List<string> BuildForecastMonths(CostForecastSectionData data)
    {
        var months = new List<string>(data.Historical.Count + data.Forecast.Count);
        foreach (var h in data.Historical)
        {
            months.Add(h.Month);
        }

        foreach (var f in data.Forecast)
        {
            months.Add(f.Month);
        }

        return months;
    }

    private static List<string> BuildHistoryMonths(CostForecastSectionData data)
    {
        var months = new List<string>(data.Historical.Count);
        foreach (var h in data.Historical)
        {
            months.Add(h.Month);
        }

        return months;
    }

    private static double Safe(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CostForecastSectionData&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline) so the view-model can render the full state matrix. The chartable gate is
/// applied by the view-model (via the projection), not here, so a snapshot with empty month arrays still
/// flows through with its freshness intact. Pure so the parse-and-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class CostForecastSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CostForecastSectionData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CostForecastSectionData Parse() =>
            raw.HasValue ? CostForecastSectionData.FromJson(raw.Value) : CostForecastSectionData.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CostForecastSectionData>.Loading(),
            LoadStatus.Cached => RepositoryResult<CostForecastSectionData>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CostForecastSectionData>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<CostForecastSectionData>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<CostForecastSectionData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CostForecastSectionData>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CostForecastSectionData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Cost-Forecast feature surface — the native mirror of the web component at
/// web/src/features/charging/components/cost-analysis/CostForecastSection.tsx. The surface reads the same
/// <c>GET /analytics/cost-forecast</c> rollup the web cost-analysis page feeds the section.
/// </summary>
public static class CostForecastSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "cost-forecast-section";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CostForecastSection";

    /// <summary>The projection horizon requested from the API (web <c>useCostForecast(_, months = 6)</c>).</summary>
    public const int Months = 6;

    /// <summary>Localized surface name (web <c>costAnalysis.forecast.title</c> "Cost Forecast").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("costAnalysis.forecast.title", "Cost Forecast");
    }
}

/// <summary>
/// PII-safe diagnostics for the Cost-Forecast surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost figure, currency, month, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CostForecastSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostForecastSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostForecastSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostForecastSectionRegistration.Slug}");
    }
}
