using System;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using ShapeEllipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using ShapePolygon = Microsoft.UI.Xaml.Shapes.Polygon;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>AnimatedMarker</c> shared surface — a parity port of
/// web/src/components/maps/AnimatedMarker.tsx. The web component is a Leaflet <c>&lt;Marker&gt;</c> child that, via
/// <c>useMap()</c>, smoothly moves a custom car icon (a pulsing halo plus a heading-rotated, white-bordered dot)
/// to each new live <c>position</c> and pans the map to keep it on screen. This surface reproduces that icon as a
/// composed map overlay (the pulsing <see cref="ShapeEllipse"/> halo, the solid accent dot, and — surfacing the
/// heading the web icon only carried invisibly — a rotated <see cref="ShapePolygon"/> pointer) and binds the live
/// fix through the P1/S8 <see cref="IAnimatedMarkerSource"/> while the <c>useMap</c> capability (visible bounds +
/// pan) flows through the P1/S8 <see cref="IAnimatedMarkerMap"/>. Because that fix has a real load lifecycle on
/// Windows, every state renders rather than vanishing: a centered spinner while locating, a friendly
/// <see cref="TsEmptyState"/> when there is no fix, a <see cref="TsErrorDisplay"/> with a retry affordance on
/// failure, and the dimmed last-good fix with a freshness chip while stale or offline. The halo pulse honours the
/// reduced-motion contract, all text resolves through the i18n facade, the marker exposes a Narrator name that
/// includes its heading, and the surface emits the <c>view.opened</c> diagnostic once when shown. All state flows
/// through <see cref="AnimatedMarkerViewModel"/>; the view performs no I/O.
/// </summary>
public sealed partial class AnimatedMarker : ContentControl, IMapOverlay, IDisposable
{
    private const double HaloSize = AnimatedMarkerRegistration.HaloDiameter;
    private const double DotSize = AnimatedMarkerRegistration.DotDiameter;
    private const double PointerSize = AnimatedMarkerRegistration.HeadingPointerSize;
    private const double Center = HaloSize / 2;

    private readonly AnimatedMarkerViewModel _viewModel;
    private readonly AnimatedMarkerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();

    private readonly ShapeEllipse _halo = new()
    {
        Width = HaloSize,
        Height = HaloSize,
        Opacity = 0.3,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false,
    };

    private readonly ShapeEllipse _dot = new()
    {
        Width = DotSize,
        Height = DotSize,
        StrokeThickness = 2,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false,
    };

