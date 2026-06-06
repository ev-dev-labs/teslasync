using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// A native, key-optional slippy map (port of the web Leaflet <c>MapContainer</c>).
/// Renders raster tiles through <see cref="TsMapTileLayer"/> over a Web-Mercator
/// projection, hosts arbitrary <see cref="IMapOverlay"/> children on an overlay
/// canvas, and supports pointer pan + wheel zoom. Free providers (CARTO / OSM / Esri
/// / OpenTopoMap) need no key; Azure/Google keys flow in at runtime via
/// <see cref="MapConfig"/> and are never committed. The map exposes an accessible
/// summary of its centre/zoom and shows an empty state when it has no geometry and an
/// error state when tiles fail to load.
/// </summary>
public partial class TsMapControl : ContentControl, IMapProjection
{
    private readonly Grid _root = new();
    private readonly TsMapTileLayer _tiles = new();
    private readonly Canvas _overlay = new() { IsHitTestVisible = false };
    private readonly Caption _attribution = new();
    private readonly TsEmptyState _empty = new() { Visibility = Visibility.Collapsed };
    private readonly TsErrorDisplay _error = new() { Visibility = Visibility.Collapsed };
    private readonly List<IMapOverlay> _overlays = [];

    private bool _panning;
    private Windows.Foundation.Point _lastPointer;
    private bool _hasGeometry;
    private bool _tileError;

    public static readonly DependencyProperty CenterLatProperty = DependencyProperty.Register(
        nameof(CenterLat), typeof(double), typeof(TsMapControl), new PropertyMetadata(37.7749, OnViewportChanged));

    public static readonly DependencyProperty CenterLngProperty = DependencyProperty.Register(
        nameof(CenterLng), typeof(double), typeof(TsMapControl), new PropertyMetadata(-122.4194, OnViewportChanged));

    public static readonly DependencyProperty ZoomProperty = DependencyProperty.Register(
        nameof(Zoom), typeof(int), typeof(TsMapControl), new PropertyMetadata(12, OnViewportChanged));

