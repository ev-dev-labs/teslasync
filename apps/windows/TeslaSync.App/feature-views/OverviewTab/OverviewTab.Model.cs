using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The lifecycle state a <see cref="OverviewTabViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the OverviewTab surface renders. Mirrors
/// the way web/src/features/analytics/pages/AnalyticsPage.tsx drives the fleet-analytics query
/// (<c>useFleetAnalytics({ start, end })</c>) and passes its <c>data</c> into
/// <c>features/analytics/components/analytics/OverviewTab.tsx</c>: the page gates the whole tab on the
/// query's loading/error, while the tab itself shows per-section empty states when an individual array is
/// empty. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum OverviewTabState
{
    /// <summary>The fleet-analytics read is in flight with no cached snapshot yet — skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh fleet-analytics object resolved — render the four panels (web active tab body).</summary>
    Loaded,

    /// <summary>The read succeeded but returned no analytics object at all — the friendly empty surface.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>One vehicle row from <c>vehicle_comparison</c>. <see cref="DistanceKm"/> is the raw SI-derived
/// kilometre value the web reads as <c>v.distance</c> (converted to the user's unit only at projection).</summary>
public sealed record OverviewVehicleDistance(string Name, double DistanceKm);

/// <summary>One row from <c>drive_analytics.day_of_week</c>: the bar (<see cref="Drives"/>, left axis) and
/// the line (<see cref="AvgDistance"/>, right axis) the web composed chart plots. <see cref="AvgDistance"/>
/// is plotted verbatim by the web (no unit conversion), so it is carried raw.</summary>
public sealed record OverviewDayOfWeek(string Day, double Drives, double AvgDistance);

/// <summary>One row from <c>charging_analytics.monthly_trend</c>: the two cost bars (<see cref="Cost"/>,
/// <see cref="GasCost"/>, left axis) and the savings line (<see cref="Savings"/>, right axis, which can be
/// negative) the web composed chart plots.</summary>
public sealed record OverviewMonthlyCost(string Month, double Cost, double GasCost, double Savings);

/// <summary>
/// The subset of <c>FleetAnalytics</c> the OverviewTab surface consumes — the three series the web
/// component reads (<c>data?.vehicle_comparison</c>, <c>data?.drive_analytics?.day_of_week</c>,
/// <c>data?.charging_analytics?.monthly_trend</c>). Pure data — no WinUI types — so the parse + projection
/// are unit-tested without a UI host. Every list is non-null (empty when the wire field is missing),
/// mirroring the web's <c>?? []</c> guards.
/// </summary>
public sealed record OverviewData(
    IReadOnlyList<OverviewVehicleDistance> Vehicles,
    IReadOnlyList<OverviewDayOfWeek> DaysOfWeek,
    IReadOnlyList<OverviewMonthlyCost> Months)
{
    /// <summary>An all-empty snapshot — the parse fallback for a non-object body.</summary>
    public static OverviewData Empty { get; } = new([], [], []);

    /// <summary>True when any of the three series carries at least one row.</summary>
    public bool HasAny => Vehicles.Count > 0 || DaysOfWeek.Count > 0 || Months.Count > 0;

    /// <summary>
    /// Parse a <c>GET /analytics/fleet</c> object into the OverviewTab read-model. Tolerant of missing
    /// fields and wrong kinds (defaults to empty lists / zero), mirroring the web's optional-chaining +
    /// <c>safe()</c> guards. A non-object root yields <see cref="Empty"/>.
    /// </summary>
    public static OverviewData Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var vehicles = new List<OverviewVehicleDistance>();
        if (root.TryGetProperty("vehicle_comparison", out var vc) && vc.ValueKind == JsonValueKind.Array)
        {
            foreach (var v in vc.EnumerateArray())
            {
                if (v.ValueKind == JsonValueKind.Object)
                {
                    vehicles.Add(new OverviewVehicleDistance(GetString(v, "name") ?? string.Empty, GetDouble(v, "distance") ?? 0));
                }
            }
        }

        var days = new List<OverviewDayOfWeek>();
        if (root.TryGetProperty("drive_analytics", out var drive) && drive.ValueKind == JsonValueKind.Object &&
            drive.TryGetProperty("day_of_week", out var dow) && dow.ValueKind == JsonValueKind.Array)
        {
            foreach (var d in dow.EnumerateArray())
            {
                if (d.ValueKind == JsonValueKind.Object)
                {
                    days.Add(new OverviewDayOfWeek(
                        GetString(d, "day") ?? string.Empty,
                        GetDouble(d, "drives") ?? 0,
                        GetDouble(d, "avg_distance") ?? 0));
                }
            }
        }

        var months = new List<OverviewMonthlyCost>();
        if (root.TryGetProperty("charging_analytics", out var charging) && charging.ValueKind == JsonValueKind.Object &&
            charging.TryGetProperty("monthly_trend", out var trend) && trend.ValueKind == JsonValueKind.Array)
        {
            foreach (var m in trend.EnumerateArray())
            {
                if (m.ValueKind == JsonValueKind.Object)
                {
                    months.Add(new OverviewMonthlyCost(
                        GetString(m, "month") ?? string.Empty,
                        GetDouble(m, "cost") ?? 0,
                        GetDouble(m, "gas_cost") ?? 0,
                        GetDouble(m, "savings") ?? 0));
                }
            }
        }

        return new OverviewData(vehicles, days, months);
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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

/// <summary>One projected bar: its raw value, the 0..1 height ratio against the chart's left-axis maximum,
/// the formatted display string, and a Narrator name.</summary>
public sealed record OverviewBar(double Value, double HeightRatio, string Display, string AutomationName);

/// <summary>One projected line vertex: its raw value, the 0..1 ratio against the chart's right-axis domain
/// (which may include negatives), the formatted display string, and a Narrator name.</summary>
public sealed record OverviewLinePoint(double Value, double Ratio, string Display, string AutomationName);

/// <summary>A projected bar series across the chart's categories (web recharts <c>Bar</c>).</summary>
public sealed record OverviewBarSeries(string Name, int ColorIndex, IReadOnlyList<OverviewBar> Bars);

/// <summary>A projected line series across the chart's categories (web recharts <c>Line</c>).
/// <see cref="ZeroRatio"/> is where the value 0 sits in the right-axis domain so the view can anchor the
/// baseline when the series carries negative values.</summary>
public sealed record OverviewLineSeries(string Name, int ColorIndex, double ZeroRatio, IReadOnlyList<OverviewLinePoint> Points);

/// <summary>
/// One fully projected chart section — the native analogue of a single web recharts <c>BarChart</c> /
/// <c>ComposedChart</c> in OverviewTab.tsx. Holds the localized <see cref="Title"/>, the per-section
/// <see cref="HasData"/> gate (web <c>arr.length &gt; 0</c>) with its <see cref="EmptyMessage"/>, the
/// ordered category labels, the bar series (one for the distance/day charts, two for the monthly chart) and
/// the optional right-axis line. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record OverviewChart(
    string Key,
    string Title,
    bool HasData,
    string EmptyMessage,
    string AriaLabel,
    IReadOnlyList<string> Categories,
    IReadOnlyList<OverviewBarSeries> BarSeries,
    OverviewLineSeries? LineSeries);

/// <summary>One projected Quick Link — the localized label, the in-app route, the Fluent glyph and the
/// Narrator name (web <c>QUICK_LINKS</c> entry rendered as a <c>&lt;Link&gt;</c>).</summary>
public sealed record OverviewQuickLink(string Key, string Label, string Route, string Glyph, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the OverviewTab body — the three charts (distance, day-of-week,
/// monthly cost) plus the Quick Links panel. The native analogue of the JSX OverviewTab returns. Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
public sealed record OverviewTabDisplay(
    IReadOnlyList<OverviewChart> Charts,
    string QuickLinksTitle,
    IReadOnlyList<OverviewQuickLink> QuickLinks);

/// <summary>
/// Pure projection from a parsed <see cref="OverviewData"/> to the render-ready <see cref="OverviewTabDisplay"/>
/// — the native port of the <c>useMemo</c> transforms in OverviewTab.tsx. The vehicle distance is converted to
/// the user's display unit here (and only here), exactly reproducing the web's
/// <c>convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit)</c> (km→m scale then SI→unit). The
/// day-of-week average distance and the monthly cost/savings figures are plotted verbatim, matching the web
/// (which passes them straight to recharts with no conversion). Every label resolves through the i18n facade.
/// </summary>
public static class OverviewTabProjection
{
    private const double MetersPerKm = 1000.0;

    // Web color indices (CHART_COLORS[i]) mapped to the native categorical palette index.
    private const int DistanceColor = 0;   // CHART_COLORS[0]
    private const int DrivesColor = 2;     // CHART_COLORS[2]
    private const int AvgDistColor = 3;    // CHART_COLORS[3]
    private const int ElectricColor = 0;   // CHART_COLORS[0]
    private const int GasColor = 5;        // CHART_COLORS[5]
    private const int SavingsColor = 1;    // CHART_COLORS[1]

    /// <summary>The five Quick Link routes (web <c>QUICK_LINKS</c> hrefs), in order.</summary>
    public static IReadOnlyList<(string Key, string Route, string Glyph)> QuickLinkSpecs { get; } =
    [
        ("analytics.links.statistics", "/statistics", "\uE9D9"),   // BarChart4 — web BarChart3
        ("analytics.links.compare", "/period-compare", "\uE9D2"),  // Diagnostic — web Activity
        ("analytics.links.weeklyDigest", "/weekly-digest", "\uE787"), // Calendar — web Calendar
        ("analytics.links.mileage", "/mileage", "\uE707"),         // Location — web MapPin
        ("analytics.links.timeline", "/timeline", "\uE917"),       // Clock — web Clock
    ];

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/> and localizer.</summary>
    public static OverviewTabDisplay Project(OverviewData data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var charts = new List<OverviewChart>(3)
        {
            BuildDistanceChart(data.Vehicles, units, localizer),
            BuildDayOfWeekChart(data.DaysOfWeek, localizer),
            BuildMonthlyChart(data.Months, localizer),
        };

        return new OverviewTabDisplay(
            charts,
            localizer.GetString("analytics.overview.quickLinks", "Quick Links"),
            BuildQuickLinks(localizer));
    }

    private static OverviewChart BuildDistanceChart(
        IReadOnlyList<OverviewVehicleDistance> vehicles, UnitPref units, ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.overview.distByVehicle", "Distance by Vehicle");
        string empty = localizer.GetString("analytics.overview.noVehicles", "No vehicle data");
        string unitLabel = UnitLabels.Label(units.Distance);

        var categories = new List<string>(vehicles.Count);
        var values = new List<double>(vehicles.Count);
        foreach (var v in vehicles)
        {
            categories.Add(v.Name);
            // Web parity (OverviewTab.tsx L33): convertDistanceFromSI(safe(v.distance) * 1000, distanceUnit).
            values.Add(UnitConverters.DistanceFromSi(v.DistanceKm * MetersPerKm, units.Distance));
        }

        double max = Max(values);
        var bars = new List<OverviewBar>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            string display = $"{ScalarFormatters.FormatNumber(values[i], 1)} {unitLabel}";
            bars.Add(new OverviewBar(values[i], Ratio(values[i], max), display, $"{categories[i]}, {unitLabel}: {display}"));
        }

        var series = new OverviewBarSeries(unitLabel, DistanceColor, bars);
        return new OverviewChart(
            "distance", title, vehicles.Count > 0, empty, title, categories, [series], LineSeries: null);
    }

    private static OverviewChart BuildDayOfWeekChart(IReadOnlyList<OverviewDayOfWeek> days, ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.overview.dayOfWeek", "Day of Week Pattern");
        string empty = localizer.GetString("analytics.overview.noDow", "No day-of-week data");
        string drivesName = localizer.GetString("analytics.overview.drives", "Drives");
        string avgName = localizer.GetString("analytics.overview.avgDist", "Avg Distance");

        var categories = new List<string>(days.Count);
        var drives = new List<double>(days.Count);
        var avg = new List<double>(days.Count);
        foreach (var d in days)
        {
            categories.Add(d.Day);
            drives.Add(d.Drives);
            avg.Add(d.AvgDistance);
        }

        var barSeries = new OverviewBarSeries(drivesName, DrivesColor, BarsOf(categories, drives, drivesName, 0));
        var lineSeries = LineOf(categories, avg, avgName, AvgDistColor, 1);

        return new OverviewChart(
            "dayOfWeek", title, days.Count > 0, empty, title, categories, [barSeries], lineSeries);
    }

    private static OverviewChart BuildMonthlyChart(IReadOnlyList<OverviewMonthlyCost> months, ILocalizer localizer)
    {
        string title = localizer.GetString("analytics.overview.monthlyCost", "Monthly Cost Comparison");
        string empty = localizer.GetString("analytics.overview.noMonthly", "No monthly data");
        string electricName = localizer.GetString("analytics.overview.electricCost", "Electric Cost");
        string gasName = localizer.GetString("analytics.overview.gasCost", "Gas Cost");
        string savingsName = localizer.GetString("analytics.overview.savings", "Savings");

        var categories = new List<string>(months.Count);
        var cost = new List<double>(months.Count);
        var gas = new List<double>(months.Count);
        var savings = new List<double>(months.Count);
        foreach (var m in months)
        {
            categories.Add(m.Month);
            cost.Add(m.Cost);
            gas.Add(m.GasCost);
            savings.Add(m.Savings);
        }

        // Both cost bars share the same left axis, so they normalise against one shared maximum.
        double leftMax = Math.Max(Max(cost), Max(gas));
        var electricBars = CurrencyBars(categories, cost, electricName, leftMax);
        var gasBars = CurrencyBars(categories, gas, gasName, leftMax);
        var lineSeries = CurrencyLine(categories, savings, savingsName, SavingsColor);

        return new OverviewChart(
            "monthlyCost",
            title,
            months.Count > 0,
            empty,
            title,
            categories,
            [new OverviewBarSeries(electricName, ElectricColor, electricBars), new OverviewBarSeries(gasName, GasColor, gasBars)],
            lineSeries);
    }

    private static List<OverviewBar> BarsOf(
        List<string> categories, List<double> values, string seriesName, int decimals)
    {
        double max = Max(values);
        var bars = new List<OverviewBar>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            string display = ScalarFormatters.FormatNumber(values[i], decimals);
            bars.Add(new OverviewBar(values[i], Ratio(values[i], max), display, $"{categories[i]}, {seriesName}: {display}"));
        }

        return bars;
    }

    private static List<OverviewBar> CurrencyBars(
        List<string> categories, List<double> values, string seriesName, double max)
    {
        var bars = new List<OverviewBar>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            string display = ScalarFormatters.FormatCurrency(values[i]);
            bars.Add(new OverviewBar(values[i], Ratio(values[i], max), display, $"{categories[i]}, {seriesName}: {display}"));
        }

        return bars;
    }

    private static OverviewLineSeries LineOf(
        List<string> categories, List<double> values, string seriesName, int colorIndex, int decimals)
    {
        var (min, max) = Domain(values);
        double range = max - min;
        if (range <= 0)
        {
            range = 1;
        }

        var points = new List<OverviewLinePoint>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            string display = ScalarFormatters.FormatNumber(values[i], decimals);
            double ratio = Math.Clamp((values[i] - min) / range, 0, 1);
            points.Add(new OverviewLinePoint(values[i], ratio, display, $"{categories[i]}, {seriesName}: {display}"));
        }

        double zeroRatio = Math.Clamp((0 - min) / range, 0, 1);
        return new OverviewLineSeries(seriesName, colorIndex, zeroRatio, points);
    }

    private static OverviewLineSeries CurrencyLine(
        List<string> categories, List<double> values, string seriesName, int colorIndex)
    {
        var (min, max) = Domain(values);
        double range = max - min;
        if (range <= 0)
        {
            range = 1;
        }

        var points = new List<OverviewLinePoint>(values.Count);
        for (int i = 0; i < values.Count; i++)
        {
            string display = ScalarFormatters.FormatCurrency(values[i]);
            double ratio = Math.Clamp((values[i] - min) / range, 0, 1);
            points.Add(new OverviewLinePoint(values[i], ratio, display, $"{categories[i]}, {seriesName}: {display}"));
        }

        double zeroRatio = Math.Clamp((0 - min) / range, 0, 1);
        return new OverviewLineSeries(seriesName, colorIndex, zeroRatio, points);
    }

    private static List<OverviewQuickLink> BuildQuickLinks(ILocalizer localizer)
    {
        var links = new List<OverviewQuickLink>(QuickLinkSpecs.Count);
        foreach (var (key, route, glyph) in QuickLinkSpecs)
        {
            // Web parity (OverviewTab.tsx L113): t(link.labelKey, link.labelKey.split('.').pop()).
            string fallback = key[(key.LastIndexOf('.') + 1)..];
            string label = localizer.GetString(key, fallback);
            links.Add(new OverviewQuickLink(key, label, route, glyph, label));
        }

        return links;
    }

    // Bars share a [0, max] domain (web YAxis includes zero); a non-positive max collapses every bar to 0.
    private static double Ratio(double value, double max) => max > 0 ? Math.Clamp(value / max, 0, 1) : 0;

    private static double Max(List<double> values)
    {
        double max = 0;
        foreach (var v in values)
        {
            if (v > max)
            {
                max = v;
            }
        }

        return max;
    }

    // Right-axis domain always includes zero so a line with negative savings keeps a stable baseline.
    private static (double Min, double Max) Domain(List<double> values)
    {
        double min = 0;
        double max = 0;
        foreach (var v in values)
        {
            min = Math.Min(min, v);
            max = Math.Max(max, v);
        }

        return (min, max);
    }
}

