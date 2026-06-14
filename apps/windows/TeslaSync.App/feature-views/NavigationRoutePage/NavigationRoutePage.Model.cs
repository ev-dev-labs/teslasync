using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// One row of the <c>/location-snapshots</c> family — the native mirror of the web
/// <c>LocationSnapshot</c> the page consumes (web/src/features/maps/pages/NavigationRoutePage.tsx). Position,
/// navigation and presence fields are read verbatim from the snake_case wire shape. Phase-48 stores SI on disk:
/// <see cref="SpeedMps"/> is the m/s value carried by the legacy <c>speed_mph</c> field and
/// <see cref="DistanceToArrivalM"/> is the metres value carried by the legacy <c>miles_to_arrival</c> field;
/// both are converted at the display boundary only. Parsing is null-tolerant so a partial or schema-drifted row
/// never throws (web parity: the page tolerates undefined fields). Pure data — no WinUI types.
/// </summary>
public sealed record LocationSnapshotModel(
    long Id,
    double? Latitude,
    double? Longitude,
    double? Heading,
    string? GpsState,
    double? SpeedMps,
    string? DestinationName,
    double? DistanceToArrivalM,
    double? MinutesToArrival,
    double? RouteTrafficDelayS,
    string? RouteLastUpdated,
    bool? LocatedAtHome,
    bool? LocatedAtWork,
    bool? HomelinkNearby,
    string? CreatedAt)
{
    /// <summary>True when the snapshot carries a usable GPS fix (web <c>hasValidLocation</c>).</summary>
    public bool HasValidLocation =>
        Latitude is { } lat && Longitude is { } lon && (lat != 0 || lon != 0);

    /// <summary>True when an active route destination is present (web <c>hasActiveRoute</c>).</summary>
    public bool HasActiveRoute => !string.IsNullOrEmpty(DestinationName);

    /// <summary>Project one snapshot JSON object into a tolerant model (accepts the snake_case wire shape).</summary>
    public static LocationSnapshotModel FromJson(JsonElement element)
    {
        return new LocationSnapshotModel(
            Id: NavJson.ReadLong(element, "id") ?? 0,
            Latitude: NavJson.ReadDouble(element, "latitude"),
            Longitude: NavJson.ReadDouble(element, "longitude"),
            Heading: NavJson.ReadDouble(element, "heading"),
            GpsState: NavJson.ReadString(element, "gps_state"),
            SpeedMps: NavJson.ReadDouble(element, "speed_mph"),
            DestinationName: NavJson.ReadString(element, "destination_name"),
            DistanceToArrivalM: NavJson.ReadDouble(element, "miles_to_arrival"),
            MinutesToArrival: NavJson.ReadDouble(element, "minutes_to_arrival"),
            RouteTrafficDelayS: NavJson.ReadDouble(element, "route_traffic_delay_s"),
            RouteLastUpdated: NavJson.ReadString(element, "route_last_updated"),
            LocatedAtHome: NavJson.ReadBool(element, "located_at_home"),
            LocatedAtWork: NavJson.ReadBool(element, "located_at_work"),
            HomelinkNearby: NavJson.ReadBool(element, "homelink_nearby"),
            CreatedAt: NavJson.ReadString(element, "created_at"));
    }
}

/// <summary>Null-tolerant JSON field readers shared by the navigation snapshot parsers (web <c>?? 0</c> parity).</summary>
public static class NavJson
{
    /// <summary>Read a string field, or null when absent / not a string.</summary>
    public static string? ReadString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read a finite numeric field (number or numeric string), or null when absent / unparseable.</summary>
    public static double? ReadDouble(JsonElement obj, string name)
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

    /// <summary>Read an integer field, or null when absent / unparseable.</summary>
    public static long? ReadLong(JsonElement obj, string name)
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

    /// <summary>Read a tri-state boolean field (true / false / null) preserving the web's <c>=== true</c> gate.</summary>
    public static bool? ReadBool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }
}

