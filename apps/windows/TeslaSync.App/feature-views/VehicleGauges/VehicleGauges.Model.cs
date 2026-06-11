using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="VehicleGaugesViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/vehicles/components/VehicleGauges.tsx) is a pure presentational child that always
/// receives a resolved <c>vehicle</c> + live <c>state</c> from its parent page; the native feature view
/// binds that same data through a shared cache-then-network state holder, so it reproduces every one of
/// those branches as a visible surface — none is ever hidden. <see cref="Empty"/> mirrors the parent gate
/// where no vehicle resolves or the vehicle reports no live state (asleep): without live telemetry the
/// gauges have nothing to read, so a friendly empty surface is shown rather than a blank panel.
/// </summary>
public enum VehicleGaugesState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton gauges.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with live state — render the gauges, metrics and chips.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no vehicle or no live state — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The canonical Tesla model key parsed from a free-text <c>vehicle.model</c> string — the native port of
/// the web <c>parseModelKey</c> in web/src/components/data-display/TeslaCarViz.tsx. The native vehicle
/// visualization (<c>TsVehicleTwin</c>) renders one tokenized side-view schematic for every model, so the
/// key is surfaced in the visualization's accessible name rather than switching the silhouette geometry,
/// keeping the parsed model concept faithful to the web while mapping to the available native component.
/// </summary>
public enum TeslaModelKey
{
    /// <summary>Model 3 — the web default when the string is empty or unrecognised.</summary>
    Model3,

    /// <summary>Model S.</summary>
    ModelS,

    /// <summary>Model Y.</summary>
    ModelY,

    /// <summary>Model X.</summary>
    ModelX,

    /// <summary>Cybertruck.</summary>
    Cybertruck,
}

/// <summary>
/// The vehicle identity the gauges surface reads — the native mirror of the web <c>Vehicle</c> slice the
/// parent page passes to <c>&lt;VehicleGauges vehicle=… /&gt;</c> (web <c>id</c>, <c>display_name</c>,
/// <c>vin</c>, <c>model</c>, <c>exterior_color</c>). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Id">The vehicle's database id (web <c>id</c>) used to scope the live-state read.</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle identification number (web <c>vin</c>).</param>
/// <param name="Model">The free-text model string (web <c>model</c>), parsed into <see cref="ModelKey"/>.</param>
/// <param name="ExteriorColor">The Tesla exterior colour code (web <c>exterior_color</c>) driving the twin paint.</param>
public sealed record VehicleGaugesVehicle(
    long Id,
    string DisplayName,
    string Vin,
    string Model,
    string ExteriorColor)
{
    /// <summary>The sentinel "no vehicle resolved" identity (the parse / empty fallback).</summary>
    public static VehicleGaugesVehicle None { get; } = new(0, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Display name — web <c>vehicle.display_name || vehicle.vin</c>.</summary>
    [JsonIgnore]
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>The canonical model key parsed from <see cref="Model"/> (web <c>parseModelKey</c>).</summary>
    [JsonIgnore]
    public TeslaModelKey ModelKey => ParseModelKey(Model);

    /// <summary>True once a real vehicle backs this identity (not the <see cref="None"/> sentinel).</summary>
    [JsonIgnore]
    public bool HasVehicle => Id > 0 || !string.IsNullOrWhiteSpace(Vin);

    /// <summary>
    /// Parse a free-text model string ("Model 3 P", "Model Y", "Cybertruck") into a <see cref="TeslaModelKey"/>,
    /// a 1:1 port of the web <c>parseModelKey</c>: lower-case, strip whitespace, then ordered substring tests
    /// (cybertruck / ct, modelx / mx, modely / my, models / ms), defaulting to <see cref="TeslaModelKey.Model3"/>.
    /// </summary>
    /// <param name="model">The raw model string, or <see langword="null"/>.</param>
    /// <returns>The matched model key, or <see cref="TeslaModelKey.Model3"/> when empty/unrecognised.</returns>
    public static TeslaModelKey ParseModelKey(string? model)
    {
        if (string.IsNullOrWhiteSpace(model))
        {
            return TeslaModelKey.Model3;
        }

        string s = new string(model.Where(static c => !char.IsWhiteSpace(c)).ToArray()).ToLowerInvariant();
        if (s.Contains("cybertruck", StringComparison.Ordinal) || s.Contains("ct", StringComparison.Ordinal))
        {
            return TeslaModelKey.Cybertruck;
        }

        if (s.Contains("modelx", StringComparison.Ordinal) || s.Contains("mx", StringComparison.Ordinal))
        {
            return TeslaModelKey.ModelX;
        }

        if (s.Contains("modely", StringComparison.Ordinal) || s.Contains("my", StringComparison.Ordinal))
        {
            return TeslaModelKey.ModelY;
        }

        if (s.Contains("models", StringComparison.Ordinal) || s.Contains("ms", StringComparison.Ordinal))
        {
            return TeslaModelKey.ModelS;
        }

        return TeslaModelKey.Model3;
    }

    /// <summary>
    /// Pick the identity from a <c>GET /vehicles</c> array, mirroring the parent page's selection
    /// <c>vehicleId ? (vehicles.find(v =&gt; v.id === vehicleId) ?? vehicles[0]) : vehicles[0]</c>: prefer the
    /// entry whose <c>id</c> matches <paramref name="preferredId"/>, otherwise the first object entry. Returns
    /// <see langword="null"/> when the array carries no usable vehicle.
    /// </summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <param name="preferredId">An explicit vehicle id to prefer, or <see langword="null"/> for the first.</param>
    /// <returns>The resolved identity, or <see langword="null"/> when none is available.</returns>
    public static VehicleGaugesVehicle? FromVehiclesArray(JsonElement root, long? preferredId)
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
            if (preferredId is { } id && VehicleGaugesJson.Long(element, "id") == id)
            {
                return FromObject(element);
            }
        }

        return first is { } fallback ? FromObject(fallback) : null;
    }

    private static VehicleGaugesVehicle FromObject(JsonElement v) => new(
        Id: VehicleGaugesJson.Long(v, "id") ?? 0,
        DisplayName: VehicleGaugesJson.String(v, "display_name") ?? string.Empty,
        Vin: VehicleGaugesJson.String(v, "vin") ?? string.Empty,
        Model: VehicleGaugesJson.String(v, "model") ?? string.Empty,
        ExteriorColor: VehicleGaugesJson.String(v, "exterior_color") ?? string.Empty);
}

