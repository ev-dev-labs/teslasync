using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the trip-replay map surface. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted drive body from
/// <c>GET /drives/{driveID}</c> never aborts the parse (web parity: the page reads <c>p.latitude</c> /
/// <c>p.speed ?? 0</c> and tolerates an undefined field). Kept private to the surface and free of WinUI types so
/// the parse is unit-tested without a UI host.
/// </summary>
internal static class TripReplayMapJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(
                prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The timestamp value of the first present name in <paramref name="names"/>, or null.</summary>
    public static DateTimeOffset? GetDateTime(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            var raw = GetString(obj, name);
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            if (DateTimeOffset.TryParse(
                    raw,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                    out var dto))
            {
                return dto;
            }
        }

        return null;
    }
}

/// <summary>
/// The mutually-exclusive surface state the trip-replay map renders across the web component's data lifecycle —
/// the native union of the loading / loaded / empty / error / stale / offline branches a P2 feature surface must
/// render for web/src/features/trips/components/TripReplayMap.tsx. The web component is a pure child of the Trip
/// Replay page (fed the <c>positions</c> prop from <c>useDrive(id)</c>); the native feature-view owns its
/// cache-then-network drive read and therefore renders the full state matrix. <see cref="Empty"/> mirrors the web
/// <c>positions.length === 0</c> empty state and is distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum TripReplayMapState
{
    /// <summary>Initial fetch with no cached drive — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved drive with at least one position — render the map (route or stationary anchor).</summary>
    Ready,

    /// <summary>No vehicle / drive resolved, or a drive with no positions — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached drive exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached drive older than the freshness window — render the map plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached drive remains — render the map plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive GPS sample projected from the drive-detail <c>positions</c> array (web <c>DrivePosition</c> in
/// <c>@/types/driving</c>). Only the fields the trip-replay map reads are kept: the SI <c>latitude</c> /
/// <c>longitude</c> in degrees (web <c>latitude</c> / <c>longitude</c>), the SI <c>speed</c> used to colour each
/// leg (web <c>speed</c>), and the timestamp (used to order the trail). Parsing is null-tolerant so a partial row
/// never throws; a missing coordinate stays <see cref="double.NaN"/> and is treated as an invalid fix by
/// <see cref="TripReplayGeo.IsValidLatLng"/>, exactly as the web's <c>isValidLatLng</c> rejects a non-finite value.
/// </summary>
/// <param name="Latitude">Latitude in degrees, or <see cref="double.NaN"/> when absent (web <c>latitude</c>).</param>
/// <param name="Longitude">Longitude in degrees, or <see cref="double.NaN"/> when absent (web <c>longitude</c>).</param>
/// <param name="SpeedMps">Speed in SI metres-per-second, or null (web <c>speed</c>).</param>
/// <param name="TimestampUtc">Sample instant, or null (web <c>timestamp</c> with <c>created_at</c> fallback).</param>
public sealed record TripPositionSample(
    double Latitude,
    double Longitude,
    double? SpeedMps,
    DateTimeOffset? TimestampUtc)
{
    /// <summary>This sample's coordinate as a <see cref="GeoPoint"/>.</summary>
    public GeoPoint Location => new(Latitude, Longitude);

    /// <summary>Project a single drive-position JSON object into a tolerant sample.</summary>
    public static TripPositionSample FromJson(JsonElement obj) => new(
        Latitude: TripReplayMapJson.GetDouble(obj, "latitude") ?? double.NaN,
        Longitude: TripReplayMapJson.GetDouble(obj, "longitude") ?? double.NaN,
        SpeedMps: TripReplayMapJson.GetDouble(obj, "speed"),

        // Web parity: the page reads `p.timestamp` (with `created_at` fallback) to order the trail.
        TimestampUtc: TripReplayMapJson.GetDateTime(obj, "timestamp", "created_at", "createdAt"));

    /// <summary>Parse a drive-positions JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<TripPositionSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TripPositionSample>();
        }

        var list = new List<TripPositionSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>
/// The parsed read-model for the trip-replay map — the ordered drive positions the web page feeds into the
/// component as the <c>positions</c> prop. <see cref="FromJson"/> tolerates the drive-detail object
/// (<c>{ "positions": [...] , ... }</c>) as well as a bare positions array, so a schema drift degrades to an empty
/// map rather than a throw.
/// </summary>
/// <param name="Positions">The parsed positions in recorded order (never null; empty when the body carried none).</param>
public sealed record TripReplayMapData(IReadOnlyList<TripPositionSample> Positions)
{
    /// <summary>An empty read-model (no positions).</summary>
    public static TripReplayMapData Empty { get; } = new(Array.Empty<TripPositionSample>());

    /// <summary>Parse a drive-detail (or bare positions array) response into the typed read-model.</summary>
    public static TripReplayMapData FromJson(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return new TripReplayMapData(TripPositionSample.ParseList(root));
        }

        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("positions", out var positions)
            && positions.ValueKind == JsonValueKind.Array)
        {
            return new TripReplayMapData(TripPositionSample.ParseList(positions));
        }

        return Empty;
    }
}

