using System.Globalization;

namespace TeslaSync.App.Core.Maps;

/// <summary>The geometric kind of a geofence shape.</summary>
public enum GeofenceShape
{
    /// <summary>A circle defined by a centre and a radius in metres.</summary>
    Circle,

    /// <summary>A free-form polygon ring.</summary>
    Polygon,

    /// <summary>An axis-aligned rectangle (stored as a 4-vertex ring).</summary>
    Rectangle,
}

/// <summary>
/// A persisted or drawn geofence (port of the web <c>DrawableGeofence</c>). Circles
/// use <see cref="Lat"/>/<see cref="Lng"/>/<see cref="RadiusMeters"/>; polygons and
/// rectangles use <see cref="Polygon"/>.
/// </summary>
/// <param name="Id">Stable identifier.</param>
/// <param name="Lat">Circle centre latitude.</param>
/// <param name="Lng">Circle centre longitude.</param>
/// <param name="RadiusMeters">Circle radius in metres.</param>
/// <param name="Polygon">Polygon / rectangle ring of points.</param>
/// <param name="Name">Optional display name.</param>
public sealed record DrawableGeofence(
    string Id,
    double? Lat = null,
    double? Lng = null,
    double? RadiusMeters = null,
    IReadOnlyList<GeoPoint>? Polygon = null,
    string? Name = null);

/// <summary>New geometry produced by the drawer before it is assigned an id.</summary>
/// <param name="Shape">The drawn shape kind.</param>
/// <param name="Lat">Circle centre latitude.</param>
/// <param name="Lng">Circle centre longitude.</param>
/// <param name="RadiusMeters">Circle radius in metres.</param>
/// <param name="Polygon">Polygon / rectangle ring.</param>
public sealed record NewGeofence(
    GeofenceShape Shape,
    double? Lat = null,
    double? Lng = null,
    double? RadiusMeters = null,
    IReadOnlyList<GeoPoint>? Polygon = null);

/// <summary>
/// Geofence geometry helpers backing <c>TsGeofenceDrawer</c> (port of the web
/// <c>GeofenceDrawer</c> geometry + <c>describeFence</c>). Pure + headless.
/// </summary>
public static class GeofenceGeometry
{
    /// <summary>Build a rectangle ring (SW, NW, NE, SE) from two opposite corners.</summary>
    public static IReadOnlyList<GeoPoint> RectangleRing(GeoPoint a, GeoPoint b)
    {
        double south = Math.Min(a.Lat, b.Lat);
        double north = Math.Max(a.Lat, b.Lat);
        double west = Math.Min(a.Lng, b.Lng);
        double east = Math.Max(a.Lng, b.Lng);
        return
        [
            new GeoPoint(south, west),
            new GeoPoint(north, west),
            new GeoPoint(north, east),
            new GeoPoint(south, east),
        ];
    }

    /// <summary>True when a fence has enough data to render.</summary>
    public static bool IsRenderable(DrawableGeofence fence)
    {
        ArgumentNullException.ThrowIfNull(fence);
        bool circle = fence is { Lat: { } la, Lng: { } lo, RadiusMeters: { } r } &&
                      double.IsFinite(la) && double.IsFinite(lo) && r > 0;
        bool ring = fence.Polygon is { Count: >= 3 };
        return circle || ring;
    }

    /// <summary>
    /// Approximate the enclosed area of a polygon ring in square metres using the
    /// planar shoelace formula on a local equirectangular projection. Good enough
    /// for geofence summaries (not geodesically exact).
    /// </summary>
    public static double PolygonAreaSquareMeters(IReadOnlyList<GeoPoint> ring)
    {
        ArgumentNullException.ThrowIfNull(ring);
        if (ring.Count < 3)
        {
            return 0;
        }

        const double metersPerDegLat = 111_320.0;
        double refLat = ring[0].Lat * Math.PI / 180.0;
        double metersPerDegLng = metersPerDegLat * Math.Cos(refLat);

        double area = 0;
        for (int i = 0; i < ring.Count; i++)
        {
            var p1 = ring[i];
            var p2 = ring[(i + 1) % ring.Count];
            double x1 = p1.Lng * metersPerDegLng;
            double y1 = p1.Lat * metersPerDegLat;
            double x2 = p2.Lng * metersPerDegLng;
            double y2 = p2.Lat * metersPerDegLat;
            area += (x1 * y2) - (x2 * y1);
        }

        return Math.Abs(area) / 2.0;
    }

    /// <summary>
    /// Human-readable accessible description of a fence (port of the web
    /// <c>describeFence</c>): circles report radius + centre, polygons report the
    /// vertex count.
    /// </summary>
    public static string Describe(DrawableGeofence fence)
    {
        ArgumentNullException.ThrowIfNull(fence);
        var c = CultureInfo.InvariantCulture;

        if (fence is { Lat: { } lat, Lng: { } lng, RadiusMeters: { } radius })
        {
            string name = fence.Name ?? "Geofence";
            return string.Create(
                c,
                $"{name} — {radius:F0}m circle around {lat:F4}, {lng:F4}");
        }

        if (fence.Polygon is { Count: >= 3 } ring)
        {
            string name = fence.Name ?? "Geofence";
            return string.Create(c, $"{name} — {ring.Count}-vertex polygon");
        }

        return fence.Name ?? "Geofence";
    }
}
