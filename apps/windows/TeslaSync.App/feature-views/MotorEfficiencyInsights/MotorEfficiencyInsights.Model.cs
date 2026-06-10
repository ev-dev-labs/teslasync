using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>MotorEfficiencyInsights</c> surface — the native union of the
/// states the P2 feature-view contract requires for the driving-dynamics motor insights
/// (web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx). The web component is a
/// pure presentational child: it takes already-resolved <c>motorStats</c> / <c>throttleStyle</c> props plus the
/// temperature display preference and performs no fetching, so the parent Driving-Dynamics page owns the query
/// lifecycle and supplies the active state. The native surface reproduces the full loading / ready / empty /
/// error / stale / offline matrix the prompt mandates; every member maps onto a visible surface (the three
/// glass panels, a skeleton, or a retry affordance) and none is ever hidden behind a <c>{data &amp;&amp; …}</c>
/// guard. <see cref="Empty"/> mirrors the web rendering each panel's <c>noData</c> branch when
/// <c>motorStats</c> is null (the "No motor data recorded yet" surface), never a blank box.
/// </summary>
public enum MotorEfficiencyInsightsState
{
    /// <summary>The parent query is in flight and no motor stats have arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved motor stats to render — the three motor panels (web fall-through).</summary>
    Ready,

    /// <summary>Resolved with no motor stats — each panel shows its friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — the panels plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached panels plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The driving style derived from a drive's average motor power — the native mirror of the web
/// <c>ThrottleStyle = 'conservative' | 'moderate' | 'aggressive'</c>
/// (web/src/features/driving/components/driving-dynamics/helpers.ts). Drives the Throttle-Behavior panel's
/// badge tone (conservative → success, moderate → warning, aggressive → danger) and the metric-bar fill colour,
/// exactly as the web component keys both off the style.
/// </summary>
public enum ThrottleStyle
{
    /// <summary>Gentle pedal use — average power below the conservative ceiling (web <c>'conservative'</c>).</summary>
    Conservative,

    /// <summary>Moderate pedal use — average power below the moderate ceiling (web <c>'moderate'</c>).</summary>
    Moderate,

    /// <summary>Spirited pedal use — average power at or above the moderate ceiling (web <c>'aggressive'</c>).</summary>
    Aggressive,
}

/// <summary>
/// Classifies a drive's average motor power into a <see cref="ThrottleStyle"/> — the 1:1 native port of the web
/// <c>getThrottleStyle(avgPower)</c> helper
/// (web/src/features/driving/components/driving-dynamics/helpers.ts): below 20&#160;kW is conservative, below
/// 80&#160;kW is moderate, otherwise aggressive. Power is the SI-derived kilowatt figure the API delivers
/// (<c>power_kw</c>); the same fixed thresholds apply regardless of the user's display units. Pure logic —
/// unit-tested without a UI host.
/// </summary>
public static class ThrottleStyles
{
    /// <summary>Average power (kW) below which a drive is classified conservative (web <c>avgPower &lt; 20</c>).</summary>
    public const double ConservativeCeilingKw = 20;

    /// <summary>Average power (kW) below which a drive is classified moderate (web <c>avgPower &lt; 80</c>).</summary>
    public const double ModerateCeilingKw = 80;

