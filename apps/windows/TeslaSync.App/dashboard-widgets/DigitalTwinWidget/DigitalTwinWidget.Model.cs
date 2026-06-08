using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DigitalTwinViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DigitalTwinWidget</c> renders
/// (web/src/features/dashboard/widgets/DigitalTwinWidget.tsx via <c>WidgetShell</c>). Every branch maps onto a
/// visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{vehicle ? … : &lt;EmptyState&gt;}</c>
/// gate — the "No vehicle data" surface shown when no vehicle resolves; the twin itself always renders once a
/// vehicle is known (the security / state / charging reads only fill it in or tint the freshness chip).
/// </summary>
public enum DigitalTwinState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A vehicle resolved and a fresh (or non-stale cache) twin is rendered.</summary>
    Loaded,

    /// <summary>No vehicle resolved — render the "No vehicle data" empty surface (web <c>!vehicle</c>).</summary>
    Empty,

    /// <summary>Every read failed hard with nothing to show — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the twin plus a stale chip.</summary>
    Stale,

    /// <summary>The primary read failed but a twin is still renderable — render the twin plus an error/offline chip.</summary>
    Offline,
}

/// <summary>
/// The identity fields the digital-twin caption and paint read from the resolved vehicle — the native mirror of
/// the web component's <c>vehicle.display_name</c> / <c>vehicle.vin</c> / <c>vehicle.exterior_color</c>. Sourced
/// from the shared <c>IWidgetVehicleSource</c> snapshot (never from the three live reads), so the caption renders
/// the instant the vehicle is known.
/// </summary>
/// <param name="DisplayName">The vehicle display name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle VIN, used as the caption fallback (web <c>vin</c>).</param>
/// <param name="ExteriorColor">The Tesla <c>exterior_color</c> code used to infer the twin paint, or null.</param>
public readonly record struct DigitalTwinIdentity(string DisplayName, string? Vin, string? ExteriorColor);

/// <summary>
/// The tri-state door slice parsed from a Tesla <c>DoorState</c> signal (port of the web <c>parseDoorState</c>
/// in web/src/lib/vehicleState.ts). Each side door is true (open) / false (closed) / null (unknown); the front
/// and rear lids feed the frunk / trunk indicators.
/// </summary>
/// <param name="DriverFront">Driver-front door open.</param>
/// <param name="PassengerFront">Passenger-front door open.</param>
/// <param name="DriverRear">Driver-rear door open.</param>
/// <param name="PassengerRear">Passenger-rear door open.</param>
/// <param name="TrunkFront">Front trunk (frunk) open.</param>
/// <param name="TrunkRear">Rear trunk open.</param>
public readonly record struct TwinDoorStates(
    bool? DriverFront,
    bool? PassengerFront,
    bool? DriverRear,
    bool? PassengerRear,
    bool? TrunkFront,
    bool? TrunkRear);

/// <summary>
/// Pure, headless port of the Tesla signal parsers + <c>buildTwinState</c> merge in
/// web/src/lib/vehicleState.ts. Every method reads the wire payload exactly as the web does (tolerating
/// string / bool / number / object / null shapes) so the native twin reproduces the web's observable state.
/// </summary>
public static class DigitalTwinSignals
{
    private static readonly string[] WindowFrontDriverAliases = { "fd", "front driver", "driver front", "driver_front" };
    private static readonly string[] WindowFrontPassengerAliases = { "fp", "front passenger", "passenger front", "passenger_front" };
    private static readonly string[] WindowRearDriverAliases = { "rd", "rear driver", "driver rear", "driver_rear" };
    private static readonly string[] WindowRearPassengerAliases = { "rp", "rear passenger", "passenger rear", "passenger_rear" };