/// <summary>
/// Maps the cache-then-network engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions for
/// <c>GET /analytics/fleet</c> into parsed <c>RepositoryResult&lt;OverviewData&gt;</c> snapshots. A non-object
/// body is treated as empty by the engine's empty predicate, so this only parses value-bearing states. Kept
/// pure so the mapping is unit-tested without a network or cache.
/// </summary>
public static class OverviewTabResultMapper
{
    /// <summary>Map one raw emission, parsing the analytics object for value-bearing states.</summary>
    public static RepositoryResult<OverviewData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<OverviewData>.Loading(),
            LoadStatus.Empty => RepositoryResult<OverviewData>.Empty(raw.FetchedAt),
            LoadStatus.Cached => RepositoryResult<OverviewData>.Cached(OverviewData.Parse(raw.Value), Stamp(raw), raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<OverviewData>.Refreshing(OverviewData.Parse(raw.Value), Stamp(raw), raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<OverviewData>.Loaded(OverviewData.Parse(raw.Value), Stamp(raw)),
            LoadStatus.Offline => RepositoryResult<OverviewData>.OfflineCached(
                OverviewData.Parse(raw.Value),
                Stamp(raw),
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A fleet read is unavailable")),
            _ => RepositoryResult<OverviewData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load fleet analytics")),
        };
    }

    private static DateTimeOffset Stamp(RepositoryResult<JsonElement> raw) => raw.FetchedAt ?? DateTimeOffset.UtcNow;
}
