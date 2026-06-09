using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="VehicleHeroViewModel"/> can be in — the native
/// superset of the branches the web <c>VehicleHero</c> renders
/// (web/src/features/dashboard/components/VehicleHero.tsx). The web component is a pure child of the
/// dashboard <c>VehicleHeroWidget</c> (it takes its <c>vehicle</c> + <c>state</c> as props); the native
/// surface binds its own cache-then-network read (the vehicle roster plus that vehicle's live state), so it
/// owns the full loading / loaded / empty / error / stale / offline matrix the P2 state contract requires.
/// Every value maps onto a visible surface (never a blank panel). The web's two inner branches — a populated
/// hero (<c>state</c> present) and the "asleep" panel (<c>state</c> null) — are not lifecycle states: they are
/// content variants of <see cref="Loaded"/> / <see cref="Stale"/> / <see cref="Offline"/> selected by
/// <see cref="VehicleHeroDisplay.IsAwake"/>. <see cref="Empty"/> mirrors the web <c>{vehicle &amp;&amp; …}</c>
/// gate (no resolved vehicle at all).
/// </summary>
public enum VehicleHeroState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with a resolved vehicle — render the hero (awake) or the asleep panel.</summary>
    Loaded,

    /// <summary>No vehicle resolved — render the friendly "no vehicle" empty surface (web <c>vehicle</c> falsy).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the hero plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the hero plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a hero gauge / stat tile renders with — the native, WinUI-free mirror of the web
/// component's per-element neon hue (web/src/features/dashboard/components/VehicleHero.tsx). Kept as an enum so
/// the projection can assign and the tests can assert the colour without a UI host; the view maps each value
/// to a themed design-token brush (and the gauge arc to a <c>ChartRole</c>) at render time, so light / dark /
/// high-contrast all stay legible per the "platform tokens, not web Tailwind" rule.
/// </summary>
public enum VehicleHeroAccent
{
    /// <summary>Cyan (web <c>#00f0ff</c>) — the range / ideal-range gauges and tiles.</summary>
    Cyan,

    /// <summary>Purple (web <c>#a855f7</c>) — the speed / odometer tiles.</summary>
    Purple,

    /// <summary>Green (web <c>#10b981</c>) — healthy battery, charge power/rate, locked status.</summary>
    Green,

    /// <summary>Amber (web <c>#f59e0b</c>) — low battery, positive power draw, time-to-full, unlocked status.</summary>
    Amber,

    /// <summary>Orange (web <c>#f97316</c>) — the inside-temperature gauge / tile.</summary>
    Orange,

    /// <summary>Blue (web <c>#3b82f6</c>) — the outside-temperature gauge / tile.</summary>
    Blue,

    /// <summary>Red (web <c>#ef4444</c>) — active Sentry mode.</summary>
    Red,

    /// <summary>Indigo (web <c>#6366f1</c>) — the firmware tile.</summary>
    Indigo,

    /// <summary>Neutral grey (web <c>#374151</c>) — idle power, inactive Sentry.</summary>
    Neutral,
}

/// <summary>
/// The vehicle identity the hero header shows — the native mirror of the web <c>Vehicle</c> slice the widget
/// passes to <c>&lt;VehicleHero /&gt;</c> (web/src/features/dashboard/types.ts: <c>display_name</c>, <c>vin</c>,
/// <c>model</c>, <c>trim_badging</c>). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Id">The vehicle's database id (web <c>id</c>) used to scope the state read and the detail link.</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle identification number (web <c>vin</c>).</param>
/// <param name="Model">The model code (web <c>model</c>).</param>
/// <param name="TrimBadging">The trim badge (web <c>trim_badging</c>).</param>
public sealed record VehicleHeroVehicle(
    long Id,
    string DisplayName,
    string Vin,
    string Model,
    string TrimBadging)
{
    /// <summary>The sentinel "no vehicle resolved" identity (the parse / empty fallback).</summary>
    public static VehicleHeroVehicle None { get; } = new(0, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Header name — web <c>vehicle.display_name || vehicle.vin</c>.</summary>
    [JsonIgnore]
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>
    /// Header subtitle — web <c>{model} {trim_badging} · {vin}</c>. The model and trim collapse to a single
    /// space-joined token; the VIN is always appended after a middle dot. Absent parts drop out cleanly.
    /// </summary>
    [JsonIgnore]
    public string Subtitle
    {
        get
        {
            string modelTrim = string.Join(
                ' ',
                new[] { Model, TrimBadging }.Where(static p => !string.IsNullOrWhiteSpace(p)).Select(static p => p.Trim()));
            return string.Join(
                " \u00B7 ",
                new[] { modelTrim, (Vin ?? string.Empty).Trim() }.Where(static p => !string.IsNullOrWhiteSpace(p)));
        }
    }

    /// <summary>True once a real vehicle backs this identity (not the <see cref="None"/> sentinel).</summary>
    [JsonIgnore]
    public bool HasVehicle => Id > 0 || !string.IsNullOrWhiteSpace(Vin);

    /// <summary>
    /// Pick the identity from a <c>GET /vehicles</c> array, mirroring the web selection
    /// <c>vehicleId ? (vehicles.find(v =&gt; v.id === vehicleId) ?? vehicles[0]) : vehicles[0]</c>: prefer the
    /// entry whose <c>id</c> matches <paramref name="preferredId"/>, otherwise the first object entry. Returns
    /// <see langword="null"/> when the array carries no usable vehicle.
    /// </summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <param name="preferredId">An explicit vehicle id to prefer, or <see langword="null"/> for the first.</param>
    /// <returns>The resolved identity, or <see langword="null"/> when none is available.</returns>
    public static VehicleHeroVehicle? FromVehiclesArray(JsonElement root, long? preferredId)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        JsonElement? first = null;
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            first ??= element;
            if (preferredId is { } id && VehicleHeroJson.Long(element, "id") == id)
            {
                return FromObject(element);
            }
        }

        return first is { } fallback ? FromObject(fallback) : null;
    }

    private static VehicleHeroVehicle FromObject(JsonElement v) => new(
        Id: VehicleHeroJson.Long(v, "id") ?? 0,
        DisplayName: VehicleHeroJson.String(v, "display_name") ?? string.Empty,
        Vin: VehicleHeroJson.String(v, "vin") ?? string.Empty,
        Model: VehicleHeroJson.String(v, "model") ?? string.Empty,
        TrimBadging: VehicleHeroJson.String(v, "trim_badging") ?? string.Empty);
}

