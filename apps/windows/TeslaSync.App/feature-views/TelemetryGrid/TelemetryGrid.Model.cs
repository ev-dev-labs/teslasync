using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="TelemetryGridViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the P2 surface contract mandates. The web
/// component (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx) is a pure presentational
/// grid that receives its <c>state</c> (a <c>VehicleState</c>) as a prop and only reads <c>useTranslation</c> +
/// <c>useUnits</c>; the parent page owns the <c>useVehicleState</c> query lifecycle. The native feature-view owns
/// its own cache-then-network read of <c>GET /vehicles/{vehicleID}/state</c>, so it reproduces every state
/// visibly (none is ever hidden). <see cref="Empty"/> mirrors the web parent's disabled / undefined query — no
/// resolved vehicle, or a response that carries no usable state — surfacing the "No telemetry data available"
/// state rather than a blank grid.
/// </summary>
public enum TelemetryGridState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) — render the six telemetry tiles.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the tiles plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the tiles plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The semantic value-tint a telemetry tile renders with — the native union of the web
/// <c>InfoTile</c> <c>color</c> prop branches (<c>text-emerald-300</c> / <c>text-amber-300</c> /
/// <c>text-rose-300</c> / <c>text-[var(--text-muted)]</c> / the default <c>text-[var(--text-primary)]</c>).
/// Kept UI-free so the projection is unit-tested without a XAML host; the view maps each member to a
/// token-backed brush.
/// </summary>
public enum TelemetryTileAccent
{
    /// <summary>Primary text tint (the web default <c>text-[var(--text-primary)]</c>).</summary>
    Primary,

    /// <summary>Muted text tint (web <c>text-[var(--text-muted)]</c>) — inactive charger / sentry.</summary>
    Muted,

    /// <summary>Success tint (web <c>text-emerald-300</c>) — a healthy battery / active charging.</summary>
    Success,

    /// <summary>Warning tint (web <c>text-amber-300</c>) — a mid-range battery.</summary>
    Warning,

    /// <summary>Danger tint (web <c>text-rose-300</c>) — a low battery / active Sentry.</summary>
    Danger,
}