    /// <summary>Map an average motor power in kW to its driving style (web <c>getThrottleStyle</c>).</summary>
    /// <param name="averagePowerKw">The drive's average motor power in kilowatts (web <c>avgPower</c>).</param>
    /// <returns>The classified <see cref="ThrottleStyle"/>.</returns>
    public static ThrottleStyle FromAveragePower(double averagePowerKw)
    {
        if (averagePowerKw < ConservativeCeilingKw)
        {
            return ThrottleStyle.Conservative;
        }

        return averagePowerKw < ModerateCeilingKw ? ThrottleStyle.Moderate : ThrottleStyle.Aggressive;
    }
}

/// <summary>
/// One motor-telemetry sample the <see cref="MotorStatsComputation"/> aggregates — the native mirror of the
/// exact <c>MotorSnapshot</c> slice the web <c>computeMotorStats</c> reads
/// (web/src/features/driving/components/driving-dynamics/helpers.ts). Every field is nullable so a missing key
/// is skipped exactly like the web <c>!= null</c> guards; torques are SI newton-metres, temperatures SI Celsius
/// and powers the SI-derived kilowatts the API delivers (<c>torque_nm_*</c> / <c>motor_temp_c_*</c> /
/// <c>power_kw</c> / <c>regen_kw</c>). Pure data — no WinUI types.
/// </summary>
/// <param name="TorqueNmFront">Front-axle torque in newton-metres, or null (web <c>torque_nm_front</c>).</param>
/// <param name="TorqueNmRear">Rear-axle torque in newton-metres, or null (web <c>torque_nm_rear</c>).</param>
/// <param name="MotorTempCelsiusFront">Front motor temperature in SI Celsius, or null (web <c>motor_temp_c_front</c>).</param>
/// <param name="MotorTempCelsiusRear">Rear motor temperature in SI Celsius, or null (web <c>motor_temp_c_rear</c>).</param>
/// <param name="PowerKw">Drive power in kilowatts, or null (web <c>power_kw</c>).</param>
/// <param name="RegenKw">Regen power in kilowatts, or null (web <c>regen_kw</c>).</param>
public sealed record MotorHistorySample(
    double? TorqueNmFront,
    double? TorqueNmRear,
    double? MotorTempCelsiusFront,
    double? MotorTempCelsiusRear,
    double? PowerKw,
    double? RegenKw);

/// <summary>
/// The aggregated motor statistics a drive's motor history rolls up to — the native mirror of the web
/// <c>MotorStats</c> (web/src/features/driving/components/driving-dynamics/helpers.ts). Torques are SI
/// newton-metres, temperatures SI Celsius and powers the SI-derived kilowatts the API delivers;
/// <see cref="HighTorquePct"/> is a 0..100 percentage. The <c>MotorEfficiencyInsights</c> surface displays
/// <see cref="AvgTorqueNm"/>, <see cref="MaxTorqueNm"/>, <see cref="HighTorquePct"/>, <see cref="AvgPowerKw"/>,
/// <see cref="AvgMotorTempCelsius"/> and <see cref="MaxMotorTempCelsius"/>; the remaining fields complete the
/// web record so the computation round-trips losslessly. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="TotalReadings">The number of samples aggregated (web <c>totalReadings</c>).</param>
/// <param name="AvgTorqueNm">Mean combined axle torque in Nm (web <c>avgTorque</c>).</param>
/// <param name="MaxTorqueNm">Peak combined axle torque in Nm (web <c>maxTorque</c>).</param>
/// <param name="AvgMotorTempCelsius">Mean per-sample max motor temperature in SI Celsius (web <c>avgMotorTemp</c>).</param>
/// <param name="MaxMotorTempCelsius">Peak motor temperature in SI Celsius (web <c>maxMotorTemp</c>).</param>
/// <param name="AvgPowerKw">Mean drive power in kW (web <c>avgPower</c>).</param>
/// <param name="PeakPowerKw">Peak drive power in kW (web <c>peakPower</c>).</param>
/// <param name="MinPowerKw">Minimum drive power in kW (web <c>minPower</c>).</param>
/// <param name="PeakRegenKw">Peak regen power in kW (web <c>peakRegen</c>).</param>
/// <param name="HighTorquePct">Share of samples above the high-torque threshold, 0..100 (web <c>highTorquePct</c>).</param>
public sealed record MotorStats(
    int TotalReadings,
    double AvgTorqueNm,
    double MaxTorqueNm,
    double AvgMotorTempCelsius,
    double MaxMotorTempCelsius,
    double AvgPowerKw,
    double PeakPowerKw,
    double MinPowerKw,
    double PeakRegenKw,
    double HighTorquePct);

/// <summary>
/// Aggregates a drive's motor history into a <see cref="MotorStats"/> — the 1:1 native port of the web
/// <c>computeMotorStats(motorHistory)</c> (web/src/features/driving/components/driving-dynamics/helpers.ts) and
/// the surface's "cached telemetry → projection" data adapter. Like the web helper it returns
/// <see langword="null"/> for an absent / empty history (the surface then shows its empty state); a sample is
/// included in the torque series only when at least one axle torque is present (the missing axle counts as 0),
/// and in the temperature series only when at least one motor temperature is present (the per-sample value is
/// the warmer of the two). Powers and regen come straight from the present <c>power_kw</c> / <c>regen_kw</c>
/// readings. Pure logic — unit-tested without a UI host.
/// </summary>
public static class MotorStatsComputation
{
    /// <summary>Combined axle torque (Nm) above which a sample counts toward <c>highTorquePct</c> (web <c>t &gt; 200</c>).</summary>
    public const double HighTorqueThresholdNm = 200;