/// <summary>
/// The SI vehicle state the hero reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the
/// web <c>VehicleState</c> slice (web/src/features/dashboard/types.ts). Distances are metres
/// (<c>rated_range</c> / <c>ideal_range</c> / <c>odometer</c> / <c>charge_rate</c>), speed is m/s
/// (<c>speed</c>), temperatures °C (<c>inside_temp</c> / <c>outside_temp</c>), <c>time_to_full_charge</c> is
/// hours, and <c>power</c> / <c>charger_power</c> are kilowatts (the web shows them as kW without conversion).
/// Every dynamic field is nullable and stays null when the source did not report it, so the projection renders
/// an explicit em dash rather than a fabricated value. A <see langword="null"/> parse result models the web
/// <c>stateData?.state</c> being undefined (the vehicle is asleep).
/// </summary>
/// <param name="Status">The FSM state string (web <c>state.state</c>); empty falls back to <c>offline</c>.</param>
/// <param name="BatteryLevel">State-of-charge percent (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in metres (web <c>rated_range</c>).</param>
/// <param name="IdealRangeMeters">Ideal range in metres (web <c>ideal_range</c>).</param>
/// <param name="OdometerMeters">Odometer in metres (web <c>odometer</c>).</param>
/// <param name="SpeedMps">Speed in metres per second (web <c>speed</c>).</param>
/// <param name="PowerKw">Instantaneous power in kilowatts (web <c>power</c>).</param>
/// <param name="InsideTempCelsius">Cabin temperature in °C (web <c>inside_temp</c>).</param>
/// <param name="OutsideTempCelsius">Outside temperature in °C (web <c>outside_temp</c>).</param>
/// <param name="IsCharging">True while charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power in kilowatts (web <c>charger_power</c>).</param>
/// <param name="ChargeRateMeters">Range added per hour in metres (web <c>charge_rate</c>).</param>
/// <param name="TimeToFullChargeHours">Hours to a full charge (web <c>time_to_full_charge</c>).</param>
/// <param name="IsLocked">True when the vehicle is locked (web <c>is_locked</c>).</param>
/// <param name="SentryMode">True when Sentry mode is armed (web <c>sentry_mode</c>).</param>
/// <param name="SoftwareVersion">The installed firmware version (web <c>software_version</c>).</param>
public sealed record VehicleHeroTelemetry(
    string Status,
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? IdealRangeMeters,
    double? OdometerMeters,
    double? SpeedMps,
    double? PowerKw,
    double? InsideTempCelsius,
    double? OutsideTempCelsius,
    bool IsCharging,
    double? ChargerPowerKw,
    double? ChargeRateMeters,
    double? TimeToFullChargeHours,
    bool IsLocked,
    bool SentryMode,
    string? SoftwareVersion)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the hero slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c>
    /// is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging fields.
    /// Returns <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined (asleep).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed telemetry, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static VehicleHeroTelemetry? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state carrying a vehicle_id is the canonical SignalStore state object.
        if (VehicleHeroJson.Object(root, "state") is { } canonical && VehicleHeroJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = VehicleHeroJson.Object(root, "vehicle");
        var position = VehicleHeroJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object (no vehicle/position envelope) is still usable.
            return VehicleHeroJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot + the top-level charging flags. The
        // drive-only fields (speed/power/odometer/locks) only exist on the canonical state object, so they
        // remain null here and render an em dash.
        return new VehicleHeroTelemetry(
            Status: (vehicle is { } v ? VehicleHeroJson.String(v, "state") : null) ?? "offline",
            BatteryLevel: position is { } pb ? VehicleHeroJson.Double(pb, "battery_level") : null,
            RatedRangeMeters: position is { } pr ? VehicleHeroJson.Double(pr, "rated_range") : null,
            IdealRangeMeters: position is { } pi ? VehicleHeroJson.Double(pi, "ideal_range") : null,
            OdometerMeters: position is { } po ? VehicleHeroJson.Double(po, "odometer") : null,
            SpeedMps: position is { } ps ? VehicleHeroJson.Double(ps, "speed") : null,
            PowerKw: position is { } pp ? VehicleHeroJson.Double(pp, "power") : null,
            InsideTempCelsius: position is { } pin ? VehicleHeroJson.Double(pin, "inside_temp") : null,
            OutsideTempCelsius: position is { } pout ? VehicleHeroJson.Double(pout, "outside_temp") : null,
            IsCharging: VehicleHeroJson.Bool(root, "is_charging"),
            ChargerPowerKw: VehicleHeroJson.Double(root, "charger_power"),
            ChargeRateMeters: VehicleHeroJson.Double(root, "charge_rate"),
            TimeToFullChargeHours: VehicleHeroJson.Double(root, "time_to_full_charge"),
            IsLocked: position is { } pl && VehicleHeroJson.Bool(pl, "is_locked"),
            SentryMode: position is { } pse && VehicleHeroJson.Bool(pse, "sentry_mode"),
            SoftwareVersion: position is { } psv ? VehicleHeroJson.String(psv, "software_version") : null);
    }

    private static VehicleHeroTelemetry FromStateObject(JsonElement s) => new(
        Status: VehicleHeroJson.String(s, "state") ?? "offline",
        BatteryLevel: VehicleHeroJson.Double(s, "battery_level"),
        RatedRangeMeters: VehicleHeroJson.Double(s, "rated_range"),
        IdealRangeMeters: VehicleHeroJson.Double(s, "ideal_range"),
        OdometerMeters: VehicleHeroJson.Double(s, "odometer"),
        SpeedMps: VehicleHeroJson.Double(s, "speed"),
        PowerKw: VehicleHeroJson.Double(s, "power"),
        InsideTempCelsius: VehicleHeroJson.Double(s, "inside_temp"),
        OutsideTempCelsius: VehicleHeroJson.Double(s, "outside_temp"),
        IsCharging: VehicleHeroJson.Bool(s, "is_charging"),
        ChargerPowerKw: VehicleHeroJson.Double(s, "charger_power"),
        ChargeRateMeters: VehicleHeroJson.Double(s, "charge_rate"),
        TimeToFullChargeHours: VehicleHeroJson.Double(s, "time_to_full_charge"),
        IsLocked: VehicleHeroJson.Bool(s, "is_locked"),
        SentryMode: VehicleHeroJson.Bool(s, "sentry_mode"),
        SoftwareVersion: VehicleHeroJson.String(s, "software_version"));
}

