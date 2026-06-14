using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// One vehicle the picker scopes to — the reduced mirror of a web <c>Vehicle</c> row from
/// <c>useVehicles</c> (<c>GET /vehicles</c>). Only the id and display name the page reads (the marker
/// popup label and the picker options) are kept. Pure data — no WinUI types.
/// </summary>
public sealed record MapVehicleRef(long Id, string? DisplayName);

/// <summary>
/// One position sample — the native mirror of the web <c>PositionRecord</c>
/// (web/src/features/maps/pages/MapOverviewPage.tsx). SI on the wire: <see cref="SpeedMps"/> is metres
/// per second, <see cref="OdometerM"/> is metres, <see cref="Heading"/> is degrees, the coordinates are
/// decimal degrees and <see cref="CreatedAt"/> is an ISO-8601 timestamp. Pure data.
/// </summary>
public sealed record PositionRecord(
    long Id,
    double Latitude,
    double Longitude,
    double? SpeedMps,
    double? PowerW,
    double? Heading,
    double OdometerM,
    double BatteryLevel,
    string? CreatedAt)
{
    /// <summary>True when the sample carries a non-null, non-(0,0) coordinate (web <c>hasValidLocation</c>).</summary>
    public bool HasValidLocation => Latitude != 0 || Longitude != 0;
}

/// <summary>
/// The latest location snapshot — the native mirror of the web <c>LocationSnapshot</c>
/// (<c>GET /location-snapshots/latest</c>). Tolerant of the snake_case wire shape and the camelCase
/// aliases the web also reads (<c>located_at_home</c> / <c>locatedAtHome</c>). Pure data.
/// </summary>
public sealed record LocationSnapshot(
    bool? LocatedAtHome,
    bool? LocatedAtWork,
    bool HomelinkNearby,
    bool ActiveRoute,
    string? DestinationName,
    string? CreatedAt);

