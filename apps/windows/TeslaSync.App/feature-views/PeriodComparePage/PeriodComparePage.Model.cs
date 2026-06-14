using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>PeriodComparePage</c> surface — the native mirror of the four
/// data states the web page renders (web/src/features/analytics/pages/PeriodComparePage.tsx). The web page runs
/// <c>useVehicles</c> plus the two <c>GET /analytics/period-stats</c> queries (one per period) and renders, in
/// precedence order, a failure banner (web <c>error</c>), then — while <c>!a || !b</c> — either a loading skeleton
/// (web <c>isLoading</c>) or the empty state, otherwise the metric cards + chart + table + insights. The selectors
/// panel and the disambiguation banner are always visible; this enum is the top-level summary the ledger/Narrator
/// key off, while per-region visibility is still driven by the projected flags.
/// </summary>
public enum PeriodCompareState
{
    /// <summary>The first load is in flight with neither period resolved yet (web <c>isLoading</c> over an empty result).</summary>
    Loading,

    /// <summary>Resolved with no vehicle / no period stats (web <c>!a || !b</c> empty state).</summary>
    Empty,

    /// <summary>A query failed (web <c>error</c>) — the failure banner is shown above the panels.</summary>
    Error,

    /// <summary>Both periods resolved — the metric cards, chart, table and insights render.</summary>
    Success,
}

/// <summary>
/// The canonical period-stats envelope from <c>GET /analytics/period-stats?vehicle_id=…&amp;days=…</c> — the native
/// mirror of the web <c>PeriodStats</c> interface. The numbers arrive in display units (km, kWh, Wh/km, kg) exactly
/// as the Go handler emits them; distance and efficiency are restated to the user's preferred unit only at projection
/// time. Parsing is null-tolerant so a partial body never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="TotalDistanceKm">Total distance over the window, in kilometres (web <c>total_distance</c>).</param>
/// <param name="TotalDrives">Number of completed drives (web <c>total_drives</c>).</param>
/// <param name="EnergyUsedKwh">Energy added by charging, in kWh (web <c>energy_used</c>).</param>
/// <param name="AvgEfficiencyWhPerKm">Average efficiency, in Wh/km (web <c>avg_efficiency</c>).</param>
/// <param name="TotalCost">Total charging cost in the account currency (web <c>total_cost</c>).</param>
/// <param name="Co2SavedKg">CO₂ saved vs an equivalent ICE, in kilograms (web <c>co2_saved</c>).</param>
public sealed record PeriodStats(
    double TotalDistanceKm,
    int TotalDrives,
    double EnergyUsedKwh,
    double AvgEfficiencyWhPerKm,
    double TotalCost,
    double Co2SavedKg)
{
    /// <summary>An all-zero envelope — the parse fallback for an absent / non-object body.</summary>
    public static PeriodStats Zero { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>Project a <c>GET /analytics/period-stats</c> JSON object into a tolerant envelope.</summary>
    public static PeriodStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Zero;
        }

        return new PeriodStats(
            TotalDistanceKm: PeriodCompareJson.Double(element, "total_distance") ?? 0,
            TotalDrives: PeriodCompareJson.Int(element, "total_drives") ?? 0,
            EnergyUsedKwh: PeriodCompareJson.Double(element, "energy_used") ?? 0,
            AvgEfficiencyWhPerKm: PeriodCompareJson.Double(element, "avg_efficiency") ?? 0,
            TotalCost: PeriodCompareJson.Double(element, "total_cost") ?? 0,
            Co2SavedKg: PeriodCompareJson.Double(element, "co2_saved") ?? 0);
    }
}

/// <summary>
/// One fleet vehicle for the picker — the native mirror of the web <c>useVehicles</c> row. Field names mirror the Go
/// API's snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
public sealed record PeriodCompareVehicle(long Id, string? DisplayName, string? Vin)
{
    /// <summary>The picker label (web <c>display_name || vin</c>).</summary>
    public string Label =>
        !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName! :
        !string.IsNullOrWhiteSpace(Vin) ? Vin! : $"Vehicle {Id}";

    /// <summary>Parse a vehicles JSON array into a tolerant list of rows, skipping malformed entries.</summary>
    public static IReadOnlyList<PeriodCompareVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<PeriodCompareVehicle>();
        }

        var list = new List<PeriodCompareVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = PeriodCompareJson.Long(item, "id") ?? PeriodCompareJson.Long(item, "vehicle_id");
            if (id is null)
            {
                continue;
            }

            list.Add(new PeriodCompareVehicle(
                id.Value,
                PeriodCompareJson.Str(item, "display_name") ?? PeriodCompareJson.Str(item, "displayName"),
                PeriodCompareJson.Str(item, "vin")));
        }

        return list;
    }
}