/// <summary>
/// The parsed result of the navigation reads — the latest location snapshot, the snapshot history and the latest
/// charging-telemetry "expected energy at arrival" the web page composes from <c>useLocationSnapshotLatest</c>,
/// <c>useLocationSnapshots</c> and <c>useChargingTelemetryLatest</c>. <see cref="HasData"/> mirrors the page's
/// "is there anything to show" gate (a snapshot or any history).
/// </summary>
public sealed record NavigationSnapshot(
    LocationSnapshotModel? Latest,
    IReadOnlyList<LocationSnapshotModel> History,
    double? ExpectedEnergyPctAtArrival)
{
    /// <summary>The empty snapshot (no latest, no history) — the page-level empty surface.</summary>
    public static NavigationSnapshot Empty { get; } = new(null, Array.Empty<LocationSnapshotModel>(), null);

    /// <summary>True when there is a latest snapshot or any history to render.</summary>
    public bool HasData => Latest is not null || History.Count > 0;

    /// <summary>Parse a <c>/location-snapshots/latest</c> object into a model (null when not a JSON object).</summary>
    public static LocationSnapshotModel? ParseLatest(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object ? LocationSnapshotModel.FromJson(root) : null;

    /// <summary>Parse a <c>/location-snapshots</c> array into the tolerant history list (absent → empty).</summary>
    public static IReadOnlyList<LocationSnapshotModel> ParseHistory(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<LocationSnapshotModel>();
        }

        var rows = new List<LocationSnapshotModel>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(LocationSnapshotModel.FromJson(item));
            }
        }

        return rows;
    }

    /// <summary>Parse the charging-telemetry expected-energy-at-arrival percentage (web <c>expected_energy_pct_at_arrival</c>).</summary>
    public static double? ParseExpectedEnergy(JsonElement root) =>
        NavJson.ReadDouble(root, "expected_energy_pct_at_arrival");
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface INavigationRouteFeed
{
    /// <summary>Fetch the latest snapshot, snapshot history and charging-telemetry rollup for the active vehicle.</summary>
    Task<NavigationSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyNavigationRouteFeed : INavigationRouteFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyNavigationRouteFeed Instance { get; } = new();

    private EmptyNavigationRouteFeed()
    {
    }

    /// <inheritdoc />
    public Task<NavigationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(NavigationSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum NavigationRouteState
{
    /// <summary>The reads are in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no snapshot and no history — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary read failed — the retriable error surface.</summary>
    Error,

    /// <summary>A snapshot (or history) resolved — the full page content.</summary>
    Success,
}

/// <summary>A label / value field inside the navigation-status panel (web status-grid cell).</summary>
public sealed record NavStatusFieldDisplay(string Label, string Value);

/// <summary>The traffic-delay value plus its semantic badge (web <c>TrafficDelayBadge</c>).</summary>
public sealed record TrafficDelayDisplay(string ValueText, string BadgeText, StatusKind BadgeStatus, string AccentBrushKey);

/// <summary>The navigation-status panel projection (web GlassPanel1 "Navigation Status").</summary>
public sealed record NavStatusDisplay(
    string Title,
    bool IsActive,
    string BadgeText,
    StatusKind BadgeStatus,
    string LastUpdatedLabel,
    string LastUpdatedValue,
    bool HasActiveRoute,
    NavStatusFieldDisplay Destination,
    NavStatusFieldDisplay Eta,
    NavStatusFieldDisplay Distance,
    string TrafficLabel,
    TrafficDelayDisplay Traffic,
    string NoActiveMessage);

/// <summary>One location-status card (web GlassPanel2 cards — current location / GPS / heading / home / work).</summary>
public sealed record NavLocationCardDisplay(string Label, string Value, bool Active, string Glyph, string AutomationName);

/// <summary>One route-metric card (web "Route Metrics": Distance / ETA / Traffic-Delay / Avg-Speed / Energy-at-Arrival).</summary>
public sealed record NavMetricDisplay(string Label, string Value, string Glyph, string AccentBrushKey, string AutomationName);

/// <summary>A typed chart series projected for a navigation chart (WinUI-free).</summary>
public sealed record NavSeriesDisplay(string Name, ChartSeriesKind Kind, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>A navigation chart projection (web <c>AreaChart</c> speed-profile / <c>LineChart</c> presence).</summary>
public sealed record NavChartDisplay(
    bool Visible,
    string Title,
    string Glyph,
    string AriaLabel,
    string EmptyMessage,
    IReadOnlyList<NavSeriesDisplay> Series);

/// <summary>A declarative table column (web <c>Column</c> descriptor).</summary>
public sealed record NavColumn(string Key, string Header, bool Numeric);

/// <summary>A declarative table row — a column-key → preformatted-cell map (web row object).</summary>
public sealed record NavRow(object Key, IReadOnlyDictionary<string, string> Values);

/// <summary>A navigation data table projection (web <c>DataTable</c> waypoints / recent-destinations / history).</summary>
public sealed record NavTableDisplay(IReadOnlyList<NavColumn> Columns, IReadOnlyList<NavRow> Rows, string EmptyMessage)
{
    /// <summary>True when the table has at least one row (otherwise the empty surface renders).</summary>
    public bool HasRows => Rows.Count > 0;
}

/// <summary>A titled table section (web GlassPanel with an icon heading + <c>DataTable</c>).</summary>
public sealed record NavTableSectionDisplay(string Title, string Glyph, NavTableDisplay Table);

/// <summary>The waypoints section (web GlassPanel9) — replaced by a "no active route" surface when inactive.</summary>
public sealed record NavWaypointsDisplay(string Title, string Glyph, bool Active, string NoRouteMessage, NavTableDisplay Table);

/// <summary>The route-traffic-delay section (web GlassPanel10) — a big value plus its semantic badge.</summary>
public sealed record NavTrafficDisplay(string Title, string Glyph, TrafficDelayDisplay Delay);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>NavigationRoutePage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI
/// types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record NavigationDisplay(
    NavigationRouteState State,
    string Title,
    string Subtitle,
    string RefreshLabel,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    bool ShowGpsWarning,
    string GpsWarningText,
    NavStatusDisplay Status,
    IReadOnlyList<NavLocationCardDisplay> LocationCards,
    IReadOnlyList<NavMetricDisplay> Metrics,
    NavChartDisplay SpeedChart,
    NavWaypointsDisplay Waypoints,
    NavTrafficDisplay Traffic,
    NavTableSectionDisplay RecentDestinations,
    NavChartDisplay PresenceChart,
    NavTableSectionDisplay LocationHistory,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests construct
/// it directly. Pure data — no WinUI types.
/// </summary>
public sealed record NavigationModel(NavigationSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the queries are in flight with no data yet.</summary>
    public static NavigationModel Initial { get; } = new(NavigationSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>NavigationRoutePage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all sixty of them in one pass (every key is resolved eagerly here regardless of
/// the page's data state).
/// </summary>
public sealed record NavigationStrings
{
    public required string CommonNoData { get; init; }
    public required string ErrorLoadFailed { get; init; }
    public required string Active { get; init; }
    public required string AtHome { get; init; }
    public required string AtWork { get; init; }
    public required string AwayFromHome { get; init; }
    public required string ChartDistanceV2 { get; init; }
    public required string ChartSpeedV2 { get; init; }
    public required string ColDestination { get; init; }
    public required string ColDistance { get; init; }
    public required string ColEta { get; init; }
    public required string ColHome { get; init; }
    public required string ColLat { get; init; }
    public required string ColLon { get; init; }
    public required string ColTime { get; init; }
    public required string ColWork { get; init; }
    public required string CurrentLocation { get; init; }
    public required string Delay { get; init; }
    public required string Destination { get; init; }
    public required string DistanceRemaining { get; init; }
    public required string Eta { get; init; }
    public required string GpsFixQuality { get; init; }
    public required string Heading { get; init; }
    public required string HeadingValue { get; init; }
    public required string HomeStatus { get; init; }
    public required string HomelinkNearby { get; init; }
    public required string Inactive { get; init; }
    public required string LegendDistanceToArrivalV2 { get; init; }
    public required string LegendSpeedV2 { get; init; }
    public required string LocationHistory { get; init; }
    public required string LocationUnavailable { get; init; }
    public required string MetricAvgSpeed { get; init; }
    public required string MetricDistance { get; init; }
    public required string MetricEnergyAtArrival { get; init; }
    public required string MetricEta { get; init; }
    public required string MetricTrafficDelay { get; init; }
    public required string Minutes { get; init; }
    public required string NoActiveNav { get; init; }
    public required string NoDestinations { get; init; }
    public required string NoGps { get; init; }
    public required string NoHistory { get; init; }
    public required string NoPresence { get; init; }
    public required string NoSnapshots { get; init; }
    public required string NotAtWork { get; init; }
    public required string PageTitle { get; init; }
    public required string PresenceChart { get; init; }
    public required string RecentDestinations { get; init; }
    public required string Refresh { get; init; }
    public required string RouteLastUpdated { get; init; }
    public required string SpeedProfile { get; init; }
    public required string Status { get; init; }
    public required string Subtitle { get; init; }
    public required string TrafficDelay { get; init; }
    public required string Unknown { get; init; }
    public required string Waypoints { get; init; }
    public required string WorkStatus { get; init; }
    public required string WpDistance { get; init; }
    public required string WpName { get; init; }
    public required string WpType { get; init; }
    public required string NavigationNoRoute { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names + defaults, verbatim).</summary>
    public static NavigationStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new NavigationStrings
        {
            CommonNoData = localizer.GetString("common.noData", "No data available"),
            ErrorLoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            Active = localizer.GetString("nav.active", "Active"),
            AtHome = localizer.GetString("nav.atHome", "At Home"),
            AtWork = localizer.GetString("nav.atWork", "At Work"),
            AwayFromHome = localizer.GetString("nav.awayFromHome", "Away"),
            ChartDistanceV2 = localizer.GetString("nav.chartDistanceV2", "Distance to Arrival ({{unit}})"),
            ChartSpeedV2 = localizer.GetString("nav.chartSpeedV2", "Speed ({{unit}})"),
            ColDestination = localizer.GetString("nav.col.destination", "Destination"),
            ColDistance = localizer.GetString("nav.col.distance", "Distance"),
            ColEta = localizer.GetString("nav.col.eta", "ETA"),
            ColHome = localizer.GetString("nav.col.home", "Home"),
            ColLat = localizer.GetString("nav.col.lat", "Lat"),
            ColLon = localizer.GetString("nav.col.lon", "Lon"),
            ColTime = localizer.GetString("nav.col.time", "Time"),
            ColWork = localizer.GetString("nav.col.work", "Work"),
            CurrentLocation = localizer.GetString("nav.currentLocation", "Current Location"),
            Delay = localizer.GetString("nav.delay", "delay"),
            Destination = localizer.GetString("nav.destination", "Destination"),
            DistanceRemaining = localizer.GetString("nav.distanceRemaining", "Distance Remaining"),
            Eta = localizer.GetString("nav.eta", "ETA"),
            GpsFixQuality = localizer.GetString("nav.gpsFixQuality", "GPS Fix Quality"),
            Heading = localizer.GetString("nav.heading", "Heading"),
            HeadingValue = localizer.GetString("nav.headingValue", "{{cardinal}} ({{degrees}}\u00B0)"),
            HomeStatus = localizer.GetString("nav.homeStatus", "Home Status"),
            HomelinkNearby = localizer.GetString("nav.homelinkNearby", "HomeLink Nearby"),
            Inactive = localizer.GetString("nav.inactive", "Inactive"),
            LegendDistanceToArrivalV2 = localizer.GetString("nav.legendDistanceToArrivalV2", "Distance to Arrival ({{unit}})"),
            LegendSpeedV2 = localizer.GetString("nav.legendSpeedV2", "Speed ({{unit}})"),
            LocationHistory = localizer.GetString("nav.locationHistory", "Location History"),
            LocationUnavailable = localizer.GetString("nav.locationUnavailable", "Location unavailable"),
            MetricAvgSpeed = localizer.GetString("nav.metric.avgSpeed", "Avg Speed"),
            MetricDistance = localizer.GetString("nav.metric.distance", "Distance"),
            MetricEnergyAtArrival = localizer.GetString("nav.metric.energyAtArrival", "Energy at Arrival"),
            MetricEta = localizer.GetString("nav.metric.eta", "ETA"),
            MetricTrafficDelay = localizer.GetString("nav.metric.trafficDelay", "Traffic Delay"),
            Minutes = localizer.GetString("nav.minutes", "min"),
            NoActiveNav = localizer.GetString("nav.noActiveNav", "No active navigation. Start a route in your vehicle to see details here."),
            NoDestinations = localizer.GetString("nav.noDestinations", "No destination history available."),
            NoGps = localizer.GetString("nav.noGps", "GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming."),
            NoHistory = localizer.GetString("nav.noHistory", "No location history available for this vehicle."),
            NoPresence = localizer.GetString("nav.noPresence", "No presence history available."),
            NoSnapshots = localizer.GetString("nav.noSnapshots", "No location snapshots recorded yet."),
            NotAtWork = localizer.GetString("nav.notAtWork", "Away"),
            PageTitle = localizer.GetString("nav.pageTitle", "Navigation & Route"),
            PresenceChart = localizer.GetString("nav.presenceChart", "Home / Work Presence"),
            RecentDestinations = localizer.GetString("nav.recentDestinations", "Recent Destinations"),
            Refresh = localizer.GetString("nav.refresh", "Refresh"),
            RouteLastUpdated = localizer.GetString("nav.routeLastUpdated", "Route last updated"),
            SpeedProfile = localizer.GetString("nav.speedProfile", "Speed Profile"),
            Status = localizer.GetString("nav.status", "Navigation Status"),
            Subtitle = localizer.GetString("nav.subtitle", "Live location tracking and navigation status"),
            TrafficDelay = localizer.GetString("nav.trafficDelay", "Traffic Delay"),
            Unknown = localizer.GetString("nav.unknown", "Unknown"),
            Waypoints = localizer.GetString("nav.waypoints", "Route Waypoints"),
            WorkStatus = localizer.GetString("nav.workStatus", "Work Status"),
            WpDistance = localizer.GetString("nav.wp.distance", "Distance"),
            WpName = localizer.GetString("nav.wp.name", "Name"),
            WpType = localizer.GetString("nav.wp.type", "Type"),
            NavigationNoRoute = localizer.GetString("navigation.noRoute", "No active route selected"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="NavigationModel"/> to its <see cref="NavigationDisplay"/> — the native port
/// of the render logic in web/src/features/maps/pages/NavigationRoutePage.tsx and its <c>LocationStatusCard</c> /
/// <c>TrafficDelayBadge</c> / <c>buildWaypoints</c> / <c>chartData</c> / <c>presenceChartData</c> helpers. The
/// branch precedence mirrors the web data lifecycle (loading → error → empty → success). Every label resolves
/// through the i18n facade using the same keys the web page uses and every SI value (m/s, metres, seconds) is
/// converted at this display boundary only.
/// </summary>
public static class NavigationProjection
{
    private const string EmDash = "\u2014";
    private const int DistancePrecision = 1;
    private const int SpeedPrecision = 1;
    private const int CoarseCoordPrecision = 4;
    private const int FineCoordPrecision = 6;
    private const int RecentDestinationLimit = 20;

    private const string GlyphMapPin = "\uE707";
    private const string GlyphSatellite = "\uE9CE";
    private const string GlyphCompass = "\uE809";
    private const string GlyphHome = "\uE80F";
    private const string GlyphWork = "\uE821";
    private const string GlyphRoute = "\uE8A7";
    private const string GlyphGauge = "\uE9D2";
    private const string GlyphClock = "\uE823";
    private const string GlyphBattery = "\uE83E";
    private const string GlyphTraffic = "\uE7BA";
    private const string GlyphTrending = "\uE9D2";

    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";

    private static readonly string[] Cardinals = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed navigation reads plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static NavigationDisplay Project(NavigationModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = NavigationStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var latest = snapshot.Latest;
        var history = snapshot.History;

        NavigationRouteState state =
            model.Loading && !snapshot.HasData ? NavigationRouteState.Loading
            : model.ErrorDetail is not null ? NavigationRouteState.Error
            : !snapshot.HasData ? NavigationRouteState.Empty
            : NavigationRouteState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorLoadFailed
            : $"{s.ErrorLoadFailed}: {model.ErrorDetail}";

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);
        bool hasActiveRoute = latest?.HasActiveRoute ?? false;
        bool hasValidLocation = latest?.HasValidLocation ?? false;

        var statusPanel = BuildStatus(latest, hasActiveRoute, distanceUnit, units, s);
        var locationCards = BuildLocationCards(latest, hasValidLocation, s, localizer);
        var metrics = BuildMetrics(latest, history, snapshot.ExpectedEnergyPctAtArrival, hasActiveRoute, distanceUnit, speedUnit, units, s);
        var speedChart = BuildSpeedChart(history, speedUnit, distanceUnit, units, s);
        var waypoints = BuildWaypoints(latest, hasActiveRoute, distanceUnit, units, s);
        var traffic = BuildTrafficSection(latest, units, s);
        var recent = BuildRecentDestinations(history, distanceUnit, units, s);
        var presenceChart = BuildPresenceChart(history, s);
        var historyTable = BuildHistory(history, s);

        return new NavigationDisplay(
            State: state,
            Title: s.PageTitle,
            Subtitle: s.Subtitle,
            RefreshLabel: s.Refresh,
            ShowLoading: state == NavigationRouteState.Loading,
            ShowError: state == NavigationRouteState.Error,
            ShowEmpty: state == NavigationRouteState.Empty,
            ShowContent: state == NavigationRouteState.Success,
            ErrorText: errorText,
            RetryLabel: s.Refresh,
            EmptyMessage: s.CommonNoData,
            ShowGpsWarning: latest is not null && !hasValidLocation,
            GpsWarningText: s.NoGps,
            Status: statusPanel,
            LocationCards: locationCards,
            Metrics: metrics,
            SpeedChart: speedChart,
            Waypoints: waypoints,
            Traffic: traffic,
            RecentDestinations: recent,
            PresenceChart: presenceChart,
            LocationHistory: historyTable,
            AutomationName: $"{s.PageTitle}. {s.Subtitle}");
    }

    /// <summary>The compass cardinal for a heading in degrees (web <c>headingToCardinal</c>).</summary>
    public static string HeadingToCardinal(double? deg)
    {
        if (deg is not { } d)
        {
            return EmDash;
        }

        int index = (int)Math.Round(d / 45, MidpointRounding.AwayFromZero) % 8;
        if (index < 0)
        {
            index += 8;
        }

        return Cardinals[index];
    }

    /// <summary>The semantic band of a traffic delay in seconds (web <c>TrafficDelayBadge</c>: &lt;300 ok, &lt;=900 warn, else danger).</summary>
    public static StatusKind TrafficBadgeStatus(double seconds) =>
        seconds < 300 ? StatusKind.Success
        : seconds <= 900 ? StatusKind.Warning
        : StatusKind.Danger;

    /// <summary>Normalize a raw GPS-state string to one of locked / unlocked / unknown (web <c>normalizeGpsState</c>).</summary>
    public static string NormalizeGpsState(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "unknown";
        }

        string v = raw.Trim().ToLowerInvariant();
        return v switch
        {
            "true" or "1" or "yes" or "gpsvalid" or "fix2d" or "fix3d"
                or "normal" or "good" or "strong" or "ok" or "valid" => "locked",
            "false" or "0" or "no" or "gpsinvalid" or "nofix" or "invalid" or "none" => "unlocked",
            _ => "unknown",
        };
    }

    private static NavStatusDisplay BuildStatus(
        LocationSnapshotModel? latest, bool hasActiveRoute, string distanceUnit, UnitPref units, NavigationStrings s)
    {
        double delaySeconds = latest?.RouteTrafficDelayS ?? 0;
        string lastUpdated = FormatTimestamp(latest?.RouteLastUpdated);

        string eta = $"{ScalarFormatters.FormatNumber(latest?.MinutesToArrival ?? 0, 0)} {s.Minutes}";
        string distance = $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(latest?.DistanceToArrivalM ?? 0, units.Distance), DistancePrecision)} {distanceUnit}";

        return new NavStatusDisplay(
            Title: s.Status,
            IsActive: hasActiveRoute,
            BadgeText: hasActiveRoute ? s.Active : s.Inactive,
            BadgeStatus: hasActiveRoute ? StatusKind.Success : StatusKind.Neutral,
            LastUpdatedLabel: s.RouteLastUpdated,
            LastUpdatedValue: lastUpdated,
            HasActiveRoute: hasActiveRoute,
            Destination: new NavStatusFieldDisplay(s.Destination, latest?.DestinationName ?? EmDash),
            Eta: new NavStatusFieldDisplay(s.Eta, eta),
            Distance: new NavStatusFieldDisplay(s.DistanceRemaining, distance),
            TrafficLabel: s.TrafficDelay,
            Traffic: BuildTrafficDelay(delaySeconds, units, s),
            NoActiveMessage: s.NoActiveNav);
    }

    private static TrafficDelayDisplay BuildTrafficDelay(double seconds, UnitPref units, NavigationStrings s)
    {
        var status = TrafficBadgeStatus(seconds);
        string value = UnitFormatters.FormatDuration(seconds, units);
        string accent = seconds == 0 ? SuccessBrush : seconds <= 300 ? WarningBrush : DangerBrush;
        return new TrafficDelayDisplay(value, $"{value} {s.Delay}", status, accent);
    }

    private static IReadOnlyList<NavLocationCardDisplay> BuildLocationCards(
        LocationSnapshotModel? latest, bool hasValidLocation, NavigationStrings s, ILocalizer localizer)
    {
        string coords = hasValidLocation
            ? $"{ScalarFormatters.FormatNumber(latest!.Latitude, CoarseCoordPrecision)}, {ScalarFormatters.FormatNumber(latest.Longitude, CoarseCoordPrecision)}"
            : s.LocationUnavailable;

        string fix = NormalizeGpsState(latest?.GpsState);
        string fixLabel = localizer.GetString($"nav.gpsState.{fix}", fix);

        string headingValue = latest?.Heading is { } h
            ? s.HeadingValue
                .Replace("{{cardinal}}", HeadingToCardinal(h), StringComparison.Ordinal)
                .Replace("{{degrees}}", ScalarFormatters.FormatNumber(Math.Round(h, MidpointRounding.AwayFromZero), 0), StringComparison.Ordinal)
            : s.Unknown;

        string homeValue =
            latest?.LocatedAtHome == true ? s.AtHome
            : latest?.LocatedAtHome == false ? (latest.HomelinkNearby == true ? s.HomelinkNearby : s.AwayFromHome)
            : s.Unknown;

        string workValue =
            latest?.LocatedAtWork == true ? s.AtWork
            : latest?.LocatedAtWork == false ? s.NotAtWork
            : s.Unknown;

        return
        [
            new NavLocationCardDisplay(s.CurrentLocation, coords, hasValidLocation, GlyphMapPin, $"{s.CurrentLocation}: {coords}"),
            new NavLocationCardDisplay(s.GpsFixQuality, fixLabel, fix == "locked", GlyphSatellite, $"{s.GpsFixQuality}: {fixLabel}"),
            new NavLocationCardDisplay(s.Heading, headingValue, latest?.Heading is not null, GlyphCompass, $"{s.Heading}: {headingValue}"),
            new NavLocationCardDisplay(s.HomeStatus, homeValue, latest?.LocatedAtHome == true, GlyphHome, $"{s.HomeStatus}: {homeValue}"),
            new NavLocationCardDisplay(s.WorkStatus, workValue, latest?.LocatedAtWork == true, GlyphWork, $"{s.WorkStatus}: {workValue}"),
        ];
    }

    private static IReadOnlyList<NavMetricDisplay> BuildMetrics(
        LocationSnapshotModel? latest,
        IReadOnlyList<LocationSnapshotModel> history,
        double? expectedEnergy,
        bool hasActiveRoute,
        string distanceUnit,
        string speedUnit,
        UnitPref units,
        NavigationStrings s)
    {
        string distance = hasActiveRoute
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(latest?.DistanceToArrivalM ?? 0, units.Distance), DistancePrecision)} {distanceUnit}"
            : EmDash;
        string eta = hasActiveRoute ? $"{ScalarFormatters.FormatNumber(latest?.MinutesToArrival ?? 0, 0)} {s.Minutes}" : EmDash;
        string trafficDelay = hasActiveRoute ? UnitFormatters.FormatDuration(latest?.RouteTrafficDelayS ?? 0, units) : EmDash;
        string avgSpeed = $"{ScalarFormatters.FormatNumber(AverageSpeed(history, units), SpeedPrecision)} {speedUnit}";
        string energy = expectedEnergy is { } pct ? $"{ScalarFormatters.FormatNumber(pct, 0)}%" : EmDash;

        return
        [
            new NavMetricDisplay(s.MetricDistance, distance, GlyphRoute, AccentBrush, $"{s.MetricDistance}: {distance}"),
            new NavMetricDisplay(s.MetricEta, eta, GlyphClock, AccentBrush, $"{s.MetricEta}: {eta}"),
            new NavMetricDisplay(s.MetricTrafficDelay, trafficDelay, GlyphBattery, SuccessBrush, $"{s.MetricTrafficDelay}: {trafficDelay}"),
            new NavMetricDisplay(s.MetricAvgSpeed, avgSpeed, GlyphGauge, WarningBrush, $"{s.MetricAvgSpeed}: {avgSpeed}"),
            new NavMetricDisplay(s.MetricEnergyAtArrival, energy, GlyphBattery, SuccessBrush, $"{s.MetricEnergyAtArrival}: {energy}"),
        ];
    }

    /// <summary>Average SI speed over history (web <c>avgSpeed</c>: mean of positive m/s values), converted to display units.</summary>
    public static double AverageSpeed(IReadOnlyList<LocationSnapshotModel> history, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(history);
        ArgumentNullException.ThrowIfNull(units);

        double sum = 0;
        int count = 0;
        foreach (var row in history)
        {
            if (row.SpeedMps is { } mps && mps > 0)
            {
                sum += mps;
                count++;
            }
        }

        return count == 0 ? 0 : UnitConverters.SpeedFromSi(sum / count, units.Speed);
    }

    private static NavChartDisplay BuildSpeedChart(
        IReadOnlyList<LocationSnapshotModel> history, string speedUnit, string distanceUnit, UnitPref units, NavigationStrings s)
    {
        var ordered = OrderByCreated(history);
        var speedPoints = new List<ChartPoint>(ordered.Count);
        var distancePoints = new List<ChartPoint>(ordered.Count);
        for (int i = 0; i < ordered.Count; i++)
        {
            var row = ordered[i];
            speedPoints.Add(new ChartPoint(i, UnitConverters.SpeedFromSi(row.SpeedMps ?? 0, units.Speed)));
            distancePoints.Add(new ChartPoint(i, UnitConverters.DistanceFromSi(row.DistanceToArrivalM ?? 0, units.Distance)));
        }

        string speedLegend = WithUnit(s.LegendSpeedV2, speedUnit);
        string distanceLegend = WithUnit(s.LegendDistanceToArrivalV2, distanceUnit);
        string aria = $"{WithUnit(s.ChartSpeedV2, speedUnit)} \u2014 {WithUnit(s.ChartDistanceV2, distanceUnit)}";

        var series = new List<NavSeriesDisplay>
        {
            new(speedLegend, ChartSeriesKind.Area, 0, speedPoints),
            new(distanceLegend, ChartSeriesKind.Area, 1, distancePoints),
        };

        return new NavChartDisplay(ordered.Count > 0, s.SpeedProfile, GlyphGauge, aria, s.NoHistory, series);
    }

    private static NavChartDisplay BuildPresenceChart(IReadOnlyList<LocationSnapshotModel> history, NavigationStrings s)
    {
        var ordered = OrderByCreated(history);
        var home = new List<ChartPoint>(ordered.Count);
        var work = new List<ChartPoint>(ordered.Count);
        var homelink = new List<ChartPoint>(ordered.Count);
        for (int i = 0; i < ordered.Count; i++)
        {
            var row = ordered[i];
            home.Add(new ChartPoint(i, row.LocatedAtHome == true ? 1 : 0));
            work.Add(new ChartPoint(i, row.LocatedAtWork == true ? 1 : 0));
            homelink.Add(new ChartPoint(i, row.HomelinkNearby == true ? 1 : 0));
        }

        var series = new List<NavSeriesDisplay>
        {
            new(s.AtHome, ChartSeriesKind.Line, 1, home),
            new(s.AtWork, ChartSeriesKind.Line, 3, work),
            new(s.HomelinkNearby, ChartSeriesKind.Line, 4, homelink),
        };

        return new NavChartDisplay(ordered.Count > 0, s.PresenceChart, GlyphTrending, s.PresenceChart, s.NoPresence, series);
    }

    private static NavWaypointsDisplay BuildWaypoints(
        LocationSnapshotModel? latest, bool hasActiveRoute, string distanceUnit, UnitPref units, NavigationStrings s)
    {
        var columns = new List<NavColumn>
        {
            new("name", s.WpName, false),
            new("type", s.WpType, false),
            new("distance", s.WpDistance, true),
        };

        var rows = new List<NavRow>();
        if (hasActiveRoute && latest?.DestinationName is { } dest)
        {
            string distance = $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(latest.DistanceToArrivalM ?? 0, units.Distance), DistancePrecision)} {distanceUnit}";
            rows.Add(new NavRow(
                dest,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["name"] = dest,
                    ["type"] = "destination",
                    ["distance"] = distance,
                }));
        }

        var table = new NavTableDisplay(columns, rows, s.CommonNoData);
        return new NavWaypointsDisplay(s.Waypoints, GlyphRoute, hasActiveRoute, s.NavigationNoRoute, table);
    }

    private static NavTrafficDisplay BuildTrafficSection(LocationSnapshotModel? latest, UnitPref units, NavigationStrings s) =>
        new(s.TrafficDelay, GlyphTraffic, BuildTrafficDelay(latest?.RouteTrafficDelayS ?? 0, units, s));

    private static NavTableSectionDisplay BuildRecentDestinations(
        IReadOnlyList<LocationSnapshotModel> history, string distanceUnit, UnitPref units, NavigationStrings s)
    {
        var columns = new List<NavColumn>
        {
            new("time", s.ColTime, false),
            new("destination", s.ColDestination, false),
            new("distance", s.ColDistance, true),
            new("eta", s.ColEta, true),
        };

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var rows = new List<NavRow>();
        foreach (var row in history)
        {
            if (row.DestinationName is not { Length: > 0 } name || !seen.Add(name))
            {
                continue;
            }

            string distance = $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(row.DistanceToArrivalM ?? 0, units.Distance), DistancePrecision)} {distanceUnit}";
            rows.Add(new NavRow(
                $"{row.CreatedAt}-{name}",
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["time"] = FormatTimestamp(row.CreatedAt),
                    ["destination"] = name,
                    ["distance"] = distance,
                    ["eta"] = $"{ScalarFormatters.FormatNumber(row.MinutesToArrival ?? 0, 0)} {s.Minutes}",
                }));

            if (rows.Count >= RecentDestinationLimit)
            {
                break;
            }
        }

        return new NavTableSectionDisplay(s.RecentDestinations, GlyphClock, new NavTableDisplay(columns, rows, s.NoDestinations));
    }

    private static NavTableSectionDisplay BuildHistory(IReadOnlyList<LocationSnapshotModel> history, NavigationStrings s)
    {
        var columns = new List<NavColumn>
        {
            new("time", s.ColTime, false),
            new("latitude", s.ColLat, true),
            new("longitude", s.ColLon, true),
            new("home", s.ColHome, false),
            new("work", s.ColWork, false),
            new("destination", s.ColDestination, false),
        };

        var ordered = history
            .OrderByDescending(r => ParseTimestamp(r.CreatedAt) ?? DateTimeOffset.MinValue)
            .ToList();

        var rows = new List<NavRow>(ordered.Count);
        foreach (var row in ordered)
        {
            rows.Add(new NavRow(
                row.Id,
                new Dictionary<string, string>(StringComparer.Ordinal)
                {
                    ["time"] = FormatTimestamp(row.CreatedAt),
                    ["latitude"] = row.Latitude is { } lat && lat != 0 ? ScalarFormatters.FormatNumber(lat, FineCoordPrecision) : EmDash,
                    ["longitude"] = row.Longitude is { } lon && lon != 0 ? ScalarFormatters.FormatNumber(lon, FineCoordPrecision) : EmDash,
                    ["home"] = TriState(row.LocatedAtHome),
                    ["work"] = TriState(row.LocatedAtWork),
                    ["destination"] = row.DestinationName ?? EmDash,
                }));
        }

        return new NavTableSectionDisplay(s.LocationHistory, GlyphCompass, new NavTableDisplay(columns, rows, s.NoSnapshots));
    }

    private static string TriState(bool? value) => value switch
    {
        true => "Yes",
        false => "No",
        _ => EmDash,
    };

    private static string WithUnit(string template, string unit) =>
        template.Replace("{{unit}}", unit, StringComparison.Ordinal);

    private static List<LocationSnapshotModel> OrderByCreated(IReadOnlyList<LocationSnapshotModel> history) =>
        history.OrderBy(r => ParseTimestamp(r.CreatedAt) ?? DateTimeOffset.MinValue).ToList();

    private static DateTimeOffset? ParseTimestamp(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto) ? dto : null;

    private static string FormatTimestamp(string? value)
    {
        if (ParseTimestamp(value) is not { } dto)
        {
            return EmDash;
        }

        var now = DateTimeOffset.Now;
        string date = DateTimeFormatting.Format(dto, DateTimeVariant.Short, now);
        string time = DateTimeFormatting.Format(dto, DateTimeVariant.Time, now);
        return $"{date} {time}";
    }
}

