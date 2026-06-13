using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.DriveScoreSurface;

/// <summary>
/// Canonical metadata for the <c>DriveScore</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/data-display/DriveScore.tsx</c>: the stable diagnostics slug. UI-free so the metadata is
/// asserted in tests without a WinUI host.
/// </summary>
public static class DriveScoreRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DriveScore";
}

/// <summary>
/// The render-time data model the <c>DriveScore</c> view binds to — the native analogue of the web
/// <c>DriveLike</c> prop (web/src/components/data-display/DriveScore.tsx). The web component is purely
/// presentational: its parent (a Drive detail row / header) owns any data fetching and feeds an already-resolved
/// drive, so — exactly like React re-rendering the element with already-resolved props — there is no fetch-driven
/// loading / error / stale / offline branch to reproduce here; the component always renders the gauge and the
/// four-part breakdown for whatever drive it is given (an absent field falls back to the same SI default the web
/// uses, so the surface is never blank). Every field is SI canonical, matching the web SI inputs
/// (<c>distance_m</c> / <c>duration_s</c> / <c>max_speed_mps</c> / <c>start_battery_pct</c> /
/// <c>end_battery_pct</c>); user-facing unit conversion is never this surface's concern. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="DistanceM">The drive distance in metres (web <c>distance_m</c> / <c>distanceM</c>); null falls back to 0.</param>
/// <param name="DurationS">The drive duration in seconds (web <c>duration_s</c> / <c>durationS</c>); null falls back to 0.</param>
/// <param name="MaxSpeedMps">The peak speed in metres per second (web <c>max_speed_mps</c> / <c>maxSpeedMps</c>); null falls back to the average speed.</param>
/// <param name="StartBatteryPct">The state-of-charge at drive start, 0-100 (web <c>start_battery_pct</c> / <c>startBatteryPct</c>); null falls back to 100.</param>
/// <param name="EndBatteryPct">The state-of-charge at drive end, 0-100 (web <c>end_battery_pct</c> / <c>endBatteryPct</c>); null falls back to the start charge.</param>
public sealed record DriveScoreModel(
    double? DistanceM,
    double? DurationS,
    double? MaxSpeedMps,
    double? StartBatteryPct,
    double? EndBatteryPct)
{
    /// <summary>The initial / no-input model — every field absent, scoring the web all-defaults drive.</summary>
    public static DriveScoreModel Unknown { get; } = new(null, null, null, null, null);

    /// <summary>A model for a resolved drive's SI fields (the parent passing fresh props to the web component).</summary>
    /// <param name="distanceM">The drive distance in metres (web <c>distance_m</c>).</param>
    /// <param name="durationS">The drive duration in seconds (web <c>duration_s</c>).</param>
    /// <param name="maxSpeedMps">The peak speed in metres per second (web <c>max_speed_mps</c>).</param>
    /// <param name="startBatteryPct">The state-of-charge at drive start, 0-100 (web <c>start_battery_pct</c>).</param>
    /// <param name="endBatteryPct">The state-of-charge at drive end, 0-100 (web <c>end_battery_pct</c>).</param>
    public static DriveScoreModel FromDrive(
        double? distanceM,
        double? durationS,
        double? maxSpeedMps,
        double? startBatteryPct,
        double? endBatteryPct) =>
        new(distanceM, durationS, maxSpeedMps, startBatteryPct, endBatteryPct);
}

/// <summary>
/// The four-part score breakdown plus the rounded total — the native analogue of the object
/// <c>computeDriveScore</c> returns (web/src/components/data-display/DriveScore.tsx). Each component is already
/// rounded to a whole number, exactly as the web source rounds before rendering. Pure data so every value is
/// asserted headlessly.
/// </summary>
/// <param name="Total">The overall 0-100 drive score (web <c>total</c>).</param>
/// <param name="Efficiency">The efficiency component, 0-40 (web <c>efficiency</c>).</param>
/// <param name="Speed">The speed-discipline component, 0-20 (web <c>speed</c>).</param>
/// <param name="Range">The range-preservation component, 0-20 (web <c>range</c>).</param>
/// <param name="Trip">The trip-length component, 0-20 (web <c>trip</c>).</param>
public sealed record DriveScoreBreakdown(int Total, int Efficiency, int Speed, int Range, int Trip);

