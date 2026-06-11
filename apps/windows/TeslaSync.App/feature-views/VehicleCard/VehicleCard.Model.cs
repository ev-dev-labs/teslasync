using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="VehicleCardViewModel"/> can be in — the native
/// superset of the branches the web <c>VehicleCard</c> renders
/// (web/src/features/vehicles/components/VehicleCard.tsx). The web component is a pure list child (its
/// <c>vehicle</c> arrives as a prop and it reads that vehicle's live state via <c>useVehicleState</c>); the
/// native surface binds its own cache-then-network read (the vehicle roster plus that vehicle's live state),
/// so it owns the full loading / loaded / empty / error / stale / offline matrix the P2 state contract
/// requires. Every value maps onto a visible surface (never a blank panel). The web's two inner branches — a
/// card with the live stats row (<c>state</c> present) and a card without it (<c>state</c> null / asleep) —
/// are not lifecycle states: they are content variants of <see cref="Loaded"/> / <see cref="Stale"/> /
/// <see cref="Offline"/> selected by <see cref="VehicleCardDisplay.IsAwake"/>. <see cref="Empty"/> models the
/// native surface resolving no vehicle at all.
/// </summary>
public enum VehicleCardState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton card.</summary>
    Loading,

    /// <summary>A fresh snapshot with a resolved vehicle — render the card (with or without the stats row).</summary>
    Loaded,

    /// <summary>No vehicle resolved — render the friendly "no vehicle" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the card plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the card plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a card element renders with — the native, WinUI-free mirror of the web component's
/// per-element hue (web/src/features/vehicles/components/VehicleCard.tsx + <c>@/lib/colors</c>). Kept as an
/// enum so the projection can assign and the tests can assert the colour without a UI host; the view maps each
/// value to a themed design-token brush at render time, so light / dark / high-contrast all stay legible per
/// the "platform tokens, not web Tailwind" rule.
/// </summary>
public enum VehicleCardAccent
{
    /// <summary>Green (web <c>COLOR.GOOD #10b981</c>) — healthy battery, charge power, locked status.</summary>
    Green,

    /// <summary>Amber (web <c>COLOR.WARN #f59e0b</c>) — medium battery.</summary>
    Amber,

    /// <summary>Red (web <c>COLOR.BAD #ef4444</c>) — low battery.</summary>
    Red,

    /// <summary>Cyan (web <c>#00f0ff</c>) — armed Sentry mode.</summary>
    Cyan,

    /// <summary>Neutral grey — values with no semantic colour (interior, odometer).</summary>
    Neutral,
}

/// <summary>
/// The Tesla model family the car visualization draws — the native mirror of the web <c>TeslaModel</c> union
/// (web/src/components/data-display/TeslaCarViz.tsx). Resolved from the free-form <c>vehicle.model</c> string
/// by <see cref="VehicleCardModel.Parse"/>, a 1:1 port of the web <c>parseModelKey</c> heuristic.
/// </summary>
public enum TeslaModelKind
{
    /// <summary>Model 3 (the web default when nothing else matches).</summary>
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
/// Resolves the free-form <c>vehicle.model</c> string to a <see cref="TeslaModelKind"/> and back to a display
/// label — a WinUI-free 1:1 port of the web <c>parseModelKey</c> heuristic
/// (web/src/components/data-display/TeslaCarViz.tsx). Kept here so the projection assigns and the tests assert
/// the model family without a UI host.
/// </summary>
public static class VehicleCardModel
{
    /// <summary>
    /// Parse a model string like "Model 3 P", "Model Y", "Cybertruck" into a <see cref="TeslaModelKind"/>,
    /// mirroring the web <c>parseModelKey</c> (lowercase, strip whitespace, then substring-match cybertruck/ct,
    /// modelx/mx, modely/my, models/ms, else Model 3).
    /// </summary>
    /// <param name="model">The free-form model string (web <c>vehicle.model</c>).</param>
    /// <returns>The resolved model family.</returns>
    public static TeslaModelKind Parse(string? model)
    {
        if (string.IsNullOrWhiteSpace(model))
        {
            return TeslaModelKind.Model3;
        }

        string s = model.ToLowerInvariant();
        s = string.Concat(s.Where(static c => !char.IsWhiteSpace(c)));

        if (s.Contains("cybertruck", StringComparison.Ordinal) || s.Contains("ct", StringComparison.Ordinal))
        {
            return TeslaModelKind.Cybertruck;
        }

        if (s.Contains("modelx", StringComparison.Ordinal) || s.Contains("mx", StringComparison.Ordinal))
        {
            return TeslaModelKind.ModelX;
        }

        if (s.Contains("modely", StringComparison.Ordinal) || s.Contains("my", StringComparison.Ordinal))
        {
            return TeslaModelKind.ModelY;
        }

        if (s.Contains("models", StringComparison.Ordinal) || s.Contains("ms", StringComparison.Ordinal))
        {
            return TeslaModelKind.ModelS;
        }

        return TeslaModelKind.Model3;
    }

