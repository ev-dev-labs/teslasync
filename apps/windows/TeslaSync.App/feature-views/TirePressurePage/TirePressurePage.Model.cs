using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// One tyre-pressure reading projected from the <c>/tire-pressure/latest</c> object or one <c>/tire-pressure</c>
/// history row (web <c>TirePressureReading</c> in web/src/features/vehicle-systems/pages/TirePressurePage.tsx).
/// The four corner pressures are SI Pascals (<c>front_left</c> / <c>front_right</c> / <c>rear_left</c> /
/// <c>rear_right</c>); <see cref="CreatedAt"/> is the emission timestamp (history only) and the two TPMS warning
/// blobs carry the raw <c>tpms_hard_warnings</c> / <c>tpms_soft_warnings</c> JSON strings the page inspects for
/// any-true. Parsing is null-tolerant so a partial row never throws and a missing corner stays null (the page
/// coerces it to zero exactly as the web <c>normaliseTpmsToPa(null)</c> does). Pressures stay SI — divided to
/// kilopascals and converted to the user's display unit only at projection time.
/// </summary>
/// <param name="Id">Stable row id (web <c>id</c>); 0 for the latest snapshot.</param>
/// <param name="CreatedAt">Emission timestamp (web <c>created_at</c>), or null for the latest snapshot.</param>
/// <param name="FrontLeftPa">Front-left tyre pressure in SI Pascals, or null (web <c>front_left</c>).</param>
/// <param name="FrontRightPa">Front-right tyre pressure in SI Pascals, or null (web <c>front_right</c>).</param>
/// <param name="RearLeftPa">Rear-left tyre pressure in SI Pascals, or null (web <c>rear_left</c>).</param>
/// <param name="RearRightPa">Rear-right tyre pressure in SI Pascals, or null (web <c>rear_right</c>).</param>
/// <param name="HardWarnings">Raw TPMS hard-warning JSON blob, or null (web <c>tpms_hard_warnings</c>).</param>
/// <param name="SoftWarnings">Raw TPMS soft-warning JSON blob, or null (web <c>tpms_soft_warnings</c>).</param>
public sealed record TirePressureRow(
    long Id,
    DateTimeOffset? CreatedAt,
    double? FrontLeftPa,
    double? FrontRightPa,
    double? RearLeftPa,
    double? RearRightPa,
    string? HardWarnings,
    string? SoftWarnings)
{
    /// <summary>The empty reading (no corners, no warnings) used as the no-snapshot fallback.</summary>
    public static TirePressureRow Empty { get; } = new(0, null, null, null, null, null, null, null);

    /// <summary>Project one <c>/tire-pressure</c>(/latest) JSON object into a tolerant reading.</summary>
    /// <param name="element">The raw row JSON (a non-object yields the empty reading).</param>
    /// <returns>The parsed reading (every field null-tolerant).</returns>
    public static TirePressureRow FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TirePressureRow(
            Id: TirePressureJson.Long(element, "id") ?? 0,
            CreatedAt: TirePressureJson.Instant(element, "created_at") ?? TirePressureJson.Instant(element, "ts"),
            FrontLeftPa: TirePressureJson.Double(element, "front_left"),
            FrontRightPa: TirePressureJson.Double(element, "front_right"),
            RearLeftPa: TirePressureJson.Double(element, "rear_left"),
            RearRightPa: TirePressureJson.Double(element, "rear_right"),
            HardWarnings: TirePressureJson.String(element, "tpms_hard_warnings"),
            SoftWarnings: TirePressureJson.String(element, "tpms_soft_warnings"));
    }

    /// <summary>True when any field carries a value (the latest object exists / a history row is non-empty).</summary>
    public bool HasAnyValue =>
        FrontLeftPa is not null || FrontRightPa is not null || RearLeftPa is not null || RearRightPa is not null
        || CreatedAt is not null || HardWarnings is not null || SoftWarnings is not null;
}