/// <summary>
/// Pure, WinUI-free geometry helpers ported verbatim from the web <c>@/lib/geo</c> module the trip-replay map
/// relies on. Reproduces the haversine distance, the <c>(0,0)</c>-rejecting coordinate validity test, the
/// "meaningful route" detection (≥ two valid fixes separated by at least
/// <see cref="MinMeaningfulRouteMeters"/> metres), the first-valid-index anchor, the nearest-sample scan that
/// drives the polyline-click seek, the speed-band colour ramp, and the playhead bearing. Free of WinUI types so
/// every helper is unit-tested without a UI host.
/// </summary>
public static class TripReplayGeo
{
    /// <summary>Earth radius in metres (web <c>R = 6_371_000</c>).</summary>
    public const double EarthRadiusMeters = 6_371_000;

    /// <summary>
    /// Minimum separation (metres) between two GPS samples for the route to be considered meaningfully spatial
    /// (web <c>MIN_MEANINGFUL_ROUTE_METERS</c>). Below this, points are treated as a single stationary cluster.
    /// </summary>
    public const double MinMeaningfulRouteMeters = 10;

    /// <summary>Speed-band upper bound (web <c>speedColor</c> &lt; 30) below which the leg is emerald.</summary>
    public const double SpeedLowThreshold = 30;

    /// <summary>Speed-band upper bound (web <c>speedColor</c> &lt; 60) below which the leg is cyan.</summary>
    public const double SpeedMedThreshold = 60;

    /// <summary>Speed-band upper bound (web <c>speedColor</c> &lt; 100) below which the leg is amber.</summary>
    public const double SpeedHighThreshold = 100;

    /// <summary>Emerald leg colour, web <c>'#10b981'</c> (below <see cref="SpeedLowThreshold"/>).</summary>
    public const string SpeedLowColorHex = "#10b981";

    /// <summary>Cyan leg colour, web <c>'#22d3ee'</c> (below <see cref="SpeedMedThreshold"/>).</summary>
    public const string SpeedMedColorHex = "#22d3ee";

    /// <summary>Amber leg colour, web <c>'#f59e0b'</c> (below <see cref="SpeedHighThreshold"/>).</summary>
    public const string SpeedHighColorHex = "#f59e0b";

    /// <summary>Red leg colour, web <c>'#ef4444'</c> (at or above <see cref="SpeedHighThreshold"/>).</summary>
    public const string SpeedOverColorHex = "#ef4444";