/// <summary>
/// The resolved hero reading cached by the source: the always-present <see cref="Vehicle"/> identity plus the
/// (nullable) live <see cref="State"/>. A null <see cref="State"/> is the asleep vehicle (web
/// <c>stateData?.state ?? null</c>); a <see cref="None"/> vehicle is "no vehicle resolved" (web
/// <c>vehicle</c> falsy). Serialized to the cache as JSON so the cache-then-network read round-trips
/// losslessly.
/// </summary>
/// <param name="Vehicle">The resolved vehicle identity (or the <see cref="VehicleHeroVehicle.None"/> sentinel).</param>
/// <param name="State">The live telemetry, or <see langword="null"/> when the vehicle is asleep.</param>
public sealed record VehicleHeroData(VehicleHeroVehicle Vehicle, VehicleHeroTelemetry? State)
{
    /// <summary>The "no vehicle resolved" snapshot — the parse / loading fallback.</summary>
    public static VehicleHeroData Empty { get; } = new(VehicleHeroVehicle.None, null);

    /// <summary>True when a real vehicle backs the snapshot (drives the Loaded-vs-Empty classification).</summary>
    [JsonIgnore]
    public bool HasVehicle => Vehicle.HasVehicle;

    /// <summary>True when the resolved vehicle reported live state (web <c>state</c> present) — render the hero.</summary>
    [JsonIgnore]
    public bool IsAwake => State is not null;
}

/// <summary>
/// One projected, render-ready radial gauge — the native analogue of one web <c>&lt;RadialGauge&gt;</c>. Holds
/// the localized caption, the already-rounded value, the full-sweep maximum, the unit suffix, the categorical
/// accent and a Narrator name. Pure data — no WinUI types.
/// </summary>
/// <param name="Key">Stable gauge id (e.g. <c>battery</c>) used by the view and tests.</param>
/// <param name="Label">The localized caption (web <c>RadialGauge label</c>).</param>
/// <param name="Value">The rounded value the arc sweeps to (web <c>RadialGauge value</c>).</param>
/// <param name="Max">The value at a full sweep (web <c>RadialGauge max</c>).</param>
/// <param name="Unit">The unit suffix shown after the value (web <c>RadialGauge unit</c>).</param>
/// <param name="Accent">The categorical arc accent (web <c>RadialGauge color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the gauge.</param>
public sealed record VehicleHeroGauge(
    string Key,
    string Label,
    double Value,
    double Max,
    string Unit,
    VehicleHeroAccent Accent,
    string AutomationName);