    /// <summary>The short display label for a model family (e.g. <c>Model 3</c>, <c>Cybertruck</c>).</summary>
    /// <param name="kind">The model family.</param>
    /// <returns>The display label.</returns>
    public static string Label(TeslaModelKind kind) => kind switch
    {
        TeslaModelKind.ModelS => "Model S",
        TeslaModelKind.ModelY => "Model Y",
        TeslaModelKind.ModelX => "Model X",
        TeslaModelKind.Cybertruck => "Cybertruck",
        _ => "Model 3",
    };
}

/// <summary>
/// The vehicle identity the card header shows — the native mirror of the web <c>Vehicle</c> slice the list
/// passes to <c>&lt;VehicleCard /&gt;</c> (<c>display_name</c>, <c>vin</c>, <c>model</c>, <c>trim_badging</c>).
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never
/// throws.
/// </summary>
/// <param name="Id">The vehicle's database id (web <c>id</c>) used to scope the state read and the detail link.</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle identification number (web <c>vin</c>).</param>
/// <param name="Model">The model code (web <c>model</c>).</param>
/// <param name="TrimBadging">The trim badge (web <c>trim_badging</c>).</param>
public sealed record VehicleCardVehicle(
    long Id,
    string DisplayName,
    string Vin,
    string Model,
    string TrimBadging)
{
    /// <summary>The sentinel "no vehicle resolved" identity (the parse / empty fallback).</summary>
    public static VehicleCardVehicle None { get; } = new(0, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Header name — web <c>vehicle.display_name || vehicle.vin</c>.</summary>
    [JsonIgnore]
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>The space-joined <c>model trim_badging</c> token (web <c>{model} {trim_badging}</c>); may be empty.</summary>
    [JsonIgnore]
    public string ModelTrim => string.Join(
        ' ',
        new[] { Model, TrimBadging }.Where(static p => !string.IsNullOrWhiteSpace(p)).Select(static p => p.Trim()));

    /// <summary>
    /// Header subtitle — web <c>{model} {trim_badging} · {vin}</c>. The model and trim collapse to a single
    /// space-joined token; the VIN is appended after a middle dot. Absent parts drop out cleanly.
    /// </summary>
    [JsonIgnore]
    public string Subtitle => string.Join(
        " \u00B7 ",
        new[] { ModelTrim, (Vin ?? string.Empty).Trim() }.Where(static p => !string.IsNullOrWhiteSpace(p)));

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
    public static VehicleCardVehicle? FromVehiclesArray(JsonElement root, long? preferredId)
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
            if (preferredId is { } id && VehicleCardJson.Long(element, "id") == id)
            {
                return FromObject(element);
            }
        }

        return first is { } fallback ? FromObject(fallback) : null;
    }

    private static VehicleCardVehicle FromObject(JsonElement v) => new(
        Id: VehicleCardJson.Long(v, "id") ?? 0,
        DisplayName: VehicleCardJson.String(v, "display_name") ?? string.Empty,
        Vin: VehicleCardJson.String(v, "vin") ?? string.Empty,
        Model: VehicleCardJson.String(v, "model") ?? string.Empty,
        TrimBadging: VehicleCardJson.String(v, "trim_badging") ?? string.Empty);
}

