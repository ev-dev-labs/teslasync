using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>GlancePage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/dashboard/pages/GlancePage.tsx). The web page gates its body on
/// <c>vehiclesLoading ? Skeleton : vehiclesError ? Error : !vehicle ? &lt;EmptyState&gt; : &lt;content&gt;</c>, so the
/// states map 1:1: a vehicles read in flight (<see cref="Loading"/>), a failed vehicles read (<see cref="Error"/>),
/// a resolved-but-empty fleet (<see cref="Empty"/>, the "No vehicle found" surface) and a resolved vehicle
/// (<see cref="Success"/>, the glance card). Per-region visibility within the success body is still driven by the
/// projected flags so the metric cards and quick actions never collapse silently.
/// </summary>
public enum GlanceState
{
    /// <summary>The vehicles read is in flight with nothing yet to show (web <c>vehiclesLoading</c>).</summary>
    Loading,

    /// <summary>The vehicles read failed (web <c>vehiclesError</c>) — the retry surface is shown.</summary>
    Error,

    /// <summary>The vehicles read resolved no vehicle (web <c>!vehicle</c>) — the "No vehicle found" empty surface.</summary>
    Empty,

    /// <summary>A vehicle resolved — the glance card (gauge + metrics + quick actions) renders.</summary>
    Success,
}

/// <summary>
/// The vehicle the glance card is scoped to — the native mirror of the web <c>useVehicles</c> resolution
/// (<c>vehicleId ?? vehicles?.[0]?.id</c>, with the optional <c>?vehicle_id=</c> deep-link). <see cref="DisplayName"/>
/// and <see cref="Model"/> back the header label (web <c>display_name || model || t('glance.defaultName')</c>); a
/// null parse result models an empty fleet (web <c>!vehicle</c> → the empty surface). Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The resolved vehicle id (&gt; 0 for a real vehicle).</param>
/// <param name="DisplayName">The vehicle display name, or the empty string when unknown.</param>
/// <param name="Model">The vehicle model, or the empty string when unknown.</param>
public sealed record GlanceVehicle(long Id, string DisplayName, string Model)
{
    /// <summary>
    /// Resolve the vehicle the glance card commands from a <c>GET /vehicles</c> response, mirroring the web
    /// <c>vehicleId ? (vehicles.find(v =&gt; String(v.id) === vehicleId) ?? vehicles[0]) : vehicles[0]</c>: an
    /// explicit <paramref name="explicitVehicleId"/> wins, otherwise the first list entry. Returns
    /// <see langword="null"/> when the list is empty (web <c>!vehicle</c>). Tolerates both a bare array and a
    /// <c>{ "vehicles": [...] }</c> envelope, and numeric-string ids.
    /// </summary>
    public static GlanceVehicle? Resolve(JsonElement root, long? explicitVehicleId)
    {
        var vehicles = AsArray(root);
        if (vehicles is not { ValueKind: JsonValueKind.Array } array || array.GetArrayLength() == 0)
        {
            return null;
        }

        if (explicitVehicleId is { } explicitId && explicitId > 0)
        {
            foreach (var candidate in array.EnumerateArray())
            {
                if (ReadId(candidate) == explicitId)
                {
                    return From(candidate, explicitId);
                }
            }
        }

        var first = array[0];
        long id = ReadId(first);
        return id > 0 ? From(first, id) : null;
    }

    private static GlanceVehicle From(JsonElement vehicle, long id) => new(
        id,
        ReadString(vehicle, "display_name") ?? string.Empty,
        ReadString(vehicle, "model") ?? string.Empty);

