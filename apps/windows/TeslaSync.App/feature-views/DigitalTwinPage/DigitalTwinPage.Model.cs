using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using TeslaSync.App.DashboardWidgets;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The mutually-exclusive lifecycle state of the native <c>DigitalTwinPage</c> surface — the parity mirror of the
/// three data states the web page renders (web/src/features/vehicles/pages/DigitalTwinPage.tsx). The web page wraps
/// its body in a <c>PageContainer</c> whose <c>loading</c> overlay shows while the fleet query is in flight, then
/// gates on the resolved vehicle: with no vehicle it renders the "no vehicles" empty panel
/// (<c>!vehicle &amp;&amp; !vehiclesLoading</c>), otherwise the twin visualization plus the doors / windows /
/// security side panels. This enum is the top-level summary the ledger / Narrator key off; per-region visibility is
/// still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum DigitalTwinPageState
{
    /// <summary>The fleet query is in flight with no vehicle resolved yet (web <c>vehiclesLoading</c>) — the page shows the skeleton.</summary>
    Loading,

    /// <summary>The fleet resolved with no selectable vehicle (web <c>!vehicle &amp;&amp; !vehiclesLoading</c>) — the empty panel shows.</summary>
    Empty,

    /// <summary>A vehicle is resolved (web <c>vehicle</c>) — the twin visualization + side detail panels render.</summary>
    Success,
}

/// <summary>
/// A presentation-ready fleet vehicle for the digital-twin page — the native mirror of the fields the web page reads
/// off <c>useSelectedVehicle().vehicle</c> (web <c>id</c> / <c>display_name</c> / <c>vin</c> /
/// <c>exterior_color</c>). Carries the Tesla <c>exterior_color</c> the shared <see cref="VehicleOption"/> omits, so
/// the twin schematic and paint picker can infer the body colour. Field names mirror the Go API's snake_case JSON
/// tags; parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
/// <param name="DisplayName">The vehicle display name (web <c>display_name</c>).</param>
/// <param name="Vin">The vehicle VIN (web <c>vin</c>).</param>
/// <param name="ExteriorColor">The Tesla <c>exterior_color</c> code used to infer the twin paint, or null.</param>
public sealed record DigitalTwinVehicle(long Id, string? DisplayName, string? Vin, string? ExteriorColor)
{
    /// <summary>Read one vehicle from a JSON object, tolerating missing / null fields.</summary>
    /// <param name="o">The vehicle JSON object.</param>
    /// <returns>The parsed vehicle, or null when the payload is not an object or carries no positive id.</returns>
    public static DigitalTwinVehicle? FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        long id = ReadLong(o, "id") ?? 0;
        if (id <= 0)
        {
            return null;
        }

