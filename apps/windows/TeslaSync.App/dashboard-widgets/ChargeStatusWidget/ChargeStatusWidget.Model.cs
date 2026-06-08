using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargeStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargeStatusWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/ChargeStatusWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{state ? … : &lt;EmptyState&gt;}</c> gate — no resolved vehicle / no usable state in the response — the
/// "No charge data" surface.
/// </summary>
public enum ChargeStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a vehicle state to render the charge view for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the "No charge data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the view plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the view plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the charge view reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the web
/// <c>VehicleState</c> slice the widget consumes (<c>battery_level</c>, <c>is_charging</c>,
/// <c>charger_power</c>, <c>charge_rate</c>, <c>time_to_full_charge</c>, <c>rated_range</c>, web/src/api/types).
/// Values are read verbatim from the wire exactly as the web component reads them — the web treats
/// <c>charger_power</c> as kW and <c>time_to_full_charge</c> as hours, and reads <c>charge_rate</c> and
/// <c>rated_range</c> as SI metres — so the native surface reproduces the web's observable output, never
/// silently "corrected". A <see langword="null"/> parse result models the web <c>stateData?.state</c> being
/// undefined (no state in the response → the empty surface). Parsing is null-tolerant so a partial body never
/// throws.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent (0–100, unit-free; web <c>battery_level</c>).</param>
/// <param name="IsCharging">Whether the vehicle is actively charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power as the web reads it — kilowatts (web <c>charger_power</c>).</param>
/// <param name="ChargeRateMeters">Range added per hour in SI metres (web <c>charge_rate</c>).</param>
/// <param name="TimeToFullHours">Hours to a full charge (web <c>time_to_full_charge</c>).</param>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>rated_range</c>).</param>
public sealed record ChargeStatusReading(
    double BatteryLevel,
    bool IsCharging,
    double ChargerPowerKw,
    double ChargeRateMeters,
    double TimeToFullHours,
    double RatedRangeMeters)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the charge slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct
    /// from <c>position.battery_level</c> + the top-level charging fields when a <c>vehicle</c>/<c>position</c>
    /// is present. Returns <see langword="null"/> when none of those yield a state — the native analogue of the
    /// web <c>state</c> being undefined.
    /// </summary>
    public static ChargeStatusReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — a plain state object is still usable,
            // otherwise there is no state and the widget shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): battery from the position snapshot; the charging fields from top-level res.
        return new ChargeStatusReading(
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"),
            ChargerPowerKw: ReadDouble(root, "charger_power") ?? 0,
            ChargeRateMeters: ReadDouble(root, "charge_rate") ?? 0,
            TimeToFullHours: ReadDouble(root, "time_to_full_charge") ?? 0,
            RatedRangeMeters: ReadDouble(root, "rated_range") ?? 0);
    }

    private static ChargeStatusReading FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"),
        ChargerPowerKw: ReadDouble(state, "charger_power") ?? 0,
        ChargeRateMeters: ReadDouble(state, "charge_rate") ?? 0,
        TimeToFullHours: ReadDouble(state, "time_to_full_charge") ?? 0,
        RatedRangeMeters: ReadDouble(state, "rated_range") ?? 0);

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

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
/// <c>ChargeStatusWidget</c> renders the same composition at every footprint (it never branches on
/// <c>size</c>), so this carries only the registry min/max constraints — no compact / tall variants.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct ChargeStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargeStatusSize Default => new(2, 2);
}