/// <summary>The semantic pressure band of a corner reading (web <c>pressureStatus</c>).</summary>
public enum TirePressureBand
{
    /// <summary>Inside the safe band (web "Normal").</summary>
    Normal,

    /// <summary>Below the normal floor but inside the soft band (web "Low").</summary>
    Low,

    /// <summary>Above the normal ceiling but inside the soft band (web "High").</summary>
    High,

    /// <summary>Outside the soft band (web "Critical").</summary>
    Critical,
}

/// <summary>
/// The SI-Pascal tyre-pressure bands the Tire-Pressure page renders against — the native port of the web page's
/// <c>NORMAL_MIN_PA</c> / <c>NORMAL_MAX_PA</c> / <c>SOFT_LOW_PA</c> / <c>SOFT_HIGH_PA</c> / <c>GAUGE_MAX_PA</c>
/// constants plus its <c>pressureStatus</c> / <c>pressureColor</c> / <c>statusVariant</c> helpers
/// (web/src/features/vehicle-systems/pages/TirePressurePage.tsx). All comparisons stay in Pascals so there is a
/// single source of truth; conversion to kilopascals and then to the user's display unit happens only at the
/// renderer. WinUI-free so the mapping is unit-tested without a UI host.
/// </summary>
public static class TirePressurePageThresholds
{
    /// <summary>The safe-band floor in SI Pascals (web <c>NORMAL_MIN_PA</c>, 2.5 bar).</summary>
    public const double NormalMinPa = 250_000;

    /// <summary>The safe-band ceiling in SI Pascals (web <c>NORMAL_MAX_PA</c>, 3.5 bar).</summary>
    public const double NormalMaxPa = 350_000;

    /// <summary>The soft-band floor in SI Pascals (web <c>SOFT_LOW_PA</c>, 2.0 bar).</summary>
    public const double SoftLowPa = 200_000;

    /// <summary>The soft-band ceiling in SI Pascals (web <c>SOFT_HIGH_PA</c>, 4.0 bar).</summary>
    public const double SoftHighPa = 400_000;

    /// <summary>The gauge full-sweep maximum in SI Pascals (web <c>GAUGE_MAX_PA</c>, 5.0 bar).</summary>
    public const double GaugeMaxPa = 500_000;

    /// <summary>Map an SI-Pascal corner pressure to its semantic band (web <c>pressureStatus</c>).</summary>
    /// <param name="pa">The corner pressure in SI Pascals.</param>
    /// <returns>The corner's semantic band.</returns>
    public static TirePressureBand Band(double pa)
    {
        if (pa < SoftLowPa)
        {
            return TirePressureBand.Critical;
        }

        if (pa < NormalMinPa)
        {
            return TirePressureBand.Low;
        }

        if (pa > SoftHighPa)
        {
            return TirePressureBand.Critical;
        }

        if (pa > NormalMaxPa)
        {
            return TirePressureBand.High;
        }

        return TirePressureBand.Normal;
    }

    /// <summary>Map a band to its badge variant (web <c>statusVariant</c>): normal → success, critical → danger, else warning.</summary>
    /// <param name="band">The corner band.</param>
    /// <returns>The semantic status driving the badge / gauge colour.</returns>
    public static StatusKind Variant(TirePressureBand band) => band switch
    {
        TirePressureBand.Normal => StatusKind.Success,
        TirePressureBand.Critical => StatusKind.Danger,
        _ => StatusKind.Warning,
    };

    /// <summary>
    /// Map a band to the categorical gauge-arc colour index (web <c>pressureColor</c> green / amber / red): the
    /// safe band reads green, the soft band amber and the critical band red, mirroring the sibling page gauges.
    /// </summary>
    /// <param name="band">The corner band.</param>
    /// <returns>The categorical palette index for the gauge arc.</returns>
    public static int GaugeColorIndex(TirePressureBand band) => band switch
    {
        TirePressureBand.Normal => 1,
        TirePressureBand.Critical => 5,
        _ => 3,
    };

