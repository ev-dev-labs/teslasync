using System.Globalization;

namespace TeslaSync.App.Core.Maps;

/// <summary>
/// Builds accessible, screen-reader-friendly text summaries of map geometry so the
/// native map controls expose a non-visual description (route, coordinate, fit
/// bounds). Mirrors the alt-text/aria-label intent of the web map components.
/// Pure + headless.
/// </summary>
public static class CoordinateSummary
{
    /// <summary>"lat, lng" with a fixed precision, in the invariant culture.</summary>
    public static string Coordinate(GeoPoint point, int precision = 5)
    {
        var c = CultureInfo.InvariantCulture;
        string fmt = "F" + Math.Clamp(precision, 0, 8).ToString(c);
        return point.Lat.ToString(fmt, c) + ", " + point.Lng.ToString(fmt, c);
    }

    /// <summary>
    /// Great-circle (haversine) distance between two points in metres. Shared with
    /// route-length summaries.
    /// </summary>
    public static double HaversineMeters(GeoPoint a, GeoPoint b)
    {
        const double r = 6_371_000;
        static double ToRad(double deg) => deg * Math.PI / 180.0;
        double dLat = ToRad(b.Lat - a.Lat);
        double dLon = ToRad(b.Lng - a.Lng);
        double lat1 = ToRad(a.Lat);
        double lat2 = ToRad(b.Lat);
        double h = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2)) +
                   (Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2));
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    /// <summary>Total path length of an ordered trail in metres.</summary>
    public static double TrailLengthMeters(IReadOnlyList<GeoPoint> trail)
    {
        ArgumentNullException.ThrowIfNull(trail);
        double total = 0;
        for (int i = 1; i < trail.Count; i++)
        {
            total += HaversineMeters(trail[i - 1], trail[i]);
        }

        return total;
    }

    /// <summary>
    /// One-line accessible route summary: point count, total length (km) and the
    /// start/end coordinates. Used as the map application landmark's description.
    /// </summary>
    public static string Route(IReadOnlyList<GeoPoint> trail)
    {
        ArgumentNullException.ThrowIfNull(trail);
        var c = CultureInfo.InvariantCulture;

        if (trail.Count == 0)
        {
            return "No GPS points to replay for this route.";
        }

        if (trail.Count == 1)
        {
            return "Single location at " + Coordinate(trail[0]) + ".";
        }

        double km = TrailLengthMeters(trail) / 1000.0;
        return string.Create(
            c,
            $"Route of {trail.Count} points spanning {km:F1} km, from {Coordinate(trail[0])} to {Coordinate(trail[^1])}.");
    }

    /// <summary>Accessible description of the current replay position within the trail.</summary>
    public static string Position(int index, int total, GeoPoint point)
    {
        var c = CultureInfo.InvariantCulture;
        return string.Create(c, $"Point {index + 1} of {total} at {Coordinate(point)}.");
    }
}
