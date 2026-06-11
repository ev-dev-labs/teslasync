using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive top-level state the <see cref="VehicleHeader"/> surface renders — the native data
/// states behind the web header (web/src/features/vehicles/components/VehicleHeader.tsx). The web component is
/// a pure presentational child fed a resolved vehicle + live state by its page; the native surface binds its
/// own cache-then-network read, so it must render every load state. The header bar always stays visible (no
/// hidden panels): <see cref="Loaded"/>, <see cref="Stale"/>, <see cref="Offline"/> and <see cref="Empty"/>
/// all carry a populated <see cref="VehicleHeaderDisplay"/>; only <see cref="Loading"/> swaps in skeleton
/// chrome and <see cref="Error"/> swaps in the retry surface.
/// </summary>
public enum VehicleHeaderState
{
    /// <summary>The first read is in flight and no cached value exists yet (skeleton chrome).</summary>
    Loading,

    /// <summary>A vehicle resolved and the header renders its name, status and subtitle.</summary>
    Loaded,

    /// <summary>The read succeeded but no vehicle exists — a friendly empty header, never a blank box.</summary>
    Empty,

    /// <summary>The read failed with no cached value — the retry surface is shown.</summary>
    Error,

    /// <summary>A cached vehicle is shown but is past the freshness window (stale chip + auto-refresh).</summary>
    Stale,

    /// <summary>The network is unreachable; the last cached vehicle is shown with an offline chip.</summary>
    Offline,
}

/// <summary>
/// The lifecycle of the wake-vehicle action — the native analogue of the web <c>useWakeVehicle</c> mutation
/// status (web/src/api/hooks/useVehicles.ts). The web button shows a busy ring while
/// <c>wakeMut.isPending</c> and, on success, waits before refetching the vehicle state
/// (<c>setTimeout(onRefetchState, 5000)</c>).
/// </summary>
public enum VehicleHeaderWakePhase
{
    /// <summary>No wake in progress.</summary>
    Idle,

    /// <summary>The wake command is in flight (the button shows its busy ring).</summary>
    Waking,

    /// <summary>The wake command was accepted (the "Wake command sent" confirmation is shown).</summary>
    Sent,

    /// <summary>The wake command failed; an inline error is shown and the button is re-enabled to retry.</summary>
    Failed,
}

/// <summary>
/// The outcome of a wake-vehicle mutation (<c>POST /vehicles/{vehicleID}/wake</c>). On success it carries no
/// payload (web parity: the mutation only fires a toast); on failure it carries the privacy-safe
/// <see cref="RepositoryError"/>. The source never throws for an HTTP fault — it resolves to this outcome so
/// the view-model can surface a toast-equivalent rather than an unhandled rejection (web parity).
/// </summary>
/// <param name="Success">True when the wake command was accepted.</param>
/// <param name="Error">The classified failure, or <see langword="null"/> on success.</param>
public sealed record VehicleHeaderWakeOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful wake command.</summary>
    /// <returns>A success outcome.</returns>
    public static VehicleHeaderWakeOutcome Ok() => new(true, null);

    /// <summary>A failed wake command carrying the classified error.</summary>
    /// <param name="error">The classified failure.</param>
    /// <returns>A failure outcome.</returns>
    public static VehicleHeaderWakeOutcome Fail(RepositoryError error) => new(false, error);
}

