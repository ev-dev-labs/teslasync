using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="CommandsPageViewModel"/> can be in — the native
/// union of the loading / success / empty branches the web <c>CommandsPage</c> renders through
/// <c>PageContainer</c> (web/src/features/system/pages/CommandsPage.tsx). Every branch maps onto a visible
/// surface; none is hidden. <see cref="Empty"/> models the resolved-but-no-vehicles roster (the web
/// <c>vehicles?.length</c> falsy gate) rather than an empty HTTP body, and — mirroring the web page, which has
/// no error boundary over its <c>useVehicles</c> read — a hard vehicles-fetch failure also resolves to
/// <see cref="Empty"/> (the page shows its "no vehicles" affordance). The per-vehicle live-state failure is a
/// separate, non-fatal overlay (<see cref="CommandsDisplay.HasStatesError"/>), exactly as the web
/// <c>statesError</c> banner is independent of the page body.
/// </summary>
public enum CommandsState
{
    /// <summary>Initial vehicles fetch with no cached roster — render the skeleton centres (web <c>loading</c>).</summary>
    Loading,

    /// <summary>A resolved roster with at least one vehicle — render the stats + command centres (web success).</summary>
    Loaded,

    /// <summary>A resolved (or failed) read with no vehicles — render the "no vehicles found" affordance.</summary>
    Empty,
}

/// <summary>
/// One vehicle from the roster the page reads from <c>GET /vehicles</c> (web <c>useVehicles</c>). Only the
/// fields the page + per-vehicle command-centre header render are kept: the <see cref="Id"/> (used to read
/// that vehicle's live state), the user-set <see cref="DisplayName"/> (web <c>display_name</c>), the
/// <see cref="Vin"/> (the name fallback + the "model · vin" sub-line), the <see cref="Model"/> code, the FSM
/// <see cref="State"/> string that drives the online/asleep tally, and the <see cref="UpdatedAt"/> timestamp
/// that feeds the freshness pill. Parsing is null-tolerant so a partial body never throws.
/// </summary>
/// <param name="Id">The vehicle id (web <c>id</c>).</param>
/// <param name="Vin">The VIN (web <c>vin</c>) — the display-name fallback and sub-line tail.</param>
/// <param name="DisplayName">The user-set name (web <c>display_name</c>).</param>
/// <param name="Model">The model code (web <c>model</c>).</param>
/// <param name="State">The FSM state string (web <c>state</c>) — e.g. <c>online</c> / <c>asleep</c> / <c>offline</c>.</param>
/// <param name="UpdatedAt">The last-update timestamp (web <c>updated_at</c>) for the freshness pill.</param>
public sealed record CommandsVehicle(
    long Id,
    string Vin,
    string DisplayName,
    string Model,
    string State,
    DateTimeOffset? UpdatedAt)
{
    private const string AsleepState = "asleep";
    private const string OfflineState = "offline";

    /// <summary>
    /// True when the vehicle is asleep or offline (web <c>isAsleep = state === 'asleep' || state === 'offline'</c>).
    /// Drives the neutral-vs-success state badge and excludes the vehicle from the online tally.
    /// </summary>
    [JsonIgnore]
    public bool IsAsleep =>
        string.Equals(State, AsleepState, StringComparison.OrdinalIgnoreCase)
        || string.Equals(State, OfflineState, StringComparison.OrdinalIgnoreCase);

    /// <summary>True when the vehicle counts toward the online tally (web filter <c>state !== 'asleep' &amp;&amp; state !== 'offline'</c>).</summary>
    [JsonIgnore]
    public bool CountsOnline => !IsAsleep;

    /// <summary>Project one <c>GET /vehicles</c> array entry, or <see langword="null"/> for a non-object element.</summary>
    /// <param name="element">A single array element.</param>
    /// <returns>The parsed vehicle, or <see langword="null"/>.</returns>
    public static CommandsVehicle? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new CommandsVehicle(
            Id: CommandsJson.Long(element, "id") ?? 0,
            Vin: CommandsJson.String(element, "vin") ?? string.Empty,
            DisplayName: CommandsJson.String(element, "display_name") ?? string.Empty,
            Model: CommandsJson.String(element, "model") ?? string.Empty,
            State: CommandsJson.String(element, "state") ?? string.Empty,
            UpdatedAt: CommandsJson.DateTime(element, "updated_at"));
    }

    /// <summary>Project every object entry of a <c>GET /vehicles</c> array (web <c>vehicles</c>).</summary>
    /// <param name="root">The parsed roster body.</param>
    /// <returns>The roster in document order; empty for a non-array body.</returns>
    public static IReadOnlyList<CommandsVehicle> FromArray(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CommandsVehicle>();
        }

        var list = new List<CommandsVehicle>(root.GetArrayLength());
        foreach (var element in root.EnumerateArray())
        {
            if (CommandsVehicle.FromJson(element) is { } vehicle)
            {
                list.Add(vehicle);
            }
        }

        return list;
    }
}

