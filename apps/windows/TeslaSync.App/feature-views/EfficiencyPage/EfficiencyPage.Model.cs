using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// One parsed drive row — the native mirror of a web <c>Drive</c> (web/src/types/driving.ts) reduced to the
/// fields the Efficiency page reads. SI on the wire: <see cref="DistanceM"/> meters, <see cref="AvgSpeedMps"/>
/// m/s, <see cref="OutsideTempAvgC"/> °C; battery percentages are 0..100. Pure data — no WinUI types.
/// </summary>
public sealed record EfficiencyDrive(
    string StartTs,
    double DistanceM,
    double? AvgSpeedMps,
    double? OutsideTempAvgC,
    double? StartBatteryPct,
    double? EndBatteryPct)
{
    /// <summary>
    /// Wh/km derived from the battery delta over the drive's distance (web <c>getEfficiency</c>): returns null
    /// when there is no forward distance or no net battery used so empty samples never enter the charts.
    /// </summary>
    public double? Efficiency()
    {
        double battUsed = (StartBatteryPct ?? 0) - (EndBatteryPct ?? 0);
        if (DistanceM > 0 && battUsed > 0)
        {
            return battUsed * 0.75 * 1000 / (DistanceM / 1000);
        }

        return null;
    }
}

/// <summary>
/// The aggregate driving statistics — the native mirror of the web <c>DrivingStats</c> read
/// (<c>GET /drives/stats</c>). Field names follow the snake_case wire shape (no camelCaseKeys on native): the
/// stats are stored as the backend reports them, and the page applies the same display conversions the web does
/// at the render boundary. Pure data.
/// </summary>
public sealed record EfficiencyStats(
    double TotalDrives,
    double TotalDistanceKm,
    double TotalDurationS,
    double AvgEfficiencyWhKm,
    double AvgSpeedKmh,
    double TopSpeedKmh,
    double RegenRatio,
    double RegenEnergyWh,
    double Co2SavedKg)
{
    /// <summary>The all-zero stats used when the read resolves with no object.</summary>
    public static EfficiencyStats Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>Project a <c>GET /drives/stats</c> JSON object into a tolerant stats snapshot, or null.</summary>
    public static EfficiencyStats? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new EfficiencyStats(
            TotalDrives: EfficiencyJson.Double(element, "total_drives") ?? 0,
            TotalDistanceKm: EfficiencyJson.Double(element, "total_distance_km") ?? 0,
            TotalDurationS: EfficiencyJson.Double(element, "total_duration_s") ?? 0,
            AvgEfficiencyWhKm: EfficiencyJson.Double(element, "avg_efficiency_wh_km") ?? 0,
            AvgSpeedKmh: EfficiencyJson.Double(element, "avg_speed_kmh") ?? 0,
            TopSpeedKmh: EfficiencyJson.Double(element, "top_speed_kmh") ?? 0,
            RegenRatio: EfficiencyJson.Double(element, "regen_ratio") ?? 0,
            RegenEnergyWh: EfficiencyJson.Double(element, "regen_energy_wh") ?? 0,
            Co2SavedKg: EfficiencyJson.Double(element, "co2_saved_kg") ?? 0);
    }
}

/// <summary>
/// The two-source snapshot the page binds to (web <c>useDrivingStats</c> + <c>useDrives</c>). The driving stats
/// drive the hero / cards / summary / insights; the drive list drives the trend / distribution / scatter
/// charts and the temperature table. Either source alone is enough to render content.
/// </summary>
public sealed record EfficiencySnapshot(EfficiencyStats? Stats, IReadOnlyList<EfficiencyDrive> Drives)
{
    /// <summary>The empty snapshot — no stats object and no drives.</summary>
    public static EfficiencySnapshot Empty { get; } = new(null, Array.Empty<EfficiencyDrive>());

    /// <summary>True when the stats object resolved.</summary>
    public bool HasStats => Stats is not null;

    /// <summary>True when there is anything to render (web shows the page whenever either query has data).</summary>
    public bool HasData => Stats is not null || Drives.Count > 0;

    /// <summary>Parse a <c>GET /drives</c> JSON array into the reduced drive rows (tolerant of partial bodies).</summary>
    public static IReadOnlyList<EfficiencyDrive> ParseDrives(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EfficiencyDrive>();
        }