/// <summary>
/// The projected charging panel shown while the vehicle is charging — the native analogue of the web
/// charging-details block (power, range-rate, time-to-full and the projected finish time). Every value is
/// pre-formatted. Pure data.
/// </summary>
/// <param name="Header">The localized "Charging" header (web <c>hero.charging</c>).</param>
/// <param name="PowerLabel">The localized power caption (web <c>hero.chargePower</c>).</param>
/// <param name="PowerText">The formatted charger power, e.g. <c>"11.0 kW"</c>.</param>
/// <param name="RateLabel">The localized rate caption (web <c>hero.chargeRate</c>).</param>
/// <param name="RateText">The formatted range-added rate, e.g. <c>"48 km/h"</c>.</param>
/// <param name="TimeToFullLabel">The localized time-to-full caption (web <c>hero.timeToFull</c>).</param>
/// <param name="TimeToFullText">The formatted hours-to-full, or an em dash.</param>
/// <param name="DoneAtText">The projected finish time line (web <c>Done ~h:mm</c>), or <see langword="null"/>.</param>
/// <param name="AutomationName">The composed Narrator name for the whole panel.</param>
public sealed record VehicleHeroCharging(
    string Header,
    string PowerLabel,
    string PowerText,
    string RateLabel,
    string RateText,
    string TimeToFullLabel,
    string TimeToFullText,
    string? DoneAtText,
    string AutomationName);

/// <summary>
/// One projected, render-ready context stat tile — the native analogue of one web <c>buildStatCards</c> entry
/// (an icon, a small label and a value). Pure data.
/// </summary>
/// <param name="Key">Stable tile id (e.g. <c>odometer</c>) used by the view and tests.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the tile icon (web lucide icon).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted tile value (already in display units), or an em dash.</param>
/// <param name="Accent">The categorical icon accent (web per-card colour).</param>
/// <param name="AutomationName">The composed Narrator name for the tile.</param>
public sealed record VehicleHeroStat(
    string Key,
    string Glyph,
    string Label,
    string Value,
    VehicleHeroAccent Accent,
    string AutomationName);

