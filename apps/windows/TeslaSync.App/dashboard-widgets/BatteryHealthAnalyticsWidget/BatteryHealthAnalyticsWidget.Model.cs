using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryHealthAnalyticsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BatteryHealthAnalyticsWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{hasData ? … : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle / no analytics object in the response) — the "No battery health data" surface.
/// </summary>
public enum BatteryHealthAnalyticsState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with an analytics object to render the gauge + stats for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no analytics object — render the "No battery health data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The slice the Battery Analytics surface reads from <c>GET /analytics/battery-health</c> — the native mirror
/// of the web <c>BatteryHealthAnalytics</c> fields the widget consumes (web/src/types/energy.ts). All values
/// are already dimensionless (a state-of-health percent, cycle count, depth percentages and 0–100 scores), so
/// no unit conversion crosses the display boundary — the web component's <c>useUnits</c> /
/// <c>convertTempFromSI</c> are vestigial there (the "Temp Score" stat is a 0–100 score, not a temperature).
/// Parsing is null-tolerant so a partial body never throws; a <see langword="null"/> parse result models the
/// web query being disabled / returning no object (<c>hasData = !!data</c> false → the empty surface).
/// </summary>
public sealed record BatteryHealthAnalytics(
    double CurrentSoh,
    double TotalCycles,
    double FullChargePct,
    double AvgDepthOfDischarge,
    double FastChargePct,
    double TempExposureScore,
    double ChargeHabitsScore)
{
    /// <summary>An all-zero analytics slice — the projection seed before any data resolves.</summary>
    public static BatteryHealthAnalytics Empty { get; } = new(0, 0, 0, 0, 0, 0, 0);

    /// <summary>
    /// Project a <c>GET /analytics/battery-health</c> response into the slice the widget reads. Mirrors the web
    /// <c>hasData = !!data</c> gate: any analytics object yields a slice (missing fields default to 0, exactly
    /// like the web <c>?? 0</c> reads), and only a non-object body returns <see langword="null"/> (the empty
    /// surface). The raw wire is snake_case (no camelCaseKeys transform on native), so the snake_case keys are
    /// read directly.
    /// </summary>
    public static BatteryHealthAnalytics? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new BatteryHealthAnalytics(
            CurrentSoh: ReadDouble(root, "current_soh"),
            TotalCycles: ReadDouble(root, "total_cycles"),
            FullChargePct: ReadDouble(root, "full_charge_pct"),
            AvgDepthOfDischarge: ReadDouble(root, "avg_depth_of_discharge"),
            FastChargePct: ReadDouble(root, "fast_charge_pct"),
            TempExposureScore: ReadDouble(root, "temp_exposure_score"),
            ChargeHabitsScore: ReadDouble(root, "charge_habits_score"));
    }

    private static double ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> flag and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx.
/// </summary>
public readonly record struct BatteryHealthAnalyticsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static BatteryHealthAnalyticsSize Default => new(2, 4);

    /// <summary>True at one column or narrower (web <c>isCompact = size.cols &lt;= 1</c>): gauge only, no title, no stats.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// One projected stat tile under the gauge — the native analogue of a web <c>GaugeHeroStat</c>
/// (label + value + optional unit). Pure data so the projection is unit-tested without a UI host; the
/// <see cref="AutomationName"/> is the Narrator string for the tile.
/// </summary>
public sealed record BatteryHealthHeroStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Battery Analytics surface for one footprint — the native
/// analogue of everything the web component computes before returning JSX (the clamped health score, the
/// threshold colour, the centre value + "health" unit, the integer caption, and the six stat tiles). Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryHealthAnalyticsDisplay(
    double GaugeValue,
    double GaugeMax,
    string GaugeValueText,
    string GaugeUnit,
    string GaugeCaption,
    StatusKind Status,
    bool IsCompact,
    double GaugeDiameter,
    string GaugeAutomationName,
    IReadOnlyList<BatteryHealthHeroStat> Stats);

/// <summary>
/// Pure projection from a raw <see cref="BatteryHealthAnalytics"/> slice to the display model — the native port
/// of the <c>scoreColor</c> helper, the <c>gaugeConfig</c>/<c>stats</c> memos and the <c>WidgetGaugeHero</c>
/// composition in web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx. Every value is already
/// dimensionless so this only clamps, formats and colours; every label resolves through the i18n facade.
/// </summary>
public static class BatteryHealthAnalyticsProjection
{
    /// <summary>Segoe Fluent "Heart" glyph for the header + empty state (web <c>HeartPulse</c> icon).</summary>
    public const string HeaderGlyph = "\uEB51";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxScore = 100;

    /// <summary>At or above this score the gauge is healthy/green (web <c>score &gt;= 80</c>).</summary>
    public const double HealthyThresholdScore = 80;

    /// <summary>At or above this score the gauge is a warning/amber (web <c>score &gt;= 50</c>).</summary>
    public const double WarningThresholdScore = 50;

