using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargeStatusLiveViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargeStatusLiveWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate — no resolved vehicle / no usable state in the response — the "No charge data" surface.
/// </summary>
public enum ChargeStatusLiveState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle state to render the live charge view for.</summary>
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
/// The fields the live charge view reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes (<c>battery_level</c>, <c>is_charging</c>,
/// <c>charger_power</c>, <c>charge_rate</c>, <c>time_to_full_charge</c>, web/src/api/types). Values are read
/// verbatim from the wire exactly as the web component reads them (the web treats <c>charger_power</c> as kW
/// and <c>time_to_full_charge</c> as hours and reads <c>charge_rate</c> as SI range-added metres) so the
/// native surface reproduces the web's observable output — never silently "corrected". A <see langword="null"/>
/// parse result models the web <c>stateData?.state</c> being undefined (no state in the response → the empty
/// surface). Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent (0–100, unit-free; web <c>battery_level</c>).</param>
/// <param name="IsCharging">Whether the vehicle is actively charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power as the web reads it — kilowatts (web <c>charger_power</c>).</param>
/// <param name="ChargeRateMeters">Range added per hour in SI metres (web <c>charge_rate</c>).</param>
/// <param name="TimeToFullHours">Hours to a full charge (web <c>time_to_full_charge</c>).</param>
public sealed record VehicleChargeState(
    double BatteryLevel,
    bool IsCharging,
    double ChargerPowerKw,
    double ChargeRateMeters,
    double TimeToFullHours)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the live charge slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct
    /// from <c>position.battery_level</c> + the top-level charging fields when a <c>vehicle</c>/<c>position</c>
    /// is present. Returns <see langword="null"/> when none of those yield a state — the native analogue of the
    /// web <c>state</c> being undefined.
    /// </summary>
    public static VehicleChargeState? FromResponse(JsonElement root)
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
        return new VehicleChargeState(
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"),
            ChargerPowerKw: ReadDouble(root, "charger_power") ?? 0,
            ChargeRateMeters: ReadDouble(root, "charge_rate") ?? 0,
            TimeToFullHours: ReadDouble(root, "time_to_full_charge") ?? 0);
    }

    private static VehicleChargeState FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"),
        ChargerPowerKw: ReadDouble(state, "charger_power") ?? 0,
        ChargeRateMeters: ReadDouble(state, "charge_rate") ?? 0,
        TimeToFullHours: ReadDouble(state, "time_to_full_charge") ?? 0);

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
/// The latest charging session the widget supplements the live state with — the native mirror of the web
/// <c>useChargingSessionsPaginated(id, { limit: 1 })</c> first row (<c>(sessions ?? [])[0]</c>). The widget
/// reads exactly one field from it, the SI energy added, which feeds the charging "Added" cell and the idle
/// "Last Session" line; the row's mere presence drives the web <c>{latestSession &amp;&amp; …}</c> gate, so a
/// non-null instance means "a session exists" even when its energy is zero. Parsing is null-tolerant.
/// </summary>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>total_energy_added_wh ?? 0</c>).</param>
public sealed record ChargeStatusLiveSession(double EnergyAddedWh)
{
    /// <summary>
    /// Parse the newest session out of a charging-sessions JSON array (the web <c>(sessions ?? [])[0]</c>).
    /// Returns <see langword="null"/> when the payload is not a non-empty array of objects — the native
    /// analogue of <c>latestSession</c> being undefined (no "Last Session" line, energy added defaults to 0).
    /// </summary>
    public static ChargeStatusLiveSession? ParseLatest(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0)
        {
            return null;
        }

        var first = element[0];
        return first.ValueKind == JsonValueKind.Object
            ? new ChargeStatusLiveSession(ReadDouble(first, "total_energy_added_wh") ?? 0)
            : null;
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
}

/// <summary>
/// The combined live-charge snapshot the view-model projects — the native union of the two web queries the
/// component composes: the live vehicle <see cref="State"/> (primary, drives every charging metric and the
/// freshness/error chrome) plus the best-effort newest <see cref="LatestSession"/> (supplementary, may be
/// <see langword="null"/>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargeStatusLiveSnapshot(VehicleChargeState State, ChargeStatusLiveSession? LatestSession);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> logic in
/// web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx.
/// </summary>
public readonly record struct ChargeStatusLiveSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargeStatusLiveSize Default => new(2, 2);

    /// <summary>True at a single 1×1 cell (web <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;

    /// <summary>True at two or more rows (web <c>isTall = size.rows &gt;= 2</c>): adds the Rate + Battery row.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// One small metric cell — the native counterpart of the web <c>MetricCell</c> (a leading glyph, a localized