/// <summary>
/// The navigation-route surface's identity + generated operation ids — the single place the shell, the feed and
/// the tests agree on the route name, deep-link slug, diagnostics slug and the three reads the web page performs.
/// </summary>
public static class NavigationRouteRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "NavigationRoute";

    /// <summary>The deep-link route slug (web route <c>/navigation</c>).</summary>
    public const string Route = "navigation";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "NavigationRoutePage";

    /// <summary>The generated operation id for the latest-snapshot read (web <c>useLocationSnapshotLatest</c>).</summary>
    public const string LatestOperation = Operations.Locations.SnapshotLatest;

    /// <summary>The generated operation id for the snapshot-history read (web <c>useLocationSnapshots</c>).</summary>
    public const string HistoryOperation = Operations.Locations.SnapshotHistory;

    /// <summary>The generated operation id for the charging-telemetry read (web <c>useChargingTelemetryLatest</c>).</summary>
    public const string ChargingOperation = Operations.Charging.TelemetryLatest;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Navigation</c>).</summary>
    public const string EmptyGlyph = "\uE8A7";

    /// <summary>The localized page title (web <c>t('nav.pageTitle')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("nav.pageTitle", "Navigation & Route");
    }

    /// <summary>The localized page subtitle (web <c>t('nav.subtitle')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("nav.subtitle", "Live location tracking and navigation status");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Navigation-Route surface — records only the <c>view.opened</c> event with
/// the surface slug, never any route, location or vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class NavigationRouteDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public NavigationRouteDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NavigationRouteRegistration.Slug}");
    }
}