/// <summary>One pre-formatted comparison metric tile (web <c>MetricCard</c>): label, icon, the two period values,
/// the percentage delta and the accent colour, plus the raw converted values for the chart.</summary>
public sealed record PeriodCompareMetric(
    string Key,
    string Label,
    string Glyph,
    string ValueText,
    string SubtitleText,
    string DeltaText,
    bool DeltaPositive,
    string AccentBrushKey,
    double ChartA,
    double ChartB);

/// <summary>One projected comparison-table row (web <c>DataTable</c> row): pre-formatted cells + the badge tone.</summary>
public sealed record PeriodCompareTableRow(
    string Metric,
    string PeriodA,
    string PeriodB,
    string ChangeText,
    bool ChangePositive,
    string PctChange,
    StatusKind PctStatus);

/// <summary>One vehicle dropdown option (value = the vehicle id as a string, matching the web select).</summary>
public sealed record PeriodCompareVehicleOption(string Value, string Label);

/// <summary>One period preset (web select option → a trailing-day count; <c>0</c> = all time).</summary>
public sealed record PeriodCompareOption(int Days, string Label);

/// <summary>The raw inputs the <see cref="PeriodCompareProjection"/> renders (set by the view-model).</summary>
public sealed record PeriodCompareModel(
    IReadOnlyList<PeriodCompareVehicle> Vehicles,
    long? SelectedVehicleId,
    int PeriodADays,
    int PeriodBDays,
    PeriodStats? StatsA,
    PeriodStats? StatsB,
    bool IsLoading,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The pre-load model — both queries in flight, nothing resolved yet.</summary>
    public static PeriodCompareModel Initial { get; } = new(
        Vehicles: Array.Empty<PeriodCompareVehicle>(),
        SelectedVehicleId: null,
        PeriodADays: PeriodCompareRegistration.DefaultPeriodADays,
        PeriodBDays: PeriodCompareRegistration.DefaultPeriodBDays,
        StatsA: null,
        StatsB: null,
        IsLoading: true,
        HasError: false,
        ErrorDetail: null);

    /// <summary>True once both period envelopes have resolved (web <c>a &amp;&amp; b</c>).</summary>
    public bool HasBothPeriods => StatsA is not null && StatsB is not null;
}

/// <summary>
/// The render-ready projection the WinUI <c>PeriodComparePage</c> binds to. Every visible string is resolved through
/// the localizer and every numeric value is pre-formatted, so the view is a thin renderer. Mirrors the web page's
/// regions one-for-one: the disambiguation banner, the three selectors, the six metric cards, the side-by-side bar
/// chart, the comparison table and the insights — each carrying its own visibility flag so a region never collapses
/// silently.
/// </summary>
public sealed record PeriodCompareDisplay(
    string Title,
    string Subtitle,
    string AutomationName,
    PeriodCompareState State,
    bool ShowBanner,
    string BannerPrefix,
    string BannerCta,
    string VehicleLabel,
    string PeriodALabel,
    string PeriodBLabel,
    IReadOnlyList<PeriodCompareOption> PeriodOptions,
    IReadOnlyList<PeriodCompareVehicleOption> VehicleOptions,
    string? SelectedVehicleValue,
    int SelectedPeriodADays,
    int SelectedPeriodBDays,
    bool ShowError,
    string ErrorBannerText,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowContent,
    string EmptyMessage,
    IReadOnlyList<PeriodCompareMetric> Metrics,
    string ChartTitle,
    string ChartSeriesAName,
    string ChartSeriesBName,
    IReadOnlyList<string> ChartCategories,
    string TableTitle,
    string MetricHeader,
    string PeriodAHeader,
    string PeriodBHeader,
    string ChangeHeader,
    string PctChangeHeader,
    IReadOnlyList<PeriodCompareTableRow> Rows,
    string InsightsTitle,
    IReadOnlyList<string> Insights);

/// <summary>
/// Pure, UI-free projection of the <c>PeriodComparePage</c>. A 1:1 port of the web page's derived state
/// (web/src/features/analytics/pages/PeriodComparePage.tsx): the SI→display unit conversion of distance / efficiency,
/// the six comparison metrics, the percentage-change math, the side-by-side chart data, the comparison table and the
/// three insight lines. Unit-tested without a XAML host.
/// </summary>
public static class PeriodCompareProjection
{
    /// <summary>Em-dash fallback for an undefined percentage (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const double KmPerMile = 1.609344;
    private const double MetersPerKm = 1000.0;
    private const int ValuePrecision = 2;
    private const int PercentPrecision = 1;

