using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="LiveSignalsViewModel"/> can be in — the native union of the loading /
/// loaded / empty / error / stale / offline branches the web <c>LiveSignalsWidget</c> renders through
/// <c>WidgetShell</c> (web/src/features/dashboard/widgets/LiveSignalsWidget.tsx). The widget composes four
/// concurrent live reads (motor, climate, security, tires); the freshness chrome is driven by the motor query
/// exactly like the web (<c>updatedAt=motorUpdatedAt</c>, <c>isFetching=motorFetching</c>,
/// <c>isStale=motorStale</c>, <c>isError=motorError</c>). <see cref="Empty"/> mirrors the web
/// <c>!hasData</c> gate — none of the four reads carried a value — the "No live signal data" surface.
/// </summary>
public enum LiveSignalsState
{
    /// <summary>Initial fetch with no content from any read — render the full-area skeleton.</summary>
    Loading,

    /// <summary>At least one read resolved with a value and the motor freshness is current — render the grid.</summary>
    Loaded,

    /// <summary>No read carried a value (web <c>!hasData</c>) — render the "No live signal data" surface.</summary>
    Empty,

    /// <summary>The motor read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown grid is backed by a motor read older than the freshness window — grid plus a stale chip.</summary>
    Stale,

    /// <summary>The motor read is offline but a cached value remains — grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The motor fields the live-signals view reads from <c>GET /motor/latest?vehicle_id={id}</c> — the native
/// mirror of the exact <c>MotorSnapshot</c> slice the web widget consumes (<c>di_torque</c>,
/// <c>di_stator_temp</c>, <c>gear</c>). A <see langword="null"/> parse result models the web <c>motor</c> being
/// null/undefined (no motor object → that cell renders the skeleton); a missing field parses to
/// <see langword="null"/> so the row shows the em dash exactly like the web <c>!= null</c> guards.
/// </summary>
/// <param name="TorqueNm">Drive-inverter torque in newton-metres, or null (web <c>di_torque</c>).</param>
/// <param name="StatorTempC">Stator temperature in SI Celsius, or null (web <c>di_stator_temp</c>).</param>
/// <param name="Gear">Gear string, or null (web <c>gear</c>).</param>
public sealed record LiveMotorReading(double? TorqueNm, double? StatorTempC, string? Gear)
{
    /// <summary>Project a <c>GET /motor/latest</c> response into the motor slice; null for a non-object body.</summary>
    public static LiveMotorReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LiveMotorReading(
            TorqueNm: SignalJson.ReadDouble(root, "di_torque"),
            StatorTempC: SignalJson.ReadDouble(root, "di_stator_temp"),
            Gear: SignalJson.ReadString(root, "gear"));
    }
}

/// <summary>
/// The climate fields the live-signals view reads from <c>GET /climate/latest?vehicle_id={id}</c> — the native
/// mirror of the <c>ClimateSnapshot</c> slice the web widget consumes (<c>inside_temp</c>, <c>outside_temp</c>,
/// <c>hvac_power</c>). A <see langword="null"/> parse result models the web <c>climate</c> being null (that cell
/// renders the skeleton); a missing numeric field parses to <see langword="null"/> for the em dash.
/// </summary>
/// <param name="InsideTempC">Cabin temperature in SI Celsius, or null (web <c>inside_temp</c>).</param>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius, or null (web <c>outside_temp</c>).</param>
/// <param name="HvacPowerKw">HVAC power in kilowatts as the web reads it, or null (web <c>hvac_power</c>).</param>
public sealed record LiveClimateReading(double? InsideTempC, double? OutsideTempC, double? HvacPowerKw)
{
    /// <summary>Project a <c>GET /climate/latest</c> response into the climate slice; null for a non-object body.</summary>
    public static LiveClimateReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LiveClimateReading(
            InsideTempC: SignalJson.ReadDouble(root, "inside_temp"),
            OutsideTempC: SignalJson.ReadDouble(root, "outside_temp"),
            HvacPowerKw: SignalJson.ReadDouble(root, "hvac_power"));
    }
}