    /// <summary>
    /// True when a raw TPMS warning blob contains any truthy value (web <c>hasTpmsWarning</c>): a JSON object of
    /// booleans is any-true; a non-JSON non-empty string that is not <c>"false"</c> is treated as truthy.
    /// </summary>
    /// <param name="raw">The raw <c>tpms_hard_warnings</c> / <c>tpms_soft_warnings</c> blob, or null.</param>
    /// <returns>True when the blob signals an active warning.</returns>
    public static bool HasTpmsWarning(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in doc.RootElement.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.True)
                    {
                        return true;
                    }
                }

                return false;
            }
        }
        catch (JsonException)
        {
            // Fall through to the non-JSON heuristic below.
        }

        return raw is not "false" and not "";
    }
}

/// <summary>One projected, render-ready corner gauge — the native analogue of a single web per-corner card.</summary>
/// <param name="Key">Stable corner key (<c>fl</c> / <c>fr</c> / <c>rl</c> / <c>rr</c>).</param>
/// <param name="Label">Localized full corner label (Front Left / Front Right / Rear Left / Rear Right).</param>
/// <param name="GaugeValue">Pressure in the user's display unit (gauge value).</param>
/// <param name="GaugeMax">Gauge full-sweep maximum in the user's display unit.</param>
/// <param name="GaugeUnit">The user's display-unit label.</param>
/// <param name="GaugeColorIndex">Categorical palette index for the gauge arc (web <c>pressureColor</c>).</param>
/// <param name="BadgeStatus">Semantic status driving the badge colour (web <c>statusVariant</c>).</param>
/// <param name="BadgeLabel">Localized band label (Normal / Low / High / Critical).</param>
/// <param name="AutomationName">Spoken summary (corner label + value + band).</param>
public sealed record TirePressureGaugeDisplay(
    string Key,
    string Label,
    double GaugeValue,
    double GaugeMax,
    string GaugeUnit,
    int GaugeColorIndex,
    StatusKind BadgeStatus,
    string BadgeLabel,
    string AutomationName);

/// <summary>A summary metric tile (web <c>MetricCard</c>): a glyph, a pre-formatted value and a localized label.</summary>
public sealed record TirePressureMetricDisplay(string Glyph, string Value, string Label, string AutomationName);

/// <summary>A typed chart series projected for the pressure-history line chart (WinUI-free).</summary>
public sealed record TirePressureSeriesDisplay(string Name, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>The pressure-history chart projection (web <c>ChartContainer</c> + recharts <c>LineChart</c>).</summary>
public sealed record TirePressureChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<TirePressureSeriesDisplay> Series,
    string EmptyMessage);

/// <summary>A single pressure-history table row (web per-row <c>DataTable</c> item, newest first).</summary>
public sealed record TirePressureTableRowDisplay(
    string Id,
    string Time,
    string FrontLeft,
    string FrontRight,
    string RearLeft,
    string RearRight,
    string Warnings,
    string AutomationName);

