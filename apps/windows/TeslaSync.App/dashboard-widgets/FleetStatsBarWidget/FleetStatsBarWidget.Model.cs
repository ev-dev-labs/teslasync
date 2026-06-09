using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="FleetStatsBarViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>FleetStatsBarWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. The widget composes two reads — the vehicle list (<c>useVehicles</c>)
/// and the 30-day fleet analytics rollup (<c>useFleetAnalytics(30)</c>) — so <see cref="Loading"/>
/// follows the web's combined <c>vehiclesLoading || analyticsLoading</c> gate while the header
/// freshness (<see cref="Stale"/>/<see cref="Offline"/>/<see cref="Error"/>) tracks the analytics read,
/// exactly as the web wires <c>WidgetShell</c>'s <c>updatedAt</c>/<c>isFetching</c>/<c>isStale</c>/
/// <c>isError</c> to the analytics query.
/// </summary>
public enum FleetStatsBarState
{
    /// <summary>Initial fetch with neither read resolved yet — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with fleet data to show.</summary>
    Loaded,

    /// <summary>Both reads resolved but the fleet has no vehicles and no analytics — the empty state.</summary>
    Empty,

    /// <summary>The analytics read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The merged fleet rollup the widget renders — vehicle counts from <c>GET /vehicles</c> plus the
/// distance/energy totals from <c>GET /analytics/fleet?days=30</c>. Counts mirror the web
/// <c>vehicles?.length</c> and <c>vehicles?.filter(v =&gt; v.state === 'online').length</c>; the totals
/// mirror <c>analytics?.total_distance_km</c> and <c>analytics?.total_energy_kwh</c>. Distance is carried
/// as the raw <c>total_distance_km</c> wire value (converted to the user's unit only at projection time);
/// energy is kWh. <see cref="HasVehicles"/> / <see cref="HasAnalytics"/> capture which read produced data
/// so <see cref="HasData"/> can reproduce the web's <c>(vehicles &amp;&amp; vehicles.length &gt; 0) || analytics</c>
/// gate. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record FleetStats(
    int VehicleCount,
    int OnlineCount,
    double TotalDistanceKm,
    double TotalEnergyKwh,
    bool HasVehicles,
    bool HasAnalytics)
{
    /// <summary>An all-zero rollup with neither read present — the projection/parse fallback.</summary>
    public static FleetStats Empty { get; } = new(0, 0, 0, 0, false, false);

    /// <summary>
    /// True when there is something to render — at least one vehicle or a resolved analytics object
    /// (web <c>hasData = (vehicles &amp;&amp; vehicles.length &gt; 0) || analytics</c>). Gates the empty state.
    /// </summary>
    public bool HasData => HasVehicles || HasAnalytics;

    /// <summary>
    /// Tally the vehicle list endpoint payload into a total and an online count. Mirrors the web
    /// <c>vehicleCount = vehicles?.length</c> and <c>onlineCount = vehicles?.filter(v =&gt; v.state ===
    /// 'online').length</c>. A non-array body yields zero, and the <c>state</c> match is case-sensitive
    /// ordinal like the web <c>===</c>.
    /// </summary>
    public static (int Count, int Online) TallyVehicles(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return (0, 0);
        }

        int count = 0;
        int online = 0;
        foreach (var vehicle in element.EnumerateArray())
        {
            count++;
            if (vehicle.ValueKind == JsonValueKind.Object &&
                vehicle.TryGetProperty("state", out var state) &&
                state.ValueKind == JsonValueKind.String &&
                string.Equals(state.GetString(), "online", StringComparison.Ordinal))
            {
                online++;
            }
        }

        return (count, online);
    }

    /// <summary>
    /// Read the fleet-analytics rollup's distance (<c>total_distance_km</c>) and energy
    /// (<c>total_energy_kwh</c>) from a <c>GET /analytics/fleet</c> object. Tolerant of missing fields
    /// (defaults to zero) and of numeric strings, mirroring the web's <c>?? 0</c> guards.
    /// </summary>
    public static (double DistanceKm, double EnergyKwh) ReadFleet(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return (0, 0);
        }

        return (GetDouble(element, "total_distance_km") ?? 0, GetDouble(element, "total_energy_kwh") ?? 0);
    }

    private static double? GetDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.rows &lt; 2</c> logic in