    /// <summary>The great-circle distance in metres between two coordinates (web <c>haversineDistance</c>).</summary>
    public static double HaversineMeters(double lat1, double lon1, double lat2, double lon2)
    {
        static double ToRad(double deg) => deg * Math.PI / 180.0;

        double dLat = ToRad(lat2 - lat1);
        double dLon = ToRad(lon2 - lon1);
        double a = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2))
            + (Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2));
        return EarthRadiusMeters * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    /// <summary>
    /// True iff <paramref name="lat"/>/<paramref name="lng"/> is finite, non-(0,0), and within global bounds
    /// (web <c>isValidLatLng</c>). <c>(0, 0)</c> is rejected — the canonical "GPS not yet fixed" sentinel.
    /// </summary>
    public static bool IsValidLatLng(double lat, double lng)
    {
        if (!double.IsFinite(lat) || !double.IsFinite(lng))
        {
            return false;
        }

        if (lat == 0 && lng == 0)
        {
            return false;
        }

        return lat is >= -90 and <= 90 && lng is >= -180 and <= 180;
    }

    /// <summary>The index of the first valid coordinate, or -1 when none (web <c>firstValidIndex</c>).</summary>
    public static int FirstValidIndex(IReadOnlyList<TripPositionSample> positions)
    {
        ArgumentNullException.ThrowIfNull(positions);
        for (int i = 0; i < positions.Count; i++)
        {
            if (IsValidLatLng(positions[i].Latitude, positions[i].Longitude))
            {
                return i;
            }
        }

        return -1;
    }

    /// <summary>
    /// True iff <paramref name="positions"/> contains at least two valid coordinates separated by at least
    /// <see cref="MinMeaningfulRouteMeters"/> metres (web <c>hasMeaningfulRoute</c>). Short-circuits on the first
    /// sample beyond the threshold.
    /// </summary>
    public static bool HasMeaningfulRoute(IReadOnlyList<TripPositionSample> positions)
    {
        ArgumentNullException.ThrowIfNull(positions);

        int anchorIdx = FirstValidIndex(positions);
        if (anchorIdx < 0)
        {
            return false;
        }

        var anchor = positions[anchorIdx];
        for (int i = anchorIdx + 1; i < positions.Count; i++)
        {
            var p = positions[i];
            if (!IsValidLatLng(p.Latitude, p.Longitude))
            {
                continue;
            }

            if (HaversineMeters(anchor.Latitude, anchor.Longitude, p.Latitude, p.Longitude) >= MinMeaningfulRouteMeters)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// The index of the position closest (by haversine) to <paramref name="lat"/>/<paramref name="lng"/>
    /// (web <c>nearestSampleIndex</c>). Returns 0 for an empty list. Linear scan — trip-replay polylines top out
    /// at a few thousand samples, well within an O(n) click budget.
    /// </summary>
    public static int NearestSampleIndex(IReadOnlyList<TripPositionSample> positions, double lat, double lng)
    {
        ArgumentNullException.ThrowIfNull(positions);
        if (positions.Count == 0)
        {
            return 0;
        }

        int bestIdx = 0;
        double bestDist = double.PositiveInfinity;
        for (int i = 0; i < positions.Count; i++)
        {
            double d = HaversineMeters(positions[i].Latitude, positions[i].Longitude, lat, lng);
            if (d < bestDist)
            {
                bestDist = d;
                bestIdx = i;
            }
        }

        return bestIdx;
    }

    /// <summary>The leg colour for a speed value (web <c>speedColor</c>); the SI speed is banded as-is.</summary>
    public static string SpeedColorHex(double speed)
    {
        if (speed < SpeedLowThreshold)
        {
            return SpeedLowColorHex;
        }

        if (speed < SpeedMedThreshold)
        {
            return SpeedMedColorHex;
        }

        return speed < SpeedHighThreshold ? SpeedHighColorHex : SpeedOverColorHex;
    }

    /// <summary>
    /// The forward-azimuth bearing in degrees [0,360) from <paramref name="p1"/> to <paramref name="p2"/>
    /// (web <c>computeHeading</c>).
    /// </summary>
    public static double ComputeHeadingDegrees(TripPositionSample p1, TripPositionSample p2)
    {
        ArgumentNullException.ThrowIfNull(p1);
        ArgumentNullException.ThrowIfNull(p2);

        static double ToRad(double deg) => deg * Math.PI / 180.0;
        static double ToDeg(double rad) => rad * 180.0 / Math.PI;

        double dLon = ToRad(p2.Longitude - p1.Longitude);
        double y = Math.Sin(dLon) * Math.Cos(ToRad(p2.Latitude));
        double x = (Math.Cos(ToRad(p1.Latitude)) * Math.Sin(ToRad(p2.Latitude)))
            - (Math.Sin(ToRad(p1.Latitude)) * Math.Cos(ToRad(p2.Latitude)) * Math.Cos(dLon));
        return ((ToDeg(Math.Atan2(y, x)) % 360) + 360) % 360;
    }
}

/// <summary>
/// One speed-coloured leg of the route polyline — the native analogue of the web inline <c>speedSegments</c>
/// entry (a two-point <c>positions</c> array plus a <c>color</c>). The colour is assigned from the leg's SI speed
/// by <see cref="TripReplayGeo.SpeedColorHex"/>, exactly as the web component does. Pure data — no WinUI types.
/// </summary>
/// <param name="Positions">The ordered coordinates of the leg (web <c>seg.positions</c>); always two points.</param>
/// <param name="ColorHex">The leg's stroke colour as a <c>#rrggbb</c> hex string (web <c>seg.color</c>).</param>
public sealed record TripReplaySpeedSegment(IReadOnlyList<GeoPoint> Positions, string ColorHex);

/// <summary>
/// The render-ready model the WinUI <see cref="TripReplayMap"/> view binds to — the native projection of the web
/// component's inline <c>useMemo</c> derivations (<c>hasRoute</c>, <c>trail</c>, <c>speedSegments</c>,
/// <c>startPos</c>, <c>endPos</c>, <c>anchorPoint</c>, <c>centerPos</c>). The view is a thin renderer over this.
/// </summary>
/// <param name="CenterLatitude">The initial map-centre latitude (web <c>centerPos</c>).</param>
/// <param name="CenterLongitude">The initial map-centre longitude (web <c>centerPos</c>).</param>
/// <param name="Zoom">The initial zoom (web <c>zoom={13}</c> for a route, 15 for a single anchor).</param>
/// <param name="HasRoute">True when a meaningful spatial route exists (web <c>hasRoute</c>).</param>
/// <param name="FitToTrail">True when the view should fit bounds to <see cref="Trail"/> once measured.</param>
/// <param name="Trail">The ordered polyline path (web <c>trail</c>); empty for the stationary case.</param>
/// <param name="Segments">The speed-coloured legs (web <c>speedSegments</c>); empty for the stationary case.</param>
/// <param name="StartPos">The first trail coordinate (web <c>startPos</c>), or null.</param>
/// <param name="EndPos">The last trail coordinate when the trail has &gt; 1 point (web <c>endPos</c>), or null.</param>
/// <param name="AnchorPos">The single anchor coordinate for the stationary case (web <c>anchorPoint</c>), or null.</param>
/// <param name="PositionCount">The number of resolved positions (web <c>positions.length</c>).</param>
/// <param name="ShowStationaryBanner">True when positions exist but no route can be plotted (web <c>!hasRoute</c> banner).</param>
/// <param name="MapLabel">The accessible map-region name.</param>
/// <param name="EmptyMessage">The empty-state copy when no positions exist (web <c>replay.map.noPositions</c>).</param>
/// <param name="StationaryTitle">The stationary banner title (web <c>replay.map.stationaryRouteTitle</c>).</param>
/// <param name="StationaryBody">The stationary banner body (web <c>replay.map.stationaryRouteBody</c>).</param>
/// <param name="RouteSummary">A one-line Narrator summary of the plotted route (or anchor).</param>
public sealed record TripReplayMapDisplay(
    double CenterLatitude,
    double CenterLongitude,
    int Zoom,
    bool HasRoute,
    bool FitToTrail,
    IReadOnlyList<GeoPoint> Trail,
    IReadOnlyList<TripReplaySpeedSegment> Segments,
    GeoPoint? StartPos,
    GeoPoint? EndPos,
    GeoPoint? AnchorPos,
    int PositionCount,
    bool ShowStationaryBanner,
    string MapLabel,
    string EmptyMessage,
    string StationaryTitle,
    string StationaryBody,
    string RouteSummary)
{
    /// <summary>True when at least one position resolved (web <c>positions.length &gt; 0</c>).</summary>
    public bool HasContent => PositionCount > 0;
}

/// <summary>
/// Pure, WinUI-free projection from the parsed positions to the display model — the native port of the web
/// component's inline <c>useMemo</c> computations in
/// <c>web/src/features/trips/components/TripReplayMap.tsx</c>. Reproduces, in order: the <c>hasRoute</c> /
/// <c>anchorIdx</c> / <c>anchorPoint</c> derivation, the <c>trail</c> (built only for a real route), the
/// <c>startPos</c> / <c>endPos</c>, the <c>centerPos = startPos ?? anchorPoint ?? [47.6, -122.3]</c> fallback, and
/// the per-leg <c>speedSegments</c> coloured by <see cref="TripReplayGeo.SpeedColorHex"/>. Every string flows
/// through the i18n facade.
/// </summary>
public static class TripReplayMapProjection
{
    /// <summary>Default centre latitude when there is no startable coordinate (web <c>[47.6, -122.3]</c>).</summary>
    public const double DefaultCenterLatitude = 47.6;

    /// <summary>Default centre longitude when there is no startable coordinate (web <c>[47.6, -122.3]</c>).</summary>
    public const double DefaultCenterLongitude = -122.3;

    /// <summary>The initial zoom for a plotted route (web <c>zoom={13}</c>).</summary>
    public const int RouteZoom = 13;

    /// <summary>The initial zoom for a single anchor / stationary fix (web <c>setView(fallback, 15)</c>).</summary>
    public const int AnchorZoom = 15;

    /// <summary>Project <paramref name="data"/> into the render-ready map model using the localizer for every label.</summary>
    /// <param name="data">The parsed positions, or null when none resolved.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TripReplayMapDisplay Project(TripReplayMapData? data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<TripPositionSample> positions = data?.Positions ?? Array.Empty<TripPositionSample>();

        bool hasRoute = TripReplayGeo.HasMeaningfulRoute(positions);
        int anchorIdx = TripReplayGeo.FirstValidIndex(positions);
        GeoPoint? anchorPoint = anchorIdx >= 0 ? positions[anchorIdx].Location : null;

        // Web parity: trail is built only when there is a real route to draw; the stationary case skips it.
        var trail = new List<GeoPoint>(hasRoute ? positions.Count : 0);
        if (hasRoute)
        {
            foreach (var p in positions)
            {
                trail.Add(p.Location);
            }
        }

        GeoPoint? startPos = trail.Count > 0 ? trail[0] : null;
        GeoPoint? endPos = trail.Count > 1 ? trail[^1] : null;

        // Web parity: centerPos = startPos ?? anchorPoint ?? [47.6, -122.3].
        GeoPoint center = startPos ?? anchorPoint ?? new GeoPoint(DefaultCenterLatitude, DefaultCenterLongitude);

        var segments = BuildSpeedSegments(positions, hasRoute);

        bool showStationary = positions.Count > 0 && !hasRoute;
        int zoom = hasRoute && trail.Count > 1 ? RouteZoom : AnchorZoom;

        return new TripReplayMapDisplay(
            CenterLatitude: center.Lat,
            CenterLongitude: center.Lng,
            Zoom: zoom,
            HasRoute: hasRoute,
            FitToTrail: hasRoute && trail.Count > 1,
            Trail: trail,
            Segments: segments,
            StartPos: startPos,
            EndPos: endPos,
            AnchorPos: hasRoute ? null : anchorPoint,
            PositionCount: positions.Count,
            ShowStationaryBanner: showStationary,
            MapLabel: TripReplayMapRegistration.MapLabel(localizer),
            EmptyMessage: TripReplayMapRegistration.NoPositions(localizer),
            StationaryTitle: TripReplayMapRegistration.StationaryRouteTitle(localizer),
            StationaryBody: TripReplayMapRegistration.StationaryRouteBody(localizer),
            RouteSummary: hasRoute
                ? CoordinateSummary.Route(trail)
                : anchorPoint is { } a
                    ? CoordinateSummary.Coordinate(a)
                    : TripReplayMapRegistration.NoPositions(localizer));
    }

    // Web parity: for i in 1..n push a two-point leg coloured by speedColor(curr.speed ?? 0).
    private static IReadOnlyList<TripReplaySpeedSegment> BuildSpeedSegments(
        IReadOnlyList<TripPositionSample> positions, bool hasRoute)
    {
        if (!hasRoute || positions.Count < 2)
        {
            return Array.Empty<TripReplaySpeedSegment>();
        }

        var segments = new List<TripReplaySpeedSegment>(positions.Count - 1);
        for (int i = 1; i < positions.Count; i++)
        {
            var prev = positions[i - 1];
            var curr = positions[i];
            segments.Add(new TripReplaySpeedSegment(
                Positions: new[] { prev.Location, curr.Location },
                ColorHex: TripReplayGeo.SpeedColorHex(curr.SpeedMps ?? 0)));
        }

        return segments;
    }
}

