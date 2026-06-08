using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ClimateControlPanelViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ClimateControlPanelWidget</c>
/// renders through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx).
/// Every branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{climateData ? … : &lt;EmptyState&gt;}</c> gate — the response carried no climate object — the
/// "No climate data" surface.
/// </summary>
public enum ClimateControlPanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a climate object to render the panel for.</summary>
    Loaded,

    /// <summary>No climate object in the response — render the "No climate data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the panel plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the panel plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the climate-control panel reads from <c>GET /climate/latest?vehicle_id={id}</c> — the native
/// mirror of the exact <c>ClimateSnapshot</c> slice the web widget consumes. The web component reads the
/// compat-view aliases <c>inside_temp</c> / <c>outside_temp</c> (SI degrees Celsius), <c>hvac_power</c>
/// (kilowatts, as the web reads it), <c>hvac_ac_enabled</c> (bool), <c>hvac_fan_speed</c> (level),
/// <c>hvac_steering_wheel_heat_level</c> (0–3), <c>battery_heater_on</c> (bool), <c>seat_heater_rear_center</c>
/// plus the typed <c>seat_heater_left</c> / <c>seat_heater_right</c> / <c>seat_heater_rear_left</c> /
/// <c>seat_heater_rear_right</c> levels and <c>defrost_mode</c> string; those exact wire names are read here
/// verbatim so the native surface reproduces the web's observable output, never silently substituting the typed
/// <c>inside_temp_c</c> columns the web does not read. A <see langword="null"/> parse result models the web
/// <c>climateData</c> being null/undefined (no climate object → the empty surface); a missing numeric field
/// parses to <see langword="null"/> so the cell shows the em dash exactly like the web <c>!= null</c> guards.
/// </summary>
/// <param name="InsideTempC">Cabin temperature in SI Celsius, or null (web <c>inside_temp</c>).</param>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius, or null (web <c>outside_temp</c>).</param>
/// <param name="HvacPowerKw">HVAC power in kilowatts as the web reads it, or null (web <c>hvac_power</c>).</param>
/// <param name="HvacAcEnabled">Whether the A/C compressor is enabled (web <c>hvac_ac_enabled</c>).</param>
/// <param name="FanSpeed">HVAC fan speed level, or null (web <c>hvac_fan_speed</c>).</param>
/// <param name="SeatHeaterLeft">Front-left seat heater level (web <c>seat_heater_left</c>).</param>
/// <param name="SeatHeaterRight">Front-right seat heater level (web <c>seat_heater_right</c>).</param>
/// <param name="SeatHeaterRearLeft">Rear-left seat heater level (web <c>seat_heater_rear_left</c>).</param>
/// <param name="SeatHeaterRearCenter">Rear-center seat heater level (web <c>seat_heater_rear_center</c>).</param>
/// <param name="SeatHeaterRearRight">Rear-right seat heater level (web <c>seat_heater_rear_right</c>).</param>
/// <param name="SteeringWheelHeatLevel">Steering-wheel heat level 0–3, or null (web <c>hvac_steering_wheel_heat_level</c>).</param>
/// <param name="DefrostMode">Defrost mode string, or null (web <c>defrost_mode</c>).</param>
/// <param name="BatteryHeaterOn">Whether the battery heater is on (web <c>battery_heater_on</c>).</param>
public sealed record ClimateControlPanelReading(
    double? InsideTempC,
    double? OutsideTempC,
    double? HvacPowerKw,
    bool HvacAcEnabled,
    int? FanSpeed,
    int? SeatHeaterLeft,
    int? SeatHeaterRight,
    int? SeatHeaterRearLeft,
    int? SeatHeaterRearCenter,
    int? SeatHeaterRearRight,
    int? SteeringWheelHeatLevel,
    string? DefrostMode,
    bool BatteryHeaterOn)
{
    /// <summary>
    /// Project a <c>GET /climate/latest</c> response into the climate slice. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>climateData</c> being null
    /// (the empty surface). Any object yields a reading (matching the web's truthy <c>climateData ?</c> gate);
    /// individual absent/null fields parse to <see langword="null"/> so a partial body never throws and each
    /// cell independently shows the em dash, exactly like the web's per-field <c>!= null</c> checks.
    /// </summary>
    public static ClimateControlPanelReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ClimateControlPanelReading(
            InsideTempC: ReadDouble(root, "inside_temp"),
            OutsideTempC: ReadDouble(root, "outside_temp"),
            HvacPowerKw: ReadDouble(root, "hvac_power"),
            HvacAcEnabled: ReadBool(root, "hvac_ac_enabled"),
            FanSpeed: ReadInt(root, "hvac_fan_speed"),
            SeatHeaterLeft: ReadInt(root, "seat_heater_left"),
            SeatHeaterRight: ReadInt(root, "seat_heater_right"),
            SeatHeaterRearLeft: ReadInt(root, "seat_heater_rear_left"),
            SeatHeaterRearCenter: ReadInt(root, "seat_heater_rear_center"),
            SeatHeaterRearRight: ReadInt(root, "seat_heater_rear_right"),
            SteeringWheelHeatLevel: ReadInt(root, "hvac_steering_wheel_heat_level"),
            DefrostMode: ReadString(root, "defrost_mode"),
            BatteryHeaterOn: ReadBool(root, "battery_heater_on"));
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

    private static int? ReadInt(JsonElement obj, string name)
    {
        // Tesla reports integer levels (seat 0–3, fan 0–11, steering 0–3); tolerate "3" / 3 / 3.0 and round.
        if (ReadDouble(obj, name) is { } d)
        {
            return (int)Math.Round(d, MidpointRounding.AwayFromZero);
        }

        return null;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>ClimateControlPanelWidget</c> renders a single-temperature compact body when
/// <c>cols &lt;= 1 &amp;&amp; rows &lt;= 1</c> and the full panel otherwise, so this footprint drives the
/// compact/full branch.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ClimateControlPanelSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ClimateControlPanelSize Default => new(2, 4);

    /// <summary>True for the web compact branch (<c>cols &lt;= 1 &amp;&amp; rows &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;
}

/// <summary>
/// One active seat-heater chip in the projected panel — the native analogue of a web <c>seatHeaters</c> entry
/// (<c>{ label, level }</c>) rendered as the "FL 1/3" chip. Only seats with a positive level are present.
/// </summary>
/// <param name="Label">Localized seat label ("FL" / "FR" / "RL" / "RC" / "RR").</param>
/// <param name="LevelText">Pre-formatted level, e.g. "2/3".</param>
public sealed record ClimateControlPanelSeat(string Label, string LevelText);

/// <summary>
/// The fully projected, render-ready view of the climate-control panel for one unit preference — the native
/// analogue of everything the web component computes before returning JSX (the unit-converted cabin / outside
/// strings, the HVAC on/off badge and power string, the fan-speed and steering-heat readouts, the active
/// seat-heater chips and the defrost / battery-heater chips). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="CabinLabel">Localized "Cabin" cell label.</param>
/// <param name="CabinText">Pre-formatted cabin temperature with unit, e.g. "21°C", or the em dash.</param>
/// <param name="OutsideLabel">Localized "Outside" cell label.</param>
/// <param name="OutsideText">Pre-formatted outside temperature with unit, e.g. "15°C", or the em dash.</param>
/// <param name="HvacOn">Whether HVAC is on (web <c>hvac_power &gt; 0 || hvac_ac_enabled</c>).</param>
/// <param name="HvacBadgeText">Localized "HVAC On" / "HVAC Off" badge label.</param>
/// <param name="HvacPowerText">Pre-formatted HVAC power, e.g. "2.5 kW", or null when not shown (web <c>hvac_power &gt; 0</c>).</param>
/// <param name="FanLabel">Localized "Fan Speed" cell label.</param>
/// <param name="FanText">Pre-formatted fan speed, e.g. "5", or the em dash.</param>
/// <param name="SteeringLabel">Localized "Wheel Heat" cell label.</param>
/// <param name="SteeringText">Pre-formatted steering heat, e.g. "2/3", or the localized "Off".</param>
/// <param name="Seats">The active seat-heater chips (empty when none active).</param>
/// <param name="NoSeatText">Localized "No seat heaters active" message (shown when <paramref name="Seats"/> is empty).</param>
/// <param name="ShowDefrostChip">Whether to render the defrost chip (web <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c>).</param>
/// <param name="DefrostChipText">Localized "Defrost" chip label.</param>
/// <param name="ShowBatteryHeaterChip">Whether to render the battery-heater chip (web <c>battery_heater_on</c>).</param>
/// <param name="BatteryHeaterChipText">Localized "Bat Heater" chip label.</param>
/// <param name="CompactAutomationName">Narrator name for the compact single-temperature body.</param>
/// <param name="AutomationName">Narrator name summarising the full panel.</param>
public sealed record ClimateControlPanelDisplay(
    string CabinLabel,
    string CabinText,
    string OutsideLabel,
    string OutsideText,
    bool HvacOn,
    string HvacBadgeText,
    string? HvacPowerText,
    string FanLabel,
    string FanText,
    string SteeringLabel,
    string SteeringText,
    IReadOnlyList<ClimateControlPanelSeat> Seats,
    string NoSeatText,
    bool ShowDefrostChip,
    string DefrostChipText,
    bool ShowBatteryHeaterChip,
    string BatteryHeaterChipText,
    string CompactAutomationName,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ClimateControlPanelReading"/> to the display model — the native port
/// of the web component's inline formatting in
/// web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx. The cabin and outside temperatures honour
/// the user's temperature preference at zero fraction digits exactly like the web
/// <c>fmtInt(convertTempFromSI(…))</c> + the unit suffix; the HVAC power reproduces the web
/// <c>fmtNumber(hvac_power, 1) + ' kW'</c>; the fan speed and steering / seat levels reproduce the web raw
/// interpolation; each null reading reproduces the web em dash. The HVAC badge reproduces the web
/// <c>(hvac_power &gt; 0) || hvac_ac_enabled</c> guard, the defrost chip the web
/// <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c> guard and the battery-heater chip the web
/// <c>battery_heater_on</c> guard. Every label resolves through the i18n facade.
/// </summary>
public static class ClimateControlPanelProjection
{
    /// <summary>Segoe Fluent "Temperature" glyph — the web <c>Thermometer</c> icon (title / cabin / outside / compact / empty / seat-heat).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent "PowerButton" glyph — the web <c>Power</c> HVAC-status icon.</summary>
    public const string PowerGlyph = "\uE7E8";

    /// <summary>Segoe Fluent "Speed" gauge glyph — approximates the web <c>Fan</c> fan-speed icon.</summary>
    public const string FanGlyph = "\uE950";

    /// <summary>Segoe Fluent rings glyph — approximates the web <c>CircleDot</c> steering-wheel-heat icon.</summary>
    public const string SteeringGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "Frigid" glyph — the web <c>Snowflake</c> defrost-chip icon.</summary>
    public const string SnowflakeGlyph = "\uEB3A";

    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> battery-heater-chip icon.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Temperature fraction digits (web <c>fmtInt</c> = <c>fmtNumber(…, 0)</c>).</summary>
    public const int TemperaturePrecision = 0;

    /// <summary>HVAC power fraction digits (web <c>fmtNumber(hvac_power, 1)</c>).</summary>
    public const int HvacPrecision = 1;

    /// <summary>The steering / seat heater scale denominator (web <c>{level}/3</c>).</summary>
    public const int HeatScale = 3;

    /// <summary>The exact defrost-off literal the web compares against (web <c>defrost_mode !== 'Off'</c>).</summary>
    public const string DefrostOff = "Off";

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static ClimateControlPanelDisplay Project(ClimateControlPanelReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string cabinLabel = localizer.GetString("widget.climatePanel.cabin", "Cabin");
        string outsideLabel = localizer.GetString("widget.climatePanel.outside", "Outside");
        string fanLabel = localizer.GetString("widget.climatePanel.fanSpeed", "Fan Speed");
        string steeringLabel = localizer.GetString("widget.climatePanel.steeringHeat", "Wheel Heat");
        string offText = localizer.GetString("widget.climatePanel.off", "Off");
        string noSeatText = localizer.GetString("widget.climatePanel.noSeatHeat", "No seat heaters active");
        string defrostText = localizer.GetString("widget.climatePanel.defrost", "Defrost");
        string batHeaterText = localizer.GetString("widget.climatePanel.batHeater", "Bat Heater");

        string cabinText = FormatTemperature(reading.InsideTempC, units);
        string outsideText = FormatTemperature(reading.OutsideTempC, units);

        bool hvacOn = HvacOn(reading);
        string hvacBadge = hvacOn
            ? localizer.GetString("widget.climatePanel.hvacOn", "HVAC On")
            : localizer.GetString("widget.climatePanel.hvacOff", "HVAC Off");
        string? hvacPowerText = FormatHvacPower(reading.HvacPowerKw);

        string fanText = FormatFanSpeed(reading.FanSpeed);
        string steeringText = FormatHeatLevel(reading.SteeringWheelHeatLevel, offText);
        var seats = BuildSeats(reading, localizer);

        bool showDefrost = ShowDefrost(reading.DefrostMode);
        bool showBatHeater = reading.BatteryHeaterOn;

        string compactAutomation = $"{cabinLabel} {cabinText}";
        string automation = BuildAutomationName(
            hvacBadge, hvacPowerText,
            cabinLabel, cabinText, outsideLabel, outsideText,
            fanLabel, fanText, steeringLabel, steeringText,
            seats, noSeatText,
            showDefrost ? defrostText : null,
            showBatHeater ? batHeaterText : null);

        return new ClimateControlPanelDisplay(
            CabinLabel: cabinLabel,
            CabinText: cabinText,
            OutsideLabel: outsideLabel,
            OutsideText: outsideText,
            HvacOn: hvacOn,
            HvacBadgeText: hvacBadge,
            HvacPowerText: hvacPowerText,
            FanLabel: fanLabel,
            FanText: fanText,
            SteeringLabel: steeringLabel,
            SteeringText: steeringText,
            Seats: seats,
            NoSeatText: noSeatText,
            ShowDefrostChip: showDefrost,
            DefrostChipText: defrostText,
            ShowBatteryHeaterChip: showBatHeater,
            BatteryHeaterChipText: batHeaterText,
            CompactAutomationName: compactAutomation,
            AutomationName: automation);
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

    /// <summary>Format HVAC power the web way — null/≤0 → not shown (null), otherwise <c>fmtNumber(kw, 1) + ' kW'</c>.</summary>
    public static string? FormatHvacPower(double? kw)
    {
        if (kw is not { } value || double.IsNaN(value) || double.IsInfinity(value) || value <= 0)
        {
            return null;
        }

        return ScalarFormatters.FormatNumber(value, HvacPrecision) + " kW";
    }

    /// <summary>Format the fan speed the web way — null → em dash, otherwise the raw level (web <c>${hvac_fan_speed}</c>).</summary>
    public static string FormatFanSpeed(int? fanSpeed) =>
        fanSpeed is { } v ? ScalarFormatters.FormatNumber(v) : EmDash;

    /// <summary>Format a steering / seat heat level — &gt;0 → "{level}/3", otherwise the localized "Off" (web <c>level &gt; 0 ? `${level}/3` : 'Off'</c>).</summary>
    public static string FormatHeatLevel(int? level, string offText)
    {
        ArgumentNullException.ThrowIfNull(offText);
        int value = level ?? 0;
        return value > 0
            ? $"{ScalarFormatters.FormatNumber(value)}/{HeatScale}"
            : offText;
    }

    /// <summary>True when HVAC is on (web <c>(hvac_power != null &amp;&amp; hvac_power &gt; 0) || hvac_ac_enabled === true</c>).</summary>
    public static bool HvacOn(ClimateControlPanelReading reading)
    {
        ArgumentNullException.ThrowIfNull(reading);
        return (reading.HvacPowerKw is { } kw && kw > 0) || reading.HvacAcEnabled;
    }

    /// <summary>True when the defrost chip should render (web <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c>).</summary>
    public static bool ShowDefrost(string? defrostMode) =>
        !string.IsNullOrEmpty(defrostMode) && !string.Equals(defrostMode, DefrostOff, StringComparison.Ordinal);

    /// <summary>
    /// Build the active seat-heater chips in the web order (FL, FR, RL, RC, RR), one per seat with a positive
    /// level — the native analogue of the web <c>seatHeaters</c> memo and its <c>!= null &amp;&amp; &gt; 0</c> guards.
    /// </summary>
    public static IReadOnlyList<ClimateControlPanelSeat> BuildSeats(ClimateControlPanelReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var seats = new List<ClimateControlPanelSeat>(5);
        AddSeat(seats, reading.SeatHeaterLeft, localizer.GetString("widget.climatePanel.seatFL", "FL"));
        AddSeat(seats, reading.SeatHeaterRight, localizer.GetString("widget.climatePanel.seatFR", "FR"));
        AddSeat(seats, reading.SeatHeaterRearLeft, localizer.GetString("widget.climatePanel.seatRL", "RL"));
        AddSeat(seats, reading.SeatHeaterRearCenter, localizer.GetString("widget.climatePanel.seatRC", "RC"));
        AddSeat(seats, reading.SeatHeaterRearRight, localizer.GetString("widget.climatePanel.seatRR", "RR"));
        return seats;
    }

    private static void AddSeat(List<ClimateControlPanelSeat> seats, int? level, string label)
    {
        if (level is { } v && v > 0)
        {
            seats.Add(new ClimateControlPanelSeat(label, $"{ScalarFormatters.FormatNumber(v)}/{HeatScale}"));
        }
    }

    private static string BuildAutomationName(
        string hvacBadge, string? hvacPowerText,
        string cabinLabel, string cabinText,
        string outsideLabel, string outsideText,
        string fanLabel, string fanText,
        string steeringLabel, string steeringText,
        IReadOnlyList<ClimateControlPanelSeat> seats, string noSeatText,
        string? defrostText,
        string? batHeaterText)
    {
        var parts = new List<string>(8)
        {
            hvacPowerText is null ? hvacBadge : $"{hvacBadge} {hvacPowerText}",
            $"{cabinLabel} {cabinText}",
            $"{outsideLabel} {outsideText}",
            $"{fanLabel} {fanText}",
            $"{steeringLabel} {steeringText}",
        };

        parts.Add(seats.Count > 0
            ? string.Join(", ", seats.Select(s => $"{s.Label} {s.LevelText}"))
            : noSeatText);

        if (defrostText is not null)
        {
            parts.Add(defrostText);
        }

        if (batHeaterText is not null)
        {
            parts.Add(batHeaterText);
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ClimateControlPanelReading&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline). A successful emission whose body carries no climate object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{climateData ? … : empty}</c>
/// gate. Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ClimateControlPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s climate payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<ClimateControlPanelReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ClimateControlPanelReading? Parse() =>
            raw.HasValue ? ClimateControlPanelReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ClimateControlPanelReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<ClimateControlPanelReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ClimateControlPanelReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<ClimateControlPanelReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ClimateControlPanelReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<ClimateControlPanelReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ClimateControlPanelReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ClimateControlPanelReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<ClimateControlPanelReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ClimateControlPanelReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ClimateControlPanelReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