/// web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx (note the web gates compact on ROWS, not
/// columns). The web always asks <c>WidgetStatGrid</c> for <c>cols={4}</c>; its container query then
/// collapses a wide 4-up grid to 2-up on narrow widgets, which <see cref="GridColumns"/> approximates
/// from the footprint width.
/// </summary>
public readonly record struct FleetStatsBarSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (4×2).</summary>
    public static FleetStatsBarSize Default => new(4, 2);

    /// <summary>True at a single row (web <c>isCompact = size.rows &lt; 2</c>): stack the tiles 1-up.</summary>
    public bool IsCompact => Rows < 2;

    /// <summary>
    /// Stat-grid column count. Compact stacks 1-up; a full 4-wide footprint shows the 4-up grid the web
    /// requests (<c>cols={4}</c>); a narrower 3-wide footprint collapses to 2-up, mirroring the web
    /// container query that turns <c>grid-cols-2 @sm:grid-cols-4</c> into 2 columns when narrow.
    /// </summary>
    public int GridColumns => IsCompact ? 1 : (Cols >= 4 ? 4 : 2);
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view. Holds the localized label, the
/// already-formatted value, the optional unit suffix, the resolved Fluent glyph, a Narrator automation
/// name, and the optional <see cref="Subtitle"/> the web computes as a <c>trendValue</c>. Pure data — no
/// WinUI types.
/// </summary>
public sealed record FleetStatItem(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    string AutomationName,
    string? Subtitle);

/// <summary>
/// The fully projected, render-ready view of the fleet stats for one footprint — the native analogue of
/// the <c>items</c> <c>useMemo</c> in web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx. Holds
/// the four stat tiles (vehicles, online now, distance, energy) plus the footprint flags. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record FleetStatsBarDisplay(
    bool HasData,
    bool IsCompact,
    int GridColumns,
    IReadOnlyList<FleetStatItem> Stats);

/// <summary>
/// Pure projection from a merged <see cref="FleetStats"/> to the display model — the native port of the
/// <c>stats</c> + <c>items</c> <c>useMemo</c>s in
/// web/src/features/dashboard/widgets/FleetStatsBarWidget.tsx. The distance total is converted to the
/// user's display unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class FleetStatsBarProjection
{
    /// <summary>Fluent glyph for the surface header / empty state (web <c>Car</c>, accent-tinted).</summary>
    public const string HeaderGlyph = "\uE804"; // Car

    private const string VehiclesGlyph = "\uE804"; // Car
    private const string OnlineGlyph = "\uE701";   // Wifi
    private const string DistanceGlyph = "\uE816"; // MapDirections / route
    private const string EnergyGlyph = "\uE945";   // Lightning / energy

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the user's units.</summary>
    public static FleetStatsBarDisplay Project(
        FleetStats data,
        FleetStatsBarSize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);

        // Web parity (FleetStatsBarWidget.tsx L19, L28): the raw `total_distance_km` value is passed
        // straight into `convertDistanceFromSI` — the SI(metres) converter — with no km→m scaling, so we
        // reproduce that exact arithmetic. (The sibling AnalyticsSummaryWidget instead scales `* 1000`;
        // the two web surfaces genuinely differ, and this port mirrors each verbatim.)
        double totalDistance = UnitConverters.DistanceFromSi(data.TotalDistanceKm, distanceUnit);
        double totalEnergy = data.TotalEnergyKwh;

        string vehiclesLabel = localizer.GetString("widget.fleetStatsBar.vehicles", "Vehicles");
        string onlineNowLabel = localizer.GetString("widget.fleetStatsBar.onlineNow", "Online Now");
        string distanceLabel = localizer.GetString("widget.fleetStatsBar.distance30d", "Distance (30d)");
        string energyLabel = localizer.GetString("widget.fleetStatsBar.energy30d", "Energy (30d)");
        string onlineWord = localizer.GetString("widget.fleetStatsBar.online", "online");

        string vehiclesValue = ScalarFormatters.FormatNumber(data.VehicleCount, 0);
        string onlineValue = ScalarFormatters.FormatNumber(data.OnlineCount, 0);
        string distanceValue = ScalarFormatters.FormatNumber(totalDistance, 1);
        string energyValue = ScalarFormatters.FormatNumber(totalEnergy, 1);

        // Web parity (FleetStatsBarWidget.tsx L48, L54): these trend strings are computed on the stat
        // items, but `WidgetStatGrid` only renders a `trendValue` when a `trend` direction is also set —
        // which these items do not provide — so the web leaves them unshown. We compute them identically
        // (resolving the `online` key) for accessibility/parity; the view mirrors the web by not
        // rendering them.
        string onlineSubtitle = string.Format(CultureInfo.CurrentCulture, "{0} {1}", onlineValue, onlineWord);
        string? onlinePctSubtitle = data.VehicleCount > 0
            ? ScalarFormatters.FormatPercentage((double)data.OnlineCount / data.VehicleCount * 100, 0)
            : null;

        var stats = new List<FleetStatItem>(4)
        {
            new(vehiclesLabel, vehiclesValue, null, VehiclesGlyph, StatAutomationName(vehiclesLabel, vehiclesValue, null), onlineSubtitle),
            new(onlineNowLabel, onlineValue, null, OnlineGlyph, StatAutomationName(onlineNowLabel, onlineValue, null), onlinePctSubtitle),
            new(distanceLabel, distanceValue, distanceUnitLabel, DistanceGlyph, StatAutomationName(distanceLabel, distanceValue, distanceUnitLabel), null),
            new(energyLabel, energyValue, "kWh", EnergyGlyph, StatAutomationName(energyLabel, energyValue, "kWh"), null),
        };

        return new FleetStatsBarDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            GridColumns: size.GridColumns,
            Stats: stats);
    }

    private static string StatAutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Merges the engine's two raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions (the vehicle list and
