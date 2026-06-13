using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// One temperature-versus-efficiency sample from <c>GET /analytics/temperature-impact</c> (web
/// <c>TempEfficiencyPoint</c> in web/src/features/maps/pages/TemperatureImpactPage.tsx, query
/// <c>['temperature-impact', vehicleId]</c>). The outside temperature is SI Celsius
/// (<c>ambient_temp_c_avg</c>), the efficiency is Wh/km and the distance is km — both already derived in SQL —
/// so every display-side conversion happens at the render boundary, never here. Parsing is null-tolerant so a
/// partial or schema-drifted body never throws (web parity: the page tolerates undefined fields). Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TempEfficiencyPoint(
    double OutsideTempC,
    double EfficiencyWhKm,
    double DistanceKm,
    string DriveDate)
{
    /// <summary>Project a <c>points[]</c> JSON object into a tolerant sample (non-object → null).</summary>
    public static TempEfficiencyPoint? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TempEfficiencyPoint(
            OutsideTempC: TempImpactJson.Double(element, "outside_temp") ?? TempImpactJson.Double(element, "outsideTemp") ?? 0,
            EfficiencyWhKm: TempImpactJson.Double(element, "efficiency_wh_km") ?? TempImpactJson.Double(element, "efficiencyWhKm") ?? 0,
            DistanceKm: TempImpactJson.Double(element, "distance_km") ?? TempImpactJson.Double(element, "distanceKm") ?? 0,
            DriveDate: TempImpactJson.String(element, "drive_date") ?? TempImpactJson.String(element, "driveDate") ?? string.Empty);
    }
}

/// <summary>
/// The single-source snapshot the page binds to: the list of temperature/efficiency samples. Its presence
/// (one or more points) drives the success state exactly as the web page gates on <c>points?.length</c>
/// (<c>stats</c> is <c>null</c> when there are no points). Mirrors the web query result handed to the render body.
/// </summary>
public sealed record TempImpactSnapshot(bool HasData, IReadOnlyList<TempEfficiencyPoint> Points)
{
    /// <summary>The empty snapshot (no samples) — the page-level empty surface.</summary>
    public static TempImpactSnapshot Empty { get; } = new(false, Array.Empty<TempEfficiencyPoint>());