/// <summary>
/// The three live-state fields the per-vehicle command-centre header shows, read from
/// <c>GET /vehicles/{vehicleID}/state</c> (web <c>data.state</c>): the <see cref="BatteryLevel"/> percentage,
/// the SI <see cref="RatedRangeMeters"/> (web <c>rated_range</c>, metres — converted only at the display
/// boundary) and the SI <see cref="InsideTempC"/> (web <c>inside_temp</c>, °C). All are nullable so a partial
/// or absent state mirrors the web optional chains.
/// </summary>
/// <param name="BatteryLevel">Battery percentage 0..100 (web <c>battery_level</c>).</param>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>rated_range</c>).</param>
/// <param name="InsideTempC">Cabin temperature in SI °C (web <c>inside_temp</c>), or null when absent.</param>
public sealed record CommandsLiveState(
    double? BatteryLevel,
    double? RatedRangeMeters,
    double? InsideTempC)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the header slice, mirroring the web
    /// <c>data.state ?? null</c> read: the canonical <c>state</c> object's three header fields. Returns
    /// <see langword="null"/> when the body carries no <c>state</c> object (web <c>?? null</c>).
    /// </summary>
    /// <param name="root">The parsed state response body.</param>
    /// <returns>The parsed header slice, or <see langword="null"/>.</returns>
    public static CommandsLiveState? FromResponse(JsonElement root)
    {
        if (CommandsJson.Object(root, "state") is not { } state)
        {
            return null;
        }

        return new CommandsLiveState(
            BatteryLevel: CommandsJson.Double(state, "battery_level"),
            RatedRangeMeters: CommandsJson.Double(state, "rated_range"),
            InsideTempC: CommandsJson.Double(state, "inside_temp"));
    }
}

/// <summary>
/// One roster vehicle paired with its (nullable) live state — the serializable analogue of one
/// <c>statesMap</c> entry the web page assembles (<c>[v.id, data.state ?? null]</c>). A null
/// <see cref="State"/> mirrors the web per-vehicle <c>catch</c> resolving the entry to <c>null</c>.
/// </summary>
/// <param name="VehicleId">The vehicle id the live state belongs to.</param>
/// <param name="State">The vehicle's live state, or <see langword="null"/> when unavailable.</param>
public sealed record CommandsVehicleState(long VehicleId, CommandsLiveState? State);

/// <summary>
/// The resolved reading cached by the source: the vehicle <see cref="Vehicles"/> roster, the per-vehicle live
/// <see cref="States"/> (one entry per roster vehicle, the live state null when that vehicle's state read
/// failed) and the optional <see cref="StatesError"/> message (the web <c>statesError</c> — set only when the
/// live-state assembly fails systemically). Serialized to the cache as JSON so the cache-then-network read
/// round-trips losslessly.
/// </summary>
/// <param name="Vehicles">The vehicle roster (web <c>vehicles</c>).</param>
/// <param name="States">The per-vehicle live states (web <c>statesMap</c> entries).</param>
/// <param name="StatesError">The live-state failure message (web <c>statesError</c>), or null.</param>
public sealed record CommandsSnapshot(
    IReadOnlyList<CommandsVehicle> Vehicles,
    IReadOnlyList<CommandsVehicleState> States,
    string? StatesError)
{
    /// <summary>The "nothing resolved" snapshot — the parse / loading fallback.</summary>
    public static CommandsSnapshot Empty { get; } =
        new(Array.Empty<CommandsVehicle>(), Array.Empty<CommandsVehicleState>(), null);

    /// <summary>True when the roster carries at least one vehicle (web <c>vehicles &amp;&amp; vehicles.length > 0</c>).</summary>
    [JsonIgnore]
    public bool HasVehicles => Vehicles.Count > 0;

    /// <summary>True when there is anything to show — at least one vehicle (gates the page-level empty state).</summary>
    [JsonIgnore]
    public bool HasData => HasVehicles;

    /// <summary>Resolve the live state for <paramref name="vehicleId"/> (web <c>states[v.id] ?? null</c>).</summary>
    /// <param name="vehicleId">The vehicle id to look up.</param>
    /// <returns>The live state, or <see langword="null"/> when absent.</returns>
    public CommandsLiveState? StateFor(long vehicleId)
    {
        foreach (var entry in States)
        {
            if (entry.VehicleId == vehicleId)
            {
                return entry.State;
            }
        }

        return null;
    }
}