/// <summary>
/// The SI vehicle state the gauges read from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice. Distances are metres (<c>rated_range</c> / <c>charge_rate</c>), speed
/// is m/s (<c>speed</c>), and <c>charger_power</c> is kilowatts (the web power gauge shows kW without
/// conversion). Every dynamic field is nullable and stays null when the source did not report it, so the
/// projection floors it to zero exactly as the web's <c>?? 0</c> / direct reads do. A <see langword="null"/>
/// parse result models the web parent's <c>state</c> being absent (the vehicle is asleep).
/// </summary>
/// <param name="Status">The FSM state string (web <c>state.state</c>); empty falls back to <c>offline</c>.</param>
/// <param name="BatteryLevel">State-of-charge percent (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in metres (web <c>rated_range</c>).</param>
/// <param name="SpeedMps">Speed in metres per second (web <c>speed</c>).</param>
/// <param name="ChargerPowerKw">Charger power in kilowatts (web <c>charger_power</c>).</param>
/// <param name="ChargeRateMeters">Range added per hour in metres (web <c>charge_rate</c>).</param>
/// <param name="IsCharging">True while charging (web <c>is_charging</c>).</param>
/// <param name="IsClimateOn">True when climate control is on (web <c>is_climate_on</c>).</param>
/// <param name="IsLocked">True when the vehicle is locked (web <c>is_locked</c>).</param>
/// <param name="SentryMode">True when Sentry mode is armed (web <c>sentry_mode</c>).</param>
/// <param name="SoftwareVersion">The installed firmware version (web <c>software_version</c>).</param>
public sealed record VehicleGaugesTelemetry(
    string Status,
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? SpeedMps,
    double? ChargerPowerKw,
    double? ChargeRateMeters,
    bool IsCharging,
    bool IsClimateOn,
    bool IsLocked,
    bool SentryMode,
    string? SoftwareVersion)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the gauges slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c>
    /// envelope is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging
    /// fields. Returns <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined (asleep).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed telemetry, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static VehicleGaugesTelemetry? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state carrying a vehicle_id is the canonical SignalStore state object.
        if (VehicleGaugesJson.Object(root, "state") is { } canonical && VehicleGaugesJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = VehicleGaugesJson.Object(root, "vehicle");
        var position = VehicleGaugesJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object (no vehicle/position envelope) is still usable.
            return VehicleGaugesJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot + the top-level charging flags. The
        // drive-only fields (speed/locks) only exist on the canonical state object, so they remain null here
        // and the projection floors them to zero.
        return new VehicleGaugesTelemetry(
            Status: (vehicle is { } v ? VehicleGaugesJson.String(v, "state") : null) ?? "offline",
            BatteryLevel: position is { } pb ? VehicleGaugesJson.Double(pb, "battery_level") : null,
            RatedRangeMeters: position is { } pr ? VehicleGaugesJson.Double(pr, "rated_range") : null,
            SpeedMps: position is { } ps ? VehicleGaugesJson.Double(ps, "speed") : null,
            ChargerPowerKw: VehicleGaugesJson.Double(root, "charger_power"),
            ChargeRateMeters: VehicleGaugesJson.Double(root, "charge_rate"),
            IsCharging: VehicleGaugesJson.Bool(root, "is_charging"),
            IsClimateOn: VehicleGaugesJson.Bool(root, "is_climate_on"),
            IsLocked: position is { } pl && VehicleGaugesJson.Bool(pl, "is_locked"),
            SentryMode: position is { } pse && VehicleGaugesJson.Bool(pse, "sentry_mode"),
            SoftwareVersion: position is { } psv ? VehicleGaugesJson.String(psv, "software_version") : null);
    }

    private static VehicleGaugesTelemetry FromStateObject(JsonElement s) => new(
        Status: VehicleGaugesJson.String(s, "state") ?? "offline",
        BatteryLevel: VehicleGaugesJson.Double(s, "battery_level"),
        RatedRangeMeters: VehicleGaugesJson.Double(s, "rated_range"),
        SpeedMps: VehicleGaugesJson.Double(s, "speed"),
        ChargerPowerKw: VehicleGaugesJson.Double(s, "charger_power"),
        ChargeRateMeters: VehicleGaugesJson.Double(s, "charge_rate"),
        IsCharging: VehicleGaugesJson.Bool(s, "is_charging"),
        IsClimateOn: VehicleGaugesJson.Bool(s, "is_climate_on"),
        IsLocked: VehicleGaugesJson.Bool(s, "is_locked"),
        SentryMode: VehicleGaugesJson.Bool(s, "sentry_mode"),
        SoftwareVersion: VehicleGaugesJson.String(s, "software_version"));
}