    /// <summary>Compose a snapshot from the parsed sample list (empty list → the empty surface).</summary>
    public static TempImpactSnapshot Compose(IReadOnlyList<TempEfficiencyPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        return points.Count > 0 ? new TempImpactSnapshot(true, points) : Empty;
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ITemperatureImpactFeed
{
    /// <summary>Fetch the temperature/efficiency samples for the active vehicle.</summary>
    Task<TempImpactSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyTemperatureImpactFeed : ITemperatureImpactFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTemperatureImpactFeed Instance { get; } = new();

    private EmptyTemperatureImpactFeed()
    {
    }

    /// <inheritdoc />
    public Task<TempImpactSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(TempImpactSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum TemperatureImpactState
{
    /// <summary>The query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no samples — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The samples resolved — the full page content.</summary>
    Success,
}

/// <summary>A summary stat tile (web hero <c>MetricCard</c> grid). Pre-formatted value + glyph + accent + optional sub-line.</summary>
public sealed record TempStatCardDisplay(
    string Glyph,
    string Value,
    string Label,
    string Subtitle,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// A single temperature-bucket average (web <c>bucketAvgs</c> entry). <see cref="Avg"/> is already in the
/// user's display efficiency unit; <see cref="Count"/> is the number of contributing samples.
/// </summary>
public sealed record TempBucketDisplay(string Label, double Avg, int Count, string ValueText);

/// <summary>A contextual recommendation chip (web <c>tips</c> entry): a glyph, localized text and a semantic tone.</summary>
public sealed record TempTipDisplay(string Glyph, string Text, StatusKind Variant);

/// <summary>A bucket badge in the optimal-analysis panel (web per-bucket <c>Badge</c>): "{label}: {avg} {unit}".</summary>
public sealed record TempBadgeDisplay(string Text, StatusKind Variant);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>TemperatureImpactPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI
/// types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record TemperatureImpactDisplay(
    TemperatureImpactState State,
    string Title,
    string Subtitle,
    string WindowTitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorTitle,
    string ErrorDetail,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<TempStatCardDisplay> StatCards,
    string ScatterTitle,
    string ScatterSeriesName,
    string ScatterXAxisLabel,
    string ScatterYAxisLabel,
    IReadOnlyList<ChartPoint> ScatterPoints,
    bool HasAverageLine,
    double AverageLine,
    string AverageLineLabel,
    string BucketTitle,
    string BucketSeriesName,
    string BucketYAxisLabel,
    IReadOnlyList<TempBucketDisplay> Buckets,
    bool HasOptimal,
    string OptimalTitle,
    string OptimalDesc,
    string OptimalDelta,
    IReadOnlyList<TempBadgeDisplay> OptimalBadges,
    string TipsTitle,
    IReadOnlyList<TempTipDisplay> Tips,
    string TipsEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests
/// construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record TemperatureImpactModel(TempImpactSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the query is in flight with no data yet.</summary>
    public static TemperatureImpactModel Initial { get; } = new(TempImpactSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web
/// <c>TemperatureImpactPage</c> feeds into <c>t(...)</c>, resolved once through the i18n facade so the
/// projection stays readable and the string-coverage test asserts all of them in one pass.
/// </summary>
public sealed record TempImpactStrings
{
    /// <summary>Page header title (web <c>tempImpact.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>Page header subtitle (web <c>tempImpact.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>Document/window title (web <c>temperature.title</c> via <c>usePageTitle</c>).</summary>
    public required string WindowTitle { get; init; }

    /// <summary>Avg-efficiency metric-card label (web <c>tempImpact.avgEfficiency</c>).</summary>
    public required string AvgEfficiency { get; init; }

    /// <summary>Best-range metric-card label (web <c>tempImpact.bestRange</c>).</summary>
    public required string BestRange { get; init; }

    /// <summary>Worst-range metric-card label (web <c>tempImpact.worstRange</c>).</summary>
    public required string WorstRange { get; init; }

    /// <summary>Total-points metric-card label (web <c>tempImpact.totalPoints</c>).</summary>
    public required string TotalPoints { get; init; }

    /// <summary>Scatter panel heading (web <c>tempImpact.scatterTitle</c>).</summary>
    public required string ScatterTitle { get; init; }

    /// <summary>Scatter series name (web <c>tempImpact.scatterName</c>).</summary>
    public required string ScatterName { get; init; }

    /// <summary>Temperature axis label (web <c>tempImpact.temperature</c>).</summary>
    public required string Temperature { get; init; }

    /// <summary>Efficiency axis label (web <c>tempImpact.efficiency</c>).</summary>
    public required string Efficiency { get; init; }

    /// <summary>Bucket line-chart heading (web <c>tempImpact.bucketTitle</c>).</summary>
    public required string BucketTitle { get; init; }

    /// <summary>Bucket line-chart series name (web <c>tempImpact.avgEff</c>).</summary>
    public required string AvgEff { get; init; }

    /// <summary>Optimal-analysis panel heading (web <c>tempImpact.optimalTitle</c>).</summary>
    public required string OptimalTitle { get; init; }

    /// <summary>Optimal-analysis description template (web <c>tempImpact.optimalDesc</c>).</summary>
    public required string OptimalDesc { get; init; }

    /// <summary>Optimal-analysis delta template (web <c>tempImpact.optimalDelta</c>).</summary>
    public required string OptimalDelta { get; init; }

    /// <summary>Recommendations panel heading (web <c>tempImpact.tipsTitle</c>).</summary>
    public required string TipsTitle { get; init; }

    /// <summary>Best-range tip template (web <c>tempImpact.tipOptimal</c>).</summary>
    public required string TipOptimal { get; init; }

    /// <summary>Cold-weather tip (web <c>tempImpact.tipCold</c>).</summary>
    public required string TipCold { get; init; }

    /// <summary>Hot-weather tip (web <c>tempImpact.tipHot</c>).</summary>
    public required string TipHot { get; init; }

    /// <summary>Empty / no-data fallback (web <c>common.noData</c>).</summary>
    public required string NoData { get; init; }

    /// <summary>Load-failure banner title (web <c>error.loadFailed</c>).</summary>
    public required string LoadFailed { get; init; }

    /// <summary>Retry affordance label (web <c>common.retry</c>).</summary>
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static TempImpactStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new TempImpactStrings
        {
            Title = localizer.GetString("tempImpact.title", "Temperature Impact"),
            Subtitle = localizer.GetString("tempImpact.subtitle", "How outside temperature affects driving efficiency"),
            WindowTitle = localizer.GetString("temperature.title", "Temperature Impact"),
            AvgEfficiency = localizer.GetString("tempImpact.avgEfficiency", "Avg Efficiency"),
            BestRange = localizer.GetString("tempImpact.bestRange", "Best Temp Range"),
            WorstRange = localizer.GetString("tempImpact.worstRange", "Worst Temp Range"),
            TotalPoints = localizer.GetString("tempImpact.totalPoints", "Total Data Points"),
            ScatterTitle = localizer.GetString("tempImpact.scatterTitle", "Temperature vs Efficiency"),
            ScatterName = localizer.GetString("tempImpact.scatterName", "Drives"),
            Temperature = localizer.GetString("tempImpact.temperature", "Temperature"),
            Efficiency = localizer.GetString("tempImpact.efficiency", "Efficiency"),
            BucketTitle = localizer.GetString("tempImpact.bucketTitle", "Efficiency by Temperature Range"),
            AvgEff = localizer.GetString("tempImpact.avgEff", "Avg Efficiency"),
            OptimalTitle = localizer.GetString("tempImpact.optimalTitle", "Optimal Temperature Analysis"),
            OptimalDesc = localizer.GetString(
                "tempImpact.optimalDesc",
                "Your most efficient temperature range is {0} with an average of {1} {2} across {3} drives."),
            OptimalDelta = localizer.GetString(
                "tempImpact.optimalDelta",
                "Compared to the worst range ({0}), you save {1} {2} on average."),
            TipsTitle = localizer.GetString("tempImpact.tipsTitle", "Recommendations"),
            TipOptimal = localizer.GetString("tempImpact.tipOptimal", "Best efficiency observed in the {0} range"),
            TipCold = localizer.GetString("tempImpact.tipCold", "Precondition your cabin in cold weather to reduce battery drain"),
            TipHot = localizer.GetString("tempImpact.tipHot", "Park in shade during hot weather to preserve battery efficiency"),
            NoData = localizer.GetString("common.noData", "No data available"),
            LoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="TemperatureImpactModel"/> to its <see cref="TemperatureImpactDisplay"/> —
/// the native port of the render logic in web/src/features/maps/pages/TemperatureImpactPage.tsx and its
/// <c>TEMP_BUCKETS_C</c> / <c>getTempBucketIndex</c> / <c>bucketLabel</c> / <c>stats</c> / <c>scatterData</c> /
/// <c>tips</c> helpers. The branch precedence mirrors the web data lifecycle (loading → error → empty →
/// success); the samples feed the four summary cards, the temperature-versus-efficiency scatter with its
/// average reference line, the efficiency-by-bucket line chart, the optimal-temperature analysis and the
/// contextual recommendations. Every label resolves through the i18n facade using the same keys the web page
/// uses and every SI value is converted at this display boundary.
/// </summary>
public static class TemperatureImpactProjection
{
    /// <summary>Segoe Fluent — Temperature (web <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — Trending/Activity (web <c>TrendingUp</c>).</summary>
    public const string TrendingUpGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — Brightness (web <c>Sun</c>).</summary>
    public const string SunGlyph = "\uE706";

    /// <summary>Segoe Fluent — cold (web <c>Snowflake</c>).</summary>
    public const string SnowflakeGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — Lightbulb (web <c>Lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    /// <summary>Segoe Fluent — Activity (web <c>Activity</c>, tips empty state).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Wh/km → Wh/mi factor (web <c>KM_PER_MILE</c>); no <c>convertEfficiencyFromSI</c> helper exists.</summary>
    public const double KmPerMile = 1.609344;

    private const int EfficiencyPrecision = 2;
    private const string AccentBrush = "TsColorAccentBrush";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string PowerBrush = "TsChartPowerBrush";
    private const string EmDash = "\u2014";

    private static readonly TempBucketBand[] BucketsC =
    [
        new(-50, 0),
        new(0, 10),
        new(10, 20),
        new(20, 30),
        new(30, 60),
    ];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed samples plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TemperatureImpactDisplay Project(TemperatureImpactModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = TempImpactStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var points = snapshot.Points;

        bool isMiles = units.Distance == DistanceUnit.Mi;
        string effLabel = isMiles ? "Wh/mi" : "Wh/km";
        string tempUnit = UnitLabels.Label(units.Temperature);

        TemperatureImpactState state =
            model.Loading && !snapshot.HasData ? TemperatureImpactState.Loading
            : model.ErrorDetail is not null ? TemperatureImpactState.Error
            : !snapshot.HasData ? TemperatureImpactState.Empty
            : TemperatureImpactState.Success;

        var stats = ComputeStats(points, units, isMiles);
        var statCards = BuildStatCards(stats, s, effLabel);
        var scatter = BuildScatter(points, units, isMiles);
        var buckets = BuildBuckets(stats, effLabel);
        var (hasOptimal, optimalDesc, optimalDelta, badges) = BuildOptimal(stats, s, effLabel);
        var tips = BuildTips(stats, s);

        return new TemperatureImpactDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            WindowTitle: s.WindowTitle,
            ShowLoading: state == TemperatureImpactState.Loading,
            ShowError: state == TemperatureImpactState.Error,
            ShowEmpty: state == TemperatureImpactState.Empty,
            ShowContent: state == TemperatureImpactState.Success,
            ErrorTitle: s.LoadFailed,
            ErrorDetail: string.IsNullOrWhiteSpace(model.ErrorDetail) ? s.LoadFailed : model.ErrorDetail,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoData,
            StatCards: statCards,
            ScatterTitle: s.ScatterTitle,
            ScatterSeriesName: s.ScatterName,
            ScatterXAxisLabel: $"{s.Temperature} ({tempUnit})",
            ScatterYAxisLabel: $"{s.Efficiency} ({effLabel})",
            ScatterPoints: scatter,
            HasAverageLine: stats is not null,
            AverageLine: stats?.AvgEff ?? 0,
            AverageLineLabel: stats is not null ? $"{ScalarFormatters.FormatNumber(stats.AvgEff, EfficiencyPrecision)} {effLabel}" : string.Empty,
            BucketTitle: s.BucketTitle,
            BucketSeriesName: $"{s.AvgEff} ({effLabel})",
            BucketYAxisLabel: effLabel,
            Buckets: buckets,
            HasOptimal: hasOptimal,
            OptimalTitle: s.OptimalTitle,
            OptimalDesc: optimalDesc,
            OptimalDelta: optimalDelta,
            OptimalBadges: badges,
            TipsTitle: s.TipsTitle,
            Tips: tips,
            TipsEmptyMessage: s.NoData,
            AutomationName: $"{s.WindowTitle}. {s.Subtitle}");
    }

    /// <summary>
    /// The temperature bucket an SI-Celsius value falls in (web <c>getTempBucketIndex</c>): the first band whose
    /// half-open <c>[min, max)</c> contains the value, defaulting to the central 10–20 °C band (index 2).
    /// </summary>
    public static int TempBucketIndex(double tempC)
    {
        for (int i = 0; i < BucketsC.Length; i++)
        {
            if (tempC >= BucketsC[i].Min && tempC < BucketsC[i].Max)
            {
                return i;
            }
        }

        return 2;
    }

    /// <summary>
    /// The display label for a bucket (web <c>bucketLabel</c>): the first band is open-below ("&lt; max"), the
    /// last is open-above ("&gt; min") and the rest are ranges ("min–max"), with every boundary converted to the
    /// user's temperature unit and rounded half-up exactly like the web's <c>Math.round</c>.
    /// </summary>
    public static string BucketLabel(int index, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        var band = BucketsC[index];
        string unit = UnitLabels.Label(units.Temperature);
        long max = JsRound(UnitConverters.TemperatureFromSi(band.Max, units.Temperature));
        long min = JsRound(UnitConverters.TemperatureFromSi(band.Min, units.Temperature));

        if (index == 0)
        {
            return $"< {max.ToString(CultureInfo.CurrentCulture)}{unit}";
        }

        if (index == BucketsC.Length - 1)
        {
            return $"> {min.ToString(CultureInfo.CurrentCulture)}{unit}";
        }

        return $"{min.ToString(CultureInfo.CurrentCulture)}\u2013{max.ToString(CultureInfo.CurrentCulture)}{unit}";
    }

    /// <summary>
    /// Compute the page statistics (web <c>stats</c> memo): the overall average efficiency, the per-bucket
    /// averages/counts and the best/worst populated buckets — or <see langword="null"/> when there are no
    /// samples (web <c>!points?.length</c>). Efficiency values are returned in the user's display unit.
    /// </summary>
    public static TempImpactStats? ComputeStats(IReadOnlyList<TempEfficiencyPoint> points, UnitPref units, bool isMiles)
    {
        ArgumentNullException.ThrowIfNull(points);
        ArgumentNullException.ThrowIfNull(units);
        if (points.Count == 0)
        {
            return null;
        }

        double sum = 0;
        var bucketValues = new List<double>[BucketsC.Length];
        for (int i = 0; i < bucketValues.Length; i++)
        {
            bucketValues[i] = [];
        }

        foreach (var p in points)
        {
            sum += p.EfficiencyWhKm;
            bucketValues[TempBucketIndex(p.OutsideTempC)].Add(p.EfficiencyWhKm);
        }

        double avgEff = DisplayEfficiency(sum / points.Count, isMiles);

        var bucketAvgs = new TempBucketStat[BucketsC.Length];
        for (int i = 0; i < BucketsC.Length; i++)
        {
            var vals = bucketValues[i];
            double avg = vals.Count > 0 ? DisplayEfficiency(Mean(vals), isMiles) : 0;
            bucketAvgs[i] = new TempBucketStat(BucketLabel(i, units), avg, vals.Count);
        }

        TempBucketStat? best = null;
        TempBucketStat? worst = null;
        foreach (var bucket in bucketAvgs)
        {
            if (bucket.Count == 0)
            {
                continue;
            }

            if (best is null || bucket.Avg < best.Avg)
            {
                best = bucket;
            }

            if (worst is null || bucket.Avg > worst.Avg)
            {
                worst = bucket;
            }
        }

        return new TempImpactStats(avgEff, bucketAvgs, best, worst, points.Count);
    }

    private static IReadOnlyList<TempStatCardDisplay> BuildStatCards(TempImpactStats? stats, TempImpactStrings s, string effLabel)
    {
        string avg = stats is not null ? $"{ScalarFormatters.FormatNumber(stats.AvgEff, EfficiencyPrecision)} {effLabel}" : EmDash;
        string bestLabel = stats?.Best?.Label ?? EmDash;
        string bestSub = stats?.Best is { } b ? $"{ScalarFormatters.FormatNumber(b.Avg, EfficiencyPrecision)} {effLabel}" : string.Empty;
        string worstLabel = stats?.Worst?.Label ?? EmDash;
        string worstSub = stats?.Worst is { } w ? $"{ScalarFormatters.FormatNumber(w.Avg, EfficiencyPrecision)} {effLabel}" : string.Empty;
        string total = (stats?.Total ?? 0).ToString(CultureInfo.CurrentCulture);

        return
        [
            new TempStatCardDisplay(ThermometerGlyph, avg, s.AvgEfficiency, string.Empty, AccentBrush, $"{s.AvgEfficiency}: {avg}"),
            new TempStatCardDisplay(TrendingUpGlyph, bestLabel, s.BestRange, bestSub, SuccessBrush, $"{s.BestRange}: {bestLabel}"),
            new TempStatCardDisplay(SunGlyph, worstLabel, s.WorstRange, worstSub, PowerBrush, $"{s.WorstRange}: {worstLabel}"),
            new TempStatCardDisplay(ThermometerGlyph, total, s.TotalPoints, string.Empty, AccentBrush, $"{s.TotalPoints}: {total}"),
        ];
    }

    private static List<ChartPoint> BuildScatter(IReadOnlyList<TempEfficiencyPoint> points, UnitPref units, bool isMiles)
    {
        var scatter = new List<ChartPoint>(points.Count);
        foreach (var p in points)
        {
            double x = UnitConverters.TemperatureFromSi(p.OutsideTempC, units.Temperature);
            double y = DisplayEfficiency(p.EfficiencyWhKm, isMiles);
            scatter.Add(new ChartPoint(x, y));
        }

        return scatter;
    }

    private static IReadOnlyList<TempBucketDisplay> BuildBuckets(TempImpactStats? stats, string effLabel)
    {
        if (stats is null)
        {
            return Array.Empty<TempBucketDisplay>();
        }

        var rows = new List<TempBucketDisplay>(stats.BucketAvgs.Count);
        foreach (var bucket in stats.BucketAvgs)
        {
            string valueText = $"{ScalarFormatters.FormatNumber(bucket.Avg, EfficiencyPrecision)} {effLabel}";
            rows.Add(new TempBucketDisplay(bucket.Label, bucket.Avg, bucket.Count, valueText));
        }

        return rows;
    }

    private static (bool HasOptimal, string Desc, string Delta, IReadOnlyList<TempBadgeDisplay> Badges) BuildOptimal(
        TempImpactStats? stats, TempImpactStrings s, string effLabel)
    {
        if (stats?.Best is not { } best)
        {
            return (false, string.Empty, string.Empty, Array.Empty<TempBadgeDisplay>());
        }

        string desc = string.Format(
            CultureInfo.CurrentCulture,
            s.OptimalDesc,
            best.Label,
            ScalarFormatters.FormatNumber(best.Avg, EfficiencyPrecision),
            effLabel,
            best.Count);

        string delta = string.Empty;
        if (stats.Worst is { } worst && !string.Equals(best.Label, worst.Label, StringComparison.Ordinal))
        {
            delta = string.Format(
                CultureInfo.CurrentCulture,
                s.OptimalDelta,
                worst.Label,
                ScalarFormatters.FormatNumber(worst.Avg - best.Avg, EfficiencyPrecision),
                effLabel);
        }

        var badges = new List<TempBadgeDisplay>();
        foreach (var bucket in stats.BucketAvgs)
        {
            if (bucket.Count == 0)
            {
                continue;
            }

            string text = $"{bucket.Label}: {ScalarFormatters.FormatNumber(bucket.Avg, EfficiencyPrecision)} {effLabel}";
            var variant = string.Equals(bucket.Label, best.Label, StringComparison.Ordinal) ? StatusKind.Success : StatusKind.Neutral;
            badges.Add(new TempBadgeDisplay(text, variant));
        }

        return (true, desc, delta, badges);
    }

    private static IReadOnlyList<TempTipDisplay> BuildTips(TempImpactStats? stats, TempImpactStrings s)
    {
        if (stats is null)
        {
            return Array.Empty<TempTipDisplay>();
        }

        var tips = new List<TempTipDisplay>();
        if (stats.Best is { } best)
        {
            tips.Add(new TempTipDisplay(
                TrendingUpGlyph,
                string.Format(CultureInfo.CurrentCulture, s.TipOptimal, best.Label),
                StatusKind.Success));
        }

        if (stats.BucketAvgs.Count > 0 && stats.BucketAvgs[0].Count > 0)
        {
            tips.Add(new TempTipDisplay(SnowflakeGlyph, s.TipCold, StatusKind.Info));
        }

        int last = stats.BucketAvgs.Count - 1;
        if (last > 0 && stats.BucketAvgs[last].Count > 0)
        {
            tips.Add(new TempTipDisplay(SunGlyph, s.TipHot, StatusKind.Warning));
        }

        return tips;
    }

    private static double DisplayEfficiency(double whKm, bool isMiles) => isMiles ? whKm * KmPerMile : whKm;

    private static double Mean(List<double> values)
    {
        double sum = 0;
        foreach (var v in values)
        {
            sum += v;
        }

        return sum / values.Count;
    }

    private static long JsRound(double value) => (long)Math.Floor(value + 0.5);

    private readonly record struct TempBucketBand(double Min, double Max);
}

/// <summary>One populated/empty temperature bucket's average (web <c>bucketAvgs</c> entry, display efficiency unit).</summary>
public sealed record TempBucketStat(string Label, double Avg, int Count);

/// <summary>
/// The computed page statistics (web <c>stats</c> memo result): the overall average efficiency, the five
/// per-bucket averages and the best/worst populated buckets, all in the user's display efficiency unit.
/// </summary>
public sealed record TempImpactStats(
    double AvgEff,
    IReadOnlyList<TempBucketStat> BucketAvgs,
    TempBucketStat? Best,
    TempBucketStat? Worst,
    int Total);

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Temperature-Impact page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the
/// page tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the
/// snake_case wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class TempImpactJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return prop.GetString();
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Temperature-Impact page — the native mirror of the web
/// page at web/src/features/maps/pages/TemperatureImpactPage.tsx (route <c>/temperature-impact</c>, nav name
/// <c>TemperatureImpact</c>). The page reads the same analytics rollup the web query reads (generated
/// operation <c>get_api_v1_analytics_temperature_impact</c>).
/// </summary>
public static class TemperatureImpactRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "TemperatureImpact";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TemperatureImpactPage";

    /// <summary>The generated operation id for the temperature-impact read (web temperature-impact query).</summary>
    public const string TemperatureImpactOperation = Operations.Analytics.TemperatureImpact;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Activity</c>).</summary>
    public const string EmptyGlyph = TemperatureImpactProjection.ActivityGlyph;

    /// <summary>The localized page title (web <c>tempImpact.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("tempImpact.title", "Temperature Impact");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Temperature-Impact surface — records only the <c>view.opened</c> event
/// with the surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class TemperatureImpactDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public TemperatureImpactDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureImpactRegistration.Slug}");
    }
}
