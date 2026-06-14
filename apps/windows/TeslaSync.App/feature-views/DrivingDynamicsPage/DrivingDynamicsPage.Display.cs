using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>A pre-formatted stat-card tile (web <c>StatCard</c>): glyph + value + label + Narrator name.</summary>
public sealed record DynStatCard(string Glyph, string Label, string Value, string AutomationName);

/// <summary>A pre-formatted key/value row inside a glass panel (web flex justify-between line).</summary>
public sealed record DynKeyValue(string Label, string Value);

/// <summary>A radial-gauge tile projection (web <c>RadialGauge</c> + caption).</summary>
public sealed record DynGauge(
    double Value,
    double Max,
    string Label,
    string Unit,
    string Caption,
    ChartRole Role,
    int Decimals,
    string AutomationName);

/// <summary>A typed chart series projected for a cartesian chart (WinUI-free).</summary>
public sealed record DynSeries(
    string Name,
    ChartSeriesKind Kind,
    ChartRole Role,
    int ColorIndex,
    string? Unit,
    IReadOnlyList<ChartPoint> Points);

/// <summary>A single chart card (web <c>ChartContainer</c>): chrome + state + projected series.</summary>
public sealed record DynChartCard(
    string Title,
    string Subtitle,
    string AriaLabel,
    string EmptyMessage,
    bool HasData,
    string XLabel,
    IReadOnlyList<DynSeries> Series,
    IReadOnlyList<ChartAnnotation> Annotations);

/// <summary>The Live-Motor-Status section projection (web <c>LiveMotorStatus.tsx</c>).</summary>
public sealed record LiveMotorDisplay(
    string Title,
    bool HasData,
    string EmptyMessage,
    IReadOnlyList<DynGauge> Gauges,
    string ShiftValue,
    StatusKind ShiftStatus,
    string ShiftCaption);

/// <summary>The G-Force section projection (web <c>GForcePanel.tsx</c>).</summary>
public sealed record GForceDisplay(string Title, bool HasData, string EmptyMessage, IReadOnlyList<DynStatCard> Cards);

/// <summary>The Pedal-Usage section projection (web <c>PedalUsage.tsx</c>).</summary>
public sealed record PedalDisplay(
    string Title,
    bool HasData,
    string EmptyMessage,
    DynGauge Throttle,
    DynGauge Brake,
    string BrakeBadge,
    StatusKind BrakeStatus,
    string BrakeCaption);

/// <summary>The Speed &amp; Gear section projection (web <c>SpeedGearPanel.tsx</c>).</summary>
public sealed record SpeedGearDisplay(
    string Title,
    string ShiftValue,
    StatusKind ShiftStatus,
    string ShiftLabel,
    string PowerLabel,
    string PowerValue,
    string AvgSpeedLabel,
    string AvgSpeedValue,
    string TopSpeedLabel,
    string TopSpeedValue,
    string PowerUnit,
    string SpeedUnit);

/// <summary>The Autopilot &amp; Cruise section projection (web <c>AutopilotSection.tsx</c>).</summary>
public sealed record AutopilotDisplay(string Title, bool HasData, string EmptyMessage, IReadOnlyList<DynStatCard> Cards);

/// <summary>The Motor-History charts projection (web <c>MotorHistoryCharts.tsx</c>): three chart cards.</summary>
public sealed record MotorChartsDisplay(DynChartCard Power, DynChartCard Torque, DynChartCard Rpm);

/// <summary>The Motor-Efficiency-Insights section projection (web <c>MotorEfficiencyInsights.tsx</c>).</summary>
public sealed record EfficiencyInsightsDisplay(
    bool HasData,
    string EmptyMessage,
    string TorqueTitle,
    IReadOnlyList<DynKeyValue> TorqueRows,
    string ThrottleTitle,
    string AvgPowerLabel,
    string AvgPowerValue,
    string StyleLabel,
    string StyleText,
    StatusKind StyleStatus,
    double StyleBarValue,
    double StyleBarMax,
    string StyleBarAccent,
    string ThermalTitle,
    IReadOnlyList<DynKeyValue> ThermalRows,
    string ThermalBadge,
    StatusKind ThermalStatus);

/// <summary>The Summary-Stats section projection (web <c>SummaryStats.tsx</c>): six stat cards.</summary>
public sealed record SummaryStatsDisplay(IReadOnlyList<DynStatCard> Cards);