        var drives = new List<EfficiencyDrive>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            drives.Add(new EfficiencyDrive(
                StartTs: EfficiencyJson.String(item, "start_ts") ?? string.Empty,
                DistanceM: EfficiencyJson.Double(item, "distance_m") ?? 0,
                AvgSpeedMps: EfficiencyJson.Double(item, "avg_speed_mps"),
                OutsideTempAvgC: EfficiencyJson.Double(item, "outside_temp_avg_c"),
                StartBatteryPct: EfficiencyJson.Double(item, "start_battery_pct"),
                EndBatteryPct: EfficiencyJson.Double(item, "end_battery_pct")));
        }

        return drives;
    }
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IEfficiencyFeed
{
    /// <summary>Fetch the driving stats + drive list for the active vehicle.</summary>
    Task<EfficiencySnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyEfficiencyFeed : IEfficiencyFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyEfficiencyFeed Instance { get; } = new();

    private EmptyEfficiencyFeed()
    {
    }

    /// <inheritdoc />
    public Task<EfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(EfficiencySnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum EfficiencyState
{
    /// <summary>The stats query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no stats and no drives — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The stats query failed — the retriable error surface.</summary>
    Error,

    /// <summary>Stats and/or drives resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One projected stat / hero readout tile: a label, a pre-formatted value and an optional glyph.</summary>
public sealed record EfficiencyMetricDisplay(string Label, string Value, string Glyph);

/// <summary>One projected hero gauge readout (web <c>AnimatedNumber</c>): the target value, decimals and label.</summary>
public sealed record EfficiencyReadoutDisplay(string Label, double Value, int Decimals, string Suffix, string ColorKey);

/// <summary>One projected chart (web <c>ChartContainer</c> + inner recharts surface): title, a11y, data + empty.</summary>
public sealed record EfficiencyChartDisplay(
    string Title,
    string AriaLabel,
    string SeriesName,
    bool HasData,
    IReadOnlyList<ChartPoint> Points,
    ChartRole Role,
    string EmptyMessage);

/// <summary>One projected metric bar (web <c>MetricBar</c>): label, fraction, accent brush key and value text.</summary>
public sealed record EfficiencyBarDisplay(string Label, double Value, double Max, string AccentBrushKey, string ValueText);

/// <summary>One projected energy-insight readout: a label, a pre-formatted value and its token colour key.</summary>
public sealed record EfficiencyInsightDisplay(string Label, string Value, string ColorKey);

/// <summary>One column definition for the temperature-bucketed efficiency table.</summary>
public sealed record EfficiencyColumnDisplay(string Key, string Header, bool IsNumeric);

/// <summary>One projected temperature-bucket row — every cell pre-formatted at the display boundary.</summary>
public sealed record EfficiencyBucketRow(
    string Range,
    string Drives,
    string AvgEff,
    string AvgEffColorKey,
    string KmPerKwh,
    string TotalDistance,
    string AvgSpeed);

/// <summary>
/// The render-ready projection the view binds to — every web region of EfficiencyPage.tsx as pre-formatted,
/// WinUI-free data: the four data-state flags, the hero gauge + three readouts, the four stat cards, the four
/// charts (daily trend / speed-range distribution / speed-vs-efficiency / temperature-vs-efficiency), the
/// temperature-bucketed table, the four summary metric bars and the six energy-insight readouts. Each data
/// source carries its own empty message so no region ever renders blank.
/// </summary>
public sealed record EfficiencyDisplay(
    EfficiencyState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyTitle,
    string EmptyMessage,
    bool HasStats,
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    ChartRole GaugeRole,
    IReadOnlyList<EfficiencyReadoutDisplay> HeroReadouts,
    string HeroEmptyMessage,
    IReadOnlyList<EfficiencyMetricDisplay> StatCards,
    string StatCardsEmptyMessage,
    EfficiencyChartDisplay TrendChart,
    EfficiencyChartDisplay SpeedDistChart,
    EfficiencyChartDisplay SpeedVsEffChart,
    EfficiencyChartDisplay TempVsEffChart,
    string TableTitle,
    bool TableHasData,
    IReadOnlyList<EfficiencyColumnDisplay> TableColumns,
    IReadOnlyList<EfficiencyBucketRow> TableRows,
    string TableEmptyMessage,
    string SummaryTitle,
    IReadOnlyList<EfficiencyBarDisplay> SummaryBars,
    string SummaryEmptyMessage,
    string InsightsTitle,
    IReadOnlyList<EfficiencyInsightDisplay> Insights,
    string InsightsEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the page
/// lifecycle (the stats query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this
/// in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record EfficiencyModel(EfficiencySnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the stats query is in flight with no data yet.</summary>
    public static EfficiencyModel Initial { get; } = new(EfficiencySnapshot.Empty, true, null);
}

/// <summary>
/// Pure projection from <see cref="EfficiencyModel"/> to <see cref="EfficiencyDisplay"/> — the native port of
/// the web EfficiencyPage's <c>useMemo</c> aggregations and JSX. It mirrors the web's exact display conversions
/// at the boundary via the shared SI converters/formatters (so the native output equals the canonical web
/// truth), and resolves every visible string through the injected localizer. No WinUI / HTTP / IO.
/// </summary>
public static class EfficiencyProjection
{
    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent — Speed/Activity (web <c>TrendingUp</c>).</summary>
    public const string TrendingUpGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — currency (web <c>Fuel</c> — the cost readout).</summary>
    public const string FuelGlyph = "\uE1D6";

    /// <summary>Segoe Fluent — Trips/gauge (web <c>Gauge</c>).</summary>
    public const string GaugeGlyph = "\uE7C0";

    /// <summary>Segoe Fluent — Activity (web empty-state icon).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>The hero gauge maximum (web <c>max={300}</c>).</summary>
    public const double GaugeMaxValue = 300;

    private const string EmDash = "\u2014";
    private const string EnDash = "\u2013";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string PowerBrush = "TsChartPowerBrush";
    private const string TextPrimaryBrush = "TsColorTextPrimaryBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static EfficiencyDisplay Project(EfficiencyModel model, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        _ = now;

        var s = EfficiencyStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var stats = snapshot.Stats;
        var drives = snapshot.Drives;
        bool isMiles = units.Distance == DistanceUnit.Mi;
        bool isFahrenheit = units.Temperature == TemperatureUnit.Fahrenheit;

        string efficiencyUnit = isMiles ? "Wh/mi" : "Wh/km";
        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);

        EfficiencyState state =
            model.Loading && !snapshot.HasData ? EfficiencyState.Loading
            : model.ErrorDetail is not null ? EfficiencyState.Error
            : !snapshot.HasData ? EfficiencyState.Empty
            : EfficiencyState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.Title
            : $"{s.Title}: {model.ErrorDetail}";

        bool hasStats = snapshot.HasStats;
        var st = stats ?? EfficiencyStats.Empty;

        // ── Hero gauge + three readouts (web GlassPanel1) ──────────────────────────────────────────────────
        double gaugeValue = RoundHalf(Eff(st.AvgEfficiencyWhKm, isMiles));
        double kmPerKwh = st.AvgEfficiencyWhKm > 0 ? 1000.0 / st.AvgEfficiencyWhKm : 0;
        var heroReadouts = new[]
        {
            new EfficiencyReadoutDisplay(s.KmPerKwh, kmPerKwh, 1, string.Empty, TextPrimaryBrush),
            new EfficiencyReadoutDisplay(s.Co2Saved, RoundHalf(st.Co2SavedKg), 0, string.Empty, SuccessBrush),
            new EfficiencyReadoutDisplay(
                $"{s.TotalDistance} {distanceUnit}", RoundHalf(Dist(st.TotalDistanceKm, units)), 0, string.Empty, InfoBrush),
        };

        // ── Stat cards (web GlassPanel2..5) ────────────────────────────────────────────────────────────────
        string costPerKm = st.TotalDistanceKm > 0
            ? ScalarFormatters.FormatNumber(st.AvgEfficiencyWhKm / 1000 * 0.12, 3)
            : EmDash;
        var statCards = new[]
        {
            new EfficiencyMetricDisplay(
                $"{s.AvgConsumption} {efficiencyUnit}", ScalarFormatters.FormatNumber(Eff(st.AvgEfficiencyWhKm, isMiles), 2), ZapGlyph),
            new EfficiencyMetricDisplay(
                $"{s.AvgSpeed} {speedUnit}", ScalarFormatters.FormatNumber(Spd(st.AvgSpeedKmh, units), 2), TrendingUpGlyph),
            new EfficiencyMetricDisplay(s.CostPerKm, $"${costPerKm}", FuelGlyph),
            new EfficiencyMetricDisplay(s.DrivesAnalyzed, ScalarFormatters.FormatNumber(st.TotalDrives, 0), GaugeGlyph),
        };

        // ── Charts (web efficiency-dailyTrend / Efficiency-by-Speed-Range / two scatter clouds) ─────────────
        var trend = BuildTrend(drives, units, isMiles, s, efficiencyUnit);
        var speedDist = BuildSpeedDist(drives, units, isMiles, s, efficiencyUnit, speedUnit);
        var speedVsEff = BuildSpeedScatter(drives, units, isMiles, s, efficiencyUnit);
        var tempVsEff = BuildTempScatter(drives, units, isMiles, s, efficiencyUnit);

        // ── Temperature-bucketed table (web GlassPanel11) ──────────────────────────────────────────────────
        var (tableColumns, tableRows) = BuildTempTable(drives, units, isMiles, isFahrenheit, s, efficiencyUnit, distanceUnit, speedUnit);

        // ── Summary metric bars (web GlassPanel12) ─────────────────────────────────────────────────────────
        var summaryBars = new[]
        {
            new EfficiencyBarDisplay(
                s.AvgConsumption, Eff(st.AvgEfficiencyWhKm, isMiles), 300, InfoBrush,
                $"{ScalarFormatters.FormatNumber(Eff(st.AvgEfficiencyWhKm, isMiles), 2)} {efficiencyUnit}"),
            new EfficiencyBarDisplay(
                s.AvgSpeed, Spd(st.AvgSpeedKmh, units), 150, SuccessBrush,
                $"{ScalarFormatters.FormatNumber(Spd(st.AvgSpeedKmh, units), 0)} {speedUnit}"),
            new EfficiencyBarDisplay(
                s.RegenRatio, st.RegenRatio * 100, 100, PowerBrush,
                $"{ScalarFormatters.FormatNumber(st.RegenRatio * 100, 2)}%"),
            new EfficiencyBarDisplay(
                s.TotalDriveTime, st.TotalDurationS, Math.Max(st.TotalDurationS, 36000), WarningBrush,
                UnitFormatters.FormatDuration(st.TotalDurationS, units, 1)),
        };

        // ── Energy insights (web GlassPanel13) ─────────────────────────────────────────────────────────────
        var insights = new[]
        {
            new EfficiencyInsightDisplay(s.TotalRegen, UnitFormatters.FormatEnergy(st.RegenEnergyWh, units, 1), SuccessBrush),
            new EfficiencyInsightDisplay(s.RegenRatioLabel, $"{ScalarFormatters.FormatNumber(st.RegenRatio * 100, 2)}%", InfoBrush),
            new EfficiencyInsightDisplay(s.Co2Label, $"{ScalarFormatters.FormatNumber(st.Co2SavedKg, 0)} kg", SuccessBrush),
            new EfficiencyInsightDisplay(
                s.TotalDistLabel, $"{ScalarFormatters.FormatNumber(Dist(st.TotalDistanceKm, units), 0)} {distanceUnit}", InfoBrush),
            new EfficiencyInsightDisplay(
                s.TopSpeed, $"{ScalarFormatters.FormatNumber(Spd(st.TopSpeedKmh, units), 0)} {speedUnit}", PowerBrush),
            new EfficiencyInsightDisplay(s.CostPerKmLabel, $"${costPerKm}", WarningBrush),
        };

        return new EfficiencyDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == EfficiencyState.Loading,
            ShowError: state == EfficiencyState.Error,
            ShowEmpty: state == EfficiencyState.Empty,
            ShowContent: state == EfficiencyState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.NoStats,
            HasStats: hasStats,
            GaugeValue: Math.Clamp(gaugeValue, 0, GaugeMaxValue),
            GaugeMax: GaugeMaxValue,
            GaugeLabel: $"{s.Avg} {efficiencyUnit}",
            GaugeRole: GaugeRoleFor(st.AvgEfficiencyWhKm),
            HeroReadouts: heroReadouts,
            HeroEmptyMessage: s.NoStats,
            StatCards: statCards,
            StatCardsEmptyMessage: s.NoStatCards,
            TrendChart: trend,
            SpeedDistChart: speedDist,
            SpeedVsEffChart: speedVsEff,
            TempVsEffChart: tempVsEff,
            TableTitle: s.TempEfficiency,
            TableHasData: tableRows.Count > 0,
            TableColumns: tableColumns,
            TableRows: tableRows,
            TableEmptyMessage: s.NoTempData,
            SummaryTitle: s.Summary,
            SummaryBars: summaryBars,
            SummaryEmptyMessage: s.NoSummary,
            InsightsTitle: s.Insights,
            Insights: insights,
            InsightsEmptyMessage: s.NoInsights,
            AutomationName: s.Title);
    }

    // Web display conversions (verbatim): the page feeds the SI-from-meters / -mps converters the same inputs
    // the web does — real-SI drive fields (distance_m, avg_speed_mps, outside_temp_avg_c) and the km/kmh stats
    // fields alike — so the native render equals the canonical web output (web is the parity spec, ADR-006).
    private static double Dist(double meters, UnitPref units) => UnitConverters.DistanceFromSi(meters, units.Distance);

    private static double Spd(double mps, UnitPref units) => UnitConverters.SpeedFromSi(mps, units.Speed);

    private static double Temp(double celsius, UnitPref units) => UnitConverters.TemperatureFromSi(celsius, units.Temperature);

    private static double Eff(double whPerKm, bool isMiles) => isMiles ? whPerKm * 1.609344 : whPerKm;

    // JS Math.round semantics (round half toward +infinity) so chart/readout integers match the web exactly.
    private static double RoundHalf(double value) => Math.Floor(value + 0.5);

    private static ChartRole GaugeRoleFor(double whPerKm) =>
        whPerKm < 170 ? ChartRole.Battery
        : whPerKm < 200 ? ChartRole.Regen
        : whPerKm < 240 ? ChartRole.Energy
        : ChartRole.Temperature;

    private static string EffColorKey(double whPerKm) =>
        whPerKm < 170 ? SuccessBrush
        : whPerKm < 200 ? InfoBrush
        : whPerKm < 240 ? WarningBrush
        : DangerBrush;

    private static EfficiencyChartDisplay BuildTrend(
        IReadOnlyList<EfficiencyDrive> drives, UnitPref units, bool isMiles, EfficiencyStrings s, string efficiencyUnit)
    {
        var eligible = new List<EfficiencyDrive>();
        foreach (var d in drives)
        {
            if (d.Efficiency() is not null)
            {
                eligible.Add(d);
            }
        }

        // Web: filteredDrives.filter(eff).slice(0,30).reverse() — newest 30, oldest-first along X.
        int take = Math.Min(30, eligible.Count);
        var window = eligible.GetRange(0, take);
        window.Reverse();

        var points = new List<ChartPoint>(window.Count);
        for (int i = 0; i < window.Count; i++)
        {
            double eff = window[i].Efficiency() ?? 0;
            points.Add(new ChartPoint(i, RoundHalf(Eff(eff, isMiles)), ShortDate(window[i].StartTs)));
        }

        string title = string.Format(CultureInfo.InvariantCulture, s.DailyTrend, efficiencyUnit);
        return new EfficiencyChartDisplay(title, s.DailyTrendAria, efficiencyUnit, points.Count > 2, points, ChartRole.Regen, s.NoStats);
    }

    private static EfficiencyChartDisplay BuildSpeedDist(
        IReadOnlyList<EfficiencyDrive> drives, UnitPref units, bool isMiles, EfficiencyStrings s, string efficiencyUnit, string speedUnit)
    {
        var bounds = new[]
        {
            ($"0{EnDash}30", 0.0, 30.0),
            ($"30{EnDash}60", 30.0, 60.0),
            ($"60{EnDash}90", 60.0, 90.0),
            ($"90{EnDash}120", 90.0, 120.0),
            ("120+", 120.0, 999.0),
        };
        var counts = new int[bounds.Length];
        var totals = new double[bounds.Length];

        foreach (var d in drives)
        {
            if (d.AvgSpeedMps is not { } mps)
            {
                continue;
            }

            if (d.Efficiency() is not { } eff || eff == 0)
            {
                continue;
            }

            double display = Spd(mps, units);
            for (int b = 0; b < bounds.Length; b++)
            {
                if (display >= bounds[b].Item2 && display < bounds[b].Item3)
                {
                    counts[b]++;
                    totals[b] += eff;
                    break;
                }
            }
        }

        var points = new List<ChartPoint>();
        int index = 0;
        for (int b = 0; b < bounds.Length; b++)
        {
            if (counts[b] == 0)
            {
                continue;
            }

            double avgEff = RoundHalf(Eff(totals[b] / counts[b], isMiles));
            points.Add(new ChartPoint(index++, avgEff, $"{bounds[b].Item1} {speedUnit}"));
        }

        return new EfficiencyChartDisplay(s.SpeedDist, s.SpeedDistAria, efficiencyUnit, points.Count > 0, points, ChartRole.Regen, s.NoStats);
    }

    private static EfficiencyChartDisplay BuildSpeedScatter(
        IReadOnlyList<EfficiencyDrive> drives, UnitPref units, bool isMiles, EfficiencyStrings s, string efficiencyUnit)
    {
        var points = new List<ChartPoint>();
        foreach (var d in drives)
        {
            if (d.AvgSpeedMps is not { } mps || mps == 0)
            {
                continue;
            }

            if (d.Efficiency() is not { } eff || eff == 0)
            {
                continue;
            }

            points.Add(new ChartPoint(RoundHalf(Spd(mps, units)), RoundHalf(Eff(eff, isMiles))));
        }

        return new EfficiencyChartDisplay(
            s.SpeedVsEfficiency, s.SpeedVsEfficiencyAria, efficiencyUnit, points.Count > 3, points, ChartRole.Energy, s.NoStats);
    }

    private static EfficiencyChartDisplay BuildTempScatter(
        IReadOnlyList<EfficiencyDrive> drives, UnitPref units, bool isMiles, EfficiencyStrings s, string efficiencyUnit)
    {
        var points = new List<ChartPoint>();
        foreach (var d in drives)
        {
            if (d.OutsideTempAvgC is not { } tempC)
            {
                continue;
            }

            if (d.Efficiency() is not { } eff || eff == 0)
            {
                continue;
            }

            points.Add(new ChartPoint(RoundHalf(Temp(tempC, units)), RoundHalf(Eff(eff, isMiles))));
        }

        return new EfficiencyChartDisplay(
            s.TempVsEfficiency, s.TempVsEfficiencyAria, efficiencyUnit, points.Count > 3, points, ChartRole.Power, s.NoStats);
    }

    private static (IReadOnlyList<EfficiencyColumnDisplay> Columns, IReadOnlyList<EfficiencyBucketRow> Rows) BuildTempTable(
        IReadOnlyList<EfficiencyDrive> drives,
        UnitPref units,
        bool isMiles,
        bool isFahrenheit,
        EfficiencyStrings s,
        string efficiencyUnit,
        string distanceUnit,
        string speedUnit)
    {
        // Web compares raw outside_temp_avg_c against Celsius bounds (0/10/20/30); only the label localises.
        (string Label, double Min, double Max)[] ranges = isFahrenheit
            ? new[]
            {
                ($"< 32{Fahrenheit}", -999.0, 0.0),
                ($"32{EnDash}50{Fahrenheit}", 0.0, 10.0),
                ($"50{EnDash}68{Fahrenheit}", 10.0, 20.0),
                ($"68{EnDash}86{Fahrenheit}", 20.0, 30.0),
                ($"> 86{Fahrenheit}", 30.0, 999.0),
            }
            : new[]
            {
                ($"< 0{Celsius}", -999.0, 0.0),
                ($"0{EnDash}10{Celsius}", 0.0, 10.0),
                ($"10{EnDash}20{Celsius}", 10.0, 20.0),
                ($"20{EnDash}30{Celsius}", 20.0, 30.0),
                ($"> 30{Celsius}", 30.0, 999.0),
            };

        var counts = new int[ranges.Length];
        var totalEff = new double[ranges.Length];
        var totalDist = new double[ranges.Length];
        var totalSpeed = new double[ranges.Length];

        foreach (var d in drives)
        {
            if (d.OutsideTempAvgC is not { } tempC)
            {
                continue;
            }

            if (d.Efficiency() is not { } eff || eff == 0)
            {
                continue;
            }

            for (int r = 0; r < ranges.Length; r++)
            {
                if (tempC >= ranges[r].Min && tempC < ranges[r].Max)
                {
                    counts[r]++;
                    totalEff[r] += eff;
                    totalDist[r] += Dist(d.DistanceM, units);
                    totalSpeed[r] += Spd(d.AvgSpeedMps ?? 0, units);
                    break;
                }
            }
        }

        var columns = new[]
        {
            new EfficiencyColumnDisplay("range", s.TempRange, false),
            new EfficiencyColumnDisplay("drives", s.Drives, true),
            new EfficiencyColumnDisplay("avgEff", $"{s.Avg} {efficiencyUnit}", true),
            new EfficiencyColumnDisplay("kmPerKwh", $"{distanceUnit}/kWh", true),
            new EfficiencyColumnDisplay("totalDist", $"{s.Total} {distanceUnit}", true),
            new EfficiencyColumnDisplay("avgSpeed", s.AvgSpeedCol, true),
        };

        var rows = new List<EfficiencyBucketRow>();
        for (int r = 0; r < ranges.Length; r++)
        {
            if (counts[r] == 0)
            {
                continue;
            }

            double avgEff = totalEff[r] / counts[r];
            double avgSpeed = totalSpeed[r] / counts[r];
            // Web renders b.totalDist / b.avgSpeed (already display units) through the converter again (lines
            // 467, 473); replicated verbatim for output parity with the canonical page.
            rows.Add(new EfficiencyBucketRow(
                Range: ranges[r].Label,
                Drives: ScalarFormatters.FormatNumber(counts[r], 0),
                AvgEff: ScalarFormatters.FormatNumber(Eff(avgEff, isMiles), 0),
                AvgEffColorKey: EffColorKey(avgEff),
                KmPerKwh: avgEff > 0 ? ScalarFormatters.FormatNumber(1000.0 / Eff(avgEff, isMiles), 2) : EmDash,
                TotalDistance: ScalarFormatters.FormatNumber(Dist(totalDist[r], units), 0),
                AvgSpeed: $"{ScalarFormatters.FormatNumber(Spd(avgSpeed, units), 0)} {speedUnit}"));
        }

        return (columns, rows);
    }

    private const string Celsius = "\u00B0C";
    private const string Fahrenheit = "\u00B0F";

    private static string ShortDate(string isoTs)
    {
        if (DateTimeOffset.TryParse(isoTs, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto.ToString("MMM d", CultureInfo.InvariantCulture);
        }

        return isoTs;
    }
}

/// <summary>
/// Canonical metadata for the <c>EfficiencyPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/driving/pages/EfficiencyPage.tsx</c> (route <c>/efficiency</c>, nav name
/// <c>Efficiency</c>). Holds the route name, the two generated operation ids it binds to, the diagnostics slug,
/// the empty-surface glyph and the localized title.
/// </summary>
public static class EfficiencyRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EfficiencyPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "Efficiency";

    /// <summary>The generated operation id for the driving-stats read (web <c>useDrivingStats</c>).</summary>
    public const string StatsOperation = Operations.Drives.Stats;

    /// <summary>The generated operation id for the drive-list read (web <c>useDrives</c>).</summary>
    public const string DrivesOperation = Operations.Drives.List;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = EfficiencyProjection.ActivityGlyph;

    /// <summary>The localized page title (web <c>t('efficiency.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("efficiency.title", "Efficiency");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>EfficiencyPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an efficiency value, distance, speed or
/// drive count — so a diagnostics line can never leak a user's driving data. Thread-safe.
/// </summary>
public sealed class EfficiencyDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EfficiencyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EfficiencyPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EfficiencyRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case drives / stats JSON wire shape (no camelCaseKeys transform on
/// native): numbers (or numeric strings) and strings. Kept internal so the page's parsers stay self-contained
/// and never throw on a partial body.
/// </summary>
internal static class EfficiencyJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
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

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

/// <summary>
/// The resolved i18n strings for the Efficiency page — the 42 manifest keys (web key names verbatim) plus the
/// generic error/retry labels. Resolving every key eagerly in <see cref="Resolve"/> means the full key set is
/// exercised in every data state (loading included), matching the web which mounts all translated literals.
/// </summary>
public readonly record struct EfficiencyStrings(
    string Avg,
    string AvgConsumption,
    string AvgSpeed,
    string AvgSpeedCol,
    string Co2Label,
    string Co2Saved,
    string ColDate,
    string ColRange,
    string CostPerKm,
    string CostPerKmLabel,
    string DailyTrend,
    string DailyTrendAria,
    string Drives,
    string DrivesAnalyzed,
    string Insights,
    string KmPerKwh,
    string NoInsights,
    string NoStatCards,
    string NoStats,
    string NoSummary,
    string NoTempData,
    string RegenRatio,
    string RegenRatioLabel,
    string Speed,
    string SpeedDist,
    string SpeedDistAria,
    string SpeedVsEfficiency,
    string SpeedVsEfficiencyAria,
    string Subtitle,
    string Summary,
    string Temp,
    string TempEfficiency,
    string TempRange,
    string TempVsEfficiency,
    string TempVsEfficiencyAria,
    string Title,
    string TopSpeed,
    string Total,
    string TotalDistLabel,
    string TotalDistance,
    string TotalDriveTime,
    string TotalRegen,
    string Retry)
{
    /// <summary>Resolve every Efficiency label through the localizer (web key names + English defaults).</summary>
    public static EfficiencyStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new EfficiencyStrings(
            Avg: localizer.GetString("efficiency.avg", "Avg"),
            AvgConsumption: localizer.GetString("efficiency.avgConsumption", "Avg"),
            AvgSpeed: localizer.GetString("efficiency.avgSpeed", "Avg Speed"),
            AvgSpeedCol: localizer.GetString("efficiency.avgSpeedCol", "Avg Speed"),
            Co2Label: localizer.GetString("efficiency.co2Label", "CO\u2082 Saved"),
            Co2Saved: localizer.GetString("efficiency.co2Saved", "CO\u2082 Saved (kg)"),
            ColDate: localizer.GetString("efficiency.col.date", "Date"),
            ColRange: localizer.GetString("efficiency.col.range", "Speed range"),
            CostPerKm: localizer.GetString("efficiency.costPerKm", "Est. Cost/km"),
            CostPerKmLabel: localizer.GetString("efficiency.costPerKmLabel", "Est. Cost/km"),
            DailyTrend: localizer.GetString("efficiency.dailyTrend", "Daily Efficiency ({0})"),
            DailyTrendAria: localizer.GetString("efficiency.dailyTrend.aria", "Daily efficiency trend area chart"),
            Drives: localizer.GetString("efficiency.drives", "Drives"),
            DrivesAnalyzed: localizer.GetString("efficiency.drivesAnalyzed", "Drives Analyzed"),
            Insights: localizer.GetString("efficiency.insights", "Energy Insights"),
            KmPerKwh: localizer.GetString("efficiency.kmPerKwh", "km/kWh"),
            NoInsights: localizer.GetString("efficiency.noInsights", "No energy insights available yet"),
            NoStatCards: localizer.GetString("efficiency.noStatCards", "No driving statistics available yet"),
            NoStats: localizer.GetString("efficiency.noStats", "No efficiency data available yet"),
            NoSummary: localizer.GetString("efficiency.noSummary", "No efficiency summary available yet"),
            NoTempData: localizer.GetString("efficiency.noTempData", "Not enough data for temperature breakdown"),
            RegenRatio: localizer.GetString("efficiency.regenRatio", "Regen Ratio"),
            RegenRatioLabel: localizer.GetString("efficiency.regenRatioLabel", "Regen Ratio"),
            Speed: localizer.GetString("efficiency.speed", "Speed"),
            SpeedDist: localizer.GetString("efficiency.speedDist", "Efficiency by Speed Range"),
            SpeedDistAria: localizer.GetString("efficiency.speedDist.aria", "Efficiency by speed-range bar chart"),
            SpeedVsEfficiency: localizer.GetString("efficiency.speedVsEfficiency", "Speed vs Efficiency"),
            SpeedVsEfficiencyAria: localizer.GetString("efficiency.speedVsEfficiency.aria", "Speed versus efficiency scatter plot"),
            Subtitle: localizer.GetString("efficiency.subtitle", "Energy consumption and driving efficiency analysis"),
            Summary: localizer.GetString("efficiency.summary", "Efficiency Summary"),
            Temp: localizer.GetString("efficiency.temp", "Temp"),
            TempEfficiency: localizer.GetString("efficiency.tempEfficiency", "Efficiency by Temperature Range"),
            TempRange: localizer.GetString("efficiency.tempRange", "Temp Range"),
            TempVsEfficiency: localizer.GetString("efficiency.tempVsEfficiency", "Temperature vs Efficiency"),
            TempVsEfficiencyAria: localizer.GetString("efficiency.tempVsEfficiency.aria", "Temperature versus efficiency scatter plot"),
            Title: localizer.GetString("efficiency.title", "Efficiency"),
            TopSpeed: localizer.GetString("efficiency.topSpeed", "Top Speed"),
            Total: localizer.GetString("efficiency.total", "Total"),
            TotalDistLabel: localizer.GetString("efficiency.totalDistLabel", "Total Distance"),
            TotalDistance: localizer.GetString("efficiency.totalDistance", "Total"),
            TotalDriveTime: localizer.GetString("efficiency.totalDriveTime", "Total Drive Time"),
            TotalRegen: localizer.GetString("efficiency.totalRegen", "Total Regen"),
            Retry: localizer.GetString("efficiency.retry", "Retry"));
    }
}