/// <summary>
/// The security fields the live-signals view reads from <c>GET /security/latest?vehicle_id={id}</c> — the native
/// mirror of the <c>SecurityEvent</c> slice the web widget consumes (<c>locked</c>, <c>sentry_mode</c>). A
/// <see langword="null"/> parse result models the web <c>security</c> being null (that cell renders the
/// skeleton). The web reads the two booleans truthily (<c>security.locked ? … : …</c>), so a missing or null
/// boolean reads as <see langword="false"/> here, reproducing the "Unlocked" / "Off" branch.
/// </summary>
/// <param name="Locked">Whether the vehicle is locked (web <c>locked</c>); null when absent.</param>
/// <param name="SentryMode">Whether sentry mode is armed (web <c>sentry_mode</c>); null when absent.</param>
public sealed record LiveSecurityReading(bool? Locked, bool? SentryMode)
{
    /// <summary>Project a <c>GET /security/latest</c> response into the security slice; null for a non-object body.</summary>
    public static LiveSecurityReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LiveSecurityReading(
            Locked: SignalJson.ReadBool(root, "locked"),
            SentryMode: SignalJson.ReadBool(root, "sentry_mode"));
    }
}

/// <summary>
/// The tire-pressure fields the live-signals view reads from <c>GET /tire-pressure/latest?vehicle_id={id}</c> —
/// the native mirror of the <c>TirePressureSnapshot</c> slice the web widget consumes (the four corner
/// pressures in SI kilopascals). A <see langword="null"/> parse result models the web <c>tires</c> being null
/// (that cell renders the skeleton); a missing corner parses to <see langword="null"/> for the em dash.
/// </summary>
/// <param name="FrontLeftKpa">Front-left pressure in SI kPa, or null (web <c>front_left</c>).</param>
/// <param name="FrontRightKpa">Front-right pressure in SI kPa, or null (web <c>front_right</c>).</param>
/// <param name="RearLeftKpa">Rear-left pressure in SI kPa, or null (web <c>rear_left</c>).</param>
/// <param name="RearRightKpa">Rear-right pressure in SI kPa, or null (web <c>rear_right</c>).</param>
public sealed record LiveTireReading(double? FrontLeftKpa, double? FrontRightKpa, double? RearLeftKpa, double? RearRightKpa)
{
    /// <summary>Project a <c>GET /tire-pressure/latest</c> response into the tire slice; null for a non-object body.</summary>
    public static LiveTireReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LiveTireReading(
            FrontLeftKpa: SignalJson.ReadDouble(root, "front_left"),
            FrontRightKpa: SignalJson.ReadDouble(root, "front_right"),
            RearLeftKpa: SignalJson.ReadDouble(root, "rear_left"),
            RearRightKpa: SignalJson.ReadDouble(root, "rear_right"));
    }
}

/// <summary>
/// Tolerant JSON readers shared by the four live-signal slices. Each mirrors the web's permissive access — a
/// missing/null/wrong-kind field reads as <see langword="null"/> (or <see langword="false"/> for booleans) so a
/// partial body never throws and each row independently shows the em dash exactly like the web per-field
/// <c>!= null</c> checks.
/// </summary>
internal static class SignalJson
{
    /// <summary>Read a finite number (number or numeric string), or null.</summary>
    public static double? ReadDouble(JsonElement obj, string name)
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

    /// <summary>Read a string value, or null.</summary>
    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a boolean (bool, numeric, or boolean string), or null when absent.</summary>
    public static bool? ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }
}

