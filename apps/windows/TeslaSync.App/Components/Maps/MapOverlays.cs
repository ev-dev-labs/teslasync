using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Motion;
using ShapeEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using ShapePolyline = Microsoft.UI.Xaml.Shapes.Polyline;
using ShapeRectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.Components.Maps;

/// <summary>Shared metric helpers for the geo overlays.</summary>
internal static class MapMetrics
{
    private const double EarthCircumferenceMeters = 2 * Math.PI * 6_378_137;

    /// <summary>Ground metres per screen pixel at a latitude and integer zoom.</summary>
    public static double MetersPerPixel(double latitude, int zoom)
    {
        double worldSize = WebMercator.TileSize * Math.Pow(2, zoom);
        return Math.Cos(WebMercator.ClampLatitude(latitude) * Math.PI / 180.0) * EarthCircumferenceMeters / worldSize;
    }
}

/// <summary>
/// A point marker pinned to a geographic coordinate (port of the web map
/// <c>Marker</c>). Positions itself on the map's overlay canvas whenever the
/// projection changes.
/// </summary>
public partial class TsMapMarker : ContentControl, IMapOverlay
{
    private readonly FontIcon _pin = new() { Glyph = "\uE707", FontSize = 22 };

    public TsMapMarker()
    {
        IsTabStop = true;
        _pin.Foreground = DisplayTokens.Accent;
        Content = _pin;
    }

    /// <summary>The marker's geographic location.</summary>
    public GeoPoint Location { get; set; }

    /// <summary>Localized accessible label.</summary>
    public string LabelText
    {
        get => AutomationProperties.GetName(this);
        set => AutomationProperties.SetName(this, value);
    }

    /// <summary>Tint the marker glyph.</summary>
    public void SetAccent(Brush brush) => _pin.Foreground = brush;

    /// <summary>Reposition against the current projection.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(Location);
        Canvas.SetLeft(this, screen.X - (ActualWidth > 0 ? ActualWidth / 2 : 11));
        Canvas.SetTop(this, screen.Y - (ActualHeight > 0 ? ActualHeight : 22));
    }
}

/// <summary>
/// An animated, pulsing marker for the "current position" dot (port of the web
/// <c>AnimatedMarker</c>). Honours reduce-motion: the pulse is disabled when the OS
/// minimises animations. Can be moved between coordinates as live data arrives.
/// </summary>
public partial class TsAnimatedMarker : ContentControl, IMapOverlay
{
    private readonly Grid _root = new();
    private readonly ShapeEllipse _halo = new() { Width = 26, Height = 26 };
    private readonly ShapeEllipse _dot = new() { Width = 12, Height = 12 };
    private Storyboard? _pulse;

    public TsAnimatedMarker()
    {
        IsTabStop = true;
        _halo.Fill = DisplayTokens.Accent;
        _halo.Opacity = 0.35;
        _halo.HorizontalAlignment = HorizontalAlignment.Center;
        _halo.VerticalAlignment = VerticalAlignment.Center;
        _dot.Fill = DisplayTokens.Accent;
        _dot.Stroke = DisplayTokens.Surface;
        _dot.StrokeThickness = 2;
        _dot.HorizontalAlignment = HorizontalAlignment.Center;
        _dot.VerticalAlignment = VerticalAlignment.Center;
        _root.Children.Add(_halo);
        _root.Children.Add(_dot);
        Content = _root;
        Width = 26;
        Height = 26;

        Loaded += (_, _) => StartPulse();
        Unloaded += (_, _) => StopPulse();
    }

    /// <summary>The marker's geographic location.</summary>
    public GeoPoint Location { get; set; }

    /// <summary>Move the marker to a new coordinate and reposition.</summary>
    public void MoveTo(GeoPoint location, IMapProjection projection)
    {
        Location = location;
        Project(projection);
    }