/// label and a pre-formatted value, plus a Narrator name combining the two). Pure data — no WinUI types.
/// </summary>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon.</param>
/// <param name="Label">The localized cell label.</param>
/// <param name="Value">The pre-formatted cell value.</param>
/// <param name="AutomationName">The Narrator name (label + value).</param>
public sealed record ChargeStatusLiveCell(string Glyph, string Label, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the live charge surface for one footprint + unit preference —
/// the native analogue of everything the web component computes before returning JSX (the derived
/// <c>metrics</c>, the <c>formatTime</c> string, the unit-converted energy/rate strings, and the compact /
/// charging / idle composition flags). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargeStatusLiveDisplay(
    bool IsCharging,
    bool IsCompact,
    bool IsTall,
    bool HasSession,
    double PowerValue,
    int PowerPrecision,
    string PowerSuffix,
    string PowerText,
    string BatteryPercentText,
    string ChargingBadgeLabel,
    string NotChargingText,
    ChargeStatusLiveCell Voltage,
    ChargeStatusLiveCell Current,
    ChargeStatusLiveCell TimeLeft,
    ChargeStatusLiveCell Added,
    ChargeStatusLiveCell Rate,
    ChargeStatusLiveCell Battery,
    string LastSessionLabel,
    string LastSessionValue,
    string ChargingAutomationName,
    string IdleAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargeStatusLiveSnapshot"/> to the display model — the native port of
/// the web component's <c>metrics</c> memo, its <c>formatTime</c> helper and its compact / charging / idle JSX
/// branches in web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx. Energy is always rendered in kWh
/// (the web hard-codes <c>convertEnergyFromSI(…, 'kWh')</c>); the charge rate honours the user's distance
/// preference (web <c>convertDistanceFromSI(…, unitPrefs.distance)</c>); voltage and current are always the
/// em-dash fallback because the web hard-codes them to <c>null</c>. Every label resolves through the i18n
/// facade.
/// </summary>
public static class ChargeStatusLiveProjection
{
    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> icon (header, current, added, empty).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Battery10" glyph — the web <c>BatteryCharging</c> battery cell icon.</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "Recent" (clock) glyph — the web <c>Timer</c> icon (time remaining).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "Speed" (gauge) glyph — the web <c>Gauge</c> icon (voltage, rate).</summary>
    public const string GaugeGlyph = "\uE950";

    /// <summary>Segoe Fluent "PowerButton" glyph — the web <c>Plug</c> icon (the idle / not-charging surface).</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>The em dash the web renders for the hard-coded-null voltage/current cells (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Power readout fraction digits (web <c>AnimatedNumber decimals={1}</c>).</summary>
    public const int PowerPrecision = 1;

    /// <summary>Power readout suffix (web <c>AnimatedNumber suffix=" kW"</c>).</summary>
    public const string PowerSuffix = " kW";

    /// <summary>Energy readout fraction digits (web <c>fmtNumber(…, 1)</c>).</summary>
    public const int EnergyPrecision = 1;

    /// <summary>Charge-rate readout fraction digits (web <c>fmtNumber(…, 0)</c>).</summary>
    public const int RatePrecision = 0;

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> + <paramref name="units"/> using the localizer for every label.</summary>
    public static ChargeStatusLiveDisplay Project(
        ChargeStatusLiveSnapshot snapshot,
        ChargeStatusLiveSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = snapshot.State;
        bool hasSession = snapshot.LatestSession is not null;

        // Web parity: derive the same `metrics` the component memoises.
        double power = Safe(state.ChargerPowerKw);
        double energyAddedWh = Safe(snapshot.LatestSession?.EnergyAddedWh ?? 0);
        double timeToFull = Safe(state.TimeToFullHours);
        double chargeRate = Safe(state.ChargeRateMeters);
        double batteryLevel = Safe(state.BatteryLevel);

        string batteryPercent = FormatPercent(batteryLevel);
        string powerText = ScalarFormatters.FormatNumber(power, PowerPrecision) + PowerSuffix;
        string chargingLabel = localizer.GetString("widget.charging", "Charging");
        string notChargingText = localizer.GetString("widget.notCharging", "Not Charging");

        var voltage = Cell(GaugeGlyph, localizer.GetString("widget.voltage", "Voltage"), EmDash);
        var current = Cell(ZapGlyph, localizer.GetString("widget.amps", "Current"), EmDash);
        var timeLeft = Cell(ClockGlyph, localizer.GetString("widget.timeRemaining", "Time Left"), FormatTime(timeToFull));
        var added = Cell(ZapGlyph, localizer.GetString("widget.energyAdded", "Added"), FormatEnergyKwh(energyAddedWh));
        var rate = Cell(GaugeGlyph, localizer.GetString("widget.chargeRate", "Rate"), FormatRate(chargeRate, units));
        var battery = Cell(BatteryGlyph, localizer.GetString("widget.batteryLevel", "Battery"), batteryPercent);

        string lastSessionLabel = localizer.GetString("widget.lastSession", "Last Session");
        string lastSessionValue = "+" + FormatEnergyKwh(energyAddedWh);

        string chargingName = $"{chargingLabel}, {powerText}, {batteryPercent}";
        string idleName = $"{notChargingText}, {batteryPercent}";

        return new ChargeStatusLiveDisplay(
            IsCharging: state.IsCharging,
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            HasSession: hasSession,
            PowerValue: power,
            PowerPrecision: PowerPrecision,
            PowerSuffix: PowerSuffix,
            PowerText: powerText,
            BatteryPercentText: batteryPercent,
            ChargingBadgeLabel: chargingLabel,
            NotChargingText: notChargingText,
            Voltage: voltage,
            Current: current,
            TimeLeft: timeLeft,
            Added: added,
            Rate: rate,
            Battery: battery,
            LastSessionLabel: lastSessionLabel,
            LastSessionValue: lastSessionValue,
            ChargingAutomationName: chargingName,
            IdleAutomationName: idleName);
    }

    /// <summary>
    /// Format an hours-to-full value exactly as the web <c>formatTime</c>: non-positive → em dash, otherwise a
    /// compact "Hh Mm" (dropping the hour when zero and the minute when zero), with the minute rounded the same
    /// way (<c>Math.round((hours - h) * 60)</c>), reproduced verbatim — including its no-carry edge behaviour.
    /// </summary>
    public static string FormatTime(double hours)
    {
        if (double.IsNaN(hours) || double.IsInfinity(hours) || hours <= 0)
        {
            return EmDash;
        }

        int h = (int)Math.Floor(hours);
        int m = (int)Math.Round((hours - h) * 60, MidpointRounding.AwayFromZero);
        if (h == 0)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{m}m");
        }

        if (m == 0)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{h}h");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m");
    }

    /// <summary>Format a battery percent the way the web interpolates <c>{batteryLevel}%</c> (raw number + "%").</summary>
    public static string FormatPercent(double value)
    {
        double safe = Safe(value);
        return safe.ToString(CultureInfo.InvariantCulture) + "%";
    }

    /// <summary>Format SI watt-hours as the web does — kWh to one fraction digit (web <c>convertEnergyFromSI(…, 'kWh')</c>).</summary>
    public static string FormatEnergyKwh(double wh)
    {
        double kwh = UnitConverters.EnergyFromSi(Safe(wh), EnergyUnit.Kwh);
        return ScalarFormatters.FormatNumber(kwh, EnergyPrecision) + " " + UnitLabels.Label(EnergyUnit.Kwh);
    }

    /// <summary>Format an SI range-added rate as "{value} {distanceUnit}/h" honouring the user's distance preference.</summary>
    public static string FormatRate(double meters, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        double display = UnitConverters.DistanceFromSi(Safe(meters), units.Distance);
        return $"{ScalarFormatters.FormatNumber(display, RatePrecision)} {UnitLabels.Label(units.Distance)}/h";
    }

    private static ChargeStatusLiveCell Cell(string glyph, string label, string value) =>
        new(glyph, label, value, $"{label} {value}");

    private static double Safe(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;ChargeStatusLiveSnapshot&gt;</c>, attaching the best-effort latest
/// <paramref name="session"/> to every content-bearing emission and preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? … : empty}</c>
/// gate. Kept pure so the parse-combine-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargeStatusLiveResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s state payload (when present), attach <paramref name="session"/>, and preserve the status.</summary>
    public static RepositoryResult<ChargeStatusLiveSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        ChargeStatusLiveSession? session)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargeStatusLiveSnapshot? Combine() =>
            raw.HasValue && VehicleChargeState.FromResponse(raw.Value) is { } state
                ? new ChargeStatusLiveSnapshot(state, session)
                : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargeStatusLiveSnapshot>.Loading(),
            LoadStatus.Cached => Combine() is { } cached
                ? RepositoryResult<ChargeStatusLiveSnapshot>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargeStatusLiveSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Combine() is { } refreshing
                ? RepositoryResult<ChargeStatusLiveSnapshot>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<ChargeStatusLiveSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Combine() is { } loaded
                ? RepositoryResult<ChargeStatusLiveSnapshot>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<ChargeStatusLiveSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargeStatusLiveSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Combine() is { } offline
                ? RepositoryResult<ChargeStatusLiveSnapshot>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<ChargeStatusLiveSnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<ChargeStatusLiveSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
