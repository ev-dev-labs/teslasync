using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="MileageStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>MileageStatsWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/MileageStatsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web outer <c>{data ? … : &lt;EmptyState&gt;}</c>
/// gate (an absent response body / the <c>enabled:!!vehicleId</c> disabled query), not a value threshold —
/// the endpoint renders its averages grid for any populated object, even all-zero distances.
/// </summary>
public enum MileageStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with averages to show.</summary>
    Loaded,

    /// <summary>The response carried no object (null / empty body / no vehicle) — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The mileage rollup from <c>GET /mileage/stats</c> (web <c>useMileageStats</c>, shape
/// <c>MileageStats</c> in web/src/types/analytics.ts). Only the two fields the widget reads are projected
/// here; field names mirror the Go API's snake_case JSON tags (<c>lifetime_km</c>, <c>last_30d_km</c>).
/// Parsing is null-tolerant so a partial body never throws. Distances are kilometres — restated to SI
/// metres (× 1000) and converted to the user's display unit only at projection time.
/// </summary>
public sealed record MileageStats(double LifetimeKm, double Last30dKm)
{
    /// <summary>An all-zero snapshot — the seed for the initial display and the parse fallback.</summary>
    public static MileageStats Empty { get; } = new(0, 0);

    /// <summary>Project a <c>GET /mileage/stats</c> JSON object into a tolerant snapshot.</summary>
    public static MileageStats FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new MileageStats(
            LifetimeKm: GetDouble(element, "lifetime_km") ?? 0,
            Last30dKm: GetDouble(element, "last_30d_km") ?? 0);
    }

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
/// <c>isCompact</c> logic in web/src/features/dashboard/widgets/MileageStatsWidget.tsx
/// (<c>isCompact = size.cols &lt;= 1</c>). Unlike the lifetime surface there is no wide variant — the web
/// component always renders the same four averages at a fixed two-up grid.
/// </summary>
public readonly record struct MileageStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static MileageStatsSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big animated daily-average number.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// A small directional badge attached to a stat tile — the native analogue of the web <c>StatCard</c>
/// <c>trend</c> ({ direction, value, positive }) used by the Next Milestone tile. Holds the resolved arrow
/// glyph, the already-localized caption (e.g. "~9 mo"), and whether it reads as positive (green).
/// </summary>
public sealed record MileageStatsTrend(string Arrow, string Value, bool Positive);

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view. Holds the localized label, the
/// already-formatted value, the distance-unit suffix, the resolved Fluent glyph, an optional
/// <see cref="MileageStatsTrend"/> badge, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record MileageStatsStat(
    string Label,
    string Value,
    string Unit,
    string Glyph,
    MileageStatsTrend? Trend,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the mileage averages for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the four stat
/// tiles (daily / weekly / monthly average + next milestone) and the compact big-number daily average with
/// its "{unit}/day" caption. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record MileageStatsDisplay(
    bool IsCompact,
    IReadOnlyList<MileageStatsStat> Stats,
    double CompactDailyAverage,
    string CompactValue,
    string CompactLabel,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="MileageStats"/> to the display model — the native port of the
