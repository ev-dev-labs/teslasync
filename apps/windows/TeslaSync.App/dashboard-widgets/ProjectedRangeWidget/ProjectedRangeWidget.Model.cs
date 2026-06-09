using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ProjectedRangeViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ProjectedRangeWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{data ? … :
/// &lt;EmptyState&gt;}</c> gate (the response carried no projection object) — the friendly
/// "No projected range data" surface — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum ProjectedRangeState
{
    /// <summary>Initial fetch with no cached projection — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh projection (or non-stale cache) with a Helix range object to render.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or the response carried no projection object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached projection exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached projection older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached projection remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the projected-range view reads from <c>GET /vehicles/{vehicleID}/battery/projected-range</c> — the
/// native mirror of the web <c>ProjectedRangeData</c> slice (web/src/types/energy.ts). The web component treats
/// the three <c>*_km</c> fields as SI-as-kilometres (it multiplies by 1000 to metres before
/// <c>convertDistanceFromSI</c>), so they are carried here verbatim as kilometres and converted in the
/// projection. Every numeric field is nullable so the projection can reproduce the web's exact coalescing: the
/// range values gate on <c>!= null</c> (a missing value renders the em dash), while the factor values fall back
/// through <c>?? 0</c>. A <see langword="null"/> parse result models the web <c>data</c> being
/// falsy/undefined — the "No projected range data" surface. Parsing is null-tolerant so a partial body never
/// throws.
/// </summary>
/// <param name="CurrentRangeKm">Helix-predicted current range, kilometres (web <c>current_range_km</c>).</param>
/// <param name="NewRangeKm">EPA / when-new rated range, kilometres (web <c>new_range_km</c>).</param>
/// <param name="AvgDailyKm">Average daily usage, kilometres (web <c>avg_daily_km</c>).</param>
/// <param name="HealthScore">Battery health score 0–100 driving the badge (web <c>health_score</c>).</param>
/// <param name="DegradationPct">Battery degradation percent (web <c>degradation_pct</c>).</param>
/// <param name="CurrentCapacityPct">Current usable capacity percent (web <c>current_capacity_pct</c>).</param>
/// <param name="TotalCycles">Lifetime battery cycle count (web <c>total_cycles</c>).</param>
public sealed record ProjectedRangeReading(
    double? CurrentRangeKm,
    double? NewRangeKm,
    double? AvgDailyKm,
    double? HealthScore,
    double? DegradationPct,
    double? CurrentCapacityPct,
    double? TotalCycles)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/battery/projected-range</c> response into the reading slice.
    /// Returns <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>data</c> being falsy (the "No projected range data" surface). Any object yields a reading (matching
    /// the web's truthy <c>data</c> gate); absent numeric fields stay <see langword="null"/> so the projection
    /// can apply the web's per-field <c>!= null</c> / <c>?? 0</c> rules.
    /// </summary>
    public static ProjectedRangeReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ProjectedRangeReading(
            CurrentRangeKm: ReadDouble(root, "current_range_km"),
            NewRangeKm: ReadDouble(root, "new_range_km"),
            AvgDailyKm: ReadDouble(root, "avg_daily_km"),
            HealthScore: ReadDouble(root, "health_score"),
            DegradationPct: ReadDouble(root, "degradation_pct"),
            CurrentCapacityPct: ReadDouble(root, "current_capacity_pct"),
            TotalCycles: ReadDouble(root, "total_cycles"));
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>ProjectedRangeWidget</c> branches its layout on the column span — a compact (<c>cols &lt;= 1</c>) big
/// number, a wide (<c>cols &gt;= 3</c>) range + comparison + factors list, and a standard (everything else)
/// range + comparison — so the footprint is observable (see <see cref="IsCompact"/> / <see cref="IsWide"/>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ProjectedRangeSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ProjectedRangeSize Default => new(2, 2);

    /// <summary>True at the compact footprint (web <c>size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at the wide footprint (web <c>size.cols &gt;= 3</c>).</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// The confidence badge the web <c>healthBadge()</c> helper computes from the health score — a localized label
/// and the semantic status its chip is tinted with. Excellent / Good map to success, Fair to warning and Poor
/// to danger.
/// </summary>
/// <param name="Text">The localized confidence label (Excellent / Good / Fair / Poor).</param>
/// <param name="Status">The semantic status driving the chip colour.</param>
public sealed record ProjectedRangeBadge(string Text, StatusKind Status);

/// <summary>
/// One row of the wide-layout "Range Factors" list — a decorative glyph, a localized label and a formatted
/// value (the native analogue of the web <c>factors</c> array rows). All three string fields are display-ready.
/// </summary>
/// <param name="Glyph">A Segoe Fluent glyph (decorative; exposed to Narrator as raw).</param>
/// <param name="Label">The localized factor label.</param>
/// <param name="Value">The formatted factor value (already unit-suffixed where applicable).</param>
public sealed record ProjectedRangeFactor(string Glyph, string Label, string Value);

/// <summary>
/// The semantic tier the comparison bar is tinted with — the native union of the web inline ternary
/// (<c>rangePct &gt;= 80 ? green : rangePct &gt;= 60 ? amber : red</c>). The view maps each tier to the exact
/// web hex so the threshold logic stays UI-free and unit-testable.
/// </summary>
public enum ProjectedRangeBarTier
{
    /// <summary>≥ 80% of EPA — the web green (#10b981).</summary>
    Good,

    /// <summary>≥ 60% of EPA — the web amber (#f59e0b).</summary>
    Warning,

    /// <summary>&lt; 60% of EPA (or unknown) — the web red (#ef4444).</summary>
    Poor,
}

/// <summary>
/// The fully projected, render-ready view of the projected-range surface for one footprint and unit preference
/// — the native analogue of everything the web component computes before returning JSX (the unit-converted
/// range big number, the confidence badge, the projected-vs-EPA comparison bar, and the wide-layout factors
/// list). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">Whether the compact (1×2) layout is active (web <c>isCompact</c>).</param>
/// <param name="IsWide">Whether the wide (≥3 col) layout is active (web <c>isWide</c>).</param>
/// <param name="ProjectedRangeValue">The rounded display range for the big number, or null → em dash (web <c>Math.round(projectedRange)</c>).</param>
/// <param name="DistanceUnitLabel">The distance unit label, e.g. "km" / "mi" (web <c>distanceUnit</c>).</param>
/// <param name="Badge">The confidence badge, or null when there is no health score (web <c>badge</c>).</param>
/// <param name="BadgeDetailText">The standard/wide badge text with the score appended, e.g. "Excellent · 95%".</param>
/// <param name="RangePct">The projected/EPA percentage (0..100), or null when either side is missing (web <c>rangePct</c>).</param>
/// <param name="BarTier">The comparison bar's semantic tier (web colour ternary).</param>
/// <param name="EpaText">The formatted EPA range, e.g. "450 km", or the em dash (web <c>epaRange</c> readout).</param>
/// <param name="RangePctText">The "{pct}% of EPA rated" caption (empty when <paramref name="RangePct"/> is null).</param>
/// <param name="Factors">The wide-layout factor rows (always built; rendered only in the wide layout).</param>
/// <param name="ProjectedLabel">Localized "Projected" label.</param>
/// <param name="EpaLabel">Localized "EPA" label.</param>
/// <param name="FactorsLabel">Localized "Range Factors" label.</param>
/// <param name="AutomationName">Narrator name summarising the rendered surface.</param>
public sealed record ProjectedRangeDisplay(
    bool IsCompact,
    bool IsWide,
    double? ProjectedRangeValue,
    string DistanceUnitLabel,
    ProjectedRangeBadge? Badge,
    string BadgeDetailText,
    int? RangePct,
    ProjectedRangeBarTier BarTier,
    string EpaText,
    string RangePctText,
    IReadOnlyList<ProjectedRangeFactor> Factors,
    string ProjectedLabel,
    string EpaLabel,
    string FactorsLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ProjectedRangeReading"/> to the display model — the native port of the
/// web component's inline computation in web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx. The range
/// big number, the EPA readout and the average-daily factor honour the user's distance preference exactly like
/// the web <c>convertDistanceFromSI(value_km * 1000, unit)</c> (including the kilometres→metres scaling); the
/// confidence badge reproduces <c>healthBadge</c>; the comparison percentage reproduces <c>rangePct</c>; the bar
/// tier reproduces the colour ternary. Every label resolves through the i18n facade.
/// </summary>
public static class ProjectedRangeProjection
{
    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The middle-dot separator between the badge label and the score (web <c> · </c>).</summary>
    public const string BadgeSeparator = " \u00B7 ";

    /// <summary>Metres per kilometre — the web multiplies the <c>*_km</c> fields by this before converting from SI.</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Health score at/above which the badge reads "Excellent" (web <c>&gt;= 90</c>).</summary>
    public const double ExcellentThreshold = 90;

    /// <summary>Health score at/above which the badge reads "Good" (web <c>&gt;= 70</c>).</summary>
    public const double GoodThreshold = 70;

    /// <summary>Health score at/above which the badge reads "Fair" (web <c>&gt;= 50</c>); below is "Poor".</summary>
    public const double FairThreshold = 50;

    /// <summary>Projected/EPA percentage at/above which the comparison bar is green (web <c>&gt;= 80</c>).</summary>
    public const int BarGoodThreshold = 80;

    /// <summary>Projected/EPA percentage at/above which the comparison bar is amber (web <c>&gt;= 60</c>).</summary>
    public const int BarWarningThreshold = 60;

    /// <summary>Segoe Fluent "Speed" gauge glyph for the degradation factor (web <c>Gauge</c> icon).</summary>
    public const string DegradationGlyph = "\uE950";

    /// <summary>Segoe Fluent "MapDirections" glyph for the average-daily-usage factor (web <c>Navigation</c> icon).</summary>
    public const string AvgDailyGlyph = "\uE816";

    /// <summary>Segoe Fluent "Temperature" glyph for the current-capacity factor (web <c>Thermometer</c> icon).</summary>
    public const string CapacityGlyph = "\uE9CA";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the battery-cycles factor (web <c>Mountain</c> icon).</summary>
    public const string CyclesGlyph = "\uE945";

    private const int RangePrecision = 0;
    private const int EpaPrecision = 0;
    private const int AvgDailyPrecision = 0;
    private const int CyclesPrecision = 0;
    private const int HealthScorePrecision = 0;
    private const int PercentPrecision = 1;

    /// <summary>
    /// Map a health score to the confidence badge (web <c>healthBadge</c>): ≥90 → Excellent (success), ≥70 →
    /// Good (success), ≥50 → Fair (warning), otherwise Poor (danger). Returns <see langword="null"/> when there
    /// is no score, mirroring the web <c>healthScore != null ? healthBadge(…) : undefined</c>.
    /// </summary>
    public static ProjectedRangeBadge? HealthBadge(double? score, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (score is not { } s)
        {
            return null;
        }

        if (s >= ExcellentThreshold)
        {
            return new ProjectedRangeBadge(localizer.GetString("widget.projectedRange.excellent", "Excellent"), StatusKind.Success);
        }

        if (s >= GoodThreshold)
        {
            return new ProjectedRangeBadge(localizer.GetString("widget.projectedRange.good", "Good"), StatusKind.Success);
        }

        if (s >= FairThreshold)
        {
            return new ProjectedRangeBadge(localizer.GetString("widget.projectedRange.fair", "Fair"), StatusKind.Warning);
        }

        return new ProjectedRangeBadge(localizer.GetString("widget.projectedRange.poor", "Poor"), StatusKind.Danger);
    }

    /// <summary>
    /// Convert a kilometre value to the user's distance unit the way the web does —
    /// <c>convertDistanceFromSI(value_km * 1000, unit)</c>. Returns <see langword="null"/> when the source value
    /// is absent, mirroring the web's <c>value != null ? convert : null</c>.
    /// </summary>
    public static double? DistanceDisplay(double? valueKm, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        return valueKm is { } v ? UnitConverters.DistanceFromSi(v * MetersPerKm, units.Distance) : null;
    }

    /// <summary>
    /// The projected-vs-EPA percentage the web computes — <c>min(100, round(projected / epa * 100))</c> when
    /// both display values are present and EPA &gt; 0, otherwise <see langword="null"/>. The ratio is
    /// unit-independent, so the converted display values reproduce the web result exactly.
    /// </summary>
    public static int? RangePct(double? projectedDisplay, double? epaDisplay)
    {
        if (projectedDisplay is { } p && epaDisplay is { } e && e > 0)
        {
            int pct = (int)Math.Round(p / e * 100.0, MidpointRounding.AwayFromZero);
            return Math.Min(100, pct);
        }

        return null;
    }

    /// <summary>
    /// Map the projected/EPA percentage to the comparison bar's tier (web colour ternary): ≥80 → green, ≥60 →
    /// amber, otherwise (including a null percentage) → red.
    /// </summary>
    public static ProjectedRangeBarTier BarTier(int? rangePct)
    {
        if (rangePct is { } p)
        {
            if (p >= BarGoodThreshold)
            {
                return ProjectedRangeBarTier.Good;
            }

            if (p >= BarWarningThreshold)
            {
                return ProjectedRangeBarTier.Warning;
            }
        }

        return ProjectedRangeBarTier.Poor;
    }

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> and <paramref name="units"/> using the localizer for every label.</summary>
    public static ProjectedRangeDisplay Project(
        ProjectedRangeReading reading,
        ProjectedRangeSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string distanceUnit = UnitLabels.Label(units.Distance);

        double? projected = DistanceDisplay(reading.CurrentRangeKm, units);
        double? epa = DistanceDisplay(reading.NewRangeKm, units);
        double? avgDaily = DistanceDisplay(reading.AvgDailyKm, units);

        double? projectedRounded = projected is { } p
            ? Math.Round(p, MidpointRounding.AwayFromZero)
            : null;

        var badge = HealthBadge(reading.HealthScore, localizer);
        string badgeDetail = badge is { } b
            ? $"{b.Text}{BadgeSeparator}{ScalarFormatters.FormatNumber(reading.HealthScore ?? 0, HealthScorePrecision)}%"
            : string.Empty;

        int? rangePct = RangePct(projected, epa);
        ProjectedRangeBarTier barTier = BarTier(rangePct);

        string epaText = epa is { } e
            ? $"{ScalarFormatters.FormatNumber(e, EpaPrecision)} {distanceUnit}"
            : EmDash;

        string projectedLabel = localizer.GetString("widget.projectedRange.projected", "Projected");
        string epaLabel = localizer.GetString("widget.projectedRange.epa", "EPA");
        string factorsLabel = localizer.GetString("widget.projectedRange.factors", "Range Factors");
        string ofEpa = localizer.GetString("widget.projectedRange.ofEpa", "of EPA rated");

        string rangePctText = rangePct is { } pct
            ? $"{pct.ToString(CultureInfo.InvariantCulture)}% {ofEpa}"
            : string.Empty;

        var factors = BuildFactors(reading, avgDaily, distanceUnit, localizer);

        string automation = BuildAutomationName(
            projectedRounded, distanceUnit, badge, reading.HealthScore, rangePctText, projectedLabel);

        return new ProjectedRangeDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            ProjectedRangeValue: projectedRounded,
            DistanceUnitLabel: distanceUnit,
            Badge: badge,
            BadgeDetailText: badgeDetail,
            RangePct: rangePct,
            BarTier: barTier,
            EpaText: epaText,
            RangePctText: rangePctText,
            Factors: factors,
            ProjectedLabel: projectedLabel,
            EpaLabel: epaLabel,
            FactorsLabel: factorsLabel,
            AutomationName: automation);
    }

    private static ProjectedRangeFactor[] BuildFactors(
        ProjectedRangeReading reading,
        double? avgDailyDisplay,
        string distanceUnit,
        ILocalizer localizer)
    {
        return new[]
        {
            new ProjectedRangeFactor(
                DegradationGlyph,
                localizer.GetString("widget.projectedRange.degradation", "Battery Degradation"),
                $"{ScalarFormatters.FormatNumber(reading.DegradationPct ?? 0, PercentPrecision)}%"),
            new ProjectedRangeFactor(
                AvgDailyGlyph,
                localizer.GetString("widget.projectedRange.avgDaily", "Avg Daily Usage"),
                $"{ScalarFormatters.FormatNumber(avgDailyDisplay ?? 0, AvgDailyPrecision)} {distanceUnit}"),
            new ProjectedRangeFactor(
                CapacityGlyph,
                localizer.GetString("widget.projectedRange.capacity", "Current Capacity"),
                $"{ScalarFormatters.FormatNumber(reading.CurrentCapacityPct ?? 0, PercentPrecision)}%"),
            new ProjectedRangeFactor(
                CyclesGlyph,
                localizer.GetString("widget.projectedRange.cycles", "Battery Cycles"),
                ScalarFormatters.FormatNumber(reading.TotalCycles ?? 0, CyclesPrecision)),
        };
    }

    private static string BuildAutomationName(
        double? projectedRounded,
        string distanceUnit,
        ProjectedRangeBadge? badge,
        double? healthScore,
        string rangePctText,
        string projectedLabel)
    {
        string rangePart = projectedRounded is { } r
            ? $"{projectedLabel} {ScalarFormatters.FormatNumber(r, RangePrecision)} {distanceUnit}"
            : $"{projectedLabel} {EmDash}";

        string badgePart = badge is { } b
            ? $", {b.Text} {ScalarFormatters.FormatNumber(healthScore ?? 0, HealthScorePrecision)}%"
            : string.Empty;

        string epaPart = string.IsNullOrEmpty(rangePctText) ? string.Empty : $", {rangePctText}";

        return $"{rangePart}{badgePart}{epaPart}";
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ProjectedRangeReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no projection object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{data ? … : &lt;EmptyState&gt;}</c>
/// gate. Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ProjectedRangeResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s projection payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<ProjectedRangeReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ProjectedRangeReading? Parse() =>
            raw.HasValue ? ProjectedRangeReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ProjectedRangeReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<ProjectedRangeReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ProjectedRangeReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<ProjectedRangeReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ProjectedRangeReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<ProjectedRangeReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ProjectedRangeReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ProjectedRangeReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<ProjectedRangeReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ProjectedRangeReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ProjectedRangeReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
