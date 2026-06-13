using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>A category breakdown panel (efficiency / smoothness / speed): gauge + animated value + bar + inline metric.</summary>
public sealed record CategoryGaugeDisplay(
    string Label,
    double Value,
    double Max,
    int ColorIndex,
    string AccentBrushKey,
    string MaxText,
    string MetricLabel,
    string MetricValue,
    string MetricGlyph);

/// <summary>A named chart series projected to Core <see cref="ChartPoint"/> rows (UI-free; the view wraps it in a ChartSeries).</summary>
public sealed record SeriesDisplay(string Name, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>The Best/Worst drive summary card (web sections 6b).</summary>
public sealed record BestWorstDisplay(
    string Title,
    string Glyph,
    bool Has,
    string DateText,
    string Grade,
    StatusKind GradeStatus,
    double Score,
    int ScoreColorIndex,
    string DistanceText,
    string DurationText,
    string ConsumptionText,
    string TipText,
    StatusKind TipStatus,
    string NoDataText,
    string DistanceLabel,
    string DurationLabel,
    string ConsumptionLabel);

/// <summary>One drive-history row.</summary>
public sealed record DriveRowDisplay(
    long Id,
    string Date,
    string Route,
    string Distance,
    string Duration,
    string Consumption,
    string ScoreText,
    StatusKind ScoreStatus,
    string Grade,
    StatusKind GradeStatus,
    string Breakdown);

/// <summary>A headline stat tile (web section 8).</summary>
public sealed record StatCardDisplay(string Label, string Value, string Glyph, string Sublabel);

/// <summary>A weekly / monthly period tile (web section 9).</summary>
public sealed record PeriodPanelDisplay(
    string Label,
    string Value,
    StatusKind ValueStatus,
    bool HasDelta,
    string DeltaText,
    bool DeltaPositive,
    string SubText);

/// <summary>An achievement badge (web section 10).</summary>
public sealed record AchievementDisplay(string Label, string Description, bool Unlocked, string Glyph, string UnlockedText);

/// <summary>One key/value row in a summary card.</summary>
public sealed record KvRow(string Label, string Value);

/// <summary>A key/value summary card (web Score Breakdown / Period Statistics).</summary>
public sealed record KvCardDisplay(string Title, IReadOnlyList<KvRow> Rows);

/// <summary>
/// The fully projected, render-ready content the <c>DriveScorePage</c> view binds to. Every label is localized,
/// every value formatted at the SI→display boundary, and every section carries its own data so a region is
/// never blank. No WinUI types — unit-testable without a UI host.
/// </summary>
public sealed record DriveScoreDisplay(
    DriveScoreState State,
    string Title,
    string Subtitle,
    string AutomationName,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowError,
    bool ShowContent,
    string EmptyTitle,
    string EmptyMessage,
    string ErrorText,
    string RetryLabel,
    // Hero overall gauge
    double OverallScore,
    int OverallColorIndex,
    string OverallLabel,
    string OverallTrendLabel,
    StatusKind TrendStatus,
    string TrendGlyph,
    string BasedOnText,
    bool HasBasedOn,
    string HelpAria,
    // Grade badge
    string GradeText,
    StatusKind GradeStatus,
    string GradeLabelText,
    string DrivesInPeriodText,
    // Category breakdown
    IReadOnlyList<CategoryGaugeDisplay> Categories,
    // Trend chart
    string TrendTitle,
    string TrendAria,
    bool TrendHasData,
    IReadOnlyList<SeriesDisplay> TrendSeries,
    double GradeLineValue,
    string GradeLineLabel,
    // Category bar chart
    string CategoryTitle,
    string CategoryAria,
    IReadOnlyList<SeriesDisplay> CategorySeries,
    // Score distribution histogram
    string DistributionTitle,
    string DistributionAria,
    IReadOnlyList<SeriesDisplay> DistributionSeries,
    // Tips
    string TipsTitle,
    string TipsSubtitle,
    IReadOnlyList<string> Tips,
    // Best / worst
    BestWorstDisplay Best,
    BestWorstDisplay Worst,
    // Drive history
    string HistoryTitle,
    IReadOnlyList<string> HistoryHeaders,
    IReadOnlyList<DriveRowDisplay> HistoryRows,
    string HistoryEmptyText,
    int Page,
    int PageSize,
    int TotalRows,
    bool ShowPagination,
    string PaginationSummaryFormat,
    // Stat cards
    IReadOnlyList<StatCardDisplay> StatCards,
    // Period stats
    bool HasPeriodStats,
    IReadOnlyList<PeriodPanelDisplay> PeriodPanels,
    string NoPeriodStatsText,
    // Achievements
    string AchievementsTitle,
    IReadOnlyList<AchievementDisplay> Achievements,
    // KV cards
    KvCardDisplay ScoreBreakdown,
    KvCardDisplay PeriodStatistics);

/// <summary>
/// Every visible literal the <c>DriveScorePage</c> resolves through the i18n facade (web <c>t(...)</c>), keyed
/// verbatim to the web key names so the Strings/*.resw <c>translation.driveScore.*</c> catalog and the web
/// <c>en.json</c> stay in lock-step. Resolved once per projection.
/// </summary>
public sealed class DriveScoreStrings
{
    public string Title { get; private init; } = string.Empty;
    public string Subtitle { get; private init; } = string.Empty;
    public string Overall { get; private init; } = string.Empty;
    public string Efficiency { get; private init; } = string.Empty;
    public string Smoothness { get; private init; } = string.Empty;
    public string SpeedDiscipline { get; private init; } = string.Empty;
    public string EmptyTitle { get; private init; } = string.Empty;
    public string Empty { get; private init; } = string.Empty;
    public string NoData { get; private init; } = string.Empty;
    public string TrendUp { get; private init; } = string.Empty;
    public string TrendDown { get; private init; } = string.Empty;
    public string TrendFlat { get; private init; } = string.Empty;
    public string BasedOn { get; private init; } = string.Empty;
    public string GradeLabel { get; private init; } = string.Empty;
    public string DrivesInPeriod { get; private init; } = string.Empty;
    public string AvgConsumption { get; private init; } = string.Empty;
    public string PowerRange { get; private init; } = string.Empty;
    public string AvgMaxSpeed { get; private init; } = string.Empty;
    public string ScoreTrend { get; private init; } = string.Empty;
    public string ScoreTrendAria { get; private init; } = string.Empty;
    public string TotalScore { get; private init; } = string.Empty;
    public string GradeALine { get; private init; } = string.Empty;
    public string CategoryBreakdown { get; private init; } = string.Empty;
    public string CategoryBreakdownAria { get; private init; } = string.Empty;
    public string ScoreDistribution { get; private init; } = string.Empty;
    public string ScoreDistributionAria { get; private init; } = string.Empty;
    public string Drives { get; private init; } = string.Empty;
    public string ColCategory { get; private init; } = string.Empty;
    public string ColValue { get; private init; } = string.Empty;
    public string ColMax { get; private init; } = string.Empty;
    public string ColDate { get; private init; } = string.Empty;
    public string ColScore { get; private init; } = string.Empty;
    public string ColEfficiency { get; private init; } = string.Empty;
    public string ColSmoothness { get; private init; } = string.Empty;
    public string ColSpeed { get; private init; } = string.Empty;
    public string ColRange { get; private init; } = string.Empty;
    public string ColDrives { get; private init; } = string.Empty;
    public string TipsTitle { get; private init; } = string.Empty;
    public string TipsSubtitle { get; private init; } = string.Empty;
    public string BestDrive { get; private init; } = string.Empty;
    public string WorstDrive { get; private init; } = string.Empty;
    public string Score { get; private init; } = string.Empty;
    public string Distance { get; private init; } = string.Empty;
    public string DurationLabel { get; private init; } = string.Empty;
    public string Consumption { get; private init; } = string.Empty;
    public string TipBestEff { get; private init; } = string.Empty;
    public string TipBestSmooth { get; private init; } = string.Empty;
    public string TipBestSpeed { get; private init; } = string.Empty;
    public string TipWorstEff { get; private init; } = string.Empty;
    public string TipWorstSmooth { get; private init; } = string.Empty;
    public string TipWorstSpeed { get; private init; } = string.Empty;
    public string NoDrives { get; private init; } = string.Empty;
    public string DriveHistory { get; private init; } = string.Empty;
    public string UnknownRoute { get; private init; } = string.Empty;
    public string ColDateHeader { get; private init; } = string.Empty;
    public string ColRoute { get; private init; } = string.Empty;
    public string ColDistance { get; private init; } = string.Empty;
    public string ColDuration { get; private init; } = string.Empty;
    public string ColConsumption { get; private init; } = string.Empty;
    public string ColScoreHeader { get; private init; } = string.Empty;
    public string ColGrade { get; private init; } = string.Empty;
    public string ColEffHeader { get; private init; } = string.Empty;
    public string AvgScore { get; private init; } = string.Empty;
    public string BestScore { get; private init; } = string.Empty;
    public string TotalDrivesLabel { get; private init; } = string.Empty;
    public string AvgEffLabel { get; private init; } = string.Empty;
    public string ThisWeek { get; private init; } = string.Empty;
    public string ThisMonth { get; private init; } = string.Empty;
    public string BestWeek { get; private init; } = string.Empty;
    public string BestMonth { get; private init; } = string.Empty;
    public string DrivesScored { get; private init; } = string.Empty;
    public string RatedAPlus { get; private init; } = string.Empty;
    public string OfDrives { get; private init; } = string.Empty;
    public string VsLastWeek { get; private init; } = string.Empty;
    public string VsLastMonth { get; private init; } = string.Empty;
    public string NoPeriodStats { get; private init; } = string.Empty;
    public string AchievementsTitle { get; private init; } = string.Empty;
    public string Unlocked { get; private init; } = string.Empty;
    public string Breakdown { get; private init; } = string.Empty;
    public string PeriodStats { get; private init; } = string.Empty;
    public string EfficiencyLabel { get; private init; } = string.Empty;
    public string SmoothnessLabel { get; private init; } = string.Empty;
    public string SpeedLabel { get; private init; } = string.Empty;
    public string TotalLabel { get; private init; } = string.Empty;
    public string TotalDistance { get; private init; } = string.Empty;
    public string TotalDuration { get; private init; } = string.Empty;
    public string AvgDistance { get; private init; } = string.Empty;
    public string AvgDuration { get; private init; } = string.Empty;
    public string HighestSpeed { get; private init; } = string.Empty;
    public string APlusCount { get; private init; } = string.Empty;
    public string HelpIconLabel { get; private init; } = string.Empty;
    public string RetryLabel { get; private init; } = string.Empty;
    public string ErrorTitle { get; private init; } = string.Empty;

    // Achievements (labels + descriptions).
    public string AchFirstDrive { get; private init; } = string.Empty;
    public string AchFirstDriveDesc { get; private init; } = string.Empty;
    public string AchTenDrives { get; private init; } = string.Empty;
    public string AchTenDrivesDesc { get; private init; } = string.Empty;
    public string AchFiftyDrives { get; private init; } = string.Empty;
    public string AchFiftyDrivesDesc { get; private init; } = string.Empty;
    public string AchPerfectScore { get; private init; } = string.Empty;
    public string AchPerfectScoreDesc { get; private init; } = string.Empty;
    public string AchAPlusStreak { get; private init; } = string.Empty;
    public string AchAPlusStreakDesc { get; private init; } = string.Empty;
    public string AchEfficiencyMaster { get; private init; } = string.Empty;
    public string AchEfficiencyMasterDesc { get; private init; } = string.Empty;
    public string AchSmoothOperator { get; private init; } = string.Empty;
    public string AchSmoothOperatorDesc { get; private init; } = string.Empty;
    public string AchSpeedSaint { get; private init; } = string.Empty;
    public string AchSpeedSaintDesc { get; private init; } = string.Empty;

    // Tips.
    public string TipPreCondition { get; private init; } = string.Empty;
    public string TipCoastMore { get; private init; } = string.Empty;
    public string TipTirePressure { get; private init; } = string.Empty;
    public string TipSmoothAccel { get; private init; } = string.Empty;
    public string TipRegenBraking { get; private init; } = string.Empty;
    public string TipFollowDistance { get; private init; } = string.Empty;
    public string TipSpeedLimit { get; private init; } = string.Empty;
    public string TipCruiseControl { get; private init; } = string.Empty;
    public string TipRoutePlanning { get; private init; } = string.Empty;

    /// <summary>Resolve every label once through the localizer (verbatim web keys + English defaults).</summary>
    public static DriveScoreStrings Resolve(ILocalizer l)
    {
        ArgumentNullException.ThrowIfNull(l);
        string G(string key, string fallback) => l.GetString(key, fallback);
        return new DriveScoreStrings
        {
            Title = G("driveScore.title", "Drive Score"),
            Subtitle = G("driveScore.subtitle", "Your driving rating and breakdown"),
            Overall = G("driveScore.overall", "Overall Score"),
            Efficiency = G("driveScore.efficiency", "Efficiency"),
            Smoothness = G("driveScore.smoothness", "Smoothness"),
            SpeedDiscipline = G("driveScore.speedDiscipline", "Speed Discipline"),
            EmptyTitle = G("driveScore.emptyTitle", "No Scored Drives"),
            Empty = G("driveScore.empty", "Not enough drives in the selected period to calculate a score."),
            NoData = G("common.noData", "No data available"),
            TrendUp = G("driveScore.trendUp", "Improving"),
            TrendDown = G("driveScore.trendDown", "Declining"),
            TrendFlat = G("driveScore.trendFlat", "Stable"),
            BasedOn = G("driveScore.basedOn", "Based on {{count}} drives"),
            GradeLabel = G("driveScore.gradeLabel", "Grade: {{grade}}"),
            DrivesInPeriod = G("driveScore.drivesInPeriod", "{{count}} drives in period"),
            AvgConsumption = G("driveScore.avgConsumption", "Avg consumption"),
            PowerRange = G("driveScore.powerRange", "Power range"),
            AvgMaxSpeed = G("driveScore.avgMaxSpeed", "Avg max speed"),
            ScoreTrend = G("driveScore.scoreTrend", "Score Trend"),
            ScoreTrendAria = G("driveScore.scoreTrend.aria", "Drive score trend line chart with category breakdowns"),
            TotalScore = G("driveScore.totalScore", "Total Score"),
            GradeALine = G("driveScore.gradeALine", "A"),
            CategoryBreakdown = G("driveScore.categoryBreakdown", "Category Breakdown"),
            CategoryBreakdownAria = G("driveScore.categoryBreakdown.aria", "Drive score category breakdown horizontal bar chart"),
            ScoreDistribution = G("driveScore.scoreDistribution", "Score Distribution"),
            ScoreDistributionAria = G("driveScore.scoreDistribution.aria", "Drive score distribution histogram bar chart"),
            Drives = G("driveScore.drives", "Drives"),
            ColCategory = G("driveScore.col.category", "Category"),
            ColValue = G("driveScore.col.value", "Value"),
            ColMax = G("driveScore.col.max", "Max"),
            ColDate = G("driveScore.col.date", "Date"),
            ColScore = G("driveScore.col.score", "Score"),
            ColEfficiency = G("driveScore.col.efficiency", "Efficiency"),
            ColSmoothness = G("driveScore.col.smoothness", "Smoothness"),
            ColSpeed = G("driveScore.col.speed", "Speed"),
            ColRange = G("driveScore.col.range", "Score range"),
            ColDrives = G("driveScore.col.drives", "Drives"),
            TipsTitle = G("driveScore.tipsTitle", "Improvement Tips"),
            TipsSubtitle = G("driveScore.tipsSubtitle", "Based on your weakest category: {{category}}"),
            BestDrive = G("driveScore.bestDrive", "Best Drive"),
            WorstDrive = G("driveScore.worstDrive", "Worst Drive"),
            Score = G("driveScore.score", "Score"),
            Distance = G("driveScore.distance", "Distance"),
            DurationLabel = G("driveScore.durationLabel", "Duration"),
            Consumption = G("driveScore.consumption", "Consumption"),
            TipBestEff = G("driveScore.tipBestEff", "Outstanding energy efficiency — minimal energy wasted!"),
            TipBestSmooth = G("driveScore.tipBestSmooth", "Exceptionally smooth driving with controlled acceleration."),
            TipBestSpeed = G("driveScore.tipBestSpeed", "Great speed discipline, staying in the optimal range."),
            TipWorstEff = G("driveScore.tipWorstEff", "High energy consumption — possibly high speeds or cold weather."),
            TipWorstSmooth = G("driveScore.tipWorstSmooth", "Aggressive acceleration and braking detected."),
            TipWorstSpeed = G("driveScore.tipWorstSpeed", "Excessive highway speed reduced the overall score."),
            NoDrives = G("driveScore.noDrives", "No drives available"),
            DriveHistory = G("driveScore.driveHistory", "Drive History"),
            UnknownRoute = G("driveScore.unknownRoute", "Unknown"),
            ColDateHeader = G("driveScore.colDate", "Date"),
            ColRoute = G("driveScore.colRoute", "Route"),
            ColDistance = G("driveScore.colDistance", "Distance"),
            ColDuration = G("driveScore.colDuration", "Duration"),
            ColConsumption = G("driveScore.colConsumption", "Consumption"),
            ColScoreHeader = G("driveScore.colScore", "Score"),
            ColGrade = G("driveScore.colGrade", "Grade"),
            ColEffHeader = G("driveScore.colEfficiency", "Eff"),
            AvgScore = G("driveScore.avgScore", "Avg Score"),
            BestScore = G("driveScore.bestScore", "Best Score"),
            TotalDrivesLabel = G("driveScore.totalDrivesLabel", "Total Drives"),
            AvgEffLabel = G("driveScore.avgEffLabel", "Avg Efficiency"),
            ThisWeek = G("driveScore.thisWeek", "This Week"),
            ThisMonth = G("driveScore.thisMonth", "This Month"),
            BestWeek = G("driveScore.bestWeek", "Best Week"),
            BestMonth = G("driveScore.bestMonth", "Best Month"),
            DrivesScored = G("driveScore.drivesScored", "drives scored"),
            RatedAPlus = G("driveScore.ratedAPlus", "Rated A+/A"),
            OfDrives = G("driveScore.ofDrives", "of drives"),
            VsLastWeek = G("driveScore.vsLastWeek", "vs {{val}} last week"),
            VsLastMonth = G("driveScore.vsLastMonth", "vs {{val}} last month"),
            NoPeriodStats = G("driveScore.noPeriodStats", "No weekly/monthly averages available yet"),
            AchievementsTitle = G("driveScore.achievements.title", "Achievements"),
            Unlocked = G("driveScore.achievements.unlocked", "Unlocked"),
            Breakdown = G("driveScore.breakdown", "Score Breakdown"),
            PeriodStats = G("driveScore.periodStats", "Period Statistics"),
            EfficiencyLabel = G("driveScore.efficiencyLabel", "Efficiency (Wh/km)"),
            SmoothnessLabel = G("driveScore.smoothnessLabel", "Smoothness (power range)"),
            SpeedLabel = G("driveScore.speedLabel", "Speed Discipline"),
            TotalLabel = G("driveScore.totalLabel", "Total"),
            TotalDistance = G("driveScore.totalDistance", "Total Distance"),
            TotalDuration = G("driveScore.totalDuration", "Total Duration"),
            AvgDistance = G("driveScore.avgDistance", "Avg Distance/Drive"),
            AvgDuration = G("driveScore.avgDuration", "Avg Duration/Drive"),
            HighestSpeed = G("driveScore.highestSpeed", "Highest Max Speed"),
            APlusCount = G("driveScore.aPlusCount", "A+ Drives"),
            HelpIconLabel = G("help.driveScore.iconLabel", "More info about Drive Score"),
            RetryLabel = G("common.retry", "Retry"),
            ErrorTitle = G("error.loadFailed", "Failed to load data"),
            AchFirstDrive = G("driveScore.achievements.firstDrive", "First Drive"),
            AchFirstDriveDesc = G("driveScore.achievements.firstDriveDesc", "Complete your first scored drive."),
            AchTenDrives = G("driveScore.achievements.tenDrives", "Road Regular"),
            AchTenDrivesDesc = G("driveScore.achievements.tenDrivesDesc", "Complete 10 scored drives."),
            AchFiftyDrives = G("driveScore.achievements.fiftyDrives", "Highway Hero"),
            AchFiftyDrivesDesc = G("driveScore.achievements.fiftyDrivesDesc", "Complete 50 scored drives."),
            AchPerfectScore = G("driveScore.achievements.perfectScore", "Perfect Score"),
            AchPerfectScoreDesc = G("driveScore.achievements.perfectScoreDesc", "Achieve a 100/100 on any drive."),
            AchAPlusStreak = G("driveScore.achievements.aPlusStreak", "A+ Streak"),
            AchAPlusStreakDesc = G("driveScore.achievements.aPlusStreakDesc", "Get A+ grade on 5 consecutive drives."),
            AchEfficiencyMaster = G("driveScore.achievements.efficiencyMaster", "Efficiency Master"),
            AchEfficiencyMasterDesc = G("driveScore.achievements.efficiencyMasterDesc", "Score 38+ in efficiency on 3 drives."),
            AchSmoothOperator = G("driveScore.achievements.smoothOperator", "Smooth Operator"),
            AchSmoothOperatorDesc = G("driveScore.achievements.smoothOperatorDesc", "Score 28+ in smoothness on 3 drives."),
            AchSpeedSaint = G("driveScore.achievements.speedSaint", "Speed Saint"),
            AchSpeedSaintDesc = G("driveScore.achievements.speedSaintDesc", "Score 28+ in speed discipline on 5 drives."),
            TipPreCondition = G("driveScore.tips.preCondition", "Pre-condition your cabin while plugged in to reduce HVAC battery drain."),
            TipCoastMore = G("driveScore.tips.coastMore", "Coast more by lifting your foot earlier before stops."),
            TipTirePressure = G("driveScore.tips.tirePressure", "Keep tire pressure at recommended levels for better efficiency."),
            TipSmoothAccel = G("driveScore.tips.smoothAccel", "Accelerate gradually — aim for steady pedal pressure."),
            TipRegenBraking = G("driveScore.tips.regenBraking", "Use regenerative braking instead of the brake pedal when possible."),
            TipFollowDistance = G("driveScore.tips.followDistance", "Maintain a larger following distance to avoid sudden braking."),
            TipSpeedLimit = G("driveScore.tips.speedLimit", "Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h."),
            TipCruiseControl = G("driveScore.tips.cruiseControl", "Use Autopilot or cruise control on highways for consistent speed."),
            TipRoutePlanning = G("driveScore.tips.routePlanning", "Plan routes to avoid high-speed stretches when possible."),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="DriveScoreModel"/> to its <see cref="DriveScoreDisplay"/> — the native
/// port of web/src/features/driving/pages/DriveScorePage.tsx. It filters drives to the rolling window, scores
/// each one through <see cref="ScoreMath"/>, derives every aggregate the web page computes (averages, the trend
/// + category + distribution chart series, the best/worst drives, the score histogram, the weekly/monthly
/// period stats, the achievement checks and the two summary key/value lists), formats every value at the
/// SI→display boundary via the unit formatters, and resolves every label through the i18n facade. No WinUI
/// types — unit-testable without a UI host.
/// </summary>
public static class DriveScoreProjection
{
    /// <summary>Segoe Fluent — Speed/Speedometer (web <c>Icons.speed</c>; hero gauge + empty surface).</summary>
    public const string GaugeGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — Target (web <c>Icons.target</c>).</summary>
    public const string TargetGlyph = "\uE1D2";

    /// <summary>Segoe Fluent — Trophy (web <c>Icons.trophy</c>).</summary>
    public const string TrophyGlyph = "\uE735";

    /// <summary>Segoe Fluent — Star (web <c>Icons.star</c>).</summary>
    public const string StarGlyph = "\uE734";

    /// <summary>Segoe Fluent — Car (web <c>Icons.drive</c>).</summary>
    public const string DriveGlyph = "\uE804";

    /// <summary>Segoe Fluent — Lightning (web <c>Icons.charging</c>).</summary>
    public const string ChargingGlyph = "\uE945";

    /// <summary>Segoe Fluent — Lightbulb (web <c>Icons.lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    /// <summary>Segoe Fluent — Completed (web <c>Icons.securityCheck</c>).</summary>
    public const string CheckGlyph = "\uE73E";

    /// <summary>Segoe Fluent — Warning (web <c>Icons.severityWarn</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — Up (web trend up arrow).</summary>
    public const string TrendUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent — Down (web trend down arrow).</summary>
    public const string TrendDownGlyph = "\uE70D";

    /// <summary>Segoe Fluent — Remove/dash (web flat trend).</summary>
    public const string TrendFlatGlyph = "\uE738";

    /// <summary>Segoe Fluent — Efficiency (web <c>Icons.efficiency</c>).</summary>
    public const string EfficiencyGlyph = "\uEC4A";

    /// <summary>The default rolling drive window (web default range = last 30 days).</summary>
    public const int WindowDays = 30;

    /// <summary>Rows per page in the drive-history table (web <c>DRIVES_PER_PAGE</c>).</summary>
    public const int DrivesPerPage = 10;

    private const string EmDash = "\u2014";
    private const double MphPerMps = 2.2369362920544;
    private const int EfficiencyMax = 40;
    private const int SmoothnessMax = 30;
    private const int SpeedMax = 30;

    /// <summary>Project <paramref name="model"/> into a render-ready display in the active units + locale.</summary>
    /// <param name="model">The parsed drives + optional score plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic window / period maths in tests.</param>
    /// <param name="page">The 1-based drive-history page (clamped to range).</param>
    public static DriveScoreDisplay Project(
        DriveScoreModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now,
        int page = 1)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = DriveScoreStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var api = snapshot.Score;

        // ── Filter + score (web filteredDrives → scoredDrives) ──────────────────────────────────────────────
        DateTimeOffset windowStart = now.AddDays(-WindowDays);
        var scored = new List<ScoredDrive>(snapshot.Drives.Count);
        foreach (var d in snapshot.Drives)
        {
            if (d.StartTs >= windowStart && d.StartTs <= now)
            {
                scored.Add(new ScoredDrive(d, ScoreMath.ScoreDrive(d)));
            }
        }

        DriveScoreState state =
            model.Loading && !snapshot.HasData ? DriveScoreState.Loading
            : model.ErrorDetail is not null ? DriveScoreState.Error
            : scored.Count == 0 ? DriveScoreState.Empty
            : DriveScoreState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        // ── Unit / value formatting helpers (display boundary) ──────────────────────────────────────────────
        bool imperial = units.Distance == DistanceUnit.Mi;
        string effUnit = imperial ? "Wh/mi" : "Wh/km";
        double ToEff(double whPerKm) => imperial ? whPerKm * 1.609344 : whPerKm;
        string FmtEff(double whPerKm, int decimals) =>
            $"{NumberFormatting.Format(ToEff(whPerKm), units.Locale, decimals)} {effUnit}";
        string FmtDistance(double meters) => UnitFormatters.FormatDistance(meters, units);
        string FmtSpeed(double mps) => UnitFormatters.FormatSpeed(mps, units);
        string FmtDur(double seconds) => FormatDurationMinutes(seconds / 60.0);
        string FmtDate(DateTimeOffset ts) => DateTimeFormatting.Format(ts, DateTimeVariant.Short, now);

        var allScores = new List<ComputedScore>(scored.Count);
        foreach (var sd in scored)
        {
            allScores.Add(sd.Score);
        }

        // ── Averages (web avgScores) ────────────────────────────────────────────────────────────────────────
        var avg = AverageScores(allScores);
        double overallScore = api?.Overall ?? avg.Total;
        string overallGrade = api?.Grade ?? ScoreMath.GradeFromTotal(overallScore);
        string overallTrend = api?.Trend ?? "flat";

        double effVal = api?.Efficiency ?? avg.Efficiency;
        double smoothVal = api?.Smoothness ?? avg.Smoothness;
        double speedVal = api?.SpeedDiscipline ?? avg.Speed;

        (string trendLabel, StatusKind trendStatus, string trendGlyph) = overallTrend switch
        {
            "up" => (s.TrendUp, StatusKind.Success, TrendUpGlyph),
            "down" => (s.TrendDown, StatusKind.Danger, TrendDownGlyph),
            _ => (s.TrendFlat, StatusKind.Neutral, TrendFlatGlyph),
        };

        // ── Hero + grade ────────────────────────────────────────────────────────────────────────────────────
        string basedOnText = api is { TotalDrives: { } td } ? Interp(s.BasedOn, "count", td.ToString(CultureInfo.InvariantCulture)) : string.Empty;
        string gradeLabelText = Interp(s.GradeLabel, "grade", overallGrade);
        string drivesInPeriodText = Interp(s.DrivesInPeriod, "count", scored.Count.ToString(CultureInfo.InvariantCulture));

        // ── Category breakdown gauges ───────────────────────────────────────────────────────────────────────
        double avgWhPerKm = scored.Count > 0 ? scored.Average(x => x.Score.WhPerKm) : 0;
        double avgPowerKw = scored.Count > 0 ? scored.Average(x => (x.Drive.AvgPowerW ?? 30000) / 1000.0) : 0;
        double avgMaxSpeedMps = scored.Count > 0 ? scored.Average(x => x.Drive.MaxSpeedMps ?? 0) : 0;

        var categories = new List<CategoryGaugeDisplay>
        {
            new(s.Efficiency, effVal, EfficiencyMax, 1, ChartPalette.KeyForIndex(1), $"/{EfficiencyMax}",
                s.AvgConsumption, FmtEff(avgWhPerKm, 0), ChargingGlyph),
            new(s.Smoothness, smoothVal, SmoothnessMax, 0, ChartPalette.KeyForIndex(0), $"/{SmoothnessMax}",
                s.PowerRange, $"{NumberFormatting.Format(avgPowerKw, units.Locale, 2)} kW", EfficiencyGlyph),
            new(s.SpeedDiscipline, speedVal, SpeedMax, 5, ChartPalette.KeyForIndex(5), $"/{SpeedMax}",
                s.AvgMaxSpeed, FmtSpeed(avgMaxSpeedMps), GaugeGlyph),
        };

        // ── Trend chart (last 20 by time asc) ───────────────────────────────────────────────────────────────
        var recent = scored.OrderBy(x => x.Drive.StartTs).ToList();
        if (recent.Count > 20)
        {
            recent = recent.GetRange(recent.Count - 20, 20);
        }

        var scorePts = new List<ChartPoint>(recent.Count);
        var effPts = new List<ChartPoint>(recent.Count);
        var smoothPts = new List<ChartPoint>(recent.Count);
        var speedPts = new List<ChartPoint>(recent.Count);
        for (int i = 0; i < recent.Count; i++)
        {
            string label = FmtDate(recent[i].Drive.StartTs);
            scorePts.Add(new ChartPoint(i, recent[i].Score.Total, label));
            effPts.Add(new ChartPoint(i, recent[i].Score.Efficiency, label));
            smoothPts.Add(new ChartPoint(i, recent[i].Score.Smoothness, label));
            speedPts.Add(new ChartPoint(i, recent[i].Score.Speed, label));
        }

        var trendSeries = new List<SeriesDisplay>
        {
            new(s.TotalScore, ScoreMath.GradeColorIndex(overallGrade), scorePts),
            new(s.Efficiency, 1, effPts),
            new(s.Smoothness, 0, smoothPts),
            new(s.SpeedDiscipline, 5, speedPts),
        };

        // ── Category bar chart (value + max) ────────────────────────────────────────────────────────────────
        var catValuePts = new List<ChartPoint>
        {
            new(0, effVal, s.Efficiency),
            new(1, smoothVal, s.Smoothness),
            new(2, speedVal, s.SpeedDiscipline),
        };
        var catMaxPts = new List<ChartPoint>
        {
            new(0, EfficiencyMax, s.ColMax),
            new(1, SmoothnessMax, s.ColMax),
            new(2, SpeedMax, s.ColMax),
        };
        var categorySeries = new List<SeriesDisplay>
        {
            new(s.ColValue, 2, catValuePts),
            new(s.ColMax, 7, catMaxPts),
        };

        // ── Score distribution histogram ────────────────────────────────────────────────────────────────────
        var distributionSeries = new List<SeriesDisplay>
        {
            new(s.Drives, 0, BuildHistogram(allScores)),
        };

        // ── Tips (weakest category) ─────────────────────────────────────────────────────────────────────────
        string weakest = WeakestCategory(effVal, smoothVal, speedVal);
        string weakestLabel = weakest switch
        {
            "efficiency" => s.Efficiency,
            "smoothness" => s.Smoothness,
            _ => s.SpeedDiscipline,
        };
        var tips = BuildTips(weakest, s);

        // ── Best / worst drives ─────────────────────────────────────────────────────────────────────────────
        ScoredDrive? best = scored.Count > 0 ? scored.OrderByDescending(x => x.Score.Total).First() : null;
        ScoredDrive? worst = scored.Count > 0 ? scored.OrderBy(x => x.Score.Total).First() : null;
        var bestDisplay = BuildBestWorst(best, true, s, FmtDistance, FmtDur, FmtEff);
        var worstDisplay = BuildBestWorst(worst, false, s, FmtDistance, FmtDur, FmtEff);

        // ── Drive history (date desc) + pagination ──────────────────────────────────────────────────────────
        var sortedForTable = scored.OrderByDescending(x => x.Drive.StartTs).ToList();
        int totalPages = Math.Max(1, (int)Math.Ceiling(sortedForTable.Count / (double)DrivesPerPage));
        int clampedPage = Math.Clamp(page, 1, totalPages);
        var pageRows = sortedForTable
            .Skip((clampedPage - 1) * DrivesPerPage)
            .Take(DrivesPerPage)
            .Select(x => BuildRow(x, s, FmtDistance, FmtDur, FmtEff, FmtDate))
            .ToList();
        var headers = new[]
        {
            s.ColDateHeader, s.ColRoute, s.ColDistance, s.ColDuration,
            s.ColConsumption, s.ColScoreHeader, s.ColGrade, s.ColEffHeader,
        };

        // ── Summary stat cards ──────────────────────────────────────────────────────────────────────────────
        int bestScoreVal = allScores.Count > 0 ? allScores.Max(x => x.Total) : 0;
        var statCards = new List<StatCardDisplay>
        {
            new(s.AvgScore, $"{avg.Total}/100", TargetGlyph, trendLabel),
            new(s.BestScore, $"{bestScoreVal}/100", TrophyGlyph, string.Empty),
            new(s.TotalDrivesLabel, scored.Count.ToString(CultureInfo.InvariantCulture), DriveGlyph, string.Empty),
            new(s.AvgEffLabel, FmtEff(avgWhPerKm, 1), ChargingGlyph, string.Empty),
        };

        // ── Period stats ────────────────────────────────────────────────────────────────────────────────────
        var period = BuildPeriodStats(scored, allScores, now);
        var periodPanels = BuildPeriodPanels(period, s);

        // ── Achievements ────────────────────────────────────────────────────────────────────────────────────
        var achievements = BuildAchievements(allScores, scored.Count, s);

        // ── KV summary cards ────────────────────────────────────────────────────────────────────────────────
        double totalDistanceM = scored.Sum(x => x.Drive.DistanceM);
        double totalDurationS = scored.Sum(x => x.Drive.DurationS);
        double highestMaxSpeed = scored.Count > 0 ? scored.Max(x => x.Drive.MaxSpeedMps ?? 0) : 0;
        int aPlusCount = allScores.Count(x => x.Grade == "A+");

        var scoreBreakdown = new KvCardDisplay(s.Breakdown, new[]
        {
            new KvRow(s.EfficiencyLabel, $"{(int)Math.Round(effVal, MidpointRounding.AwayFromZero)}/40"),
            new KvRow(s.SmoothnessLabel, $"{(int)Math.Round(smoothVal, MidpointRounding.AwayFromZero)}/30"),
            new KvRow(s.SpeedLabel, $"{(int)Math.Round(speedVal, MidpointRounding.AwayFromZero)}/30"),
            new KvRow(s.TotalLabel, $"{(int)Math.Round(overallScore, MidpointRounding.AwayFromZero)}/100"),
        });

        var periodStatistics = new KvCardDisplay(s.PeriodStats, new[]
        {
            new KvRow(s.TotalDistance, FmtDistance(totalDistanceM)),
            new KvRow(s.TotalDuration, FmtDur(totalDurationS)),
            new KvRow(s.AvgDistance, FmtDistance(scored.Count > 0 ? totalDistanceM / scored.Count : 0)),
            new KvRow(s.AvgDuration, FmtDur(scored.Count > 0 ? totalDurationS / scored.Count : 0)),
            new KvRow(s.HighestSpeed, FmtSpeed(highestMaxSpeed)),
            new KvRow(s.APlusCount, aPlusCount.ToString(CultureInfo.InvariantCulture)),
        });

        return new DriveScoreDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            AutomationName: $"{s.Title}. {s.Subtitle}",
            ShowLoading: state == DriveScoreState.Loading,
            ShowEmpty: state == DriveScoreState.Empty,
            ShowError: state == DriveScoreState.Error,
            ShowContent: state == DriveScoreState.Success,
            EmptyTitle: s.EmptyTitle,
            EmptyMessage: s.Empty,
            ErrorText: errorText,
            RetryLabel: s.RetryLabel,
            OverallScore: overallScore,
            OverallColorIndex: ScoreMath.GradeColorIndex(overallGrade),
            OverallLabel: s.Overall,
            OverallTrendLabel: trendLabel,
            TrendStatus: trendStatus,
            TrendGlyph: trendGlyph,
            BasedOnText: basedOnText,
            HasBasedOn: api is not null,
            HelpAria: s.HelpIconLabel,
            GradeText: overallGrade,
            GradeStatus: ScoreMath.GradeStatus(overallGrade),
            GradeLabelText: gradeLabelText,
            DrivesInPeriodText: drivesInPeriodText,
            Categories: categories,
            TrendTitle: s.ScoreTrend,
            TrendAria: s.ScoreTrendAria,
            TrendHasData: recent.Count > 0,
            TrendSeries: trendSeries,
            GradeLineValue: 80,
            GradeLineLabel: s.GradeALine,
            CategoryTitle: s.CategoryBreakdown,
            CategoryAria: s.CategoryBreakdownAria,
            CategorySeries: categorySeries,
            DistributionTitle: s.ScoreDistribution,
            DistributionAria: s.ScoreDistributionAria,
            DistributionSeries: distributionSeries,
            TipsTitle: s.TipsTitle,
            TipsSubtitle: Interp(s.TipsSubtitle, "category", weakestLabel),
            Tips: tips,
            Best: bestDisplay,
            Worst: worstDisplay,
            HistoryTitle: s.DriveHistory,
            HistoryHeaders: headers,
            HistoryRows: pageRows,
            HistoryEmptyText: s.NoDrives,
            Page: clampedPage,
            PageSize: DrivesPerPage,
            TotalRows: sortedForTable.Count,
            ShowPagination: totalPages > 1,
            PaginationSummaryFormat: "{0}\u2013{1} / {2}",
            StatCards: statCards,
            HasPeriodStats: period is not null,
            PeriodPanels: periodPanels,
            NoPeriodStatsText: s.NoPeriodStats,
            AchievementsTitle: s.AchievementsTitle,
            Achievements: achievements,
            ScoreBreakdown: scoreBreakdown,
            PeriodStatistics: periodStatistics);
    }

    private static (int Total, int Efficiency, int Smoothness, int Speed) AverageScores(List<ComputedScore> scores)
    {
        if (scores.Count == 0)
        {
            return (0, 0, 0, 0);
        }

        double total = 0, eff = 0, sm = 0, sp = 0;
        foreach (var x in scores)
        {
            total += x.Total;
            eff += x.Efficiency;
            sm += x.Smoothness;
            sp += x.Speed;
        }

        int n = scores.Count;
        return (
            (int)Math.Round(total / n, MidpointRounding.AwayFromZero),
            (int)Math.Round(eff / n, MidpointRounding.AwayFromZero),
            (int)Math.Round(sm / n, MidpointRounding.AwayFromZero),
            (int)Math.Round(sp / n, MidpointRounding.AwayFromZero));
    }

    private static List<ChartPoint> BuildHistogram(List<ComputedScore> scores)
    {
        (string Range, int Min, int Max)[] buckets =
        [
            ("0\u201320", 0, 20),
            ("20\u201340", 20, 40),
            ("40\u201360", 40, 60),
            ("60\u201380", 60, 80),
            ("80\u2013100", 80, 101),
        ];

        var points = new List<ChartPoint>(buckets.Length);
        for (int i = 0; i < buckets.Length; i++)
        {
            int count = scores.Count(x => x.Total >= buckets[i].Min && x.Total < buckets[i].Max);
            points.Add(new ChartPoint(i, count, buckets[i].Range));
        }

        return points;
    }

    private static string WeakestCategory(double eff, double smooth, double speed)
    {
        double e = eff / EfficiencyMax;
        double sm = smooth / SmoothnessMax;
        double sp = speed / SpeedMax;
        if (e <= sm && e <= sp)
        {
            return "efficiency";
        }

        return sm <= sp ? "smoothness" : "speed";
    }

    private static List<string> BuildTips(string weakest, DriveScoreStrings s) => weakest switch
    {
        "efficiency" => [s.TipPreCondition, s.TipCoastMore, s.TipTirePressure],
        "smoothness" => [s.TipSmoothAccel, s.TipRegenBraking, s.TipFollowDistance],
        _ => [s.TipSpeedLimit, s.TipCruiseControl, s.TipRoutePlanning],
    };

    private static BestWorstDisplay BuildBestWorst(
        ScoredDrive? entry,
        bool isBest,
        DriveScoreStrings s,
        Func<double, string> fmtDistance,
        Func<double, string> fmtDuration,
        Func<double, int, string> fmtEff)
    {
        string title = isBest ? s.BestDrive : s.WorstDrive;
        string glyph = isBest ? StarGlyph : WarningGlyph;
        if (entry is not { } e)
        {
            return new BestWorstDisplay(title, glyph, false, string.Empty, string.Empty, StatusKind.Neutral,
                0, 0, string.Empty, string.Empty, string.Empty, string.Empty, StatusKind.Neutral, s.NoDrives,
                s.Distance, s.DurationLabel, s.Consumption);
        }

        var sc = e.Score;
        string tip = isBest
            ? sc.Efficiency >= 35 ? s.TipBestEff : sc.Smoothness >= 25 ? s.TipBestSmooth : s.TipBestSpeed
            : sc.Efficiency < 15 ? s.TipWorstEff : sc.Smoothness < 10 ? s.TipWorstSmooth : s.TipWorstSpeed;

        return new BestWorstDisplay(
            Title: title,
            Glyph: glyph,
            Has: true,
            DateText: DateTimeFormatting.Format(e.Drive.StartTs, DateTimeVariant.Short, DateTimeOffset.Now),
            Grade: sc.Grade,
            GradeStatus: ScoreMath.GradeStatus(sc.Grade),
            Score: sc.Total,
            ScoreColorIndex: isBest ? 1 : 5,
            DistanceText: fmtDistance(e.Drive.DistanceM),
            DurationText: fmtDuration(e.Drive.DurationS),
            ConsumptionText: fmtEff(sc.WhPerKm, 0),
            TipText: tip,
            TipStatus: isBest ? StatusKind.Success : StatusKind.Danger,
            NoDataText: s.NoDrives,
            DistanceLabel: s.Distance,
            DurationLabel: s.DurationLabel,
            ConsumptionLabel: s.Consumption);
    }

    private static DriveRowDisplay BuildRow(
        ScoredDrive x,
        DriveScoreStrings s,
        Func<double, string> fmtDistance,
        Func<double, string> fmtDuration,
        Func<double, int, string> fmtEff,
        Func<DateTimeOffset, string> fmtDate)
    {
        var d = x.Drive;
        var sc = x.Score;
        string route = d.StartAddress is { Length: > 0 } start
            ? d.EndAddress is { Length: > 0 } end ? $"{start} \u2192 {end}" : start
            : s.UnknownRoute;

        return new DriveRowDisplay(
            Id: d.Id,
            Date: fmtDate(d.StartTs),
            Route: route,
            Distance: fmtDistance(d.DistanceM),
            Duration: fmtDuration(d.DurationS),
            Consumption: fmtEff(sc.WhPerKm, 0),
            ScoreText: $"{sc.Total}/100",
            ScoreStatus: ScoreMath.GradeStatus(sc.Grade),
            Grade: sc.Grade,
            GradeStatus: ScoreMath.GradeStatus(sc.Grade),
            Breakdown: $"{sc.Efficiency}/{sc.Smoothness}/{sc.Speed}");
    }

    private sealed record PeriodStats(
        int? ThisWeekAvg,
        int? LastWeekAvg,
        int? ThisMonthAvg,
        int? LastMonthAvg,
        int BestWeekAvg,
        string BestWeekLabel,
        int BestMonthAvg,
        string BestMonthLabel,
        int TotalDrives,
        int AOrBetter);

    private static PeriodStats? BuildPeriodStats(
        List<ScoredDrive> scored,
        List<ComputedScore> allScores,
        DateTimeOffset now)
    {
        if (scored.Count == 0)
        {
            return null;
        }

        DateTime nowDt = now.LocalDateTime;
        DateTime weekStart = nowDt.Date.AddDays(-(int)nowDt.DayOfWeek);
        DateTime lastWeekStart = weekStart.AddDays(-7);
        DateTime monthStart = new(nowDt.Year, nowDt.Month, 1);
        DateTime lastMonthStart = monthStart.AddMonths(-1);
        DateTime lastMonthEnd = monthStart.AddDays(-1);

        static int? Avg(IEnumerable<ScoredDrive> items)
        {
            var list = items.ToList();
            return list.Count > 0
                ? (int)Math.Round(list.Average(x => (double)x.Score.Total), MidpointRounding.AwayFromZero)
                : null;
        }

        DateTime Local(ScoredDrive x) => x.Drive.StartTs.LocalDateTime;

        int? thisWeek = Avg(scored.Where(x => Local(x) >= weekStart));
        int? lastWeek = Avg(scored.Where(x => Local(x) >= lastWeekStart && Local(x) < weekStart));
        int? thisMonth = Avg(scored.Where(x => Local(x) >= monthStart));
        int? lastMonth = Avg(scored.Where(x => Local(x) >= lastMonthStart && Local(x) <= lastMonthEnd));

        var weekMap = new Dictionary<string, List<ScoredDrive>>(StringComparer.Ordinal);
        var monthMap = new Dictionary<string, List<ScoredDrive>>(StringComparer.Ordinal);
        foreach (var sd in scored)
        {
            DateTime d = Local(sd);
            int firstDow = (int)new DateTime(d.Year, d.Month, 1).DayOfWeek;
            string wk = $"{d.Year}-W{(int)Math.Ceiling((d.Day + firstDow) / 7.0)}";
            string mo = $"{d.Year}-{d.Month:D2}";
            (weekMap.TryGetValue(wk, out var wl) ? wl : weekMap[wk] = []).Add(sd);
            (monthMap.TryGetValue(mo, out var ml) ? ml : monthMap[mo] = []).Add(sd);
        }

        (int Avg, string Label) bestWeek = (0, EmDash);
        foreach (var (label, items) in weekMap)
        {
            int? a = Avg(items);
            if (a is { } v && v > bestWeek.Avg)
            {
                bestWeek = (v, label);
            }
        }

        (int Avg, string Label) bestMonth = (0, EmDash);
        foreach (var (label, items) in monthMap)
        {
            int? a = Avg(items);
            if (a is { } v && v > bestMonth.Avg)
            {
                bestMonth = (v, label);
            }
        }

        int aOrBetter = allScores.Count(x => x.Grade is "A+" or "A");
        return new PeriodStats(thisWeek, lastWeek, thisMonth, lastMonth,
            bestWeek.Avg, bestWeek.Label, bestMonth.Avg, bestMonth.Label, scored.Count, aOrBetter);
    }

    private static List<PeriodPanelDisplay> BuildPeriodPanels(PeriodStats? p, DriveScoreStrings s)
    {
        if (p is null)
        {
            return [];
        }

        static string Num(int? v) => v?.ToString(CultureInfo.InvariantCulture) ?? "\u2014";

        var thisWeek = new PeriodPanelDisplay(
            s.ThisWeek, Num(p.ThisWeekAvg), ScoreMath.ScoreStatus(p.ThisWeekAvg),
            p.ThisWeekAvg is not null && p.LastWeekAvg is not null,
            p.ThisWeekAvg is { } tw && p.LastWeekAvg is { } lw ? Math.Abs(tw - lw).ToString(CultureInfo.InvariantCulture) : string.Empty,
            (p.ThisWeekAvg ?? 0) >= (p.LastWeekAvg ?? 0),
            Interp(s.VsLastWeek, "val", Num(p.LastWeekAvg)));

        var thisMonth = new PeriodPanelDisplay(
            s.ThisMonth, Num(p.ThisMonthAvg), ScoreMath.ScoreStatus(p.ThisMonthAvg),
            p.ThisMonthAvg is not null && p.LastMonthAvg is not null,
            p.ThisMonthAvg is { } tm && p.LastMonthAvg is { } lm ? Math.Abs(tm - lm).ToString(CultureInfo.InvariantCulture) : string.Empty,
            (p.ThisMonthAvg ?? 0) >= (p.LastMonthAvg ?? 0),
            Interp(s.VsLastMonth, "val", Num(p.LastMonthAvg)));

        var bestWeek = new PeriodPanelDisplay(
            s.BestWeek, p.BestWeekAvg > 0 ? p.BestWeekAvg.ToString(CultureInfo.InvariantCulture) : "\u2014",
            ScoreMath.ScoreStatus(p.BestWeekAvg > 0 ? p.BestWeekAvg : null), false, string.Empty, true, p.BestWeekLabel);

        var bestMonth = new PeriodPanelDisplay(
            s.BestMonth, p.BestMonthAvg > 0 ? p.BestMonthAvg.ToString(CultureInfo.InvariantCulture) : "\u2014",
            ScoreMath.ScoreStatus(p.BestMonthAvg > 0 ? p.BestMonthAvg : null), false, string.Empty, true, p.BestMonthLabel);

        var totalDrives = new PeriodPanelDisplay(
            s.TotalDrivesLabel, p.TotalDrives.ToString(CultureInfo.InvariantCulture), StatusKind.Neutral,
            false, string.Empty, true, s.DrivesScored);

        string ratedSub = p.TotalDrives > 0
            ? $"{NumberFormatting.Format((double)p.AOrBetter / p.TotalDrives * 100.0, null, 0)}% {s.OfDrives}"
            : s.NoDrives;
        var ratedAPlus = new PeriodPanelDisplay(
            s.RatedAPlus, p.AOrBetter.ToString(CultureInfo.InvariantCulture), StatusKind.Success,
            false, string.Empty, true, ratedSub);

        return [thisWeek, thisMonth, bestWeek, bestMonth, totalDrives, ratedAPlus];
    }

    private static List<AchievementDisplay> BuildAchievements(
        List<ComputedScore> scores,
        int driveCount,
        DriveScoreStrings s)
    {
        bool aPlusStreak = false;
        int streak = 0;
        foreach (var sc in scores)
        {
            if (sc.Grade == "A+")
            {
                streak++;
                if (streak >= 5)
                {
                    aPlusStreak = true;
                    break;
                }
            }
            else
            {
                streak = 0;
            }
        }

        return
        [
            new(s.AchFirstDrive, s.AchFirstDriveDesc, driveCount >= 1, DriveGlyph, s.Unlocked),
            new(s.AchTenDrives, s.AchTenDrivesDesc, driveCount >= 10, StarGlyph, s.Unlocked),
            new(s.AchFiftyDrives, s.AchFiftyDrivesDesc, driveCount >= 50, TrophyGlyph, s.Unlocked),
            new(s.AchPerfectScore, s.AchPerfectScoreDesc, scores.Any(x => x.Total >= 100), TrophyGlyph, s.Unlocked),
            new(s.AchAPlusStreak, s.AchAPlusStreakDesc, aPlusStreak, TrophyGlyph, s.Unlocked),
            new(s.AchEfficiencyMaster, s.AchEfficiencyMasterDesc, scores.Count(x => x.Efficiency >= 38) >= 3, ChargingGlyph, s.Unlocked),
            new(s.AchSmoothOperator, s.AchSmoothOperatorDesc, scores.Count(x => x.Smoothness >= 28) >= 3, CheckGlyph, s.Unlocked),
            new(s.AchSpeedSaint, s.AchSpeedSaintDesc, scores.Count(x => x.Speed >= 28) >= 5, TargetGlyph, s.Unlocked),
        ];
    }

    /// <summary>Web <c>formatDurationMinutes</c>: "1h 23m" or "23m"; negative / non-finite → em dash.</summary>
    private static string FormatDurationMinutes(double minutes)
    {
        if (double.IsNaN(minutes) || double.IsInfinity(minutes) || minutes < 0)
        {
            return EmDash;
        }

        int h = (int)Math.Floor(minutes / 60.0);
        int m = (int)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);
        if (m == 60)
        {
            h += 1;
            m = 0;
        }

        return h > 0 ? $"{h}h {m}m" : $"{m}m";
    }

    private static string Interp(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
}

