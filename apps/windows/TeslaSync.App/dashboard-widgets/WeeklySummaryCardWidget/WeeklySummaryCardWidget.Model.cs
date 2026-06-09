using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="WeeklySummaryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>WeeklySummaryCardWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{metrics ? … :
/// &lt;EmptyState&gt;}</c> gate (the digest query resolved to no data object — either no vehicle, so the
/// <c>enabled: !!vehicleId</c> query is disabled, or a non-object body) — distinct from a transport
/// failure (<see cref="Error"/>).
/// </summary>
public enum WeeklySummaryState
{
    /// <summary>Initial fetch with no cached digest — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh digest (or non-stale cache) with this-week metrics to render.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or the response carried no digest object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached digest exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached digest older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached digest remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The this-week-vs-last-week rollup from <c>GET /vehicles/{vehicleID}/weekly-digest</c> (web
/// <c>useWeeklyDigest</c>, shape <c>WeeklyDigestData</c> in web/src/types/analytics.ts). Field names
/// mirror the Go API's snake_case JSON tags (<c>distance_km</c>, <c>energy_kwh</c>, <c>cost</c>,
/// <c>efficiency</c>, and the <c>prev_*</c> peers — see internal/api/weeklydigest/handler.go). Distance
/// is kilometres and efficiency is Wh/km — both converted to the user's display unit only at projection
/// time. A <see langword="null"/> parse result models the web <c>data</c> being falsy (the
/// "No weekly data" surface). Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Drives">Drive count this week (web <c>drives</c>).</param>
/// <param name="DistanceKm">Distance driven this week, kilometres (web <c>distanceKm</c>).</param>
/// <param name="EnergyKwh">Energy used this week, kilowatt-hours (web <c>energyKwh</c>).</param>
/// <param name="Cost">Charging cost this week (web <c>cost</c>).</param>
/// <param name="EfficiencyWhKm">Average efficiency this week, Wh/km (web <c>efficiency</c>).</param>
/// <param name="PrevDrives">Drive count last week (web <c>prevDrives</c>).</param>
/// <param name="PrevDistanceKm">Distance driven last week, kilometres (web <c>prevDistanceKm</c>).</param>
/// <param name="PrevEnergyKwh">Energy used last week, kilowatt-hours (web <c>prevEnergyKwh</c>).</param>
/// <param name="PrevCost">Charging cost last week (web <c>prevCost</c>).</param>
/// <param name="PrevEfficiencyWhKm">Average efficiency last week, Wh/km (web <c>prevEfficiency</c>).</param>
public sealed record WeeklyDigest(
    double Drives,
    double DistanceKm,
    double EnergyKwh,
    double Cost,
    double EfficiencyWhKm,
    double PrevDrives,
    double PrevDistanceKm,
    double PrevEnergyKwh,
    double PrevCost,
    double PrevEfficiencyWhKm)
{
    /// <summary>An all-zero digest — the projection seed before the first emission.</summary>
    public static WeeklyDigest Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/weekly-digest</c> response into a tolerant digest. Returns
    /// <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>data</c> being falsy (the "No weekly data" surface). Any object yields a digest (matching the
    /// web's truthy <c>data</c> gate); absent numeric fields coalesce to zero like the web's per-field
    /// <c>?? 0</c> reads.
    /// </summary>
    public static WeeklyDigest? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new WeeklyDigest(
            Drives: ReadDouble(root, "drives") ?? 0,
            DistanceKm: ReadDouble(root, "distance_km") ?? 0,
            EnergyKwh: ReadDouble(root, "energy_kwh") ?? 0,
            Cost: ReadDouble(root, "cost") ?? 0,
            EfficiencyWhKm: ReadDouble(root, "efficiency") ?? 0,
            PrevDrives: ReadDouble(root, "prev_drives") ?? 0,
            PrevDistanceKm: ReadDouble(root, "prev_distance_km") ?? 0,
            PrevEnergyKwh: ReadDouble(root, "prev_energy_kwh") ?? 0,
            PrevCost: ReadDouble(root, "prev_cost") ?? 0,
            PrevEfficiencyWhKm: ReadDouble(root, "prev_efficiency") ?? 0);
    }