    /// <summary>Project <paramref name="model"/> into the render-ready <see cref="PeriodCompareDisplay"/>.</summary>
    public static PeriodCompareDisplay Project(PeriodCompareModel model, ILocalizer localizer, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        // Chrome strings — resolved on every projection (regardless of data state) so the catalog keys are exercised
        // in every state and visibility is gated separately.
        var title = localizer.GetString("compare.title", "Period Comparison");
        var subtitle = localizer.GetString("compare.subtitle", "Compare key metrics across two time periods");
        var periodALabel = localizer.GetString("compare.periodA", "Period A");
        var periodBLabel = localizer.GetString("compare.periodB", "Period B");

        // Metric labels — resolved on every projection (regardless of data state) so the catalog keys are exercised
        // in the loading / empty states too; the tiles themselves only render when both periods resolve.
        var metricLabels = new MetricLabelSet(
            Distance: localizer.GetString("compare.totalDistance", "Total Distance"),
            Drives: localizer.GetString("compare.totalDrives", "Total Drives"),
            Energy: localizer.GetString("compare.energyUsed", "Energy Used"),
            Efficiency: localizer.GetString("compare.avgEfficiency", "Avg Efficiency"),
            Cost: localizer.GetString("compare.totalCost", "Total Cost"),
            Co2: localizer.GetString("compare.co2Saved", "CO\u2082 Saved"));

        // web error precedence — the failure banner shown above the panels.
        var hasError = model.HasError;
        var errorPrefix = localizer.GetString("error.loadFailed", "Failed to load data");
        var errorText = hasError
            ? $"{errorPrefix}: {model.ErrorDetail ?? string.Empty}".TrimEnd(' ', ':')
            : string.Empty;

        // web: `!a || !b ? (isLoading ? <Skeleton/> : <EmptyState/>) : <content/>`.
        var hasBoth = model.HasBothPeriods;
        var showLoading = !hasError && !hasBoth && model.IsLoading;
        var showEmpty = !hasError && !hasBoth && !model.IsLoading;
        var showContent = !hasError && hasBoth;

        var metrics = hasBoth
            ? BuildMetrics(model.StatsA!, model.StatsB!, units, periodBLabel, metricLabels)
            : Array.Empty<PeriodCompareMetric>();

        var rows = hasBoth ? BuildRows(metrics) : new List<PeriodCompareTableRow>();
        var categories = BuildCategories(metrics);
        var insights = BuildInsights(model, localizer, hasBoth);

        var state = hasError ? PeriodCompareState.Error
            : showLoading ? PeriodCompareState.Loading
            : !hasBoth ? PeriodCompareState.Empty
            : PeriodCompareState.Success;

        // The disambiguation banner mirrors the web: shown for multi-vehicle accounts (single-vehicle accounts
        // cannot usefully cross-navigate to fleet comparison).
        var showBanner = model.Vehicles.Count >= 2;

        return new PeriodCompareDisplay(
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            State: state,
            ShowBanner: showBanner,
            BannerPrefix: localizer.GetString("compare.banner.toFleetPrefix", "Looking to compare two vehicles instead?"),
            BannerCta: localizer.GetString("compare.banner.toFleetCta", "Open Fleet comparison \u2192"),
            VehicleLabel: localizer.GetString("compare.vehicle", "Vehicle"),
            PeriodALabel: periodALabel,
            PeriodBLabel: periodBLabel,
            PeriodOptions: BuildPeriodOptions(localizer),
            VehicleOptions: BuildVehicleOptions(model.Vehicles),
            SelectedVehicleValue: model.SelectedVehicleId?.ToString(CultureInfo.InvariantCulture),
            SelectedPeriodADays: model.PeriodADays,
            SelectedPeriodBDays: model.PeriodBDays,
            ShowError: hasError,
            ErrorBannerText: errorText,
            ShowLoading: showLoading,
            ShowEmpty: showEmpty,
            ShowContent: showContent,
            EmptyMessage: localizer.GetString("compare.empty", "Select a vehicle and two periods to compare."),
            Metrics: metrics,
            ChartTitle: localizer.GetString("compare.chartTitle", "Side-by-Side Comparison"),
            ChartSeriesAName: periodALabel,
            ChartSeriesBName: periodBLabel,
            ChartCategories: categories,
            TableTitle: localizer.GetString("compare.tableTitle", "Comparison Details"),
            MetricHeader: localizer.GetString("compare.metric", "Metric"),
            PeriodAHeader: periodALabel,
            PeriodBHeader: periodBLabel,
            ChangeHeader: localizer.GetString("compare.change", "Change"),
            PctChangeHeader: localizer.GetString("compare.pctChange", "% Change"),
            Rows: rows,
            InsightsTitle: localizer.GetString("compare.insights", "Insights"),
            Insights: insights);
    }