/// <summary>
/// The vehicle identity the header renders — the native mirror of the web <c>Vehicle</c> fields the header
/// reads (web/src/api/types.ts): <c>id</c>, <c>display_name</c>, <c>vin</c>, <c>model</c> and
/// <c>trim_badging</c>. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial body never throws. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="Id">The vehicle's database id (web <c>vehicle.id</c>); the wake mutation's path argument.</param>
/// <param name="DisplayName">The user-facing name (web <c>vehicle.display_name</c>).</param>
/// <param name="Vin">The vehicle identification number (web <c>vehicle.vin</c>).</param>
/// <param name="Model">The model name (web <c>vehicle.model</c>).</param>
/// <param name="TrimBadging">The trim badge (web <c>vehicle.trim_badging</c>).</param>
public sealed record VehicleHeaderVehicle(
    long Id,
    string DisplayName,
    string Vin,
    string Model,
    string TrimBadging)
{
    /// <summary>The sentinel "no vehicle resolved" identity (the parse / empty fallback).</summary>
    public static VehicleHeaderVehicle None { get; } = new(0, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Header name — web <c>vehicle.display_name || vehicle.vin</c> (the <c>t('common.vehicle')</c>
    /// fallback is applied by the projection when both are empty).</summary>
    [JsonIgnore]
    public string Name => !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName.Trim() : (Vin ?? string.Empty).Trim();

    /// <summary>
    /// Header subtitle — web <c>{model} {trim_badging} · {vin}</c>. The model and trim collapse to a single
    /// space-joined token; the VIN is appended after a middle dot. Absent parts drop out cleanly.
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
    public static VehicleHeaderVehicle? FromVehiclesArray(JsonElement root, long? preferredId)
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
            if (preferredId is { } id && VehicleHeaderJson.Long(element, "id") == id)
            {
                return FromObject(element);
            }
        }

        return first is { } fallback ? FromObject(fallback) : null;
    }

    private static VehicleHeaderVehicle FromObject(JsonElement v) => new(
        Id: VehicleHeaderJson.Long(v, "id") ?? 0,
        DisplayName: VehicleHeaderJson.String(v, "display_name") ?? string.Empty,
        Vin: VehicleHeaderJson.String(v, "vin") ?? string.Empty,
        Model: VehicleHeaderJson.String(v, "model") ?? string.Empty,
        TrimBadging: VehicleHeaderJson.String(v, "trim_badging") ?? string.Empty);
}

/// <summary>
/// The minimal live-vehicle-state slice the header derives its status badge from — the native mirror of the
/// fields the web <c>getVehicleStatus</c> (<c>deriveVehicleStatus</c>, web/src/types/fsm/vehicle.ts) reads:
/// <c>is_charging</c>, <c>speed</c> and the FSM <c>state</c> string. A <see langword="null"/> parse result
/// models the web <c>stateData</c> being undefined (the vehicle is asleep / stateless), which the derivation
/// maps to <c>offline</c>. Pure data — unit-tested without a UI host.
/// </summary>
/// <param name="RawState">The FSM state string (web <c>state.state</c>); empty falls through to <c>online</c>.</param>
/// <param name="SpeedMps">Speed in metres per second (web <c>state.speed</c>); &gt; 0 implies driving.</param>
/// <param name="IsCharging">True while charging (web <c>state.is_charging</c>); wins over every other status.</param>
public sealed record VehicleHeaderTelemetry(string? RawState, double? SpeedMps, bool IsCharging)
{
    /// <summary>
    /// Parse a <c>GET /vehicles/{vehicleID}/state</c> body. Accepts both the wrapped <c>{ "state": { … } }</c>
    /// envelope and a bare state object. A null / non-object body, or an explicit <c>"state": null</c> (web
    /// parity: the asleep vehicle has no live state), yields <see langword="null"/> rather than throwing.
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed live-state slice, or <see langword="null"/> when the vehicle reported no state.</returns>
    public static VehicleHeaderTelemetry? FromResponse(JsonElement root)
    {
        var state = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("state", out var nested))
        {
            if (nested.ValueKind == JsonValueKind.Object)
            {
                state = nested;
            }
            else if (nested.ValueKind == JsonValueKind.Null)
            {
                return null;
            }
        }

        if (state.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        string? raw = VehicleHeaderJson.String(state, "state");
        double? speed = VehicleHeaderJson.Double(state, "speed");
        bool hasCharging = VehicleHeaderJson.Has(state, "is_charging");

        // A body that carries none of the status-bearing fields is treated as "no live state" (asleep), the
        // web stateData-undefined case — the derivation then resolves to offline.
        if (string.IsNullOrWhiteSpace(raw) && !speed.HasValue && !hasCharging)
        {
            return null;
        }

        return new VehicleHeaderTelemetry(raw, speed, VehicleHeaderJson.Bool(state, "is_charging") ?? false);
    }
}