    private static JsonElement? AsArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root;
        }

        // Defensive: tolerate a { "vehicles": [...] } envelope even though the API returns a bare array.
        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("vehicles", out var nested)
            && nested.ValueKind == JsonValueKind.Array)
        {
            return nested;
        }

        return null;
    }

    private static long ReadId(JsonElement vehicle)
    {
        if (vehicle.ValueKind != JsonValueKind.Object || !vehicle.TryGetProperty("id", out var idValue))
        {
            return 0;
        }

        return idValue.ValueKind switch
        {
            JsonValueKind.Number when idValue.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(idValue.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>
/// The vehicle-state slice the glance card reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>useVehicleState</c> payload (<c>state.state</c>, <c>state.battery_level</c>, SI <c>state.rated_range</c>
/// metres, SI <c>state.inside_temp</c> Celsius, <c>state.is_locked</c>, <c>state.is_climate_on</c>). Distances and
/// temperatures stay SI on disk and are converted at the display boundary by <see cref="GlanceProjection"/> via the
/// shared <see cref="UnitFormatters"/>. A <see langword="null"/> parse result models <c>stateData?.state</c> being
/// undefined; individual <see langword="null"/> fields model the web optional reads (so a card shows "—").
/// </summary>
public sealed record GlanceVehicleState(
    string? StateText,
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? InsideTempCelsius,
    bool IsLocked,
    bool IsClimateOn)
{
    /// <summary>The online/parked state strings the web treats as commandable (<c>state === 'online' || 'parked'</c>).</summary>
    public bool IsOnline =>
        string.Equals(StateText, "online", StringComparison.OrdinalIgnoreCase)
        || string.Equals(StateText, "parked", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the glance slice, mirroring the normalisation
    /// in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one carrying
    /// <c>vehicle_id</c>), otherwise a plain <c>state</c> object, otherwise reconstruct from a <c>position</c>
    /// snapshot. Returns <see langword="null"/> when none of those yield a usable state.
    /// </summary>
    public static GlanceVehicleState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web fallback: reconstruct from the position snapshot + the top-level charging/lock flags.
        return new GlanceVehicleState(
            StateText: ReadString(root, "state"),
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") : null,
            RatedRangeMeters: position is { } pos ? ReadDouble(pos, "rated_range") : null,
            InsideTempCelsius: position is { } po ? ReadDouble(po, "inside_temp") : null,
            IsLocked: ReadBool(root, "is_locked"),
            IsClimateOn: ReadBool(root, "is_climate_on"));
    }

    private static GlanceVehicleState FromStateObject(JsonElement state) => new(
        StateText: ReadString(state, "state"),
        BatteryLevel: ReadDouble(state, "battery_level"),
        RatedRangeMeters: ReadDouble(state, "rated_range"),
        InsideTempCelsius: ReadDouble(state, "inside_temp"),
        IsLocked: ReadBool(state, "is_locked"),
        IsClimateOn: ReadBool(state, "is_climate_on"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
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
/// The latest location snapshot the glance card reads from <c>GET /location-snapshots/latest?vehicle_id={id}</c> —
/// the native mirror of the web <c>useLocationSnapshotLatest</c> payload used by <c>getLocationLabel</c>
/// (<c>located_at_home</c> / <c>located_at_work</c> / <c>located_at_favorite</c> / <c>destination_name</c>). A
/// <see langword="null"/> parse result models the web <c>!location</c> branch (the label falls back to "—").
/// </summary>
public sealed record GlanceLocation(bool AtHome, bool AtWork, bool AtFavorite, string? DestinationName)
{
    /// <summary>Parse a location snapshot response; a non-object body yields <see langword="null"/> (web <c>!location</c>).</summary>
    public static GlanceLocation? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new GlanceLocation(
            AtHome: ReadBool(root, "located_at_home"),
            AtWork: ReadBool(root, "located_at_work"),
            AtFavorite: ReadBool(root, "located_at_favorite"),
            DestinationName: ReadString(root, "destination_name"));
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
/// One render-ready metric tile in the glance grid — the native analogue of a web <c>MetricCard</c>
/// (<c>{ label, value, icon, color }</c>). <see cref="Value"/> is already formatted (unit conversion happens in the
/// projection) and <see cref="AccentBrushKey"/> is the semantic design token standing in for the web Tailwind colour.
/// </summary>
/// <param name="Label">Localized label.</param>
/// <param name="Value">Pre-formatted value (or "—").</param>
/// <param name="AccentBrushKey">Semantic accent token key for the card rail.</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon) for the tile.</param>
public sealed record GlanceMetric(string Label, string Value, string AccentBrushKey, string Glyph);

/// <summary>
/// One render-ready quick-action button — the native analogue of the web <c>QuickAction</c> tiles (lock/unlock,
/// climate, horn). <see cref="Command"/> is the exact wire string POSTed to <c>/vehicles/{id}/command</c>;
/// <see cref="Disabled"/> mirrors the web <c>!canSendCommands</c> gate and <see cref="IsLoading"/> the per-tile
/// pending spinner (web <c>sendCommand.isPending &amp;&amp; variables.command === …</c>).
/// </summary>
/// <param name="Id">Stable button id.</param>
/// <param name="Command">The wire command string POSTed when tapped.</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="Label">Localized label / Narrator name.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the glyph tint.</param>
/// <param name="Disabled">True when commands cannot be sent (offline or another command in flight).</param>
/// <param name="IsLoading">True while this command is in flight (the tile shows a spinner).</param>
public sealed record GlanceQuickAction(
    string Id,
    string Command,
    string Glyph,
    string Label,
    string AccentBrushKey,
    bool Disabled,
    bool IsLoading);

/// <summary>
/// The immutable inputs <see cref="GlanceProjection"/> reads — the resolved vehicle, its state and location
/// snapshots, the load / failure flags derived from the vehicles read, the user's unit preference, and the local
/// command UI state (the in-flight command wire string + pending flag). Pure data so the whole projection is
/// unit-tested headless.
/// </summary>
public sealed record GlanceModel(
    GlanceVehicle? Vehicle,
    GlanceVehicleState? State,
    GlanceLocation? Location,
    bool Loading,
    bool LoadFailed,
    UnitPref Units,
    string? ActiveCommand,
    bool CommandPending);

/// <summary>
/// The render-ready projection the <c>GlancePage</c> view binds to. Every visible literal is resolved here through
/// the <see cref="ILocalizer"/> (web key names preserved verbatim) so the view stays a thin renderer with zero
/// hardcoded text, and every SI value is converted to the display unit through <see cref="UnitFormatters"/>. The
/// boolean flags drive per-region content (the status badge, the battery gauge tint, the four metric cards and the
/// three quick actions).
/// </summary>
public sealed record GlanceDisplay(
    GlanceState State,
    string Title,
    string NoVehicleMessage,
    string VehicleName,
    string StatusText,
    StatusKind StatusKind,
    bool IsOnline,
    double BatteryValue,
    double BatteryMax,
    string BatteryUnit,
    string BatteryValueText,
    string BatteryLabel,
    StatusKind BatteryStatus,
    bool HasBatteryReading,
    GlanceMetric Range,
    GlanceMetric Interior,
    GlanceMetric Security,
    GlanceMetric Location,
    IReadOnlyList<GlanceQuickAction> QuickActions,
    string OpenAppLabel,
    string GaugeAutomationName);

/// <summary>
/// Projects a <see cref="GlanceModel"/> into the render-ready <see cref="GlanceDisplay"/>. This is the single place
/// the web page's branch selection, unit conversion and i18n live: it derives the four-state matrix
/// (loading / error / empty / success), resolves all 20 manifest strings through the localizer with the web English
/// defaults, formats the range and interior temperature at the SI display boundary, derives the battery threshold
/// colour (web <c>batteryColor</c>) and builds the four metric cards and three quick actions. UI-free so it is
/// unit-tested without a XAML runtime.
/// </summary>
public static class GlanceProjection
{
    // Segoe Fluent Icons code points (web Lucide icon -> nearest platform glyph).
    private const string BatteryGlyph = "\uE83F";      // Battery (web Battery)
    private const string TemperatureGlyph = "\uE9CA";  // Temperature (web Thermometer)
    private const string LockGlyph = "\uE72E";         // Lock (web Lock)
    private const string UnlockGlyph = "\uE785";       // Unlock (web Unlock)
    private const string LocationGlyph = "\uE707";     // Map pin (web MapPin)
    private const string ClimateGlyph = "\uE9CA";      // Climate (web Wind)
    private const string HornGlyph = "\uE767";         // Volume (web Volume2)

    // Semantic accent tokens (web Tailwind colour -> nearest design token).
    private const string SuccessKey = "TsColorSuccessBrush"; // web green
    private const string WarningKey = "TsColorWarningBrush"; // web amber
    private const string DangerKey = "TsColorDangerBrush";   // web red
    private const string InfoKey = "TsColorInfoBrush";       // web cyan

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double BatteryMax = 100;

    /// <summary>Above this state-of-charge the battery gauge is healthy/green (web <c>batteryColor</c> &gt; 50).</summary>
    public const double HealthyThresholdPercent = 50;

    /// <summary>Above this state-of-charge the battery gauge is a warning/amber (web <c>batteryColor</c> &gt; 20).</summary>
    public const double WarningThresholdPercent = 20;

    /// <summary>Map a state-of-charge to the semantic battery colour (web <c>batteryColor</c>).</summary>
    public static StatusKind BatteryStatusFor(double batteryLevel)
    {
        if (batteryLevel > HealthyThresholdPercent)
        {
            return StatusKind.Success;
        }

        return batteryLevel > WarningThresholdPercent ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static GlanceDisplay Project(GlanceModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = model.LoadFailed
            ? GlanceState.Error
            : model.Loading
                ? GlanceState.Loading
                : model.Vehicle is null
                    ? GlanceState.Empty
                    : GlanceState.Success;

        // Resolve every literal unconditionally (both branches of each web ternary) so the projection references
        // all 20 manifest keys on every run, then select which copy the current branch renders.
        var title = localizer.GetString("glance.title", "Quick Glance");
        var noVehicle = localizer.GetString("glance.noVehicle", "No vehicle found");
        var defaultName = localizer.GetString("glance.defaultName", "Tesla");
        var unknown = localizer.GetString("glance.unknown", "Unknown");
        var batteryLabel = localizer.GetString("glance.battery", "Battery");
        var rangeLabel = localizer.GetString("glance.range", "Range");
        var interiorLabel = localizer.GetString("glance.temp", "Interior");
        var securityLabel = localizer.GetString("glance.security", "Security");
        var locationLabel = localizer.GetString("glance.locationLabel", "Location");
        var lockedText = localizer.GetString("glance.locked", "Locked");
        var unlockedText = localizer.GetString("glance.unlocked", "Unlocked");
        var homeText = localizer.GetString("glance.location.home", "Home");
        var workText = localizer.GetString("glance.location.work", "Work");
        var favoriteText = localizer.GetString("glance.location.favorite", "Saved");
        var lockAction = localizer.GetString("glance.action.lock", "Lock");
        var unlockAction = localizer.GetString("glance.action.unlock", "Unlock");
        var climateOnAction = localizer.GetString("glance.action.climateOn", "Climate On");
        var climateOffAction = localizer.GetString("glance.action.climateOff", "Climate Off");
        var hornAction = localizer.GetString("glance.action.horn", "Horn");
        var openApp = localizer.GetString("glance.openApp", "Open full app →");

        var vehicle = model.Vehicle;
        var vehicleState = model.State;

        var vehicleName = FirstNonEmpty(vehicle?.DisplayName, vehicle?.Model) ?? defaultName;
        var statusText = string.IsNullOrEmpty(vehicleState?.StateText) ? unknown : vehicleState!.StateText!;
        var isOnline = vehicleState?.IsOnline ?? false;

        double? level = vehicleState?.BatteryLevel;
        double clamped = level is { } l ? Math.Clamp(SafeNumber(l), 0, BatteryMax) : 0;
        var batteryStatus = level is { } lv ? BatteryStatusFor(Math.Clamp(SafeNumber(lv), 0, BatteryMax)) : StatusKind.Neutral;
        var batteryText = FormatGaugeValue(clamped);

        var rangeValue = vehicleState?.RatedRangeMeters is { } meters
            ? UnitFormatters.FormatDistance(meters, model.Units, precision: 0)
            : UnitFormatters.DefaultEmptyDisplay;
        var interiorValue = vehicleState?.InsideTempCelsius is { } celsius
            ? UnitFormatters.FormatTemperature(celsius, model.Units, precision: 1)
            : UnitFormatters.DefaultEmptyDisplay;

        var isLocked = vehicleState?.IsLocked ?? false;
        var securityValue = isLocked ? lockedText : unlockedText;
        var securityAccent = isLocked ? SuccessKey : DangerKey;
        var securityGlyph = isLocked ? LockGlyph : UnlockGlyph;

        var range = new GlanceMetric(rangeLabel, rangeValue, SuccessKey, BatteryGlyph);
        var interior = new GlanceMetric(interiorLabel, interiorValue, WarningKey, TemperatureGlyph);
        var security = new GlanceMetric(securityLabel, securityValue, securityAccent, securityGlyph);
        var location = new GlanceMetric(
            locationLabel,
            LocationLabel(model.Location, homeText, workText, favoriteText),
            InfoKey,
            LocationGlyph);

        var canSend = isOnline && !model.CommandPending;
        var isClimateOn = vehicleState?.IsClimateOn ?? false;
        var lockCommand = isLocked ? "unlock" : "lock";
        var climateCommand = isClimateOn ? "climate_off" : "climate_on";

        var quickActions = new[]
        {
            new GlanceQuickAction(
                Id: "lock",
                Command: lockCommand,
                Glyph: isLocked ? UnlockGlyph : LockGlyph,
                Label: isLocked ? unlockAction : lockAction,
                AccentBrushKey: InfoKey,
                Disabled: !canSend,
                IsLoading: model.CommandPending && IsLockCommand(model.ActiveCommand)),
            new GlanceQuickAction(
                Id: "climate",
                Command: climateCommand,
                Glyph: ClimateGlyph,
                Label: isClimateOn ? climateOffAction : climateOnAction,
                AccentBrushKey: InfoKey,
                Disabled: !canSend,
                IsLoading: model.CommandPending && IsClimateCommand(model.ActiveCommand)),
            new GlanceQuickAction(
                Id: "horn",
                Command: "honk_horn",
                Glyph: HornGlyph,
                Label: hornAction,
                AccentBrushKey: WarningKey,
                Disabled: !canSend,
                IsLoading: model.CommandPending && string.Equals(model.ActiveCommand, "honk_horn", StringComparison.Ordinal)),
        };

        return new GlanceDisplay(
            State: state,
            Title: title,
            NoVehicleMessage: noVehicle,
            VehicleName: vehicleName,
            StatusText: statusText,
            StatusKind: isOnline ? StatusKind.Success : StatusKind.Neutral,
            IsOnline: isOnline,
            BatteryValue: clamped,
            BatteryMax: BatteryMax,
            BatteryUnit: "%",
            BatteryValueText: batteryText,
            BatteryLabel: batteryLabel,
            BatteryStatus: batteryStatus,
            HasBatteryReading: level is not null,
            Range: range,
            Interior: interior,
            Security: security,
            Location: location,
            QuickActions: quickActions,
            OpenAppLabel: openApp,
            GaugeAutomationName: $"{batteryLabel} {batteryText}%");
    }

    /// <summary>Resolve the location label exactly as the web <c>getLocationLabel</c> (home / work / saved / destination / —).</summary>
    public static string LocationLabel(GlanceLocation? location, string home, string work, string favorite)
    {
        if (location is null)
        {
            return UnitFormatters.DefaultEmptyDisplay;
        }

        if (location.AtHome)
        {
            return home;
        }

        if (location.AtWork)
        {
            return work;
        }

        if (location.AtFavorite)
        {
            return favorite;
        }

        return string.IsNullOrEmpty(location.DestinationName) ? UnitFormatters.DefaultEmptyDisplay : location.DestinationName!;
    }

    /// <summary>Format the gauge value exactly as the web <c>RadialGauge</c> (integers with no fraction digits, else 2).</summary>
    public static string FormatGaugeValue(double value)
    {
        double safe = SafeNumber(value);
        int decimals = safe == Math.Floor(safe) ? 0 : 2;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }

    private static bool IsLockCommand(string? command) =>
        string.Equals(command, "lock", StringComparison.Ordinal) || string.Equals(command, "unlock", StringComparison.Ordinal);

    private static bool IsClimateCommand(string? command) =>
        string.Equals(command, "climate_on", StringComparison.Ordinal) || string.Equals(command, "climate_off", StringComparison.Ordinal);

    private static string? FirstNonEmpty(string? first, string? second)
    {
        if (!string.IsNullOrWhiteSpace(first))
        {
            return first;
        }

        return string.IsNullOrWhiteSpace(second) ? null : second;
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Canonical metadata for the <c>GlancePage</c> feature surface — the native mirror of the web page at
/// web/src/features/dashboard/pages/GlancePage.tsx (route <c>/glance</c>, nav name <c>Glance</c>). The page title
/// resolves here so the registration and the projection share one key.
/// </summary>
public static class GlanceRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GlancePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Glance</c>, path <c>glance</c>).</summary>
    public const string RouteName = "Glance";

    /// <summary>The localized page title (web <c>glance.title</c> = "Quick Glance").</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("glance.title", "Quick Glance");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>GlancePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, VIN, battery level, location or
/// command — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class GlanceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GlanceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GlancePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GlanceRegistration.Slug}");
    }
}