/// <summary>
/// The resolved gauges reading cached by the source: the always-present <see cref="Vehicle"/> identity plus
/// the (nullable) live <see cref="State"/>. A null <see cref="State"/> is the asleep vehicle (web parent
/// <c>state</c> absent); a <see cref="VehicleGaugesVehicle.None"/> vehicle is "no vehicle resolved".
/// Serialized to the cache as JSON so the cache-then-network read round-trips losslessly.
/// </summary>
/// <param name="Vehicle">The resolved vehicle identity (or the <see cref="VehicleGaugesVehicle.None"/> sentinel).</param>
/// <param name="State">The live telemetry, or <see langword="null"/> when the vehicle is asleep.</param>
public sealed record VehicleGaugesData(VehicleGaugesVehicle Vehicle, VehicleGaugesTelemetry? State)
{
    /// <summary>The "no vehicle resolved" snapshot — the parse / loading fallback.</summary>
    public static VehicleGaugesData Empty { get; } = new(VehicleGaugesVehicle.None, null);

    /// <summary>True when a real vehicle backs the snapshot.</summary>
    [JsonIgnore]
    public bool HasVehicle => Vehicle.HasVehicle;

    /// <summary>True when the resolved vehicle reported live state (web parent <c>state</c> present).</summary>
    [JsonIgnore]
    public bool HasState => State is not null;

    /// <summary>True when there is something to render — a vehicle with live telemetry.</summary>
    [JsonIgnore]
    public bool HasData => HasVehicle && HasState;
}