    /// <summary>Aggregate <paramref name="history"/> into motor statistics, or null when there is nothing to aggregate.</summary>
    /// <param name="history">The drive's motor-telemetry samples (web <c>motorHistory</c>); null or empty → null.</param>
    /// <returns>The aggregated <see cref="MotorStats"/>, or <see langword="null"/> when the history is empty.</returns>
    public static MotorStats? Compute(IReadOnlyList<MotorHistorySample>? history)
    {
        IReadOnlyList<MotorHistorySample> samples = history ?? Array.Empty<MotorHistorySample>();
        if (samples.Count == 0)
        {
            return null;
        }

        var torques = new List<double>();
        var motorTemps = new List<double>();
        var powers = new List<double>();
        var regens = new List<double>();

        foreach (MotorHistorySample sample in samples)
        {
            // web: skip the sample only when BOTH axles are null; otherwise sum (the missing axle counts as 0).
            if (sample.TorqueNmFront is not null || sample.TorqueNmRear is not null)
            {
                torques.Add((sample.TorqueNmFront ?? 0) + (sample.TorqueNmRear ?? 0));
            }

            // web: skip only when BOTH motor temps are null; otherwise take the warmer (null → -Infinity).
            if (sample.MotorTempCelsiusFront is not null || sample.MotorTempCelsiusRear is not null)
            {
                motorTemps.Add(Math.Max(
                    sample.MotorTempCelsiusFront ?? double.NegativeInfinity,
                    sample.MotorTempCelsiusRear ?? double.NegativeInfinity));
            }

            if (sample.PowerKw is { } power)
            {
                powers.Add(power);
            }

            if (sample.RegenKw is { } regen)
            {
                regens.Add(regen);
            }
        }

        double highTorquePct = torques.Count > 0
            ? (double)CountAbove(torques, HighTorqueThresholdNm) / torques.Count * 100
            : 0;

        return new MotorStats(
            TotalReadings: samples.Count,
            AvgTorqueNm: Average(torques),
            MaxTorqueNm: Max(torques),
            AvgMotorTempCelsius: Average(motorTemps),
            MaxMotorTempCelsius: Max(motorTemps),
            AvgPowerKw: Average(powers),
            PeakPowerKw: Max(powers),
            MinPowerKw: Min(powers),
            PeakRegenKw: Max(regens),
            HighTorquePct: highTorquePct);
    }

    private static double Average(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double sum = 0;
        foreach (double value in values)
        {
            sum += value;
        }

        return sum / values.Count;
    }

    private static double Max(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double max = double.NegativeInfinity;
        foreach (double value in values)
        {
            if (value > max)
            {
                max = value;
            }
        }

        return max;
    }

    private static double Min(List<double> values)
    {
        if (values.Count == 0)
        {
            return 0;
        }

        double min = double.PositiveInfinity;
        foreach (double value in values)
        {
            if (value < min)
            {
                min = value;
            }
        }

        return min;
    }

    private static int CountAbove(List<double> values, double threshold)
    {
        int count = 0;
        foreach (double value in values)
        {
            if (value > threshold)
            {
                count++;
            }
        }

        return count;
    }
}

/// <summary>
/// The render-time data model the <c>MotorEfficiencyInsights</c> view binds to — the native analogue of the web
/// component's props (<c>motorStats</c> / <c>throttleStyle</c> plus the temperature display preference,
/// web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx) plus the parent-supplied
/// lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent Driving-Dynamics
/// state holder fills this in (the native P1/S8 seam). Motor stats stay SI (Nm / °C / kW); the temperature is
/// converted to the user's display unit only at projection time. <see cref="Style"/> is optional — when the
/// stats are present and no style is supplied, the projection derives it from the average power exactly like the
/// web parent (<c>throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null</c>). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Stats">The aggregated motor stats (web <c>motorStats</c>), or null when there are none.</param>
/// <param name="Style">The driving style (web <c>throttleStyle</c>), or null to derive from the average power.</param>
/// <param name="Units">The user's unit preference (only <see cref="UnitPref.Temperature"/> is read).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record MotorEfficiencyInsightsModel(
    MotorEfficiencyInsightsState Status,
    MotorStats? Stats,
    ThrottleStyle? Style,
    UnitPref Units,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the parent query is in flight and no stats have arrived yet.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static MotorEfficiencyInsightsModel Loading(UnitPref? units = null) =>
        new(MotorEfficiencyInsightsState.Loading, null, null, units ?? UnitPref.Metric);