/// <summary>The two-source snapshot the page binds to: the latest reading (primary) and the history rows (secondary).</summary>
/// <param name="HasLatest">True when the <c>/tire-pressure/latest</c> object resolved (web truthy <c>latest</c>).</param>
/// <param name="Latest">The latest reading (web <c>latest</c>); <see cref="TirePressureRow.Empty"/> when absent.</param>
/// <param name="History">The history rows for the selected range (web <c>history</c>), in arbitrary order.</param>
public sealed record TirePressureSnapshot(
    bool HasLatest,
    TirePressureRow Latest,
    IReadOnlyList<TirePressureRow> History)
{
    /// <summary>The empty snapshot (no latest object, no history) — the page-level empty surface.</summary>
    public static TirePressureSnapshot Empty { get; } = new(false, TirePressureRow.Empty, Array.Empty<TirePressureRow>());

    /// <summary>True when there is anything to render (a latest object or at least one history row).</summary>
    public bool HasData => HasLatest || History.Count > 0;

    /// <summary>Compose a snapshot from the parsed latest reading (may be null) and the history rows.</summary>
    /// <param name="latest">The parsed latest reading, or null when the endpoint returned a non-object.</param>
    /// <param name="history">The parsed history rows.</param>
    /// <returns>The composed two-source snapshot.</returns>
    public static TirePressureSnapshot Compose(TirePressureRow? latest, IReadOnlyList<TirePressureRow> history) =>
        latest is { } row
            ? new TirePressureSnapshot(true, row, history)
            : new TirePressureSnapshot(false, TirePressureRow.Empty, history);
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ITirePressureFeed
{
    /// <summary>Fetch the latest reading + history rows for the active vehicle.</summary>
    Task<TirePressureSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyTirePressureFeed : ITirePressureFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTirePressureFeed Instance { get; } = new();

    private EmptyTirePressureFeed()
    {
    }

    /// <inheritdoc />
    public Task<TirePressureSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(TirePressureSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum TirePressurePageState
{
    /// <summary>The primary latest query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no latest object and no history — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary latest query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The latest reading resolved — the full page content.</summary>
    Success,
}

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>TirePressurePage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI types —
/// so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record TirePressureDisplay(
    TirePressurePageState State,
    string Title,
    string Subtitle,
    string SelectVehicleLabel,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    bool HasWarning,
    StatusKind WarningStatus,
    string WarningBannerText,
    string CurrentReadingsLabel,
    IReadOnlyList<TirePressureGaugeDisplay> Gauges,
    IReadOnlyList<TirePressureMetricDisplay> SummaryCards,
    string PressureHistoryTitle,
    TirePressureChartDisplay HistoryChart,
    string HistoryTableTitle,
    IReadOnlyList<string> TableColumns,
    IReadOnlyList<TirePressureTableRowDisplay> TableRows,
    string TableEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary latest query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model
/// fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record TirePressureModel(TirePressureSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary latest query is in flight with no data yet.</summary>
    public static TirePressureModel Initial { get; } = new(TirePressureSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>TirePressurePage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass. The keys are the web key names, verbatim.
/// </summary>
public sealed record TirePressureStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string SelectVehicle { get; init; }
    public required string LoadFailed { get; init; }
    public required string Retry { get; init; }
    public required string CurrentReadings { get; init; }
    public required string AvgPressure { get; init; }
    public required string MinPressure { get; init; }
    public required string WarningCount { get; init; }
    public required string LastUpdated { get; init; }
    public required string PressureHistory { get; init; }
    public required string NoHistoryData { get; init; }
    public required string HistoryTable { get; init; }
    public required string Time { get; init; }
    public required string Warnings { get; init; }
    public required string Ok { get; init; }
    public required string HardWarning { get; init; }
    public required string SoftWarning { get; init; }
    public required string HardWarningActive { get; init; }
    public required string SoftWarningActive { get; init; }
    public required string FrontLeft { get; init; }
    public required string FrontRight { get; init; }
    public required string RearLeft { get; init; }
    public required string RearRight { get; init; }
    public required string StatusNormal { get; init; }
    public required string StatusLow { get; init; }
    public required string StatusHigh { get; init; }
    public required string StatusCritical { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static TirePressureStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new TirePressureStrings
        {
            Title = localizer.GetString("tirePressure.title", "Tire Pressure"),
            Subtitle = localizer.GetString("tirePressure.subtitle", "Monitor tire pressure readings and history"),
            SelectVehicle = localizer.GetString("tirePressure.selectVehicle", "Select vehicle"),
            LoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
            CurrentReadings = localizer.GetString("Current Readings", "Current Readings"),
            AvgPressure = localizer.GetString("Avg Pressure", "Avg Pressure"),
            MinPressure = localizer.GetString("Min Pressure", "Min Pressure"),
            WarningCount = localizer.GetString("Warning Count", "Warning Count"),
            LastUpdated = localizer.GetString("Last Updated", "Last Updated"),
            PressureHistory = localizer.GetString("Pressure History", "Pressure History"),
            NoHistoryData = localizer.GetString("No History Data", "No History Data"),
            HistoryTable = localizer.GetString("History Table", "History Table"),
            Time = localizer.GetString("Time", "Time"),
            Warnings = localizer.GetString("Warnings", "Warnings"),
            Ok = localizer.GetString("Ok", "Ok"),
            HardWarning = localizer.GetString("Hard Warning", "Hard Warning"),
            SoftWarning = localizer.GetString("Soft Warning", "Soft Warning"),
            HardWarningActive = localizer.GetString("Hard Warning Active", "Hard Warning Active"),
            SoftWarningActive = localizer.GetString("Soft Warning Active", "Soft Warning Active"),
            FrontLeft = localizer.GetString("tirePressure.frontLeft", "Front Left"),
            FrontRight = localizer.GetString("tirePressure.frontRight", "Front Right"),
            RearLeft = localizer.GetString("tirePressure.rearLeft", "Rear Left"),
            RearRight = localizer.GetString("tirePressure.rearRight", "Rear Right"),
            StatusNormal = localizer.GetString("tirePressure.status.normal", "Normal"),
            StatusLow = localizer.GetString("tirePressure.status.low", "Low"),
            StatusHigh = localizer.GetString("tirePressure.status.high", "High"),
            StatusCritical = localizer.GetString("tirePressure.status.critical", "Critical"),
        };
    }

    /// <summary>The localized band label for a corner band (Normal / Low / High / Critical).</summary>
    public string BandLabel(TirePressureBand band) => band switch
    {
        TirePressureBand.Normal => StatusNormal,
        TirePressureBand.Low => StatusLow,
        TirePressureBand.High => StatusHigh,
        _ => StatusCritical,
    };
}

/// <summary>
/// Pure projection from a <see cref="TirePressureModel"/> to its <see cref="TirePressureDisplay"/> — the native
/// port of the render logic in web/src/features/vehicle-systems/pages/TirePressurePage.tsx and its
/// <c>pressureStatus</c> / <c>pressureColor</c> / <c>statusVariant</c> / <c>hasTpmsWarning</c> / summary-stat /
/// chart-data helpers. The branch precedence mirrors the web data lifecycle (loading → error → empty → success);
/// the latest reading feeds the warning banner, the four corner gauges and the four summary cards, while the
/// history rows feed the pressure-history line chart and the history table. Every label resolves through the
/// i18n facade using the keys the web page uses and every SI value is converted at this display boundary.
/// </summary>
public static class TirePressureProjection
{
    /// <summary>Segoe Fluent — Speed/gauge (web lucide <c>Gauge</c>).</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — Warning (web lucide <c>AlertTriangle</c> / <c>AlertCircle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — Activity (web lucide <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — TrendingDown (web lucide <c>TrendingDown</c>).</summary>
    public const string TrendingDownGlyph = "\uEB0F";

    /// <summary>Segoe Fluent — Recent/Clock (web lucide <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    // SI Pascals → kilopascals before the display-unit conversion (web `pressureDisplayValue(pa)` = `pa / 1000`).
    private const double PascalsPerKilopascal = 1000;
    private const int PressurePrecision = 1;
    private const string EmDash = "\u2014";

    // Per-corner categorical line colours (web LINE_COLORS = CHART_COLORS[0/2/1/3] for fl/fr/rl/rr).
    private static readonly CornerDefinition[] Corners =
    {
        new("fl", static s => s.FrontLeft, static r => r.FrontLeftPa, 0),
        new("fr", static s => s.FrontRight, static r => r.FrontRightPa, 2),
        new("rl", static s => s.RearLeft, static r => r.RearLeftPa, 1),
        new("rr", static s => s.RearRight, static r => r.RearRightPa, 3),
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static TirePressureDisplay Project(
        TirePressureModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = TirePressureStrings.Resolve(localizer);
        var snapshot = model.Snapshot;

        TirePressurePageState state =
            model.Loading && !snapshot.HasData ? TirePressurePageState.Loading
            : model.ErrorDetail is not null ? TirePressurePageState.Error
            : !snapshot.HasData ? TirePressurePageState.Empty
            : TirePressurePageState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.LoadFailed
            : $"{s.LoadFailed}: {model.ErrorDetail}";

        bool hardWarning = TirePressurePageThresholds.HasTpmsWarning(snapshot.Latest.HardWarnings);
        bool softWarning = TirePressurePageThresholds.HasTpmsWarning(snapshot.Latest.SoftWarnings);
        bool hasWarning = hardWarning || softWarning;

        var historyAsc = SortAscending(snapshot.History);
        var gauges = BuildGauges(snapshot, s, units);
        var summaryCards = BuildSummaryCards(snapshot, historyAsc, s, units, now);
        var chart = BuildChart(historyAsc, s, units);
        var (columns, rows) = BuildTable(historyAsc, s, units, now);

        return new TirePressureDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            SelectVehicleLabel: s.SelectVehicle,
            ShowLoading: state == TirePressurePageState.Loading,
            ShowError: state == TirePressurePageState.Error,
            ShowEmpty: state == TirePressurePageState.Empty,
            ShowContent: state == TirePressurePageState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoHistoryData,
            HasWarning: hasWarning,
            WarningStatus: hardWarning ? StatusKind.Danger : StatusKind.Warning,
            WarningBannerText: hardWarning ? s.HardWarningActive : s.SoftWarningActive,
            CurrentReadingsLabel: s.CurrentReadings,
            Gauges: gauges,
            SummaryCards: summaryCards,
            PressureHistoryTitle: s.PressureHistory,
            HistoryChart: chart,
            HistoryTableTitle: s.HistoryTable,
            TableColumns: columns,
            TableRows: rows,
            TableEmptyMessage: s.NoHistoryData,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>The SI-Pascal value of a corner (web <c>getTirePressureValue</c>): a null corner coerces to zero.</summary>
    /// <param name="pa">The raw corner pressure in SI Pascals, or null.</param>
    /// <returns>The corner pressure in SI Pascals, or zero when the corner reported nothing.</returns>
    public static double CornerValue(double? pa) =>
        pa is { } p && !double.IsNaN(p) && !double.IsInfinity(p) ? p : 0;

    private static List<TirePressureGaugeDisplay> BuildGauges(
        TirePressureSnapshot snapshot, TirePressureStrings s, UnitPref units)
    {
        double gaugeMax = ToDisplay(TirePressurePageThresholds.GaugeMaxPa, units);
        string unitLabel = UnitLabels.Label(units.Pressure);

        var gauges = new List<TirePressureGaugeDisplay>(Corners.Length);
        foreach (var corner in Corners)
        {
            double pa = snapshot.HasLatest ? CornerValue(corner.Selector(snapshot.Latest)) : 0;
            TirePressureBand band = TirePressurePageThresholds.Band(pa);
            double value = ToDisplay(pa, units);
            string label = corner.Label(s);
            string badgeLabel = s.BandLabel(band);
            string valueText = UnitFormatters.FormatPressure(pa / PascalsPerKilopascal, units, PressurePrecision);
            gauges.Add(new TirePressureGaugeDisplay(
                Key: corner.Key,
                Label: label,
                GaugeValue: value,
                GaugeMax: gaugeMax,
                GaugeUnit: unitLabel,
                GaugeColorIndex: TirePressurePageThresholds.GaugeColorIndex(band),
                BadgeStatus: TirePressurePageThresholds.Variant(band),
                BadgeLabel: badgeLabel,
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, valueText, badgeLabel)));
        }

        return gauges;
    }

    private static IReadOnlyList<TirePressureMetricDisplay> BuildSummaryCards(
        TirePressureSnapshot snapshot,
        IReadOnlyList<TirePressureRow> historyAsc,
        TirePressureStrings s,
        UnitPref units,
        DateTimeOffset now)
    {
        string avg = EmDash;
        string min = EmDash;
        int warningCount = 0;

        if (snapshot.HasLatest)
        {
            double[] values =
            [
                CornerValue(snapshot.Latest.FrontLeftPa),
                CornerValue(snapshot.Latest.FrontRightPa),
                CornerValue(snapshot.Latest.RearLeftPa),
                CornerValue(snapshot.Latest.RearRightPa),
            ];

            double sum = 0;
            double minimum = double.PositiveInfinity;
            foreach (double v in values)
            {
                sum += v;
                minimum = Math.Min(minimum, v);
                if (v < TirePressurePageThresholds.NormalMinPa || v > TirePressurePageThresholds.NormalMaxPa)
                {
                    warningCount++;
                }
            }

            avg = UnitFormatters.FormatPressure(sum / values.Length / PascalsPerKilopascal, units, PressurePrecision);
            min = UnitFormatters.FormatPressure(minimum / PascalsPerKilopascal, units, PressurePrecision);
        }

        // Web "Last Updated" is the newest row in the visible window (the /latest endpoint carries no timestamp).
        DateTimeOffset? lastUpdated = historyAsc.Count > 0 ? historyAsc[^1].CreatedAt : null;
        string lastUpdatedText = lastUpdated is { } ts
            ? DateTimeFormatting.Format(ts, DateTimeVariant.Full, now)
            : EmDash;

        string warningCountText = warningCount.ToString(CultureInfo.InvariantCulture);

        return
        [
            new TirePressureMetricDisplay(ActivityGlyph, avg, s.AvgPressure, $"{s.AvgPressure}: {avg}"),
            new TirePressureMetricDisplay(TrendingDownGlyph, min, s.MinPressure, $"{s.MinPressure}: {min}"),
            new TirePressureMetricDisplay(WarningGlyph, warningCountText, s.WarningCount, $"{s.WarningCount}: {warningCountText}"),
            new TirePressureMetricDisplay(ClockGlyph, lastUpdatedText, s.LastUpdated, $"{s.LastUpdated}: {lastUpdatedText}"),
        ];
    }

    private static TirePressureChartDisplay BuildChart(
        IReadOnlyList<TirePressureRow> historyAsc, TirePressureStrings s, UnitPref units)
    {
        var series = new List<TirePressureSeriesDisplay>(Corners.Length);
        foreach (var corner in Corners)
        {
            var points = new List<ChartPoint>(historyAsc.Count);
            for (int i = 0; i < historyAsc.Count; i++)
            {
                double pa = CornerValue(corner.Selector(historyAsc[i]));
                points.Add(new ChartPoint(i, Math.Round(ToDisplay(pa, units), PressurePrecision)));
            }

            series.Add(new TirePressureSeriesDisplay(corner.Label(s), corner.LineColorIndex, points));
        }

        return new TirePressureChartDisplay(
            HasData: historyAsc.Count > 0,
            Title: s.PressureHistory,
            AriaLabel: s.PressureHistory,
            Series: series,
            EmptyMessage: s.NoHistoryData);
    }

    private static (IReadOnlyList<string> Columns, IReadOnlyList<TirePressureTableRowDisplay> Rows) BuildTable(
        IReadOnlyList<TirePressureRow> historyAsc, TirePressureStrings s, UnitPref units, DateTimeOffset now)
    {
        string unitLabel = UnitLabels.Label(units.Pressure);
        var columns = new[]
        {
            s.Time,
            $"{s.FrontLeft} ({unitLabel})",
            $"{s.FrontRight} ({unitLabel})",
            $"{s.RearLeft} ({unitLabel})",
            $"{s.RearRight} ({unitLabel})",
            s.Warnings,
        };

        // Web default sort is newest-first by created_at.
        var ordered = new List<TirePressureRow>(historyAsc);
        ordered.Reverse();

        var rows = new List<TirePressureTableRowDisplay>(ordered.Count);
        foreach (var row in ordered)
        {
            string time = row.CreatedAt is { } ts ? DateTimeFormatting.Format(ts, DateTimeVariant.Full, now) : EmDash;
            string fl = Cell(row.FrontLeftPa, units);
            string fr = Cell(row.FrontRightPa, units);
            string rl = Cell(row.RearLeftPa, units);
            string rr = Cell(row.RearRightPa, units);
            string warnings = WarningLabel(row, s);
            rows.Add(new TirePressureTableRowDisplay(
                Id: row.Id.ToString(CultureInfo.InvariantCulture),
                Time: time,
                FrontLeft: fl,
                FrontRight: fr,
                RearLeft: rl,
                RearRight: rr,
                Warnings: warnings,
                AutomationName: $"{time}, {fl}, {fr}, {rl}, {rr}, {warnings}"));
        }

        return (columns, rows);
    }

    private static string WarningLabel(TirePressureRow row, TirePressureStrings s)
    {
        if (TirePressurePageThresholds.HasTpmsWarning(row.HardWarnings))
        {
            return s.HardWarning;
        }

        return TirePressurePageThresholds.HasTpmsWarning(row.SoftWarnings) ? s.SoftWarning : s.Ok;
    }

    private static string Cell(double? pa, UnitPref units) =>
        UnitFormatters.FormatPressure(CornerValue(pa) / PascalsPerKilopascal, units, PressurePrecision);

    private static double ToDisplay(double pa, UnitPref units) =>
        UnitConverters.PressureFromSi(pa / PascalsPerKilopascal, units.Pressure);

    private static IReadOnlyList<TirePressureRow> SortAscending(IReadOnlyList<TirePressureRow> history)
    {
        if (history.Count <= 1)
        {
            return history;
        }

        var sorted = new List<TirePressureRow>(history);
        sorted.Sort(static (a, b) => Nullable.Compare(a.CreatedAt, b.CreatedAt));
        return sorted;
    }

    private sealed record CornerDefinition(
        string Key,
        Func<TirePressureStrings, string> Label,
        Func<TirePressureRow, double?> Selector,
        int LineColorIndex);
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Tire-Pressure page — the native mirror of the web page at
/// web/src/features/vehicle-systems/pages/TirePressurePage.tsx (route <c>/tire-pressure</c>, nav name
/// <c>TirePressure</c>). The page reads the latest snapshot the web <c>/tire-pressure/latest</c> query reads
/// (generated operation <c>get_api_v1_tire_pressure_latest</c>) plus the history the web <c>/tire-pressure</c>
/// query reads (generated operation <c>get_api_v1_tire_pressure</c>).
/// </summary>
public static class TirePressureRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "TirePressure";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TirePressurePage";

    /// <summary>The generated operation id for the latest read (web <c>/tire-pressure/latest</c>).</summary>
    public const string LatestOperation = "get_api_v1_tire_pressure_latest";

    /// <summary>The generated operation id for the history read (web <c>/tire-pressure</c>).</summary>
    public const string HistoryOperation = "get_api_v1_tire_pressure";

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Gauge</c>).</summary>
    public const string EmptyGlyph = TirePressureProjection.GaugeGlyph;

    /// <summary>The localized page title (web <c>t('tirePressure.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("tirePressure.title", "Tire Pressure");
    }
}

/// <summary>
/// PII-safe diagnostics for the Tire-Pressure page — records only the operational <c>view.opened</c> event with
/// the surface slug, never a pressure value, VIN or vehicle id. Mirrors the sibling feature-view diagnostics.
/// Thread-safe.
/// </summary>
public sealed class TirePressureDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional PII-safe line writer.</summary>
    public TirePressureDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TirePressurePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TirePressureRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Tire-Pressure page — every getter returns a nullable
/// rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the page
/// tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the snake_case
/// wire shape (no camelCaseKeys transform on native).
/// </summary>
internal static class TirePressureJson
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

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind == JsonValueKind.String ? prop.GetString() : null;
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}