/// <summary>A style-breakdown segment in the coach section (web style bar segment).</summary>
public sealed record CoachStyleSegment(string Key, double Fraction, StatusKind Status, string Tooltip);

/// <summary>A style-breakdown legend row in the coach section.</summary>
public sealed record CoachStyleRow(string Label, string Count, StatusKind Status);

/// <summary>A pattern-indicator row in the coach section (web pattern bar).</summary>
public sealed record CoachPatternRow(string Label, string ValueText, double BarValue, StatusKind Status);

/// <summary>A recommendation row in the coach section (web recommendation card).</summary>
public sealed record CoachRecRow(string Impact, StatusKind ImpactStatus, string Tip);

/// <summary>A per-drive-score table row in the coach section (web DataTable row).</summary>
public sealed record CoachScoreRow(
    string Id,
    string Date,
    string Score,
    StatusKind ScoreStatus,
    string Style,
    StatusKind StyleStatus,
    string Efficiency,
    string Distance);

/// <summary>The Driving-Coach section projection (web <c>DrivingCoachSection.tsx</c>).</summary>
public sealed record CoachDisplay(
    string Title,
    double GaugeValue,
    StatusKind GaugeStatus,
    string GaugeLabel,
    string DrivesAnalyzed,
    string StyleTitle,
    bool StyleHasData,
    string StyleEmptyMessage,
    IReadOnlyList<CoachStyleSegment> StyleSegments,
    IReadOnlyList<CoachStyleRow> StyleRows,
    string AvgEffLabel,
    string AvgEffValue,
    string BestEffLabel,
    string BestEffValue,
    string WeeklyTitle,
    bool WeeklyHasData,
    string WeeklyEmptyMessage,
    DynSeries WeeklySeries,
    string PatternsTitle,
    IReadOnlyList<CoachPatternRow> Patterns,
    string RecommendationsTitle,
    bool RecsHasData,
    string RecsEmptyMessage,
    IReadOnlyList<CoachRecRow> Recommendations,
    string PerDriveTitle,
    bool PerDriveHasData,
    string PerDriveEmptyMessage,
    IReadOnlyList<string> PerDriveColumns,
    IReadOnlyList<CoachScoreRow> PerDriveRows);

/// <summary>The Drive-Analytics section projection (web <c>DriveAnalyticsSection.tsx</c>).</summary>
public sealed record AnalyticsDisplay(
    string Title,
    DateRange Range,
    string StartLabel,
    string EndLabel,
    DynChartCard SpeedDistribution,
    DynChartCard Acceleration,
    DynChartCard PowerProfile,
    string AverageLabel);

/// <summary>A single tip row in the Driving-Tips section (web tip line).</summary>
public sealed record DynTipRow(string Text, bool Positive);

/// <summary>The Driving-Tips section projection (web <c>DrivingTips.tsx</c>).</summary>
public sealed record TipsDisplay(string Title, IReadOnlyList<DynTipRow> Tips);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>DrivingDynamicsPage</c> and its eleven children compute, resolved once so the view is a thin renderer.
/// Pure data — no WinUI types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record DrivingDynamicsDisplay(
    DrivingDynamicsState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string LoadingLabel,
    LiveMotorDisplay LiveMotor,
    GForceDisplay GForce,
    PedalDisplay Pedal,
    SpeedGearDisplay SpeedGear,
    AutopilotDisplay Autopilot,
    MotorChartsDisplay MotorCharts,
    EfficiencyInsightsDisplay Efficiency,
    SummaryStatsDisplay Summary,
    CoachDisplay Coach,
    AnalyticsDisplay Analytics,
    TipsDisplay Tips,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed seven-source <see cref="Snapshot"/>, the page
/// lifecycle (the primary motor query's <see cref="Loading"/> / <see cref="ErrorDetail"/>) and the page-scoped
/// date <see cref="Range"/> used by Speed &amp; Gear and Drive-Analytics. Pure data — no WinUI types.
/// </summary>
public sealed record DrivingDynamicsModel(
    DrivingDynamicsSnapshot Snapshot,
    bool Loading,
    string? ErrorDetail,
    DateRange Range)
{
    /// <summary>The initial model: the primary motor query is in flight with no data yet.</summary>
    public static DrivingDynamicsModel Initial(DateRange range) =>
        new(DrivingDynamicsSnapshot.Empty, true, null, range);
}