/// <summary>
/// One projected, render-ready stat tile — the native analogue of one web <c>&lt;MetricCard&gt;</c>. Holds a
/// stable <see cref="Key"/> (for parity assertions), the localized <see cref="Label"/>, the already-formatted
/// <see cref="Value"/>, the token brush key for the accent rail and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
/// <param name="Key">Stable identity (<c>vehicles</c> / <c>online</c> / <c>asleep</c> / <c>refresh</c>).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted display value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the accent rail.</param>
/// <param name="AutomationName">The composed "label: value" Narrator name.</param>
public sealed record CommandsMetric(
    string Key,
    string Label,
    string Value,
    string AccentBrushKey,
    string AutomationName);

/// <summary>
/// One projected, render-ready per-vehicle command centre — the native analogue of the web
/// <c>VehicleCommandCenter</c> header region (its identity + live-state readout). The interactive command
/// catalogue (search / favourites / category tiles) is delivered by the separately-tracked
/// <c>CommandTile</c> / <c>CommandSearch</c> / <c>CollapsibleCommandGroup</c> parity units; this page-level
/// projection reproduces the centre's header so the success state renders one centre per roster vehicle. SI
/// range/temperature are converted at projection time using the active units; every value is pre-formatted.
/// </summary>
/// <param name="Id">The vehicle id.</param>
/// <param name="Name">The display name (web <c>display_name || vin</c>).</param>
/// <param name="StateLabel">The FSM state label shown in the badge (web <c>vehicle.state</c>).</param>
/// <param name="IsAsleep">True when asleep/offline (neutral badge) vs online (success badge).</param>
/// <param name="UpdatedAt">The last-update timestamp for the freshness pill (web <c>updated_at</c>).</param>
/// <param name="ModelVin">The "model · vin" sub-line (web <c>{model} · {vin}</c>).</param>
/// <param name="HasLiveState">True when a live state backs the readouts (web <c>state &amp;&amp; …</c>).</param>
/// <param name="BatteryText">The battery readout (web <c>{battery_level}%</c>).</param>
/// <param name="BatteryHigh">True when battery &gt; 50 (emerald) vs ≤ 50 (amber).</param>
/// <param name="RangeText">The range readout (web converted <c>rated_range</c> + unit).</param>
/// <param name="HasTemp">True when the cabin temperature is present (web <c>inside_temp != null</c>).</param>
/// <param name="TempText">The temperature readout (web converted <c>inside_temp</c> + unit).</param>
/// <param name="AutomationName">The composed Narrator name for the centre.</param>
public sealed record CommandsVehicleCenter(
    long Id,
    string Name,
    string StateLabel,
    bool IsAsleep,
    DateTimeOffset? UpdatedAt,
    string ModelVin,
    bool HasLiveState,
    string BatteryText,
    bool BatteryHigh,
    string RangeText,
    bool HasTemp,
    string TempText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the page — the native analogue of everything the web component
/// computes before returning JSX. Holds the localized header (title + subtitle + the "View History" link +
/// the online tally), the four stat tiles (or the "no data" affordance), the non-fatal states-error banner
/// and the per-vehicle command centres (or the "no vehicles" affordance). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive lifecycle state.</param>
/// <param name="Title">The localized visible header title (web <c>commands.pageTitle</c>).</param>
/// <param name="Subtitle">The localized header subtitle (web <c>commands.subtitle</c>).</param>
/// <param name="DocumentTitle">The localized document/nav title (web <c>commands.title</c>).</param>
/// <param name="AutomationName">The page-level Narrator name.</param>
/// <param name="ViewHistoryText">The "View History" link label (web <c>commands.viewHistory</c>).</param>
/// <param name="HasVehicles">True when the stat tiles show (false renders the "no data" affordance).</param>
/// <param name="OnlineCount">The number of online vehicles.</param>
/// <param name="TotalCount">The total number of vehicles.</param>
/// <param name="OnlineCountText">The formatted online count (the emerald numerator in the tally).</param>
/// <param name="TotalCountText">The formatted total count (the tally denominator).</param>
/// <param name="OnlineWord">The localized "online" word (web <c>online</c>).</param>
/// <param name="OnlineSummaryAutomationName">The composed "online/total online" Narrator name.</param>
/// <param name="Metrics">The four stat tiles (vehicles / online / asleep / refresh).</param>
/// <param name="NoDataMessage">The stats empty-state message (web <c>common.noData</c>).</param>
/// <param name="HasStatesError">True when the non-fatal states-error banner shows (web <c>statesError</c>).</param>
/// <param name="StatesErrorText">The states-error banner text (web <c>commands.statesError</c> + detail).</param>
/// <param name="NoVehiclesTitle">The empty-state heading (web <c>commands.noVehicles</c>).</param>
/// <param name="ConnectFleetMessage">The empty-state message (web <c>commands.connectFleet</c>).</param>
/// <param name="Centers">The per-vehicle command centres (web <c>VehicleCommandCenter</c> headers).</param>
public sealed record CommandsDisplay(
    CommandsState State,
    string Title,
    string Subtitle,
    string DocumentTitle,
    string AutomationName,
    string ViewHistoryText,
    bool HasVehicles,
    int OnlineCount,
    int TotalCount,
    string OnlineCountText,
    string TotalCountText,
    string OnlineWord,
    string OnlineSummaryAutomationName,
    IReadOnlyList<CommandsMetric> Metrics,
    string NoDataMessage,
    bool HasStatesError,
    string StatesErrorText,
    string NoVehiclesTitle,
    string ConnectFleetMessage,
    IReadOnlyList<CommandsVehicleCenter> Centers)
{
    /// <summary>True when the loading skeleton centres should be shown (web <c>isLoading</c>).</summary>
    [JsonIgnore]
    public bool ShowLoading => State == CommandsState.Loading;

    /// <summary>True when the resolved content (stats + command centres) should be shown (web success).</summary>
    [JsonIgnore]
    public bool ShowContent => State == CommandsState.Loaded;

    /// <summary>True when the "no vehicles" empty affordance should be shown (web empty).</summary>
    [JsonIgnore]
    public bool ShowEmptyVehicles => State == CommandsState.Empty;

    /// <summary>True when the stat tiles should be shown; false renders the "no data" affordance (web <c>vehicles?.length</c>).</summary>
    [JsonIgnore]
    public bool ShowStats => HasVehicles;
}

/// <summary>
/// Pure projection from a raw <see cref="CommandsSnapshot"/> to the <see cref="CommandsDisplay"/> — the native
/// port of everything the web component renders. SI range/temperature is converted to the user's display unit
/// here (and only here); every label resolves through the i18n facade with the same web key names.
/// </summary>
public static class CommandsProjection
{
    /// <summary>Accent rail brush for the Vehicles tile (web <c>color="cyan"</c>).</summary>
    public const string CyanAccentBrushKey = "TsChartSpeedBrush";

    /// <summary>Accent rail brush for the Online tile (web <c>color="green"</c>).</summary>
    public const string GreenAccentBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent rail brush for the Asleep tile (web <c>color="amber"</c>).</summary>
    public const string AmberAccentBrushKey = "TsColorWarningBrush";

    /// <summary>Accent rail brush for the Refresh tile (web <c>color="purple"</c>).</summary>
    public const string PurpleAccentBrushKey = "TsChartPowerBrush";

    /// <summary>The fixed refresh-interval label the web shows (web <c>value="15s"</c>).</summary>
    public const string RefreshValue = "15s";

    private const string MiddleDot = " \u00B7 ";

    /// <summary>Project <paramref name="snapshot"/> in <paramref name="state"/> using the user's units.</summary>
    /// <param name="snapshot">The resolved reading.</param>
    /// <param name="state">The lifecycle state to render.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static CommandsDisplay Project(
        CommandsSnapshot snapshot,
        CommandsState state,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var vehicles = snapshot.Vehicles;
        int total = vehicles.Count;
        int online = 0;
        foreach (var vehicle in vehicles)
        {
            if (vehicle.CountsOnline)
            {
                online++;
            }
        }

        int asleep = total - online;

        string title = localizer.GetString("commands.pageTitle", "Vehicle Commands");
        string subtitle = localizer.GetString("commands.subtitle", "Remote control center for your Tesla fleet");
        string documentTitle = localizer.GetString("commands.title", "Commands");
        string onlineWord = localizer.GetString("online", "online");

        var metrics = new List<CommandsMetric>(4)
        {
            Metric("vehicles", localizer.GetString("Vehicles", "Vehicles"), Count(total), CyanAccentBrushKey),
            Metric("online", localizer.GetString("Online", "Online"), Count(online), GreenAccentBrushKey),
            Metric("asleep", localizer.GetString("Asleep", "Asleep"), Count(asleep), AmberAccentBrushKey),
            Metric("refresh", localizer.GetString("Refresh", "Refresh"), RefreshValue, PurpleAccentBrushKey),
        };

        bool hasStatesError = !string.IsNullOrWhiteSpace(snapshot.StatesError);
        string statesErrorHeading = localizer.GetString("commands.statesError", "Failed to load vehicle states");
        string statesErrorText = hasStatesError ? Compose(statesErrorHeading, snapshot.StatesError!) : statesErrorHeading;

        var centers = new List<CommandsVehicleCenter>(total);
        foreach (var vehicle in vehicles)
        {
            centers.Add(Center(vehicle, snapshot.StateFor(vehicle.Id), units));
        }

        string onlineAutomation = string.Format(
            CultureInfo.CurrentCulture, "{0}/{1} {2}", Count(online), Count(total), onlineWord);

        return new CommandsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            DocumentTitle: documentTitle,
            AutomationName: documentTitle,
            ViewHistoryText: localizer.GetString("commands.viewHistory", "View History"),
            HasVehicles: total > 0,
            OnlineCount: online,
            TotalCount: total,
            OnlineCountText: Count(online),
            TotalCountText: Count(total),
            OnlineWord: onlineWord,
            OnlineSummaryAutomationName: onlineAutomation,
            Metrics: metrics,
            NoDataMessage: localizer.GetString("common.noData", "No data available"),
            HasStatesError: hasStatesError,
            StatesErrorText: statesErrorText,
            NoVehiclesTitle: localizer.GetString("commands.noVehicles", "No vehicles found"),
            ConnectFleetMessage: localizer.GetString(
                "commands.connectFleet",
                "Connect your Tesla account and sync your fleet to start sending commands."),
            Centers: centers);
    }

    private static CommandsVehicleCenter Center(CommandsVehicle vehicle, CommandsLiveState? state, UnitPref units)
    {
        string name = !string.IsNullOrWhiteSpace(vehicle.DisplayName) ? vehicle.DisplayName.Trim() : vehicle.Vin;
        string model = vehicle.Model?.Trim() ?? string.Empty;
        string modelVin = string.IsNullOrEmpty(model) ? vehicle.Vin : model + MiddleDot + vehicle.Vin;

        bool hasLiveState = state is not null;
        double battery = state?.BatteryLevel ?? 0;
        string batteryText = string.Format(
            CultureInfo.CurrentCulture, "{0}%", ScalarFormatters.FormatNumber(battery, 0));
        bool batteryHigh = battery > 50;

        double rangeDisplay = UnitConverters.DistanceFromSi(state?.RatedRangeMeters ?? 0, units.Distance);
        string rangeText = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatNumber(rangeDisplay, 0),
            UnitLabels.Label(units.Distance));

        bool hasTemp = state?.InsideTempC is not null;
        string tempText = hasTemp
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0}{1}",
                ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(state!.InsideTempC!.Value, units.Temperature), 0),
                UnitLabels.Label(units.Temperature))
            : string.Empty;

        string automation = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", name, vehicle.State);

        return new CommandsVehicleCenter(
            Id: vehicle.Id,
            Name: name,
            StateLabel: vehicle.State,
            IsAsleep: vehicle.IsAsleep,
            UpdatedAt: vehicle.UpdatedAt,
            ModelVin: modelVin,
            HasLiveState: hasLiveState,
            BatteryText: batteryText,
            BatteryHigh: batteryHigh,
            RangeText: rangeText,
            HasTemp: hasTemp,
            TempText: tempText,
            AutomationName: automation);
    }

    private static CommandsMetric Metric(string key, string label, string value, string accentBrushKey) =>
        new(key, label, value, accentBrushKey,
            string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));

    private static string Count(int value) => ScalarFormatters.FormatNumber(value, 0);

    private static string Compose(string heading, string detail) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", heading, detail);
}