/// <summary>
/// The single-source snapshot the page binds to — the four reads the web page performs:
/// <c>useVehicles</c> (<c>GET /vehicles</c>), the latest position (<c>GET /vehicles/{id}/positions?limit=1</c>),
/// the recent history (<c>GET /vehicles/{id}/positions?limit=50</c>) and the latest location snapshot
/// (<c>GET /location-snapshots/latest</c>). Pure data.
/// </summary>
public sealed record MapOverviewSnapshot(
    IReadOnlyList<MapVehicleRef> Vehicles,
    PositionRecord? Latest,
    IReadOnlyList<PositionRecord> History,
    LocationSnapshot? Location)
{
    /// <summary>The empty snapshot — no fleet, no positions, no location.</summary>
    public static MapOverviewSnapshot Empty { get; } =
        new(Array.Empty<MapVehicleRef>(), null, Array.Empty<PositionRecord>(), null);

    /// <summary>Parse a <c>GET /vehicles</c> JSON array into the reduced refs (tolerant of partial bodies).</summary>
    public static IReadOnlyList<MapVehicleRef> ParseVehicles(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<MapVehicleRef>();
        }

        var vehicles = new List<MapVehicleRef>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            vehicles.Add(new MapVehicleRef(
                Id: MapOverviewJson.Long(item, "id") ?? 0,
                DisplayName: MapOverviewJson.String(item, "display_name")));
        }

        return vehicles;
    }

    /// <summary>Parse a <c>GET /vehicles/{id}/positions</c> JSON array into the reduced samples.</summary>
    public static IReadOnlyList<PositionRecord> ParsePositions(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<PositionRecord>();
        }

        var positions = new List<PositionRecord>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (ParsePosition(item) is { } record)
            {
                positions.Add(record);
            }
        }

        return positions;
    }

    /// <summary>Parse a single position object, or null when the element is not an object.</summary>
    public static PositionRecord? ParsePosition(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new PositionRecord(
            Id: MapOverviewJson.Long(item, "id") ?? 0,
            Latitude: MapOverviewJson.Double(item, "latitude") ?? 0,
            Longitude: MapOverviewJson.Double(item, "longitude") ?? 0,
            SpeedMps: MapOverviewJson.Double(item, "speed"),
            PowerW: MapOverviewJson.Double(item, "power"),
            Heading: MapOverviewJson.Double(item, "heading"),
            OdometerM: MapOverviewJson.Double(item, "odometer") ?? 0,
            BatteryLevel: MapOverviewJson.Double(item, "battery_level") ?? 0,
            CreatedAt: MapOverviewJson.String(item, "created_at"));
    }

    /// <summary>Parse the <c>GET /location-snapshots/latest</c> object, or null when absent.</summary>
    public static LocationSnapshot? ParseLocation(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LocationSnapshot(
            LocatedAtHome: MapOverviewJson.Bool(element, "located_at_home") ?? MapOverviewJson.Bool(element, "locatedAtHome"),
            LocatedAtWork: MapOverviewJson.Bool(element, "located_at_work") ?? MapOverviewJson.Bool(element, "locatedAtWork"),
            HomelinkNearby: MapOverviewJson.Bool(element, "homelink_nearby") ?? false,
            ActiveRoute: MapOverviewJson.Bool(element, "active_route") ?? false,
            DestinationName: MapOverviewJson.String(element, "destination_name"),
            CreatedAt: MapOverviewJson.String(element, "created_at"));
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IMapOverviewFeed
{
    /// <summary>Fetch the fleet (web <c>useVehicles</c> → <c>GET /vehicles</c>).</summary>
    Task<IReadOnlyList<MapVehicleRef>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the latest position for a vehicle (web <c>positions?limit=1</c>).</summary>
    Task<PositionRecord?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch the recent position history for a vehicle (web <c>positions?limit=50</c>).</summary>
    Task<IReadOnlyList<PositionRecord>> FetchPositionHistoryAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Fetch the latest location snapshot for a vehicle (web <c>GET /location-snapshots/latest</c>).</summary>
    Task<LocationSnapshot?> FetchLocationSnapshotAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyMapOverviewFeed : IMapOverviewFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMapOverviewFeed Instance { get; } = new();

    private EmptyMapOverviewFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<MapVehicleRef>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<MapVehicleRef>>(Array.Empty<MapVehicleRef>());

    /// <inheritdoc />
    public Task<PositionRecord?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken) =>
        Task.FromResult<PositionRecord?>(null);

    /// <inheritdoc />
    public Task<IReadOnlyList<PositionRecord>> FetchPositionHistoryAsync(long vehicleId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<PositionRecord>>(Array.Empty<PositionRecord>());

    /// <inheritdoc />
    public Task<LocationSnapshot?> FetchLocationSnapshotAsync(long vehicleId, CancellationToken cancellationToken) =>
        Task.FromResult<LocationSnapshot?>(null);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum MapOverviewState
{
    /// <summary>The fleet / latest-position query is in flight with no data yet — the scaffold loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no GPS / no location data — every section renders its own empty surface.</summary>
    Empty,

    /// <summary>A query failed — the retriable error surface plus the error banner.</summary>
    Error,

    /// <summary>A valid live location resolved — the map, metric cards and detail rows render.</summary>
    Success,
}

/// <summary>One projected vehicle-status metric card (web <c>MetricCard</c>): label, value, accent rail + optional subtitle.</summary>
public sealed record MapMetricDisplay(string Label, string Value, string Glyph, string AccentBrushKey, string? Subtitle = null);

/// <summary>One projected location-detail row (web At Home / At Work / HomeLink / Odometer): glyph, label, value + badge.</summary>
public sealed record LocationDetailDisplay(
    string Glyph,
    string GlyphBrushKey,
    string Label,
    string ValueText,
    bool ShowBadge,
    string BadgeText,
    int BadgeStatus,
    bool BadgeDot);

/// <summary>One projected history row — the pre-formatted Time / Lat / Lon / Speed / Heading cells (web DataTable row).</summary>
public sealed record HistoryRowDisplay(long Id, string Time, string Lat, string Lon, string Speed, string Heading);

/// <summary>One projected quick-link button (web <c>Button</c> with an icon + route): glyph, label and target route.</summary>
public sealed record QuickLinkDisplay(string Glyph, string Label, string Route);

/// <summary>
/// The render-ready projection the view binds to — every web region of MapOverviewPage.tsx as pre-formatted,
/// WinUI-free data: the four data-state flags, the live map (marker + trail + style), the optional route
/// playback, the four vehicle-status metric cards, the location-detail rows, the quick links and the recent
/// location-history table. Each data source carries its own empty message so no region ever renders blank.
/// </summary>
public sealed record MapOverviewDisplay(
    MapOverviewState State,
    string Title,
    string Subtitle,
    bool ShowNoVehicle,
    bool PageLoading,
    string? PageError,
    bool ShowErrorBanner,
    string ErrorBannerText,
    bool ShowNoGpsBanner,
    string NoGpsBannerText,
    // ── Map (web GlassPanel1) ──
    bool HasValidLocation,
    double MapCenterLat,
    double MapCenterLng,
    string MapStyleId,
    double MarkerLat,
    double MarkerLng,
    string MarkerLabel,
    IReadOnlyList<GeoPoint> Trail,
    string MapEmptyMessage,
    // ── Route playback (web GlassPanel2) ──
    bool ShowPlayback,
    IReadOnlyList<PlaybackPoint> PlaybackPoints,
    string PlaybackTitle,
    string PlaybackAriaLabel,
    string PlayLabel,
    string PauseLabel,
    // ── Metric cards (web Current-Speed / Heading / Lat-Lon / Last-Updated) ──
    bool MetricsLoading,
    bool HasLatest,
    IReadOnlyList<MapMetricDisplay> Metrics,
    // ── Location details (web GlassPanel7) ──
    string LocationDetailsTitle,
    bool HasLocationDetails,
    IReadOnlyList<LocationDetailDisplay> LocationDetails,
    string LocationEmptyMessage,
    // ── Quick links (web GlassPanel8) ──
    string QuickLinksTitle,
    IReadOnlyList<QuickLinkDisplay> QuickLinks,
    // ── Recent location history (web GlassPanel9) ──
    string RecentHistoryTitle,
    bool HistoryLoading,
    bool HasHistory,
    IReadOnlyList<HistoryRowDisplay> HistoryRows,
    string HistoryEmptyMessage,
    string ColTime,
    string ColLat,
    string ColLon,
    string ColSpeed,
    string ColHeading,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (per-query loading flags + the scaffold / banner error text) and the two view controls the page owns: the
/// <see cref="SelectedVehicleId"/> (the header picker, web <c>useSelectedVehicle</c>) and the
/// <see cref="MapStyleId"/> (web <c>useUrlEnum('layer')</c>). The view-model fills this in; tests construct it
/// directly. Pure data — no WinUI types.
/// </summary>
public sealed record MapOverviewModel(
    MapOverviewSnapshot Snapshot,
    bool VehiclesLoading,
    bool LatestLoading,
    bool HistoryLoading,
    string? VehiclesError,
    string? AnyError,
    long? SelectedVehicleId,
    string MapStyleId)
{
    /// <summary>The initial model: the fleet query is in flight with no vehicle resolved yet.</summary>
    public static MapOverviewModel Initial { get; } =
        new(MapOverviewSnapshot.Empty, true, false, false, null, null, null, "dark");
}

/// <summary>
/// Pure projection from <see cref="MapOverviewModel"/> to <see cref="MapOverviewDisplay"/> — the native port of
/// the web MapOverviewPage's <c>useMemo</c> aggregations and JSX. It mirrors the web's display conversions at the
/// boundary via the shared SI converters/formatters (so the native output equals the canonical web truth), and
/// resolves every visible string through the injected localizer. No WinUI / HTTP / IO.
/// </summary>
public static class MapOverviewProjection
{
    /// <summary>Segoe Fluent — Speedometer (web <c>Gauge</c> — the current-speed card).</summary>
    public const string GaugeGlyph = "\uEC4A";

    /// <summary>Segoe Fluent — Compass (web <c>Compass</c> — the heading card).</summary>
    public const string CompassGlyph = "\uE81E";

    /// <summary>Segoe Fluent — MapPin (web <c>MapPin</c> — the lat/lon card + map empty).</summary>
    public const string MapPinGlyph = "\uE707";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c> — the last-updated card + history empty).</summary>
    public const string ClockGlyph = "\uE121";

    /// <summary>Segoe Fluent — Home (web <c>Home</c> — the at-home row).</summary>
    public const string HomeGlyph = "\uE80F";

    /// <summary>Segoe Fluent — Work/Briefcase (web <c>Briefcase</c> — the at-work row).</summary>
    public const string BriefcaseGlyph = "\uE821";

    /// <summary>Segoe Fluent — Link (web <c>Link2</c> — the HomeLink-nearby row).</summary>
    public const string LinkGlyph = "\uE71B";

    /// <summary>Segoe Fluent — Navigation (web <c>Navigation</c> — the odometer row).</summary>
    public const string NavigationGlyph = "\uE81D";

    /// <summary>Segoe Fluent — Route (web <c>Route</c> — the navigation-route quick link).</summary>
    public const string RouteGlyph = "\uE7C0";

    /// <summary>Segoe Fluent — Fence/Geofence (web <c>Fence</c> — the geofences quick link).</summary>
    public const string FenceGlyph = "\uE945";

    /// <summary>Segoe Fluent — LocateFixed (web <c>LocateFixed</c> — the locations quick link).</summary>
    public const string LocateGlyph = "\uE1D2";

    /// <summary>Max GPS samples plotted on the trail / history (web <c>positions?limit=50</c>).</summary>
    public const int HistoryLimit = 50;

    private const string EmDash = "\u2014";
    private const string DegreeSign = "\u00B0";
    private const string CyanBrush = "TsColorAccentBrush";       // web cyan
    private const string PurpleBrush = "TsChartPowerBrush";      // web purple
    private const string GreenBrush = "TsColorSuccessBrush";     // web green / emerald
    private const string MutedBrush = "TsColorTextMutedBrush";
    private const string TrailColorHex = "#00f0ff";              // web Polyline color

    // StatusKind ordinal values (kept as ints so this Microsoft.UI-free file never references the WinUI badge).
    private const int StatusNeutral = 0;
    private const int StatusInfo = 1;
    private const int StatusSuccess = 2;

    /// <summary>The native shell route name the navigation-route quick link opens (web <c>#/maps/navigation-route</c>).</summary>
    public const string NavigationRouteName = "NavigationRoute";

    /// <summary>The native shell route name the geofences quick link opens (web <c>#/maps/geofences</c>).</summary>
    public const string GeofencesRouteName = "Geofences";

    /// <summary>The native shell route name the locations quick link opens (web <c>#/maps/locations</c>).</summary>
    public const string LocationsRouteName = "Locations";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed snapshot plus the lifecycle / selection / map-style controls.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static MapOverviewDisplay Project(MapOverviewModel model, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = MapOverviewStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var latest = snapshot.Latest;
        var location = snapshot.Location;

        bool noVehicle = !model.VehiclesLoading && model.SelectedVehicleId is null;
        bool hasValidLocation = latest is { HasValidLocation: true };
        bool isLoading = (model.VehiclesLoading || model.LatestLoading) && latest is null;
        bool anyError = model.AnyError is not null;

        MapOverviewState state =
            isLoading ? MapOverviewState.Loading
            : anyError ? MapOverviewState.Error
            : hasValidLocation ? MapOverviewState.Success
            : MapOverviewState.Empty;

        string errorBannerText = anyError
            ? $"{s.ErrorLoadFailed}: {model.AnyError}"
            : s.ErrorLoadFailed;

        // ── Map marker + trail (web GlassPanel1) ───────────────────────────────────────────────────────────
        string speedUnitLabel = s.SpeedUnitValue.Replace("{{unit}}", UnitLabels.Label(units.Speed), StringComparison.Ordinal);
        string distanceUnitLabel = s.DistanceUnitValue.Replace("{{unit}}", UnitLabels.Label(units.Distance), StringComparison.Ordinal);

        double centerLat = hasValidLocation ? latest!.Latitude : 0;
        double centerLng = hasValidLocation ? latest!.Longitude : 0;
        string markerLabel = ResolveVehicleName(snapshot, model.SelectedVehicleId, s.Vehicle);
        var trail = BuildTrail(snapshot.History);

        // ── Route playback (web GlassPanel2) ───────────────────────────────────────────────────────────────
        var playback = BuildPlayback(snapshot.History);
        bool showPlayback = playback.Count > 1;

        // ── Vehicle-status metric cards (web Current-Speed / Heading / Lat-Lon / Last-Updated) ─────────────
        bool metricsLoading = isLoading;
        bool hasLatest = latest is not null;
        var metrics = BuildMetrics(latest, hasValidLocation, units, speedUnitLabel, s, now);

        // ── Location details (web GlassPanel7) ─────────────────────────────────────────────────────────────
        bool hasLocationDetails = latest is not null || location is not null;
        var details = BuildLocationDetails(latest, location, units, distanceUnitLabel, s);

        // ── Quick links (web GlassPanel8) ──────────────────────────────────────────────────────────────────
        var quickLinks = new[]
        {
            new QuickLinkDisplay(RouteGlyph, s.NavRoute, NavigationRouteName),
            new QuickLinkDisplay(FenceGlyph, s.Geofences, GeofencesRouteName),
            new QuickLinkDisplay(LocateGlyph, s.Locations, LocationsRouteName),
        };

        // ── Recent location history (web GlassPanel9) ──────────────────────────────────────────────────────
        var historyRows = BuildHistoryRows(snapshot.History, units, speedUnitLabel, now);
        bool hasHistory = historyRows.Count > 0;

        string automationName = $"{s.Title}. {s.Subtitle}";

        return new MapOverviewDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowNoVehicle: noVehicle,
            PageLoading: model.VehiclesLoading && snapshot.Vehicles.Count == 0,
            PageError: model.VehiclesError,
            ShowErrorBanner: anyError,
            ErrorBannerText: errorBannerText,
            ShowNoGpsBanner: !hasValidLocation && latest is not null,
            NoGpsBannerText: s.NoGps,
            HasValidLocation: hasValidLocation,
            MapCenterLat: centerLat,
            MapCenterLng: centerLng,
            MapStyleId: MapStyles.Id(MapStyles.FromId(model.MapStyleId)),
            MarkerLat: centerLat,
            MarkerLng: centerLng,
            MarkerLabel: markerLabel,
            Trail: trail,
            MapEmptyMessage: s.NoLocation,
            ShowPlayback: showPlayback,
            PlaybackPoints: playback,
            PlaybackTitle: s.RecentPlayback,
            PlaybackAriaLabel: s.PlaybackLabel,
            PlayLabel: s.Play,
            PauseLabel: s.Pause,
            MetricsLoading: metricsLoading,
            HasLatest: hasLatest,
            Metrics: metrics,
            LocationDetailsTitle: s.LocationDetails,
            HasLocationDetails: hasLocationDetails,
            LocationDetails: details,
            LocationEmptyMessage: s.NoLocation,
            QuickLinksTitle: s.QuickLinks,
            QuickLinks: quickLinks,
            RecentHistoryTitle: s.RecentHistory,
            HistoryLoading: model.HistoryLoading && snapshot.History.Count == 0,
            HasHistory: hasHistory,
            HistoryRows: historyRows,
            HistoryEmptyMessage: s.NoHistory,
            ColTime: s.ColTime,
            ColLat: s.ColLat,
            ColLon: s.ColLon,
            ColSpeed: s.ColSpeed,
            ColHeading: s.ColHeading,
            AutomationName: automationName);
    }

    private static string ResolveVehicleName(MapOverviewSnapshot snapshot, long? selectedId, string fallback)
    {
        if (selectedId is { } id)
        {
            foreach (var vehicle in snapshot.Vehicles)
            {
                if (vehicle.Id == id && !string.IsNullOrEmpty(vehicle.DisplayName))
                {
                    return vehicle.DisplayName!;
                }
            }
        }

        return fallback;
    }

    private static List<GeoPoint> BuildTrail(IReadOnlyList<PositionRecord> history)
    {
        var points = new List<GeoPoint>(history.Count);
        foreach (var sample in history)
        {
            if (sample.HasValidLocation)
            {
                points.Add(new GeoPoint(sample.Latitude, sample.Longitude));
            }
        }

        return points;
    }

    // Web: time-ordered points for <RoutePlayback>; /positions returns most-recent-first so we sort ascending.
    private static List<PlaybackPoint> BuildPlayback(IReadOnlyList<PositionRecord> history)
    {
        var points = new List<PlaybackPoint>(history.Count);
        foreach (var sample in history)
        {
            if (!sample.HasValidLocation || !TryParseTimestamp(sample.CreatedAt, out var when))
            {
                continue;
            }

            points.Add(new PlaybackPoint(
                Lat: sample.Latitude,
                Lng: sample.Longitude,
                TimestampMs: when.ToUnixTimeMilliseconds(),
                Speed: sample.SpeedMps,
                Soc: sample.BatteryLevel,
                Power: sample.PowerW));
        }

        points.Sort(static (a, b) => a.TimestampMs.CompareTo(b.TimestampMs));
        return points;
    }

    private static MapMetricDisplay[] BuildMetrics(
        PositionRecord? latest,
        bool hasValidLocation,
        UnitPref units,
        string speedUnitLabel,
        MapOverviewStrings s,
        DateTimeOffset now)
    {
        if (latest is null)
        {
            return Array.Empty<MapMetricDisplay>();
        }

        string speedValue = $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(latest.SpeedMps ?? 0, units.Speed), 1)} {speedUnitLabel}";
        string headingValue = latest.Heading is { } h ? $"{ScalarFormatters.FormatNumber(h, 0)}{DegreeSign}" : EmDash;
        string latLonValue = hasValidLocation
            ? $"{ScalarFormatters.FormatNumber(latest.Latitude, 4)}, {ScalarFormatters.FormatNumber(latest.Longitude, 4)}"
            : EmDash;
        string updatedValue = DateTimeFormatting.Format(ParseTimestampOrNull(latest.CreatedAt), DateTimeVariant.Full, now);

        return new[]
        {
            new MapMetricDisplay(s.CurrentSpeed, speedValue, GaugeGlyph, CyanBrush),
            new MapMetricDisplay(s.Heading, headingValue, CompassGlyph, PurpleBrush),
            new MapMetricDisplay(s.LatLon, latLonValue, MapPinGlyph, GreenBrush),
            new MapMetricDisplay(s.LastUpdated, updatedValue, ClockGlyph, CyanBrush, s.AutoRefresh),
        };
    }

    private static LocationDetailDisplay[] BuildLocationDetails(
        PositionRecord? latest,
        LocationSnapshot? location,
        UnitPref units,
        string distanceUnitLabel,
        MapOverviewStrings s)
    {
        if (latest is null && location is null)
        {
            return Array.Empty<LocationDetailDisplay>();
        }

        bool? atHome = location?.LocatedAtHome;
        bool? atWork = location?.LocatedAtWork;
        bool homelink = location?.HomelinkNearby ?? false;

        string odometerValue = latest is not null
            ? $"{ScalarFormatters.FormatNumber(UnitConverters.DistanceFromSi(latest.OdometerM, units.Distance), 1)} {distanceUnitLabel}"
            : EmDash;

        return new[]
        {
            new LocationDetailDisplay(
                HomeGlyph,
                atHome == true ? GreenBrush : MutedBrush,
                s.AtHome,
                string.Empty,
                ShowBadge: true,
                BadgeText: TriStateText(atHome, s),
                BadgeStatus: atHome == true ? StatusSuccess : StatusNeutral,
                BadgeDot: true),
            new LocationDetailDisplay(
                BriefcaseGlyph,
                atWork == true ? GreenBrush : MutedBrush,
                s.AtWork,
                string.Empty,
                ShowBadge: true,
                BadgeText: TriStateText(atWork, s),
                BadgeStatus: atWork == true ? StatusSuccess : StatusNeutral,
                BadgeDot: true),
            new LocationDetailDisplay(
                LinkGlyph,
                homelink ? CyanBrush : MutedBrush,
                s.HomelinkNearby,
                string.Empty,
                ShowBadge: true,
                BadgeText: homelink ? s.Yes : s.No,
                BadgeStatus: homelink ? StatusInfo : StatusNeutral,
                BadgeDot: true),
            new LocationDetailDisplay(
                NavigationGlyph,
                PurpleBrush,
                s.Odometer,
                odometerValue,
                ShowBadge: false,
                BadgeText: string.Empty,
                BadgeStatus: StatusNeutral,
                BadgeDot: false),
        };
    }

    private static List<HistoryRowDisplay> BuildHistoryRows(
        IReadOnlyList<PositionRecord> history,
        UnitPref units,
        string speedUnitLabel,
        DateTimeOffset now)
    {
        var rows = new List<HistoryRowDisplay>(history.Count);
        foreach (var sample in history)
        {
            string time = DateTimeFormatting.Format(ParseTimestampOrNull(sample.CreatedAt), DateTimeVariant.Full, now);
            string lat = sample.HasValidLocation ? ScalarFormatters.FormatNumber(sample.Latitude, 5) : EmDash;
            string lon = sample.HasValidLocation ? ScalarFormatters.FormatNumber(sample.Longitude, 5) : EmDash;
            string speed = $"{ScalarFormatters.FormatNumber(UnitConverters.SpeedFromSi(sample.SpeedMps ?? 0, units.Speed), 1)} {speedUnitLabel}";
            string heading = sample.Heading is { } h ? $"{ScalarFormatters.FormatNumber(h, 0)}{DegreeSign}" : EmDash;
            rows.Add(new HistoryRowDisplay(sample.Id, time, lat, lon, speed, heading));
        }

        return rows;
    }

    private static string TriStateText(bool? value, MapOverviewStrings s) =>
        value == true ? s.Yes : value == false ? s.No : s.Unknown;

    private static DateTimeOffset? ParseTimestampOrNull(string? value) =>
        TryParseTimestamp(value, out var parsed) ? parsed : null;

    private static bool TryParseTimestamp(string? value, out DateTimeOffset parsed)
    {
        if (!string.IsNullOrWhiteSpace(value) &&
            DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out parsed))
        {
            return true;
        }

        parsed = default;
        return false;
    }

    /// <summary>The web Polyline trail colour (exposed so the view tints the native polyline identically).</summary>
    public static string TrailColor => TrailColorHex;
}