/// <summary>
/// One resolved header snapshot — the vehicle identity plus its (optional) live state. The native analogue of
/// the <c>{ vehicle, state }</c> props the web vehicle-detail page hands <c>&lt;VehicleHeader /&gt;</c>. Cached
/// as JSON so the snapshot round-trips losslessly through the shared cache-then-network engine. Pure data.
/// </summary>
/// <param name="Vehicle">The resolved vehicle identity (or <see cref="VehicleHeaderVehicle.None"/>).</param>
/// <param name="State">The vehicle's live state, or <see langword="null"/> when asleep / stateless.</param>
public sealed record VehicleHeaderData(VehicleHeaderVehicle Vehicle, VehicleHeaderTelemetry? State)
{
    /// <summary>The "no vehicle resolved" snapshot — the engine's empty fallback (web <c>{vehicle ? … : null}</c>).</summary>
    public static VehicleHeaderData Empty { get; } = new(VehicleHeaderVehicle.None, null);

    /// <summary>True once a real vehicle backs this snapshot.</summary>
    [JsonIgnore]
    public bool HasVehicle => Vehicle.HasVehicle;

    /// <summary>
    /// The derived display status — web <c>vehicle ? getVehicleStatus(state) : 'offline'</c>. Computed from the
    /// vehicle presence and live state, so it survives the JSON cache round-trip.
    /// </summary>
    [JsonIgnore]
    public string Status => VehicleHeaderStatus.Derive(HasVehicle ? Vehicle : null, State);
}

/// <summary>
/// The vehicle-status derivation — the native mirror of the web <c>deriveVehicleStatus</c>
/// (web/src/types/fsm/vehicle.ts) wrapped by the header's <c>vehicle ? getVehicleStatus(state) : 'offline'</c>.
/// Pure and UI-free so it is unit-tested without a host.
/// </summary>
public static class VehicleHeaderStatus
{
    /// <summary>
    /// The canonical vehicle operational states (web <c>VEHICLE_STATES</c>, web/src/types/fsm/vehicle.ts).
    /// </summary>
    public static IReadOnlyList<string> VehicleStates { get; } =
        ["online", "driving", "charging", "parked", "updating", "asleep", "offline"];

    /// <summary>
    /// Derive the display status. Mirrors the web header exactly: no vehicle ⇒ <c>offline</c>; otherwise
    /// <c>is_charging</c> ⇒ <c>charging</c>, then speed &gt; 0 ⇒ <c>driving</c>, then a recognised FSM
    /// <c>state</c> string, else <c>online</c>; a null live state ⇒ <c>offline</c>.
    /// </summary>
    /// <param name="vehicle">The resolved vehicle, or <see langword="null"/> when none exists.</param>
    /// <param name="state">The vehicle's live state, or <see langword="null"/> when asleep / stateless.</param>
    /// <returns>The lower-case status token.</returns>
    public static string Derive(VehicleHeaderVehicle? vehicle, VehicleHeaderTelemetry? state)
    {
        if (vehicle is null)
        {
            return "offline";
        }

        if (state is null)
        {
            return "offline";
        }

        if (state.IsCharging)
        {
            return "charging";
        }

        if (state.SpeedMps is { } speed && speed > 0)
        {
            return "driving";
        }

        string s = (state.RawState ?? string.Empty).Trim().ToLowerInvariant();
        return VehicleStates.Contains(s) ? s : "online";
    }

    /// <summary>
    /// The design-token brush key for the status-badge dot, mirroring the web <c>StatusBadge</c> badge-dot
    /// palette (online green, driving/parked/updating info, charging amber, asleep purple, offline red,
    /// otherwise neutral) mapped to the nearest themed token so light / dark / high-contrast stay legible.
    /// </summary>
    /// <param name="status">The raw FSM status string.</param>
    /// <returns>The design-token brush key for the dot.</returns>
    public static string AccentKey(string? status) => (status ?? string.Empty).Trim().ToLowerInvariant() switch
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
}