/// <summary>
/// Canonical registry metadata for the Commands surface — the native mirror of the web route entry
/// (route <c>/commands</c>, nav name <c>Commands</c>). The shell page factory binds this surface under the
/// same route name.
/// </summary>
public static class CommandsRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> Page("Commands", "commands", …)).</summary>
    public const string RouteName = "Commands";

    /// <summary>The web route path the page mirrors.</summary>
    public const string Route = "commands";

    /// <summary>The route the "View History" link navigates to (web <c>Link to="/command-history"</c>).</summary>
    public const string CommandHistoryRoute = "command-history";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CommandsPage";

    /// <summary>The shared cache key for the assembled commands snapshot.</summary>
    public const string CacheKey = "system:commands";

    /// <summary>The per-vehicle live-state refresh cadence in milliseconds (web <c>refetchInterval: 15_000</c>).</summary>
    public const int RefreshIntervalMs = 15_000;

    /// <summary>The localized document/nav title (web <c>commands.title</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("commands.title", "Commands");
    }
}

/// <summary>
/// PII-safe diagnostics for the Commands surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a VIN, vehicle name or fleet metric — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CommandsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public CommandsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CommandsRegistration.Slug}");
    }
}

/// <summary>
/// The data port the <see cref="CommandsPageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="CommandsSnapshot"/> readings — the native analogue of
/// the web page's <c>useVehicles</c> + per-vehicle <c>useQuery</c> state composition. The view never performs
/// HTTP itself; the concrete <see cref="CommandsSource"/> (or a test fake) drives this.
/// </summary>
public interface ICommandsSource
{
    /// <summary>Stream the cache-then-network commands snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<CommandsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The default <see cref="ICommandsSource"/> — resolves every read to the empty snapshot (the empty data
/// state). The shell uses this until a host wires the generated-client-backed <see cref="CommandsSource"/>.
/// </summary>
public sealed class EmptyCommandsSource : ICommandsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyCommandsSource Instance { get; } = new();