/// <summary>
/// The SI vehicle state the card reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the
/// web <c>VehicleState</c> slice the card consumes. Distances are metres (<c>rated_range</c> / <c>odometer</c>),
/// speed is m/s (<c>speed</c>), temperature is °C (<c>inside_temp</c>), and <c>charger_power</c> is kilowatts
/// (the web shows it as kW without conversion). Every dynamic field is nullable and stays null when the source
/// did not report it, so the projection renders an explicit em dash rather than a fabricated value. A
/// <see langword="null"/> parse result models the web <c>stateData?.state</c> being undefined (asleep).
/// </summary>
/// <param name="Status">The FSM state string (web <c>state.state</c>).</param>
/// <param name="BatteryLevel">State-of-charge percent (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in metres (web <c>rated_range</c>).</param>
/// <param name="OdometerMeters">Odometer in metres (web <c>odometer</c>).</param>
/// <param name="InsideTempCelsius">Cabin temperature in °C (web <c>inside_temp</c>).</param>
/// <param name="SpeedMps">Speed in metres per second (web <c>speed</c>) — drives the derived "driving" status.</param>
/// <param name="IsCharging">True while charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power in kilowatts (web <c>charger_power</c>).</param>
/// <param name="IsLocked">True when the vehicle is locked (web <c>is_locked</c>).</param>
/// <param name="SentryMode">True when Sentry mode is armed (web <c>sentry_mode</c>).</param>
public sealed record VehicleCardTelemetry(
    string Status,
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? OdometerMeters,
    double? InsideTempCelsius,
    double? SpeedMps,
    bool IsCharging,
    double? ChargerPowerKw,
    bool IsLocked,
    bool SentryMode)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the card slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c>
    /// is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging fields.
    /// Returns <see langword="null"/> when none of those yield a state — the native analogue of the web
    /// <c>state</c> being undefined (asleep).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed telemetry, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static VehicleCardTelemetry? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state carrying a vehicle_id is the canonical SignalStore state object.
        if (VehicleCardJson.Object(root, "state") is { } canonical && VehicleCardJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = VehicleCardJson.Object(root, "vehicle");
        var position = VehicleCardJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: a plain state object (no vehicle/position envelope) is still usable.
            return VehicleCardJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot + the top-level charging flags. The
        // drive-only fields (speed / odometer / locks) only exist on the canonical state object, so they
        // remain null here and render an em dash.
        return new VehicleCardTelemetry(
            Status: (vehicle is { } v ? VehicleCardJson.String(v, "state") : null) ?? "offline",
            BatteryLevel: position is { } pb ? VehicleCardJson.Double(pb, "battery_level") : null,
            RatedRangeMeters: position is { } pr ? VehicleCardJson.Double(pr, "rated_range") : null,
            OdometerMeters: position is { } po ? VehicleCardJson.Double(po, "odometer") : null,
            InsideTempCelsius: position is { } pin ? VehicleCardJson.Double(pin, "inside_temp") : null,
            SpeedMps: position is { } ps ? VehicleCardJson.Double(ps, "speed") : null,
            IsCharging: VehicleCardJson.Bool(root, "is_charging"),
            ChargerPowerKw: VehicleCardJson.Double(root, "charger_power"),
            IsLocked: position is { } pl && VehicleCardJson.Bool(pl, "is_locked"),
            SentryMode: position is { } pse && VehicleCardJson.Bool(pse, "sentry_mode"));
    }

    private static VehicleCardTelemetry FromStateObject(JsonElement s) => new(
        Status: VehicleCardJson.String(s, "state") ?? "offline",
        BatteryLevel: VehicleCardJson.Double(s, "battery_level"),
        RatedRangeMeters: VehicleCardJson.Double(s, "rated_range"),
        OdometerMeters: VehicleCardJson.Double(s, "odometer"),
        InsideTempCelsius: VehicleCardJson.Double(s, "inside_temp"),
        SpeedMps: VehicleCardJson.Double(s, "speed"),
        IsCharging: VehicleCardJson.Bool(s, "is_charging"),
        ChargerPowerKw: VehicleCardJson.Double(s, "charger_power"),
        IsLocked: VehicleCardJson.Bool(s, "is_locked"),
        SentryMode: VehicleCardJson.Bool(s, "sentry_mode"));
}

