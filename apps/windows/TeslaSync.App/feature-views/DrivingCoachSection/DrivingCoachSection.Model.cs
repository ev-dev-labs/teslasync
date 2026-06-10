using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>DrivingCoachSection</c> surface — the native union of the
/// states the P2 feature-view contract requires for the Driving-Dynamics coach section
/// (web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx). The web component is a pure
/// presentational child: it takes a <c>coachData: DrivingCoachData | undefined</c> prop and performs no
/// fetching, so the parent Driving-Dynamics page owns the <c>useDrivingCoach</c> query lifecycle and supplies
/// the active state. Every member maps onto a visible surface; none is ever hidden behind a
/// <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum DrivingCoachSectionState
{
    /// <summary>The coach query is in flight and no data has arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>At least one analysed drive (the web fall-through) — the full coach composition.</summary>
    Ready,

    /// <summary>Resolved with no analysed drives — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The coach query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

/// <summary>The web <c>style_breakdown</c> counts per driving style (efficient / moderate / aggressive).</summary>
public sealed record CoachStyleBreakdown(int Efficient, int Moderate, int Aggressive);

/// <summary>The web <c>patterns: CoachPatterns</c> — the five driving-pattern percentages (0..100).</summary>
public sealed record CoachPatterns(
    double HardAccelPct,
    double HardBrakePct,
    double HighwayPct,
    double ShortTripPct,
    double ColdStartPct);

/// <summary>One web <c>weekly_trend</c> point — a week bucket label and its 0..100 driving score.</summary>
public sealed record CoachWeeklyPoint(string Week, double Score);

/// <summary>One web <c>recommendations</c> entry — a severity (<c>high</c>/<c>medium</c>/<c>low</c>) and tip.</summary>
public sealed record CoachRecommendationItem(string Impact, string Tip);

/// <summary>
/// One web <c>per_drive_scores</c> row — the drive id, its date, the 0..100 score, the style
/// (<c>efficient</c>/<c>moderate</c>/<c>aggressive</c>), the Wh/km efficiency and the distance in km.
/// </summary>
public sealed record CoachDriveScore(
    long DriveId,
    DateTimeOffset? Date,
    double Score,
    string Style,
    double Efficiency,
    double Distance);

/// <summary>
/// The render-time data model the <c>DrivingCoachSection</c> reads — the native analogue of the web
/// component's <c>coachData: DrivingCoachData</c> prop. Pure data (no WinUI types) so the projection is
/// unit-tested without a UI host. Distances / efficiencies are the web's display fields verbatim (km, Wh/km),
/// reproducing the source exactly rather than introducing a new unit-suffixed field.
/// </summary>
public sealed record DrivingCoachData(
    double OverallScore,
    double EfficiencyWhKm,
    double BestEfficiencyWhKm,
    long TotalDrivesAnalyzed,
    CoachStyleBreakdown StyleBreakdown,
    CoachPatterns Patterns,
    IReadOnlyList<CoachWeeklyPoint> WeeklyTrend,
    IReadOnlyList<CoachRecommendationItem> Recommendations,
    IReadOnlyList<CoachDriveScore> PerDriveScores)
{
    /// <summary>The web's <c>coachData === undefined</c> shape — every field zeroed / emptied.</summary>
    public static DrivingCoachData Empty { get; } = new(
        0,
        0,
        0,
        0,
        new CoachStyleBreakdown(0, 0, 0),
        new CoachPatterns(0, 0, 0, 0, 0),
        [],
        [],
        []);
}

/// <summary>
/// The render-time model the <c>DrivingCoachSection</c> view binds to — the web <c>coachData</c> prop plus the
/// parent-supplied lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the
/// parent Driving-Dynamics state holder fills this in (the native P1/S8 seam). <see cref="Data"/> is always
/// present (use <see cref="DrivingCoachData.Empty"/> for loading / empty / error) so the projection never
/// null-checks. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record DrivingCoachSectionModel(
    DrivingCoachSectionState Status,
    DrivingCoachData Data,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the coach query is in flight and no data has arrived yet.</summary>
    public static DrivingCoachSectionModel Loading { get; } =
        new(DrivingCoachSectionState.Loading, DrivingCoachData.Empty);

    /// <summary>A resolved model with no analysed drives — the empty state.</summary>
    public static DrivingCoachSectionModel Empty { get; } =
        new(DrivingCoachSectionState.Empty, DrivingCoachData.Empty);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static DrivingCoachSectionModel Failed(string? message = null) =>
        new(DrivingCoachSectionState.Error, DrivingCoachData.Empty, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the coach payload.</summary>
    public static DrivingCoachSectionModel Ready(
        DrivingCoachData data,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        new(DrivingCoachSectionState.Ready, data, updatedAt, isFetching);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached coach payload.</summary>
    public static DrivingCoachSectionModel Stale(DrivingCoachData data, DateTimeOffset? updatedAt = null) =>
        new(DrivingCoachSectionState.Stale, data, updatedAt);

    /// <summary>An offline snapshot (no connectivity) carrying the last cached coach payload.</summary>
    public static DrivingCoachSectionModel Offline(DrivingCoachData data, DateTimeOffset? updatedAt = null) =>
        new(DrivingCoachSectionState.Offline, data, updatedAt);
}

/// <summary>
/// The projected score gauge — the native analogue of the web <c>RadialGauge</c>. <see cref="Value"/> is the
/// 0..100 overall score, <see cref="DrivesAnalyzedText"/> is the localized "<c>{n} drives analyzed</c>"
/// caption, and <see cref="Band"/> maps the web arc-colour threshold (≥75 good, ≥50 warning, else critical)
/// onto a semantic <see cref="StatusKind"/> (carried by the per-drive Score / Style badges since the native
/// gauge tints its arc from a themed role, not arbitrary hex).
/// </summary>
public sealed record CoachScoreDisplay(
    double Value,
    string Label,
    string ValueText,
    string DrivesAnalyzedText,
    StatusKind Band,
    string AutomationName);

/// <summary>One coloured segment of the web style-breakdown stacked bar.</summary>
public sealed record CoachStyleSegmentDisplay(string Key, StatusKind Status, double Fraction, int Count);

/// <summary>One row of the web style-breakdown legend (dot + label + count).</summary>
public sealed record CoachStyleLegendDisplay(string Key, string Label, StatusKind Status, string CountText);

/// <summary>The projected style breakdown — the stacked bar segments, the legend, and its empty copy.</summary>
public sealed record CoachStyleBreakdownDisplay(
    bool HasData,
    IReadOnlyList<CoachStyleSegmentDisplay> Segments,
    IReadOnlyList<CoachStyleLegendDisplay> Legend,
    string EmptyMessage);

/// <summary>Which Segoe Fluent glyph an efficiency stat-card shows (web lucide <c>Zap</c> / <c>ShieldCheck</c>).</summary>
public enum CoachStatGlyph
{
    /// <summary>Web "Avg Efficiency" (lucide <c>Zap</c>).</summary>
    AvgEfficiency,

    /// <summary>Web "Best Efficiency" (lucide <c>ShieldCheck</c>).</summary>
    BestEfficiency,
}

/// <summary>One projected efficiency stat-card (web <c>StatCard</c>): a label, a value and a leading glyph.</summary>
public sealed record CoachEfficiencyStatDisplay(
    string Label,
    string Value,
    CoachStatGlyph Glyph,
    string AutomationName);

/// <summary>One projected weekly-trend point bound to the line chart.</summary>
public sealed record CoachWeeklyTrendPointDisplay(string Week, double Score);

/// <summary>The projected weekly trend — the chart points (web needs &gt;1), the series name and empty copy.</summary>
public sealed record CoachWeeklyTrendDisplay(
    bool HasData,
    IReadOnlyList<CoachWeeklyTrendPointDisplay> Points,
    string SeriesName,
    string EmptyMessage);

/// <summary>One projected pattern indicator (web label + coloured percentage + threshold bar).</summary>
public sealed record CoachPatternDisplay(
    string Label,
    string ValueText,
    double Fraction,
    StatusKind Status,
    string AutomationName);

/// <summary>One projected recommendation (web impact <c>Badge</c> + tip text).</summary>
public sealed record CoachRecommendationDisplay(
    StatusKind ImpactStatus,
    string ImpactText,
    string Tip,
    string AutomationName);

/// <summary>One projected per-drive row (web <c>DataTable</c> row with Score / Style badges).</summary>
public sealed record CoachDriveRowDisplay(
    object Key,
    string DateText,
    string ScoreText,
    StatusKind ScoreStatus,
    string StyleText,
    StatusKind StyleStatus,
    string EfficiencyText,
    string DistanceText,
    string AutomationName);

/// <summary>The projected per-drive scores table — its localized headers, rows and empty copy.</summary>
public sealed record CoachPerDriveDisplay(
    bool HasData,
    IReadOnlyList<string> Headers,
    IReadOnlyList<CoachDriveRowDisplay> Rows,
    string EmptyMessage);

/// <summary>
/// The fully projected, render-ready view of the whole section — the native analogue of what the web
/// <c>DrivingCoachSection</c> renders: the score gauge, the style breakdown, the two efficiency stat-cards, the
/// weekly trend chart, the five pattern indicators, the recommendations list, and the per-drive scores table,
/// each with its own friendly empty surface, plus the section freshness chip and the loading / empty / error
/// copy. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DrivingCoachSectionDisplay(
    DrivingCoachSectionState State,
    string Title,
    CoachScoreDisplay Score,
    string StyleBreakdownTitle,
    CoachStyleBreakdownDisplay StyleBreakdown,
    IReadOnlyList<CoachEfficiencyStatDisplay> EfficiencyStats,
    string WeeklyTrendTitle,
    CoachWeeklyTrendDisplay WeeklyTrend,
    string PatternsTitle,
    IReadOnlyList<CoachPatternDisplay> Patterns,
    string RecommendationsTitle,
    bool HasRecommendations,
    IReadOnlyList<CoachRecommendationDisplay> Recommendations,
    string RecommendationsEmptyMessage,
    string PerDriveTitle,
    CoachPerDriveDisplay PerDrive,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DrivingCoachSectionModel"/> to its
/// <see cref="DrivingCoachSectionDisplay"/> — the native port of
/// web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx. Branch precedence mirrors the
/// web parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no
/// analysed drives collapses to a friendly empty state, while a stale / offline snapshot keeps its cached
/// content under a freshness chip. Every numeric string is produced by <see cref="NumberFormatting"/> (the 1:1
/// port of the web <c>fmtNumber</c>, default two fraction digits; scores integer), the band / style / impact
/// colours reproduce the web <c>Badge</c> thresholds verbatim, and every label resolves through the i18n
/// facade using the same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a host.
/// </summary>
public static class DrivingCoachSectionProjection
{
    /// <summary>Score at or above which the gauge / badge reads "good" (web <c>score &gt;= 75</c>).</summary>
    public const double GoodScoreThreshold = 75;

    /// <summary>Score at or above which the gauge / badge reads "warning" (web <c>score &gt;= 50</c>).</summary>
    public const double WarningScoreThreshold = 50;

    /// <summary>The web default <c>fmtNumber</c> precision (global precision initial value).</summary>
    private const int ValueDecimals = 2;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>coachData</c> prop + lifecycle status).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static DrivingCoachSectionDisplay Project(DrivingCoachSectionModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DrivingCoachSectionState state = SelectState(model);
        DrivingCoachData data = model.Data;

        string title = localizer.GetString("dynamics.coach.title", "Driving Coach");
        CoachScoreDisplay score = BuildScore(data, localizer);
        string styleBreakdownTitle = localizer.GetString("dynamics.coach.styleBreakdown", "Style Breakdown");
        CoachStyleBreakdownDisplay styleBreakdown = BuildStyleBreakdown(data, localizer);
        IReadOnlyList<CoachEfficiencyStatDisplay> efficiency = BuildEfficiency(data, localizer);
        string weeklyTrendTitle = localizer.GetString("dynamics.coach.weeklyTrend", "Weekly Score Trend");
        CoachWeeklyTrendDisplay weeklyTrend = BuildWeeklyTrend(data, localizer);
        string patternsTitle = localizer.GetString("dynamics.coach.patterns", "Driving Patterns");
        var patterns = BuildPatterns(data.Patterns, localizer);
        string recommendationsTitle = localizer.GetString("dynamics.coach.recommendations", "Recommendations");
        var recommendations = BuildRecommendations(data, localizer);
        string recommendationsEmpty =
            localizer.GetString("dynamics.coach.noRecs", "Recommendations will appear after more drives.");
        string perDriveTitle = localizer.GetString("dynamics.coach.perDriveScores", "Per-Drive Scores");
        CoachPerDriveDisplay perDrive = BuildPerDrive(data, localizer);

        bool showChip = state is DrivingCoachSectionState.Stale or DrivingCoachSectionState.Offline;
        string chipText = state switch
        {
            DrivingCoachSectionState.Offline => localizer.GetString("common.offline", "Offline"),
            DrivingCoachSectionState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == DrivingCoachSectionState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage =
            localizer.GetString("dynamics.coach.noDrives", "Drive data will appear after your first trip.");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString("dynamics.coach.errorTitle", "Couldn't load driving coach");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "dynamics.coach.errorMessage",
                "We couldn't load your driving coach data. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state,
            title,
            showChip,
            chipText,
            score,
            styleBreakdownTitle,
            weeklyTrendTitle,
            patternsTitle,
            recommendationsTitle,
            perDriveTitle,
            emptyMessage,
            loadingLabel,
            errorTitle);

        return new DrivingCoachSectionDisplay(
            State: state,
            Title: title,
            Score: score,
            StyleBreakdownTitle: styleBreakdownTitle,
            StyleBreakdown: styleBreakdown,
            EfficiencyStats: efficiency,
            WeeklyTrendTitle: weeklyTrendTitle,
            WeeklyTrend: weeklyTrend,
            PatternsTitle: patternsTitle,
            Patterns: patterns,
            RecommendationsTitle: recommendationsTitle,
            HasRecommendations: recommendations.Count > 0,
            Recommendations: recommendations,
            RecommendationsEmptyMessage: recommendationsEmpty,
            PerDriveTitle: perDriveTitle,
            PerDrive: perDrive,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>Maps a 0..100 score onto the web <c>Badge</c> colour threshold (≥75 / ≥50 / else).</summary>
    public static StatusKind ScoreBand(double score) => score >= GoodScoreThreshold
        ? StatusKind.Success
        : score >= WarningScoreThreshold
            ? StatusKind.Warning
            : StatusKind.Danger;

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with no analysed drives has no
    // coaching story to tell and collapses to the friendly empty state, while a stale / offline snapshot keeps
    // its cached content under a chip.
    private static DrivingCoachSectionState SelectState(DrivingCoachSectionModel model) => model.Status switch
    {
        DrivingCoachSectionState.Loading => DrivingCoachSectionState.Loading,
        DrivingCoachSectionState.Error => DrivingCoachSectionState.Error,
        DrivingCoachSectionState.Empty => DrivingCoachSectionState.Empty,
        DrivingCoachSectionState.Stale => DrivingCoachSectionState.Stale,
        DrivingCoachSectionState.Offline => DrivingCoachSectionState.Offline,
        _ => model.Data.TotalDrivesAnalyzed > 0 ? DrivingCoachSectionState.Ready : DrivingCoachSectionState.Empty,
    };

    private static CoachScoreDisplay BuildScore(DrivingCoachData data, ILocalizer localizer)
    {
        string label = localizer.GetString("dynamics.coach.overallScore", "Driving Score");
        string valueText = Num(data.OverallScore, 0);
        string drivesFormat = localizer.GetString("dynamics.coach.drivesAnalyzed", "{0} drives analyzed");
        string drivesAnalyzed = string.Format(
            CultureInfo.CurrentCulture, drivesFormat, Num(data.TotalDrivesAnalyzed, 0));
        StatusKind band = ScoreBand(data.OverallScore);
        string automation = $"{label}, {valueText}. {drivesAnalyzed}";
        return new CoachScoreDisplay(data.OverallScore, label, valueText, drivesAnalyzed, band, automation);
    }

    private static CoachStyleBreakdownDisplay BuildStyleBreakdown(DrivingCoachData data, ILocalizer localizer)
    {
        // web: coachData && coachData.total_drives_analyzed > 0 ? (bar + legend) : EmptyState.
        long total = data.TotalDrivesAnalyzed;
        bool hasData = total > 0;
        var styles = new (string Key, int Count, StatusKind Status)[]
        {
            ("efficient", data.StyleBreakdown.Efficient, StatusKind.Success),
            ("moderate", data.StyleBreakdown.Moderate, StatusKind.Warning),
            ("aggressive", data.StyleBreakdown.Aggressive, StatusKind.Danger),
        };

        var segments = new List<CoachStyleSegmentDisplay>();
        var legend = new List<CoachStyleLegendDisplay>();
        foreach (var (key, count, status) in styles)
        {
            // web: pct = (count / total) * 100; segments with pct <= 0 are not rendered.
            double fraction = hasData ? (double)count / total : 0;
            if (fraction > 0)
            {
                segments.Add(new CoachStyleSegmentDisplay(key, status, fraction, count));
            }

            legend.Add(new CoachStyleLegendDisplay(key, StyleLabel(localizer, key), status, Num(count, 0)));
        }

        string emptyMessage = localizer.GetString("dynamics.coach.noData", "Drive more to see your style breakdown.");
        return new CoachStyleBreakdownDisplay(hasData, segments, legend, emptyMessage);
    }

    private static IReadOnlyList<CoachEfficiencyStatDisplay> BuildEfficiency(DrivingCoachData data, ILocalizer localizer)
    {
        string avgLabel = localizer.GetString("dynamics.coach.avgEfficiency", "Avg Efficiency");
        string bestLabel = localizer.GetString("dynamics.coach.bestEfficiency", "Best Efficiency");
        string unit = localizer.GetString("units.whkm", "Wh/km");
        string avgValue = $"{Num(data.EfficiencyWhKm, ValueDecimals)} {unit}";
        string bestValue = $"{Num(data.BestEfficiencyWhKm, ValueDecimals)} {unit}";

        return
        [
            new CoachEfficiencyStatDisplay(avgLabel, avgValue, CoachStatGlyph.AvgEfficiency, $"{avgLabel}, {avgValue}"),
            new CoachEfficiencyStatDisplay(bestLabel, bestValue, CoachStatGlyph.BestEfficiency, $"{bestLabel}, {bestValue}"),
        ];
    }

    private static CoachWeeklyTrendDisplay BuildWeeklyTrend(DrivingCoachData data, ILocalizer localizer)
    {
        // web: (weekly_trend ?? []).length > 1 ? chart : EmptyState(needWeeks).
        var points = new List<CoachWeeklyTrendPointDisplay>(data.WeeklyTrend.Count);
        foreach (CoachWeeklyPoint point in data.WeeklyTrend)
        {
            points.Add(new CoachWeeklyTrendPointDisplay(point.Week ?? string.Empty, point.Score));
        }

        bool hasData = points.Count > 1;
        string seriesName = localizer.GetString("Score", "Score");
        string emptyMessage = localizer.GetString(
            "dynamics.coach.needWeeks", "Need at least 2 weeks of data for trend analysis.");
        return new CoachWeeklyTrendDisplay(hasData, points, seriesName, emptyMessage);
    }

    private static List<CoachPatternDisplay> BuildPatterns(CoachPatterns patterns, ILocalizer localizer)
    {
        var defs = new (string Key, string Fallback, double Value, double Lo, double Hi)[]
        {
            ("dynamics.coach.hardAccel", "Hard Acceleration", patterns.HardAccelPct, 20, 40),
            ("dynamics.coach.hardBrake", "Hard Braking", patterns.HardBrakePct, 15, 30),
            ("dynamics.coach.highway", "Highway Driving", patterns.HighwayPct, 50, 70),
            ("dynamics.coach.shortTrips", "Short Trips (<5 km)", patterns.ShortTripPct, 30, 50),
            ("dynamics.coach.coldStarts", "Cold Starts", patterns.ColdStartPct, 15, 30),
        };

        var result = new List<CoachPatternDisplay>(defs.Length);
        foreach (var (key, fallback, value, lo, hi) in defs)
        {
            string label = localizer.GetString(key, fallback);
            string valueText = $"{Num(value, ValueDecimals)}%";
            double fraction = Math.Clamp(value, 0, 100) / 100.0;
            StatusKind status = value <= lo
                ? StatusKind.Success
                : value <= hi ? StatusKind.Warning : StatusKind.Danger;
            result.Add(new CoachPatternDisplay(label, valueText, fraction, status, $"{label}, {valueText}"));
        }

        return result;
    }

    private static List<CoachRecommendationDisplay> BuildRecommendations(
        DrivingCoachData data, ILocalizer localizer)
    {
        var result = new List<CoachRecommendationDisplay>(data.Recommendations.Count);
        foreach (CoachRecommendationItem rec in data.Recommendations)
        {
            string impact = rec.Impact ?? string.Empty;
            StatusKind status = ImpactStatus(impact);
            string impactText = localizer.GetString($"dynamics.coach.impact.{impact.ToLowerInvariant()}", impact);
            string tip = rec.Tip ?? string.Empty;
            result.Add(new CoachRecommendationDisplay(status, impactText, tip, $"{impactText}. {tip}"));
        }

        return result;
    }

    private static CoachPerDriveDisplay BuildPerDrive(DrivingCoachData data, ILocalizer localizer)
    {
        // web: (per_drive_scores ?? []).length > 0 ? DataTable : EmptyState(noDrives).
        string scoreHeader = localizer.GetString("Score", "Score");
        IReadOnlyList<string> headers =
        [
            localizer.GetString("Date", "Date"),
            scoreHeader,
            localizer.GetString("Style", "Style"),
            localizer.GetString("units.whkm", "Wh/km"),
            localizer.GetString("Distance", "Distance"),
        ];

        var rows = new List<CoachDriveRowDisplay>(data.PerDriveScores.Count);
        foreach (CoachDriveScore drive in data.PerDriveScores)
        {
            string dateText = FormatDateShort(drive.Date);
            string scoreText = Num(drive.Score, 0);
            StatusKind scoreStatus = ScoreBand(drive.Score);
            string styleText = StyleLabel(localizer, drive.Style);
            StatusKind styleStatus = StyleStatus(drive.Style);
            string efficiencyText = Num(drive.Efficiency, ValueDecimals);
            string distanceText = $"{Num(drive.Distance, ValueDecimals)} km";
            string automation =
                $"{dateText}, {scoreHeader} {scoreText}, {styleText}, {efficiencyText}, {distanceText}";
            rows.Add(new CoachDriveRowDisplay(
                drive.DriveId,
                dateText,
                scoreText,
                scoreStatus,
                styleText,
                styleStatus,
                efficiencyText,
                distanceText,
                automation));
        }

        string emptyMessage =
            localizer.GetString("dynamics.coach.noDrives", "Drive data will appear after your first trip.");
        return new CoachPerDriveDisplay(rows.Count > 0, headers, rows, emptyMessage);
    }

    // web Badge variant: style === 'efficient' ? success : style === 'moderate' ? warning : danger.
    private static StatusKind StyleStatus(string? style) => Normalize(style) switch
    {
        "efficient" => StatusKind.Success,
        "moderate" => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    // web Badge variant: impact === 'high' ? danger : impact === 'medium' ? warning : success.
    private static StatusKind ImpactStatus(string? impact) => Normalize(impact) switch
    {
        "high" => StatusKind.Danger,
        "medium" => StatusKind.Warning,
        _ => StatusKind.Success,
    };

    private static string StyleLabel(ILocalizer localizer, string? style)
    {
        string key = Normalize(style);
        string fallback = key.Length == 0
            ? "\u2014"
            : char.ToUpperInvariant(key[0]) + key[1..];
        return localizer.GetString($"dynamics.coach.style.{key}", fallback);
    }

    private static string Normalize(string? value) =>
        (value ?? string.Empty).Trim().ToLowerInvariant();

    // web formatDateShort: { month: 'short', day: 'numeric' } (e.g. "Apr 4"); null -> em dash.
    private static string FormatDateShort(DateTimeOffset? date) =>
        date is { } value
            ? value.UtcDateTime.ToString("MMM d", CultureInfo.InvariantCulture)
            : "\u2014";

    private static string Num(double value, int decimals) => NumberFormatting.Format(value, null, decimals);

    private static string BuildAutomationName(
        DrivingCoachSectionState state,
        string title,
        bool showChip,
        string chipText,
        CoachScoreDisplay score,
        string styleBreakdownTitle,
        string weeklyTrendTitle,
        string patternsTitle,
        string recommendationsTitle,
        string perDriveTitle,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case DrivingCoachSectionState.Loading:
                return $"{title}. {loadingLabel}";
            case DrivingCoachSectionState.Empty:
                return $"{title}. {emptyMessage}";
            case DrivingCoachSectionState.Error:
                return $"{title}. {errorTitle}";
            default:
                var parts = new List<string> { title };
                if (showChip)
                {
                    parts.Add(chipText);
                }

                parts.Add(score.AutomationName);
                parts.Add(styleBreakdownTitle);
                parts.Add(weeklyTrendTitle);
                parts.Add(patternsTitle);
                parts.Add(recommendationsTitle);
                parts.Add(perDriveTitle);
                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DrivingCoachSection</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a score, efficiency, distance, drive
/// id or style — so a diagnostics line can never leak a user's driving behaviour. Thread-safe.
/// </summary>
public sealed class DrivingCoachSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DrivingCoachSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DrivingCoachSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DrivingCoachSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>DrivingCoachSection</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx</c>.
/// </summary>
public static class DrivingCoachSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DrivingCoachSection";
}