    private readonly ShapePolygon _pointer = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false,
    };

    private readonly RotateTransform _pointerRotation = new() { CenterX = Center, CenterY = Center };
    private readonly Grid _markerVisual = new() { Width = HaloSize, Height = HaloSize };
    private readonly TsStatusBadge _chip = new();
    private readonly StackPanel _markerStack = new()
    {
        Spacing = 4,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsSpinner _spinner = new();
    private readonly Caption _spinnerLabel = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly StackPanel _spinnerStack = new()
    {
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsEmptyState _empty = new() { IconGlyph = "\uE707" };
    private readonly TsErrorDisplay _error = new();

    private Storyboard? _pulse;
    private IMapProjection? _lastProjection;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with the headless defaults (the designer / parameterless host entry point): it shows
    /// the initial locating state over an in-memory live-position seam and a whole-world map seam. Supply an
    /// explicit <see cref="ILocalizer"/>, <see cref="IAnimatedMarkerSource"/> and <see cref="IAnimatedMarkerMap"/>
    /// via the other constructor to drive i18n, data and the map from the composition root.
    /// </summary>
    public AnimatedMarker()
        : this(
            PassthroughLocalizer.Instance,
            new StaticAnimatedMarkerSource(),
            new StaticAnimatedMarkerMap(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade, the live-position seam and the map seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The live-position state-holder seam (web <c>position</c> stream).</param>
    /// <param name="map">The map-viewport seam (web <c>useMap()</c>): visible bounds + pan.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnimatedMarker(
        ILocalizer localizer,
        IAnimatedMarkerSource source,
        IAnimatedMarkerMap map,
        AnimatedMarkerDiagnostics? diagnostics = null)
        : this(
            new AnimatedMarkerViewModel(localizer, source, map, static () => MotionPreference.ReduceMotion),
            diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnimatedMarker(AnimatedMarkerViewModel viewModel, AnimatedMarkerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new AnimatedMarkerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildVisualTree();
        AutomationProperties.SetAutomationId(this, AnimatedMarkerRegistration.RootAutomationId);

        _error.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AnimatedMarker</c>).</summary>
    public static string Slug => AnimatedMarkerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AnimatedMarkerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports.</summary>
    internal string AccessibleName => _viewModel.AutomationName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopPulse();
        _error.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Reposition the marker against the current map projection (the <see cref="IMapOverlay"/> contract).</summary>
    /// <param name="projection">The map's current viewport projection.</param>
    public void Project(IMapProjection projection)
    {
        ArgumentNullException.ThrowIfNull(projection);
        _lastProjection = projection;
        PositionOnMap();
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AnimatedMarkerAutomationPeer(this);

    private void BuildVisualTree()
    {
        _pointer.Points = new PointCollection
        {
            new Windows.Foundation.Point(Center, Center - HaloSize / 2),
            new Windows.Foundation.Point(Center - PointerSize / 2, Center - HaloSize / 2 + PointerSize),
            new Windows.Foundation.Point(Center + PointerSize / 2, Center - HaloSize / 2 + PointerSize),
        };
        _pointer.RenderTransform = _pointerRotation;

        _markerVisual.Children.Add(_halo);
        _markerVisual.Children.Add(_pointer);
        _markerVisual.Children.Add(_dot);

        _markerStack.Children.Add(_markerVisual);
        _markerStack.Children.Add(_chip);

        _spinnerStack.Children.Add(_spinner);
        _spinnerStack.Children.Add(_spinnerLabel);

        _root.Children.Add(_markerStack);
        _root.Children.Add(_spinnerStack);
        _root.Children.Add(_empty);
        _root.Children.Add(_error);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        PositionOnMap();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Retry();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var p = _viewModel.Projection;

        _markerStack.Visibility = p.ShowMarker ? Visibility.Visible : Visibility.Collapsed;
        _spinnerStack.Visibility = p.ShowSpinner ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = p.ShowEmptyPanel ? Visibility.Visible : Visibility.Collapsed;
        _error.Visibility = p.ShowErrorPanel ? Visibility.Visible : Visibility.Collapsed;

        if (p.ShowMarker)
        {
            var accent = DisplayTokens.Brush(p.AccentBrushKey);
            _markerVisual.Opacity = p.MarkerOpacity;
            _halo.Fill = accent;
            _dot.Fill = accent;
            _dot.Stroke = DisplayTokens.Surface;

            _pointer.Fill = accent;
            _pointer.Stroke = DisplayTokens.Surface;
            _pointer.StrokeThickness = 1;
            _pointer.Visibility = p.ShowHeadingArrow ? Visibility.Visible : Visibility.Collapsed;
            _pointerRotation.Angle = p.HeadingDegrees;

            _chip.Status = p.StatusLabel;
            _chip.AccentBrushKey = p.StatusAccentBrushKey;
        }

        if (p.ShowSpinner)
        {
            _spinnerLabel.Value = p.StatusLabel;
        }

        if (p.ShowEmptyPanel)
        {
            _empty.Message = p.StatusLabel;
        }

        if (p.ShowErrorPanel)
        {
            _error.Title = p.StatusLabel;
            _error.ActionText = p.ShowRetry ? p.RetryLabel : string.Empty;
        }

        ApplyPulse(p.ShowPulse);
        AutomationProperties.SetName(this, p.AutomationName);
        PositionOnMap();
    }

    private void ApplyPulse(bool shouldPulse)
    {
        if (shouldPulse)
        {
            StartPulse();
        }
        else
        {
            StopPulse();
            _halo.Opacity = 0.3;
        }
    }

    private void StartPulse()
    {
        if (_pulse is not null || _disposed)
        {
            return;
        }

        var scale = new ScaleTransform { CenterX = Center, CenterY = Center };
        _halo.RenderTransform = scale;

        var grow = NewDouble(0.6, 1.8);
        Storyboard.SetTarget(grow, scale);
        Storyboard.SetTargetProperty(grow, "ScaleX");

        var growY = NewDouble(0.6, 1.8);
        Storyboard.SetTarget(growY, scale);
        Storyboard.SetTargetProperty(growY, "ScaleY");

        var fade = NewDouble(0.4, 0);
        Storyboard.SetTarget(fade, _halo);
        Storyboard.SetTargetProperty(fade, "Opacity");

        _pulse = new Storyboard();
        _pulse.Children.Add(grow);
        _pulse.Children.Add(growY);
        _pulse.Children.Add(fade);
        _pulse.Begin();
    }

    private static DoubleAnimation NewDouble(double from, double to) => new()
    {
        From = from,
        To = to,
        Duration = new Duration(TimeSpan.FromMilliseconds(1500)),
        RepeatBehavior = RepeatBehavior.Forever,
        EnableDependentAnimation = true,
    };

    private void StopPulse()
    {
        _pulse?.Stop();
        _pulse = null;
    }

    private void PositionOnMap()
    {
        if (_lastProjection is not { } projection)
        {
            return;
        }

        double half = (ActualWidth > 0 ? ActualWidth : HaloSize) / 2;
        double halfY = (ActualHeight > 0 ? ActualHeight : HaloSize) / 2;

        if (_viewModel.Projection.HasPosition)
        {
            var screen = projection.ToScreen(_viewModel.Projection.Position);
            Canvas.SetLeft(this, screen.X - half);
            Canvas.SetTop(this, screen.Y - halfY);
        }
        else
        {
            // No fix to pin to: centre the locating / empty / error chrome in the viewport.
            Canvas.SetLeft(this, (projection.ViewWidth / 2) - half);
            Canvas.SetTop(this, (projection.ViewHeight / 2) - halfY);
        }
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class AnimatedMarkerAutomationPeer : FrameworkElementAutomationPeer
    {
        public AnimatedMarkerAutomationPeer(AnimatedMarker owner)
            : base(owner)
        {
        }

        private AnimatedMarker Surface => (AnimatedMarker)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The production <see cref="IAnimatedMarkerMap"/> — adapts the native <see cref="TsMapControl"/> to the marker's
/// <c>useMap</c> seam. <see cref="VisibleBounds"/> unprojects the control's viewport corners (web
/// <c>map.getBounds()</c>) and <see cref="PanTo"/> recentres the control (web <c>map.panTo</c>). View-layer glue
/// (references the WinUI map control), so it lives with the view rather than the WinUI-free seam.
/// </summary>
public sealed class TsMapControlMarkerMap : IAnimatedMarkerMap
{
    private readonly TsMapControl _map;

    /// <summary>Creates the adapter over a native map control.</summary>
    /// <param name="map">The map control whose viewport backs the seam.</param>
    public TsMapControlMarkerMap(TsMapControl map)
    {
        ArgumentNullException.ThrowIfNull(map);
        _map = map;
    }

    /// <inheritdoc />
    public GeoBounds VisibleBounds
    {
        get
        {
            double vw = _map.ViewWidth;
            double vh = _map.ViewHeight;
            if (vw <= 0 || vh <= 0)
            {
                // The control has not been measured yet; report an invalid box so no pan is requested.
                return new GeoBounds(double.NaN, double.NaN, double.NaN, double.NaN);
            }

            var world = WebMercator.Project(_map.Center, _map.Zoom);
            var northWest = WebMercator.Unproject(new PixelPoint(world.X - (vw / 2), world.Y - (vh / 2)), _map.Zoom);
            var southEast = WebMercator.Unproject(new PixelPoint(world.X + (vw / 2), world.Y + (vh / 2)), _map.Zoom);
            return new GeoBounds(southEast.Lat, northWest.Lng, northWest.Lat, southEast.Lng);
        }
    }

    /// <inheritdoc />
    public void PanTo(GeoPoint center)
    {
        _map.CenterLat = center.Lat;
        _map.CenterLng = center.Lng;
    }
}