/// <summary>
/// The resolved card reading cached by the source: the always-present <see cref="Vehicle"/> identity plus the
/// (nullable) live <see cref="State"/>. A null <see cref="State"/> is the asleep vehicle (web
/// <c>stateData?.state ?? null</c> — the card hides its stats row); a <see cref="VehicleCardVehicle.None"/>
/// vehicle is "no vehicle resolved". Serialized to the cache as JSON so the cache-then-network read round-trips
/// losslessly.
/// </summary>
/// <param name="Vehicle">The resolved vehicle identity (or the <see cref="VehicleCardVehicle.None"/> sentinel).</param>
/// <param name="State">The live telemetry, or <see langword="null"/> when the vehicle is asleep.</param>
public sealed record VehicleCardData(VehicleCardVehicle Vehicle, VehicleCardTelemetry? State)
{
    /// <summary>The "no vehicle resolved" snapshot — the parse / loading fallback.</summary>
    public static VehicleCardData Empty { get; } = new(VehicleCardVehicle.None, null);

    /// <summary>True when a real vehicle backs the snapshot (drives the Loaded-vs-Empty classification).</summary>
    [JsonIgnore]
    public bool HasVehicle => Vehicle.HasVehicle;

    /// <summary>True when the resolved vehicle reported live state (web <c>state</c> present) — show the stats row.</summary>
    [JsonIgnore]
    public bool IsAwake => State is not null;
}

/// <summary>
/// The projected car visualization — the native analogue of the web <c>&lt;TeslaCarViz&gt;</c>. Carries the
/// parsed model family + label and the state the viz reflects (battery fill accent, charging, locked, Sentry,
/// speed). Pure data — the view draws a tokenized model glyph tinted by <see cref="BatteryAccent"/> plus the
/// active state glyphs. The defaults match the web component's prop fallbacks (battery 50, locked true,
/// charging / Sentry false, speed 0) so the asleep card still shows a meaningful vehicle.
/// </summary>
/// <param name="Model">The parsed model family (web <c>parseModelKey(vehicle.model)</c>).</param>
/// <param name="ModelLabel">The model display label (e.g. <c>Model 3</c>).</param>
/// <param name="BatteryLevel">The battery fill the viz reflects (web <c>battery_level ?? 50</c>).</param>
/// <param name="BatteryAccent">The categorical battery accent the model glyph tints with.</param>
/// <param name="IsCharging">True when the charging glyph is shown (web <c>is_charging ?? false</c>).</param>
/// <param name="IsLocked">True when the locked glyph is shown (web <c>is_locked ?? true</c>).</param>
/// <param name="SentryMode">True when the Sentry glyph is shown (web <c>sentry_mode ?? false</c>).</param>
/// <param name="Speed">The speed the viz reflects (web hard-codes <c>0</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the viz.</param>
public sealed record VehicleCardViz(
    TeslaModelKind Model,
    string ModelLabel,
    double BatteryLevel,
    VehicleCardAccent BatteryAccent,
    bool IsCharging,
    bool IsLocked,
    bool SentryMode,
    double Speed,
    string AutomationName);

/// <summary>
/// The projected battery group shown in the live stats row — the native analogue of the web battery column
/// (a <c>&lt;ProgressRing&gt;</c> plus the state-of-charge percent and the rated range). Pure, pre-formatted
/// data. Present only when the vehicle is awake.
/// </summary>
/// <param name="Level">The battery percent the ring sweeps to (web <c>ProgressRing value</c>).</param>
/// <param name="LevelText">The formatted state-of-charge, e.g. <c>"72%"</c> (web <c>{battery_level}%</c>).</param>
/// <param name="RangeText">The formatted rated range, e.g. <c>"410.0 km"</c> (web <c>formatDistance(rated_range)</c>).</param>
/// <param name="Accent">The categorical ring accent (web <c>batteryColor(battery_level)</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the battery group.</param>
public sealed record VehicleCardBattery(
    double Level,
    string LevelText,
    string RangeText,
    VehicleCardAccent Accent,
    string AutomationName);

