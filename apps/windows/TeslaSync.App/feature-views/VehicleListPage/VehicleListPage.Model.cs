using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="VehicleListPageViewModel"/> renders for the fleet
/// list — the native union of the branches the web Vehicle-list page draws
/// (web/src/features/vehicles/pages/VehicleListPage.tsx): the <c>isLoading</c> skeleton, the resolved-but-empty
/// <c>vehicleList.length === 0</c> empty state, the <c>error</c> surface, and the populated section stack
/// (fleet summary, fleet battery status, vehicle cards). Every branch maps onto a visible region; none is ever
/// blank.
/// </summary>
public enum VehicleListState
{
    /// <summary>The first load with no cached roster — web <c>isLoading</c> skeleton.</summary>
    Loading,

    /// <summary>A resolved roster with no vehicles — web <c>vehicleList.length === 0</c> empty state.</summary>
    Empty,

    /// <summary>A hard transport failure with no cached roster — web <c>error</c> surface.</summary>
    Error,

    /// <summary>A resolved roster with at least one vehicle — web populated section stack.</summary>
    Success,
}

/// <summary>
/// The vehicle identity the list shows — the native mirror of the web <c>Vehicle</c> slice the page maps over
/// (<c>display_name</c>, <c>vin</c>, <c>model</c>, <c>trim_badging</c>). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Id">The vehicle's database id (web <c>id</c>) — scopes the state read and the detail link.</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle identification number (web <c>vin</c>).</param>
/// <param name="Model">The model code (web <c>model</c>).</param>
/// <param name="TrimBadging">The trim badge (web <c>trim_badging</c>).</param>
public sealed record VehicleListVehicle(
    long Id,
    string DisplayName,
    string Vin,
    string Model,
    string TrimBadging)
{
    /// <summary>Header name — web <c>vehicle.display_name || vehicle.vin</c>.</summary>
    [JsonIgnore]
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>The space-joined <c>model trim_badging</c> token (web <c>{model} {trim_badging}</c>); may be empty.</summary>
    [JsonIgnore]
    public string ModelTrim => string.Join(
        ' ',
        new[] { Model, TrimBadging }.Where(static p => !string.IsNullOrWhiteSpace(p)).Select(static p => p.Trim()));

    /// <summary>Parse the <c>GET /vehicles</c> array into the ordered roster (web <c>useVehicles</c> result).</summary>
    /// <param name="root">The parsed <c>GET /vehicles</c> body.</param>
    /// <returns>The vehicles in wire order; an empty list for a non-array body.</returns>
    public static IReadOnlyList<VehicleListVehicle> FromArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleListVehicle>();
        }

        var vehicles = new List<VehicleListVehicle>(root.GetArrayLength());
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object && VehicleListJson.Long(element, "id") is { } id)
            {
                vehicles.Add(new VehicleListVehicle(
                    Id: id,
                    DisplayName: VehicleListJson.String(element, "display_name") ?? string.Empty,
                    Vin: VehicleListJson.String(element, "vin") ?? string.Empty,
                    Model: VehicleListJson.String(element, "model") ?? string.Empty,
                    TrimBadging: VehicleListJson.String(element, "trim_badging") ?? string.Empty));
            }
        }

        return vehicles;
    }
}

