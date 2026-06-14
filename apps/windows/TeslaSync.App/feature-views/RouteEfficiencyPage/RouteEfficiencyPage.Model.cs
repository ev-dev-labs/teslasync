using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One most-driven route from <c>GET /analytics/route-efficiency</c> (web <c>RouteSummary</c> in
/// web/src/types/driving.ts, hook <c>useRouteEfficiency</c>). Efficiency is SI per-kilometre (watt-hours per
/// kilometre) and the average distance is in kilometres exactly as the API and web keep them; every display-side
/// conversion happens at the render boundary, never here. Parsing is null-tolerant so a partial or schema-drifted
/// row never throws (web parity: the page tolerates undefined fields). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record RouteSummaryModel(
    string StartLocation,
    string EndLocation,
    int TripCount,
    double AvgDistanceKm,
    double AvgEfficiencyWhKm,
    double BestEfficiencyWhKm,
    double WorstEfficiencyWhKm)
{
    /// <summary>Project a single route JSON object into a tolerant summary (accepts snake_case + camelCase aliases).</summary>
    public static RouteSummaryModel FromJson(JsonElement element)
    {
        return new RouteSummaryModel(
            StartLocation: RouteJson.String(element, "start_location") ?? RouteJson.String(element, "startLocation") ?? string.Empty,
            EndLocation: RouteJson.String(element, "end_location") ?? RouteJson.String(element, "endLocation") ?? string.Empty,
            TripCount: (int)(RouteJson.Long(element, "trip_count") ?? RouteJson.Long(element, "tripCount") ?? 0),
            AvgDistanceKm: RouteJson.Double(element, "avg_distance_km") ?? RouteJson.Double(element, "avgDistanceKm") ?? 0,
            AvgEfficiencyWhKm: RouteJson.Double(element, "avg_efficiency") ?? RouteJson.Double(element, "avgEfficiency") ?? 0,
            BestEfficiencyWhKm: RouteJson.Double(element, "best_efficiency") ?? RouteJson.Double(element, "bestEfficiency") ?? 0,
            WorstEfficiencyWhKm: RouteJson.Double(element, "worst_efficiency") ?? RouteJson.Double(element, "worstEfficiency") ?? 0);
    }
}