/// <summary>
/// One projected, render-ready radial gauge — the native analogue of one web <c>&lt;RadialGauge&gt;</c>.
/// Holds the localized caption, the rounded value the arc sweeps to, the full-sweep maximum, the unit
/// suffix, the resolved design-token brush key for the arc, and a Narrator name. Pure data — no WinUI types,
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Key">Stable gauge id (e.g. <c>battery</c>) used by the view and tests.</param>
/// <param name="Label">The localized caption (web <c>RadialGauge label</c>).</param>
/// <param name="Value">The value the arc sweeps to (web <c>RadialGauge value</c>).</param>
/// <param name="Max">The value at a full sweep (web <c>RadialGauge max</c>).</param>
/// <param name="Unit">The unit suffix shown after the value (web <c>RadialGauge unit</c>).</param>
/// <param name="BrushKey">The design-token brush key the arc is tinted with (web <c>RadialGauge color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the gauge.</param>
public sealed record VehicleGaugesGauge(
    string Key,
    string Label,
    double Value,
    double Max,
    string Unit,
    string BrushKey,
    string AutomationName);

/// <summary>
/// One projected, render-ready metric bar — the native analogue of one web <c>&lt;MetricBar&gt;</c>. Holds
/// the localized label, the value and full-bar maximum (a pure ratio drives the fill), the resolved
/// design-token brush key, the pre-formatted right-aligned value text (web <c>sublabel</c>) and a Narrator
/// name. Pure data — no WinUI types.
/// </summary>
/// <param name="Key">Stable bar id (e.g. <c>battery-level</c>) used by the view and tests.</param>
/// <param name="Label">The localized label (web <c>MetricBar label</c>).</param>
/// <param name="Value">The current value (web <c>MetricBar value</c>).</param>
/// <param name="Max">The full-bar value (web <c>MetricBar max</c>).</param>
/// <param name="BrushKey">The design-token brush key the fill is tinted with (web <c>MetricBar color</c>).</param>
/// <param name="ValueText">The pre-formatted right-aligned value text (web <c>MetricBar sublabel</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the bar.</param>
public sealed record VehicleGaugesMetric(
    string Key,
    string Label,
    double Value,
    double Max,
    string BrushKey,
    string ValueText,
    string AutomationName);

/// <summary>
/// One projected, render-ready quick-info chip — the native analogue of one web status chip (the
/// <c>chips.map(...)</c> row). Holds the Segoe Fluent glyph, the localized label, the resolved
/// design-token brush key for the icon, and a Narrator name. Pure data — no WinUI types.
/// </summary>
/// <param name="Key">Stable chip id (e.g. <c>lock</c>) used by the view and tests.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the chip icon (web lucide icon).</param>
/// <param name="Label">The localized chip label (web <c>chip.label</c>).</param>
/// <param name="BrushKey">The design-token brush key the icon is tinted with (web <c>chip.color</c>).</param>
/// <param name="AutomationName">The Narrator name for the chip.</param>
public sealed record VehicleGaugesChip(
    string Key,
    string Glyph,
    string Label,
    string BrushKey,
    string AutomationName);

/// <summary>
/// The projected state of the vehicle visualization — the native analogue of the web <c>&lt;TeslaCarViz&gt;</c>
/// props. The native <c>TsVehicleTwin</c> binds these to a tokenized side-view schematic. Pure data — no WinUI
/// types.
/// </summary>
/// <param name="Locked">Locked state (web <c>isLocked</c>).</param>
/// <param name="SentryMode">Sentry armed (web <c>sentryMode</c>).</param>
/// <param name="IsCharging">Actively charging (web <c>isCharging</c>).</param>
/// <param name="IsDriving">Moving — speed &gt; 0 (web <c>speed</c> drives the motion treatment).</param>
/// <param name="ExteriorColor">The Tesla exterior colour code driving the twin paint.</param>
/// <param name="ModelKey">The parsed model key (web <c>model</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the visualization.</param>
public sealed record VehicleGaugesCar(
    bool Locked,
    bool SentryMode,
    bool IsCharging,
    bool IsDriving,
    string ExteriorColor,
    TeslaModelKey ModelKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the vehicle gauges — the native analogue of everything the web
/// component computes before returning its panel: the car visualization, the four radial gauges, the metric
/// bars (the charge-rate bar only while charging), the four status chips, and the composed surface name. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the snapshot has a vehicle with live state to render.</param>
/// <param name="Car">The vehicle-visualization state, or <see langword="null"/> when there is no live state.</param>
/// <param name="Gauges">The four radial gauges, in web order (battery, range, speed, power).</param>
/// <param name="Metrics">The metric bars (battery level, estimated range, and charge rate while charging).</param>
/// <param name="Chips">The four status chips (lock, sentry, climate, firmware).</param>
/// <param name="IsCharging">True while charging (gates the charge-rate metric bar).</param>
/// <param name="AutomationName">The Narrator name for the whole surface.</param>
public sealed record VehicleGaugesDisplay(
    bool HasData,
    VehicleGaugesCar? Car,
    IReadOnlyList<VehicleGaugesGauge> Gauges,
    IReadOnlyList<VehicleGaugesMetric> Metrics,
    IReadOnlyList<VehicleGaugesChip> Chips,
    bool IsCharging,
    string AutomationName)
{
    /// <summary>An empty display (no vehicle / no live state) — the loading and empty fallback.</summary>
    /// <param name="localizer">The i18n facade the surface name resolves through.</param>
    /// <returns>A display with no car, gauges, metrics or chips.</returns>
    public static VehicleGaugesDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new VehicleGaugesDisplay(
            HasData: false,
            Car: null,
            Gauges: Array.Empty<VehicleGaugesGauge>(),
            Metrics: Array.Empty<VehicleGaugesMetric>(),
            Chips: Array.Empty<VehicleGaugesChip>(),
            IsCharging: false,
            AutomationName: localizer.GetString("vehicleGauges.surfaceName", "Vehicle gauges"));
    }
}