    private EmptyCommandsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<CommandsSnapshot>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<CommandsSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>Null-tolerant JSON readers shared by the commands parsers (snake_case primary, camelCase fallback).</summary>
internal static class CommandsJson
{
    public static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object
        && parent.TryGetProperty(name, out var v)
        && v.ValueKind == JsonValueKind.Object
            ? v
            : null;

    public static string? String(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        return v?.ValueKind == JsonValueKind.String ? v.Value.GetString() : null;
    }

    public static long? Long(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetInt64(out var n) => n,
            JsonValueKind.Number when e.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(e.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static double? Double(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v is not { } e)
        {
            return null;
        }

        return e.ValueKind switch
        {
            JsonValueKind.Number when e.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(e.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static DateTimeOffset? DateTime(JsonElement parent, string name)
    {
        var v = Property(parent, name);
        if (v?.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.Value.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    private static JsonElement? Property(JsonElement parent, string snakeName)
    {
        if (parent.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (parent.TryGetProperty(snakeName, out var direct))
        {
            return direct;
        }

        string camel = ToCamelCase(snakeName);
        return !string.Equals(camel, snakeName, StringComparison.Ordinal) && parent.TryGetProperty(camel, out var alt)
            ? alt
            : null;
    }

    private static string ToCamelCase(string snake)
    {
        if (!snake.Contains('_', StringComparison.Ordinal))
        {
            return snake;
        }

        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
        {
            return snake;
        }

        var builder = new StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            string part = parts[i];
            builder.Append(char.ToUpperInvariant(part[0]));
            if (part.Length > 1)
            {
                builder.Append(part, 1, part.Length - 1);
            }
        }

        return builder.ToString();
    }
}