/// <summary>
/// The parsed result of one <c>GET /analytics/route-efficiency</c> read — the native analogue of the web
/// <c>RouteEfficiencyData</c> the page hands to its render body. <see cref="HasData"/> mirrors the web's
/// "any routes to compare" gate: it drives the success/empty branch exactly as the web page's route list does.
/// Mirrors the web handing the query result to its render body.
/// </summary>
public sealed record RouteEfficiencySnapshot(
    bool HasData,
    IReadOnlyList<RouteSummaryModel> Routes,
    int TotalRoutes,
    int TotalTrips)
{
    /// <summary>The empty snapshot (no routes) — the page-level empty surface.</summary>
    public static RouteEfficiencySnapshot Empty { get; } = new(false, Array.Empty<RouteSummaryModel>(), 0, 0);

    /// <summary>Project a <c>GET /analytics/route-efficiency</c> JSON object into a tolerant snapshot.</summary>
    public static RouteEfficiencySnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var routes = ParseRoutes(root);
        int totalRoutes = (int)(RouteJson.Long(root, "total_routes") ?? RouteJson.Long(root, "totalRoutes") ?? routes.Count);
        int totalTrips = (int)(RouteJson.Long(root, "total_trips") ?? RouteJson.Long(root, "totalTrips") ?? 0);
        return new RouteEfficiencySnapshot(routes.Count > 0, routes, totalRoutes, totalTrips);
    }

    /// <summary>Parse the <c>routes</c> array into the tolerant route list (absent / non-array → empty).</summary>
    public static IReadOnlyList<RouteSummaryModel> ParseRoutes(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("routes", out var array)
            || array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RouteSummaryModel>();
        }

        var routes = new List<RouteSummaryModel>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                routes.Add(RouteSummaryModel.FromJson(item));
            }
        }

        return routes;
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IRouteEfficiencyFeed
{
    /// <summary>Fetch the route-efficiency rollup for the active vehicle + range.</summary>
    Task<RouteEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyRouteEfficiencyFeed : IRouteEfficiencyFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRouteEfficiencyFeed Instance { get; } = new();

    private EmptyRouteEfficiencyFeed()
    {
    }

    /// <inheritdoc />
    public Task<RouteEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(RouteEfficiencySnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum RouteEfficiencyState
{
    /// <summary>The route-efficiency query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no routes to compare — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The route-efficiency query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The route rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A single summary stat tile in the hero grid (web <c>AnimatedNumber</c> + caption).</summary>
public sealed record RouteSummaryStatDisplay(double Value, string Label, StatusKind Accent, string AutomationName);

/// <summary>One route comparison card (web <c>RouteCard</c>). Every value is pre-formatted at the display boundary.</summary>
public sealed record RouteCardDisplay(
    string Title,
    string Meta,
    string BadgeText,
    StatusKind BadgeStatus,
    string BestLabel,
    string AvgLabel,
    string WorstLabel,
    string BestText,
    string AvgText,
    string WorstText,
    double BarValue,
    double BarMax,
    string BarAccentBrushKey,
    string AutomationName);

/// <summary>A computed comparison datum (web client-side <c>chartData</c> map output).</summary>
public sealed record RouteComparisonRow(string Name, double Best, double Avg, double Worst, int Trips);

/// <summary>A typed chart series projected for the comparison bar chart (WinUI-free).</summary>
public sealed record RouteSeriesDisplay(string Name, ChartSeriesKind Kind, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>The route-efficiency comparison chart projection (web <c>ChartContainer</c> + <c>BarChart</c>).</summary>
public sealed record RouteComparisonChartDisplay(
    bool Visible,
    bool HasData,
    string Title,
    string AriaLabel,
    string RouteColumnLabel,
    string BestSeriesLabel,
    string AvgSeriesLabel,
    string WorstSeriesLabel,
    IReadOnlyList<RouteComparisonRow> Rows,
    IReadOnlyList<RouteSeriesDisplay> Series);

/// <summary>A labelled progress bar in the route-metrics strip (web <c>MetricBar</c> + sub-line).</summary>
public sealed record RouteMetricBarDisplay(string Label, double Value, double Max, string ValueText, string AccentBrushKey);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>RouteEfficiencyPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI
/// types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record RouteEfficiencyDisplay(
    RouteEfficiencyState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<RouteSummaryStatDisplay> SummaryStats,
    RouteComparisonChartDisplay Comparison,
    IReadOnlyList<RouteCardDisplay> RouteCards,
    string MetricsTitle,
    IReadOnlyList<RouteMetricBarDisplay> MetricBars,
    string MetricsEmptyMessage,
    string EfficiencyUnit,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests construct
/// it directly. Pure data — no WinUI types.
/// </summary>
public sealed record RouteEfficiencyModel(RouteEfficiencySnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the query is in flight with no data yet.</summary>
    public static RouteEfficiencyModel Initial { get; } = new(RouteEfficiencySnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>RouteEfficiencyPage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass.
/// </summary>
public sealed record RouteEfficiencyStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string Routes { get; init; }
    public required string TotalTrips { get; init; }
    public required string BestEfficiency { get; init; }
    public required string AvgEfficiency { get; init; }
    public required string Comparison { get; init; }
    public required string ComparisonAria { get; init; }
    public required string ColRoute { get; init; }
    public required string Best { get; init; }
    public required string AvgLabel { get; init; }
    public required string Worst { get; init; }
    public required string Trips { get; init; }
    public required string Avg { get; init; }
    public required string Metrics { get; init; }
    public required string BestLabel { get; init; }
    public required string WorstLabel { get; init; }
    public required string MostDrivenLabel { get; init; }
    public required string NoData { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static RouteEfficiencyStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new RouteEfficiencyStrings
        {
            Title = localizer.GetString("routeEfficiency.title", "Route Efficiency"),
            Subtitle = localizer.GetString("routeEfficiency.subtitle", "Compare efficiency across your most-driven routes"),
            Routes = localizer.GetString("routeEfficiency.routes", "Routes"),
            TotalTrips = localizer.GetString("routeEfficiency.totalTrips", "Total Trips"),
            BestEfficiency = localizer.GetString("routeEfficiency.bestEfficiency", "Best"),
            AvgEfficiency = localizer.GetString("routeEfficiency.avgEfficiency", "Avg"),
            Comparison = localizer.GetString("routeEfficiency.comparison", "Route Efficiency Comparison"),
            ComparisonAria = localizer.GetString(
                "routeEfficiency.comparison.aria",
                "Per-route best, average, and worst efficiency comparison bar chart"),
            ColRoute = localizer.GetString("routeEfficiency.col.route", "Route"),
            Best = localizer.GetString("routeEfficiency.best", "Best"),
            AvgLabel = localizer.GetString("routeEfficiency.avgLabel", "Avg"),
            Worst = localizer.GetString("routeEfficiency.worst", "Worst"),
            Trips = localizer.GetString("routeEfficiency.trips", "trips"),
            Avg = localizer.GetString("routeEfficiency.avg", "avg"),
            Metrics = localizer.GetString("routeEfficiency.metrics", "Route Metrics"),
            BestLabel = localizer.GetString("routeEfficiency.bestLabel", "Best Efficiency"),
            WorstLabel = localizer.GetString("routeEfficiency.worstLabel", "Worst Efficiency"),
            MostDrivenLabel = localizer.GetString("routeEfficiency.mostDrivenLabel", "Most Driven Route"),
            NoData = localizer.GetString("common.noData", "No data available"),
            ErrorTitle = localizer.GetString("routeEfficiency.error", "Unable to load route efficiency"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="RouteEfficiencyModel"/> to its <see cref="RouteEfficiencyDisplay"/> — the
/// native port of the render logic in web/src/features/driving/pages/RouteEfficiencyPage.tsx and its
/// <c>efficiencyVariant</c> / summary / <c>chartData</c> / <c>RouteCard</c> helpers. The branch precedence mirrors
/// the web data lifecycle (loading → error → empty → success); the rollup feeds the four hero summary tiles, the
/// route-comparison bar chart, the per-route cards and the four route-metrics bars. Every label resolves through
/// the i18n facade using the same keys the web page uses and every SI value is converted at this display boundary.
/// </summary>
public static class RouteEfficiencyProjection
{
    /// <summary>Wh/km → Wh/mi factor (km per mile), web <c>* 1.609344</c>.</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>The number of comparison bars the chart keeps (web <c>.slice(0, 10)</c>).</summary>
    public const int ComparisonLimit = 10;

    private const int EfficiencyPrecision = 0;
    private const int DistancePrecision = 1;
    private const string EmDash = "\u2014";
    private const string Arrow = " \u2192 ";

    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string InfoBrush = "TsColorInfoBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed route rollup plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static RouteEfficiencyDisplay Project(RouteEfficiencyModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = RouteEfficiencyStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var routes = snapshot.Routes;

        RouteEfficiencyState state =
            model.Loading && !snapshot.HasData ? RouteEfficiencyState.Loading
            : model.ErrorDetail is not null ? RouteEfficiencyState.Error
            : !snapshot.HasData ? RouteEfficiencyState.Empty
            : RouteEfficiencyState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        string unit = EfficiencyUnit(units);

        int totalTrips = snapshot.TotalTrips > 0 ? snapshot.TotalTrips : SumTrips(routes);
        double bestEff = routes.Count > 0 ? routes.Min(r => r.BestEfficiencyWhKm) : 0;
        double worstEff = routes.Count > 0 ? routes.Max(r => r.WorstEfficiencyWhKm) : 0;
        double avgEff = routes.Count > 0 ? routes.Average(r => r.AvgEfficiencyWhKm) : 0;

        var summary = BuildSummary(routes.Count, totalTrips, bestEff, avgEff, unit, s, units);
        var comparison = BuildComparison(routes, unit, s, units);
        var cards = BuildCards(routes, unit, s, units);
        var metricBars = BuildMetricBars(routes, bestEff, avgEff, worstEff, unit, s, units);

        return new RouteEfficiencyDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == RouteEfficiencyState.Loading,
            ShowError: state == RouteEfficiencyState.Error,
            ShowEmpty: state == RouteEfficiencyState.Empty,
            ShowContent: state == RouteEfficiencyState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoData,
            SummaryStats: summary,
            Comparison: comparison,
            RouteCards: cards,
            MetricsTitle: s.Metrics,
            MetricBars: metricBars,
            MetricsEmptyMessage: s.NoData,
            EfficiencyUnit: unit,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>The active efficiency unit label (web <c>unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'</c>).</summary>
    public static string EfficiencyUnit(UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        return units.Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";
    }

    /// <summary>Convert an SI Wh/km efficiency to the display unit (web <c>toEfficiencyDisplay</c>).</summary>
    public static double ToEfficiencyDisplay(double whPerKm, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        return units.Distance == DistanceUnit.Mi ? whPerKm * KmPerMile : whPerKm;
    }

    /// <summary>
    /// The semantic quality band of a raw Wh/km efficiency (web <c>efficiencyVariant</c>): &lt;140 success,
    /// &lt;180 info, &lt;220 warning, otherwise danger. Applied to the raw SI value exactly as the web does.
    /// </summary>
    public static StatusKind EfficiencyStatus(double whPerKm) =>
        whPerKm < 140 ? StatusKind.Success
        : whPerKm < 180 ? StatusKind.Info
        : whPerKm < 220 ? StatusKind.Warning
        : StatusKind.Danger;

    private static int SumTrips(IReadOnlyList<RouteSummaryModel> routes)
    {
        int total = 0;
        foreach (var r in routes)
        {
            total += r.TripCount;
        }

        return total;
    }

    private static IReadOnlyList<RouteSummaryStatDisplay> BuildSummary(
        int routeCount, int totalTrips, double bestEff, double avgEff, string unit, RouteEfficiencyStrings s, UnitPref units)
    {
        return
        [
            new RouteSummaryStatDisplay(routeCount, s.Routes, StatusKind.Info, $"{s.Routes}: {routeCount}"),
            new RouteSummaryStatDisplay(totalTrips, s.TotalTrips, StatusKind.Neutral, $"{s.TotalTrips}: {totalTrips}"),
            new RouteSummaryStatDisplay(
                Math.Round(ToEfficiencyDisplay(bestEff, units)),
                $"{s.BestEfficiency} {unit}",
                StatusKind.Success,
                $"{s.BestEfficiency} {unit}: {Format(ToEfficiencyDisplay(bestEff, units))}"),
            new RouteSummaryStatDisplay(
                Math.Round(ToEfficiencyDisplay(avgEff, units)),
                $"{s.AvgEfficiency} {unit}",
                StatusKind.Warning,
                $"{s.AvgEfficiency} {unit}: {Format(ToEfficiencyDisplay(avgEff, units))}"),
        ];
    }

    private static RouteComparisonChartDisplay BuildComparison(
        IReadOnlyList<RouteSummaryModel> routes, string unit, RouteEfficiencyStrings s, UnitPref units)
    {
        var ordered = routes
            .OrderBy(r => r.AvgEfficiencyWhKm)
            .Take(ComparisonLimit)
            .ToList();

        var rows = new List<RouteComparisonRow>(ordered.Count);
        var bestPoints = new List<ChartPoint>(ordered.Count);
        var avgPoints = new List<ChartPoint>(ordered.Count);
        var worstPoints = new List<ChartPoint>(ordered.Count);

        for (int i = 0; i < ordered.Count; i++)
        {
            var r = ordered[i];
            string name = $"{Truncate(r.StartLocation)}\u2192{Truncate(r.EndLocation)}";
            double best = Math.Round(ToEfficiencyDisplay(r.BestEfficiencyWhKm, units));
            double avg = Math.Round(ToEfficiencyDisplay(r.AvgEfficiencyWhKm, units));
            double worst = Math.Round(ToEfficiencyDisplay(r.WorstEfficiencyWhKm, units));

            rows.Add(new RouteComparisonRow(name, best, avg, worst, r.TripCount));
            bestPoints.Add(new ChartPoint(i, best, name));
            avgPoints.Add(new ChartPoint(i, avg, name));
            worstPoints.Add(new ChartPoint(i, worst, name));
        }

        string bestLabel = $"{s.Best} {unit}";
        string avgLabel = $"{s.AvgLabel} {unit}";
        string worstLabel = $"{s.Worst} {unit}";

        var series = new List<RouteSeriesDisplay>
        {
            new(bestLabel, ChartSeriesKind.Bar, 1, bestPoints),
            new(avgLabel, ChartSeriesKind.Bar, 0, avgPoints),
            new(worstLabel, ChartSeriesKind.Bar, 3, worstPoints),
        };

        // Web gate: the comparison chart only renders when more than one route is present (chartData.length > 1).
        return new RouteComparisonChartDisplay(
            Visible: rows.Count > 1,
            HasData: rows.Count > 0,
            Title: s.Comparison,
            AriaLabel: s.ComparisonAria,
            RouteColumnLabel: s.ColRoute,
            BestSeriesLabel: bestLabel,
            AvgSeriesLabel: avgLabel,
            WorstSeriesLabel: worstLabel,
            Rows: rows,
            Series: series);
    }

    private static List<RouteCardDisplay> BuildCards(
        IReadOnlyList<RouteSummaryModel> routes, string unit, RouteEfficiencyStrings s, UnitPref units)
    {
        var cards = new List<RouteCardDisplay>(routes.Count);
        foreach (var r in routes)
        {
            double avgEff = ToEfficiencyDisplay(r.AvgEfficiencyWhKm, units);
            double bestEff = ToEfficiencyDisplay(r.BestEfficiencyWhKm, units);
            double worstEff = ToEfficiencyDisplay(r.WorstEfficiencyWhKm, units);

            string title = $"{Place(r.StartLocation)}{Arrow}{Place(r.EndLocation)}";
            double distanceDisplay = UnitConverters.DistanceFromSi(r.AvgDistanceKm * 1000.0, units.Distance);
            string distanceLabel = UnitLabels.Label(units.Distance);
            string meta = $"{r.TripCount} {s.Trips} \u00b7 {ScalarFormatters.FormatNumber(distanceDisplay, DistancePrecision)} {distanceLabel} {s.Avg}";

            StatusKind status = EfficiencyStatus(r.AvgEfficiencyWhKm);
            string badge = $"{Format(avgEff)} {unit}";

            cards.Add(new RouteCardDisplay(
                Title: title,
                Meta: meta,
                BadgeText: badge,
                BadgeStatus: status,
                BestLabel: s.Best,
                AvgLabel: s.AvgLabel,
                WorstLabel: s.Worst,
                BestText: Format(bestEff),
                AvgText: Format(avgEff),
                WorstText: Format(worstEff),
                BarValue: avgEff,
                BarMax: Math.Max(worstEff, 1),
                BarAccentBrushKey: StatusResources.AccentBrushKey(status),
                AutomationName: $"{title}. {badge}. {s.Best} {Format(bestEff)}, {s.AvgLabel} {Format(avgEff)}, {s.Worst} {Format(worstEff)} {unit}"));
        }

        return cards;
    }

    private static IReadOnlyList<RouteMetricBarDisplay> BuildMetricBars(
        IReadOnlyList<RouteSummaryModel> routes,
        double bestEff,
        double avgEff,
        double worstEff,
        string unit,
        RouteEfficiencyStrings s,
        UnitPref units)
    {
        double bestDisplay = ToEfficiencyDisplay(bestEff, units);
        double avgDisplay = ToEfficiencyDisplay(avgEff, units);
        double worstDisplay = ToEfficiencyDisplay(worstEff, units);
        int mostDriven = routes.Count > 0 ? routes[0].TripCount : 0;

        return
        [
            new RouteMetricBarDisplay(s.BestLabel, bestDisplay, 300, $"{Format(bestDisplay)} {unit}", SuccessBrush),
            new RouteMetricBarDisplay(s.AvgLabel, avgDisplay, 300, $"{Format(avgDisplay)} {unit}", AccentBrush),
            new RouteMetricBarDisplay(s.WorstLabel, worstDisplay, 400, $"{Format(worstDisplay)} {unit}", DangerBrush),
            new RouteMetricBarDisplay(
                s.MostDrivenLabel,
                mostDriven,
                Math.Max(mostDriven, 20),
                $"{mostDriven} {s.Trips}",
                InfoBrush),
        ];
    }

    private static string Format(double value) => ScalarFormatters.FormatNumber(value, EfficiencyPrecision);

    private static string Place(string value) => string.IsNullOrWhiteSpace(value) ? EmDash : value;

    private static string Truncate(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        return value.Length <= 10 ? value : value[..10];
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Route-Efficiency page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the snake_case wire
/// shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class RouteJson
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

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Route-Efficiency page — the native mirror of the web page
/// at web/src/features/driving/pages/RouteEfficiencyPage.tsx (route <c>/route-efficiency</c>, nav name
/// <c>RouteEfficiency</c>). The page reads the same route-efficiency rollup the web <c>useRouteEfficiency</c> hook
/// reads (generated operation <c>get_api_v1_analytics_route_efficiency</c>).
/// </summary>
public static class RouteEfficiencyRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "RouteEfficiency";

    /// <summary>The deep-link route slug (web route <c>/route-efficiency</c>).</summary>
    public const string Route = "route-efficiency";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RouteEfficiencyPage";

    /// <summary>The generated operation id for the route-efficiency read (web <c>useRouteEfficiency</c>).</summary>
    public const string RouteOperation = Operations.Analytics.RouteEfficiency;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Activity</c>).</summary>
    public const string EmptyGlyph = "\uE9D2";

    /// <summary>The localized page title (web <c>t('routeEfficiency.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("routeEfficiency.title", "Route Efficiency");
    }

    /// <summary>The localized page subtitle (web <c>t('routeEfficiency.subtitle')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("routeEfficiency.subtitle", "Compare efficiency across your most-driven routes");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Route-Efficiency surface — records only the <c>view.opened</c> event with the
/// surface slug, never any route, location or vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class RouteEfficiencyDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public RouteEfficiencyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RouteEfficiencyRegistration.Slug}");
    }
}