/// <summary>
/// Canonical metadata for the <c>MapOverviewPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/maps/pages/MapOverviewPage.tsx</c> (route <c>/live</c>, nav name <c>LiveMap</c>). Holds
/// the route name, the generated operation ids it binds to, the diagnostics slug and the page-size constants.
/// </summary>
public static class MapOverviewRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "MapOverviewPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c> entry <c>Page("LiveMap","live",…)</c>).</summary>
    public const string RouteName = "LiveMap";

    /// <summary>The generated operation id for the fleet read (web <c>useVehicles</c> → <c>GET /vehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    /// <summary>The generated operation id for the per-vehicle position read (web <c>positions?limit=…</c>).</summary>
    public const string PositionsOperation = Operations.Vehicles.Positions;

    /// <summary>The generated operation id for the latest location snapshot (web <c>GET /location-snapshots/latest</c>).</summary>
    public const string LocationSnapshotOperation = Operations.Locations.SnapshotLatest;

    /// <summary>The page size for the latest-position read (web <c>limit=1</c>).</summary>
    public const int LatestLimit = 1;

    /// <summary>The page size for the position-history read (web <c>limit=50</c>).</summary>
    public const int HistoryLimit = 50;
}

/// <summary>
/// PII-safe diagnostics for the <c>MapOverviewPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a coordinate, vehicle id or timestamp —
/// so a diagnostics line can never leak a user's live location. Thread-safe.
/// </summary>
public sealed class MapOverviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public MapOverviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MapOverviewPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MapOverviewRegistration.Slug}");
    }
}