    private static double? ReadDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> / <c>isTall</c> logic in
/// web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct WeeklySummarySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static WeeklySummarySize Default => new(2, 2);

    /// <summary>True at the single-cell footprint (web <c>size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>): the big-number readout.</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True at three or more columns (web <c>size.cols &gt;= 3</c>): the 4-up stat grid.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True at two or more rows (web <c>size.rows &gt;= 2</c>): include the cost + efficiency stat tiles.</summary>
    public bool IsTall => Rows >= 2;

    /// <summary>Stat-grid column count: 4 when wide, otherwise 2 (web <c>isWide ? 'grid-cols-4' : 'grid-cols-2'</c>).</summary>
    public int GridColumns => IsWide ? 4 : 2;
}

/// <summary>The direction a week-over-week change moved (web <c>trend.direction</c>).</summary>
public enum WeeklyTrendDirection
{
    /// <summary>The metric increased week-over-week.</summary>
    Up,

    /// <summary>The metric decreased week-over-week.</summary>
    Down,

    /// <summary>No comparison, or a sub-1% change (web "~0%" / em dash).</summary>
    Flat,
}

/// <summary>
/// One week-over-week comparison chip — the native port of the web <c>trendOf()</c> result
/// (web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx). Holds the arrow direction, the
/// already-formatted percentage text and the good/bad flag (so a "lower is better" metric like cost or
/// efficiency colours a decrease as positive). Pure data — no WinUI types.
/// </summary>
/// <param name="Direction">The arrow the chip renders (web <c>↑ / ↓ / —</c>).</param>
/// <param name="Value">The localized magnitude text (web <c>fmtPercent(|pct|, 0)</c>, "~0%" or em dash).</param>
/// <param name="Positive">True when the change is a desirable outcome (drives the success tint).</param>
public sealed record WeeklyTrend(WeeklyTrendDirection Direction, string Value, bool Positive)
{
    private const string EmDash = "\u2014";

