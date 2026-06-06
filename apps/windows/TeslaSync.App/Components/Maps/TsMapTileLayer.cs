using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// Renders the slippy-map raster tiles for the current viewport (port of the web
/// <c>MapTileLayer</c>). Given a centre, zoom and <see cref="TileSource"/> it asks
/// <see cref="TileMath"/> which XYZ tiles cover the viewport and paints each as a
/// 256px <see cref="Image"/> at its computed screen position. Tile load failures are
/// surfaced via <see cref="TileFailed"/> so the host can show an error state.
/// </summary>
public partial class TsMapTileLayer : ContentControl
{
    private readonly Canvas _canvas = new();
    private TileSource _source = MapTileProvider.Resolve(MapStyleKind.Dark);

    public TsMapTileLayer()
    {
        IsTabStop = false;
        IsHitTestVisible = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _canvas;
    }

    /// <summary>Raised when a tile image fails to load (e.g. offline / bad key).</summary>
    public event EventHandler? TileFailed;

    /// <summary>The provider's required attribution text for the active source.</summary>
    public string Attribution => _source.Attribution;

    /// <summary>Set the active tile source (style/provider) and repaint.</summary>
    public void SetSource(TileSource source)
    {
        _source = source;
    }

    /// <summary>Repaint the tiles for the given viewport.</summary>
    public void Render(GeoPoint center, int zoom, double width, double height)
    {
        _canvas.Children.Clear();
        if (width <= 0 || height <= 0)
        {
            return;
        }

        foreach (var placement in TileMath.TilesForViewport(center, zoom, width, height))
        {
            string url = MapTileProvider.BuildUrl(_source, placement.Tile);
            var bitmap = new BitmapImage { UriSource = new Uri(url) };
            bitmap.ImageFailed += (_, _) => TileFailed?.Invoke(this, EventArgs.Empty);

            var image = new Image
            {
                Source = bitmap,
                Width = WebMercator.TileSize,
                Height = WebMercator.TileSize,
                Stretch = Microsoft.UI.Xaml.Media.Stretch.Fill,
            };
            Canvas.SetLeft(image, placement.ScreenX);
            Canvas.SetTop(image, placement.ScreenY);
            _canvas.Children.Add(image);
        }
    }
}
