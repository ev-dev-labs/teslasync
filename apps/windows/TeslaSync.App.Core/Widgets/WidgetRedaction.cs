using System.Globalization;

namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// Field-level privacy redaction for the widget surface (P2/W8-0003, ADR-016). Unlike the free-text
/// notification redaction, a widget projects known fields, so the masking is explicit: a VIN is never
/// shown in full (at most the trailing four characters behind a mask, and only when revealing is
/// allowed), and a coordinate pair is suppressed entirely unless the user opted in, then coarsened to
/// roughly neighbourhood precision. A hidden field returns <see langword="null"/> so the projection
/// omits it rather than emitting an empty row.
/// </summary>
public static class WidgetRedaction
{
    /// <summary>The fixed marker substituted for redacted characters.</summary>
    public const string Mask = "\u2022\u2022\u2022";

    /// <summary>
    /// Returns the display VIN: <see langword="null"/> when hidden or unset, otherwise the masked
    /// trailing four characters (or a full mask for a short value).
    /// </summary>
    public static string? Vin(string? vin, bool hide)
    {
        if (hide || string.IsNullOrWhiteSpace(vin))
        {
            return null;
        }

        var trimmed = vin.Trim();
        return trimmed.Length <= 4 ? Mask : Mask + trimmed[^4..];
    }

    /// <summary>
    /// Returns the display location: <see langword="null"/> when hidden or unavailable, otherwise a
    /// coarsened "lat, long" string (two fractional digits ≈ 1 km) so a precise position never reaches
    /// the surface.
    /// </summary>
    public static string? Location(double? latitude, double? longitude, bool hide)
    {
        if (hide || latitude is not { } lat || longitude is not { } lon)
        {
            return null;
        }

        if (!double.IsFinite(lat) || !double.IsFinite(lon))
        {
            return null;
        }

        return string.Create(CultureInfo.InvariantCulture, $"{lat:F2}, {lon:F2}");
    }
}
