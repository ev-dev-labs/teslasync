using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DriveScoreViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DriveScoreWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/DriveScoreWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{analytics ? gauge : empty}</c>
/// gate — when the fleet window carries no driving efficiency there is no score to derive, so the
/// "No data yet" surface shows instead of a meaningless zero gauge.
/// </summary>
public enum DriveScoreState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a positive efficiency to score the gauge from.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no driving efficiency — render the "No data yet" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The single fleet-analytics field the driving score reads from <c>GET /analytics/fleet</c> — the
/// native mirror of the web <c>analytics.avg_efficiency_wh_km</c> slice the widget consumes
/// (<c>FleetAnalytics</c> in web/src/api/types.ts). The value is energy intensity in watt-hours per
/// kilometre (Wh/km, SI-derived), converted to the user's display unit only at projection time.
/// Parsing is null-tolerant so a partial body never throws.
/// </summary>
public sealed record FleetEfficiency(double AvgEfficiencyWhKm)
{
    /// <summary>A zero-efficiency snapshot — the parse fallback for an absent/non-object body.</summary>
    public static FleetEfficiency Empty { get; } = new(0);

    /// <summary>
    /// True when there is a positive efficiency to derive a score from (web
    /// <c>score = efficiency &gt; 0 ? … : 0</c>). Gates the gauge versus the "No data yet" empty surface.
    /// </summary>
    public bool HasScore => AvgEfficiencyWhKm > 0;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant efficiency snapshot.</summary>
    public static FleetEfficiency FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new FleetEfficiency(GetDouble(element, "avg_efficiency_wh_km") ?? 0);
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
/// <c>isCompact</c> flag and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/DriveScoreWidget.tsx.
/// </summary>
public readonly record struct DriveScoreSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static DriveScoreSize Default => new(1, 2);

    /// <summary>True at exactly one column and one row (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>).</summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// The fully projected, render-ready view of the driving score for one footprint — the native analogue
/// of everything the web component computes before returning JSX (the derived score, the threshold
/// colour, the formatted score text, and the efficiency stat in the user's distance unit). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record DriveScoreDisplay(
    double Score,
    double Max,
    string ScoreText,
    string ScoreLabel,
    StatusKind Status,
    string EfficiencyLabel,
    string EfficiencyValue,
    string EfficiencyUnit,
    bool IsCompact,
    double GaugeDiameter,
    string GaugeAutomationName,
    string EfficiencyAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="FleetEfficiency"/> to the display model — the native port of
/// the score derivation, the gauge colour ternary and the <c>WidgetGaugeHero</c> composition in
/// web/src/features/dashboard/widgets/DriveScoreWidget.tsx. SI efficiency is converted to the user's
/// distance unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class DriveScoreProjection
{
    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxScore = 100;

    /// <summary>
    /// The efficiency baseline the web derives the score from
    /// (web <c>Math.round((250 / efficiency) * 100)</c>): a fleet averaging this many Wh/km scores 100.
    /// </summary>
    public const double ScoreBaselineWhKm = 250;

    /// <summary>Above this score the gauge is healthy/green (web <c>score &gt; 75</c>).</summary>
    public const double HealthyThresholdScore = 75;

    /// <summary>Above this score the gauge is a warning/amber (web <c>score &gt; 50</c>).</summary>
    public const double WarningThresholdScore = 50;

    /// <summary>Kilometres per mile used to restate Wh/km efficiency as Wh/mi (web <c>* 1.609344</c>).</summary>
    public const double EfficiencyMiToKm = 1.609344;

    /// <summary>Segoe Fluent "trending up" glyph for the surface header / empty state (web <c>TrendingUp</c>).</summary>
    public const string HeaderGlyph = "\uE9D2";

    /// <summary>
    /// Derive the 0–100 driving score from the fleet efficiency (web
    /// <c>efficiency &gt; 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0</c>): lower Wh/km is
    /// better, so a more efficient fleet scores higher. A non-positive efficiency yields 0.
    /// </summary>
    public static double ScoreFor(double efficiencyWhKm)
    {
        double safe = SafeNumber(efficiencyWhKm);
        if (safe <= 0)
        {
            return 0;
        }

        double rounded = Math.Round(ScoreBaselineWhKm / safe * 100.0, MidpointRounding.AwayFromZero);
        return Math.Min(MaxScore, rounded);
    }

    /// <summary>
    /// Map a score to the semantic status the gauge arc is tinted with (web colour ternary):
    /// &gt;75 → <see cref="StatusKind.Success"/> (green), &gt;50 → <see cref="StatusKind.Warning"/> (amber),
    /// otherwise <see cref="StatusKind.Danger"/> (red).
    /// </summary>
    public static StatusKind StatusFor(double score)
    {
        if (score > HealthyThresholdScore)
        {
            return StatusKind.Success;
        }

        return score > WarningThresholdScore ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>The display efficiency unit for the active distance preference (web <c>efficiencyUnit</c>).</summary>
    public static string EfficiencyUnitFor(DistanceUnit distance) => distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

    /// <summary>
    /// Convert SI Wh/km efficiency to the active distance unit (web <c>toEfficiencyDisplay</c>): Wh/mi
    /// when the user reads miles, otherwise the unchanged Wh/km.
    /// </summary>
    public static double EfficiencyDisplay(double efficiencyWhKm, DistanceUnit distance) =>
        distance == DistanceUnit.Mi ? SafeNumber(efficiencyWhKm) * EfficiencyMiToKm : SafeNumber(efficiencyWhKm);

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the user's distance unit.</summary>
    public static DriveScoreDisplay Project(FleetEfficiency data, DriveScoreSize size, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        double score = ScoreFor(data.AvgEfficiencyWhKm);
        string scoreLabel = localizer.GetString("widget.score", "Score");
        string scoreText = ScalarFormatters.FormatNumber(score, 0);

        string efficiencyLabel = localizer.GetString("widget.efficiency", "Efficiency");
        string efficiencyUnit = EfficiencyUnitFor(units.Distance);
        string efficiencyValue = ScalarFormatters.FormatNumber(EfficiencyDisplay(data.AvgEfficiencyWhKm, units.Distance), 0);

        return new DriveScoreDisplay(
            Score: score,
            Max: MaxScore,
            ScoreText: scoreText,
            ScoreLabel: scoreLabel,
            Status: StatusFor(score),
            EfficiencyLabel: efficiencyLabel,
            EfficiencyValue: efficiencyValue,
            EfficiencyUnit: efficiencyUnit,
            IsCompact: size.IsCompact,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: string.Create(CultureInfo.CurrentCulture, $"{scoreLabel} {scoreText}"),
            EfficiencyAutomationName: string.Create(CultureInfo.CurrentCulture, $"{efficiencyLabel}: {efficiencyValue} {efficiencyUnit}"));
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;FleetEfficiency&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class DriveScoreResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<FleetEfficiency> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        FleetEfficiency Parse() => raw.HasValue ? FleetEfficiency.FromJson(raw.Value) : FleetEfficiency.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<FleetEfficiency>.Loading(),
            LoadStatus.Cached => RepositoryResult<FleetEfficiency>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<FleetEfficiency>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<FleetEfficiency>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<FleetEfficiency>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<FleetEfficiency>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<FleetEfficiency>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