/// <summary>
/// The SI vehicle state the list reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of the
/// web <c>VehicleState</c> slice the page consumes. Distances are metres (<c>rated_range</c> / <c>odometer</c>),
/// speed is m/s (<c>speed</c>) and <c>charger_power</c> is kilowatts (the web shows it as kW without
/// conversion). Every dynamic field is nullable and stays null when the source did not report it so the
/// projection coerces with the web's <c>?? 0</c> guards. A <see langword="null"/> parse result models the web
/// <c>state ?? null</c> entry the fleet derivations drop.
/// </summary>
/// <param name="FsmState">The FSM state string (web <c>state.state</c>).</param>
/// <param name="BatteryLevel">State-of-charge percent (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in metres (web <c>rated_range</c>).</param>
/// <param name="OdometerMeters">Odometer in metres (web <c>odometer</c>).</param>
/// <param name="SpeedMps">Speed in metres per second (web <c>speed</c>) — drives the derived "driving" status.</param>
/// <param name="IsCharging">True while charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power in kilowatts (web <c>charger_power</c>).</param>
/// <param name="IsLocked">True when the vehicle is locked (web <c>is_locked</c>).</param>
/// <param name="SentryMode">True when Sentry mode is armed (web <c>sentry_mode</c>).</param>
public sealed record VehicleListVehicleState(
    string FsmState,
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? OdometerMeters,
    double? SpeedMps,
    bool IsCharging,
    double? ChargerPowerKw,
    bool IsLocked,
    bool SentryMode)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the list slice, mirroring the web
    /// <c>fetchVehicleState</c> normalisation: prefer the canonical <c>state</c> object (the one carrying
    /// <c>vehicle_id</c>), otherwise a plain <c>state</c> object when no <c>vehicle</c>/<c>position</c> envelope
    /// is present, otherwise reconstruct from the <c>position</c> snapshot plus the top-level charging fields.
    /// Returns <see langword="null"/> when none of those yield a state (the web asleep entry).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed state, or <see langword="null"/> when the vehicle reports no live state.</returns>
    public static VehicleListVehicleState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state carrying a vehicle_id is the canonical SignalStore state object.
        if (VehicleListJson.Object(root, "state") is { } canonical && VehicleListJson.Has(canonical, "vehicle_id"))
        {
            return FromStateObject(canonical);
        }

        var vehicle = VehicleListJson.Object(root, "vehicle");
        var position = VehicleListJson.Object(root, "position");
        if (vehicle is null && position is null)
        {
            return VehicleListJson.Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): rebuild from the position snapshot + the top-level charging flags. The
        // drive-only fields (speed / odometer / locks) only exist on the canonical state object.
        return new VehicleListVehicleState(
            FsmState: (vehicle is { } v ? VehicleListJson.String(v, "state") : null) ?? "offline",
            BatteryLevel: position is { } pb ? VehicleListJson.Double(pb, "battery_level") : null,
            RatedRangeMeters: position is { } pr ? VehicleListJson.Double(pr, "rated_range") : null,
            OdometerMeters: position is { } po ? VehicleListJson.Double(po, "odometer") : null,
            SpeedMps: position is { } ps ? VehicleListJson.Double(ps, "speed") : null,
            IsCharging: VehicleListJson.Bool(root, "is_charging"),
            ChargerPowerKw: VehicleListJson.Double(root, "charger_power"),
            IsLocked: position is { } pl && VehicleListJson.Bool(pl, "is_locked"),
            SentryMode: position is { } pse && VehicleListJson.Bool(pse, "sentry_mode"));
    }

    private static VehicleListVehicleState FromStateObject(JsonElement s) => new(
        FsmState: VehicleListJson.String(s, "state") ?? "offline",
        BatteryLevel: VehicleListJson.Double(s, "battery_level"),
        RatedRangeMeters: VehicleListJson.Double(s, "rated_range"),
        OdometerMeters: VehicleListJson.Double(s, "odometer"),
        SpeedMps: VehicleListJson.Double(s, "speed"),
        IsCharging: VehicleListJson.Bool(s, "is_charging"),
        ChargerPowerKw: VehicleListJson.Double(s, "charger_power"),
        IsLocked: VehicleListJson.Bool(s, "is_locked"),
        SentryMode: VehicleListJson.Bool(s, "sentry_mode"));
}

/// <summary>
/// One pinned-item record the page reads to float pinned vehicles to the top — the native mirror of the web
/// <c>usePinned('vehicle')</c> entry (<c>item_id</c> + <c>position</c>). Pure data.
/// </summary>
/// <param name="ItemId">The pinned item's id, stringified (web <c>String(p.item_id)</c>).</param>
/// <param name="Position">The pin ordering position (web <c>p.position</c>).</param>
public sealed record VehicleListPin(string ItemId, int Position)
{
    /// <summary>Parse the <c>GET /pinned</c> array into the pin records (web <c>usePinned</c> result).</summary>
    /// <param name="root">The parsed <c>GET /pinned</c> body.</param>
    /// <returns>The pins in wire order; an empty list for a non-array body.</returns>
    public static IReadOnlyList<VehicleListPin> FromArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VehicleListPin>();
        }

        var pins = new List<VehicleListPin>(root.GetArrayLength());
        int index = 0;
        foreach (var element in root.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? itemId = VehicleListJson.String(element, "item_id")
                ?? VehicleListJson.Long(element, "item_id")?.ToString(CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(itemId))
            {
                continue;
            }

            int position = (int)(VehicleListJson.Long(element, "position") ?? index);
            pins.Add(new VehicleListPin(itemId, position));
            index++;
        }

        return pins;
    }
}