/// <summary>
/// One projected stat column in the live stats row — the native analogue of one web value/caption column
/// (interior temperature, odometer, and — while charging — charge power). Pure, pre-formatted data.
/// </summary>
/// <param name="Key">Stable column id (e.g. <c>interior</c>) used by the view and tests.</param>
/// <param name="Label">The localized caption beneath the value (web small caption).</param>
/// <param name="Value">The pre-formatted value (already in display units), or an em dash.</param>
/// <param name="Accent">The categorical value accent (web per-column colour; neutral unless charging).</param>
/// <param name="AutomationName">The composed Narrator name for the column.</param>
public sealed record VehicleCardStat(
    string Key,
    string Label,
    string Value,
    VehicleCardAccent Accent,
    string AutomationName);

/// <summary>
/// One projected status flag glyph — the native analogue of the web trailing lock / Sentry icons, shown only
/// when the corresponding flag is active (web <c>{state.is_locked &amp;&amp; …}</c> / <c>{state.sentry_mode &amp;&amp; …}</c>).
/// Pure data.
/// </summary>
/// <param name="Key">Stable flag id (<c>locked</c> / <c>sentry</c>) used by the view and tests.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the flag (web lucide <c>Lock</c> / <c>Shield</c>).</param>
/// <param name="Label">The localized flag label used in the Narrator name.</param>
/// <param name="Accent">The categorical glyph accent (web green lock / cyan Sentry).</param>
/// <param name="AutomationName">The Narrator name for the flag.</param>
public sealed record VehicleCardFlag(
    string Key,
    string Glyph,
    string Label,
    VehicleCardAccent Accent,
    string AutomationName);

/// <summary>
/// The projected card actions — the native analogue of the web "View details" <c>&lt;Link&gt;</c> and the
/// "Remove vehicle" delete <c>&lt;Button&gt;</c>. The view routes <see cref="DetailsRoute"/> through its
/// navigation event and raises a delete request carrying <see cref="VehicleId"/> / <see cref="VehicleName"/>
/// (the native analogue of the web <c>onDelete(vehicle)</c> callback). Pure data.
/// </summary>
/// <param name="VehicleId">The vehicle id the actions target.</param>
/// <param name="VehicleName">The vehicle name (for the delete confirmation / Narrator name).</param>
/// <param name="DetailsRoute">The in-app route the "View details" action navigates to (web <c>/vehicles/{id}</c>).</param>
/// <param name="ViewDetailsLabel">The localized "View details" label (web <c>card.viewDetails</c>).</param>
/// <param name="RemoveLabel">The localized "Remove vehicle" label (web <c>card.removeVehicle</c>).</param>
public sealed record VehicleCardActions(
    long VehicleId,
    string VehicleName,
    string DetailsRoute,
    string ViewDetailsLabel,
    string RemoveLabel);

/// <summary>
/// The fully projected, render-ready view of the card — everything the web component computes before returning
/// its JSX, split into the always-visible header (name / status / subtitle) and car viz, the awake live stats
/// (the battery group, the interior / odometer / charge-power columns and the lock / Sentry flags) and the
/// always-visible actions. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Name">The header vehicle name (web <c>display_name || vin</c>).</param>
/// <param name="Subtitle">The full header subtitle string (model / trim / VIN) for the Narrator name.</param>
/// <param name="ModelTrim">The model + trim portion of the subtitle (may be empty); rendered before the VIN.</param>
/// <param name="Vin">The VIN portion of the subtitle, rendered monospace (web <c>font-mono</c>).</param>
/// <param name="Status">The raw derived status string fed to the status badge (web <c>getVehicleStatus(state)</c>).</param>
/// <param name="StatusText">The capitalized status used in spoken names.</param>
/// <param name="StatusAccentKey">The design-token brush key for the status dot.</param>
/// <param name="Viz">The car visualization (always present).</param>
/// <param name="IsAwake">True when live state is present — render the stats row; false hides it (web <c>{state &amp;&amp; …}</c>).</param>
/// <param name="Battery">The battery group, or <see langword="null"/> when asleep.</param>
/// <param name="Stats">The interior / odometer / (charging) stat columns, in web order (empty when asleep).</param>
/// <param name="Flags">The active lock / Sentry flags (empty when asleep or none active).</param>
/// <param name="Actions">The always-visible view-details / delete actions.</param>
/// <param name="AutomationName">The composed Narrator name for the whole card.</param>
public sealed record VehicleCardDisplay(
    string Name,
    string Subtitle,
    string ModelTrim,
    string Vin,
    string Status,
    string StatusText,
    string StatusAccentKey,
    VehicleCardViz Viz,
    bool IsAwake,
    VehicleCardBattery? Battery,
    IReadOnlyList<VehicleCardStat> Stats,
    IReadOnlyList<VehicleCardFlag> Flags,
    VehicleCardActions Actions,
    string AutomationName)
{
    /// <summary>The empty/initial display used for the loading and no-vehicle fallback (no vehicle, no state).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready empty display.</returns>
    public static VehicleCardDisplay Empty(ILocalizer localizer) =>
        VehicleCardProjection.Project(VehicleCardData.Empty, UnitPref.Metric, localizer);
}

