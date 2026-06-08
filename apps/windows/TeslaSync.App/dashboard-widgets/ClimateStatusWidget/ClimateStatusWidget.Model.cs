using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ClimateStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ClimateStatusWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ClimateStatusWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{climateData ? … : &lt;EmptyState&gt;}</c> gate — the response carried no climate object — the
/// "No climate data" surface.
/// </summary>
public enum ClimateStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a climate object to render the rows for.</summary>
    Loaded,

    /// <summary>No climate object in the response — render the "No climate data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the climate view reads from <c>GET /climate/latest?vehicle_id={id}</c> — the native mirror of the
/// exact <c>ClimateSnapshot</c> slice the web widget consumes. The web component reads the compat-view aliases
/// <c>inside_temp</c> / <c>outside_temp</c> (SI degrees Celsius), <c>hvac_power</c> (kilowatts, as the web reads
/// it), <c>defrost_mode</c> (string) and <c>battery_heater_on</c> (bool); those exact wire names are read here
/// verbatim so the native surface reproduces the web's observable output, never silently substituting the typed
/// <c>inside_temp_c</c> columns the web does not read. A <see langword="null"/> parse result models the web
/// <c>climateData</c> being null/undefined (no climate object → the empty surface); a missing numeric field
/// parses to <see langword="null"/> so the row shows the em dash exactly like the web <c>!= null</c> guards.
/// </summary>
/// <param name="InsideTempC">Cabin temperature in SI Celsius, or null (web <c>inside_temp</c>).</param>
/// <param name="OutsideTempC">Ambient temperature in SI Celsius, or null (web <c>outside_temp</c>).</param>
/// <param name="HvacPowerKw">HVAC power in kilowatts as the web reads it, or null (web <c>hvac_power</c>).</param>
/// <param name="DefrostMode">Defrost mode string, or null (web <c>defrost_mode</c>).</param>
/// <param name="BatteryHeaterOn">Whether the battery heater is on (web <c>battery_heater_on</c>).</param>
public sealed record ClimateStatusReading(
    double? InsideTempC,
    double? OutsideTempC,
    double? HvacPowerKw,
    string? DefrostMode,
    bool BatteryHeaterOn)
{
    /// <summary>
    /// Project a <c>GET /climate/latest</c> response into the climate slice. Returns <see langword="null"/>
    /// when the body is not a JSON object — the native analogue of the web <c>climateData</c> being null
    /// (the empty surface). Any object yields a reading (matching the web's truthy <c>climateData ?</c> gate);
    /// individual absent/null fields parse to <see langword="null"/> so a partial body never throws and each
    /// row independently shows the em dash, exactly like the web's per-field <c>!= null</c> checks.
    /// </summary>
    public static ClimateStatusReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ClimateStatusReading(
            InsideTempC: ReadDouble(root, "inside_temp"),
            OutsideTempC: ReadDouble(root, "outside_temp"),
            HvacPowerKw: ReadDouble(root, "hvac_power"),
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
/// <c>ClimateStatusWidget</c> renders the same composition at every footprint (it never branches on
/// <c>size</c>), so this carries only the registry min/max constraints — no compact / tall variants.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ClimateStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static ClimateStatusSize Default => new(1, 2);
}

/// <summary>
/// The fully projected, render-ready view of the climate surface for one unit preference — the native analogue
/// of everything the web component computes before returning JSX (the unit-converted cabin / outside strings,
/// the HVAC power string and the two conditional status chips). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="CabinLabel">Localized "Cabin" row label.</param>
/// <param name="CabinText">Pre-formatted cabin temperature, e.g. "21°C" or the em dash.</param>
/// <param name="OutsideLabel">Localized "Outside" row label.</param>
/// <param name="OutsideText">Pre-formatted outside temperature, e.g. "15°C" or the em dash.</param>
/// <param name="HvacLabel">Localized "HVAC" row label.</param>
/// <param name="HvacText">Pre-formatted HVAC power, e.g. "2.5 kW" or the em dash.</param>
/// <param name="ShowDefrostChip">Whether to render the defrost chip (web <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c>).</param>
/// <param name="DefrostChipText">Localized "Defrost" chip label.</param>
/// <param name="ShowHeaterChip">Whether to render the battery-heater chip (web <c>battery_heater_on</c>).</param>
/// <param name="HeaterChipText">Localized "Heater" chip label.</param>
/// <param name="AutomationName">Narrator name summarising the rendered rows + active chips.</param>
public sealed record ClimateStatusDisplay(
    string CabinLabel,
    string CabinText,
    string OutsideLabel,
    string OutsideText,
    string HvacLabel,
    string HvacText,
    bool ShowDefrostChip,
    string DefrostChipText,
    bool ShowHeaterChip,
    string HeaterChipText,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ClimateStatusReading"/> to the display model — the native port of the
/// web component's inline formatting in web/src/features/dashboard/widgets/ClimateStatusWidget.tsx. The cabin
/// and outside temperatures honour the user's temperature preference at zero fraction digits exactly like the
/// web <c>fmtInt(convertTempFromSI(…))</c> + the unit suffix; the HVAC power reproduces the web
/// <c>fmtNumber(hvac_power, 1) + ' kW'</c>; each null reading reproduces the web em dash. The defrost chip
/// reproduces the web <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c> guard and the heater chip the web
/// <c>battery_heater_on</c> guard. Every label resolves through the i18n facade.
/// </summary>
public static class ClimateStatusProjection
{
    /// <summary>Segoe Fluent "Temperature" glyph — the web <c>Thermometer</c> icon (title + empty surfaces).</summary>
    public const string ThermometerGlyph = "\uE9CA";

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

    /// <summary>The exact defrost-off literal the web compares against (web <c>defrost_mode !== 'Off'</c>).</summary>
    public const string DefrostOff = "Off";

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static ClimateStatusDisplay Project(ClimateStatusReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string cabinLabel = localizer.GetString("widget.cabin", "Cabin");
        string outsideLabel = localizer.GetString("widget.outside", "Outside");
        string hvacLabel = localizer.GetString("widget.hvac", "HVAC");
        string defrostText = localizer.GetString("widget.defrost", "Defrost");
        string heaterText = localizer.GetString("widget.batHeater", "Heater");

        string cabinText = FormatTemperature(reading.InsideTempC, units);
        string outsideText = FormatTemperature(reading.OutsideTempC, units);
        string hvacText = FormatHvac(reading.HvacPowerKw);
        bool showDefrost = ShowDefrost(reading.DefrostMode);
        bool showHeater = reading.BatteryHeaterOn;

        string automation = BuildAutomationName(
            cabinLabel, cabinText, outsideLabel, outsideText, hvacLabel, hvacText,
            showDefrost ? defrostText : null,
            showHeater ? heaterText : null);

        return new ClimateStatusDisplay(
            CabinLabel: cabinLabel,
            CabinText: cabinText,
            OutsideLabel: outsideLabel,
            OutsideText: outsideText,
            HvacLabel: hvacLabel,
            HvacText: hvacText,
            ShowDefrostChip: showDefrost,
            DefrostChipText: defrostText,
            ShowHeaterChip: showHeater,
            HeaterChipText: heaterText,
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

    /// <summary>Format HVAC power the way the web does — null → em dash, otherwise <c>fmtNumber(kw, 1) + ' kW'</c>.</summary>
    public static string FormatHvac(double? kw)
    {
        if (kw is not { } value || double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        return ScalarFormatters.FormatNumber(value, HvacPrecision) + " kW";
    }

    /// <summary>True when the defrost chip should render (web <c>defrost_mode &amp;&amp; defrost_mode !== 'Off'</c>).</summary>
    public static bool ShowDefrost(string? defrostMode) =>
        !string.IsNullOrEmpty(defrostMode) && !string.Equals(defrostMode, DefrostOff, StringComparison.Ordinal);

    private static string BuildAutomationName(
        string cabinLabel, string cabinText,
        string outsideLabel, string outsideText,
        string hvacLabel, string hvacText,
        string? defrostText,
        string? heaterText)
    {
        var parts = new List<string>(5)
        {
            $"{cabinLabel} {cabinText}",
            $"{outsideLabel} {outsideText}",
            $"{hvacLabel} {hvacText}",
        };

        if (defrostText is not null)
        {
            parts.Add(defrostText);
        }

        if (heaterText is not null)
        {
            parts.Add(heaterText);
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ClimateStatusReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no climate object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{climateData ? … : empty}</c>
/// gate. Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ClimateStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s climate payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<ClimateStatusReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ClimateStatusReading? Parse() =>
            raw.HasValue ? ClimateStatusReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ClimateStatusReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<ClimateStatusReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ClimateStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<ClimateStatusReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ClimateStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<ClimateStatusReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ClimateStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ClimateStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<ClimateStatusReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ClimateStatusReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ClimateStatusReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
