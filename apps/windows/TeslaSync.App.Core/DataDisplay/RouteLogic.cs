using System.Globalization;

namespace TeslaSync.App.Core.DataDisplay;

/// <summary>A route endpoint: a resolved address (preferred) or a lat/lon fallback.</summary>
/// <param name="Address">Resolved street address or place name.</param>
/// <param name="Lat">Latitude in decimal degrees (fallback).</param>
/// <param name="Lon">Longitude in decimal degrees (fallback).</param>
public readonly record struct RouteEndpoint(string? Address = null, double? Lat = null, double? Lon = null);

/// <summary>How a route's "from → to" line should render.</summary>
public enum RouteKind
{
    /// <summary>Neither endpoint resolved — show "No location data".</summary>
    None,

    /// <summary>Single location or start ≈ end — show one label (+ round-trip note).</summary>
    RoundTrip,

    /// <summary>Distinct start and end — show "start → end".</summary>
    PointToPoint,
}

/// <summary>The resolved presentation of a route (labels + kind).</summary>
/// <param name="Kind">Which layout to render.</param>
/// <param name="StartLabel">Pretty label for the start (or null).</param>
/// <param name="EndLabel">Pretty label for the end (or null).</param>
/// <param name="IsExplicitSingle">True when only a start endpoint was supplied.</param>
public readonly record struct RouteResult(RouteKind Kind, string? StartLabel, string? EndLabel, bool IsExplicitSingle);

/// <summary>
/// Route-line resolution backing <c>TsRouteDisplay</c> (port of the web
/// <c>RouteDisplay</c> helpers): endpoint labelling, haversine distance and
/// round-trip detection.
/// </summary>
public static class RouteLogic
{
    /// <summary>Default round-trip coordinate threshold in metres.</summary>
    public const double DefaultRoundTripThresholdMeters = 100;

    /// <summary>
    /// Pretty-print a single endpoint. Prefers a resolved address; falls back to a
    /// "📍 lat, lon" coord string; returns null when neither is available.
    /// </summary>
    public static string? EndpointLabel(RouteEndpoint e)
    {
        string? addr = e.Address?.Trim();
        if (!string.IsNullOrEmpty(addr))
        {
            return addr;
        }

        if (e.Lat is { } lat && e.Lon is { } lon)
        {
            var c = CultureInfo.InvariantCulture;
            return $"\uD83D\uDCCD {lat.ToString("0.00", c)}, {lon.ToString("0.00", c)}";
        }

        return null;
    }

    /// <summary>Haversine distance between two lat/lon pairs, in metres.</summary>
    public static double HaversineMeters(double aLat, double aLon, double bLat, double bLon)
    {
        const double r = 6_371_000;
        static double ToRad(double deg) => deg * Math.PI / 180;
        double dLat = ToRad(bLat - aLat);
        double dLon = ToRad(bLon - aLon);
        double lat1 = ToRad(aLat);
        double lat2 = ToRad(bLat);
        double x = (Math.Sin(dLat / 2) * Math.Sin(dLat / 2)) +
                   (Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2));
        return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(x)));
    }

    /// <summary>
    /// Resolve the route presentation. <paramref name="end"/> = null means a single
    /// location (round trip). Otherwise start≈end (matching address OR coordinates
    /// within the threshold) collapses to a round trip; distinct endpoints render
    /// point-to-point.
    /// </summary>
    public static RouteResult Resolve(
        RouteEndpoint start,
        RouteEndpoint? end = null,
        double roundTripThresholdMeters = DefaultRoundTripThresholdMeters)
    {
        string? startLabel = EndpointLabel(start);
        string? endLabel = end is { } e ? EndpointLabel(e) : null;
        bool isExplicitSingle = end is null;

        if (startLabel is null && endLabel is null)
        {
            return new RouteResult(RouteKind.None, null, null, isExplicitSingle);
        }

        bool addressesMatch = startLabel is not null && endLabel is not null &&
            string.Equals(startLabel, endLabel, StringComparison.Ordinal);

        bool coordsClose = HasCoords(start, out double sLat, out double sLon) &&
            end is { } e2 && HasCoords(e2, out double eLat, out double eLon) &&
            HaversineMeters(sLat, sLon, eLat, eLon) < roundTripThresholdMeters;

        bool isRoundTrip = startLabel is not null && (isExplicitSingle || addressesMatch || coordsClose);

        if (isRoundTrip)
        {
            return new RouteResult(RouteKind.RoundTrip, startLabel, endLabel, isExplicitSingle);
        }

        return new RouteResult(RouteKind.PointToPoint, startLabel, endLabel, isExplicitSingle);
    }

    private static bool HasCoords(RouteEndpoint e, out double lat, out double lon)
    {
        if (e.Lat is { } la && e.Lon is { } lo)
        {
            lat = la;
            lon = lo;
            return true;
        }

        lat = 0;
        lon = 0;
        return false;
    }
}