/// <summary>
/// The projected, render-ready header model — the vehicle name, status token + its accent brush key, the
/// model/trim/VIN subtitle and the spoken accessibility name. Always populated (never hidden); the
/// <see cref="Empty"/> projection carries the localized fallback name and the offline status. Pure data.
/// </summary>
/// <param name="Name">The header title (web <c>display_name || vin || t('common.vehicle')</c>).</param>
/// <param name="Subtitle">The model/trim/VIN subtitle, or empty when none is known.</param>
/// <param name="Status">The lower-case status token (web <c>getVehicleStatus</c>).</param>
/// <param name="StatusAccentKey">The design-token brush key for the status dot.</param>
/// <param name="AutomationName">The spoken name for the whole header (name + status).</param>
/// <param name="HasVehicle">True when a real vehicle backs the header (the wake action is offered).</param>
public sealed record VehicleHeaderDisplay(
    string Name,
    string Subtitle,
    string Status,
    string StatusAccentKey,
    string AutomationName,
    bool HasVehicle)
{
    /// <summary>
    /// The empty projection: the localized <c>common.vehicle</c> fallback name, the offline status and no
    /// subtitle (the header bar still renders with these values, never a blank box).
    /// </summary>
    /// <param name="localizer">The i18n facade resolving the fallback name.</param>
    /// <returns>The empty display model.</returns>
    public static VehicleHeaderDisplay Empty(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string name = VehicleHeaderRegistration.TitleFallback(localizer);
        const string status = "offline";
        return new VehicleHeaderDisplay(
            name,
            string.Empty,
            status,
            VehicleHeaderStatus.AccentKey(status),
            VehicleHeaderProjection.AutomationName(name, status, localizer),
            HasVehicle: false);
    }
}

/// <summary>
/// Projects a resolved <see cref="VehicleHeaderData"/> snapshot into the render-ready
/// <see cref="VehicleHeaderDisplay"/> the view binds. Pure and UI-free so the composition is unit-tested
/// without a host — the native analogue of the web header's JSX expressions.
/// </summary>
public static class VehicleHeaderProjection
{
    /// <summary>
    /// Project one snapshot. The name follows the web <c>display_name || vin || t('common.vehicle')</c> chain;
    /// the status is the derived <see cref="VehicleHeaderData.Status"/>; the subtitle is the model/trim/VIN
    /// join.
    /// </summary>
    /// <param name="data">The resolved snapshot.</param>
    /// <param name="localizer">The i18n facade resolving the fallback name.</param>
    /// <returns>The render-ready display model.</returns>
    public static VehicleHeaderDisplay Project(VehicleHeaderData data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!data.HasVehicle)
        {
            return VehicleHeaderDisplay.Empty(localizer);
        }

        string name = !string.IsNullOrWhiteSpace(data.Vehicle.Name)
            ? data.Vehicle.Name
            : VehicleHeaderRegistration.TitleFallback(localizer);
        string status = data.Status;

        return new VehicleHeaderDisplay(
            name,
            data.Vehicle.Subtitle,
            status,
            VehicleHeaderStatus.AccentKey(status),
            AutomationName(name, status, localizer),
            HasVehicle: true);
    }

    /// <summary>
    /// The spoken accessibility name for the header: the vehicle name followed by its localized status label
    /// (e.g. "My Tesla, Charging"). Never empty.
    /// </summary>
    /// <param name="name">The header title.</param>
    /// <param name="status">The lower-case status token.</param>
    /// <param name="localizer">The i18n facade resolving the status label.</param>
    /// <returns>The spoken name.</returns>
    public static string AutomationName(string name, string status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string statusLabel = VehicleHeaderRegistration.StatusLabel(localizer, status);
        return string.Format(CultureInfo.CurrentCulture, "{0}, {1}", name, statusLabel);
    }
}