/// <summary>
/// Pure projection from a raw <see cref="VehicleGaugesData"/> to the render-ready display model — the native
/// port of the unit conversion, colour selection and composition in
/// web/src/features/vehicles/components/VehicleGauges.tsx. SI is converted to the user's display unit here
/// (and only here) via <see cref="UnitConverters"/> / <see cref="UnitFormatters"/>; every label resolves
/// through the i18n facade; every web colour maps to its exact design-token brush key. The gauge upper bounds
/// are expressed in SI (matching the web constants) and converted to the display unit so the arc fill
/// reflects the same physical quantity regardless of the km/mi preference.
/// </summary>
public static class VehicleGaugesProjection
{
    /// <summary>Practical upper bound for rated range — 600 mi in metres (web <c>MAX_RANGE_METERS</c>).</summary>
    public const double MaxRangeMeters = 600 * 1609.344;

    /// <summary>Practical upper bound for vehicle speed — 250 mph in m/s (web <c>MAX_SPEED_MPS</c>).</summary>
    public const double MaxSpeedMps = 250 * 0.44704;

    /// <summary>Supercharger-class charge-rate ceiling — 100 mph in metres-per-hour (web <c>MAX_CHARGE_RATE_METERS_PER_HOUR</c>).</summary>
    public const double MaxChargeRateMetersPerHour = 100 * 1609.344;

    /// <summary>Full-sweep maximum of the battery gauge (web <c>max=100</c>).</summary>
    public const double BatteryGaugeMax = 100;

    /// <summary>Full-sweep maximum of the power gauge in kW (web <c>max=250</c>).</summary>
    public const double PowerGaugeMax = 250;

    /// <summary>Above this state-of-charge the battery reads healthy/green (web <c>batteryColor</c> &gt; 60).</summary>
    public const double BatteryGoodPercent = 60;

    /// <summary>Above this state-of-charge the battery reads warning/amber, otherwise critical/red (web <c>batteryColor</c> &gt; 25).</summary>
    public const double BatteryWarnPercent = 25;

    /// <summary>The kilowatt unit suffix the web hard-codes onto the power gauge.</summary>
    public const string KilowattUnit = "kW";

    /// <summary>The percent unit suffix the web hard-codes onto the battery gauge.</summary>
    public const string PercentUnit = "%";

    // Design-token brush keys — the exact native mirrors of the web hex palette (web/src/lib/colors.ts).
    private const string CyanBrushKey = "TsChartSpeedBrush";       // web COLOR.CYAN  #00f0ff
    private const string PurpleBrushKey = "TsChartPowerBrush";     // web COLOR.PURPLE #a855f7 (exact)
    private const string GoodBrushKey = "TsColorSuccessBrush";     // web COLOR.GOOD  #10b981
    private const string WarnBrushKey = "TsColorWarningBrush";     // web COLOR.WARN  #f59e0b
    private const string BadBrushKey = "TsColorDangerBrush";       // web COLOR.BAD   #ef4444
    private const string MutedBrushKey = "TsColorTextMutedBrush";  // web COLOR.MUTED / COLOR.DARK