/// <summary>One roster entry: the always-present vehicle identity plus the (nullable) live state.</summary>
/// <param name="Vehicle">The resolved vehicle identity.</param>
/// <param name="State">The live state, or <see langword="null"/> when the vehicle is asleep.</param>
public sealed record VehicleListEntry(VehicleListVehicle Vehicle, VehicleListVehicleState? State);

/// <summary>
/// The resolved fleet roster the page projects — the ordered <see cref="Entries"/> (each vehicle plus its
/// resolved state) and the <see cref="Pins"/> that float pinned vehicles to the top. The fleet rollup the
/// summary tiles read is derived on demand (the native mirror of the web <c>fleet</c> memo): the mean
/// <c>battery_level</c> over resolved states, the summed <c>rated_range</c> in SI metres, the charging count and
/// the online count. Pure data so the aggregation is asserted headlessly.
/// </summary>
/// <param name="Entries">The vehicle roster with each vehicle's resolved state.</param>
/// <param name="Pins">The pin records used to float pinned vehicles to the top.</param>
public sealed record VehicleListReading(
    IReadOnlyList<VehicleListEntry> Entries,
    IReadOnlyList<VehicleListPin> Pins)
{
    /// <summary>The empty roster (no vehicles, no pins).</summary>
    public static VehicleListReading Empty { get; } =
        new(Array.Empty<VehicleListEntry>(), Array.Empty<VehicleListPin>());

    /// <summary>Total vehicles in the fleet (web <c>vehicleList.length</c>).</summary>
    [JsonIgnore]
    public int VehicleCount => Entries.Count;

    /// <summary>The entries whose live state resolved (web <c>withState</c>).</summary>
    [JsonIgnore]
    public IReadOnlyList<VehicleListEntry> ResolvedEntries =>
        Entries.Where(static e => e.State is not null).ToList();

    /// <summary>Vehicles whose state read resolved (web <c>withState.length</c>).</summary>
    [JsonIgnore]
    public int OnlineCount => Entries.Count(static e => e.State is not null);

    /// <summary>Vehicles currently charging (web charging filter count).</summary>
    [JsonIgnore]
    public int ChargingCount => Entries.Count(static e => e.State is { IsCharging: true });

    /// <summary>Mean state-of-charge over resolved states, 0 when none resolved (web <c>avgBattery</c>).</summary>
    [JsonIgnore]
    public double AvgBatteryPercent
    {
        get
        {
            var resolved = Entries.Where(static e => e.State is not null).ToList();
            if (resolved.Count == 0)
            {
                return 0;
            }

            return resolved.Sum(static e => e.State!.BatteryLevel ?? 0) / resolved.Count;
        }
    }

    /// <summary>Sum of rated range across resolved states, SI metres (web <c>totalRange</c>).</summary>
    [JsonIgnore]
    public double TotalRangeMeters => Entries.Sum(static e => e.State?.RatedRangeMeters ?? 0);
}

/// <summary>
/// The status derivation + status / battery palette mapping — a 1:1 port of the web helpers the Vehicle-list
/// page consumes (<c>deriveVehicleStatus</c>, <c>statusVariant</c> from <c>@/api/types</c>, and
/// <c>batteryColor</c> from <c>@/lib/colors</c>) mapped to platform design-token brush keys so light / dark /
/// high-contrast all stay legible. Pure, UI-free, so the tests assert it without a XAML host.
/// </summary>
public static class VehicleListStatus
{
    private static readonly string[] KnownStates =
        { "online", "driving", "charging", "parked", "asleep", "offline", "updating", "sleeping" };

    /// <summary>The healthy-battery threshold (web <c>batteryColor</c> green &gt; 60).</summary>
    public const double HealthyBatteryPercent = 60;

    /// <summary>The warning-battery threshold (web <c>batteryColor</c> amber &gt; 25).</summary>
    public const double WarningBatteryPercent = 25;