/// <summary>
/// Pure projection from a raw <see cref="VehicleCardData"/> to its render-ready <see cref="VehicleCardDisplay"/>
/// — the native port of the render logic in web/src/features/vehicles/components/VehicleCard.tsx. SI is
/// converted to the user's display unit at this boundary (and only here); the kilowatt charge power is shown
/// as-is exactly as the web does. Every translatable label resolves through the i18n facade using the same
/// keys the web source passes to <c>t()</c> (plus keys for the few labels the web derives, so no English
/// literal survives in native code). WinUI-free — unit-tested without a UI host.
/// </summary>
public static class VehicleCardProjection
{
    /// <summary>Em dash rendered for any unreported metric (web <c>—</c>).</summary>
    public const string Dash = "\u2014";

    /// <summary>The kilowatt unit suffix the web hard-codes onto the charge-power figure.</summary>
    public const string KilowattUnit = "kW";

    /// <summary>Decimal places for the kilowatt charge-power readout (the native power convention).</summary>
    public const int PowerDecimals = 1;

    /// <summary>The battery fill the web viz falls back to when no live state is present (<c>battery_level ?? 50</c>).</summary>
    public const double DefaultVizBattery = 50;

    /// <summary>Above this state-of-charge the battery reads healthy (web <c>batteryColor</c> &gt; 60).</summary>
    public const double HealthyBatteryPercent = 60;

    /// <summary>Above this state-of-charge (up to <see cref="HealthyBatteryPercent"/>) the battery reads medium (web &gt; 25).</summary>
    public const double WarningBatteryPercent = 25;

    // Segoe Fluent glyphs (the native analogue of the web lucide icons).
    private const string LockGlyph = "\uE72E";   // web Lock
    private const string ShieldGlyph = "\uEA18";  // web Shield
    private const string ZapGlyph = "\uE945";     // web Zap (charging)

    private static readonly string[] KnownStates =
        ["online", "driving", "charging", "parked", "updating", "asleep", "offline"];

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/>.</summary>
    /// <param name="data">The resolved card snapshot (vehicle identity + optional live state).</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static VehicleCardDisplay Project(VehicleCardData data, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicle = data.Vehicle;
        var state = data.State;

        string status = DeriveStatus(state);
        string statusText = Capitalize(status);
        string name = vehicle.Name;

        var viz = BuildViz(vehicle, state, localizer);
        var actions = new VehicleCardActions(
            VehicleId: vehicle.Id,
            VehicleName: name,
            DetailsRoute: string.Create(CultureInfo.InvariantCulture, $"/vehicles/{vehicle.Id}"),
            ViewDetailsLabel: localizer.GetString("card.viewDetails", "View details"),
            RemoveLabel: localizer.GetString("card.removeVehicle", "Remove vehicle"));

        VehicleCardBattery? battery = null;
        IReadOnlyList<VehicleCardStat> stats = Array.Empty<VehicleCardStat>();
        IReadOnlyList<VehicleCardFlag> flags = Array.Empty<VehicleCardFlag>();