/// <summary>
/// Maps a raw cache-then-network <see cref="JsonElement"/> emission to a typed <see cref="TripReplayMapData"/>
/// result, preserving the lifecycle status so the view-model keeps content visible while refreshing (the same
/// contract <see cref="TeslaChargingSessionsMapResultMapper"/> follows).
/// </summary>
public static class TripReplayMapResultMapper
{
    /// <summary>Map a raw drive emission to a typed trip-replay map result.</summary>
    public static RepositoryResult<TripReplayMapData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<TripReplayMapData>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<TripReplayMapData>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<TripReplayMapData>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var data = TripReplayMapData.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<TripReplayMapData>.Cached(data, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TripReplayMapData>.Refreshing(data, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<TripReplayMapData>.OfflineCached(
                data, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<TripReplayMapData>.Loaded(data, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical metadata + localized copy for the trip-replay map surface — the native mirror of the web component
/// at <c>web/src/features/trips/components/TripReplayMap.tsx</c>. Centralises the diagnostics slug, the map-pin
/// glyph, and the i18n keys (the three web-source <c>replay.map.*</c> keys plus shared <c>common.*</c> /
/// <c>error.*</c> / <c>mqtt.*</c> chrome keys) so the view and view-model stay free of literal strings.
/// </summary>
public static class TripReplayMapRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TripReplayMap";

    /// <summary>Segoe Fluent "MapPin" glyph (web Leaflet marker / empty-state pin).</summary>
    public const string MapPinGlyph = "\uE707";

    /// <summary>Segoe Fluent "Navigation" glyph (web <c>Navigation2</c> stationary-banner icon).</summary>
    public const string NavigationGlyph = "\uE8A1";

    /// <summary>The accessible map-region name.</summary>
    public static string MapLabel(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.label", "Trip replay map");

    /// <summary>The empty-state copy when no positions exist (web <c>replay.map.noPositions</c>).</summary>
    public static string NoPositions(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.noPositions", "No position data available for this drive");

    /// <summary>The stationary-route banner title (web <c>replay.map.stationaryRouteTitle</c>).</summary>
    public static string StationaryRouteTitle(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.stationaryRouteTitle", "Route can't be plotted");

    /// <summary>The stationary-route banner body (web <c>replay.map.stationaryRouteBody</c>).</summary>
    public static string StationaryRouteBody(ILocalizer localizer) =>
        Require(localizer).GetString(
            "replay.map.stationaryRouteBody",
            "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The trip statistics, "
                + "speed, and elevation timeline above the scrubber are unaffected.");

    /// <summary>The Narrator label for the green start dot (web Leaflet start <c>CircleMarker</c>).</summary>
    public static string StartLabel(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.startLabel", "Trip start");

    /// <summary>The Narrator label for the red end dot (web Leaflet end <c>CircleMarker</c>).</summary>
    public static string EndLabel(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.endLabel", "Trip end");

    /// <summary>The Narrator label for the cyan stationary anchor dot (web single-fix <c>CircleMarker</c>).</summary>
    public static string AnchorLabel(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.anchorLabel", "Last recorded position");

    /// <summary>The Narrator label for the animated playhead marker (web <c>AnimatedMarker</c>).</summary>
    public static string PlayheadLabel(ILocalizer localizer) =>
        Require(localizer).GetString("replay.map.playheadLabel", "Current playback position");

    /// <summary>The stale freshness-chip label.</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("mqtt.stale", "Stale");

    /// <summary>The offline freshness-chip label.</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>The retry affordance label (web <c>QueryError</c> retry).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>The loading Narrator announcement.</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading...");

    /// <summary>The hard-error copy shown when no cached drive exists.</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("error.loadFailed", "Failed to load data");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the trip-replay map surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a coordinate, drive id, VIN, or timestamp —
/// so a diagnostics line can never leak a user's whereabouts. Thread-safe.
/// </summary>
public sealed class TripReplayMapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TripReplayMapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TripReplayMap</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TripReplayMapRegistration.Slug}");
    }
}
