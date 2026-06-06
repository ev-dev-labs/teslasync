using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// The read-only projection the map exposes to its overlays so each overlay can
/// place itself in screen space without owning the map's pan/zoom state. Backed by
/// the headless <see cref="TileMath"/> / <see cref="WebMercator"/> maths in Core.
/// </summary>
public interface IMapProjection
{
    /// <summary>The geographic point currently centred in the viewport.</summary>
    GeoPoint Center { get; }

    /// <summary>The integer zoom level.</summary>
    int Zoom { get; }

    /// <summary>Viewport width in pixels.</summary>
    double ViewWidth { get; }

    /// <summary>Viewport height in pixels.</summary>
    double ViewHeight { get; }

    /// <summary>Project a geographic point to a screen pixel in the viewport.</summary>
    PixelPoint ToScreen(GeoPoint point);
}

/// <summary>
/// An overlay element that can reposition itself when the map's projection changes
/// (pan/zoom/resize). The map calls <see cref="Project"/> on every overlay after each
/// viewport change.
/// </summary>
public interface IMapOverlay
{
    /// <summary>Reposition this overlay against the current <paramref name="projection"/>.</summary>
    void Project(IMapProjection projection);
}

/// <summary>Immutable snapshot of the map viewport implementing <see cref="IMapProjection"/>.</summary>
internal sealed class MapProjection(GeoPoint center, int zoom, double viewWidth, double viewHeight) : IMapProjection
{
    public GeoPoint Center { get; } = center;

    public int Zoom { get; } = zoom;

    public double ViewWidth { get; } = viewWidth;

    public double ViewHeight { get; } = viewHeight;

    public PixelPoint ToScreen(GeoPoint point) =>
        TileMath.ToScreen(point, Center, Zoom, ViewWidth, ViewHeight);
}
