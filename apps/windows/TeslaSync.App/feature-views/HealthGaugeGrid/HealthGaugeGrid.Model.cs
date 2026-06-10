using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>HealthGaugeGrid</c> surface — the native union of the states
/// the P2 feature-view contract requires for the drivetrain-health gauge grid
/// (web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx). The web component is a pure
/// presentational child (it takes <c>overallHealth</c>, <c>healthScore</c>, <c>motorStatus</c>, <c>sensors</c>
/// and <c>stats</c> props and reads the active units from <c>useUnits</c>; it performs no fetching), so the
/// parent Drivetrain-Health page owns the query lifecycle and supplies the active state. Every member maps onto
/// a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum HealthGaugeGridState
{
    /// <summary>The drivetrain-health query is in flight and no values have arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>The populated three-panel grid (the web fall-through): gauge, motor details and drive stats.</summary>
    Ready,

    /// <summary>Resolved with no drivetrain data — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — the grid plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The drive-statistics summary the <c>HealthGaugeGrid</c> drive-stats panel renders — the native analogue of
/// the subset of the web <c>DrivingStats</c> (web/src/types/driving.ts) the component actually reads. The web
/// passes each value straight into the shared SI converters / formatters, so the native model carries the same
/// raw numbers verbatim and the projection reproduces the web's output number-for-number. The unit-named fields
/// mirror the web field names exactly (the values are fed to <c>convertDistanceFromSI</c> /
/// <c>convertSpeedFromSI</c> exactly as the web does, reproducing its conversion semantics). Pure data — no
/// WinUI types.
/// </summary>
/// <param name="TotalDrives">Total number of drives (web <c>stats.totalDrives</c>, rendered via <c>fmtInt</c>).</param>
/// <param name="TotalDistanceKm">Total distance the web feeds to <c>convertDistanceFromSI</c> (web <c>stats.totalDistanceKm</c>).</param>
/// <param name="AvgSpeedKmh">Average speed the web feeds to <c>convertSpeedFromSI</c> (web <c>stats.avgSpeedKmh</c>).</param>
/// <param name="TopSpeedKmh">Top speed the web feeds to <c>convertSpeedFromSI</c> (web <c>stats.topSpeedKmh</c>).</param>
public sealed record HealthGaugeDriveStats(
    double TotalDrives,
    double TotalDistanceKm,
    double AvgSpeedKmh,
    double TopSpeedKmh);

/// <summary>
/// The render-time data model the <c>HealthGaugeGrid</c> view binds to — the native analogue of the web
/// component's props (<c>overallHealth</c>, <c>healthScore</c>, <c>motorStatus</c>, <c>sensors</c>,
/// <c>stats</c>) plus the active <see cref="UnitPref"/> (web <c>useUnits</c>) and the parent-supplied lifecycle
/// <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent Drivetrain-Health state
/// holder fills this in (the native P1/S8 seam). Drive-stat readings stay in the web's raw form — converted to
/// the user's display unit only at projection time. Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="OverallHealth">The drivetrain's overall health rating (web <c>overallHealth</c>).</param>
/// <param name="HealthScore">The 0..100 health score driving the gauge (web <c>healthScore</c>).</param>
/// <param name="MotorStatus">The live motor status string shown verbatim (web <c>motorStatus</c>).</param>
/// <param name="SensorValues">
/// The temperature-sensor readings; <see langword="null"/> entries are unavailable sensors. Only the count of
/// non-null entries is read (web <c>sensors.filter((s) =&gt; s.value !== null).length</c>).
/// </param>
/// <param name="Stats">
/// The drive-statistics summary, or <see langword="null"/> while the parent is still loading it — the web's
/// <c>stats ? &lt;KVList/&gt; : &lt;Skeleton/&gt;</c> inline fallback inside the otherwise-populated grid.
/// </param>
/// <param name="Units">The user's unit preference (only <see cref="UnitPref.Distance"/> / <see cref="UnitPref.Speed"/> are read).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record HealthGaugeGridModel(
    HealthGaugeGridState Status,
    DrivetrainHealthStatus OverallHealth,
    double HealthScore,
    string MotorStatus,
    IReadOnlyList<double?> SensorValues,
    HealthGaugeDriveStats? Stats,
    UnitPref Units,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    private static readonly IReadOnlyList<double?> NoSensors = Array.Empty<double?>();

    /// <summary>The initial model: the query is in flight and no values have arrived yet.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static HealthGaugeGridModel Loading(UnitPref? units = null) =>
        new(
            HealthGaugeGridState.Loading,
            DrivetrainHealthStatus.Good,
            0,
            string.Empty,
            NoSensors,
            null,
            units ?? UnitPref.Metric);

    /// <summary>A resolved model with no drivetrain data — the empty state.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static HealthGaugeGridModel Empty(UnitPref? units = null) =>
        new(
            HealthGaugeGridState.Empty,
            DrivetrainHealthStatus.Good,
            0,
            string.Empty,
            NoSensors,
            null,
            units ?? UnitPref.Metric);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static HealthGaugeGridModel Failed(string? message = null, UnitPref? units = null) =>
        new(
            HealthGaugeGridState.Error,
            DrivetrainHealthStatus.Good,
            0,
            string.Empty,
            NoSensors,
            null,
            units ?? UnitPref.Metric,
            ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the drivetrain values to render.</summary>
    /// <param name="overallHealth">The overall health rating.</param>
    /// <param name="healthScore">The 0..100 health score.</param>
    /// <param name="motorStatus">The live motor status string.</param>
    /// <param name="sensorValues">The temperature-sensor readings (null = unavailable).</param>
    /// <param name="stats">The drive-statistics summary, or null to show the inline skeleton.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static HealthGaugeGridModel Ready(
        DrivetrainHealthStatus overallHealth,
        double healthScore,
        string motorStatus,
        IReadOnlyList<double?> sensorValues,
        HealthGaugeDriveStats? stats,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(motorStatus);
        ArgumentNullException.ThrowIfNull(sensorValues);
        return new(
            HealthGaugeGridState.Ready,
            overallHealth,
            healthScore,
            motorStatus,
            sensorValues,
            stats,
            units ?? UnitPref.Metric,
            updatedAt,
            isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached drivetrain values.</summary>
    /// <param name="overallHealth">The cached overall health rating.</param>
    /// <param name="healthScore">The cached 0..100 health score.</param>
    /// <param name="motorStatus">The cached motor status string.</param>
    /// <param name="sensorValues">The cached temperature-sensor readings (null = unavailable).</param>
    /// <param name="stats">The cached drive-statistics summary, or null to show the inline skeleton.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static HealthGaugeGridModel Stale(
        DrivetrainHealthStatus overallHealth,
        double healthScore,
        string motorStatus,
        IReadOnlyList<double?> sensorValues,
        HealthGaugeDriveStats? stats,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(motorStatus);
        ArgumentNullException.ThrowIfNull(sensorValues);
        return new(
            HealthGaugeGridState.Stale,
            overallHealth,
            healthScore,
            motorStatus,
            sensorValues,
            stats,
            units ?? UnitPref.Metric,
            updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached drivetrain values.</summary>
    /// <param name="overallHealth">The cached overall health rating.</param>
    /// <param name="healthScore">The cached 0..100 health score.</param>
    /// <param name="motorStatus">The cached motor status string.</param>
    /// <param name="sensorValues">The cached temperature-sensor readings (null = unavailable).</param>
    /// <param name="stats">The cached drive-statistics summary, or null to show the inline skeleton.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static HealthGaugeGridModel Offline(
        DrivetrainHealthStatus overallHealth,
        double healthScore,
        string motorStatus,
        IReadOnlyList<double?> sensorValues,
        HealthGaugeDriveStats? stats,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(motorStatus);
        ArgumentNullException.ThrowIfNull(sensorValues);
        return new(
            HealthGaugeGridState.Offline,
            overallHealth,
            healthScore,
            motorStatus,
            sensorValues,
            stats,
            units ?? UnitPref.Metric,
            updatedAt,
            ErrorMessage: message);
    }
}

/// <summary>
/// The projected, render-ready health-score gauge — the native analogue of the single web <c>RadialGauge</c>
/// (value = <c>healthScore</c>, max = 100, unit = <c>"%"</c>). <see cref="Fraction"/> is the clamped 0..1 sweep
/// (web <c>clamp(value, 0, max) / max</c>), <see cref="ValueText"/> the clamped centre readout
/// (web <c>fmtNumber(clamped, d)</c>), <see cref="UnitLabel"/> the small "%" suffix, <see cref="Severity"/> the
/// semantic colour the arc is tinted with (web <c>HEALTH_COLOR[overallHealth]</c>), <see cref="Label"/> the
/// caption beneath and <see cref="Description"/> the muted line under the panel. Pure data.
/// </summary>
/// <param name="ValueText">Clamped centre readout (number only, no unit).</param>
/// <param name="UnitLabel">Unit suffix shown after the value ("%").</param>
/// <param name="Fraction">Clamped 0..1 gauge sweep.</param>
/// <param name="Severity">Semantic colour the gauge arc is tinted with.</param>
/// <param name="Label">Localized gauge caption ("Health Score").</param>
/// <param name="Description">Localized muted description under the gauge.</param>
/// <param name="AutomationName">Narrator name combining the label and the value.</param>
public sealed record HealthGaugeDisplayGauge(
    string ValueText,
    string UnitLabel,
    double Fraction,
    StatusKind Severity,
    string Label,
    string Description,
    string AutomationName);

/// <summary>One label/value row of a <c>HealthGaugeGrid</c> panel — the native analogue of a web <c>KVList</c> item.</summary>
/// <param name="Label">Localized left-hand label.</param>
/// <param name="Value">Right-hand value (already formatted; never null).</param>
public sealed record HealthKeyValue(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the <c>HealthGaugeGrid</c> — the native analogue of everything the
/// web component renders. Holds the active <see cref="State"/>, the projected <see cref="Gauge"/>, the
/// motor-detail rows and their panel title + real-time caption, the drive-stat rows (or the
/// <see cref="ShowDriveStatsSkeleton"/> inline-skeleton flag) and their panel title, the freshness chip copy +
/// status (shown only for <see cref="HealthGaugeGridState.Stale"/> / <see cref="HealthGaugeGridState.Offline"/>),
/// the empty / loading / error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record HealthGaugeGridDisplay(
    HealthGaugeGridState State,
    HealthGaugeDisplayGauge Gauge,
    string MotorDetailsTitle,
    IReadOnlyList<HealthKeyValue> MotorDetails,
    string RealTimeText,
    string DriveStatsTitle,
    IReadOnlyList<HealthKeyValue> DriveStats,
    bool ShowDriveStatsSkeleton,
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
/// Pure projection from a <see cref="HealthGaugeGridModel"/> to its <see cref="HealthGaugeGridDisplay"/> — the
/// native port of web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx. Branch precedence
/// mirrors the web parent's data lifecycle (loading → error → empty → freshness → ready); a stale / offline
/// snapshot keeps its cached grid under a freshness chip. The health-score gauge reproduces the web
/// <c>RadialGauge</c> exactly (clamp to [0, max]; integer values render with no decimals, otherwise the global
/// precision; sweep = clamped / max). The drive-stat values are converted from the web's raw form to the user's
/// display unit through the shared <see cref="UnitConverters"/> and formatted by <see cref="NumberFormatting"/>
/// (the 1:1 ports of the web <c>convertDistanceFromSI</c> / <c>convertSpeedFromSI</c> + <c>fmtInt</c> /
/// <c>fmtNumber</c>), so the rendered numbers match the web number-for-number. The active-sensor count reproduces
/// the web <c>sensors.filter((s) =&gt; s.value !== null).length</c>, and the overall-health value reproduces the
/// web's first-letter capitalisation of the status token. Every label resolves through the i18n facade using the
/// same keys the web feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class HealthGaugeGridProjection
{
    /// <summary>Full-sweep maximum of the health-score gauge (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    /// <summary>Unit suffix shown inside the health-score gauge (web <c>unit="%"</c>).</summary>
    public const string PercentUnit = "%";

    /// <summary>
    /// Decimal places for the gauge centre readout of a non-integer value — the web RadialGauge's
    /// <c>getGlobalPrecision()</c> default (2). An integer value always renders with no decimals (web
    /// <c>Number.isInteger(clamped) ? 0 : …</c>); a host may override via <see cref="UnitPref.Precision"/>.
    /// </summary>
    public const int DefaultValuePrecision = 2;

    /// <summary>Decimal places for the "Total Distance" / "Total Drives" rows (web <c>fmtInt</c>).</summary>
    public const int IntegerPrecision = 0;

    /// <summary>Decimal places for the "Avg Speed" / "Top Speed" rows (web <c>fmtNumber(…, 1)</c>).</summary>
    public const int SpeedPrecision = 1;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus units + lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static HealthGaugeGridDisplay Project(HealthGaugeGridModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        HealthGaugeGridState state = SelectState(model);

        HealthGaugeDisplayGauge gauge = BuildGauge(model, localizer);
        string motorTitle = localizer.GetString("drivetrain.motorDetails", "Motor Details");
        IReadOnlyList<HealthKeyValue> motorDetails = BuildMotorDetails(model, localizer);
        string realTime = localizer.GetString("drivetrain.realTime", "Real-time telemetry active");
        string driveTitle = localizer.GetString("drivetrain.driveStats", "Drive Statistics");
        IReadOnlyList<HealthKeyValue> driveStats = BuildDriveStats(model, localizer);
        bool showSkeleton = model.Stats is null;

        bool showChip = state is HealthGaugeGridState.Stale or HealthGaugeGridState.Offline;
        string chipText = state switch
        {
            HealthGaugeGridState.Offline => localizer.GetString("common.offline", "Offline"),
            HealthGaugeGridState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == HealthGaugeGridState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString("drivetrain.noData", "No drivetrain data");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString("drivetrain.healthGaugesError", "Couldn't load drivetrain health");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "drivetrain.healthGaugesErrorMessage",
                "We couldn't load the drivetrain health. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, gauge, motorTitle, motorDetails, driveTitle, driveStats, showSkeleton,
            showChip, chipText, emptyMessage, loadingLabel, errorTitle);

        return new HealthGaugeGridDisplay(
            State: state,
            Gauge: gauge,
            MotorDetailsTitle: motorTitle,
            MotorDetails: motorDetails,
            RealTimeText: realTime,
            DriveStatsTitle: driveTitle,
            DriveStats: driveStats,
            ShowDriveStatsSkeleton: showSkeleton,
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

    /// <summary>
    /// Maps an overall-health rating to its semantic colour — the native port of the web <c>HEALTH_COLOR</c>
    /// map (good = emerald → <see cref="StatusKind.Success"/>, warning = amber → <see cref="StatusKind.Warning"/>,
    /// critical = red → <see cref="StatusKind.Danger"/>).
    /// </summary>
    /// <param name="status">The overall-health rating.</param>
    /// <returns>The semantic colour the gauge arc is tinted with.</returns>
    public static StatusKind StatusFor(DrivetrainHealthStatus status) => status switch
    {
        DrivetrainHealthStatus.Good => StatusKind.Success,
        DrivetrainHealthStatus.Warning => StatusKind.Warning,
        DrivetrainHealthStatus.Critical => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// Reproduces the web's <c>overallHealth.charAt(0).toUpperCase() + overallHealth.slice(1)</c>: the lower-case
    /// status token with its first letter capitalised ("Good" / "Warning" / "Critical"). The web does not
    /// localise this value (it is the raw status token), so neither does the native port — keeping the rendered
    /// data identical.
    /// </summary>
    /// <param name="status">The overall-health rating.</param>
    /// <returns>The capitalised status word the web shows in the "Overall Health" row.</returns>
    public static string OverallHealthLabel(DrivetrainHealthStatus status) => status switch
    {
        DrivetrainHealthStatus.Good => "Good",
        DrivetrainHealthStatus.Warning => "Warning",
        DrivetrainHealthStatus.Critical => "Critical",
        _ => "Good",
    };

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; the default "Ready" snapshot renders the populated grid (the
    // web component always renders its three panels — only the drive-stats panel has an inline skeleton when
    // stats is undefined, handled separately via ShowDriveStatsSkeleton).
    private static HealthGaugeGridState SelectState(HealthGaugeGridModel model) => model.Status switch
    {
        HealthGaugeGridState.Loading => HealthGaugeGridState.Loading,
        HealthGaugeGridState.Error => HealthGaugeGridState.Error,
        HealthGaugeGridState.Empty => HealthGaugeGridState.Empty,
        HealthGaugeGridState.Stale => HealthGaugeGridState.Stale,
        HealthGaugeGridState.Offline => HealthGaugeGridState.Offline,
        _ => HealthGaugeGridState.Ready,
    };

    // web RadialGauge: clamped = Math.max(0, Math.min(value, max)); fraction = clamped / max;
    // d = decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision()).
    private static HealthGaugeDisplayGauge BuildGauge(HealthGaugeGridModel model, ILocalizer localizer)
    {
        double clamped = Math.Clamp(model.HealthScore, 0, GaugeMax);
        double fraction = GaugeMax > 0 ? clamped / GaugeMax : 0;

        int valueDecimals = IsInteger(clamped) ? 0 : (model.Units.Precision ?? DefaultValuePrecision);
        string valueText = NumberFormatting.Format(clamped, model.Units.Locale, valueDecimals);

        string label = localizer.GetString("drivetrain.healthScore", "Health Score");
        string description = localizer.GetString(
            "drivetrain.healthScoreDesc", "Overall drivetrain condition rating");
        StatusKind severity = StatusFor(model.OverallHealth);

        string automationName = string.Format(
            CultureInfo.InvariantCulture, "{0}, {1}{2}", label, valueText, PercentUnit);

        return new HealthGaugeDisplayGauge(
            valueText, PercentUnit, fraction, severity, label, description, automationName);
    }

    private static IReadOnlyList<HealthKeyValue> BuildMotorDetails(HealthGaugeGridModel model, ILocalizer localizer)
    {
        // web: `${healthScore}%` uses the RAW prop value (string interpolation), not the clamped gauge readout.
        string healthScoreValue = RawNumber(model.HealthScore) + PercentUnit;
        int activeSensors = ActiveSensorCount(model.SensorValues);

        return
        [
            new HealthKeyValue(
                localizer.GetString("drivetrain.motorStatus", "Motor Status"), model.MotorStatus),
            new HealthKeyValue(
                localizer.GetString("drivetrain.overallHealth", "Overall Health"),
                OverallHealthLabel(model.OverallHealth)),
            new HealthKeyValue(
                localizer.GetString("drivetrain.healthScoreLabel", "Health Score"), healthScoreValue),
            new HealthKeyValue(
                localizer.GetString("drivetrain.sensorCount", "Active Sensors"),
                activeSensors.ToString(CultureInfo.InvariantCulture)),
        ];
    }

    private static IReadOnlyList<HealthKeyValue> BuildDriveStats(HealthGaugeGridModel model, ILocalizer localizer)
    {
        if (model.Stats is not { } stats)
        {
            return [];
        }

        UnitPref units = model.Units;
        string distanceLabel = UnitLabels.Label(units.Distance);
        string speedLabel = UnitLabels.Label(units.Speed);

        // web: `${fmtInt(toDistanceDisplay(stats.totalDistanceKm))} ${distanceUnit}`
        string totalDistance = string.Format(
            CultureInfo.InvariantCulture,
            "{0} {1}",
            NumberFormatting.Format(
                UnitConverters.DistanceFromSi(stats.TotalDistanceKm, units.Distance), units.Locale, IntegerPrecision),
            distanceLabel);

        // web: `${fmtNumber(toSpeedDisplay(stats.avgSpeedKmh), 1)} ${speedUnit}`
        string avgSpeed = string.Format(
            CultureInfo.InvariantCulture,
            "{0} {1}",
            NumberFormatting.Format(
                UnitConverters.SpeedFromSi(stats.AvgSpeedKmh, units.Speed), units.Locale, SpeedPrecision),
            speedLabel);

        string topSpeed = string.Format(
            CultureInfo.InvariantCulture,
            "{0} {1}",
            NumberFormatting.Format(
                UnitConverters.SpeedFromSi(stats.TopSpeedKmh, units.Speed), units.Locale, SpeedPrecision),
            speedLabel);

        return
        [
            new HealthKeyValue(
                localizer.GetString("drivetrain.totalDrives", "Total Drives"),
                NumberFormatting.Format(stats.TotalDrives, units.Locale, IntegerPrecision)),
            new HealthKeyValue(
                localizer.GetString("drivetrain.totalDistance", "Total Distance"), totalDistance),
            new HealthKeyValue(
                localizer.GetString("drivetrain.avgSpeed", "Avg Speed"), avgSpeed),
            new HealthKeyValue(
                localizer.GetString("drivetrain.topSpeed", "Top Speed"), topSpeed),
        ];
    }

    /// <summary>Counts the available temperature sensors (web <c>sensors.filter((s) =&gt; s.value !== null).length</c>).</summary>
    /// <param name="sensorValues">The sensor readings; null entries are unavailable.</param>
    /// <returns>The number of non-null readings.</returns>
    public static int ActiveSensorCount(IReadOnlyList<double?> sensorValues)
    {
        ArgumentNullException.ThrowIfNull(sensorValues);
        int count = 0;
        foreach (double? value in sensorValues)
        {
            if (value.HasValue)
            {
                count++;
            }
        }

        return count;
    }

    private static bool IsInteger(double value) => Math.Abs(value - Math.Round(value)) < 1e-9;

    // Reproduces the web template literal `${number}` (Number.prototype.toString): the shortest round-trippable
    // decimal with no thousands grouping. .NET Core's invariant double formatting already yields the shortest
    // round-trip representation; the "+ 0.0" normalises a negative zero to "0" to match JavaScript.
    private static string RawNumber(double value) =>
        (value + 0.0).ToString(CultureInfo.InvariantCulture);

    private static string BuildAutomationName(
        HealthGaugeGridState state,
        HealthGaugeDisplayGauge gauge,
        string motorTitle,
        IReadOnlyList<HealthKeyValue> motorDetails,
        string driveTitle,
        IReadOnlyList<HealthKeyValue> driveStats,
        bool showSkeleton,
        bool showChip,
        string chipText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case HealthGaugeGridState.Loading:
                return $"{gauge.Label}. {loadingLabel}";
            case HealthGaugeGridState.Empty:
                return $"{gauge.Label}. {emptyMessage}";
            case HealthGaugeGridState.Error:
                return $"{gauge.Label}. {errorTitle}";
            default:
                var parts = new List<string>();
                if (showChip)
                {
                    parts.Add(chipText);
                }

                parts.Add(gauge.AutomationName);
                parts.Add(motorTitle);
                foreach (HealthKeyValue row in motorDetails)
                {
                    parts.Add($"{row.Label}: {row.Value}");
                }

                parts.Add(driveTitle);
                if (showSkeleton)
                {
                    parts.Add(loadingLabel);
                }
                else
                {
                    foreach (HealthKeyValue row in driveStats)
                    {
                        parts.Add($"{row.Label}: {row.Value}");
                    }
                }

                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>HealthGaugeGrid</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a health score, motor status, sensor
/// reading, drive statistic or VIN — so a diagnostics line can never leak drivetrain telemetry. Thread-safe.
/// </summary>
public sealed class HealthGaugeGridDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public HealthGaugeGridDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HealthGaugeGrid</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HealthGaugeGridRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>HealthGaugeGrid</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx</c>.
/// </summary>
public static class HealthGaugeGridRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "HealthGaugeGrid";
}