/// unit conversion + <c>stats</c> <c>useMemo</c> in
/// web/src/features/dashboard/widgets/MileageStatsWidget.tsx. SI is converted to the user's display unit
/// here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class MileageStatsProjection
{
    /// <summary>Web <c>TrendingUp</c> → Segoe Fluent "trending up" (the emerald header + Monthly Avg glyph).</summary>
    public const string HeaderGlyph = "\uE9D2";

    // web Route → trending line (matches the sibling distance glyph mapping used across the analytics widgets).
    private const string DailyGlyph = "\uE9D2";

    // web Calendar (the weekly bucket).
    private const string WeeklyGlyph = "\uE787";

    // web TrendingUp (the monthly trend).
    private const string MonthlyGlyph = "\uE9D2";

    // web Target → Flag (a milestone marker; Segoe Fluent has no bullseye glyph).
    private const string MilestoneGlyph = "\uE7C1";

    // web StatCard's up arrow ("↑") for a positive trend.
    private const string TrendUpArrow = "\u2191";

    private const string EmDash = "\u2014";

    /// <summary>Milestone step: the next 10 000-unit odometer mark above the current total (web <c>nextMilestone</c>).</summary>
    private const double MilestoneStep = 10_000d;

    /// <summary>
    /// Project <paramref name="data"/> for <paramref name="size"/> using the user's distance unit.
    /// <para>
    /// Distance handling follows the web source exactly: <c>/mileage/stats</c> returns kilometres, restated
    /// to SI metres (× 1000) before <see cref="UnitConverters.DistanceFromSi"/> converts to the display unit.
    /// The daily average derives from the rolling 30-day window (<c>last_30d_km / 30</c>).
    /// </para>
    /// </summary>
    public static MileageStatsDisplay Project(
        MileageStats data,
        MileageStatsSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string distanceUnitLabel = UnitLabels.Label(units.Distance);

        double totalMeters = data.LifetimeKm * 1000.0;
        double dailyAvgMeters = data.Last30dKm / 30.0 * 1000.0;
        double totalDisplay = UnitConverters.DistanceFromSi(totalMeters, units.Distance);
        double dailyAvgDisplay = UnitConverters.DistanceFromSi(dailyAvgMeters, units.Distance);

        double milestone = Math.Ceiling((totalDisplay + 1) / MilestoneStep) * MilestoneStep;
        double remaining = milestone - totalDisplay;
        long monthsToMilestone = dailyAvgDisplay > 0
            ? Math.Max(1, (long)Math.Round(remaining / dailyAvgDisplay / 30.0, MidpointRounding.AwayFromZero))
            : 0;

        string dailyLabel = localizer.GetString("widget.mileageStats.dailyAvg", "Daily Avg");
        string weeklyLabel = localizer.GetString("widget.mileageStats.weeklyAvg", "Weekly Avg");
        string monthlyLabel = localizer.GetString("widget.mileageStats.monthlyAvg", "Monthly Avg");
        string milestoneLabel = localizer.GetString("widget.mileageStats.nextMilestone", "Next Milestone");

        string dailyValue = ScalarFormatters.FormatNumber(dailyAvgDisplay, 1);
        string weeklyValue = ScalarFormatters.FormatNumber(dailyAvgDisplay * 7, 0);
        string monthlyValue = ScalarFormatters.FormatNumber(dailyAvgDisplay * 30, 0);
        string milestoneValue = ScalarFormatters.FormatNumber(milestone, 0);

        string trendCaption = monthsToMilestone > 0
            ? FillMonths(
                localizer.GetString("widget.mileageStats.inMonths", "~{{months}} mo"),
                monthsToMilestone.ToString(CultureInfo.InvariantCulture))
            : EmDash;
        var milestoneTrend = new MileageStatsTrend(TrendUpArrow, trendCaption, Positive: true);

        var stats = new List<MileageStatsStat>(4)
        {
            new(dailyLabel, dailyValue, distanceUnitLabel, DailyGlyph, null, StatAutomationName(dailyLabel, dailyValue, distanceUnitLabel, null)),
            new(weeklyLabel, weeklyValue, distanceUnitLabel, WeeklyGlyph, null, StatAutomationName(weeklyLabel, weeklyValue, distanceUnitLabel, null)),
            new(monthlyLabel, monthlyValue, distanceUnitLabel, MonthlyGlyph, null, StatAutomationName(monthlyLabel, monthlyValue, distanceUnitLabel, null)),
            new(milestoneLabel, milestoneValue, distanceUnitLabel, MilestoneGlyph, milestoneTrend, StatAutomationName(milestoneLabel, milestoneValue, distanceUnitLabel, milestoneTrend)),
        };

        string compactValue = ScalarFormatters.FormatNumber(dailyAvgDisplay, 0);
        string dayWord = localizer.GetString("widget.mileageStats.day", "day");
        string compactLabel = string.Format(CultureInfo.CurrentCulture, "{0}/{1}", distanceUnitLabel, dayWord);
        string compactAutomationName = string.Format(CultureInfo.CurrentCulture, "{0} {1}", compactValue, compactLabel);

        return new MileageStatsDisplay(
            IsCompact: size.IsCompact,
            Stats: stats,
            CompactDailyAverage: dailyAvgDisplay,
            CompactValue: compactValue,
            CompactLabel: compactLabel,
            CompactAutomationName: compactAutomationName);
    }

    private static string StatAutomationName(string label, string value, string unit, MileageStatsTrend? trend)
    {
        string baseName = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
        return trend is null
            ? baseName
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", baseName, trend.Value);
    }

    // Substitute the one interpolation token the caption carries, accepting both the resw catalog's {0}
    // form and the web fallback's {{months}}/{months} form so production and headless tests both resolve.
    private static string FillMonths(string template, string value) =>
        template
            .Replace("{{months}}", value, StringComparison.Ordinal)
            .Replace("{months}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MileageStats&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MileageStatsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<MileageStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MileageStats Parse() => raw.HasValue ? MileageStats.FromJson(raw.Value) : MileageStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MileageStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<MileageStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<MileageStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<MileageStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<MileageStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<MileageStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<MileageStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
