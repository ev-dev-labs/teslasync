namespace TeslaSync.App.Core.Maps;

/// <summary>A tile coordinate in the slippy-map scheme.</summary>
/// <param name="X">Tile column.</param>
/// <param name="Y">Tile row.</param>
/// <param name="Z">Zoom level.</param>
public readonly record struct TileCoord(int X, int Y, int Z);

/// <summary>
/// Slippy-map tile arithmetic backing <c>TsMapTileLayer</c>. Computes which
/// XYZ tiles cover a viewport and where each tile lands in screen space. Pure +
/// headless so the tile grid is unit-tested without a renderer.
/// </summary>
public static class TileMath
{
    /// <summary>Number of tiles along one axis at the given zoom (2^z).</summary>
    public static int TileCountPerAxis(int zoom) => 1 << Math.Clamp(zoom, 0, 24);

    /// <summary>The tile containing a geographic point at an integer zoom.</summary>
    public static TileCoord TileAt(GeoPoint point, int zoom)
    {
        int n = TileCountPerAxis(zoom);
        double lat = WebMercator.ClampLatitude(point.Lat);
        double latRad = lat * Math.PI / 180.0;

        int x = (int)Math.Floor((WebMercator.WrapLongitude(point.Lng) + 180.0) / 360.0 * n);
        int y = (int)Math.Floor((1.0 - (Math.Log(Math.Tan(latRad) + (1.0 / Math.Cos(latRad))) / Math.PI)) / 2.0 * n);

        return new TileCoord(WrapTile(x, n), Math.Clamp(y, 0, n - 1), zoom);
    }

    /// <summary>
    /// Every tile needed to paint a <paramref name="viewWidth"/> ×
    /// <paramref name="viewHeight"/> viewport centred on <paramref name="center"/>
    /// at the given zoom, with a one-tile bleed margin so panning never reveals gaps.
    /// </summary>
    public static IReadOnlyList<TilePlacement> TilesForViewport(
        GeoPoint center,
        int zoom,
        double viewWidth,
        double viewHeight)
    {
        var result = new List<TilePlacement>();
        if (viewWidth <= 0 || viewHeight <= 0)
        {
            return result;
        }

        int n = TileCountPerAxis(zoom);
        var centerWorld = WebMercator.Project(center, zoom);

        // World pixel of the viewport's top-left corner.
        double originX = centerWorld.X - (viewWidth / 2.0);
        double originY = centerWorld.Y - (viewHeight / 2.0);

        int firstCol = (int)Math.Floor(originX / WebMercator.TileSize) - 1;
        int firstRow = (int)Math.Floor(originY / WebMercator.TileSize) - 1;
        int lastCol = (int)Math.Floor((originX + viewWidth) / WebMercator.TileSize) + 1;
        int lastRow = (int)Math.Floor((originY + viewHeight) / WebMercator.TileSize) + 1;

        for (int row = firstRow; row <= lastRow; row++)
        {
            if (row < 0 || row >= n)
            {
                continue;
            }

            for (int col = firstCol; col <= lastCol; col++)
            {
                int wrappedCol = WrapTile(col, n);
                double screenX = (col * WebMercator.TileSize) - originX;
                double screenY = (row * WebMercator.TileSize) - originY;
                result.Add(new TilePlacement(new TileCoord(wrappedCol, row, zoom), screenX, screenY));
            }
        }

        return result;
    }

    /// <summary>Screen pixel of a geographic point given the viewport centre/zoom.</summary>
    public static PixelPoint ToScreen(GeoPoint point, GeoPoint center, int zoom, double viewWidth, double viewHeight)
    {
        var world = WebMercator.Project(point, zoom);
        var centerWorld = WebMercator.Project(center, zoom);
        return new PixelPoint(
            world.X - centerWorld.X + (viewWidth / 2.0),
            world.Y - centerWorld.Y + (viewHeight / 2.0));
    }

    private static int WrapTile(int value, int n)
    {
        int wrapped = value % n;
        if (wrapped < 0)
        {
            wrapped += n;
        }

        return wrapped;
    }
}

/// <summary>A tile plus where its top-left corner lands in screen space.</summary>
/// <param name="Tile">The tile coordinate.</param>
/// <param name="ScreenX">Screen X of the tile's left edge.</param>
/// <param name="ScreenY">Screen Y of the tile's top edge.</param>
public readonly record struct TilePlacement(TileCoord Tile, double ScreenX, double ScreenY);