/// <summary>
/// The four live reads merged into one value — the native analogue of the web component's
/// <c>motor</c> / <c>climate</c> / <c>security</c> / <c>tires</c> hook results. Each slice is null when its read
/// carried no object (loading, empty or failed), so the view renders that cell's skeleton independently exactly
/// like the web <c>{slice ? rows : &lt;Skeleton/&gt;}</c> gates. <see cref="HasAny"/> reproduces the web
/// <c>hasData = motor || climate || security || tires</c> gate that chooses between the grid and the empty
/// surface.
/// </summary>
/// <param name="Motor">The motor slice, or null.</param>
/// <param name="Climate">The climate slice, or null.</param>
/// <param name="Security">The security slice, or null.</param>
/// <param name="Tires">The tire slice, or null.</param>
public sealed record LiveSignalsReading(
    LiveMotorReading? Motor,
    LiveClimateReading? Climate,
    LiveSecurityReading? Security,
    LiveTireReading? Tires)
{
    /// <summary>True when at least one read carried a value (web <c>hasData</c>).</summary>
    public bool HasAny => Motor is not null || Climate is not null || Security is not null || Tires is not null;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>LiveSignalsWidget</c> renders the same 2×2 composition at every footprint (it never branches on
/// <c>size</c>), so this carries only the registry min/max constraints — no compact / tall variants.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct LiveSignalsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static LiveSignalsSize Default => new(2, 4);
}

/// <summary>A single label / value readout row (web <c>&lt;Row label value /&gt;</c>).</summary>
/// <param name="Label">The localized (or fixed-abbreviation) row label.</param>
/// <param name="Value">The pre-formatted value, e.g. "21°C", "300 Nm", or the em dash.</param>
public sealed record LiveSignalRow(string Label, string Value);

/// <summary>
/// A security status chip (web <c>&lt;Badge variant&gt;</c>). The variant reproduces the web mapping
/// (<c>locked ? 'success' : 'danger'</c>, <c>sentry_mode ? 'success' : 'neutral'</c>).
/// </summary>
/// <param name="Label">The localized field label (e.g. "Lock", "Sentry").</param>
/// <param name="Text">The localized chip text (e.g. "Locked", "Active").</param>
/// <param name="Variant">The semantic status driving the chip colour.</param>
public sealed record LiveSecurityChip(string Label, string Text, StatusKind Variant);

/// <summary>
/// The fully projected, render-ready view of the live-signals grid for one unit preference — the native analogue
/// of everything the web component computes before returning JSX. Every section's row list (or chip list) is
/// <see langword="null"/> when that read carried no value, so the view renders that cell's skeleton; the section
/// header label is always present. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="MotorLabel">Localized "Motor" section label.</param>
/// <param name="MotorRows">The motor rows (Torque / Temp / Gear), or null → skeleton.</param>
/// <param name="ClimateLabel">Localized "Climate" section label.</param>
/// <param name="ClimateRows">The climate rows (Cabin / Outside / HVAC), or null → skeleton.</param>
/// <param name="TiresLabel">Localized "Tires" section label.</param>
/// <param name="TireRows">The tire rows (FL / FR / RL / RR), or null → skeleton.</param>
/// <param name="SecurityLabel">Localized "Security" section label.</param>
/// <param name="SecurityChips">The security chips (Lock / Sentry), or null → skeleton.</param>
/// <param name="AutomationName">Narrator name summarising every rendered section.</param>
public sealed record LiveSignalsDisplay(
    string MotorLabel,
    IReadOnlyList<LiveSignalRow>? MotorRows,
    string ClimateLabel,
    IReadOnlyList<LiveSignalRow>? ClimateRows,
    string TiresLabel,
    IReadOnlyList<LiveSignalRow>? TireRows,
    string SecurityLabel,
    IReadOnlyList<LiveSecurityChip>? SecurityChips,
    string AutomationName);

/// <summary>
/// Pure projection from a merged <see cref="LiveSignalsReading"/> to the display model — the native port of the
/// web component's inline formatting in web/src/features/dashboard/widgets/LiveSignalsWidget.tsx. Torque is
/// rendered raw (<c>`${di_torque} Nm`</c>, no locale grouping, matching the web template literal); the stator,
/// cabin and outside temperatures honour the user's temperature preference at zero fraction digits exactly like
/// the web <c>fmtInt(convertTempFromSI(…))</c> + the unit suffix (no separating space); HVAC reproduces
/// <c>fmtNumber(hvac_power, 1) + ' kW'</c>; the corner pressures reproduce
/// <c>fmtNumber(convertPressureFromSI(…), 1) + ' ' + unit</c>; gear reproduces <c>cleanNil(gear) ?? '—'</c>; the
/// security chips reproduce the web <c>locked</c> / <c>sentry_mode</c> variant + text mapping. Every section
/// label resolves through the i18n facade.
/// </summary>
public static class LiveSignalsProjection
{
    /// <summary>Segoe Fluent "NetworkTower" glyph — the web title <c>Wifi</c> icon.</summary>
    public const string WifiGlyph = "\uEC05";

    /// <summary>Segoe Fluent "Settings" gear glyph — the web motor <c>Cog</c> icon.</summary>
    public const string MotorGlyph = "\uE713";

    /// <summary>Segoe Fluent "Temperature" glyph — the web climate <c>Thermometer</c> icon.</summary>
    public const string ClimateGlyph = "\uE9CA";

    /// <summary>Segoe Fluent "StatusCircleRing" glyph — the web tires <c>CircleDot</c> icon.</summary>
    public const string TiresGlyph = "\uEA3A";

    /// <summary>Segoe Fluent "Shield" glyph — the web security 🛡️ icon.</summary>
    public const string SecurityGlyph = "\uEA18";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Temperature fraction digits (web <c>fmtInt</c> = <c>fmtNumber(…, 0)</c>).</summary>
    public const int TemperaturePrecision = 0;

    /// <summary>HVAC / pressure fraction digits (web <c>fmtNumber(…, 1)</c>).</summary>
    public const int OneDecimal = 1;

    // Fixed corner abbreviations — the web renders these as bare string literals (FL/FR/RL/RR), not through
    // t(), because they are universal tire-position abbreviations rather than translatable words. Reproduced
    // verbatim for parity (they are intentionally absent from the i18n key list in the prompt spec).
    private const string FrontLeftLabel = "FL";
    private const string FrontRightLabel = "FR";
    private const string RearLeftLabel = "RL";
    private const string RearRightLabel = "RR";

    // The Go nil string representations the web cleanNil() strips before display.
    private static readonly string[] NilLiterals = ["<nil>", "nil", "null"];

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static LiveSignalsDisplay Project(LiveSignalsReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string motorLabel = localizer.GetString("widget.motor", "Motor");
        string climateLabel = localizer.GetString("widget.climate", "Climate");
        string tiresLabel = localizer.GetString("widget.tires", "Tires");
        string securityLabel = localizer.GetString("widget.security", "Security");

        var motorRows = ProjectMotor(reading.Motor, units, localizer);
        var climateRows = ProjectClimate(reading.Climate, units, localizer);
        var tireRows = ProjectTires(reading.Tires, units);
        var securityChips = ProjectSecurity(reading.Security, localizer);

        string automation = BuildAutomationName(
            (motorLabel, motorRows),
            (climateLabel, climateRows),
            (tiresLabel, tireRows),
            (securityLabel, securityChips));

        return new LiveSignalsDisplay(
            MotorLabel: motorLabel,
            MotorRows: motorRows,
            ClimateLabel: climateLabel,
            ClimateRows: climateRows,
            TiresLabel: tiresLabel,
            TireRows: tireRows,
            SecurityLabel: securityLabel,
            SecurityChips: securityChips,
            AutomationName: automation);
    }

    /// <summary>Project the motor rows, or null when the read carried no motor object (web <c>{motor ? … : skeleton}</c>).</summary>
    public static IReadOnlyList<LiveSignalRow>? ProjectMotor(LiveMotorReading? motor, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        if (motor is null)
        {
            return null;
        }

        return new[]
        {
            new LiveSignalRow(localizer.GetString("widget.torque", "Torque"), FormatTorque(motor.TorqueNm)),
            new LiveSignalRow(localizer.GetString("widget.motorTemp", "Temp"), FormatTemperature(motor.StatorTempC, units)),
            new LiveSignalRow(localizer.GetString("widget.gear", "Gear"), FormatGear(motor.Gear)),
        };
    }

    /// <summary>Project the climate rows, or null when the read carried no climate object.</summary>
    public static IReadOnlyList<LiveSignalRow>? ProjectClimate(LiveClimateReading? climate, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        if (climate is null)
        {
            return null;
        }

        return new[]
        {
            new LiveSignalRow(localizer.GetString("widget.cabin", "Cabin"), FormatTemperature(climate.InsideTempC, units)),
            new LiveSignalRow(localizer.GetString("widget.outside", "Outside"), FormatTemperature(climate.OutsideTempC, units)),
            new LiveSignalRow(localizer.GetString("widget.hvac", "HVAC"), FormatHvac(climate.HvacPowerKw)),
        };
    }

    /// <summary>Project the tire rows, or null when the read carried no tire object.</summary>
    public static IReadOnlyList<LiveSignalRow>? ProjectTires(LiveTireReading? tires, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (tires is null)
        {
            return null;
        }

        return new[]
        {
            new LiveSignalRow(FrontLeftLabel, FormatPressure(tires.FrontLeftKpa, units)),
            new LiveSignalRow(FrontRightLabel, FormatPressure(tires.FrontRightKpa, units)),
            new LiveSignalRow(RearLeftLabel, FormatPressure(tires.RearLeftKpa, units)),
            new LiveSignalRow(RearRightLabel, FormatPressure(tires.RearRightKpa, units)),
        };
    }

    /// <summary>Project the security chips, or null when the read carried no security object.</summary>
    public static IReadOnlyList<LiveSecurityChip>? ProjectSecurity(LiveSecurityReading? security, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (security is null)
        {
            return null;
        }

        bool locked = security.Locked ?? false;
        bool sentry = security.SentryMode ?? false;

        return new[]
        {
            new LiveSecurityChip(
                localizer.GetString("widget.lock", "Lock"),
                locked ? localizer.GetString("widget.locked", "Locked") : localizer.GetString("widget.unlocked", "Unlocked"),
                locked ? StatusKind.Success : StatusKind.Danger),
            new LiveSecurityChip(
                localizer.GetString("widget.sentry", "Sentry"),
                sentry ? localizer.GetString("widget.active", "Active") : localizer.GetString("widget.off", "Off"),
                sentry ? StatusKind.Success : StatusKind.Neutral),
        };
    }

    /// <summary>
    /// Format torque the way the web does — null → em dash, otherwise the raw value followed by " Nm" with no
    /// locale grouping (web <c>`${di_torque} Nm`</c>, a bare template literal over the parsed number).
    /// </summary>
    public static string FormatTorque(double? torque)
    {
        if (torque is not { } value || double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        return value.ToString(CultureInfo.InvariantCulture) + " Nm";
    }

    /// <summary>
    /// Format an SI Celsius temperature the way the web does — null → em dash, otherwise
    /// <c>fmtInt(convertTempFromSI(c, unit))</c> + the unit suffix with no separating space (e.g. "21°C").
    /// </summary>
    public static string FormatTemperature(double? celsius, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (celsius is not { } c || double.IsNaN(c) || double.IsInfinity(c))
        {
            return EmDash;
        }

        double display = UnitConverters.TemperatureFromSi(c, units.Temperature);
        return ScalarFormatters.FormatNumber(display, TemperaturePrecision) + UnitLabels.Label(units.Temperature);
    }

    /// <summary>Format HVAC power the way the web does — null → em dash, otherwise <c>fmtNumber(kw, 1) + ' kW'</c>.</summary>
    public static string FormatHvac(double? kw)
    {
        if (kw is not { } value || double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        return ScalarFormatters.FormatNumber(value, OneDecimal) + " kW";
    }

    /// <summary>
    /// Format an SI kilopascal pressure the way the web does — null → em dash, otherwise
    /// <c>fmtNumber(convertPressureFromSI(kpa, unit), 1) + ' ' + unit</c> (e.g. "32.5 psi").
    /// </summary>
    public static string FormatPressure(double? kpa, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        if (kpa is not { } value || double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        double display = UnitConverters.PressureFromSi(value, units.Pressure);
        return ScalarFormatters.FormatNumber(display, OneDecimal) + " " + UnitLabels.Label(units.Pressure);
    }

    /// <summary>Format gear the way the web does — <c>cleanNil(gear) ?? '—'</c>.</summary>
    public static string FormatGear(string? gear) => CleanNil(gear) ?? EmDash;

    /// <summary>
    /// Strip Go nil string representations the way the web <c>cleanNil()</c> does — an empty / whitespace /
    /// <c>&lt;nil&gt;</c> / <c>nil</c> / <c>null</c> value collapses to <see langword="null"/>, otherwise the
    /// value is returned verbatim.
    /// </summary>
    public static string? CleanNil(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        foreach (var literal in NilLiterals)
        {
            if (string.Equals(value, literal, StringComparison.Ordinal))
            {
                return null;
            }
        }

        return value;
    }

    private static string BuildAutomationName(
        (string Label, IReadOnlyList<LiveSignalRow>? Rows) motor,
        (string Label, IReadOnlyList<LiveSignalRow>? Rows) climate,
        (string Label, IReadOnlyList<LiveSignalRow>? Rows) tires,
        (string Label, IReadOnlyList<LiveSecurityChip>? Chips) security)
    {
        var parts = new List<string>(4);
        AppendRows(parts, motor.Label, motor.Rows);
        AppendRows(parts, climate.Label, climate.Rows);
        AppendRows(parts, tires.Label, tires.Rows);
        AppendChips(parts, security.Label, security.Chips);
        return string.Join("; ", parts);
    }

    private static void AppendRows(List<string> parts, string label, IReadOnlyList<LiveSignalRow>? rows)
    {
        if (rows is null)
        {
            return;
        }

        var values = rows.Select(r => $"{r.Label} {r.Value}");
        parts.Add($"{label}: {string.Join(", ", values)}");
    }

    private static void AppendChips(List<string> parts, string label, IReadOnlyList<LiveSecurityChip>? chips)
    {
        if (chips is null)
        {
            return;
        }

        var values = chips.Select(c => $"{c.Label} {c.Text}");
        parts.Add($"{label}: {string.Join(", ", values)}");
    }
}

/// <summary>
/// Combines the four cache-then-network reads (motor, climate, security, tire-pressure latest) into a single
/// <see cref="RepositoryResult{T}"/> over the merged <see cref="LiveSignalsReading"/>, preserving the freshness
/// contract. The freshness / error chrome is driven solely by the motor read, exactly like the web
/// (<c>updatedAt=motorUpdatedAt</c>, <c>isFetching=motorFetching</c>, <c>isStale=motorStale</c>,
/// <c>isError=motorError</c>); the body's empty-vs-grid choice is driven by whether ANY of the four carried a
/// value (web <c>hasData</c>). Kept pure so the combine contract is unit-tested without a network or cache.
/// </summary>
public static class LiveSignalsResultMapper
{
    /// <summary>Fold the four resolved reads into one combined emission with motor-driven freshness.</summary>
    public static RepositoryResult<LiveSignalsReading> Combine(
        RepositoryResult<JsonElement> motor,
        RepositoryResult<JsonElement> climate,
        RepositoryResult<JsonElement> security,
        RepositoryResult<JsonElement> tires)
    {
        ArgumentNullException.ThrowIfNull(motor);
        ArgumentNullException.ThrowIfNull(climate);
        ArgumentNullException.ThrowIfNull(security);
        ArgumentNullException.ThrowIfNull(tires);

        var reading = new LiveSignalsReading(
            Parse(motor, LiveMotorReading.FromResponse),
            Parse(climate, LiveClimateReading.FromResponse),
            Parse(security, LiveSecurityReading.FromResponse),
            Parse(tires, LiveTireReading.FromResponse));

        if (!reading.HasAny)
        {
            // No read carried a value (web `!hasData`). A motor hard-failure with nothing to show collapses to
            // the retry surface; otherwise this is the friendly "No live signal data" empty surface.
            return motor.Status == LoadStatus.Error
                ? RepositoryResult<LiveSignalsReading>.Failure(
                    motor.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load live signals"))
                : RepositoryResult<LiveSignalsReading>.Empty(motor.FetchedAt);
        }

        // hasData → the grid renders; the motor read tints the freshness chip (web chrome).
        DateTimeOffset stamp = motor.FetchedAt
            ?? Latest(climate.FetchedAt, security.FetchedAt, tires.FetchedAt)
            ?? DateTimeOffset.UtcNow;

        return motor.Status switch
        {
            // Motor offline / errored but other content exists — keep the grid, tint the chip as error/offline.
            LoadStatus.Offline or LoadStatus.Error => RepositoryResult<LiveSignalsReading>.OfflineCached(
                reading, stamp, motor.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable")),

            // Motor still in flight while another read already has content — grid plus the "Updating…" chip.
            LoadStatus.Loading or LoadStatus.Refreshing => RepositoryResult<LiveSignalsReading>.Refreshing(
                reading, stamp, motor.IsStale),

            // Motor surfaced a (possibly stale) cached value.
            LoadStatus.Cached => RepositoryResult<LiveSignalsReading>.Cached(reading, stamp, motor.IsStale),

            // Motor returned fresh (Loaded) or returned no motor object (Empty) — fresh chrome either way.
            _ => motor.IsStale
                ? RepositoryResult<LiveSignalsReading>.Cached(reading, stamp, stale: true)
                : RepositoryResult<LiveSignalsReading>.Loaded(reading, stamp),
        };
    }

    private static TReading? Parse<TReading>(RepositoryResult<JsonElement> raw, Func<JsonElement, TReading?> parse)
        where TReading : class
    {
        // Only a content-bearing status carries a body to parse; Loading / Empty / Error contribute no slice
        // (that cell renders its skeleton). Gating on the status — rather than HasValue — keeps the contract
        // unambiguous for the JsonElement value type.
        bool hasContent = raw.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
        return hasContent && raw.Value is { } element ? parse(element) : null;
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b, DateTimeOffset? c)
    {
        DateTimeOffset? best = a;
        if (b is { } bv && (best is null || bv > best))
        {
            best = bv;
        }

        if (c is { } cv && (best is null || cv > best))
        {
            best = cv;
        }

        return best;
    }
}