/// <summary>
/// One render-ready breakdown row — the native analogue of a single entry in the web component's breakdown array
/// (web/src/components/data-display/DriveScore.tsx): its localized <see cref="Label"/>, the rounded
/// <see cref="Value"/> out of <see cref="Max"/>, the shared palette <see cref="ColorHex"/>, the bar
/// <see cref="Fraction"/> [0,1] (the web <c>(value / max) * 100%</c> width), the visible "{value}/{max}"
/// <see cref="ValueText"/> and the composed <see cref="AccessibleName"/> Narrator reads. Pure data.
/// </summary>
/// <param name="Label">The localized component label (web <c>item.label</c>).</param>
/// <param name="Value">The rounded component value (web <c>item.value</c>).</param>
/// <param name="Max">The component maximum (web <c>item.max</c>).</param>
/// <param name="ColorHex">The shared palette hex for the bar and value text (web <c>item.color</c>).</param>
/// <param name="Fraction">The bar fill fraction [0,1] (web <c>item.value / item.max</c>).</param>
/// <param name="ValueText">The visible "{value}/{max}" figure (web <c>{item.value}/{item.max}</c>).</param>
/// <param name="AccessibleName">The accessible name Narrator reads for the row ("{label} {value} / {max}").</param>
public sealed record DriveScoreComponent(
    string Label,
    int Value,
    int Max,
    string ColorHex,
    double Fraction,
    string ValueText,
    string AccessibleName);

/// <summary>
/// The fully projected, render-ready view of a <see cref="DriveScoreModel"/> — the native analogue of everything
/// the web component derives before returning JSX (web/src/components/data-display/DriveScore.tsx): the
/// <see cref="Breakdown"/>, the localized <see cref="Title"/> and <see cref="ScoreCaption"/>, the
/// <see cref="Total"/> and its <see cref="TotalText"/>, the threshold <see cref="ScoreColorHex"/> (the web
/// <c>getScoreColor</c>), the <see cref="GaugeFraction"/> [0,1] (the web <c>total / 100</c> arc sweep), the
/// composed <see cref="GaugeAccessibleName"/> and the four <see cref="Components"/> rows. Pure data so every value
/// is asserted headlessly.
/// </summary>
/// <param name="Breakdown">The four-part score breakdown plus the total.</param>
/// <param name="Title">The localized panel title (web <c>driveScore.title</c>, "Drive Score").</param>
/// <param name="ScoreCaption">The localized gauge caption (web <c>driveScore.score</c>, "Score").</param>
/// <param name="Total">The overall 0-100 drive score (web <c>score.total</c>).</param>
/// <param name="TotalText">The visible score figure (web <c>{score.total}</c>).</param>
/// <param name="ScoreColorHex">The threshold colour for the gauge arc and score figure (web <c>getScoreColor</c>).</param>
/// <param name="GaugeFraction">The gauge sweep fraction [0,1] (web <c>score.total / 100</c>).</param>
/// <param name="GaugeAccessibleName">The accessible name Narrator reads for the gauge ("{caption} {total}").</param>
/// <param name="Components">The four breakdown rows (efficiency, speed, range, trip).</param>
public sealed record DriveScoreDisplay(
    DriveScoreBreakdown Breakdown,
    string Title,
    string ScoreCaption,
    int Total,
    string TotalText,
    string ScoreColorHex,
    double GaugeFraction,
    string GaugeAccessibleName,
    IReadOnlyList<DriveScoreComponent> Components);