    /// <summary>Reposition against the current projection.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var screen = projection.ToScreen(Location);
        Canvas.SetLeft(this, screen.X - (Width / 2));
        Canvas.SetTop(this, screen.Y - (Height / 2));
    }

    private void StartPulse()
    {
        StopPulse();
        if (!MotionDuration.ShouldAnimate(MotionPreference.ReduceMotion))
        {
            _halo.Opacity = 0.35;
            return;
        }

        var scale = new ScaleTransform { CenterX = 13, CenterY = 13 };
        _halo.RenderTransform = scale;

        var grow = new DoubleAnimation
        {
            From = 0.6,
            To = 1.8,
            Duration = new Duration(TimeSpan.FromMilliseconds(1600)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(grow, scale);
        Storyboard.SetTargetProperty(grow, "ScaleX");
        var growY = CloneFor(grow, scale, "ScaleY");

        var fade = new DoubleAnimation
        {
            From = 0.4,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(1600)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, _halo);
        Storyboard.SetTargetProperty(fade, "Opacity");

        _pulse = new Storyboard();
        _pulse.Children.Add(grow);
        _pulse.Children.Add(growY);
        _pulse.Children.Add(fade);
        _pulse.Begin();
    }

    private static DoubleAnimation CloneFor(DoubleAnimation source, DependencyObject target, string property)
    {
        var clone = new DoubleAnimation
        {
            From = source.From,
            To = source.To,
            Duration = source.Duration,
            RepeatBehavior = source.RepeatBehavior,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(clone, target);
        Storyboard.SetTargetProperty(clone, property);
        return clone;
    }

    private void StopPulse()
    {
        _pulse?.Stop();
        _pulse = null;
    }
}

/// <summary>
/// A geographic polyline (port of the web map <c>Polyline</c> used for the GPS
/// trail). Re-points itself from a list of coordinates on each projection change.
/// </summary>
public partial class TsMapPolyline : ContentControl, IMapOverlay
{
    private readonly ShapePolyline _line = new() { StrokeThickness = 3, StrokeLineJoin = PenLineJoin.Round };
    private IReadOnlyList<GeoPoint> _points = [];

    public TsMapPolyline()
    {
        IsTabStop = false;
        IsHitTestVisible = false;
        _line.Stroke = DisplayTokens.Accent;
        Content = _line;
        Canvas.SetLeft(this, 0);
        Canvas.SetTop(this, 0);
    }

    /// <summary>Set the polyline's coordinates.</summary>
    public void SetPoints(IReadOnlyList<GeoPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        _points = points;
    }

    /// <summary>Override the stroke brush.</summary>
    public void SetStroke(Brush brush) => _line.Stroke = brush;

    /// <summary>Reproject the line vertices to screen space.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var collection = new PointCollection();
        foreach (var point in _points)
        {
            var screen = projection.ToScreen(point);
            collection.Add(new Windows.Foundation.Point(screen.X, screen.Y));
        }

        _line.Points = collection;
    }
}

/// <summary>
/// A geographic circle with a metre radius (port of the web map <c>Circle</c>, used
/// for geofences). Its pixel radius is recomputed from the latitude + zoom each time
/// the projection changes.
/// </summary>
public partial class TsMapCircle : ContentControl, IMapOverlay
{
    private readonly ShapeEllipse _circle = new() { StrokeThickness = 2 };

    public TsMapCircle()
    {
        IsTabStop = false;
        IsHitTestVisible = false;
        _circle.Stroke = DisplayTokens.Accent;
        _circle.Fill = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        Content = _circle;
    }

    /// <summary>The circle's geographic centre.</summary>
    public GeoPoint Center { get; set; }

    /// <summary>The circle radius in metres.</summary>
    public double RadiusMeters { get; set; }

    /// <summary>Set the stroke + translucent fill brushes.</summary>
    public void SetBrushes(Brush stroke, Brush fill)
    {
        _circle.Stroke = stroke;
        _circle.Fill = fill;
    }

    /// <summary>Reproject the centre and recompute the pixel radius.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        double mpp = MapMetrics.MetersPerPixel(Center.Lat, projection.Zoom);
        double radiusPx = mpp > 0 ? RadiusMeters / mpp : 0;
        double diameter = Math.Max(0, radiusPx * 2);
        _circle.Width = diameter;
        _circle.Height = diameter;

        var screen = projection.ToScreen(Center);
        Canvas.SetLeft(this, screen.X - radiusPx);
        Canvas.SetTop(this, screen.Y - radiusPx);
    }
}

/// <summary>
/// A geographic rectangle defined by two opposite corners (port of the web map
/// <c>Rectangle</c>). Recomputes its screen bounding box on each projection change.
/// </summary>
public partial class TsMapRectangle : ContentControl, IMapOverlay
{
    private readonly ShapeRectangle _rect = new() { StrokeThickness = 2 };

    public TsMapRectangle()
    {
        IsTabStop = false;
        IsHitTestVisible = false;
        _rect.Stroke = DisplayTokens.Accent;
        _rect.Fill = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        Content = _rect;
    }

    /// <summary>One corner of the rectangle.</summary>
    public GeoPoint CornerA { get; set; }

    /// <summary>The opposite corner of the rectangle.</summary>
    public GeoPoint CornerB { get; set; }

    /// <summary>Set the stroke + translucent fill brushes.</summary>
    public void SetBrushes(Brush stroke, Brush fill)
    {
        _rect.Stroke = stroke;
        _rect.Fill = fill;
    }

    /// <summary>Reproject the rectangle corners to a screen bounding box.</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        var a = projection.ToScreen(CornerA);
        var b = projection.ToScreen(CornerB);
        double left = Math.Min(a.X, b.X);
        double top = Math.Min(a.Y, b.Y);
        _rect.Width = Math.Abs(a.X - b.X);
        _rect.Height = Math.Abs(a.Y - b.Y);
        Canvas.SetLeft(this, left);
        Canvas.SetTop(this, top);
    }
}