    /// <summary>
    /// Derive the display status from live state — a 1:1 port of the web <c>deriveVehicleStatus</c>: no state
    /// is <c>offline</c>, charging wins, then a positive speed is <c>driving</c>, then a recognised FSM state
    /// string passes through, otherwise <c>online</c>.
    /// </summary>
    /// <param name="state">The live state, or <see langword="null"/> when asleep.</param>
    /// <returns>The derived status string.</returns>
    public static string DeriveStatus(VehicleListVehicleState? state)
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

        string s = (state.FsmState ?? string.Empty).Trim().ToLowerInvariant();
        return Array.IndexOf(KnownStates, s) >= 0 ? s : "online";
    }

    /// <summary>
    /// The semantic badge status — a port of the web <c>statusVariant</c> palette (online success, driving /
    /// parked / updating info, charging warning, offline danger, otherwise neutral).
    /// </summary>
    /// <param name="status">The raw status string.</param>
    /// <returns>The semantic status kind the badge renders.</returns>
    public static StatusKind StatusKindFor(string? status) => Normalize(status) switch
    {
        "online" => StatusKind.Success,
        "charging" => StatusKind.Warning,
        "driving" => StatusKind.Info,
        "parked" => StatusKind.Info,
        "updating" => StatusKind.Info,
        "offline" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// The design-token brush key for the battery fill — a port of the web <c>batteryColor</c>: above 60% reads
    /// green, above 25% reads amber, otherwise red.
    /// </summary>
    /// <param name="level">The state-of-charge percent.</param>
    /// <returns>The token brush key the battery bar fills with.</returns>
    public static string BatteryBrushKey(double level) => level switch
    {
        > HealthyBatteryPercent => "TsChartBatteryBrush",
        > WarningBatteryPercent => "TsChartEnergyBrush",
        _ => "TsColorDangerBrush",
    };

    /// <summary>Capitalize the first letter of the status for display (web shows the raw derived string).</summary>
    /// <param name="status">The raw status string.</param>
    /// <returns>The capitalized status text.</returns>
    public static string DisplayText(string? status)
    {
        string s = (status ?? string.Empty).Trim();
        if (s.Length == 0)
        {
            return s;
        }

        return char.ToUpperInvariant(s[0]) + s[1..];
    }

    private static string Normalize(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant();
}

/// <summary>
/// Static registration metadata for the <c>VehicleListPage</c> surface — the route / page-factory name, the
/// diagnostics slug, the read / mutation operation ids, the cache key, the auto-refresh cadence, the Segoe
/// Fluent glyph set and the i18n key set (every key + English fallback lifted verbatim from the web source
/// web/src/features/vehicles/pages/VehicleListPage.tsx). Centralised so the view, the projection and the tests
/// reference one source of truth.
/// </summary>
public static class VehicleListPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under (RouteTable <c>Vehicles</c>).</summary>
    public const string RouteName = "Vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "VehicleListPage";

    /// <summary>The cache key for the vehicle-list spine read (web <c>['vehicles']</c>).</summary>
    public const string VehiclesListCacheKey = "vehicles:list";

    /// <summary>Path-parameter name filling the <c>{vehicleID}</c> slot of the state / delete endpoint templates.</summary>
    public const string VehicleIdPathParam = "vehicleID";

    /// <summary>The per-vehicle state read — web <c>fetchVehicleState</c> (GET /vehicles/{id}/state).</summary>
    public const string StateOperation = "get_api_v1_vehicles_vehicleID_state";

    /// <summary>The pinned-items read — web <c>usePinned</c> (GET /pinned).</summary>
    public const string PinnedOperation = "get_api_v1_pinned";

    /// <summary>The sync mutation — web <c>syncMut</c> (POST /vehicles/sync).</summary>
    public const string SyncOperation = "post_api_v1_vehicles_sync";

    /// <summary>The delete mutation — web <c>deleteMut</c> (DELETE /vehicles/{id}).</summary>
    public const string DeleteOperation = "delete_api_v1_vehicles_vehicleID";

    /// <summary>The web <c>refetchInterval: 30_000</c> — the fleet states auto-refresh cadence, in ms.</summary>
    public const int RefreshIntervalMs = 30_000;

    /// <summary>The pin item type the page scopes its pinned read to (web <c>usePinned('vehicle')</c>).</summary>
    public const string PinItemType = "vehicle";

    /// <summary>Trailing "%" suffix on percent count-ups (web <c>suffix="%"</c>).</summary>
    public const string PercentSuffix = "%";

    // ── Segoe Fluent glyphs (web Lucide analogues) ───────────────────────────────────────────────────────

    /// <summary>Segoe Fluent "Car" glyph — web Lucide <c>Car</c> (Total Vehicles tile + empty surface).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent "Battery" glyph — web Lucide <c>Battery</c> (Avg Battery tile).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "Speed" glyph — web Lucide <c>Gauge</c> (Total Range tile).</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "Lightning" glyph — web Lucide <c>Zap</c> (Charging / Online tile + charge power).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "StreetsideSplitMinimize" glyph — web Lucide <c>Activity</c> (Fleet Battery Status header).</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "Lock" glyph — web Lucide <c>Lock</c> (locked flag).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Shield" glyph — web Lucide <c>Shield</c> (Sentry flag).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Refresh" glyph — web Lucide <c>RefreshCw</c> (Sync button).</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>Segoe Fluent "Sync" glyph — web Lucide <c>ArrowLeftRight</c> (Compare button).</summary>
    public const string CompareGlyph = "\uE8AB";

    /// <summary>Segoe Fluent "OpenInNewWindow" glyph — web Lucide <c>ExternalLink</c> (View details action).</summary>
    public const string ViewDetailsGlyph = "\uE8A7";

    /// <summary>Segoe Fluent "Delete" glyph — web Lucide <c>Trash2</c> (Remove action).</summary>
    public const string DeleteGlyph = "\uE74D";

    // ── Design-token accent brush keys (theme-aware; never literal hex) ───────────────────────────────────

    /// <summary>Accent for the Total Vehicles tile (web cyan).</summary>
    public const string VehiclesColor = "TsColorInfoBrush";

    /// <summary>Accent for the Avg Battery tile (web green).</summary>
    public const string AvgBatteryColor = "TsChartBatteryBrush";

    /// <summary>Accent for the Total Range tile (web purple).</summary>
    public const string TotalRangeColor = "TsChartPowerBrush";

    /// <summary>Accent for the Charging / Online tile (web amber).</summary>
    public const string ChargingOnlineColor = "TsChartEnergyBrush";

    // ── i18n keys + English fallbacks (verbatim from the web source) ──────────────────────────────────────

    /// <summary>Page title (web <c>t('nav.vehicles', 'Fleet')</c>).</summary>
    public const string NavVehiclesKey = "nav.vehicles";

    /// <summary>English fallback for the page title.</summary>
    public const string NavVehiclesFallback = "Fleet";

    /// <summary>Page subtitle (web <c>t('vehicles.subtitle', ...)</c>).</summary>
    public const string SubtitleKey = "vehicles.subtitle";

    /// <summary>English fallback for the page subtitle.</summary>
    public const string SubtitleFallback = "View, manage, and sync your Tesla vehicles";

    /// <summary>Total Vehicles tile label (web <c>t('vehicles.totalVehicles', 'Total Vehicles')</c>).</summary>
    public const string TotalVehiclesKey = "vehicles.totalVehicles";

    /// <summary>English fallback for the Total Vehicles tile.</summary>
    public const string TotalVehiclesFallback = "Total Vehicles";

    /// <summary>Avg Battery tile label (web <c>t('vehicles.avgBattery', 'Avg Battery')</c>).</summary>
    public const string AvgBatteryKey = "vehicles.avgBattery";

    /// <summary>English fallback for the Avg Battery tile.</summary>
    public const string AvgBatteryFallback = "Avg Battery";

    /// <summary>Total Range tile label (web <c>t('vehicles.totalRange', 'Total Range')</c>).</summary>
    public const string TotalRangeKey = "vehicles.totalRange";

    /// <summary>English fallback for the Total Range tile.</summary>
    public const string TotalRangeFallback = "Total Range";

    /// <summary>Charging / Online tile label (web <c>t('vehicles.chargingOnline', 'Charging / Online')</c>).</summary>
    public const string ChargingOnlineKey = "vehicles.chargingOnline";

    /// <summary>English fallback for the Charging / Online tile.</summary>
    public const string ChargingOnlineFallback = "Charging / Online";

    /// <summary>Fleet Battery Status panel title (web <c>t('vehicles.batteryStatus', 'Fleet Battery Status')</c>).</summary>
    public const string BatteryStatusKey = "vehicles.batteryStatus";

    /// <summary>English fallback for the Fleet Battery Status panel.</summary>
    public const string BatteryStatusFallback = "Fleet Battery Status";

    /// <summary>Battery-status average caption (web <c>t('vehicles.avgLabel', 'avg')</c>).</summary>
    public const string AvgLabelKey = "vehicles.avgLabel";

    /// <summary>English fallback for the average caption.</summary>
    public const string AvgLabelFallback = "avg";

    /// <summary>All Vehicles section heading (web <c>t('vehicles.allVehicles', 'All Vehicles')</c>).</summary>
    public const string AllVehiclesKey = "vehicles.allVehicles";

    /// <summary>English fallback for the All Vehicles heading.</summary>
    public const string AllVehiclesFallback = "All Vehicles";

    /// <summary>Empty-state title (web <c>t('vehicles.emptyTitle', 'No vehicles yet')</c>).</summary>
    public const string EmptyTitleKey = "vehicles.emptyTitle";

    /// <summary>English fallback for the empty-state title.</summary>
    public const string EmptyTitleFallback = "No vehicles yet";

    /// <summary>Empty-state message (web <c>t('vehicles.emptyMessage', ...)</c>).</summary>
    public const string EmptyMessageKey = "vehicles.emptyMessage";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyMessageFallback =
        "Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis.";

    /// <summary>Hard-failure message (web <c>t('vehicles.loadError', 'Failed to load vehicles.')</c>).</summary>
    public const string LoadErrorKey = "vehicles.loadError";

    /// <summary>English fallback for the load-error message.</summary>
    public const string LoadErrorFallback = "Failed to load vehicles.";

    /// <summary>Sync button label (web <c>t('vehicles.syncButton', 'Sync from Tesla')</c>).</summary>
    public const string SyncButtonKey = "vehicles.syncButton";

    /// <summary>English fallback for the Sync button.</summary>
    public const string SyncButtonFallback = "Sync from Tesla";

    /// <summary>Compare button label (web <c>t('vehicles.compareButton', 'Compare vehicles')</c>).</summary>
    public const string CompareButtonKey = "vehicles.compareButton";

    /// <summary>English fallback for the Compare button.</summary>
    public const string CompareButtonFallback = "Compare vehicles";

    /// <summary>Sync-success banner (web <c>t('vehicles.syncSuccess', 'Vehicles synced successfully.')</c>).</summary>
    public const string SyncSuccessKey = "vehicles.syncSuccess";

    /// <summary>English fallback for the sync-success banner.</summary>
    public const string SyncSuccessFallback = "Vehicles synced successfully.";

    /// <summary>Sync-error banner (web <c>t('vehicles.syncError', 'Sync failed. Please try again.')</c>).</summary>
    public const string SyncErrorKey = "vehicles.syncError";

    /// <summary>English fallback for the sync-error banner.</summary>
    public const string SyncErrorFallback = "Sync failed. Please try again.";

    /// <summary>Sync-success toast (web <c>t('vehicles.syncToast', 'Vehicles synced successfully')</c>).</summary>
    public const string SyncToastKey = "vehicles.syncToast";

    /// <summary>English fallback for the sync-success toast.</summary>
    public const string SyncToastFallback = "Vehicles synced successfully";

    /// <summary>Sync-failure toast (web <c>t('vehicles.syncFailed', 'Failed to sync vehicles')</c>).</summary>
    public const string SyncFailedKey = "vehicles.syncFailed";

    /// <summary>English fallback for the sync-failure toast.</summary>
    public const string SyncFailedFallback = "Failed to sync vehicles";

    /// <summary>Delete-success toast (web <c>t('vehicles.deleteSuccess', 'Vehicle removed')</c>).</summary>
    public const string DeleteSuccessKey = "vehicles.deleteSuccess";

    /// <summary>English fallback for the delete-success toast.</summary>
    public const string DeleteSuccessFallback = "Vehicle removed";

    /// <summary>Delete-failure toast (web <c>t('vehicles.deleteFailed', 'Failed to remove vehicle')</c>).</summary>
    public const string DeleteFailedKey = "vehicles.deleteFailed";

    /// <summary>English fallback for the delete-failure toast.</summary>
    public const string DeleteFailedFallback = "Failed to remove vehicle";

    /// <summary>Remove-dialog title (web <c>t('vehicles.removeTitle', 'Remove Vehicle')</c>).</summary>
    public const string RemoveTitleKey = "vehicles.removeTitle";

    /// <summary>English fallback for the remove-dialog title.</summary>
    public const string RemoveTitleFallback = "Remove Vehicle";

    /// <summary>Remove-dialog message template (web <c>t('vehicles.removeMessage', { name, defaultValue })</c>).</summary>
    public const string RemoveMessageKey = "vehicles.removeMessage";

    /// <summary>English fallback template for the remove-dialog message ('{name}' is substituted).</summary>
    public const string RemoveMessageFallback =
        "Are you sure you want to remove \"{name}\"? This will delete all associated data including drives, charges, and state history.";

    /// <summary>Remove-dialog confirm label (web <c>t('common.delete', 'Remove')</c>).</summary>
    public const string DeleteKey = "common.delete";

    /// <summary>English fallback for the confirm label.</summary>
    public const string DeleteFallback = "Remove";

    /// <summary>Empty battery-status caption (web <c>t('common.noData', 'No data available')</c>).</summary>
    public const string NoDataKey = "common.noData";

    /// <summary>English fallback for the no-data caption.</summary>
    public const string NoDataFallback = "No data available";

    /// <summary>Cancel label for the remove dialog (Windows accessibility minimum; web dialog Cancel).</summary>
    public const string CancelKey = "common.cancel";

    /// <summary>English fallback for the cancel label.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>The localized page title (web <c>t('nav.vehicles', 'Fleet')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NavVehiclesKey, NavVehiclesFallback);
    }

    /// <summary>Resolve the remove-dialog message, substituting the vehicle name into the template.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleName">The vehicle display name (web <c>name</c>).</param>
    /// <returns>The localized, name-substituted confirmation message.</returns>
    public static string RemoveMessage(ILocalizer localizer, string vehicleName)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = localizer.GetString(RemoveMessageKey, RemoveMessageFallback);
        return template.Replace("{name}", vehicleName ?? string.Empty, StringComparison.Ordinal);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehicleListPage</c> surface. Records only the operational <c>view.opened</c>