/// <summary>
/// Canonical registry metadata for the vehicle-header surface — the native mirror of the web component
/// (web/src/features/vehicles/components/VehicleHeader.tsx). Centralises the stable id, the diagnostics slug
/// and every localized string (keyed exactly as the web <c>t(...)</c> calls, with the same English fallbacks)
/// so the view and view-model stay free of literal copy.
/// </summary>
public static class VehicleHeaderRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "vehicle-header";

    /// <summary>Surface category.</summary>
    public const string Category = "vehicles";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "VehicleHeader";

    /// <summary>Localized surface name (web vehicle-detail header).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized surface name.</returns>
    public static string Name(ILocalizer localizer) =>
        Require(localizer).GetString("vehicles.detail.title", "Vehicle Detail");

    /// <summary>Title fallback when a vehicle has no name or VIN (web <c>t('common.vehicle', 'Vehicle')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized fallback title.</returns>
    public static string TitleFallback(ILocalizer localizer) =>
        Require(localizer).GetString("common.vehicle", "Vehicle");

    /// <summary>Wake-action label (web <c>t('common.wakeUp', 'Wake Up')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized wake label.</returns>
    public static string WakeLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.wakeUp", "Wake Up");

    /// <summary>Back-affordance label (web <c>&lt;Link to="/vehicles"&gt;</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized back label.</returns>
    public static string BackLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.back", "Back");

    /// <summary>Manual-refresh affordance label (native chrome).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized refresh label.</returns>
    public static string RefreshLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.refresh", "Refresh");

    /// <summary>Retry affordance label for the error surface.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized retry label.</returns>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>Loading caption while the first read is in flight (native chrome).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized loading caption.</returns>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading...");

    /// <summary>Stale-freshness chip label.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized stale label.</returns>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.stale", "Stale");

    /// <summary>Offline-freshness chip label.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized offline label.</returns>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>Empty-state message when no vehicle resolves (web <c>{vehicle ? … : null}</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized empty message.</returns>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("vehicles.emptyTitle", "No vehicles yet");

    /// <summary>Wake-success confirmation (web <c>toast.vehicles.wake.success</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized wake-success message.</returns>
    public static string WakeSuccessMessage(ILocalizer localizer) =>
        Require(localizer).GetString("toast.vehicles.wake.success", "Wake command sent");

    /// <summary>Wake-failure message (web <c>toast.vehicles.wake.error</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized wake-failure message.</returns>
    public static string WakeErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("toast.vehicles.wake.error", "Failed to wake vehicle");

    /// <summary>Hard-failure (load-error) message for the retry surface.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized load-error message.</returns>
    public static string LoadErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("vehicles.loadError", "Failed to load vehicles.");

    /// <summary>Auth-failure message for the retry surface (sign-in required).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized auth-error message.</returns>
    public static string AuthErrorMessage(ILocalizer localizer) =>
        Require(localizer).GetString("vehicles.detail.signedOut", "Sign in to view this vehicle.");

    /// <summary>Offline message shown beside the cached header.</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized offline message.</returns>
    public static string OfflineMessage(ILocalizer localizer) =>
        Require(localizer).GetString("vehicles.detail.offline", "You're offline — showing the last cached vehicle.");

    /// <summary>The localized human label for a status token (e.g. <c>charging</c> ⇒ "Charging").</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="status">The lower-case status token.</param>
    /// <returns>The localized, title-cased status label.</returns>
    public static string StatusLabel(ILocalizer localizer, string? status)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string token = (status ?? string.Empty).Trim().ToLowerInvariant();
        if (token.Length == 0)
        {
            token = "offline";
        }

        string fallback = char.ToUpperInvariant(token[0]) + token[1..];
        return localizer.GetString($"vehicle.state.{token}", fallback);
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the vehicle-header surface (P1/S11 diagnostics contract). Records only the
/// operational counters with the surface slug — never a VIN, name or vehicle id — so a diagnostics line can
/// never leak vehicle data. Thread-safe.
/// </summary>
public sealed class VehicleHeaderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _wakesRequested;
    private long _wakesSucceeded;
    private long _wakesFailed;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public VehicleHeaderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of wake commands requested.</summary>
    public long WakesRequested => Interlocked.Read(ref _wakesRequested);

    /// <summary>Number of wake commands that succeeded.</summary>
    public long WakesSucceeded => Interlocked.Read(ref _wakesSucceeded);

    /// <summary>Number of wake commands that failed.</summary>
    public long WakesFailed => Interlocked.Read(ref _wakesFailed);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleHeader</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleHeaderRegistration.Slug}");
    }

    /// <summary>Record that a wake command was requested (no vehicle id is ever logged).</summary>
    public void RecordWakeRequested()
    {
        Interlocked.Increment(ref _wakesRequested);
        _sink?.Invoke($"vehicle.wake.requested slug={VehicleHeaderRegistration.Slug}");
    }

    /// <summary>Record the resolution of a wake command (success/failure only — never the vehicle id).</summary>
    /// <param name="success">Whether the wake command was accepted.</param>
    public void RecordWakeResolved(bool success)
    {
        if (success)
        {
            Interlocked.Increment(ref _wakesSucceeded);
        }
        else
        {
            Interlocked.Increment(ref _wakesFailed);
        }

        _sink?.Invoke(
            $"vehicle.wake.resolved slug={VehicleHeaderRegistration.Slug} success={(success ? "true" : "false")}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> field readers shared by the header parse adapters. File-local so the
/// helper never leaks into the namespace.
/// </summary>
file static class VehicleHeaderJson
{
    public static bool Has(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out _);

    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out long n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s) => s,
            _ => null,
        };
    }

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out double n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out double s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
