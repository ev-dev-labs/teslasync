namespace TeslaSync.App.Core.Maps;

/// <summary>
/// A geographic coordinate in decimal degrees.
/// </summary>
/// <param name="Lat">Latitude (-90..90).</param>
/// <param name="Lng">Longitude (-180..180).</param>
public readonly record struct GeoPoint(double Lat, double Lng);

/// <summary>A pixel position in the map's projected world space.</summary>
/// <param name="X">Horizontal pixel.</param>
/// <param name="Y">Vertical pixel.</param>
public readonly record struct PixelPoint(double X, double Y);

/// <summary>
/// Spherical Web-Mercator (EPSG:3857) projection used by every slippy-map tile
/// provider (CARTO, OpenStreetMap, Esri, OpenTopoMap, Azure, Google). Replaces
/// Leaflet's CRS so the native <c>TsMapControl</c> can project lat/lng to screen
/// pixels without a JS map engine. Pure + headless so it is unit-tested directly.
/// </summary>
public static class WebMercator
{
    /// <summary>Side length in pixels of a single 256px tile.</summary>
    public const int TileSize = 256;

    /// <summary>Latitude bound where the Mercator projection clips (±85.0511°).</summary>
    public const double MaxLatitude = 85.05112878;

    /// <summary>World pixel width/height at the given integer zoom level.</summary>
    public static double WorldSize(int zoom) => TileSize * Math.Pow(2, zoom);

    /// <summary>Clamp a latitude into the projectable Mercator range.</summary>
    public static double ClampLatitude(double lat) => Math.Clamp(lat, -MaxLatitude, MaxLatitude);

    /// <summary>Normalize a longitude into the [-180, 180] range (wrapping).</summary>
    public static double WrapLongitude(double lng)
    {
        double wrapped = (lng + 180) % 360;
        if (wrapped < 0)
        {
            wrapped += 360;
        }

        return wrapped - 180;
    }

    /// <summary>Project a geographic point to absolute world pixels at a zoom level.</summary>
    public static PixelPoint Project(GeoPoint point, double zoom)
    {
        double size = TileSize * Math.Pow(2, zoom);
        double lat = ClampLatitude(point.Lat);
        double sinLat = Math.Sin(lat * Math.PI / 180.0);

        double x = (WrapLongitude(point.Lng) + 180.0) / 360.0 * size;
        double y = (0.5 - (Math.Log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * size;
        return new PixelPoint(x, y);
    }

    /// <summary>Inverse-project absolute world pixels back to a geographic point.</summary>
    public static GeoPoint Unproject(PixelPoint pixel, double zoom)
    {
        double size = TileSize * Math.Pow(2, zoom);
        double lng = (pixel.X / size * 360.0) - 180.0;
        double n = Math.PI - (2.0 * Math.PI * pixel.Y / size);
        double lat = 180.0 / Math.PI * Math.Atan(Math.Sinh(n));
        return new GeoPoint(lat, lng);
    }
}
