namespace TeslaSync.App.Core.Maps;

/// <summary>An axis-aligned geographic bounding box.</summary>
/// <param name="South">Minimum latitude.</param>
/// <param name="West">Minimum longitude.</param>
/// <param name="North">Maximum latitude.</param>
/// <param name="East">Maximum longitude.</param>
public readonly record struct GeoBounds(double South, double West, double North, double East)
{
    /// <summary>True when the bounds describe a non-degenerate, finite box.</summary>
    public bool IsValid =>
        double.IsFinite(South) && double.IsFinite(West) &&
        double.IsFinite(North) && double.IsFinite(East) &&
        North >= South && East >= West;

    /// <summary>The geographic centre of the box.</summary>
    public GeoPoint Center => new((South + North) / 2.0, (West + East) / 2.0);

    /// <summary>True when <paramref name="p"/> lies inside (inclusive) the box.</summary>
    public bool Contains(GeoPoint p) =>
        p.Lat >= South && p.Lat <= North && p.Lng >= West && p.Lng <= East;
}

/// <summary>
/// Bounds + fit-zoom helpers backing <c>TsMapControl</c>'s auto-fit
/// (port of Leaflet's <c>latLngBounds</c> / <c>fitBounds</c> used by
/// <c>RoutePlayback.FitTrail</c>). Pure + headless.
/// </summary>
public static class GeoBoundsCalculator
{
    /// <summary>Build the tightest bounds enclosing every finite point, or null.</summary>
    public static GeoBounds? FromPoints(IEnumerable<GeoPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);

        double south = double.MaxValue, west = double.MaxValue;
        double north = double.MinValue, east = double.MinValue;
        bool any = false;

        foreach (var p in points)
        {
            if (!double.IsFinite(p.Lat) || !double.IsFinite(p.Lng))
            {
                continue;
            }

            any = true;
            south = Math.Min(south, p.Lat);
            north = Math.Max(north, p.Lat);
            west = Math.Min(west, p.Lng);
            east = Math.Max(east, p.Lng);
        }

        return any ? new GeoBounds(south, west, north, east) : null;
    }

    /// <summary>
    /// Largest integer zoom (clamped to [minZoom, maxZoom]) at which the bounds,
    /// inflated by <paramref name="paddingPx"/> on each edge, still fit inside a
    /// viewport of <paramref name="viewWidth"/> × <paramref name="viewHeight"/>
    /// pixels. Mirrors Leaflet's <c>getBoundsZoom</c>.
    /// </summary>
    public static int FitZoom(
        GeoBounds bounds,
        double viewWidth,
        double viewHeight,
        double paddingPx = 30,
        int minZoom = 0,
        int maxZoom = 19)
    {
        if (!bounds.IsValid || viewWidth <= 0 || viewHeight <= 0)
        {
            return minZoom;
        }

        double usableW = Math.Max(1, viewWidth - (2 * paddingPx));
        double usableH = Math.Max(1, viewHeight - (2 * paddingPx));

        for (int zoom = maxZoom; zoom >= minZoom; zoom--)
        {
            var sw = WebMercator.Project(new GeoPoint(bounds.South, bounds.West), zoom);
            var ne = WebMercator.Project(new GeoPoint(bounds.North, bounds.East), zoom);
            double pxW = Math.Abs(ne.X - sw.X);
            double pxH = Math.Abs(sw.Y - ne.Y);

            if (pxW <= usableW && pxH <= usableH)
            {
                return zoom;
            }
        }

        return minZoom;
    }
}