/// <summary>
/// The fully projected, render-ready view of the charge surface for one unit preference — the native analogue
/// of everything the web component computes before returning JSX (the unit-converted power / rate / range
/// strings, the time-to-full string and the idle summary line). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="IsCharging">Whether to render the charging grid (web <c>state.is_charging</c>).</param>
/// <param name="ChargingLabel">Localized "Charging" status label.</param>
/// <param name="PowerLabel">Localized "Power" cell label.</param>
/// <param name="PowerText">Pre-formatted charger power, e.g. "7.20 kW" (web <c>fmtNumber(charger_power) kW</c>).</param>
/// <param name="RateLabel">Localized "Rate" cell label.</param>
/// <param name="RateText">Pre-formatted charge rate, e.g. "16 km/h" (web distance-unit/h).</param>
/// <param name="BatteryLabel">Localized "Battery" cell label.</param>
/// <param name="BatteryText">Pre-formatted battery percent, e.g. "80%" (web <c>{battery_level}%</c>).</param>
/// <param name="TimeToFullLabel">Localized "Time to Full" cell label.</param>
/// <param name="TimeToFullText">Pre-formatted hours-to-full, e.g. "2.5h" or the em dash.</param>
/// <param name="NotChargingText">Localized "Not Charging" headline (idle surface).</param>
/// <param name="IdleSummaryText">Idle "{battery}% · {range} {unit}" summary line.</param>
/// <param name="ChargingAutomationName">Narrator name summarising the charging surface.</param>
/// <param name="IdleAutomationName">Narrator name summarising the idle surface.</param>
public sealed record ChargeStatusDisplay(
    bool IsCharging,
    string ChargingLabel,
    string PowerLabel,
    string PowerText,
    string RateLabel,
    string RateText,
    string BatteryLabel,
    string BatteryText,
    string TimeToFullLabel,
    string TimeToFullText,
    string NotChargingText,
    string IdleSummaryText,
    string ChargingAutomationName,
    string IdleAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargeStatusReading"/> to the display model — the native port of the
/// web component's inline formatting in web/src/features/dashboard/widgets/ChargeStatusWidget.tsx. Power honours
/// the user's global precision exactly like the web <c>fmtNumber(charger_power)</c> (default two fraction
/// digits); the charge rate and rated range honour the user's distance preference at zero fraction digits like
/// the web <c>fmtInt(convertDistanceFromSI(…))</c> / <c>fmtNumber(convertDistanceFromSI(…), 0)</c>; the battery
/// percent reproduces the web's raw <c>{battery_level}%</c> interpolation; the time-to-full reproduces the web
/// <c>time_to_full &gt; 0 ? fmtNumber(h, 1) + "h" : "—"</c> guard. Every label resolves through the i18n facade.
/// </summary>
public static class ChargeStatusProjection
{
    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> icon (idle + empty surfaces).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Battery10" glyph — the web <c>BatteryCharging</c> charging-status icon.</summary>
    public const string BatteryChargingGlyph = "\uE83F";

    /// <summary>The em dash the web renders for a non-positive time-to-full (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Default power fraction digits — the web <c>fmtNumber</c> global precision when the user has set none
    /// (<c>_globalPrecision = 2</c> in web/src/lib/numberFormat.ts).
    /// </summary>
    public const int DefaultPowerPrecision = 2;

    /// <summary>Charge-rate / rated-range fraction digits (web <c>fmtInt</c> / <c>fmtNumber(…, 0)</c>).</summary>
    public const int DistancePrecision = 0;

    /// <summary>Time-to-full fraction digits (web <c>fmtNumber(time_to_full, 1)</c>).</summary>
    public const int TimePrecision = 1;

    /// <summary>The idle summary separator (web <c>{battery}% · {range} {unit}</c>).</summary>
    public const string SummarySeparator = " \u00B7 ";

    /// <summary>Project <paramref name="reading"/> for <paramref name="units"/> using the localizer for every label.</summary>
    public static ChargeStatusDisplay Project(ChargeStatusReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string chargingLabel = localizer.GetString("widget.charging", "Charging");
        string powerLabel = localizer.GetString("widget.power", "Power");
        string rateLabel = localizer.GetString("widget.rate", "Rate");
        string batteryLabel = localizer.GetString("widget.battery", "Battery");
        string timeToFullLabel = localizer.GetString("widget.timeToFull", "Time to Full");
        string notChargingText = localizer.GetString("widget.notCharging", "Not Charging");

        string powerText = FormatPower(reading.ChargerPowerKw, units);
        string rateText = FormatRate(reading.ChargeRateMeters, units);
        string batteryText = FormatBattery(reading.BatteryLevel);
        string timeToFullText = FormatTimeToFull(reading.TimeToFullHours);
        string idleSummary = FormatIdleSummary(reading.BatteryLevel, reading.RatedRangeMeters, units);

        string chargingName = $"{chargingLabel}, {powerLabel} {powerText}, {batteryLabel} {batteryText}, {timeToFullLabel} {timeToFullText}";
        string idleName = $"{notChargingText}, {idleSummary}";

        return new ChargeStatusDisplay(
            IsCharging: reading.IsCharging,
            ChargingLabel: chargingLabel,
            PowerLabel: powerLabel,
            PowerText: powerText,
            RateLabel: rateLabel,
            RateText: rateText,
            BatteryLabel: batteryLabel,
            BatteryText: batteryText,
            TimeToFullLabel: timeToFullLabel,
            TimeToFullText: timeToFullText,
            NotChargingText: notChargingText,
            IdleSummaryText: idleSummary,
            ChargingAutomationName: chargingName,
            IdleAutomationName: idleName);
    }

    /// <summary>Format charger kW the way the web does — <c>fmtNumber(charger_power)</c> at the user's precision, plus " kW".</summary>
    public static string FormatPower(double kw, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        int precision = units.Precision is { } p and >= 0 ? p : DefaultPowerPrecision;
        return ScalarFormatters.FormatNumber(Safe(kw), precision) + " kW";
    }

    /// <summary>Format an SI range-added rate as "{value} {distanceUnit}/h" honouring the user's distance preference (web <c>fmtInt(convertDistanceFromSI(…)) {unit}/h</c>).</summary>
    public static string FormatRate(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double display = UnitConverters.DistanceFromSi(Safe(meters), units.Distance);
        return $"{ScalarFormatters.FormatNumber(display, DistancePrecision)} {UnitLabels.Label(units.Distance)}/h";
    }

    /// <summary>Format a battery percent the way the web interpolates <c>{battery_level}%</c> (raw number + "%").</summary>
    public static string FormatBattery(double value) =>
        Safe(value).ToString(CultureInfo.InvariantCulture) + "%";

    /// <summary>Format hours-to-full as the web does: non-positive → em dash, otherwise <c>fmtNumber(h, 1) + "h"</c>.</summary>
    public static string FormatTimeToFull(double hours)
    {
        double safe = Safe(hours);
        return safe > 0 ? ScalarFormatters.FormatNumber(safe, TimePrecision) + "h" : EmDash;
    }

    /// <summary>Format the idle summary "{battery}% · {ratedRange} {unit}" (web idle line) honouring the distance preference.</summary>
    public static string FormatIdleSummary(double batteryLevel, double ratedMeters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double range = UnitConverters.DistanceFromSi(Safe(ratedMeters), units.Distance);
        string rangeText = $"{ScalarFormatters.FormatNumber(range, DistancePrecision)} {UnitLabels.Label(units.Distance)}";
        return FormatBattery(batteryLevel) + SummarySeparator + rangeText;
    }

    private static double Safe(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;ChargeStatusReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no usable state collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? … : empty}</c> gate.
/// Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargeStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s state payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<ChargeStatusReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargeStatusReading? Parse() =>
            raw.HasValue ? ChargeStatusReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargeStatusReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<ChargeStatusReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargeStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<ChargeStatusReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargeStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<ChargeStatusReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ChargeStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargeStatusReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<ChargeStatusReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ChargeStatusReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ChargeStatusReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