    /// <summary>A resolved model with no motor stats — each panel shows its empty state.</summary>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static MotorEfficiencyInsightsModel Empty(UnitPref? units = null) =>
        new(MotorEfficiencyInsightsState.Empty, null, null, units ?? UnitPref.Metric);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    public static MotorEfficiencyInsightsModel Failed(string? message = null, UnitPref? units = null) =>
        new(MotorEfficiencyInsightsState.Error, null, null, units ?? UnitPref.Metric, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the motor stats to render.</summary>
    /// <param name="stats">The aggregated motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static MotorEfficiencyInsightsModel Ready(
        MotorStats stats,
        ThrottleStyle? style = null,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(MotorEfficiencyInsightsState.Ready, stats, style, units ?? UnitPref.Metric, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached motor stats.</summary>
    /// <param name="stats">The cached motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static MotorEfficiencyInsightsModel Stale(
        MotorStats stats,
        ThrottleStyle? style = null,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(MotorEfficiencyInsightsState.Stale, stats, style, units ?? UnitPref.Metric, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached motor stats.</summary>
    /// <param name="stats">The cached motor stats.</param>
    /// <param name="style">The driving style, or null to derive from the average power.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static MotorEfficiencyInsightsModel Offline(
        MotorStats stats,
        ThrottleStyle? style = null,
        UnitPref? units = null,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(stats);
        return new(
            MotorEfficiencyInsightsState.Offline, stats, style, units ?? UnitPref.Metric, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// The projected, render-ready Torque-Distribution panel — the native analogue of the web component's first
/// glass panel. When <see cref="HasData"/> is true the three readouts (<see cref="AvgValueText"/>,
/// <see cref="MaxValueText"/>, <see cref="HighValueText"/>) carry the formatted "Nm" / "%" strings; otherwise
/// the panel renders <see cref="EmptyMessage"/> (web <c>noData</c>). Pure data.
/// </summary>
/// <param name="Title">Localized panel title (web "Torque Distribution").</param>
/// <param name="HasData">True when motor stats are present (render the readouts), false (render the empty state).</param>
/// <param name="AvgLabel">Localized "Avg Torque" row label.</param>
/// <param name="AvgValueText">Formatted average torque (e.g. "50.0 Nm").</param>
/// <param name="MaxLabel">Localized "Max Torque" row label.</param>
/// <param name="MaxValueText">Formatted peak torque (e.g. "200.0 Nm").</param>
/// <param name="HighLabel">Localized "High Torque Time" row label.</param>
/// <param name="HighValueText">Formatted high-torque share (e.g. "10.0%").</param>
/// <param name="EmptyMessage">Localized empty-state message shown when there are no stats.</param>
/// <param name="AutomationName">Narrator name for the panel.</param>
public sealed record MotorTorquePanelDisplay(
    string Title,
    bool HasData,
    string AvgLabel,
    string AvgValueText,
    string MaxLabel,
    string MaxValueText,
    string HighLabel,
    string HighValueText,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The projected, render-ready Throttle-Behavior panel — the native analogue of the web component's second
/// glass panel. When <see cref="HasData"/> is true it carries the average-power readout, the style badge
/// (<see cref="StyleBadgeText"/> tinted by <see cref="StyleStatus"/>) and the metric bar
/// (<see cref="BarValue"/> over <see cref="BarMax"/>, filled with <see cref="BarAccentBrushKey"/>); otherwise
/// the panel renders <see cref="EmptyMessage"/> (web <c>noData</c>). The bar mirrors the web
/// <c>MetricBar</c> with an empty label / sublabel so no stray readout is drawn. Pure data.
/// </summary>
/// <param name="Title">Localized panel title (web "Throttle Behavior").</param>
/// <param name="HasData">True when motor stats are present (render the readouts), false (render the empty state).</param>
/// <param name="AvgPowerLabel">Localized "Avg Power" row label.</param>
/// <param name="AvgPowerValueText">Formatted average power (e.g. "0.0 kW").</param>
/// <param name="StyleLabel">Localized "Style" row label.</param>
/// <param name="StyleBadgeText">Localized driving-style badge text (Conservative / Moderate / Aggressive).</param>
/// <param name="StyleStatus">Semantic tone for the style badge and the metric-bar fill.</param>
/// <param name="BarValue">The metric-bar value — the average power in kW (web <c>value={avgPower}</c>).</param>
/// <param name="BarMax">The metric-bar maximum (web <c>max={200}</c>).</param>
/// <param name="BarAccentBrushKey">Token brush key the metric-bar fill uses (driven by the style).</param>
/// <param name="EmptyMessage">Localized empty-state message shown when there are no stats.</param>
/// <param name="AutomationName">Narrator name for the panel.</param>
public sealed record MotorThrottlePanelDisplay(
    string Title,
    bool HasData,
    string AvgPowerLabel,
    string AvgPowerValueText,
    string StyleLabel,
    string StyleBadgeText,
    StatusKind StyleStatus,
    double BarValue,
    double BarMax,
    string BarAccentBrushKey,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The projected, render-ready Motor-Thermal panel — the native analogue of the web component's third glass
/// panel. When <see cref="HasData"/> is true it carries the average / max temperature readouts (already
/// converted to the user's display unit) and the thermal badge (<see cref="ThermalBadgeText"/> tinted by
/// <see cref="ThermalStatus"/>); otherwise the panel renders <see cref="EmptyMessage"/> (web <c>noData</c>).
/// The thermal severity is computed from the raw SI Celsius peak exactly like the web (&lt; 100 good, &lt; 140
/// warm, otherwise hot). Pure data.
/// </summary>
/// <param name="Title">Localized panel title (web "Motor Thermal").</param>
/// <param name="HasData">True when motor stats are present (render the readouts), false (render the empty state).</param>
/// <param name="AvgTempLabel">Localized "Avg Motor Temp" row label.</param>
/// <param name="AvgTempValueText">Formatted average temperature in display units (e.g. "49.0°C").</param>
/// <param name="MaxTempLabel">Localized "Max Motor Temp" row label.</param>
/// <param name="MaxTempValueText">Formatted peak temperature in display units (e.g. "64.0°C").</param>
/// <param name="ThermalBadgeText">Localized thermal badge text (Thermal: Good / Warm / Hot).</param>
/// <param name="ThermalStatus">Semantic tone for the thermal badge.</param>
/// <param name="EmptyMessage">Localized empty-state message shown when there are no stats.</param>
/// <param name="AutomationName">Narrator name for the panel.</param>
public sealed record MotorThermalPanelDisplay(
    string Title,
    bool HasData,
    string AvgTempLabel,
    string AvgTempValueText,
    string MaxTempLabel,
    string MaxTempValueText,
    string ThermalBadgeText,
    StatusKind ThermalStatus,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the motor efficiency insights — the native analogue of everything
/// the web <c>MotorEfficiencyInsights</c> renders. Holds the active <see cref="State"/>, the three projected
/// panels, the freshness chip copy + status (shown only for <see cref="MotorEfficiencyInsightsState.Stale"/> /
/// <see cref="MotorEfficiencyInsightsState.Offline"/>), the loading / error copy and retry label, the freshness
/// timestamp + fetching flag, and the surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record MotorEfficiencyInsightsDisplay(
    MotorEfficiencyInsightsState State,
    MotorTorquePanelDisplay Torque,
    MotorThrottlePanelDisplay Throttle,
    MotorThermalPanelDisplay Thermal,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="MotorEfficiencyInsightsModel"/> to its
/// <see cref="MotorEfficiencyInsightsDisplay"/> — the native port of
/// web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx. Branch precedence mirrors
/// the web parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no stats
/// collapses to the empty branch (each panel shows its <c>noData</c> message), while a stale / offline snapshot
/// keeps its cached panels under a freshness chip. SI motor stats are formatted here via
/// <see cref="NumberFormatting"/> (the 1:1 port of the web <c>fmtNumber</c>, fixed to one decimal exactly like
/// the web calls), the temperature is converted to the display unit via
/// <see cref="UnitConverters.TemperatureFromSi"/> and suffixed with the unit label (which already carries the
/// degree sign — never doubled), the throttle style is derived from the average power when absent
/// (<see cref="ThrottleStyles.FromAveragePower"/>) and the thermal severity is computed from the raw SI Celsius
/// peak. Every label resolves through the i18n facade using the same keys the web feeds into <c>t(...)</c>. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class MotorEfficiencyInsightsProjection
{
    /// <summary>Decimal places for every readout — the web passes <c>fmtNumber(value, 1)</c> throughout.</summary>
    public const int ValuePrecision = 1;

    /// <summary>The metric-bar maximum power in kW (web <c>MetricBar max={200}</c>).</summary>
    public const double MetricBarMaxKw = 200;

    /// <summary>Peak motor temperature (°C) below which the thermal badge reads "Good" (web <c>&lt; 100</c>).</summary>
    public const double ThermalGoodCeilingCelsius = 100;

    /// <summary>Peak motor temperature (°C) below which the thermal badge reads "Warm" (web <c>&lt; 140</c>).</summary>
    public const double ThermalWarmCeilingCelsius = 140;

    private const string TorqueUnitSuffix = " Nm";   // web "{n} Nm"
    private const string PowerUnitSuffix = " kW";     // web "{n} kW"
    private const string PercentSuffix = "%";          // web "{n}%"

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus units + lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static MotorEfficiencyInsightsDisplay Project(MotorEfficiencyInsightsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        MotorEfficiencyInsightsState state = SelectState(model);

        string emptyMessage = localizer.GetString("dynamics.noMotorData", "No motor data recorded yet");
        MotorTorquePanelDisplay torque = BuildTorque(model.Stats, emptyMessage, localizer);
        MotorThrottlePanelDisplay throttle = BuildThrottle(model.Stats, model.Style, emptyMessage, localizer);
        MotorThermalPanelDisplay thermal = BuildThermal(model.Stats, model.Units.Temperature, model.Units.Locale, emptyMessage, localizer);

        bool showChip = state is MotorEfficiencyInsightsState.Stale or MotorEfficiencyInsightsState.Offline;
        string chipText = state switch
        {
            MotorEfficiencyInsightsState.Offline => localizer.GetString("common.offline", "Offline"),
            MotorEfficiencyInsightsState.Stale => localizer.GetString("common.stale", "Stale"),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == MotorEfficiencyInsightsState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string errorTitle = localizer.GetString("dynamics.motorInsightsError", "Couldn't load motor insights");
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(
                "dynamics.motorInsightsErrorMessage",
                "We couldn't load the motor efficiency insights. Please try again.")
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        string automationName = BuildAutomationName(
            state, torque, throttle, thermal, showChip, chipText, loadingLabel, errorTitle);

        return new MotorEfficiencyInsightsDisplay(
            State: state,
            Torque: torque,
            Throttle: throttle,
            Thermal: thermal,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Maps a driving style to its badge / metric-bar tone — the native port of the web ternary
    /// (conservative → success, moderate → warning, aggressive → danger).
    /// </summary>
    /// <param name="style">The driving style.</param>
    /// <returns>The semantic tone the badge and bar fill use.</returns>
    public static StatusKind ThrottleStatusFor(ThrottleStyle style) => style switch
    {
        ThrottleStyle.Conservative => StatusKind.Success,
        ThrottleStyle.Moderate => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>
    /// Maps a peak motor temperature to its thermal badge tone — the native port of the web threshold computed
    /// from the raw SI Celsius value (&lt; <see cref="ThermalGoodCeilingCelsius"/> good,
    /// &lt; <see cref="ThermalWarmCeilingCelsius"/> warm, otherwise hot). Display units never change the
    /// classification.
    /// </summary>
    /// <param name="maxMotorTempCelsius">The peak motor temperature in SI Celsius.</param>
    /// <returns>The semantic tone the thermal badge uses.</returns>
    public static StatusKind ThermalStatusFor(double maxMotorTempCelsius)
    {
        if (maxMotorTempCelsius < ThermalGoodCeilingCelsius)
        {
            return StatusKind.Success;
        }

        return maxMotorTempCelsius < ThermalWarmCeilingCelsius ? StatusKind.Warning : StatusKind.Danger;
    }

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot with no stats has nothing to render
    // and collapses to the empty branch, while a stale / offline snapshot keeps its cached panels.
    private static MotorEfficiencyInsightsState SelectState(MotorEfficiencyInsightsModel model) => model.Status switch
    {
        MotorEfficiencyInsightsState.Loading => MotorEfficiencyInsightsState.Loading,
        MotorEfficiencyInsightsState.Error => MotorEfficiencyInsightsState.Error,
        MotorEfficiencyInsightsState.Empty => MotorEfficiencyInsightsState.Empty,
        MotorEfficiencyInsightsState.Stale => MotorEfficiencyInsightsState.Stale,
        MotorEfficiencyInsightsState.Offline => MotorEfficiencyInsightsState.Offline,
        _ => model.Stats is not null ? MotorEfficiencyInsightsState.Ready : MotorEfficiencyInsightsState.Empty,
    };

    private static MotorTorquePanelDisplay BuildTorque(MotorStats? stats, string emptyMessage, ILocalizer localizer)
    {
        string title = localizer.GetString("dynamics.torqueDistribution", "Torque Distribution");
        string avgLabel = localizer.GetString("dynamics.avgTorque", "Avg Torque");
        string maxLabel = localizer.GetString("dynamics.maxTorque", "Max Torque");
        string highLabel = localizer.GetString("dynamics.highTorqueTime", "High Torque Time");

        if (stats is not { } s)
        {
            return new MotorTorquePanelDisplay(
                title, false, avgLabel, string.Empty, maxLabel, string.Empty, highLabel, string.Empty,
                emptyMessage, JoinName(title, emptyMessage));
        }

        string avgValue = FormatTorque(s.AvgTorqueNm);
        string maxValue = FormatTorque(s.MaxTorqueNm);
        string highValue = FormatPercent(s.HighTorquePct);
        string automation = JoinName(
            title,
            $"{avgLabel} {avgValue}",
            $"{maxLabel} {maxValue}",
            $"{highLabel} {highValue}");

        return new MotorTorquePanelDisplay(
            title, true, avgLabel, avgValue, maxLabel, maxValue, highLabel, highValue, emptyMessage, automation);
    }

    private static MotorThrottlePanelDisplay BuildThrottle(
        MotorStats? stats,
        ThrottleStyle? style,
        string emptyMessage,
        ILocalizer localizer)
    {
        string title = localizer.GetString("dynamics.throttleBehavior", "Throttle Behavior");
        string avgPowerLabel = localizer.GetString("dynamics.avgPower", "Avg Power");
        string styleLabel = localizer.GetString("dynamics.drivingStyle", "Style");

        if (stats is not { } s)
        {
            return new MotorThrottlePanelDisplay(
                title, false, avgPowerLabel, string.Empty, styleLabel, string.Empty, StatusKind.Neutral,
                0, MetricBarMaxKw, StatusResources.AccentBrushKey(StatusKind.Neutral), emptyMessage,
                JoinName(title, emptyMessage));
        }

        // web parent: throttleStyle = motorStats ? getThrottleStyle(motorStats.avgPower) : null — derive when absent.
        ThrottleStyle resolved = style ?? ThrottleStyles.FromAveragePower(s.AvgPowerKw);
        StatusKind status = ThrottleStatusFor(resolved);
        string avgPowerValue = FormatPower(s.AvgPowerKw);
        string styleBadge = StyleBadgeText(resolved, localizer);
        string automation = JoinName(title, $"{avgPowerLabel} {avgPowerValue}", $"{styleLabel} {styleBadge}");

        return new MotorThrottlePanelDisplay(
            title, true, avgPowerLabel, avgPowerValue, styleLabel, styleBadge, status,
            s.AvgPowerKw, MetricBarMaxKw, StatusResources.AccentBrushKey(status), emptyMessage, automation);
    }

    private static MotorThermalPanelDisplay BuildThermal(
        MotorStats? stats,
        TemperatureUnit unit,
        string? locale,
        string emptyMessage,
        ILocalizer localizer)
    {
        string title = localizer.GetString("dynamics.motorThermal", "Motor Thermal");
        string avgLabel = localizer.GetString("dynamics.avgMotorTemp", "Avg Motor Temp");
        string maxLabel = localizer.GetString("dynamics.maxMotorTemp", "Max Motor Temp");

        if (stats is not { } s)
        {
            return new MotorThermalPanelDisplay(
                title, false, avgLabel, string.Empty, maxLabel, string.Empty, string.Empty, StatusKind.Neutral,
                emptyMessage, JoinName(title, emptyMessage));
        }

        string avgValue = FormatTemperature(s.AvgMotorTempCelsius, unit, locale);
        string maxValue = FormatTemperature(s.MaxMotorTempCelsius, unit, locale);
        StatusKind status = ThermalStatusFor(s.MaxMotorTempCelsius);
        string thermalBadge = ThermalBadgeText(s.MaxMotorTempCelsius, localizer);
        string automation = JoinName(
            title, $"{avgLabel} {avgValue}", $"{maxLabel} {maxValue}", thermalBadge);

        return new MotorThermalPanelDisplay(
            title, true, avgLabel, avgValue, maxLabel, maxValue, thermalBadge, status, emptyMessage, automation);
    }

    private static string StyleBadgeText(ThrottleStyle style, ILocalizer localizer) => style switch
    {
        ThrottleStyle.Conservative => localizer.GetString("dynamics.conservative", "Conservative"),
        ThrottleStyle.Moderate => localizer.GetString("dynamics.moderate", "Moderate"),
        _ => localizer.GetString("dynamics.aggressive", "Aggressive"),
    };

    private static string ThermalBadgeText(double maxMotorTempCelsius, ILocalizer localizer)
    {
        if (maxMotorTempCelsius < ThermalGoodCeilingCelsius)
        {
            return localizer.GetString("dynamics.thermalGood", "Thermal: Good");
        }

        return maxMotorTempCelsius < ThermalWarmCeilingCelsius
            ? localizer.GetString("dynamics.thermalWarm", "Thermal: Warm")
            : localizer.GetString("dynamics.thermalHot", "Thermal: Hot");
    }

    private static string FormatTorque(double newtonMetres) =>
        NumberFormatting.Format(newtonMetres, null, ValuePrecision) + TorqueUnitSuffix;

    private static string FormatPower(double kilowatts) =>
        NumberFormatting.Format(kilowatts, null, ValuePrecision) + PowerUnitSuffix;

    private static string FormatPercent(double percent) =>
        NumberFormatting.Format(percent, null, ValuePrecision) + PercentSuffix;

    private static string FormatTemperature(double celsius, TemperatureUnit unit, string? locale)
    {
        double display = UnitConverters.TemperatureFromSi(celsius, unit);
        // The unit label already carries the degree sign (e.g. "°C") — never prefix another '°'.
        return NumberFormatting.Format(display, locale, ValuePrecision) + UnitLabels.Label(unit);
    }

    private static string BuildAutomationName(
        MotorEfficiencyInsightsState state,
        MotorTorquePanelDisplay torque,
        MotorThrottlePanelDisplay throttle,
        MotorThermalPanelDisplay thermal,
        bool showChip,
        string chipText,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case MotorEfficiencyInsightsState.Loading:
                return JoinName($"{torque.Title}, {throttle.Title}, {thermal.Title}", loadingLabel);
            case MotorEfficiencyInsightsState.Error:
                return errorTitle;
            default:
                var parts = new List<string>();
                if (showChip)
                {
                    parts.Add(chipText);
                }

                parts.Add(torque.AutomationName);
                parts.Add(throttle.AutomationName);
                parts.Add(thermal.AutomationName);
                return string.Join(". ", parts);
        }
    }

    private static string JoinName(params string[] parts) => string.Join(". ", parts);
}

/// <summary>
/// PII-safe diagnostics for the <c>MotorEfficiencyInsights</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a torque, power, temperature or
/// VIN — so a diagnostics line can never leak motor telemetry. Thread-safe.
/// </summary>
public sealed class MotorEfficiencyInsightsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Optional sink invoked with each diagnostics line.</param>
    public MotorEfficiencyInsightsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MotorEfficiencyInsights</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MotorEfficiencyInsightsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>MotorEfficiencyInsights</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx</c>.
/// </summary>
public static class MotorEfficiencyInsightsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "MotorEfficiencyInsights";
}