/// event with the surface slug — never a vehicle id, display name or VIN — so a diagnostics line can never leak
/// fleet data. Thread-safe.
/// </summary>
public sealed class VehicleListPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The PII-safe sink; null discards.</param>
    public VehicleListPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleListPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleListPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the vehicle-list parsers. Every read is null-safe so a partial
/// wire object never throws; numeric readers also accept JSON strings (the Go API occasionally stringifies ids
/// and metrics) so the parse mirrors the web's permissive <c>Number(...)</c> / <c>String(...)</c> coercion.
/// </summary>
internal static class VehicleListJson
{
    /// <summary>The nested object property, or null when absent / not an object.</summary>
    public static JsonElement? Object(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object
            ? v
            : null;

    /// <summary>Whether <paramref name="obj"/> carries a property named <paramref name="name"/>.</summary>
    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? str = v.GetString();
            return string.IsNullOrEmpty(str) ? null : str;
        }

        return null;
    }

    /// <summary>Reads a numeric (or numeric-string) property as a double, or null when absent / unparseable.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetDouble(out var d) ? d : null,
            JsonValueKind.String => double.TryParse(
                v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) ? s : null,
            _ => null,
        };
    }

    /// <summary>Reads a numeric (or numeric-string) property as a long, or null when absent / unparseable.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number => v.TryGetInt64(out var l)
                ? l
                : (v.TryGetDouble(out var d) ? (long)d : null),
            JsonValueKind.String => long.TryParse(
                v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) ? s : null,
            _ => null,
        };
    }

    /// <summary>Reads a boolean (or "true"/"false" string) property, defaulting to false when absent.</summary>
    public static bool Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }
}