/// <summary>
/// The resolved, localized copy the projection renders — every visible literal of MapOverviewPage.tsx as a
/// pre-resolved string keyed by the verbatim web i18n key (so the native key names equal the web's). Resolved
/// once per projection so the full key set is exercised even in the loading state.
/// </summary>
public sealed record MapOverviewStrings(
    string ErrorLoadFailed,
    string AtHome,
    string AtWork,
    string AutoRefresh,
    string ColHeading,
    string ColLat,
    string ColLon,
    string ColSpeed,
    string ColTime,
    string CurrentSpeed,
    string DistanceUnitValue,
    string Geofences,
    string Heading,
    string HomelinkNearby,
    string LastUpdated,
    string LatLon,
    string LocationDetails,
    string Locations,
    string NavRoute,
    string No,
    string NoGps,
    string NoHistory,
    string NoLocation,
    string Odometer,
    string PageTitle,
    string PlaybackLabel,
    string QuickLinks,
    string RecentHistory,
    string RecentPlayback,
    string SpeedUnitValue,
    string Subtitle,
    string Title,
    string Unknown,
    string Vehicle,
    string Yes,
    string Play,
    string Pause)
{
    /// <summary>Resolve every visible string of the page through the i18n facade (web key names, verbatim).</summary>
    public static MapOverviewStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new MapOverviewStrings(
            ErrorLoadFailed: localizer.GetString("error.loadFailed", "Failed to load data"),
            AtHome: localizer.GetString("mapOverview.atHome", "At Home"),
            AtWork: localizer.GetString("mapOverview.atWork", "At Work"),
            AutoRefresh: localizer.GetString("mapOverview.autoRefresh", "Auto-refreshes every 15 s"),
            ColHeading: localizer.GetString("mapOverview.colHeading", "Heading"),
            ColLat: localizer.GetString("mapOverview.colLat", "Lat"),
            ColLon: localizer.GetString("mapOverview.colLon", "Lon"),
            ColSpeed: localizer.GetString("mapOverview.colSpeed", "Speed"),
            ColTime: localizer.GetString("mapOverview.colTime", "Time"),
            CurrentSpeed: localizer.GetString("mapOverview.currentSpeed", "Current Speed"),
            DistanceUnitValue: localizer.GetString("mapOverview.distanceUnitValue", "{{unit}}"),
            Geofences: localizer.GetString("mapOverview.geofences", "Geofences"),
            Heading: localizer.GetString("mapOverview.heading", "Heading"),
            HomelinkNearby: localizer.GetString("mapOverview.homelinkNearby", "HomeLink Nearby"),
            LastUpdated: localizer.GetString("mapOverview.lastUpdated", "Last Updated"),
            LatLon: localizer.GetString("mapOverview.latLon", "Lat / Lon"),
            LocationDetails: localizer.GetString("mapOverview.locationDetails", "Location Details"),
            Locations: localizer.GetString("mapOverview.locations", "Locations"),
            NavRoute: localizer.GetString("mapOverview.navRoute", "Navigation Route"),
            No: localizer.GetString("mapOverview.no", "No"),
            NoGps: localizer.GetString("mapOverview.noGps", "GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming."),
            NoHistory: localizer.GetString("mapOverview.noHistory", "No location history found."),
            NoLocation: localizer.GetString("mapOverview.noLocation", "No GPS data available. Location data requires Fleet Telemetry streaming."),
            Odometer: localizer.GetString("mapOverview.odometer", "Odometer"),
            PageTitle: localizer.GetString("mapOverview.pageTitle", "Map Overview"),
            PlaybackLabel: localizer.GetString("mapOverview.playbackLabel", "Recent route playback map"),
            QuickLinks: localizer.GetString("mapOverview.quickLinks", "Quick Links"),
            RecentHistory: localizer.GetString("mapOverview.recentHistory", "Recent Location History"),
            RecentPlayback: localizer.GetString("mapOverview.recentPlayback", "Recent Route Playback"),
            SpeedUnitValue: localizer.GetString("mapOverview.speedUnitValue", "{{unit}}"),
            Subtitle: localizer.GetString("mapOverview.subtitle", "Live vehicle location and recent history"),
            Title: localizer.GetString("mapOverview.title", "Map Overview"),
            Unknown: localizer.GetString("mapOverview.unknown", "Unknown"),
            Vehicle: localizer.GetString("mapOverview.vehicle", "Vehicle"),
            Yes: localizer.GetString("mapOverview.yes", "Yes"),
            // Non-parity transport labels for the route-playback control (web RoutePlayback internal copy).
            Play: localizer.GetString("mapOverview.playbackPlay", "Play"),
            Pause: localizer.GetString("mapOverview.playbackPause", "Pause"));
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case map JSON wire shape (no camelCaseKeys transform on native): numbers
/// (or numeric strings), booleans, 64-bit ids and strings. Kept internal so the page's parsers stay
/// self-contained and never throw on a partial body.
/// </summary>
internal static class MapOverviewJson
{
    public static double? Double(JsonElement obj, string name)
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

    public static long? Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    public static bool? Bool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