/// <summary>
/// Pure projection from a <see cref="DriveScoreModel"/> to its <see cref="DriveScoreDisplay"/> — the native port
/// of web/src/components/data-display/DriveScore.tsx. <see cref="Compute"/> reproduces <c>computeDriveScore</c>
/// term-for-term (the SI fallbacks, the four weighted components and the JS half-up rounding) and
/// <see cref="ScoreColorHex"/> reproduces <c>getScoreColor</c>'s threshold ladder. <see cref="Project"/> resolves
/// every label through the i18n facade with the exact key the web source uses and assembles the bar fractions,
/// the gauge sweep and the accessible names. No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class DriveScoreProjection
{
    /// <summary>i18n key for the panel title (web <c>'driveScore.title'</c>).</summary>
    public const string TitleKey = "driveScore.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web default value).</summary>
    public const string TitleFallback = "Drive Score";

    /// <summary>i18n key for the gauge caption (web <c>'driveScore.score'</c>).</summary>
    public const string ScoreKey = "driveScore.score";

    /// <summary>English fallback for <see cref="ScoreKey"/> (web default value).</summary>
    public const string ScoreFallback = "Score";

    /// <summary>i18n key for the efficiency component (web <c>'driveScore.efficiency'</c>).</summary>
    public const string EfficiencyKey = "driveScore.efficiency";

    /// <summary>English fallback for <see cref="EfficiencyKey"/> (web default value).</summary>
    public const string EfficiencyFallback = "Efficiency";

    /// <summary>i18n key for the speed-discipline component (web <c>'driveScore.speedDiscipline'</c>).</summary>
    public const string SpeedDisciplineKey = "driveScore.speedDiscipline";

    /// <summary>English fallback for <see cref="SpeedDisciplineKey"/> (web default value).</summary>
    public const string SpeedDisciplineFallback = "Speed Discipline";

    /// <summary>i18n key for the range-preservation component (web <c>'driveScore.rangePreservation'</c>).</summary>
    public const string RangePreservationKey = "driveScore.rangePreservation";

    /// <summary>English fallback for <see cref="RangePreservationKey"/> (web default value).</summary>
    public const string RangePreservationFallback = "Range Preservation";

    /// <summary>i18n key for the trip-length component (web <c>'driveScore.tripLength'</c>).</summary>
    public const string TripLengthKey = "driveScore.tripLength";

    /// <summary>English fallback for <see cref="TripLengthKey"/> (web default value).</summary>
    public const string TripLengthFallback = "Trip Length";

    /// <summary>The efficiency bar palette hex — web neon cyan (web <c>'#00f0ff'</c>).</summary>
    public const string EfficiencyColorHex = "#00f0ff";

    /// <summary>The speed-discipline bar palette hex — web purple (web <c>'#a855f7'</c>).</summary>
    public const string SpeedColorHex = "#a855f7";

    /// <summary>The range-preservation bar palette hex — web emerald (web <c>'#10b981'</c>).</summary>
    public const string RangeColorHex = "#10b981";

    /// <summary>The trip-length bar palette hex — web amber (web <c>'#f59e0b'</c>).</summary>
    public const string TripColorHex = "#f59e0b";

    /// <summary>The gauge / score colour below 40 — web <c>COLOR.BAD</c> (web <c>'#ef4444'</c>).</summary>
    public const string ScoreBadColorHex = "#ef4444";

    /// <summary>The gauge / score colour in [40,70) — web <c>COLOR.WARN</c> (web <c>'#f59e0b'</c>).</summary>
    public const string ScoreWarnColorHex = "#f59e0b";

    /// <summary>The gauge / score colour at or above 70 — web <c>COLOR.GOOD</c> (web <c>'#10b981'</c>).</summary>
    public const string ScoreGoodColorHex = "#10b981";

    /// <summary>The efficiency component's maximum points (web <c>max: 40</c>).</summary>
    public const int EfficiencyMax = 40;

    /// <summary>The speed-discipline component's maximum points (web <c>max: 20</c>).</summary>
    public const int SpeedMax = 20;

    /// <summary>The range-preservation component's maximum points (web <c>max: 20</c>).</summary>
    public const int RangeMax = 20;

    /// <summary>The trip-length component's maximum points (web <c>max: 20</c>).</summary>
    public const int TripMax = 20;

    // computeDriveScore constants (web/src/components/data-display/DriveScore.tsx):
    // assume ~75 kWh usable battery, so each percent of state-of-charge is ~750 Wh.
    private const double WhPerBatteryPercent = 750;
    private const double OptimalWhPerKm = 150;
    private const double DefaultWhPerKm = 250;        // web fallback when distance is zero
    private const double DefaultSpeedRatio = 0.5;     // web fallback when max speed is zero
    private const double DefaultBatteryPerKm = 1;     // web fallback when distance is zero
    private const double BestBatteryPerKm = 0.1;      // web best-case 0.1 %/km
    private const double BatteryPerKmSpan = 0.9;      // web worst-case 1 %/km minus best-case
    private const double TripPlateauKm = 50;          // web trip-length plateau
    private const double MetresPerKm = 1000;
    private const double DefaultStartBatteryPct = 100;

    /// <summary>
    /// Reproduces the web <c>computeDriveScore</c> term-for-term. Reads the SI drive fields (with the web
    /// fallbacks), derives the four weighted components (efficiency 0-40, speed discipline 0-20, range
    /// preservation 0-20, trip length 0-20) and the half-up-rounded clamped total 0-100.
    /// </summary>
    /// <param name="model">The render-time drive inputs (the web props).</param>
    /// <returns>The rounded four-part breakdown plus the total.</returns>
    public static DriveScoreBreakdown Compute(DriveScoreModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        // Drive fields are SI canonical: metres, seconds and m/s.
        double distanceM = model.DistanceM ?? 0;
        double distanceKm = distanceM / MetresPerKm;
        double durationS = model.DurationS ?? 0;
        double avgSpeedMps = durationS > 0 ? distanceM / durationS : 0;
        double maxSpeedMps = model.MaxSpeedMps ?? avgSpeedMps;
        double startBattery = model.StartBatteryPct ?? DefaultStartBatteryPct;
        double endBattery = model.EndBatteryPct ?? startBattery;

        // Efficiency component (40 pts): closer to the optimal 150 Wh/km scores higher.
        double batteryUsed = Math.Max(startBattery - endBattery, 0);
        double whPerKm = distanceKm > 0 ? (batteryUsed * WhPerBatteryPercent) / distanceKm : DefaultWhPerKm;
        double effDeviation = Math.Abs(whPerKm - OptimalWhPerKm) / OptimalWhPerKm;
        double efficiency = Clamp(EfficiencyMax * (1 - effDeviation), 0, EfficiencyMax);

        // Speed discipline (20 pts): a smaller average/peak ratio means smoother driving.
        double speedRatio = maxSpeedMps > 0 ? avgSpeedMps / maxSpeedMps : DefaultSpeedRatio;
        double speed = Clamp(SpeedMax * speedRatio, 0, SpeedMax);

        // Range preservation (20 pts): less battery used per km scores higher.
        double batteryPerKm = distanceKm > 0 ? batteryUsed / distanceKm : DefaultBatteryPerKm;
        double rangeScore = Clamp(RangeMax * (1 - ((batteryPerKm - BestBatteryPerKm) / BatteryPerKmSpan)), 0, RangeMax);

        // Trip length (20 pts): longer trips score higher, plateauing at 50 km.
        double tripScore = Clamp(TripMax * Math.Min(distanceKm / TripPlateauKm, 1), 0, TripMax);

        int total = RoundHalfUp(Clamp(efficiency + speed + rangeScore + tripScore, 0, 100));

        return new DriveScoreBreakdown(
            total,
            RoundHalfUp(efficiency),
            RoundHalfUp(speed),
            RoundHalfUp(rangeScore),
            RoundHalfUp(tripScore));
    }

    /// <summary>
    /// Reproduces the web <c>getScoreColor</c> threshold ladder: below 40 is <see cref="ScoreBadColorHex"/>,
    /// below 70 is <see cref="ScoreWarnColorHex"/>, otherwise <see cref="ScoreGoodColorHex"/>.
    /// </summary>
    /// <param name="total">The overall 0-100 drive score.</param>
    /// <returns>The shared palette hex for the gauge arc and the score figure.</returns>
    public static string ScoreColorHex(int total)
    {
        if (total < 40)
        {
            return ScoreBadColorHex;
        }

        if (total < 70)
        {
            return ScoreWarnColorHex;
        }

        return ScoreGoodColorHex;
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time drive inputs (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static DriveScoreDisplay Project(DriveScoreModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DriveScoreBreakdown breakdown = Compute(model);
        string scoreCaption = localizer.GetString(ScoreKey, ScoreFallback);
        string title = localizer.GetString(TitleKey, TitleFallback);

        var components = new[]
        {
            Component(localizer.GetString(EfficiencyKey, EfficiencyFallback), breakdown.Efficiency, EfficiencyMax, EfficiencyColorHex),
            Component(localizer.GetString(SpeedDisciplineKey, SpeedDisciplineFallback), breakdown.Speed, SpeedMax, SpeedColorHex),
            Component(localizer.GetString(RangePreservationKey, RangePreservationFallback), breakdown.Range, RangeMax, RangeColorHex),
            Component(localizer.GetString(TripLengthKey, TripLengthFallback), breakdown.Trip, TripMax, TripColorHex),
        };

        string totalText = breakdown.Total.ToString(CultureInfo.InvariantCulture);

        return new DriveScoreDisplay(
            Breakdown: breakdown,
            Title: title,
            ScoreCaption: scoreCaption,
            Total: breakdown.Total,
            TotalText: totalText,
            ScoreColorHex: ScoreColorHex(breakdown.Total),
            GaugeFraction: Clamp(breakdown.Total / 100.0, 0, 1),
            GaugeAccessibleName: $"{scoreCaption} {totalText}",
            Components: components);
    }

    /// <summary>The clamp helper the web source uses (<c>max(min, min(max, v))</c>).</summary>
    /// <param name="value">The value to constrain.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The inclusive upper bound.</param>
    public static double Clamp(double value, double min, double max) => Math.Max(min, Math.Min(max, value));

    /// <summary>
    /// JavaScript <c>Math.round</c> for the finite non-negative score domain: half rounds up toward positive
    /// infinity (<c>floor(value + 0.5)</c>), so 12.5 becomes 13 — matching the web <c>Math.round</c> the source
    /// applies to each component and the total.
    /// </summary>
    /// <param name="value">The finite non-negative value to round.</param>
    public static int RoundHalfUp(double value) => (int)Math.Floor(value + 0.5);

    private static DriveScoreComponent Component(string label, int value, int max, string colorHex)
    {
        string valueText = value.ToString(CultureInfo.InvariantCulture);
        string maxText = max.ToString(CultureInfo.InvariantCulture);
        double fraction = max > 0 ? Clamp((double)value / max, 0, 1) : 0;

        return new DriveScoreComponent(
            Label: label,
            Value: value,
            Max: max,
            ColorHex: colorHex,
            Fraction: fraction,
            ValueText: $"{valueText}/{maxText}",
            AccessibleName: $"{label} {valueText} / {maxText}");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>DriveScore</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the drive inputs or the resulting score — so
/// a diagnostics line can never leak fleet state. Thread-safe.
/// </summary>
public sealed class DriveScoreDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public DriveScoreDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveScore</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveScoreRegistration.Slug}");
    }
}