/// <summary>
/// The vehicle-state fields the grid reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the
/// exact <c>VehicleState</c> slice the web <c>TelemetryGrid</c> consumes (web/src/api/types). Every numeric field
/// is SI on the wire (the backend stores SI: <see cref="RatedRange"/> / <see cref="Odometer"/> in metres,
/// <see cref="Speed"/> in m/s, <see cref="InsideTemp"/> / <see cref="OutsideTemp"/> in °C) except
/// <see cref="ChargerPower"/> (kW, shown verbatim) and <see cref="TimeToFullCharge"/> (hours, shown verbatim) —
/// matching the web component, which appends <c>" kW"</c> / <c>"h"</c> literally rather than routing those two
/// through <c>useUnits</c>. Every field is nullable so a missing key projects to the em dash exactly like the web
/// formatters' empty fallback. A <see langword="null"/> parse result models the web parent's <c>state</c> being
/// undefined (no usable vehicle state → the empty surface).
/// </summary>
/// <param name="BatteryLevel">State-of-charge percent 0–100 (web <c>battery_level</c>); null when absent.</param>
/// <param name="RatedRange">SI-metres rated range (web <c>rated_range</c>); null when absent.</param>
/// <param name="Speed">SI m/s speed (web <c>speed</c>); null when absent.</param>
/// <param name="InsideTemp">SI °C cabin temperature (web <c>inside_temp</c>); null when absent.</param>
/// <param name="OutsideTemp">SI °C ambient temperature (web <c>outside_temp</c>); null when absent.</param>
/// <param name="Odometer">SI-metres odometer (web <c>odometer</c>); null when absent.</param>
/// <param name="IsCharging">Whether the vehicle is charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPower">Charger power in kW (web <c>charger_power</c>); null when absent.</param>
/// <param name="TimeToFullCharge">Hours to a full charge (web <c>time_to_full_charge</c>); null when absent.</param>
/// <param name="SentryMode">Whether Sentry Mode is active (web <c>sentry_mode</c>).</param>
public sealed record VehicleTelemetryReading(
    double? BatteryLevel,
    double? RatedRange,
    double? Speed,
    double? InsideTemp,
    double? OutsideTemp,
    double? Odometer,
    bool IsCharging,
    double? ChargerPower,
    double? TimeToFullCharge,
    bool SentryMode)
{
    /// <summary>An all-absent reading — the projection fallback for a value-less emission.</summary>
    public static VehicleTelemetryReading Empty { get; } =
        new(null, null, null, null, null, null, false, null, null, false);

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the telemetry slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook (web/src/api/hooks/useVehicles.ts): prefer the
    /// canonical <c>state</c> object (the one carrying <c>vehicle_id</c>); otherwise, when neither a
    /// <c>vehicle</c> nor a <c>position</c> is present, fall back to a plain <c>state</c> object; otherwise
    /// reconstruct from the <c>position</c> snapshot (range / speed / temps / odometer) plus the top-level
    /// charging and Sentry flags. Returns <see langword="null"/> when none of those yield a state — the native
    /// analogue of the web <c>state</c> being undefined (→ the empty surface).
    /// </summary>
    /// <param name="root">The raw state-endpoint JSON body.</param>
    /// <returns>The parsed reading, or null when the body carries no usable state.</returns>
    public static VehicleTelemetryReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } canonical && Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — a plain state object is still usable;
            // otherwise there is no state and the grid shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot + the top-level charging / Sentry flags.
        var p = position;
        return new VehicleTelemetryReading(
            BatteryLevel: p is { } pb ? ReadDouble(pb, "battery_level") : null,
            RatedRange: p is { } pr ? ReadDouble(pr, "rated_range") ?? ReadDouble(pr, "ideal_range") : null,
            Speed: p is { } ps ? ReadDouble(ps, "speed") : null,
            InsideTemp: p is { } pi ? ReadDouble(pi, "inside_temp") : null,
            OutsideTemp: p is { } po ? ReadDouble(po, "outside_temp") : null,
            Odometer: p is { } pod ? ReadDouble(pod, "odometer") : null,
            IsCharging: ReadBool(root, "is_charging"),
            ChargerPower: ReadDouble(root, "charger_power"),
            TimeToFullCharge: ReadDouble(root, "time_to_full_charge"),
            SentryMode: ReadBool(root, "sentry_mode"));
    }

    private static VehicleTelemetryReading FromStateObject(JsonElement state) => new(
        BatteryLevel: ReadDouble(state, "battery_level"),
        RatedRange: ReadDouble(state, "rated_range"),
        Speed: ReadDouble(state, "speed"),
        InsideTemp: ReadDouble(state, "inside_temp"),
        OutsideTemp: ReadDouble(state, "outside_temp"),
        Odometer: ReadDouble(state, "odometer"),
        IsCharging: ReadBool(state, "is_charging"),
        ChargerPower: ReadDouble(state, "charger_power"),
        TimeToFullCharge: ReadDouble(state, "time_to_full_charge"),
        SentryMode: ReadBool(state, "sentry_mode"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    // Tolerant read: a missing / null / wrong-kind / non-finite field reads as null so a partial body never
    // throws and each tile independently shows the em dash, mirroring the web formatters' empty fallback.
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
/// One render-ready tile in the grid — the native analogue of a web <c>InfoTile</c> (Battery / Speed / Inside /
/// Odometer / Charger / Sentry). The value and optional sub-line are pre-formatted (unit-converted, em-dash
/// guarded) so the view is a thin renderer; <see cref="Accent"/> drives the value tint (web <c>InfoTile</c>
/// <c>color</c>) and <see cref="AutomationName"/> carries the Narrator label combining label, value and sub.
/// Pure data — no WinUI types.
/// </summary>
/// <param name="Key">Stable tile key (e.g. <c>battery</c>) — the native analogue of the web list position.</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the tile (native analogue of the web lucide icon).</param>
/// <param name="ValueText">The pre-formatted primary value (e.g. "82%", "60 km/h", or the em dash).</param>
/// <param name="Accent">The value tint.</param>
/// <param name="SubText">The optional pre-formatted sub-line, or null when the tile has none.</param>
/// <param name="AutomationName">The Narrator name combining label, value and (when present) sub.</param>
public sealed record TelemetryTile(
    string Key,
    string Label,
    string Glyph,
    string ValueText,
    TelemetryTileAccent Accent,
    string? SubText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the telemetry grid — the six tiles plus the <see cref="HasData"/>
/// gate. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a vehicle-state reading is present (web parent's <c>state</c> truthy).</param>
/// <param name="Tiles">The six telemetry tiles in web display order.</param>
public sealed record TelemetryGridDisplay(bool HasData, IReadOnlyList<TelemetryTile> Tiles)
{
    /// <summary>An empty projection (no tiles) — the projection fallback for an absent reading.</summary>
    public static TelemetryGridDisplay Empty { get; } = new(false, Array.Empty<TelemetryTile>());
}

/// <summary>
/// Pure projection from a raw <see cref="VehicleTelemetryReading"/> to the six display tiles — the native port of
/// the <c>TelemetryGrid</c> + <c>InfoTile</c> composition in
/// web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx, with the distance / speed /
/// temperature formatting from <c>useUnits</c>, the percent / power formatting from <c>fmtInt</c> and the
/// "Full in {h}h" sub-line from <c>fmtNumber</c>. Tile order, labels, value precision, unit suffixes and the
/// colour thresholds mirror the web component exactly. Every label resolves through the i18n facade; no WinUI
/// types — unit-tested without a XAML host.
/// </summary>
public static class TelemetryGridProjection
{
    /// <summary>Segoe Fluent "Battery10" glyph for the Battery tile (web lucide <c>Battery</c>).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "Speed" glyph for the Speed tile (web lucide <c>Gauge</c>).</summary>
    public const string SpeedGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "Frigid" glyph for the Inside tile (web lucide <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent "MapPin" glyph for the Odometer tile (web lucide <c>Navigation</c>).</summary>
    public const string OdometerGlyph = "\uE707";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the Charger tile (web lucide <c>BatteryCharging</c>).</summary>
    public const string ChargerGlyph = "\uE945";

    /// <summary>Segoe Fluent "RedEye" glyph for the Sentry tile (web lucide <c>Eye</c>).</summary>
    public const string SentryGlyph = "\uE7B3";

    /// <summary>Precision for the integer battery-percent and charger-power readouts (web <c>fmtInt</c>).</summary>
    public const int IntegerPrecision = 0;

    /// <summary>Fallback decimal precision for the "Full in {h}h" sub-line (web <c>fmtNumber</c> default).</summary>
    public const int DefaultDecimalPrecision = 2;

    /// <summary>Battery state-of-charge above which the value tints emerald (web <c>battery_level &gt; 50</c>).</summary>
    public const double BatteryHealthyThreshold = 50;

    /// <summary>Battery state-of-charge above which the value tints amber (web <c>battery_level &gt; 20</c>).</summary>
    public const double BatteryWarningThreshold = 20;

    /// <summary>The kilowatt unit suffix appended to the charger power (web literal <c>" kW"</c>).</summary>
    public const string KilowattSuffix = " kW";

    /// <summary>
    /// Project <paramref name="reading"/> into the six render-ready tiles using the user's units, localizing
    /// every label. Tile order, value precision, unit suffixes and colour thresholds mirror the web component.
    /// </summary>
    /// <param name="reading">The vehicle-state reading.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static TelemetryGridDisplay Project(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var tiles = new List<TelemetryTile>(6)
        {
            BuildBattery(reading, units, localizer),
            BuildSpeed(reading, units, localizer),
            BuildInside(reading, units, localizer),
            BuildOdometer(reading, units, localizer),
            BuildCharger(reading, units, localizer),
            BuildSentry(reading, localizer),
        };

        return new TelemetryGridDisplay(true, tiles);
    }

    // web: value=`${fmtInt(battery_level)}%`; color tiers > 50 / > 20; sub=`${formatDistance(rated_range)} range`.
    private static TelemetryTile BuildBattery(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        string value = ScalarFormatters.FormatPercentage(reading.BatteryLevel, IntegerPrecision);
        TelemetryTileAccent accent = reading.BatteryLevel switch
        {
            null => TelemetryTileAccent.Primary,
            > BatteryHealthyThreshold => TelemetryTileAccent.Success,
            > BatteryWarningThreshold => TelemetryTileAccent.Warning,
            _ => TelemetryTileAccent.Danger,
        };

        string range = localizer.GetString("common.range", "range");
        string sub = string.Create(
            CultureInfo.CurrentCulture,
            $"{UnitFormatters.FormatDistance(reading.RatedRange, units)} {range}");

        return Tile("battery", localizer.GetString("common.battery", "Battery"), BatteryGlyph, value, accent, sub);
    }

    // web: value=formatSpeed(speed); sub = speed > 0 ? 'Driving' : 'Parked'.
    private static TelemetryTile BuildSpeed(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        string value = UnitFormatters.FormatSpeed(reading.Speed, units);
        string sub = (reading.Speed ?? 0) > 0
            ? localizer.GetString("common.driving", "Driving")
            : localizer.GetString("common.parked", "Parked");

        return Tile(
            "speed", localizer.GetString("common.speed", "Speed"), SpeedGlyph, value, TelemetryTileAccent.Primary, sub);
    }

    // web: value=formatTemperature(inside_temp); sub=`${t('common.outside')}: ${formatTemperature(outside_temp)}`.
    private static TelemetryTile BuildInside(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        string value = UnitFormatters.FormatTemperature(reading.InsideTemp, units);
        string outside = localizer.GetString("common.outside", "Outside");
        string sub = string.Create(
            CultureInfo.CurrentCulture,
            $"{outside}: {UnitFormatters.FormatTemperature(reading.OutsideTemp, units)}");

        return Tile(
            "inside", localizer.GetString("common.inside", "Inside"), ThermometerGlyph, value, TelemetryTileAccent.Primary, sub);
    }

    // web: value=formatDistance(odometer, { precision: 0 }); no sub.
    private static TelemetryTile BuildOdometer(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        string value = UnitFormatters.FormatDistance(reading.Odometer, units, IntegerPrecision);
        return Tile(
            "odometer", localizer.GetString("common.odometer", "Odometer"), OdometerGlyph, value, TelemetryTileAccent.Primary, null);
    }

    // web: value = is_charging ? `${fmtInt(charger_power)} kW` : 'Not charging'; color emerald/muted;
    //      sub = is_charging && time_to_full_charge != null ? `Full in ${fmtNumber(time_to_full_charge)}h` : undefined.
    private static TelemetryTile BuildCharger(VehicleTelemetryReading reading, UnitPref units, ILocalizer localizer)
    {
        string value = reading.IsCharging
            ? ScalarFormatters.FormatNumber(reading.ChargerPower ?? 0, IntegerPrecision) + KilowattSuffix
            : localizer.GetString("common.notCharging", "Not charging");

        TelemetryTileAccent accent = reading.IsCharging ? TelemetryTileAccent.Success : TelemetryTileAccent.Muted;

        string? sub = null;
        if (reading.IsCharging && reading.TimeToFullCharge is { } hours)
        {
            string pattern = localizer.GetString("vehicles.telemetry.fullInHours", "Full in {0}h");
            sub = string.Format(
                CultureInfo.CurrentCulture, pattern, ScalarFormatters.FormatNumber(hours, ResolvePrecision(units)));
        }

        return Tile("charger", localizer.GetString("common.charger", "Charger"), ChargerGlyph, value, accent, sub);
    }

    // web: value = sentry_mode ? 'Active' : 'Off'; color rose/muted; no sub.
    private static TelemetryTile BuildSentry(VehicleTelemetryReading reading, ILocalizer localizer)
    {
        string value = reading.SentryMode
            ? localizer.GetString("common.active", "Active")
            : localizer.GetString("common.off", "Off");

        TelemetryTileAccent accent = reading.SentryMode ? TelemetryTileAccent.Danger : TelemetryTileAccent.Muted;
        return Tile("sentry", localizer.GetString("common.sentry", "Sentry"), SentryGlyph, value, accent, null);
    }

    // Web parity: fmtNumber() uses the user's global decimal precision (settings.decimal_precision, default 2);
    // useUnits derives the same value into UnitPref.Precision.
    private static int ResolvePrecision(UnitPref units) =>
        units.Precision is { } p and >= 0 ? p : DefaultDecimalPrecision;

    private static TelemetryTile Tile(
        string key, string label, string glyph, string value, TelemetryTileAccent accent, string? sub)
    {
        string automation = sub is null
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, sub);
        return new TelemetryTile(key, label, glyph, value, accent, sub, automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;VehicleTelemetryReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class TelemetryGridResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission carrying the state-endpoint JSON.</param>
    /// <returns>The parsed emission with its status preserved.</returns>
    public static RepositoryResult<VehicleTelemetryReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        VehicleTelemetryReading Parse() => raw.HasValue
            ? VehicleTelemetryReading.FromResponse(raw.Value) ?? VehicleTelemetryReading.Empty
            : VehicleTelemetryReading.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleTelemetryReading>.Loading(),
            LoadStatus.Cached => RepositoryResult<VehicleTelemetryReading>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<VehicleTelemetryReading>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<VehicleTelemetryReading>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<VehicleTelemetryReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<VehicleTelemetryReading>.OfflineCached(
                Parse(),
                raw.FetchedAt ?? DateTimeOffset.UtcNow,
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "offline")),
            _ => RepositoryResult<VehicleTelemetryReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "unknown")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Telemetry Grid surface — the native anchor for the diagnostics slug and
/// the localized copy. The web child has no registry entry (it is a page child); the native surface still
/// carries a stable id / slug for hosting and the P1/S11 diagnostics contract. Every key resolves through the
/// i18n facade — the eight <c>common.*</c> tile-label keys come straight from the web source; the surface-chrome
/// keys (title / empty) are the native superset the data-owning surface needs.
/// </summary>
public static class TelemetryGridRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "telemetry-grid";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TelemetryGrid";

    /// <summary>Localized surface title (the accessible name; the web grid itself is headerless).</summary>
    /// <param name="localizer">The i18n facade resolving the title.</param>
    /// <returns>The localized surface title.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.telemetry.grid.title", "Vehicle Telemetry");
    }

    /// <summary>Localized empty-state message (no resolved vehicle / no usable state).</summary>
    /// <param name="localizer">The i18n facade resolving the message.</param>
    /// <returns>The localized empty-state message.</returns>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("vehicles.telemetry.grid.noData", "No telemetry data available");
    }
}

/// <summary>
/// PII-safe diagnostics for the Telemetry Grid surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a battery / speed / location / odometer
/// value, VIN or vehicle id — so a diagnostics line can never leak fleet or owner-presence data. Thread-safe.
/// </summary>
public sealed class TelemetryGridDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public TelemetryGridDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TelemetryGrid</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TelemetryGridRegistration.Slug}");
    }
}