        if (state is not null)
        {
            battery = BuildBattery(state, units, localizer);
            stats = BuildStats(state, units, localizer);
            flags = BuildFlags(state, localizer);
        }

        return new VehicleCardDisplay(
            Name: name,
            Subtitle: vehicle.Subtitle,
            ModelTrim: vehicle.ModelTrim,
            Vin: (vehicle.Vin ?? string.Empty).Trim(),
            Status: status,
            StatusText: statusText,
            StatusAccentKey: StatusAccentKey(status),
            Viz: viz,
            IsAwake: state is not null,
            Battery: battery,
            Stats: stats,
            Flags: flags,
            Actions: actions,
            AutomationName: SurfaceName(name, statusText, vehicle.Subtitle));
    }

    /// <summary>
    /// Derive the display status from live state — a 1:1 port of the web <c>deriveVehicleStatus</c>: no state
    /// is <c>offline</c>, charging wins, then a positive speed is <c>driving</c>, then a recognised FSM state
    /// string passes through, otherwise <c>online</c>.
    /// </summary>
    /// <param name="state">The live telemetry, or <see langword="null"/> when asleep.</param>
    /// <returns>The derived status string.</returns>
    public static string DeriveStatus(VehicleCardTelemetry? state)
    {
        if (state is null)
        {
            return "offline";
        }

        if (state.IsCharging)
        {
            return "charging";
        }

        if ((state.SpeedMps ?? 0) > 0)
        {
            return "driving";
        }

        string s = (state.Status ?? string.Empty).Trim().ToLowerInvariant();
        return Array.IndexOf(KnownStates, s) >= 0 ? s : "online";
    }

    /// <summary>
    /// The categorical battery accent — a 1:1 port of the web <c>batteryColor</c>: above 60% reads green, above
    /// 25% reads amber, otherwise red.
    /// </summary>
    /// <param name="level">The state-of-charge percent.</param>
    /// <returns>The categorical accent.</returns>
    public static VehicleCardAccent BatteryAccent(double level) => level switch
    {
        > HealthyBatteryPercent => VehicleCardAccent.Green,
        > WarningBatteryPercent => VehicleCardAccent.Amber,
        _ => VehicleCardAccent.Red,
    };

    /// <summary>
    /// The design-token brush key for the status-badge dot, mirroring the web vehicle-state badge palette
    /// (online green, driving/parked/updating info, charging amber, asleep purple, offline red, otherwise
    /// neutral) mapped to the nearest themed token so light / dark / high-contrast all stay legible.
    /// </summary>
    /// <param name="status">The raw status string.</param>
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

    /// <summary>The Segoe Fluent charging glyph (exposed so the view and tests share one source).</summary>
    public static string ChargingGlyph => ZapGlyph;

    private static VehicleCardViz BuildViz(VehicleCardVehicle vehicle, VehicleCardTelemetry? state, ILocalizer localizer)
    {
        var model = VehicleCardModel.Parse(vehicle.Model);
        string modelLabel = VehicleCardModel.Label(model);
        double battery = state?.BatteryLevel ?? DefaultVizBattery;
        bool charging = state?.IsCharging ?? false;
        bool locked = state?.IsLocked ?? true;
        bool sentry = state?.SentryMode ?? false;

        string automation = string.Create(
            CultureInfo.InvariantCulture,
            $"{modelLabel}, {localizer.GetString("card.battery", "Battery")} {JsRound(battery)} %");

        return new VehicleCardViz(
            Model: model,
            ModelLabel: modelLabel,
            BatteryLevel: battery,
            BatteryAccent: BatteryAccent(battery),
            IsCharging: charging,
            IsLocked: locked,
            SentryMode: sentry,
            Speed: 0,
            AutomationName: automation);
    }

    private static VehicleCardBattery BuildBattery(VehicleCardTelemetry state, UnitPref units, ILocalizer localizer)
    {
        double level = state.BatteryLevel ?? 0;
        string levelText = ScalarFormatters.FormatPercentage(state.BatteryLevel, 0, Dash);
        string rangeText = UnitFormatters.FormatDistance(state.RatedRangeMeters, units);
        string label = localizer.GetString("card.battery", "Battery");

        return new VehicleCardBattery(
            Level: level,
            LevelText: levelText,
            RangeText: rangeText,
            Accent: BatteryAccent(level),
            AutomationName: $"{label}: {levelText} \u00B7 {rangeText}");
    }

    private static List<VehicleCardStat> BuildStats(VehicleCardTelemetry state, UnitPref units, ILocalizer localizer)
    {
        var stats = new List<VehicleCardStat>(3);

        // Web parity: interior temperature column — formatTemperature(inside_temp) over the t('card.interior') caption.
        string interiorLabel = localizer.GetString("card.interior", "Interior");
        string interiorValue = UnitFormatters.FormatTemperature(state.InsideTempCelsius, units);
        stats.Add(new VehicleCardStat(
            "interior",
            interiorLabel,
            interiorValue,
            VehicleCardAccent.Neutral,
            $"{interiorLabel}: {interiorValue}"));

        // Web parity: odometer column — fmtInt(convertDistanceFromSI(odometer, distance)) with the unit as caption.
        string distanceUnit = UnitLabels.Label(units.Distance);
        string odometerValue = state.OdometerMeters is { } meters
            ? ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(meters, units.Distance), 0, Dash)
            : Dash;
        string odometerLabel = localizer.GetString("card.odometer", "Odometer");
        stats.Add(new VehicleCardStat(
            "odometer",
            distanceUnit,
            odometerValue,
            VehicleCardAccent.Neutral,
            $"{odometerLabel}: {odometerValue} {distanceUnit}"));

        // Web parity: charge-power column shown only while charging — {charger_power} kW over t('card.charging').
        if (state.IsCharging)
        {
            string chargingLabel = localizer.GetString("card.charging", "Charging");
            string power = ScalarFormatters.FormatNumber(state.ChargerPowerKw, PowerDecimals, Dash);
            string chargingValue = power == Dash ? Dash : $"{power} {KilowattUnit}";
            stats.Add(new VehicleCardStat(
                "charging",
                chargingLabel,
                chargingValue,
                VehicleCardAccent.Green,
                $"{chargingLabel}: {chargingValue}"));
        }

        return stats;
    }

    private static List<VehicleCardFlag> BuildFlags(VehicleCardTelemetry state, ILocalizer localizer)
    {
        var flags = new List<VehicleCardFlag>(2);

        // Web parity: the trailing lock / Sentry icons appear only when the flag is active.
        if (state.IsLocked)
        {
            string label = localizer.GetString("card.locked", "Locked");
            flags.Add(new VehicleCardFlag("locked", LockGlyph, label, VehicleCardAccent.Green, label));
        }

        if (state.SentryMode)
        {
            string label = localizer.GetString("card.sentry", "Sentry");
            flags.Add(new VehicleCardFlag("sentry", ShieldGlyph, label, VehicleCardAccent.Cyan, label));
        }

        return flags;
    }

    private static string SurfaceName(string name, string statusText, string subtitle)
    {
        string head = string.IsNullOrWhiteSpace(name) ? statusText : $"{name}, {statusText}";
        return string.IsNullOrWhiteSpace(subtitle) ? head : $"{head}. {subtitle}";
    }

    private static string Normalize(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant();

    private static double JsRound(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

    private static string Capitalize(string? s)
    {
        if (string.IsNullOrEmpty(s))
        {
            return string.Empty;
        }

        return char.ToUpperInvariant(s[0]) + s[1..];
    }
}

/// <summary>
/// Canonical metadata for the Vehicle Card surface — the native mirror of the web component at
/// web/src/features/vehicles/components/VehicleCard.tsx.
/// </summary>
public static class VehicleCardRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "vehicle-card";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleCard";

    /// <summary>Localized surface name.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized surface name.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("card.surfaceName", "Vehicle");
    }
}

/// <summary>
/// PII-safe diagnostics for the Vehicle Card surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a VIN, name, location or telemetry
/// value — so a diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class VehicleCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public VehicleCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleCardRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> field readers shared by the card parse adapters. File-local so the
/// helper never leaks into the namespace.
/// </summary>
file static class VehicleCardJson
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