    /// <summary>web <c>pctChange</c> — the signed one-decimal percentage delta and its positivity.</summary>
    public static (string Value, bool Positive) PctChange(double a, double b)
    {
        if (b == 0)
        {
            return (EmDash, true);
        }

        var pct = ((a - b) / b) * 100.0;
        var sign = pct > 0 ? "+" : string.Empty;
        return ($"{sign}{NumberFormatting.Format(pct, null, PercentPrecision)}%", pct >= 0);
    }

    private static PeriodCompareMetric[] BuildMetrics(
        PeriodStats a, PeriodStats b, UnitPref units, string periodBLabel, MetricLabelSet labels)
    {
        // web: backend total_distance is km and avg_efficiency is Wh/km; both are restated to the user's preferred
        // display unit so the chart / table values match the unit label.
        var distA = UnitConverters.DistanceFromSi(a.TotalDistanceKm * MetersPerKm, units.Distance);
        var distB = UnitConverters.DistanceFromSi(b.TotalDistanceKm * MetersPerKm, units.Distance);
        var imperial = units.Distance == DistanceUnit.Mi;
        var effA = imperial ? a.AvgEfficiencyWhPerKm * KmPerMile : a.AvgEfficiencyWhPerKm;
        var effB = imperial ? b.AvgEfficiencyWhPerKm * KmPerMile : b.AvgEfficiencyWhPerKm;
        var distanceUnit = UnitLabels.Label(units.Distance);
        var efficiencyUnit = imperial ? "Wh/mi" : "Wh/km";

        return new[]
        {
            BuildMetric("distance", labels.Distance, "\uE804", distA, distB, distanceUnit, "TsColorInfoBrush", periodBLabel),
            BuildMetric("drives", labels.Drives, "\uE9D9", a.TotalDrives, b.TotalDrives, string.Empty, "TsColorSuccessBrush", periodBLabel),
            BuildMetric("energy", labels.Energy, "\uE945", a.EnergyUsedKwh, b.EnergyUsedKwh, "kWh", "TsColorAccentBrush", periodBLabel),
            BuildMetric("efficiency", labels.Efficiency, "\uE9D2", effA, effB, efficiencyUnit, "TsColorInfoBrush", periodBLabel),
            BuildMetric("cost", labels.Cost, "\uE825", a.TotalCost, b.TotalCost, "$", "TsColorSuccessBrush", periodBLabel),
            BuildMetric("co2", labels.Co2, "\uEC0A", a.Co2SavedKg, b.Co2SavedKg, "kg", "TsColorAccentBrush", periodBLabel),
        };
    }

    private readonly record struct MetricLabelSet(
        string Distance, string Drives, string Energy, string Efficiency, string Cost, string Co2);

    private static PeriodCompareMetric BuildMetric(
        string key, string label, string glyph, double a, double b, string unit, string accentBrushKey, string periodBLabel)
    {
        var pct = PctChange(a, b);
        return new PeriodCompareMetric(
            Key: key,
            Label: label,
            Glyph: glyph,
            ValueText: FormatWithUnit(a, unit),
            SubtitleText: $"{periodBLabel}: {FormatWithUnit(b, unit)}",
            DeltaText: pct.Value,
            DeltaPositive: pct.Positive,
            AccentBrushKey: accentBrushKey,
            ChartA: a,
            ChartB: b);
    }

    private static List<PeriodCompareTableRow> BuildRows(PeriodCompareMetric[] metrics)
    {
        var rows = new List<PeriodCompareTableRow>(metrics.Length);
        foreach (var metric in metrics)
        {
            var delta = metric.ChartA - metric.ChartB;
            var pct = PctChange(metric.ChartA, metric.ChartB);
            var arrow = pct.Positive ? "\u2191" : "\u2193";
            rows.Add(new PeriodCompareTableRow(
                Metric: metric.Label,
                PeriodA: FormatValue(metric.ChartA),
                PeriodB: FormatValue(metric.ChartB),
                ChangeText: $"{arrow} {FormatValue(Math.Abs(delta))}",
                ChangePositive: pct.Positive,
                PctChange: pct.Value,
                PctStatus: pct.Positive ? StatusKind.Success : StatusKind.Danger));
        }

        return rows;
    }

    private static string[] BuildCategories(PeriodCompareMetric[] metrics)
    {
        if (metrics.Length == 0)
        {
            return Array.Empty<string>();
        }

        var categories = new string[metrics.Length];
        for (var i = 0; i < metrics.Length; i++)
        {
            categories[i] = metrics[i].Label;
        }

        return categories;
    }