    // Segoe Fluent glyphs (the native analogue of the web lucide icons).
    private const string LockGlyph = "\uE72E";       // web Lock
    private const string UnlockGlyph = "\uE785";     // web Unlock
    private const string ShieldGlyph = "\uEA18";     // web Shield (Sentry)
    private const string ClimateGlyph = "\uE9CA";    // web Wind (climate)
    private const string ProcessorGlyph = "\uEC4A";  // web Cpu (firmware)

    private const string FirmwareFallback = "N/A";

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/>.</summary>
    /// <param name="data">The resolved snapshot (vehicle identity + optional live state).</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static VehicleGaugesDisplay Project(VehicleGaugesData data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = data.State;
        if (state is null || !data.HasVehicle)
        {
            return VehicleGaugesDisplay.Empty(localizer);
        }

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);

        double battery = state.BatteryLevel ?? 0;
        double speed = state.SpeedMps ?? 0;
        double chargerPower = state.ChargerPowerKw ?? 0;
        bool isCharging = state.IsCharging;

        // Pre-convert SI to user-pref numerics so the gauge value/max pairs share the same unit (web parity).
        double rangeDisplay = UnitConverters.DistanceFromSi(state.RatedRangeMeters ?? 0, units.Distance);
        double rangeMax = UnitConverters.DistanceFromSi(MaxRangeMeters, units.Distance);
        double speedDisplay = UnitConverters.SpeedFromSi(speed, units.Speed);
        double speedMax = UnitConverters.SpeedFromSi(MaxSpeedMps, units.Speed);
        double chargeRateDisplay = UnitConverters.DistanceFromSi(state.ChargeRateMeters ?? 0, units.Distance);
        double chargeRateMax = UnitConverters.DistanceFromSi(MaxChargeRateMetersPerHour, units.Distance);

        string batteryBrush = BatteryBrushKey(battery);

        var gauges = new List<VehicleGaugesGauge>(4)
        {
            Gauge("battery", localizer.GetString("common.battery", "Battery"), battery, BatteryGaugeMax, PercentUnit, batteryBrush),
            Gauge("range", localizer.GetString("common.range", "Range"), JsRound(rangeDisplay), JsRound(rangeMax), distanceUnit, CyanBrushKey),
            Gauge("speed", localizer.GetString("common.speed", "Speed"), JsRound(speedDisplay), JsRound(speedMax), speedUnit, speed > 0 ? PurpleBrushKey : MutedBrushKey),
            Gauge("power", localizer.GetString("common.power", "Power"), chargerPower, PowerGaugeMax, KilowattUnit, isCharging ? GoodBrushKey : MutedBrushKey),
        };

        var metrics = new List<VehicleGaugesMetric>(3)
        {
            Metric(
                "battery-level",
                localizer.GetString("common.batteryLevel", "Battery Level"),
                battery,
                BatteryGaugeMax,
                batteryBrush,
                $"{ScalarFormatters.FormatNumber(battery, 0)}{PercentUnit}"),
            Metric(
                "estimated-range",
                localizer.GetString("common.estimatedRange", "Estimated Range"),
                rangeDisplay,
                rangeMax,
                CyanBrushKey,
                UnitFormatters.FormatDistance(state.RatedRangeMeters, units)),
        };

        if (isCharging)
        {
            metrics.Add(Metric(
                "charge-rate",
                localizer.GetString("common.chargeRate", "Charge Rate"),
                chargeRateDisplay,
                chargeRateMax,
                GoodBrushKey,
                $"{UnitFormatters.FormatDistance(state.ChargeRateMeters, units)}/h"));
        }

        var chips = new List<VehicleGaugesChip>(4)
        {
            Chip(
                "lock",
                state.IsLocked ? LockGlyph : UnlockGlyph,
                state.IsLocked ? localizer.GetString("common.locked", "Locked") : localizer.GetString("common.unlocked", "Unlocked"),
                state.IsLocked ? GoodBrushKey : WarnBrushKey),
            Chip(
                "sentry",
                ShieldGlyph,
                state.SentryMode ? localizer.GetString("common.sentryOn", "Sentry ON") : localizer.GetString("common.sentryOff", "Sentry OFF"),
                state.SentryMode ? BadBrushKey : MutedBrushKey),
            Chip(
                "climate",
                ClimateGlyph,
                state.IsClimateOn ? localizer.GetString("common.climateOn", "Climate ON") : localizer.GetString("common.climateOff", "Climate OFF"),
                state.IsClimateOn ? CyanBrushKey : MutedBrushKey),
            Chip(
                "firmware",
                ProcessorGlyph,
                string.IsNullOrWhiteSpace(state.SoftwareVersion) ? FirmwareFallback : state.SoftwareVersion!.Trim(),
                PurpleBrushKey),
        };

        var car = BuildCar(data.Vehicle, state, localizer);
        string surfaceName = SurfaceName(data.Vehicle.Name, gauges.Count > 0 ? gauges[0].AutomationName : null, localizer);

        return new VehicleGaugesDisplay(true, car, gauges, metrics, chips, isCharging, surfaceName);
    }

    /// <summary>
    /// The design-token brush key for a state-of-charge, the native mirror of the web <c>batteryColor</c>
    /// (&gt; 60 emerald = <see cref="StatusKind.Success"/>, &gt; 25 amber = <see cref="StatusKind.Warning"/>,
    /// otherwise red = <see cref="StatusKind.Danger"/>).
    /// </summary>
    /// <param name="level">The state-of-charge percent (0–100).</param>
    /// <returns>The themed brush key the battery gauge / bar is tinted with.</returns>
    public static string BatteryBrushKey(double level)
    {
        if (level > BatteryGoodPercent)
        {
            return GoodBrushKey;
        }

        return level > BatteryWarnPercent ? WarnBrushKey : BadBrushKey;
    }

    private static VehicleGaugesCar BuildCar(VehicleGaugesVehicle vehicle, VehicleGaugesTelemetry state, ILocalizer localizer)
    {
        string name = string.IsNullOrWhiteSpace(vehicle.Name)
            ? localizer.GetString("vehicleGauges.car", "Vehicle")
            : vehicle.Name;
        string auto = string.Format(
            CultureInfo.CurrentCulture,
            "{0} \u2014 {1}",
            name,
            localizer.GetString("vehicleGauges.visualization", "vehicle status visualization"));

        return new VehicleGaugesCar(
            Locked: state.IsLocked,
            SentryMode: state.SentryMode,
            IsCharging: state.IsCharging,
            IsDriving: (state.SpeedMps ?? 0) > 0,
            ExteriorColor: vehicle.ExteriorColor,
            ModelKey: vehicle.ModelKey,
            AutomationName: auto);
    }

    private static VehicleGaugesGauge Gauge(string key, string label, double value, double max, string unit, string brushKey) =>
        new(key, label, value, max, unit, brushKey, ComposeGaugeName(label, value, unit));

    private static VehicleGaugesMetric Metric(string key, string label, double value, double max, string brushKey, string valueText) =>
        new(key, label, value, max, brushKey, valueText, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, valueText));

    private static VehicleGaugesChip Chip(string key, string glyph, string label, string brushKey) =>
        new(key, glyph, label, brushKey, label);

    private static string ComposeGaugeName(string label, double value, string unit)
    {
        string valueText = ScalarFormatters.FormatNumber(value, 0);
        return string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, valueText)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, valueText, unit);
    }

    private static string SurfaceName(string name, string? firstGaugeName, ILocalizer localizer)
    {
        var parts = new List<string> { localizer.GetString("vehicleGauges.surfaceName", "Vehicle gauges") };
        if (!string.IsNullOrWhiteSpace(name))
        {
            parts.Add(name);
        }

        if (!string.IsNullOrWhiteSpace(firstGaugeName))
        {
            parts.Add(firstGaugeName!);
        }

        return string.Join(", ", parts.Where(static p => !string.IsNullOrWhiteSpace(p)));
    }

    // Web Math.round semantics (floor(x + 0.5)) so the gauge values match the web exactly, including negatives.
    private static double JsRound(double value) => Math.Floor(value + 0.5);
}

/// <summary>
/// Canonical metadata for the Vehicle Gauges surface — the native mirror of the web component at
/// web/src/features/vehicles/components/VehicleGauges.tsx.
/// </summary>
public static class VehicleGaugesRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "vehicle-gauges";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleGauges";

    /// <summary>Localized surface name.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized surface name.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicleGauges.surfaceName", "Vehicle gauges");
    }
}

/// <summary>
/// PII-safe diagnostics for the Vehicle Gauges surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, name, location or telemetry
/// value — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class VehicleGaugesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public VehicleGaugesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleGauges</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleGaugesRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> field readers shared by the gauges parse adapters. File-local so
/// the helper never leaks into the namespace.
/// </summary>
file static class VehicleGaugesJson
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
