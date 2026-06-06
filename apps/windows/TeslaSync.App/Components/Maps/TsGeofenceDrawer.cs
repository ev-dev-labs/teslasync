using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>The geofence the drawer is currently letting the user create.</summary>
public enum GeofenceDrawMode
{
    /// <summary>Drawing disabled — pointer events pass through to the map for panning.</summary>
    Off,

    /// <summary>The user drags to define a rectangular fence.</summary>
    Rectangle,
}

/// <summary>
/// Renders saved geofences and lets the user draw new ones (port of the web
/// <c>GeofenceDrawer</c>). Circles render as metre-radius <see cref="TsMapCircle"/>
/// overlays, polygons/rectangles as closed <see cref="TsMapPolyline"/> rings, each
/// with an accessible <see cref="GeofenceGeometry.Describe"/> label. In
/// <see cref="GeofenceDrawMode.Rectangle"/> the drawer intercepts pointer drags and
/// raises <see cref="GeofenceDrawn"/> with the new geometry.
/// </summary>
public partial class TsGeofenceDrawer : ContentControl, IMapOverlay
{
    private readonly Canvas _canvas = new();
    private readonly List<(IMapOverlay Overlay, DrawableGeofence Fence)> _fences = [];
    private readonly TsMapRectangle _preview = new();
    private IReadOnlyList<DrawableGeofence> _source = [];
    private IMapProjection? _projection;
    private bool _drawing;
    private GeoPoint _dragStart;

    public static readonly DependencyProperty DrawModeProperty = DependencyProperty.Register(
        nameof(DrawMode), typeof(GeofenceDrawMode), typeof(TsGeofenceDrawer),
        new PropertyMetadata(GeofenceDrawMode.Off, OnDrawModeChanged));

    public TsGeofenceDrawer()
    {
        IsTabStop = false;
        IsHitTestVisible = false;
        Content = _canvas;
        Canvas.SetLeft(this, 0);
        Canvas.SetTop(this, 0);

        _preview.SetBrushes(DisplayTokens.Accent, new SolidColorBrush(Microsoft.UI.Colors.Transparent));
        AutomationProperties.SetName(this, "Geofences");

        PointerPressed += OnPointerPressed;
        PointerMoved += OnPointerMoved;
        PointerReleased += OnPointerReleased;
    }

    /// <summary>Raised when the user finishes drawing a new geofence.</summary>
    public event EventHandler<NewGeofence>? GeofenceDrawn;

    /// <summary>The current draw mode.</summary>
    public GeofenceDrawMode DrawMode
    {
        get => (GeofenceDrawMode)GetValue(DrawModeProperty);
        set => SetValue(DrawModeProperty, value);
    }

    /// <summary>Replace the rendered geofences.</summary>
    public void SetGeofences(IReadOnlyList<DrawableGeofence> fences)
    {
        ArgumentNullException.ThrowIfNull(fences);
        _source = fences;
        Rebuild();
        if (_projection is not null)
        {
            Project(_projection);
        }
    }

    /// <summary>Reproject every rendered fence (and the in-progress preview).</summary>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        _projection = projection;
        foreach (var (overlay, _) in _fences)
        {
            overlay.Project(projection);
        }

        if (_drawing)
        {
            _preview.Project(projection);
        }
    }

    private static void OnDrawModeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var drawer = (TsGeofenceDrawer)d;
        drawer.IsHitTestVisible = (GeofenceDrawMode)e.NewValue != GeofenceDrawMode.Off;
    }

    private void Rebuild()
    {
        _canvas.Children.Clear();
        _fences.Clear();

        foreach (var fence in _source)
        {
            if (!GeofenceGeometry.IsRenderable(fence))
            {
                continue;
            }

            FrameworkElement element;
            IMapOverlay overlay;

            if (fence is { Lat: { } lat, Lng: { } lng, RadiusMeters: { } radius })
            {
                var circle = new TsMapCircle { Center = new GeoPoint(lat, lng), RadiusMeters = radius };
                circle.SetBrushes(DisplayTokens.Accent, FenceFill());
                element = circle;
                overlay = circle;
            }
            else
            {
                var ring = new List<GeoPoint>(fence.Polygon!);
                if (ring.Count > 0)
                {
                    ring.Add(ring[0]);
                }

                var line = new TsMapPolyline();
                line.SetPoints(ring);
                line.SetStroke(DisplayTokens.Accent);
                element = line;
                overlay = line;
            }

            AutomationProperties.SetName(element, GeofenceGeometry.Describe(fence));
            _canvas.Children.Add(element);
            _fences.Add((overlay, fence));
        }
    }

    private static SolidColorBrush FenceFill() =>
        new SolidColorBrush(Microsoft.UI.Colors.DeepSkyBlue) { Opacity = 0.12 };

    private static GeoPoint ScreenToGeo(IMapProjection projection, Windows.Foundation.Point screen)
    {
        var worldCenter = WebMercator.Project(projection.Center, projection.Zoom);
        double worldX = worldCenter.X + (screen.X - (projection.ViewWidth / 2));
        double worldY = worldCenter.Y + (screen.Y - (projection.ViewHeight / 2));
        return WebMercator.Unproject(new PixelPoint(worldX, worldY), projection.Zoom);
    }

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (DrawMode != GeofenceDrawMode.Rectangle || _projection is null)
        {
            return;
        }

        _drawing = true;
        _dragStart = ScreenToGeo(_projection, e.GetCurrentPoint(this).Position);
        _preview.CornerA = _dragStart;
        _preview.CornerB = _dragStart;
        if (!_canvas.Children.Contains(_preview))
        {
            _canvas.Children.Add(_preview);
        }

        CapturePointer(e.Pointer);
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_drawing || _projection is null)
        {
            return;
        }

        _preview.CornerA = _dragStart;
        _preview.CornerB = ScreenToGeo(_projection, e.GetCurrentPoint(this).Position);
        _preview.Project(_projection);
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_drawing || _projection is null)
        {
            return;
        }

        _drawing = false;
        ReleasePointerCapture(e.Pointer);

        var end = ScreenToGeo(_projection, e.GetCurrentPoint(this).Position);
        _canvas.Children.Remove(_preview);

        var ring = GeofenceGeometry.RectangleRing(_dragStart, end);
        GeofenceDrawn?.Invoke(this, new NewGeofence(GeofenceShape.Rectangle, Polygon: ring));
    }
}