    private static string[] BuildInsights(PeriodCompareModel model, ILocalizer localizer, bool hasBoth)
    {
        // The direction words and templates are resolved on every projection (part of the page's string contract)
        // so the catalog keys are exercised regardless of data state; the lines are only shown in the success state.
        var more = localizer.GetString("compare.more", "more");
        var less = localizer.GetString("compare.less", "less");
        var improved = localizer.GetString("compare.improved", "improved");
        var declined = localizer.GetString("compare.declined", "declined");
        var higher = localizer.GetString("compare.higher", "higher");
        var lower = localizer.GetString("compare.lower", "lower");
        var distanceTemplate = localizer.GetString(
            "compare.insightDistance", "Distance traveled was {0} {1} in Period A vs Period B.");
        var efficiencyTemplate = localizer.GetString(
            "compare.insightEfficiency", "Efficiency {0} by {1} compared to Period B.");
        var costTemplate = localizer.GetString("compare.insightCost", "Costs were {0} {1} in Period A.");

        if (!hasBoth)
        {
            return Array.Empty<string>();
        }

        var a = model.StatsA!;
        var b = model.StatsB!;
        var distPct = PctChange(a.TotalDistanceKm, b.TotalDistanceKm);
        var effPct = PctChange(a.AvgEfficiencyWhPerKm, b.AvgEfficiencyWhPerKm);
        var costPct = PctChange(a.TotalCost, b.TotalCost);

        return new[]
        {
            string.Format(CultureInfo.CurrentCulture, distanceTemplate, distPct.Value, distPct.Positive ? more : less),
            string.Format(CultureInfo.CurrentCulture, efficiencyTemplate, effPct.Positive ? improved : declined, effPct.Value),
            string.Format(CultureInfo.CurrentCulture, costTemplate, costPct.Value, costPct.Positive ? higher : lower),
        };
    }

    private static List<PeriodCompareVehicleOption> BuildVehicleOptions(IReadOnlyList<PeriodCompareVehicle> vehicles)
    {
        var options = new List<PeriodCompareVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new PeriodCompareVehicleOption(vehicle.Id.ToString(CultureInfo.InvariantCulture), vehicle.Label));
        }

        return options;
    }

    private static IReadOnlyList<PeriodCompareOption> BuildPeriodOptions(ILocalizer localizer) =>
    [
        new PeriodCompareOption(7, localizer.GetString("compare.last7", "Last 7 days")),
        new PeriodCompareOption(30, localizer.GetString("compare.last30", "Last 30 days")),
        new PeriodCompareOption(90, localizer.GetString("compare.last90", "Last 90 days")),
        new PeriodCompareOption(365, localizer.GetString("compare.lastYear", "Last year")),
        new PeriodCompareOption(0, localizer.GetString("compare.allTime", "All time")),
    ];

    private static string FormatWithUnit(double value, string unit) =>
        string.IsNullOrEmpty(unit) ? FormatValue(value) : $"{FormatValue(value)} {unit}";

    private static string FormatValue(double value) => NumberFormatting.Format(value, null, ValuePrecision);
}

/// <summary>
/// Navigation / diagnostics constants for the <c>PeriodComparePage</c> surface — the native parity port of the web
/// page <c>web/src/features/analytics/pages/PeriodComparePage.tsx</c> (route <c>/period-compare</c>, nav name
/// <c>PeriodCompare</c>).
/// </summary>
public static class PeriodCompareRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "PeriodComparePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>PeriodCompare</c>).</summary>
    public const string RouteName = "PeriodCompare";

    /// <summary>The default Period A window in days (web <c>period_a</c> default <c>'30'</c>).</summary>
    public const int DefaultPeriodADays = 30;

    /// <summary>The default Period B window in days (web <c>period_b</c> default <c>'90'</c>).</summary>
    public const int DefaultPeriodBDays = 90;

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/analytics/period-stats</c>.</summary>
    public const string PeriodStatsOperation = "get_api_v1_analytics_period_stats";

    /// <summary>The localized page title (web <c>compare.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("compare.title", "Period Comparison");
    }

    /// <summary>The localized page subtitle (web <c>compare.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("compare.subtitle", "Compare key metrics across two time periods");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PeriodComparePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, VIN or location — so a diagnostics
/// line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class PeriodCompareDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PeriodCompareDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PeriodComparePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PeriodCompareRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant JSON readers for the period-stats / vehicles parsers (UI-free, unit-tested).</summary>
internal static class PeriodCompareJson
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
}