    public static readonly DependencyProperty MapStyleProperty = DependencyProperty.Register(
        nameof(MapStyle), typeof(MapStyleKind), typeof(TsMapControl),
        new PropertyMetadata(MapStyleKind.Dark, OnStyleChanged));

    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsMapControl),
        new PropertyMetadata("No location data to show on the map.", OnEmptyTextChanged));

    public TsMapControl()
    {
        IsTabStop = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 240;
        UseSystemFocusVisuals = true;

        _attribution.HorizontalAlignment = HorizontalAlignment.Right;
        _attribution.VerticalAlignment = VerticalAlignment.Bottom;
        _attribution.Margin = new Thickness(0, 0, 6, 4);

        _empty.IconGlyph = "\uE707";
        _error.Title = "Map unavailable";
        _error.Message = "Map tiles could not be loaded.";

        _root.Children.Add(_tiles);
        _root.Children.Add(_overlay);
        _root.Children.Add(_attribution);
        _root.Children.Add(_empty);
        _root.Children.Add(_error);
        Content = _root;

        _tiles.SetSource(MapTileProvider.Resolve(MapStyle, _config));
        _attribution.Value = _tiles.Attribution;
        _tiles.TileFailed += OnTileFailed;

        SizeChanged += (_, _) => Invalidate();
        PointerPressed += OnPointerPressed;
        PointerMoved += OnPointerMoved;
        PointerReleased += OnPointerReleased;
        PointerCaptureLost += (_, _) => _panning = false;
        PointerWheelChanged += OnPointerWheelChanged;

        UpdateAutomation();
    }

    private MapConfig _config = new();

    /// <summary>Centre latitude.</summary>
    public double CenterLat
    {
        get => (double)GetValue(CenterLatProperty);
        set => SetValue(CenterLatProperty, value);
    }

    /// <summary>Centre longitude.</summary>
    public double CenterLng
    {
        get => (double)GetValue(CenterLngProperty);
        set => SetValue(CenterLngProperty, value);
    }

    /// <summary>Integer zoom level (0–19).</summary>
    public int Zoom
    {
        get => (int)GetValue(ZoomProperty);
        set => SetValue(ZoomProperty, Math.Clamp(value, 0, 19));
    }

    /// <summary>Active base-map style.</summary>
    public MapStyleKind MapStyle
    {
        get => (MapStyleKind)GetValue(MapStyleProperty);
        set => SetValue(MapStyleProperty, value);
    }

    /// <summary>Localized empty-state message shown when the map has no geometry.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    /// <summary>The geographic centre as a <see cref="GeoPoint"/>.</summary>
    public GeoPoint Center => new(CenterLat, CenterLng);

    /// <summary>Viewport width in pixels.</summary>
    public double ViewWidth => ActualWidth;

    /// <summary>Viewport height in pixels.</summary>
    public double ViewHeight => ActualHeight;

    /// <summary>Project a geographic point to a screen pixel.</summary>
    public PixelPoint ToScreen(GeoPoint point) =>
        TileMath.ToScreen(point, Center, Zoom, ViewWidth, ViewHeight);

    /// <summary>
    /// Supply the runtime map configuration (provider + key). Free providers ignore
    /// the key. Call this once after reading the backend map-config endpoint.
    /// </summary>
    public void SetConfig(MapConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        _config = config;
        _tiles.SetSource(MapTileProvider.Resolve(MapStyle, _config));
        _attribution.Value = _tiles.Attribution;
        Invalidate();
    }

    /// <summary>Add an overlay element (marker, polyline, shape) to the map.</summary>
    public void AddOverlay(UIElement element)
    {
        ArgumentNullException.ThrowIfNull(element);
        _overlay.Children.Add(element);
        if (element is IMapOverlay overlay)
        {
            _overlays.Add(overlay);
        }

        _hasGeometry = _overlay.Children.Count > 0;
        Invalidate();
    }

    /// <summary>Remove all overlays from the map.</summary>
    public void ClearOverlays()
    {
        _overlay.Children.Clear();
        _overlays.Clear();
        _hasGeometry = false;
        UpdateStates();
    }

    /// <summary>Mark whether the map currently has geometry to display (drives the empty state).</summary>
    public void SetHasGeometry(bool hasGeometry)
    {
        _hasGeometry = hasGeometry;
        UpdateStates();
    }

    /// <summary>
    /// Centre and zoom the map to enclose <paramref name="points"/> (port of Leaflet's
    /// <c>fitBounds</c>). No-op when the points have no finite coordinates.
    /// </summary>
    public void FitBounds(IReadOnlyList<GeoPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        var bounds = GeoBoundsCalculator.FromPoints(points);
        if (bounds is null)
        {
            return;
        }

        var center = bounds.Value.Center;
        CenterLat = center.Lat;
        CenterLng = center.Lng;
        Zoom = GeoBoundsCalculator.FitZoom(bounds.Value, ViewWidth, ViewHeight);
    }

    /// <summary>Force a tile + overlay repaint (e.g. after the container is resized).</summary>
    public void Invalidate()
    {
        _tileError = false;
        _error.Visibility = Visibility.Collapsed;
        _tiles.Render(Center, Zoom, ViewWidth, ViewHeight);
        ReprojectOverlays();
        UpdateStates();
        UpdateAutomation();
    }

    /// <summary>An accessible one-line description of the current view.</summary>
    public string AccessibleSummary => string.Create(
        System.Globalization.CultureInfo.InvariantCulture,
        $"Map centred on {CoordinateSummary.Coordinate(Center)} at zoom {Zoom}.");

    private static void OnViewportChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMapControl)d).Invalidate();

    private static void OnStyleChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var map = (TsMapControl)d;
        map._tiles.SetSource(MapTileProvider.Resolve(map.MapStyle, map._config));
        map._attribution.Value = map._tiles.Attribution;
        map.Invalidate();
    }

    private static void OnEmptyTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsMapControl)d)._empty.Message = (string)e.NewValue;

    private void ReprojectOverlays()
    {
        foreach (var overlay in _overlays)
        {
            overlay.Project(this);
        }
    }

    private void OnTileFailed(object? sender, EventArgs e)
    {
        _tileError = true;
        UpdateStates();
    }

    private void UpdateStates()
    {
        _error.Visibility = _tileError ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = !_tileError && !_hasGeometry && _overlay.Children.Count == 0
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private void UpdateAutomation()
    {
        AutomationProperties.SetName(this, AccessibleSummary);
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Main);
    }

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        _panning = true;
        _lastPointer = e.GetCurrentPoint(this).Position;
        CapturePointer(e.Pointer);
        Focus(FocusState.Pointer);
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_panning)
        {
            return;
        }

        var current = e.GetCurrentPoint(this).Position;
        double dx = current.X - _lastPointer.X;
        double dy = current.Y - _lastPointer.Y;
        _lastPointer = current;

        var world = WebMercator.Project(Center, Zoom);
        var moved = WebMercator.Unproject(new PixelPoint(world.X - dx, world.Y - dy), Zoom);
        CenterLat = WebMercator.ClampLatitude(moved.Lat);
        CenterLng = WebMercator.WrapLongitude(moved.Lng);
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        _panning = false;
        ReleasePointerCapture(e.Pointer);
    }

    private void OnPointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        int delta = e.GetCurrentPoint(this).Properties.MouseWheelDelta;
        Zoom = Math.Clamp(Zoom + (delta > 0 ? 1 : -1), 0, 19);
        e.Handled = true;
    }
}