    // Web RadialGauge: non-integer values render with getGlobalPrecision() (default 2) fraction digits.
    private const int GlobalPrecision = 2;

    /// <summary>
    /// Map a state-of-health score to the semantic status the gauge arc is tinted with (web <c>scoreColor</c>):
    /// &gt;=80 → <see cref="StatusKind.Success"/> (#10b981), &gt;=50 → <see cref="StatusKind.Warning"/>
    /// (#f59e0b), otherwise <see cref="StatusKind.Danger"/> (#ef4444).
    /// </summary>
    public static StatusKind StatusFor(double score)
    {
        if (score >= HealthyThresholdScore)
        {
            return StatusKind.Success;
        }

        return score >= WarningThresholdScore ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static BatteryHealthAnalyticsDisplay Project(
        BatteryHealthAnalytics data,
        BatteryHealthAnalyticsSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        double rawScore = SafeNumber(data.CurrentSoh);
        double clamped = Math.Clamp(rawScore, 0, MaxScore);
        string valueText = FormatScore(clamped);
        // Web parity: RadialGauge renders the value + unit in the centre and the `label` below; here the web
        // gauge config sets unit = t('…score', 'health') and label = `${fmtInt(healthScore)}`.
        string unit = localizer.GetString("widget.batteryHealthAnalytics.score", "health");
        string caption = FormatInt(rawScore);

        return new BatteryHealthAnalyticsDisplay(
            GaugeValue: clamped,
            GaugeMax: MaxScore,
            GaugeValueText: valueText,
            GaugeUnit: unit,
            GaugeCaption: caption,
            Status: StatusFor(clamped),
            IsCompact: size.IsCompact,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: $"{valueText} {unit}",
            Stats: BuildStats(data, localizer));
    }

    /// <summary>
    /// The six stat tiles under the gauge, mirroring the web <c>stats</c> memo order exactly:
    /// Cycles, Charge Depth (%), Discharge (%), DC Fast (%), Temp Score (/ 100), Habits (/ 100).
    /// </summary>
    public static IReadOnlyList<BatteryHealthHeroStat> BuildStats(BatteryHealthAnalytics data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        return new[]
        {
            Stat(localizer.GetString("widget.batteryHealthAnalytics.totalCycles", "Cycles"),
                FormatInt(data.TotalCycles), null),
            Stat(localizer.GetString("widget.batteryHealthAnalytics.avgChargeDepth", "Charge Depth"),
                FormatPercentValue(data.FullChargePct), "%"),
            Stat(localizer.GetString("widget.batteryHealthAnalytics.avgDischargeDepth", "Discharge"),
                FormatPercentValue(data.AvgDepthOfDischarge), "%"),
            Stat(localizer.GetString("widget.batteryHealthAnalytics.dcFastRatio", "DC Fast"),
                FormatPercentValue(data.FastChargePct), "%"),
            Stat(localizer.GetString("widget.batteryHealthAnalytics.tempExposure", "Temp Score"),
                FormatInt(data.TempExposureScore), "/ 100"),
            Stat(localizer.GetString("widget.batteryHealthAnalytics.chargeHabits", "Habits"),
                FormatInt(data.ChargeHabitsScore), "/ 100"),
        };
    }

    /// <summary>
    /// Format the gauge centre value as the web <c>RadialGauge</c> does: integers render with no fraction
    /// digits and non-integers with the global precision (2), using en-US grouping (web <c>fmtNumber</c>).
    /// </summary>
    public static string FormatScore(double value)
    {
        double safe = SafeNumber(value);
        int decimals = safe == Math.Floor(safe) ? 0 : GlobalPrecision;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }

    private static BatteryHealthHeroStat Stat(string label, string value, string? unit) =>
        new(label, value, unit, unit is null ? $"{label} {value}" : $"{label} {value}{unit}");

    // Web fmtInt(v) === fmtNumber(v, 0): en-US grouping, zero fraction digits.
    private static string FormatInt(double value) => ScalarFormatters.FormatNumber(SafeNumber(value), 0);

    // Web fmtNumber(v, 0) for the percentage readouts (the trailing "%" is rendered as a separate unit run).
    private static string FormatPercentValue(double value) => ScalarFormatters.FormatNumber(SafeNumber(value), 0);

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;BatteryHealthAnalytics&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body is not an analytics object
/// collapses to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web
/// <c>{hasData ? … : empty}</c> gate. Kept pure so the parse-and-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class BatteryHealthAnalyticsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<BatteryHealthAnalytics> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        BatteryHealthAnalytics? Parse() => raw.HasValue ? BatteryHealthAnalytics.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<BatteryHealthAnalytics>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<BatteryHealthAnalytics>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<BatteryHealthAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<BatteryHealthAnalytics>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<BatteryHealthAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<BatteryHealthAnalytics>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<BatteryHealthAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<BatteryHealthAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<BatteryHealthAnalytics>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<BatteryHealthAnalytics>.Empty(raw.FetchedAt),
            _ => RepositoryResult<BatteryHealthAnalytics>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