/// <summary>
/// One projected quick-action button — the native analogue of one web hero <c>&lt;Link&gt;&lt;Button&gt;</c>
/// (Details, Commands, Live Map, Digital Twin, Wake Up). Holds the localized label, the leading glyph and the
/// in-app route the host navigates to. Pure data.
/// </summary>
/// <param name="Key">Stable action id (e.g. <c>details</c>) used by the view and tests.</param>
/// <param name="Label">The localized button label.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon (or empty for none).</param>
/// <param name="Route">The in-app route the host navigates to on click (web <c>Link to</c>).</param>
/// <param name="AutomationName">The Narrator name for the button.</param>
public sealed record VehicleHeroAction(
    string Key,
    string Label,
    string Glyph,
    string Route,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the hero — everything the web component computes before returning
/// its JSX, split into the always-visible header (name / status / subtitle) and the awake content (gauges,
/// optional charging panel, the context stat grid and the four quick-action buttons) versus the asleep content
/// (the wake message + button). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Name">The header vehicle name (web <c>display_name || vin</c>).</param>
/// <param name="Subtitle">The header model/trim/VIN subtitle.</param>
/// <param name="Status">The raw FSM status string fed to the status badge (web <c>state?.state ?? 'offline'</c>).</param>
/// <param name="StatusText">The capitalized status used in spoken names.</param>
/// <param name="StatusAccentKey">The design-token brush key for the status dot.</param>
/// <param name="IsAwake">True when live state is present — render the gauges/stats; false renders the asleep panel.</param>
/// <param name="Gauges">The context-aware radial gauges, in web order (empty when asleep).</param>
/// <param name="IsCharging">True when the charging panel is shown.</param>
/// <param name="Charging">The charging panel, or <see langword="null"/> when not charging.</param>
/// <param name="Stats">The eight context-aware stat tiles (empty when asleep).</param>
/// <param name="Actions">The four awake quick-action buttons (empty when asleep).</param>
/// <param name="AsleepMessage">The localized "asleep" message shown when not awake.</param>
/// <param name="WakeAction">The "Wake Up" action shown when asleep.</param>
/// <param name="AutomationName">The composed Narrator name for the whole surface.</param>
public sealed record VehicleHeroDisplay(
    string Name,
    string Subtitle,
    string Status,
    string StatusText,
    string StatusAccentKey,
    bool IsAwake,
    IReadOnlyList<VehicleHeroGauge> Gauges,
    bool IsCharging,
    VehicleHeroCharging? Charging,
    IReadOnlyList<VehicleHeroStat> Stats,
    IReadOnlyList<VehicleHeroAction> Actions,
    string AsleepMessage,
    VehicleHeroAction WakeAction,
    string AutomationName)
{
    /// <summary>The empty/initial display used for the loading and no-vehicle fallback (no vehicle, no state).</summary>
    public static VehicleHeroDisplay Empty(ILocalizer localizer, DateTimeOffset now) =>
        VehicleHeroProjection.Project(VehicleHeroData.Empty, UnitPref.Metric, now, localizer);
}

/// <summary>
/// Pure projection from a raw <see cref="VehicleHeroData"/> to its render-ready
/// <see cref="VehicleHeroDisplay"/> — the native port of the render logic + <c>buildStatCards</c> heuristic in
/// web/src/features/dashboard/components/VehicleHero.tsx. SI is converted to the user's display unit at this
/// boundary (and only here); the kilowatt power fields are shown as-is exactly as the web does. Every
/// translatable label resolves through the i18n facade using the same keys the web source passes to
/// <c>t()</c> (plus keys for the few labels the web hard-codes in <c>buildStatCards</c>, so no English literal
/// survives in native code). WinUI-free — unit-tested without a UI host.
/// </summary>
public static class VehicleHeroProjection
{
    /// <summary>Em dash rendered for any unreported metric (web <c>—</c>).</summary>
    public const string Dash = "\u2014";

    /// <summary>The kilowatt unit suffix the web hard-codes onto the power figures.</summary>
    public const string KilowattUnit = "kW";

    /// <summary>Above this state-of-charge the battery gauge reads healthy (web <c>battery_level &gt; 50</c>).</summary>
    public const double HealthyBatteryPercent = 50;

    /// <summary>Decimal places for the kilowatt power readouts (web global precision; the native hero convention).</summary>
    public const int PowerDecimals = 1;

    // Segoe Fluent glyphs (the native analogue of the web lucide icons).
    private const string GaugeGlyph = "\uE9D9";        // Speedometer (web Gauge)
    private const string ZapGlyph = "\uE945";          // LightningBolt (web Zap)
    private const string NavigationGlyph = "\uE707";   // Location (web Navigation / MapPin)
    private const string ActivityGlyph = "\uE9D2";     // Activity line (web Activity)
    private const string ClockGlyph = "\uE823";        // Recent (web Clock)
    private const string ThermometerGlyph = "\uE9CA";  // Temperature (web Thermometer)
    private const string LockGlyph = "\uE72E";         // Lock (web Lock)
    private const string UnlockGlyph = "\uE785";       // Unlock (web Unlock)
    private const string ShieldGlyph = "\uEA18";       // Shield (web Shield)
    private const string FirmwareGlyph = "\uE950";     // Gauge (web Gauge — firmware tile)
    private const string EyeGlyph = "\uE7B3";          // RedEye (web Eye — Details)
    private const string MonitorGlyph = "\uE7F4";      // TVMonitor (web Monitor — Digital Twin)

    private const string CommandsRoute = "/commands";
    private const string LiveRoute = "/live";
    private const string DigitalTwinRoute = "/digital-twin";

    private const double SpeedGaugeMax = 250;
    private const double RangeGaugeMax = 600;
    private const double PowerGaugeMax = 250;
    private const double BatteryGaugeMax = 100;
    private const double FahrenheitGaugeMax = 122;
    private const double CelsiusGaugeMax = 50;

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/> and the clock <paramref name="now"/>.</summary>
    /// <param name="data">The resolved hero snapshot (vehicle identity + optional live state).</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="now">The current instant, used for the charging "done at" projection (web <c>Date.now()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static VehicleHeroDisplay Project(
        VehicleHeroData data,
        UnitPref units,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicle = data.Vehicle;
        var state = data.State;

        // Web parity: state?.state ?? 'offline'.
        string status = string.IsNullOrWhiteSpace(state?.Status) ? "offline" : state!.Status.Trim();
        string name = vehicle.Name;
        string subtitle = vehicle.Subtitle;
        string statusText = Capitalize(status);
        string statusAccentKey = StatusAccentKey(status);
        string asleepMessage = localizer.GetString("hero.asleep", "Vehicle asleep \u2014 wake to see live data");
        var wake = Action("wake", localizer.GetString("hero.wakeUp", "Wake Up"), string.Empty, CommandsRoute);

        if (state is null)
        {
            // Web parity: the asleep branch renders only the header + the wake panel.
            return new VehicleHeroDisplay(
                Name: name,
                Subtitle: subtitle,
                Status: status,
                StatusText: statusText,
                StatusAccentKey: statusAccentKey,
                IsAwake: false,
                Gauges: Array.Empty<VehicleHeroGauge>(),
                IsCharging: false,
                Charging: null,
                Stats: Array.Empty<VehicleHeroStat>(),
                Actions: Array.Empty<VehicleHeroAction>(),
                AsleepMessage: asleepMessage,
                WakeAction: wake,
                AutomationName: SurfaceName(name, statusText, subtitle, null));
        }

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);
        string tempUnit = UnitLabels.Label(units.Temperature);
        double tempMax = units.Temperature == TemperatureUnit.Fahrenheit ? FahrenheitGaugeMax : CelsiusGaugeMax;

        // Web parity: isDriving = state.state === 'driving' || state.speed > 0.
        bool isDriving = string.Equals(status, "driving", StringComparison.OrdinalIgnoreCase) || (state.SpeedMps ?? 0) > 0;
        bool isCharging = state.IsCharging;
        string firmware = string.IsNullOrWhiteSpace(state.SoftwareVersion) ? Dash : state.SoftwareVersion!.Trim();

        var gauges = BuildGauges(state, units, distanceUnit, speedUnit, tempUnit, tempMax, isDriving, isCharging, localizer);
        var charging = isCharging ? BuildCharging(state, units, distanceUnit, now, localizer) : null;
        var stats = BuildStats(state, units, distanceUnit, speedUnit, tempUnit, isDriving, isCharging, firmware, localizer);
        var actions = BuildActions(vehicle, localizer);

        return new VehicleHeroDisplay(
            Name: name,
            Subtitle: subtitle,
            Status: status,
            StatusText: statusText,
            StatusAccentKey: statusAccentKey,
            IsAwake: true,
            Gauges: gauges,
            IsCharging: isCharging,
            Charging: charging,
            Stats: stats,
            Actions: actions,
            AsleepMessage: asleepMessage,
            WakeAction: wake,
            AutomationName: SurfaceName(name, statusText, subtitle, gauges.Count > 0 ? gauges[0] : null));
    }

    /// <summary>
    /// The design-token brush key for the status-badge dot, mirroring the web <c>StatusBadge</c> badge-dot
    /// palette (online green, driving/parked/updating info, charging amber, asleep purple, offline red,
    /// otherwise neutral) mapped to the nearest themed token so light / dark / high-contrast all stay legible.
    /// </summary>
    /// <param name="status">The raw FSM status string.</param>
    /// <returns>The design-token brush key for the dot.</returns>
    public static string StatusAccentKey(string? status) => Normalize(status) switch
    {
        "online" => StatusResources.AccentBrushKey(StatusKind.Success),
        "driving" => StatusResources.AccentBrushKey(StatusKind.Info),
        "charging" => StatusResources.AccentBrushKey(StatusKind.Warning),
        "parked" => StatusResources.AccentBrushKey(StatusKind.Info),
        "updating" => StatusResources.AccentBrushKey(StatusKind.Info),
        "asleep" => "TsChart07Brush",
        "offline" => StatusResources.AccentBrushKey(StatusKind.Danger),
        _ => StatusResources.AccentBrushKey(StatusKind.Neutral),
    };

    private static List<VehicleHeroGauge> BuildGauges(
        VehicleHeroTelemetry state,
        UnitPref units,
        string distanceUnit,
        string speedUnit,
        string tempUnit,
        double tempMax,
        bool isDriving,
        bool isCharging,
        ILocalizer localizer)
    {
        var gauges = new List<VehicleHeroGauge>(6);

        double battery = state.BatteryLevel ?? 0;
        gauges.Add(Gauge(
            "battery",
            localizer.GetString("hero.battery", "Battery"),
            JsRound(battery),
            BatteryGaugeMax,
            "%",
            battery > HealthyBatteryPercent ? VehicleHeroAccent.Green : VehicleHeroAccent.Amber));

        gauges.Add(Gauge(
            "range",
            localizer.GetString("hero.range", "Range"),
            JsRound(UnitConverters.DistanceFromSi(state.RatedRangeMeters ?? 0, units.Distance)),
            RangeGaugeMax,
            distanceUnit,
            VehicleHeroAccent.Cyan));

        if (isDriving)
        {
            gauges.Add(Gauge(
                "speed",
                localizer.GetString("hero.speed", "Speed"),
                JsRound(UnitConverters.SpeedFromSi(state.SpeedMps ?? 0, units.Speed)),
                SpeedGaugeMax,
                speedUnit,
                VehicleHeroAccent.Purple));
        }

        if (isCharging)
        {
            gauges.Add(Gauge(
                "power",
                localizer.GetString("hero.power", "Power"),
                JsRound(state.ChargerPowerKw ?? 0),
                PowerGaugeMax,
                KilowattUnit,
                VehicleHeroAccent.Green));
        }

        gauges.Add(Gauge(
            "inside",
            localizer.GetString("hero.inside", "Inside"),
            JsRound(UnitConverters.TemperatureFromSi(state.InsideTempCelsius ?? 0, units.Temperature)),
            tempMax,
            tempUnit,
            VehicleHeroAccent.Orange));

        gauges.Add(Gauge(
            "outside",
            localizer.GetString("hero.outside", "Outside"),
            JsRound(UnitConverters.TemperatureFromSi(state.OutsideTempCelsius ?? 0, units.Temperature)),
            tempMax,
            tempUnit,
            VehicleHeroAccent.Blue));

        return gauges;
    }

    private static VehicleHeroCharging BuildCharging(
        VehicleHeroTelemetry state,
        UnitPref units,
        string distanceUnit,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        double ttf = state.TimeToFullChargeHours ?? 0;
        string header = localizer.GetString("hero.charging", "Charging");
        string powerLabel = localizer.GetString("hero.chargePower", "Power");
        string powerText = $"{ScalarFormatters.FormatNumber(state.ChargerPowerKw ?? 0, PowerDecimals)} {KilowattUnit}";
        string rateLabel = localizer.GetString("hero.chargeRate", "Rate");
        string rateText = $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(state.ChargeRateMeters ?? 0, units.Distance), 0)} {distanceUnit}/h";
        string timeToFullLabel = localizer.GetString("hero.timeToFull", "Time to Full");
        string timeToFullText = ttf > 0 ? $"{ScalarFormatters.FormatNumber(ttf, 1)}h" : Dash;
        string? doneAtText = ttf > 0
            ? $"{localizer.GetString("hero.doneAt", "Done")} ~{DateTimeFormatting.Format(now.AddHours(ttf), DateTimeVariant.Time, now)}"
            : null;

        string auto = string.Format(
            CultureInfo.CurrentCulture,
            "{0}. {1} {2}. {3} {4}. {5} {6}",
            header,
            powerLabel,
            powerText,
            rateLabel,
            rateText,
            timeToFullLabel,
            timeToFullText);

        return new VehicleHeroCharging(
            header,
            powerLabel,
            powerText,
            rateLabel,
            rateText,
            timeToFullLabel,
            timeToFullText,
            doneAtText,
            auto);
    }

    private static List<VehicleHeroStat> BuildStats(
        VehicleHeroTelemetry state,
        UnitPref units,
        string distanceUnit,
        string speedUnit,
        string tempUnit,
        bool isDriving,
        bool isCharging,
        string firmware,
        ILocalizer localizer)
    {
        var stats = new List<VehicleHeroStat>(8);

        string PowerValue() => $"{ScalarFormatters.FormatNumber(state.PowerKw ?? 0, PowerDecimals)} {KilowattUnit}";
        VehicleHeroAccent powerAccent = PowerAccent(state.PowerKw);
        string Distance(double? meters) =>
            $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(meters ?? 0, units.Distance), 0)} {distanceUnit}";
        string idealLabel = localizer.GetString("hero.idealRange", "Ideal Range");
        string odometerLabel = localizer.GetString("hero.odometer", "Odometer");

        if (isDriving)
        {
            stats.Add(Stat(
                "speed",
                GaugeGlyph,
                localizer.GetString("hero.speed", "Speed"),
                $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(state.SpeedMps ?? 0, units.Speed), 0)} {speedUnit}",
                VehicleHeroAccent.Purple));
            stats.Add(Stat("power", ZapGlyph, localizer.GetString("hero.power", "Power"), PowerValue(), powerAccent));
            stats.Add(Stat("odometer", NavigationGlyph, odometerLabel, Distance(state.OdometerMeters), VehicleHeroAccent.Purple));
            stats.Add(Stat("ideal-range", ActivityGlyph, idealLabel, Distance(state.IdealRangeMeters), VehicleHeroAccent.Cyan));
        }
        else if (isCharging)
        {
            stats.Add(Stat(
                "charge-rate",
                ZapGlyph,
                localizer.GetString("hero.statChargeRate", "Charge Rate"),
                $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(state.ChargeRateMeters ?? 0, units.Distance), 0)} {distanceUnit}/h",
                VehicleHeroAccent.Green));
            stats.Add(Stat(
                "time-to-full",
                ClockGlyph,
                localizer.GetString("hero.timeToFull", "Time to Full"),
                (state.TimeToFullChargeHours ?? 0) > 0 ? $"{ScalarFormatters.FormatNumber(state.TimeToFullChargeHours!.Value, 1)}h" : Dash,
                VehicleHeroAccent.Amber));
            stats.Add(Stat("ideal-range", ActivityGlyph, idealLabel, Distance(state.IdealRangeMeters), VehicleHeroAccent.Cyan));
            stats.Add(Stat("odometer", NavigationGlyph, odometerLabel, Distance(state.OdometerMeters), VehicleHeroAccent.Purple));
        }
        else
        {
            stats.Add(Stat(
                "inside",
                ThermometerGlyph,
                localizer.GetString("hero.inside", "Inside"),
                state.InsideTempCelsius is { } inside
                    ? $"{ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(inside, units.Temperature), 1)}{tempUnit}"
                    : Dash,
                VehicleHeroAccent.Orange));
            stats.Add(Stat(
                "outside",
                ThermometerGlyph,
                localizer.GetString("hero.outside", "Outside"),
                state.OutsideTempCelsius is { } outside
                    ? $"{ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(outside, units.Temperature), 1)}{tempUnit}"
                    : Dash,
                VehicleHeroAccent.Blue));
            stats.Add(Stat("odometer", NavigationGlyph, odometerLabel, Distance(state.OdometerMeters), VehicleHeroAccent.Purple));
            stats.Add(Stat("ideal-range", ActivityGlyph, idealLabel, Distance(state.IdealRangeMeters), VehicleHeroAccent.Cyan));
        }

        // Always-visible tiles (web parity: status, sentry, firmware, power).
        stats.Add(Stat(
            "status",
            state.IsLocked ? LockGlyph : UnlockGlyph,
            localizer.GetString("common.status", "Status"),
            state.IsLocked ? localizer.GetString("common.locked", "Locked") : localizer.GetString("common.unlocked", "Unlocked"),
            state.IsLocked ? VehicleHeroAccent.Green : VehicleHeroAccent.Amber));
        stats.Add(Stat(
            "sentry",
            ShieldGlyph,
            localizer.GetString("common.sentry", "Sentry"),
            state.SentryMode ? localizer.GetString("common.active", "Active") : localizer.GetString("common.off", "Off"),
            state.SentryMode ? VehicleHeroAccent.Red : VehicleHeroAccent.Neutral));
        stats.Add(Stat("firmware", FirmwareGlyph, localizer.GetString("hero.firmware", "Firmware"), firmware, VehicleHeroAccent.Indigo));
        stats.Add(Stat("power-summary", ZapGlyph, localizer.GetString("hero.power", "Power"), PowerValue(), powerAccent));

        return stats;
    }

    private static IReadOnlyList<VehicleHeroAction> BuildActions(VehicleHeroVehicle vehicle, ILocalizer localizer) =>
    [
        Action(
            "details",
            localizer.GetString("hero.details", "Details"),
            EyeGlyph,
            string.Create(CultureInfo.InvariantCulture, $"/vehicles/{vehicle.Id}")),
        Action("commands", localizer.GetString("hero.commands", "Commands"), ZapGlyph, CommandsRoute),
        Action("live-map", localizer.GetString("hero.liveMap", "Live Map"), NavigationGlyph, LiveRoute),
        Action("digital-twin", localizer.GetString("hero.digitalTwin", "Digital Twin"), MonitorGlyph, DigitalTwinRoute),
    ];

    private static VehicleHeroGauge Gauge(string key, string label, double value, double max, string unit, VehicleHeroAccent accent) =>
        new(key, label, value, max, unit, accent, ComposeGaugeName(label, value, unit));

    private static VehicleHeroStat Stat(string key, string glyph, string label, string value, VehicleHeroAccent accent) =>
        new(key, glyph, label, value, accent, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static VehicleHeroAction Action(string key, string label, string glyph, string route) =>
        new(key, label, glyph, route, label);

    private static VehicleHeroAccent PowerAccent(double? powerKw)
    {
        double power = powerKw ?? 0;
        if (power > 0)
        {
            return VehicleHeroAccent.Amber;
        }

        return power < 0 ? VehicleHeroAccent.Green : VehicleHeroAccent.Neutral;
    }

    private static string ComposeGaugeName(string label, double value, string unit)
    {
        string valueText = ScalarFormatters.FormatNumber(value, 0);
        return string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, valueText)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, valueText, unit);
    }

    private static string SurfaceName(string name, string statusText, string subtitle, VehicleHeroGauge? battery)
    {
        var parts = new List<string> { name, statusText };
        if (!string.IsNullOrWhiteSpace(subtitle))
        {
            parts.Add(subtitle);
        }

        if (battery is { } b)
        {
            parts.Add(b.AutomationName);
        }

        return string.Join(", ", parts.Where(static p => !string.IsNullOrWhiteSpace(p)));
    }

    // Web Math.round semantics (floor(x + 0.5)) so the gauge values match the web exactly, including negatives.
    private static double JsRound(double value) => Math.Floor(value + 0.5);

    private static string Normalize(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant();

    private static string Capitalize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(value[0]) + value[1..];
    }
}

/// <summary>
/// Canonical metadata for the Vehicle Hero surface — the native mirror of the web component at
/// web/src/features/dashboard/components/VehicleHero.tsx. The surface aggregates the same vehicle roster and
/// per-vehicle live state the dashboard feeds the web hero.
/// </summary>
public static class VehicleHeroRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "vehicle-hero";

    /// <summary>Surface category.</summary>
    public const string Category = "dashboard";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleHero";

    /// <summary>Localized surface name (web dashboard vehicle hero).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized surface name.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("hero.surfaceName", "Vehicle overview");
    }
}

/// <summary>
/// PII-safe diagnostics for the Vehicle Hero surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, name, location or telemetry
/// value — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class VehicleHeroDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public VehicleHeroDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleHero</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleHeroRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> field readers shared by the hero parse adapters. File-local so the
/// helper never leaks into the namespace.
/// </summary>
file static class VehicleHeroJson
{
    public static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static bool Bool(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.True;
}