        return new DigitalTwinVehicle(
            Id: id,
            DisplayName: ReadString(o, "display_name"),
            Vin: ReadString(o, "vin"),
            ExteriorColor: ReadString(o, "exterior_color"));
    }

    /// <summary>Project to the shared picker option (web <c>display_name || vin || "Vehicle {id}"</c> identity).</summary>
    /// <returns>The shared <see cref="VehicleOption"/> for the header vehicle picker.</returns>
    public VehicleOption ToOption() => new(Id, DisplayName, Vin);

    private static long? ReadLong(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;

    private static string? ReadString(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The three raw live reads the digital-twin page merges for the selected vehicle — the native analogue of the web
/// page's <c>useVehicleState</c> + <c>useSecurityLatest</c> + <c>useChargingTelemetryLatest</c> query trio. The raw
/// <see cref="JsonElement"/> bodies round-trip the snake_case wire shape losslessly so the shared
/// <see cref="DigitalTwinSignals"/> merge (the port of the web <c>buildTwinState</c>) reproduces the web's observable
/// state exactly. <see cref="Live"/> mirrors the state read's <c>live</c> flag the badge fallback consults. Pure data.
/// </summary>
/// <param name="State">The raw <c>GET /vehicles/{id}/state</c> body, or null when unread.</param>
/// <param name="Security">The raw <c>GET /security/latest</c> body, or null when unread.</param>
/// <param name="Charging">The raw <c>GET /charging-telemetry/latest</c> body, or null when unread.</param>
/// <param name="Live">Whether the state read reported a live source (web <c>vehicleStateData?.live</c>).</param>
public sealed record DigitalTwinReadings(JsonElement? State, JsonElement? Security, JsonElement? Charging, bool Live)
{
    /// <summary>The empty readings (nothing read yet) — the default local-state feed result.</summary>
    public static DigitalTwinReadings Empty { get; } = new(null, null, null, false);

    /// <summary>True when the security read resolved an object body (web <c>securityData</c> truthy) — gates the door / window panels.</summary>
    public bool HasSecurity => Security is { ValueKind: JsonValueKind.Object };

    /// <summary>True when the charging read resolved an object body (web <c>chargingData</c> truthy).</summary>
    public bool HasCharging => Charging is { ValueKind: JsonValueKind.Object };
}

/// <summary>
/// The data port the <see cref="DigitalTwinPageViewModel"/> reads through — the native parity of the web page's hook
/// trio. The view never performs HTTP itself; the default <see cref="EmptyDigitalTwinPageFeed"/> resolves to the empty
/// state (no fleet), and the generated-client-backed <see cref="DigitalTwinPageClientFeed"/> binds to the generated
/// OpenAPI contract client (ADR-004). A failing fetch throws so the view-model can surface a degraded surface without
/// hiding the twin.
/// </summary>
public interface IDigitalTwinPageFeed
{
    /// <summary>Resolve the fleet (web <c>useVehicles</c> → <c>GET /vehicles</c>).</summary>
    /// <param name="cancellationToken">Cancels the fetch.</param>
    /// <returns>The fleet vehicles, newest-first as the API returns them.</returns>
    Task<IReadOnlyList<DigitalTwinVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the three live reads for <paramref name="vehicleId"/> (web state + security + charging queries).</summary>
    /// <param name="vehicleId">The selected vehicle id to scope the reads to.</param>
    /// <param name="cancellationToken">Cancels the fetch.</param>
    /// <returns>The merged readings for the vehicle.</returns>
    Task<DigitalTwinReadings> FetchReadingsAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves the fleet to empty and every reading to the empty snapshot (the empty data state).</summary>
public sealed class EmptyDigitalTwinPageFeed : IDigitalTwinPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyDigitalTwinPageFeed Instance { get; } = new();

    private EmptyDigitalTwinPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<DigitalTwinVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<DigitalTwinVehicle>>(Array.Empty<DigitalTwinVehicle>());
    }

    /// <inheritdoc />
    public Task<DigitalTwinReadings> FetchReadingsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(DigitalTwinReadings.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>DigitalTwinPage</c> projects from — the native analogue of the web page's
/// resolved hook state (the fleet, the effective selected vehicle, the merged readings, and whether the fleet is still
/// loading). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Vehicles">The loaded fleet (web <c>vehicles</c>).</param>
/// <param name="SelectedVehicle">The effective selected vehicle (web <c>useSelectedVehicle().vehicle</c>), or null.</param>
/// <param name="Readings">The merged live reads for the selected vehicle.</param>
/// <param name="Loading">Whether the fleet query is in flight with no vehicle resolved (web <c>vehiclesLoading</c>).</param>
public sealed record DigitalTwinPageModel(
    IReadOnlyList<DigitalTwinVehicle> Vehicles,
    DigitalTwinVehicle? SelectedVehicle,
    DigitalTwinReadings Readings,
    bool Loading)
{
    /// <summary>The initial model — the first load, no fleet yet, nothing read.</summary>
    public static DigitalTwinPageModel Initial { get; } = new(
        Vehicles: Array.Empty<DigitalTwinVehicle>(),
        SelectedVehicle: null,
        Readings: DigitalTwinReadings.Empty,
        Loading: true);
}

/// <summary>One projected key/value row in a detail panel (the native analogue of a web <c>KVList</c> item).</summary>
/// <param name="Label">The localized row label.</param>
/// <param name="Value">The formatted row value (em-dash when unknown, matching the web <c>'—'</c>).</param>
public sealed record DigitalTwinItem(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible page header, the three
/// data-state flags, the "no vehicles" empty panel copy, the twin visualization model + last-updated stamp, and the
/// doors / windows / security side panels (their localized titles, projected rows, the per-panel empty messages, and
/// the derived status badge). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DigitalTwinPageDisplay(
    DigitalTwinPageState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowContent,
    string NoVehiclesMessage,
    VehicleTwinModel Twin,
    bool ShowLastUpdated,
    string LastUpdatedLabel,
    string LastUpdatedValue,
    string DoorsTitle,
    bool ShowDoorItems,
    IReadOnlyList<DigitalTwinItem> DoorItems,
    string NoDoorMessage,
    string WindowsTitle,
    bool ShowWindowItems,
    IReadOnlyList<DigitalTwinItem> WindowItems,
    string NoWindowMessage,
    string SecurityTitle,
    IReadOnlyList<DigitalTwinItem> SecurityItems,
    bool ShowBadge,
    string BadgeStatus,
    string BadgeAccentKey,
    long? SelectedVehicleId,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DigitalTwinPageModel"/> to its <see cref="DigitalTwinPageDisplay"/> — the native
/// port of the render logic in web/src/features/vehicles/pages/DigitalTwinPage.tsx. The Tesla signal merge reuses the
/// shared <see cref="DigitalTwinSignals"/> (the port of the web <c>buildTwinState</c>); the door / window / security
/// rows and the status badge mirror the web <c>doorItems</c> / <c>windowItems</c> / <c>securityItems</c> /
/// <c>badgeStatus</c> memos verbatim. Every visible literal resolves through the i18n facade using the exact web key
/// names on every projection (so the i18n contract holds in every data state); unknown values fall back to the web
/// <c>'—'</c> em-dash. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DigitalTwinPageProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The live read poll interval in milliseconds (web <c>REFRESH_INTERVAL = 5_000</c>).</summary>
    public const int RefreshIntervalMs = 5_000;

    private static readonly string[] KnownVehicleStates =
        ["online", "driving", "charging", "parked", "updating", "asleep", "offline"];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web hook state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display the view binds to.</returns>
    public static DigitalTwinPageDisplay Project(DigitalTwinPageModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Resolve every visible literal up-front so the full i18n contract holds in every data state ───────
        string title = localizer.GetString("digitalTwin.title", "Digital Twin");
        string subtitle = localizer.GetString("digitalTwin.subtitle", "Real-time vehicle physical state");
        string noVehicles = localizer.GetString("digitalTwin.noVehicles", "No vehicles found. Add a vehicle to see its digital twin.");
        string doorsTitle = localizer.GetString("digitalTwin.doorsTitle", "Doors & Openings");
        string windowsTitle = localizer.GetString("digitalTwin.windowsTitle", "Windows");
        string securityTitle = localizer.GetString("digitalTwin.securityTitle", "Security & Status");
        string noDoorData = localizer.GetString("digitalTwin.noDoorData", "No door data available");
        string noWindowData = localizer.GetString("digitalTwin.noWindowData", "No window data available");
        string lastUpdatedLabel = localizer.GetString("digitalTwin.lastUpdated", "Last updated");

        // Shared value words (web `common.*` + the occupied / empty / charging digital-twin values).
        string openText = localizer.GetString("common.open", "Open");
        string closedText = localizer.GetString("common.closed", "Closed");
        string yesText = localizer.GetString("common.yes", "Yes");
        string noText = localizer.GetString("common.no", "No");
        string onText = localizer.GetString("common.on", "On");
        string offText = localizer.GetString("common.off", "Off");
        string activeText = localizer.GetString("common.active", "Active");
        string inactiveText = localizer.GetString("common.inactive", "Inactive");
        string occupiedText = localizer.GetString("digitalTwin.occupied", "Occupied");
        string emptyText = localizer.GetString("digitalTwin.empty", "Empty");
        string chargingText = localizer.GetString("digitalTwin.charging", "Charging");
        string partialText = localizer.GetString("widget.doorWindow.partial", "Partial");

        // Door / window / security row labels (web `digitalTwin.*`).
        string lblDriverFront = localizer.GetString("digitalTwin.doorDriverFront", "Driver Front");
        string lblPassengerFront = localizer.GetString("digitalTwin.doorPassengerFront", "Passenger Front");
        string lblDriverRear = localizer.GetString("digitalTwin.doorDriverRear", "Driver Rear");
        string lblPassengerRear = localizer.GetString("digitalTwin.doorPassengerRear", "Passenger Rear");
        string lblFrunk = localizer.GetString("digitalTwin.frunk", "Frunk");
        string lblTrunk = localizer.GetString("digitalTwin.trunk", "Trunk");
        string lblWindowFD = localizer.GetString("digitalTwin.windowFD", "Front Driver");
        string lblWindowFP = localizer.GetString("digitalTwin.windowFP", "Front Passenger");
        string lblWindowRD = localizer.GetString("digitalTwin.windowRD", "Rear Driver");
        string lblWindowRP = localizer.GetString("digitalTwin.windowRP", "Rear Passenger");
        string lblLocked = localizer.GetString("digitalTwin.locked", "Locked");
        string lblDriving = localizer.GetString("digitalTwin.driving", "Driving");
        string lblSentry = localizer.GetString("digitalTwin.sentryMode", "Sentry Mode");
        string lblChargePort = localizer.GetString("digitalTwin.chargePort", "Charge Port");
        string lblDriverSeat = localizer.GetString("digitalTwin.driverSeat", "Driver Seat");
        string lblHeadlights = localizer.GetString("digitalTwin.headlights", "Headlights");
        string lblHazards = localizer.GetString("digitalTwin.hazards", "Hazards");

        // ── Merge the live reads into the twin state (web buildTwinState) ────────────────────────────────────
        var selected = model.SelectedVehicle;
        var identity = new DigitalTwinIdentity(selected?.DisplayName ?? string.Empty, selected?.Vin, selected?.ExteriorColor);
        DigitalTwinReading reading = DigitalTwinSignals.Merge(identity, model.Readings.State, model.Readings.Security, model.Readings.Charging);
        VehicleTwinModel twin = reading.Model;
        bool? hazards = reading.Hazards;
        bool? driverSeatOccupied = ReadBoolProp(model.Readings.Security, "driver_seat_occupied");

        // Local tri-state formatters (web `value === null ? '—' : ...`).
        string OpenClosed(bool? v) => v is null ? EmDash : v.Value ? openText : closedText;
        string WindowValue(WindowPosition p) => p switch
        {
            WindowPosition.Open => openText,
            WindowPosition.Closed => closedText,
            WindowPosition.Partial => partialText,
            _ => EmDash,
        };

        var doorItems = new List<DigitalTwinItem>
        {
            new(lblDriverFront, OpenClosed(twin.DoorDriverFront)),
            new(lblPassengerFront, OpenClosed(twin.DoorPassengerFront)),
            new(lblDriverRear, OpenClosed(twin.DoorDriverRear)),
            new(lblPassengerRear, OpenClosed(twin.DoorPassengerRear)),
            new(lblFrunk, OpenClosed(twin.FrunkOpen)),
            new(lblTrunk, OpenClosed(twin.TrunkOpen)),
        };

        var windowItems = new List<DigitalTwinItem>
        {
            new(lblWindowFD, WindowValue(twin.WindowDriverFront)),
            new(lblWindowFP, WindowValue(twin.WindowPassengerFront)),
            new(lblWindowRD, WindowValue(twin.WindowDriverRear)),
            new(lblWindowRP, WindowValue(twin.WindowPassengerRear)),
        };

        string chargePortValue = twin.IsCharging
            ? chargingText
            : twin.ChargePortOpen is null ? EmDash : twin.ChargePortOpen.Value ? openText : closedText;

        var securityItems = new List<DigitalTwinItem>
        {
            new(lblLocked, twin.Locked is null ? EmDash : twin.Locked.Value ? yesText : noText),
            new(lblDriving, twin.IsDriving ? yesText : noText),
            new(chargingText, twin.IsCharging ? yesText : noText),
            new(lblSentry, twin.SentryMode is null ? EmDash : twin.SentryMode.Value ? activeText : inactiveText),
            new(lblChargePort, chargePortValue),
            new(lblDriverSeat, driverSeatOccupied is null ? EmDash : driverSeatOccupied.Value ? occupiedText : emptyText),
            new(lblHeadlights, twin.Headlights is null ? EmDash : twin.Headlights.Value ? onText : offText),
            new(lblHazards, hazards is null ? EmDash : hazards.Value ? activeText : offText),
        };

        // ── Status badge (web badgeStatus memo) ─────────────────────────────────────────────────────────────
        string badge = DeriveBadgeStatus(twin, model.Readings);

        // ── Last-updated stamp (web `twinState.lastUpdated && formatTime(...)`) ──────────────────────────────
        bool showLastUpdated = TryFormatTime(ReadStringProp(model.Readings.Security, "created_at"), out string lastUpdatedValue);

        // ── Data state ──────────────────────────────────────────────────────────────────────────────────────
        bool hasVehicle = selected is not null;
        DigitalTwinPageState state = model.Loading && !hasVehicle
            ? DigitalTwinPageState.Loading
            : hasVehicle ? DigitalTwinPageState.Success : DigitalTwinPageState.Empty;

        string automation = hasVehicle ? $"{title}. {subtitle}" : $"{title}. {noVehicles}";

        return new DigitalTwinPageDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == DigitalTwinPageState.Loading,
            ShowEmpty: state == DigitalTwinPageState.Empty,
            ShowContent: state == DigitalTwinPageState.Success,
            NoVehiclesMessage: noVehicles,
            Twin: twin,
            ShowLastUpdated: showLastUpdated,
            LastUpdatedLabel: lastUpdatedLabel,
            LastUpdatedValue: lastUpdatedValue,
            DoorsTitle: doorsTitle,
            ShowDoorItems: model.Readings.HasSecurity,
            DoorItems: doorItems,
            NoDoorMessage: noDoorData,
            WindowsTitle: windowsTitle,
            ShowWindowItems: model.Readings.HasSecurity,
            WindowItems: windowItems,
            NoWindowMessage: noWindowData,
            SecurityTitle: securityTitle,
            SecurityItems: securityItems,
            ShowBadge: hasVehicle,
            BadgeStatus: badge,
            BadgeAccentKey: StatusAccentKey(badge),
            SelectedVehicleId: selected?.Id,
            AutomationName: automation);
    }

    /// <summary>
    /// Derive the status-badge token (web <c>badgeStatus</c>): charging / driving win first, then the recognised
    /// FSM state passes through, then any live read promotes "offline" to "online", else "offline".
    /// </summary>
    /// <param name="twin">The merged twin model (carries the charging / driving truth).</param>
    /// <param name="readings">The raw reads, consulted for the live / security / charging fallback.</param>
    /// <returns>The lower-case status token the badge renders.</returns>
    public static string DeriveBadgeStatus(VehicleTwinModel twin, DigitalTwinReadings readings)
    {
        ArgumentNullException.ThrowIfNull(twin);
        ArgumentNullException.ThrowIfNull(readings);

        if (twin.IsCharging)
        {
            return "charging";
        }

        if (twin.IsDriving)
        {
            return "driving";
        }

        string fromState = DeriveVehicleStatus(DigitalTwinSignals.ExtractState(readings.State));
        if (!string.Equals(fromState, "offline", StringComparison.Ordinal))
        {
            return fromState;
        }

        return readings.Live || readings.HasSecurity || readings.HasCharging ? "online" : "offline";
    }

    /// <summary>Port of the web <c>deriveVehicleStatus</c> over the unwrapped vehicle-state object.</summary>
    /// <param name="state">The inner vehicle-state JSON object, or null.</param>
    /// <returns>The derived lower-case status token.</returns>
    public static string DeriveVehicleStatus(JsonElement? state)
    {
        if (state is not { ValueKind: JsonValueKind.Object })
        {
            return "offline";
        }

        if (ReadBoolProp(state, "is_charging") == true)
        {
            return "charging";
        }

        if ((ReadDoubleProp(state, "speed") ?? 0) > 0)
        {
            return "driving";
        }

        string s = (ReadStringProp(state, "state") ?? string.Empty).Trim().ToLowerInvariant();
        return Array.IndexOf(KnownVehicleStates, s) >= 0 ? s : "online";
    }

    /// <summary>
    /// The design-token brush key for the status-badge dot, mirroring the web vehicle-state badge palette mapped to
    /// the nearest themed token so light / dark / high-contrast all stay legible.
    /// </summary>
    /// <param name="status">The lower-case status token.</param>
    /// <returns>The design-token brush key for the badge dot.</returns>
    public static string StatusAccentKey(string status) => status switch
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

    private static bool TryFormatTime(string? raw, out string value)
    {
        if (!string.IsNullOrWhiteSpace(raw) &&
            DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
        {
            value = parsed.ToLocalTime().ToString("t", CultureInfo.CurrentCulture);
            return true;
        }

        value = string.Empty;
        return false;
    }

    private static bool? ReadBoolProp(JsonElement? parent, string name)
    {
        if (parent is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(name, out var v))
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

    private static double? ReadDoubleProp(JsonElement? parent, string name)
    {
        if (parent is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n)
            ? n
            : null;
    }

    private static string? ReadStringProp(JsonElement? parent, string name)
    {
        if (parent is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}

/// <summary>
/// Canonical registry metadata for the Digital Twin page — the native mirror of the web route entry
/// (web route <c>/digital-twin</c>, nav group Vehicles). The shell page factory registers the page under
/// <see cref="RouteName"/>; the feed binds the generated operation ids.
/// </summary>
public static class DigitalTwinPageRegistration
{
    /// <summary>The shell route name the page registers under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "DigitalTwin";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DigitalTwinPage";

    /// <summary>The generated fleet operation id (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The generated vehicle-state operation id (web <c>useVehicleState</c>).</summary>
    public const string StateOperation = "get_api_v1_vehicles_vehicleID_state";

    /// <summary>The generated security-latest operation id (web <c>useSecurityLatest</c>).</summary>
    public const string SecurityOperation = "get_api_v1_security_latest";

    /// <summary>The generated charging-telemetry-latest operation id (web <c>useChargingTelemetryLatest</c>).</summary>
    public const string ChargingOperation = "get_api_v1_charging_telemetry_latest";

    /// <summary>The Segoe Fluent "Car" glyph (web lucide <c>Car</c> icon) for the empty panel.</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>The Segoe Fluent "Info" glyph (web lucide <c>Info</c> icon) for the per-panel empty states.</summary>
    public const string InfoGlyph = "\uE946";

    /// <summary>The localized page title (web <c>digitalTwin.title</c>).</summary>
    /// <param name="localizer">The i18n facade the title resolves through.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("digitalTwin.title", "Digital Twin");
    }
}

/// <summary>
/// PII-safe diagnostics for the Digital Twin page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a door / window / lock / charge state, VIN or vehicle id —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DigitalTwinPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The PII-safe diagnostics sink, or null.</param>
    public DigitalTwinPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DigitalTwinPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DigitalTwinPageRegistration.Slug}");
    }
}