    /// <summary>
    /// Compute the week-over-week trend for a current/previous pair — a row-for-row port of the web
    /// <c>trendOf(current, previous, lowerIsPositive)</c>: a zero previous renders an em dash, a change
    /// under one percent renders "~0%" flat, otherwise the signed direction with a positive flag that
    /// inverts for "lower is better" metrics. The percentage is always rendered as a positive magnitude.
    /// </summary>
    /// <param name="current">The current-week value (already in display units).</param>
    /// <param name="previous">The previous-week value (already in display units).</param>
    /// <param name="lowerIsPositive">True when a decrease is the desirable outcome (cost, efficiency).</param>
    public static WeeklyTrend Of(double current, double previous, bool lowerIsPositive = false)
    {
        if (previous == 0 || double.IsNaN(previous) || double.IsNaN(current))
        {
            return new WeeklyTrend(WeeklyTrendDirection.Flat, EmDash, false);
        }

        double pct = (current - previous) / Math.Abs(previous) * 100.0;
        if (Math.Abs(pct) < 1.0)
        {
            return new WeeklyTrend(WeeklyTrendDirection.Flat, "~0%", false);
        }

        var direction = pct > 0 ? WeeklyTrendDirection.Up : WeeklyTrendDirection.Down;
        bool positive = lowerIsPositive ? pct < 0 : pct > 0;
        return new WeeklyTrend(direction, ScalarFormatters.FormatPercentage(Math.Abs(pct), 0), positive);
    }
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view (the native analogue of a web
/// <c>StatCard</c>). Holds the localized label, the already-formatted value, the optional unit suffix,
/// the resolved Fluent glyph, the week-over-week <see cref="WeeklyTrend"/> and a Narrator automation
/// name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized metric label (Distance / Energy / Cost / Efficiency).</param>
/// <param name="Value">The already-formatted value.</param>
/// <param name="Unit">Optional unit suffix (km / mi / kWh / Wh per distance), or null for currency.</param>
/// <param name="Glyph">The Fluent glyph accenting the tile.</param>
/// <param name="Trend">The week-over-week comparison chip.</param>
/// <param name="AutomationName">The Narrator name describing the whole tile.</param>
public sealed record WeeklySummaryStat(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    WeeklyTrend Trend,
    string AutomationName);

/// <summary>
/// One compact inline metric (the native analogue of a web <c>InlineMetric</c>) shown in the
/// non-wide / non-tall footprint summary row. Holds the Fluent glyph, the already-formatted value and a
/// Narrator name. Pure data.
/// </summary>
/// <param name="Glyph">The Fluent glyph preceding the value.</param>
/// <param name="Value">The already-formatted value (with any unit suffix folded in).</param>
/// <param name="AutomationName">The Narrator name for the inline metric.</param>
public sealed record WeeklyInlineStat(string Glyph, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the weekly summary for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the grid stat
/// tiles, the inline summary metrics, the compact big-number readout and the footprint flags. Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True for the single-cell big-number layout.</param>
/// <param name="IsWide">True for the 4-up grid layout.</param>
/// <param name="IsTall">True when the cost + efficiency tiles are included.</param>
/// <param name="GridColumns">The stat-grid column count (2 or 4).</param>
/// <param name="GridStats">The stat tiles shown in the grid.</param>
/// <param name="InlineStats">The compact inline metrics (cost + efficiency) shown only in the 2×1 footprint.</param>
/// <param name="CompactValue">The compact big distance number (web <c>fmtNumber(distance, 0)</c>).</param>
/// <param name="CompactUnit">The compact distance unit label.</param>
/// <param name="CompactCaption">The compact caption ("{unit} this week").</param>
/// <param name="CompactAutomationName">The Narrator name for the compact readout.</param>
public sealed record WeeklySummaryDisplay(
    bool IsCompact,
    bool IsWide,
    bool IsTall,
    int GridColumns,
    IReadOnlyList<WeeklySummaryStat> GridStats,
    IReadOnlyList<WeeklyInlineStat> InlineStats,
    string CompactValue,
    string CompactUnit,
    string CompactCaption,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="WeeklyDigest"/> to the display model — the native port of the
/// unit conversion + layout <c>useMemo</c> in
/// web/src/features/dashboard/widgets/WeeklySummaryCardWidget.tsx. The digest's kilometres / Wh-per-km
/// values are converted to the user's display unit here (and only here) through the shared SI converters
/// — the canonical conversion the sibling AnalyticsSummary surface uses — so the readout is unit-correct;
/// every label resolves through the i18n facade.
/// </summary>
public static class WeeklySummaryProjection
{
    /// <summary>Miles→kilometres factor used to restate Wh/km efficiency as Wh/mi (web <c>UNITS.MI_TO_KM</c>).</summary>
    public const double MiToKm = 1.60934;

    /// <summary>Fluent glyph for the surface header / empty state (web <c>TrendingUp</c>).</summary>
    public const string HeaderGlyph = "\uE9D2";

    private const string DistanceGlyph = "\uE9D2";   // trending up (web Route)
    private const string EnergyGlyph = "\uE945";     // lightning (web Zap)
    private const string CostGlyph = "\uE1D3";       // money (web DollarSign)
    private const string EfficiencyGlyph = "\uE950"; // gauge / pulse (web Gauge)

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the user's units + currency.</summary>
    /// <param name="data">The parsed weekly digest.</param>
    /// <param name="size">The widget footprint (drives the compact / standard / wide-tall layout).</param>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="currencySymbol">The currency symbol for the cost tile.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static WeeklySummaryDisplay Project(
        WeeklyDigest data,
        WeeklySummarySize size,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string efficiencyUnit = distanceUnit == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        double distance = UnitConverters.DistanceFromSi(data.DistanceKm * 1000.0, distanceUnit);
        double prevDistance = UnitConverters.DistanceFromSi(data.PrevDistanceKm * 1000.0, distanceUnit);
        double efficiency = distanceUnit == DistanceUnit.Mi ? data.EfficiencyWhKm * MiToKm : data.EfficiencyWhKm;
        double prevEfficiency = distanceUnit == DistanceUnit.Mi ? data.PrevEfficiencyWhKm * MiToKm : data.PrevEfficiencyWhKm;

        string distanceLabel = localizer.GetString("widget.weeklySummary.distance", "Distance");
        string energyLabel = localizer.GetString("widget.weeklySummary.energy", "Energy");
        string costLabel = localizer.GetString("widget.weeklySummary.cost", "Cost");
        string efficiencyLabel = localizer.GetString("widget.weeklySummary.efficiency", "Efficiency");

        string distanceValue = ScalarFormatters.FormatNumber(distance, 1);
        string energyValue = ScalarFormatters.FormatNumber(data.EnergyKwh, 1);
        string costValue = ScalarFormatters.FormatCurrency(data.Cost, symbol);
        string efficiencyValue = ScalarFormatters.FormatNumber(efficiency, 0);

        var distanceStat = new WeeklySummaryStat(
            distanceLabel, distanceValue, distanceUnitLabel, DistanceGlyph,
            WeeklyTrend.Of(distance, prevDistance),
            StatAutomationName(distanceLabel, distanceValue, distanceUnitLabel));
        var energyStat = new WeeklySummaryStat(
            energyLabel, energyValue, "kWh", EnergyGlyph,
            WeeklyTrend.Of(data.EnergyKwh, data.PrevEnergyKwh),
            StatAutomationName(energyLabel, energyValue, "kWh"));
        var costStat = new WeeklySummaryStat(
            costLabel, costValue, null, CostGlyph,
            WeeklyTrend.Of(data.Cost, data.PrevCost, lowerIsPositive: true),
            StatAutomationName(costLabel, costValue, null));
        var efficiencyStat = new WeeklySummaryStat(
            efficiencyLabel, efficiencyValue, efficiencyUnit, EfficiencyGlyph,
            WeeklyTrend.Of(efficiency, prevEfficiency, lowerIsPositive: true),
            StatAutomationName(efficiencyLabel, efficiencyValue, efficiencyUnit));

        var gridStats = new List<WeeklySummaryStat>(4) { distanceStat, energyStat };
        var inlineStats = new List<WeeklyInlineStat>(2);

        // Web parity: the cost + efficiency tiles join the grid when wide or tall; otherwise they fold
        // into the compact inline summary row (StatCard grid vs InlineMetric row).
        if (size.IsWide || size.IsTall)
        {
            gridStats.Add(costStat);
            gridStats.Add(efficiencyStat);
        }
        else
        {
            inlineStats.Add(new WeeklyInlineStat(
                CostGlyph, costValue, StatAutomationName(costLabel, costValue, null)));
            string efficiencyInline = $"{efficiencyValue} {efficiencyUnit}";
            inlineStats.Add(new WeeklyInlineStat(
                EfficiencyGlyph, efficiencyInline, StatAutomationName(efficiencyLabel, efficiencyValue, efficiencyUnit)));
        }

        string thisWeek = localizer.GetString("widget.weeklySummary.thisWeek", "this week");
        string compactValue = ScalarFormatters.FormatNumber(distance, 0);
        string compactCaption = $"{distanceUnitLabel} {thisWeek}";
        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0} {1} {2}", compactValue, distanceUnitLabel, thisWeek);

        return new WeeklySummaryDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            IsTall: size.IsTall,
            GridColumns: size.GridColumns,
            GridStats: gridStats,
            InlineStats: inlineStats,
            CompactValue: compactValue,
            CompactUnit: distanceUnitLabel,
            CompactCaption: compactCaption,
            CompactAutomationName: compactAutomationName);
    }

    private static string StatAutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;WeeklyDigest&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A payload
/// that is not a JSON object collapses to <see cref="RepositoryResult{T}.Empty"/> — the web
/// <c>{metrics ? … : &lt;EmptyState&gt;}</c> gate. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class WeeklySummaryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s digest payload (when present) while preserving its status.</summary>
    public static RepositoryResult<WeeklyDigest> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        WeeklyDigest? Parse() => raw.HasValue ? WeeklyDigest.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<WeeklyDigest>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<WeeklyDigest>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeeklyDigest>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<WeeklyDigest>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<WeeklyDigest>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<WeeklyDigest>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<WeeklyDigest>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<WeeklyDigest>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<WeeklyDigest>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<WeeklyDigest>.Empty(raw.FetchedAt),
            _ => RepositoryResult<WeeklyDigest>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
