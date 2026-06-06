using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// Clusters dense markers into count bubbles (port of the web <c>MarkerCluster</c> /
/// <c>leaflet.markercluster</c>). Drives the headless
/// <see cref="MarkerClusterEngine"/> on every projection change and renders each
/// resulting bubble as a density-tinted chip (or a single marker glyph). Add it to a
/// <see cref="TsMapControl"/> as an overlay.
/// </summary>
public partial class TsMarkerCluster : ContentControl, IMapOverlay
{
    private readonly Canvas _canvas = new();
    private IReadOnlyList<ClusterPoint> _points = [];
    private double _maxClusterRadius = 50;

    public TsMarkerCluster()
    {
        IsTabStop = false;
        Content = _canvas;
        Canvas.SetLeft(this, 0);
        Canvas.SetTop(this, 0);
    }

    /// <summary>Raised when the user activates a single (un-clustered) point.</summary>
    public event EventHandler<ClusterPoint>? PointActivated;

    /// <summary>Replace the clustered point set.</summary>
    public void SetPoints(IReadOnlyList<ClusterPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        _points = points;
    }

    /// <summary>Set the screen-space cluster radius in pixels.</summary>
    public void SetClusterRadius(double pixels) => _maxClusterRadius = Math.Max(1, pixels);

    /// <summary>Recluster and render against the current projection.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        _canvas.Children.Clear();

        var bubbles = MarkerClusterEngine.Cluster(
            _points, projection.Center, projection.Zoom, projection.ViewWidth, projection.ViewHeight, _maxClusterRadius);

        foreach (var bubble in bubbles)
        {
            FrameworkElement element;
            if (bubble.IsSingle)
            {
                element = BuildSingle(bubble.Children[0]);
            }
            else
            {
                element = BuildBubble(bubble);
            }

            _canvas.Children.Add(element);
            element.Loaded += (_, _) => CenterOn(element, bubble.ScreenX, bubble.ScreenY);
            CenterOn(element, bubble.ScreenX, bubble.ScreenY);
        }
    }

    private static void CenterOn(FrameworkElement element, double x, double y)
    {
        double w = element.ActualWidth > 0 ? element.ActualWidth : element.Width;
        double h = element.ActualHeight > 0 ? element.ActualHeight : element.Height;
        if (double.IsNaN(w))
        {
            w = 0;
        }

        if (double.IsNaN(h))
        {
            h = 0;
        }

        Canvas.SetLeft(element, x - (w / 2));
        Canvas.SetTop(element, y - (h / 2));
    }

    private Grid BuildSingle(ClusterPoint point)
    {
        var pin = new FontIcon { Glyph = "\uE707", FontSize = 20, Foreground = DisplayTokens.Accent };
        var holder = new Grid { Width = 20, Height = 20 };
        holder.Children.Add(pin);
        if (!string.IsNullOrEmpty(point.Label))
        {
            AutomationProperties.SetName(holder, point.Label);
        }

        holder.Tapped += (_, _) => PointActivated?.Invoke(this, point);
        return holder;
    }

    private static Border BuildBubble(ClusterBubble bubble)
    {
        double size = bubble.Count >= 100 ? 48 : bubble.Count >= 25 ? 42 : 36;
        var fill = DisplayPrimitives.HexBrush(MarkerClusterEngine.DensityColor(bubble.Count));

        var label = new Text { Value = bubble.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) };
        label.HorizontalAlignment = HorizontalAlignment.Center;
        label.VerticalAlignment = VerticalAlignment.Center;

        var border = new Border
        {
            Width = size,
            Height = size,
            CornerRadius = new CornerRadius(size / 2),
            Background = fill,
            BorderBrush = DisplayTokens.Surface,
            BorderThickness = new Thickness(2),
            Child = label,
        };
        AutomationProperties.SetName(
            border,
            string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{bubble.Count} locations"));
        return border;
    }
}