    /// <summary>
    /// Parse the compound <c>DoorState</c> signal (object payload, "all closed" shorthand, JSON-string, or
    /// descriptive string) into the tri-state door slice. Mirrors the web <c>parseDoorState</c>; an unknown
    /// field stays null rather than defaulting to closed.
    /// </summary>
    public static TwinDoorStates ParseDoorState(JsonElement? doorState)
    {
        if (doorState is { ValueKind: JsonValueKind.Object } obj)
        {
            return FromDoorObject(obj);
        }

        string? raw = AsNonEmptyString(doorState)?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return new TwinDoorStates(null, null, null, null, null, null);
        }

        if (IsAllClosedShorthand(raw))
        {
            return new TwinDoorStates(false, false, false, false, null, null);
        }

        if (raw.StartsWith('{'))
        {
            try
            {
                using var doc = JsonDocument.Parse(raw);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    return FromDoorObject(doc.RootElement);
                }
            }
            catch (JsonException)
            {
                // Fall through to descriptive string matching.
            }
        }

        return FromDoorDescription(raw);
    }

    /// <summary>
    /// Normalise a Tesla window enum / summary value to a position, or null when it cannot be determined
    /// (port of the web <c>parseWindowState</c> normalisation + heuristics).
    /// </summary>
    public static WindowPosition? ParseWindow(JsonElement? value)
    {
        string? raw = AsNonEmptyString(value);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        if (Contains(raw, "closed") || string.Equals(raw, "0", StringComparison.Ordinal))
        {
            return WindowPosition.Closed;
        }

        if (Contains(raw, "partial") || Contains(raw, "vent"))
        {
            return WindowPosition.Partial;
        }

        if (Contains(raw, "open"))
        {
            return WindowPosition.Open;
        }

        return null;
    }

    /// <summary>
    /// Derive a single window's position from the compound <c>windows_open</c> summary using the position
    /// aliases (port of the web <c>parseWindowOpenSummary</c>). Returns null when the summary is absent.
    /// </summary>
    public static WindowPosition? ParseWindowSummary(JsonElement? windowsOpen, IReadOnlyList<string> aliases)
    {
        ArgumentNullException.ThrowIfNull(aliases);
        string? raw = AsNonEmptyString(windowsOpen);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        if (EqualsTrimmed(raw, "closed") || EqualsTrimmed(raw, "none") || EqualsTrimmed(raw, "[]") || EqualsTrimmed(raw, "false"))
        {
            return WindowPosition.Closed;
        }

        foreach (var alias in aliases)
        {
            if (Contains(raw, alias))
            {
                return WindowPosition.Open;
            }
        }

        return null;
    }

    /// <summary>Resolve one window from its dedicated field, falling back to the summary, else unknown.</summary>
    public static WindowPosition ResolveWindow(JsonElement? field, JsonElement? windowsOpen, IReadOnlyList<string> aliases) =>
        ParseWindow(field) ?? ParseWindowSummary(windowsOpen, aliases) ?? WindowPosition.Unknown;

    /// <summary>Parse the turn-signal signal into a state (port of the web <c>parseTurnSignal</c>).</summary>
    public static TurnSignal ParseTurnSignal(JsonElement? value)
    {
        string? raw = AsNonEmptyString(value);
        if (string.IsNullOrEmpty(raw))
        {
            return TurnSignal.Unknown;
        }

        if (Contains(raw, "both"))
        {
            return TurnSignal.Both;
        }

        if (Contains(raw, "left"))
        {
            return TurnSignal.Left;
        }

        if (Contains(raw, "right"))
        {
            return TurnSignal.Right;
        }

        if (Contains(raw, "off"))
        {
            return TurnSignal.Off;
        }

        return TurnSignal.Unknown;
    }

    /// <summary>
    /// True when the vehicle is actively driving (port of the web <c>isVehicleDriving</c>): the state string is
    /// "driving" or the reported speed is positive.
    /// </summary>
    public static bool IsDriving(JsonElement? state)
    {
        if (state is not { } s)
        {
            return false;
        }

        if (EqualsTrimmed(AsNonEmptyString(GetProp(s, "state")), "driving"))
        {
            return true;
        }

        return (ReadDouble(s, "speed") ?? 0) > 0;
    }

    /// <summary>
    /// True when charging is active (port of the web <c>isChargingActive</c>): the state flag, a positive
    /// charger power from the state read, a positive charger power from the telemetry read, or a
    /// charging / starting telemetry state.
    /// </summary>
    public static bool IsChargingActive(JsonElement? state, JsonElement? charging)
    {
        bool stateCharging = (ReadBool(state, "is_charging") ?? false) || (ReadDouble(state, "charger_power") ?? 0) > 0;
        if (stateCharging)
        {
            return true;
        }

        if ((ReadDouble(charging, "charger_power_kw") ?? 0) > 0)
        {
            return true;
        }

        string normalized = NormalizeChargeState(AsNonEmptyString(GetProp(charging, "charging_state")));
        return string.Equals(normalized, "CHARGING", StringComparison.Ordinal) ||
            string.Equals(normalized, "STARTING", StringComparison.Ordinal);
    }

    /// <summary>
    /// Merge the security, vehicle-state and charging reads into the combined twin model (port of the web
    /// <c>buildTwinState</c>), carrying the caption identity and the hazards flag the badge cluster needs.
    /// </summary>
    public static DigitalTwinReading Merge(
        DigitalTwinIdentity identity,
        JsonElement? state,
        JsonElement? security,
        JsonElement? charging)
    {
        JsonElement? vehicleState = ExtractState(state);
        var doors = ParseDoorState(GetProp(security, "door_state") ?? GetProp(security, "doors_open"));
        bool chargingActive = IsChargingActive(vehicleState, charging);
        JsonElement? windowsOpen = GetProp(security, "windows_open");

        var model = new VehicleTwinModel
        {
            DoorDriverFront = doors.DriverFront,
            DoorPassengerFront = doors.PassengerFront,
            DoorDriverRear = doors.DriverRear,
            DoorPassengerRear = doors.PassengerRear,
            WindowDriverFront = ResolveWindow(GetProp(security, "fd_window"), windowsOpen, WindowFrontDriverAliases),
            WindowPassengerFront = ResolveWindow(GetProp(security, "fp_window"), windowsOpen, WindowFrontPassengerAliases),
            WindowDriverRear = ResolveWindow(GetProp(security, "rd_window"), windowsOpen, WindowRearDriverAliases),
            WindowPassengerRear = ResolveWindow(GetProp(security, "rp_window"), windowsOpen, WindowRearPassengerAliases),
            FrunkOpen = doors.TrunkFront,
            TrunkOpen = doors.TrunkRear,
            ChargePortOpen = ReadBool(charging, "charge_port_door_open") ?? (chargingActive ? true : null),
            IsCharging = chargingActive,
            IsDriving = IsDriving(vehicleState),
            Locked = ReadBool(security, "locked") ?? ReadBool(vehicleState, "is_locked"),
            SentryMode = ReadBool(security, "sentry_mode") ?? ReadBool(vehicleState, "sentry_mode"),
            Headlights = ReadBool(security, "lights_high_beams"),
            TurnSignal = ParseTurnSignal(GetProp(security, "lights_turn_signal")),
            ExteriorColor = identity.ExteriorColor,
        };

        bool? hazards = ReadBool(security, "lights_hazards_active");
        return new DigitalTwinReading(model, hazards, ResolveCaption(identity));
    }

    /// <summary>
    /// Unwrap the inner <c>VehicleState</c> object from a raw <c>GET /vehicles/{vehicleID}/state</c> response,
    /// mirroring the web <c>useVehicleState</c> normalisation: the canonical response nests the state under
    /// <c>res.state</c>; a body whose fields already sit at the top level is used as-is.
    /// </summary>
    public static JsonElement? ExtractState(JsonElement? raw) =>
        GetProp(raw, "state") is { ValueKind: JsonValueKind.Object } inner ? inner : raw;

    /// <summary>The caption text — display name, else VIN, else empty (web <c>display_name || vin</c>).</summary>
    public static string ResolveCaption(DigitalTwinIdentity identity) =>
        !string.IsNullOrWhiteSpace(identity.DisplayName)
            ? identity.DisplayName
            : identity.Vin ?? string.Empty;

    internal static JsonElement? GetProp(JsonElement? parent, string name) =>
        parent is { ValueKind: JsonValueKind.Object } obj && obj.TryGetProperty(name, out var value)
            ? value
            : null;

    private static TwinDoorStates FromDoorObject(JsonElement obj) => new(
        DriverFront: ReadDoorFlag(obj, "DriverFront", "driver_front"),
        PassengerFront: ReadDoorFlag(obj, "PassengerFront", "passenger_front"),
        DriverRear: ReadDoorFlag(obj, "DriverRear", "driver_rear"),
        PassengerRear: ReadDoorFlag(obj, "PassengerRear", "passenger_rear"),
        TrunkFront: ReadDoorFlag(obj, "TrunkFront", "trunk_front"),
        TrunkRear: ReadDoorFlag(obj, "TrunkRear", "trunk_rear"));

    private static TwinDoorStates FromDoorDescription(string raw) => new(
        DriverFront: Contains(raw, "driver") && Contains(raw, "front") ? true : null,
        PassengerFront: Contains(raw, "passenger") && Contains(raw, "front") ? true : null,
        DriverRear: (Contains(raw, "driver") && Contains(raw, "rear")) || Contains(raw, "driverrear") ? true : null,
        PassengerRear: (Contains(raw, "passenger") && Contains(raw, "rear")) || Contains(raw, "passengerrear") ? true : null,
        TrunkFront: Contains(raw, "frunk") || Contains(raw, "fronttrunk") || Contains(raw, "front_trunk") ||
            Contains(raw, "trunkfront") || Contains(raw, "trunk_front") ? true : null,
        TrunkRear: Contains(raw, "reartrunk") || Contains(raw, "rear_trunk") || Contains(raw, "trunkrear") ||
            Contains(raw, "trunk_rear") || Contains(raw, "liftgate") ||
            (Contains(raw, "trunk") && !Contains(raw, "frunk") && !Contains(raw, "front")) ? true : null);

    private static bool IsAllClosedShorthand(string raw) =>
        EqualsTrimmed(raw, "closedall") || EqualsTrimmed(raw, "closed") || EqualsTrimmed(raw, "none") ||
        EqualsTrimmed(raw, "[]") || EqualsTrimmed(raw, "0") || EqualsTrimmed(raw, "false");

    private static bool? ReadDoorFlag(JsonElement obj, string pascal, string snake)
    {
        if (obj.TryGetProperty(pascal, out var p) && p.ValueKind != JsonValueKind.Null)
        {
            return Truthy(p);
        }

        if (obj.TryGetProperty(snake, out var s) && s.ValueKind != JsonValueKind.Null)
        {
            return Truthy(s);
        }

        return null;
    }

    private static bool Truthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => value.TryGetDouble(out var n) && n != 0,
        JsonValueKind.String => !string.IsNullOrEmpty(value.GetString()),
        _ => false,
    };

    private static string NormalizeChargeState(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(value.Length);
        foreach (char c in value)
        {
            if (c is ' ' or '\t' or '_' or '-')
            {
                continue;
            }

            sb.Append(char.ToUpperInvariant(c));
        }

        return sb.ToString();
    }

    private static string? AsNonEmptyString(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.String } v)
        {
            return null;
        }

        string? s = v.GetString();
        return string.IsNullOrWhiteSpace(s) ? null : s;
    }

    private static bool? ReadBool(JsonElement? parent, string name)
    {
        if (GetProp(parent, name) is not { } v)
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => v.TryGetDouble(out var n) ? n != 0 : null,
            _ => null,
        };
    }

    private static double? ReadDouble(JsonElement? parent, string name)
    {
        if (GetProp(parent, name) is not { } v)
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

    private static bool Contains(string haystack, string needle) =>
        haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

    private static bool EqualsTrimmed(string? value, string other) =>
        value is not null && string.Equals(value.Trim(), other, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// The merged, render-ready twin slice for one resolved vehicle — the native analogue of the web
/// <c>twinState</c> plus the caption identity. The <see cref="Model"/> drives the <c>TsVehicleTwin</c> visual;
/// <see cref="Hazards"/> backs the hazards chip (the native <c>VehicleTwinModel</c> carries no hazards field).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Model">The combined digital-twin model bound to <c>TsVehicleTwin</c>.</param>
/// <param name="Hazards">Whether the hazard lights are active (web <c>twinState.hazards</c>), or null.</param>
/// <param name="Caption">The caption line (web <c>display_name || vin</c>).</param>
public sealed record DigitalTwinReading(VehicleTwinModel Model, bool? Hazards, string Caption);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>DigitalTwinWidget</c> only widens the twin glyph past 3 columns / 5 rows; the badge cluster and caption are
/// identical at every footprint, so this carries the registry min/max constraints plus the twin-size threshold.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct DigitalTwinSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static DigitalTwinSize Default => new(2, 4);

    /// <summary>True when the twin should render at its larger glyph size (web <c>cols &gt;= 3 || rows &gt;= 5</c>).</summary>
    public bool IsLargeTwin => Cols >= 3 || Rows >= 5;
}

/// <summary>One projected status chip in the twin badge cluster (the native analogue of a web <c>&lt;Badge&gt;</c>).</summary>
/// <param name="Kind">Stable identifier for the chip (e.g. <c>lock</c>, <c>windows</c>, <c>driving</c>).</param>
/// <param name="Variant">The semantic colour (web <c>variant</c>).</param>
/// <param name="Dot">Whether a leading status dot is shown (web <c>dot</c>).</param>
/// <param name="Glyph">An optional leading Segoe Fluent glyph (web lucide icon), or null.</param>
/// <param name="Text">The localized chip label.</param>
public sealed record DigitalTwinBadge(string Kind, StatusKind Variant, bool Dot, string? Glyph, string Text);

/// <summary>
/// The fully projected, render-ready view of the digital-twin surface — the native analogue of everything the
/// web component computes before returning JSX (the badge cluster, the caption, the Narrator summary). Pure data
/// so it is unit-tested without a UI host.
/// </summary>
/// <param name="Model">The twin model bound to <c>TsVehicleTwin</c>.</param>
/// <param name="LargeTwin">Whether the twin renders at its larger glyph size.</param>
/// <param name="Caption">The caption line (web <c>display_name || vin</c>).</param>
/// <param name="Badges">The ordered, active status chips (web conditional <c>&lt;Badge&gt;</c> cluster).</param>
/// <param name="AutomationName">The Narrator summary naming the vehicle and every active chip.</param>
public sealed record DigitalTwinDisplay(
    VehicleTwinModel Model,
    bool LargeTwin,
    string Caption,
    IReadOnlyList<DigitalTwinBadge> Badges,
    string AutomationName);

/// <summary>
/// Pure projection from a merged <see cref="DigitalTwinReading"/> to the render-ready display model — the native
/// port of the web component's inline badge logic in web/src/features/dashboard/widgets/DigitalTwinWidget.tsx.
/// The lock and windows chips always render; the driving / charging / sentry / lights / hazards / doors / frunk /
/// trunk chips render only when their state is reported active, matching the web conditional cluster exactly.
/// Every label resolves through the i18n facade.
/// </summary>
public static class DigitalTwinProjection
{
    /// <summary>Segoe Fluent "Lock" glyph — the web <c>Lock</c> icon (locked / unknown lock chip).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Unlock" glyph — the web <c>Unlock</c> icon (unlocked lock chip).</summary>
    public const string UnlockGlyph = "\uE785";

    /// <summary>Segoe Fluent "TVMonitor" glyph — the web <c>Monitor</c> icon (header + empty surface).</summary>
    public const string MonitorGlyph = "\uE7F4";

    /// <summary>Project <paramref name="reading"/> for the badge cluster + caption using the localizer for every label.</summary>
    public static DigitalTwinDisplay Project(DigitalTwinReading reading, DigitalTwinSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var model = reading.Model;
        var badges = new List<DigitalTwinBadge>(10) { LockBadge(model.Locked, localizer), WindowsBadge(model, localizer) };

        if (model.IsDriving)
        {
            badges.Add(new DigitalTwinBadge("driving", StatusKind.Info, true, null, localizer.GetString("widget.driving", "Driving")));
        }

        if (model.IsCharging)
        {
            badges.Add(new DigitalTwinBadge("charging", StatusKind.Info, true, null, localizer.GetString("widget.charging", "Charging")));
        }

        if (model.SentryMode == true)
        {
            badges.Add(new DigitalTwinBadge("sentry", StatusKind.Warning, true, null, localizer.GetString("widget.sentryOn", "Sentry")));
        }

        if (model.Headlights == true)
        {
            badges.Add(new DigitalTwinBadge("headlights", StatusKind.Neutral, true, null, localizer.GetString("widget.headlightsOn", "Lights On")));
        }

        if (reading.Hazards == true)
        {
            badges.Add(new DigitalTwinBadge("hazards", StatusKind.Warning, true, null, localizer.GetString("widget.hazardsOn", "Hazards")));
        }

        int openDoorCount = OpenDoorCount(model);
        if (openDoorCount > 0)
        {
            string label = string.Create(CultureInfo.CurrentCulture, $"{openDoorCount} {localizer.GetString("widget.doorsOpen", "Doors Open")}");
            badges.Add(new DigitalTwinBadge("doors", StatusKind.Warning, false, null, label));
        }

        if (model.FrunkOpen == true)
        {
            badges.Add(new DigitalTwinBadge("frunk", StatusKind.Warning, false, null, localizer.GetString("widget.frunkOpen", "Frunk Open")));
        }

        if (model.TrunkOpen == true)
        {
            badges.Add(new DigitalTwinBadge("trunk", StatusKind.Warning, false, null, localizer.GetString("widget.trunkOpen", "Trunk Open")));
        }

        return new DigitalTwinDisplay(model, size.IsLargeTwin, reading.Caption, badges, BuildAutomationName(reading.Caption, badges));
    }

    /// <summary>The number of side doors reported open (web <c>openDoorCount</c>).</summary>
    public static int OpenDoorCount(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        int count = 0;
        if (model.DoorDriverFront == true)
        {
            count++;
        }

        if (model.DoorPassengerFront == true)
        {
            count++;
        }

        if (model.DoorDriverRear == true)
        {
            count++;
        }

        if (model.DoorPassengerRear == true)
        {
            count++;
        }

        return count;
    }

    /// <summary>True when at least one window position is reported (web <c>hasWindowData</c>).</summary>
    public static bool HasWindowData(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return model.WindowDriverFront != WindowPosition.Unknown ||
            model.WindowPassengerFront != WindowPosition.Unknown ||
            model.WindowDriverRear != WindowPosition.Unknown ||
            model.WindowPassengerRear != WindowPosition.Unknown;
    }

    /// <summary>The number of windows reported open or partially open (web <c>openWindowCount</c>).</summary>
    public static int OpenWindowCount(VehicleTwinModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        return CountOpen(model.WindowDriverFront) + CountOpen(model.WindowPassengerFront) +
            CountOpen(model.WindowDriverRear) + CountOpen(model.WindowPassengerRear);
    }

    private static int CountOpen(WindowPosition position) =>
        position is not WindowPosition.Unknown and not WindowPosition.Closed ? 1 : 0;

    private static DigitalTwinBadge LockBadge(bool? locked, ILocalizer localizer)
    {
        StatusKind variant = locked is null ? StatusKind.Neutral : locked.Value ? StatusKind.Success : StatusKind.Danger;
        string label = locked is null
            ? localizer.GetString("widget.lockUnknown", "Lock Unknown")
            : locked.Value
                ? localizer.GetString("widget.locked", "Locked")
                : localizer.GetString("widget.unlocked", "Unlocked");
        string glyph = locked == false ? UnlockGlyph : LockGlyph;
        return new DigitalTwinBadge("lock", variant, false, glyph, label);
    }

    private static DigitalTwinBadge WindowsBadge(VehicleTwinModel model, ILocalizer localizer)
    {
        bool hasData = HasWindowData(model);
        int openCount = OpenWindowCount(model);
        StatusKind variant = !hasData ? StatusKind.Neutral : openCount == 0 ? StatusKind.Success : StatusKind.Warning;
        string label = !hasData
            ? localizer.GetString("widget.windowsUnknown", "Windows Unknown")
            : openCount == 0
                ? localizer.GetString("widget.windowsClosed", "Windows Closed")
                : string.Create(CultureInfo.CurrentCulture, $"{openCount} {localizer.GetString("widget.windowsOpen", "Open")}");
        return new DigitalTwinBadge("windows", variant, false, null, label);
    }

    private static string BuildAutomationName(string caption, IReadOnlyList<DigitalTwinBadge> badges)
    {
        string chips = string.Join(", ", badges.Select(b => b.Text));
        return string.IsNullOrWhiteSpace(caption) ? chips : $"{caption}: {chips}";
    }
}

/// <summary>
/// Combines the three cache-then-network reads (vehicle state, security latest, charging telemetry latest) into a
/// single <see cref="RepositoryResult{T}"/> over the merged <see cref="DigitalTwinReading"/>, preserving the
/// freshness contract. A vehicle is always known by the time this runs (the source resolved it), so a twin is
/// always renderable; the read statuses only decide whether the freshness chip reads fresh / stale / error, or —
/// when every read failed hard with nothing to show — collapse to a retry surface. Kept pure so the
/// combine contract is unit-tested without a network or cache.
/// </summary>
public static class DigitalTwinResultMapper
{
    /// <summary>
    /// Fold the resolved state / security reads (and the optionally-still-loading charging read) into one combined
    /// emission. <paramref name="charging"/> being null models its query still loading (web parity: charging never
    /// gates the twin), contributing nothing to the merge yet.
    /// </summary>
    public static RepositoryResult<DigitalTwinReading> Combine(
        DigitalTwinIdentity identity,
        RepositoryResult<JsonElement> state,
        RepositoryResult<JsonElement> security,
        RepositoryResult<JsonElement>? charging)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(security);

        var reading = DigitalTwinSignals.Merge(identity, state.Value, security.Value, charging?.Value);

        bool offline = state.Status == LoadStatus.Offline || security.Status == LoadStatus.Offline ||
            charging?.Status == LoadStatus.Offline;
        bool errored = state.Status == LoadStatus.Error || security.Status == LoadStatus.Error ||
            charging?.Status == LoadStatus.Error;
        bool stale = state.IsStale || security.IsStale || (charging?.IsStale ?? false);
        DateTimeOffset? updatedAt = Latest(state.FetchedAt, security.FetchedAt, charging?.FetchedAt);
        RepositoryError? error = state.Error ?? security.Error ?? charging?.Error;

        // Every read failed hard with nothing to render — the retry surface. (HasValue is unreliable for the
        // JsonElement value type, so a hard-error status is the source of truth for "no content".)
        bool allHardError = state.Status == LoadStatus.Error &&
            security.Status == LoadStatus.Error &&
            charging is { Status: LoadStatus.Error };
        if (allHardError)
        {
            return RepositoryResult<DigitalTwinReading>.Failure(
                error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load vehicle state"));
        }

        if (offline || errored)
        {
            return RepositoryResult<DigitalTwinReading>.OfflineCached(
                reading,
                updatedAt ?? DateTimeOffset.UtcNow,
                error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<DigitalTwinReading>.Cached(reading, updatedAt ?? DateTimeOffset.UtcNow, stale: true);
        }

        return RepositoryResult<DigitalTwinReading>.Loaded(reading, updatedAt ?? DateTimeOffset.UtcNow);
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
