using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="MotorPerformanceViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>MotorPerformanceWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData = !!data</c> gate
/// (no resolved vehicle / no motor object in the response) — the "No motor data" surface.
/// </summary>
public enum MotorPerformanceState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a motor object to render the gauge / readouts for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no motor object — render the "No motor data" surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the readouts plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the readouts plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The motor fields the widget reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>MotorSnapshot</c> slice the web component consumes (web/src/features/dashboard/widgets/
/// MotorPerformanceWidget.tsx). Each field carries the web fallback chain: torque is <c>di_torque</c>; the stator
/// temperature is <c>di_stator_temp ?? motor_temp_c_front</c> (SI Celsius); the gear is <c>gear ?? shift_state</c>;
/// the lateral / longitudinal g-forces read the <c>lateral_accel</c> / <c>longitudinal_accel</c> keys the web
/// accesses via its untyped cast. A <see langword="null"/> parse result models the web <c>data</c> being
/// null/undefined (no motor object → the empty surface); a missing field parses to <see langword="null"/> so the
/// readout shows the em dash exactly like the web <c>!= null</c> guards.
/// </summary>
/// <param name="TorqueNm">Drive-inverter torque in newton-metres, or null (web <c>di_torque</c>).</param>
/// <param name="StatorTempC">Stator temperature in SI Celsius, or null (web <c>di_stator_temp ?? motor_temp_c_front</c>).</param>
/// <param name="Gear">Gear string, or null (web <c>gear ?? shift_state</c>).</param>
/// <param name="LateralG">Lateral acceleration in g, or null (web <c>lateral_accel</c>).</param>
/// <param name="LongitudinalG">Longitudinal acceleration in g, or null (web <c>longitudinal_accel</c>).</param>
public sealed record MotorReading(
    double? TorqueNm,
    double? StatorTempC,
    string? Gear,
    double? LateralG,
    double? LongitudinalG)
{
    /// <summary>
    /// Project a <c>GET /motor/latest</c> response into the motor slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>data</c> being
    /// null/undefined (<c>hasData == false</c> → the empty surface). A motor object with every field missing
    /// still parses to a reading (all-null fields) so the gauge renders with a zero torque exactly like the web
    /// <c>di_torque ?? 0</c> path.
    /// </summary>
    public static MotorReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new MotorReading(
            TorqueNm: SignalJson.ReadDouble(root, "di_torque"),
            StatorTempC: SignalJson.ReadDouble(root, "di_stator_temp") ?? SignalJson.ReadDouble(root, "motor_temp_c_front"),
            Gear: SignalJson.ReadString(root, "gear") ?? SignalJson.ReadString(root, "shift_state"),
            LateralG: SignalJson.ReadDouble(root, "lateral_accel"),
            LongitudinalG: SignalJson.ReadDouble(root, "longitudinal_accel"));
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> flag and the fixed <c>size={100}</c> gauge diameter in
/// web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct MotorPerformanceSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static MotorPerformanceSize Default => new(2, 4);

    /// <summary>True at a single column or narrower (web <c>isCompact = size.cols &lt;= 1</c>) — the stacked Gear / Torque readout.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One render-ready stat tile in the full-size 2×2 grid — the native analogue of a web <c>StatCard</c>
/// (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx). The value is pre-formatted (value + unit, or
/// the em dash) so the view is a thin renderer; <see cref="AutomationName"/> carries the Narrator label combining
/// the label and value.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="ValueText">The pre-formatted value (e.g. "21 °C", "1.05 g", "D", or the em dash).</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record MotorStatTile(string Label, string ValueText, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the motor surface for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the clamped gauge value, the threshold colour, the
/// formatted centre / caption torque text, the compact Gear / Torque readout, and the four stat tiles). Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
public sealed record MotorPerformanceDisplay(
    bool IsCompact,
    double GaugeValue,
    double GaugeMax,
    string GaugeValueText,
    string GaugeUnit,
    string GaugeLabel,
    StatusKind GaugeStatus,
    double GaugeDiameter,
    string GaugeAutomationName,
    IReadOnlyList<MotorStatTile> Stats,
    string GearLabel,
    string GearValue,
    string TorqueLabel,
    string TorqueValueText);

/// <summary>
/// Pure projection from a raw <see cref="MotorReading"/> to the display model — the native port of the
/// <c>torqueColor</c> threshold helper, the <c>RadialGauge</c> composition and the four <c>StatCard</c>s in
/// web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx. Torque is already SI (newton-metres) and the
/// g-forces are dimensionless; only the stator temperature is converted (SI Celsius → the user's unit) at this
/// display boundary. Every label resolves through the i18n facade.
/// </summary>
public static class MotorPerformanceProjection
{
    /// <summary>Segoe Fluent "Lightning" glyph for the surface title icon + empty state (web <c>Zap</c> icon).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>The gauge maximum (web <c>TORQUE_MAX = 600</c>).</summary>
    public const double TorqueMax = 600;

    /// <summary>The fixed gauge diameter in pixels (web <c>RadialGauge size={100}</c>, independent of footprint).</summary>
    public const double GaugeDiameter = 100;

    /// <summary>At or above this absolute torque the gauge leaves green (web <c>nm &lt; 200</c>).</summary>
    public const double WarningThresholdNm = 200;

    /// <summary>At or above this absolute torque the gauge turns red (web <c>nm &lt; 400</c>).</summary>
    public const double DangerThresholdNm = 400;

    /// <summary>Em dash shown when a readout has no value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const string GForceUnit = "g";
    private const int TorquePrecision = 0;       // web fmtInt
    private const int TemperaturePrecision = 0;  // web fmtNumber(…, 0)
    private const int GForcePrecision = 2;        // web fmtNumber(…, 2)

    /// <summary>
    /// Map an absolute torque to the semantic status the gauge arc is tinted with (web <c>torqueColor</c>):
    /// &lt;200 Nm → <see cref="StatusKind.Success"/> (green), &lt;400 Nm → <see cref="StatusKind.Warning"/>
    /// (amber), otherwise <see cref="StatusKind.Danger"/> (red).
    /// </summary>
    public static StatusKind StatusFor(double absTorqueNm)
    {
        if (absTorqueNm < WarningThresholdNm)
        {
            return StatusKind.Success;
        }

        return absTorqueNm < DangerThresholdNm ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>
    /// Format the gauge centre value exactly as the web <c>RadialGauge</c> does: integers render with no fraction
    /// digits and non-integers with the global precision (2), using en-US grouping (web <c>fmtNumber</c>).
    /// </summary>
    public static string FormatValue(double value)
    {
        double safe = SafeNumber(value);
        int decimals = safe == Math.Floor(safe) ? 0 : 2;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> in <paramref name="units"/>, localizing every label.</summary>
    public static MotorPerformanceDisplay Project(
        MotorReading reading,
        MotorPerformanceSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web: const torque = data?.di_torque ?? 0; gaugeColor = torqueColor(Math.abs(torque)).
        double torque = SafeNumber(reading.TorqueNm ?? 0);
        double absTorque = Math.Abs(torque);
        StatusKind status = StatusFor(absTorque);

        string nm = localizer.GetString("widget.motorPerformance.nm", "Nm");
        string torqueLabel = localizer.GetString("widget.motorPerformance.torque", "Torque");
        string gearLabel = localizer.GetString("widget.motorPerformance.gear", "Gear");

        // Web RadialGauge: value={Math.abs(torque)} (clamped 0..max in the gauge), label={fmtInt(torque)} (signed).
        double gaugeValue = Math.Clamp(absTorque, 0, TorqueMax);
        string gaugeValueText = FormatValue(gaugeValue);
        string gaugeLabelSigned = ScalarFormatters.FormatNumber(torque, TorquePrecision);

        // Web: const gear = data?.gear ?? data?.shift_state ?? '—'.
        string gearDisplay = string.IsNullOrEmpty(reading.Gear) ? EmDash : reading.Gear!;

        // Web compact torque readout: `${fmtInt(torque)} ${nm}` (e.g. "300 Nm").
        string torqueCompact = $"{ScalarFormatters.FormatNumber(torque, TorquePrecision)} {nm}";

        var stats = new List<MotorStatTile>(4)
        {
            Tile(localizer.GetString("widget.motorPerformance.statorTemp", "Stator Temp"), FormatTemperature(reading.StatorTempC, units)),
            Tile(localizer.GetString("widget.motorPerformance.gearState", "Gear State"), gearDisplay),
            Tile(localizer.GetString("widget.motorPerformance.lateralG", "Lateral G"), FormatGForce(reading.LateralG)),
            Tile(localizer.GetString("widget.motorPerformance.longitudinalG", "Longitudinal G"), FormatGForce(reading.LongitudinalG)),
        };

        return new MotorPerformanceDisplay(
            IsCompact: size.IsCompact,
            GaugeValue: gaugeValue,
            GaugeMax: TorqueMax,
            GaugeValueText: gaugeValueText,
            GaugeUnit: nm,
            GaugeLabel: gaugeLabelSigned,
            GaugeStatus: status,
            GaugeDiameter: GaugeDiameter,
            GaugeAutomationName: $"{torqueLabel} {gaugeLabelSigned} {nm}",
            Stats: stats,
            GearLabel: gearLabel,
            GearValue: gearDisplay,
            TorqueLabel: torqueLabel,
            TorqueValueText: torqueCompact);
    }

    /// <summary>
    /// Format an SI Celsius stator temperature the way the web does — null → em dash, otherwise
    /// <c>fmtNumber(convertTempFromSI(c, unit), 0)</c> plus the unit label with a separating space (mirroring the
    /// web <c>StatCard</c>'s value / unit gap, e.g. "21 °C").
    /// </summary>
    public static string FormatTemperature(double? celsius, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (celsius is not { } c || double.IsNaN(c) || double.IsInfinity(c))
        {
            return EmDash;
        }

        double display = UnitConverters.TemperatureFromSi(c, units.Temperature);
        return $"{ScalarFormatters.FormatNumber(display, TemperaturePrecision)} {UnitLabels.Label(units.Temperature)}";
    }

    /// <summary>
    /// Format a dimensionless g-force the way the web does — null → em dash, otherwise
    /// <c>fmtNumber(g, 2)</c> plus a separating space and the "g" unit (e.g. "1.05 g").
    /// </summary>
    public static string FormatGForce(double? g)
    {
        if (g is not { } v || double.IsNaN(v) || double.IsInfinity(v))
        {
            return EmDash;
        }

        return $"{ScalarFormatters.FormatNumber(v, GForcePrecision)} {GForceUnit}";
    }

    private static MotorStatTile Tile(string label, string valueText) =>
        new(label, valueText, $"{label} {valueText}");

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;MotorReading&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline). A successful emission whose body carries no motor object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{hasData ? … : empty}</c> gate.
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class MotorPerformanceResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<MotorReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        MotorReading? Parse() => raw.HasValue ? MotorReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<MotorReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<MotorReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<MotorReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<MotorReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<MotorReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<MotorReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<MotorReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<MotorReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<MotorReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<MotorReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