/// the fleet-analytics rollup) into one parsed <c>RepositoryResult&lt;FleetStats&gt;</c>, reproducing the
/// web <c>FleetStatsBarWidget</c>'s composition: the combined loading gate
/// (<c>vehiclesLoading || analyticsLoading</c>), the analytics-driven header freshness, the hard-error
/// surface (the web's truthy <c>error</c> on the analytics query), and the
/// <c>(vehicles &amp;&amp; vehicles.length &gt; 0) || analytics</c> empty gate. Kept pure so the
/// combine contract is unit-tested without a network or cache.
/// </summary>
public static class FleetStatsBarResultMapper
{
    /// <summary>Combine the latest <paramref name="vehicles"/> and <paramref name="fleet"/> emissions.</summary>
    public static RepositoryResult<FleetStats> Combine(
        RepositoryResult<JsonElement> vehicles,
        RepositoryResult<JsonElement> fleet)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(fleet);

        // Web: isLoading = vehiclesLoading || analyticsLoading — skeleton until BOTH reads resolve once.
        if (vehicles.Status == LoadStatus.Loading || fleet.Status == LoadStatus.Loading)
        {
            return RepositoryResult<FleetStats>.Loading();
        }

        var (count, online) = HasContent(vehicles) ? FleetStats.TallyVehicles(vehicles.Value) : (0, 0);
        var (distanceKm, energyKwh) = HasContent(fleet) ? FleetStats.ReadFleet(fleet.Value) : (0d, 0d);
        bool hasVehicles = count > 0;        // web: vehicles && vehicles.length > 0
        bool hasAnalytics = HasContent(fleet);  // web: analytics (the resolved query object is truthy)
        var stats = new FleetStats(count, online, distanceKm, energyKwh, hasVehicles, hasAnalytics);

        // Web: WidgetShell renders <QueryError> whenever the analytics query's `error` is truthy, i.e. a
        // hard failure with no cached object to fall back to. This wins over the body even when the
        // vehicle read succeeded.
        if (fleet.Status == LoadStatus.Error)
        {
            return RepositoryResult<FleetStats>.Failure(
                fleet.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load fleet stats"));
        }

        // Web: the hasData gate renders <EmptyState> when neither read carries data.
        if (!stats.HasData)
        {
            return RepositoryResult<FleetStats>.Empty(fleet.FetchedAt ?? vehicles.FetchedAt);
        }

        // Content. The header freshness tracks the analytics (fleet) read exactly as the web wires it.
        var fetchedAt = fleet.FetchedAt ?? vehicles.FetchedAt ?? DateTimeOffset.UtcNow;
        return fleet.Status switch
        {
            LoadStatus.Offline => RepositoryResult<FleetStats>.OfflineCached(
                stats, fetchedAt, fleet.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A fleet read is unavailable")),
            LoadStatus.Cached => RepositoryResult<FleetStats>.Cached(stats, fetchedAt, fleet.IsStale),
            LoadStatus.Refreshing => RepositoryResult<FleetStats>.Refreshing(stats, fetchedAt, fleet.IsStale),
            _ => RepositoryResult<FleetStats>.Loaded(stats, fetchedAt),
        };
    }

    // RepositoryResult&lt;JsonElement&gt;.HasValue is unreliable: default(JsonElement) is a non-null struct
    // (ValueKind=Undefined), so a read with no body still reports HasValue=true. The value-bearing status is
    // therefore the source of truth for "this read produced a payload" (the same rule DigitalTwinSignals uses).
    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;
}
