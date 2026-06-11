using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>TripReplayMap</c> feature surface — a parity port of
/// <c>web/src/features/trips/components/TripReplayMap.tsx</c>. It renders one drive's GPS replay on a slippy map:
/// a <see cref="TsMapControl"/> (the web Leaflet <c>MapContainer</c>) with a <see cref="TsMapLayerSwitcher"/> (the
/// web <c>MapLayerSwitcher</c>), the speed-coloured route as one <see cref="TsMapPolyline"/> per leg (the web
/// <c>Polyline</c> set), the green start and red end <see cref="TripReplayDotMarker"/>s (the web
/// <c>CircleMarker</c>s), and a <see cref="TsAnimatedMarker"/> playhead tracking <see cref="CurrentIndex"/> (the web
/// <c>AnimatedMarker</c>, which honours reduced motion by snapping rather than pulsing). A stationary single-fix
/// drive renders one cyan anchor dot plus the "route can't be plotted" <see cref="TsAlertBanner"/> (the web
/// <c>AlertBanner</c>) instead of a collapsed dot; a drive with no positions renders the "no position data" empty
/// state — never a blank box. Tapping the route seeks to the nearest sample and raises <see cref="SeekRequested"/>
/// (the web polyline <c>click</c> → <c>onSeekToIndex</c>). All data flows through the shared
/// <see cref="TripReplayMapViewModel"/>; the view never performs HTTP. It reproduces every state from the web data
/// flow — a skeleton while loading, a retryable error surface on a hard failure, the map once resolved, and a stale
/// / offline freshness chip while a cached drive is shown. Every string resolves through the i18n facade, the map
/// region carries an accessible label, and the playhead carries a Narrator name.
/// </summary>
public sealed partial class TripReplayMap : ContentControl, IDisposable
{
    private const double MapHeight = 450;       // web height={450}
    private const double CornerRadiusPx = 12;   // web rounded-xl

    private const string StartColorHex = "#10b981";   // web emerald start CircleMarker
    private const string EndColorHex = "#ef4444";     // web red end CircleMarker
    private const string AnchorColorHex = "#22d3ee";  // web cyan stationary anchor CircleMarker

    private readonly TripReplayMapViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly TripReplayMapDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new();
    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None, Padding = new Thickness(0) };
    private readonly Border _bodyHost = new() { CornerRadius = new CornerRadius(CornerRadiusPx) };
    private readonly Grid _mapGrid = new();
    private readonly TsMapControl _map = new();
    private readonly TsMapLayerSwitcher _layerSwitcher = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly Border _freshnessHolder = new();
    private readonly TsAlertBanner _stationaryBanner = new();
    private readonly TsAnimatedMarker _playhead = new();

    private TripReplayMapDisplay? _renderedDisplay;
    private IReadOnlyList<GeoPoint>? _fitTrail;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network drive-position data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripReplayMap(
        ITripReplayMapSource source,
        ILocalizer localizer,
        TripReplayMapDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new TripReplayMapDiagnostics();
        _viewModel = new TripReplayMapViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.SeekRequested += OnViewModelSeekRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>Raised when a route tap seeks the playhead (web <c>onSeekToIndex</c>); the argument is the index.</summary>
    public event EventHandler<int>? SeekRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TripReplayMap</c>).</summary>
    public static string Slug => TripReplayMapRegistration.Slug;

    /// <summary>
    /// The playhead sample index (web <c>currentIndex</c> prop). A host page drives this in lockstep with its
    /// scrubber / chart cursor; assigning it moves the playhead without raising <see cref="SeekRequested"/>.
    /// </summary>
    public int CurrentIndex
    {
        get => _viewModel.CurrentIndex;
        set => _viewModel.CurrentIndex = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TripReplayMapSource"/> from the shared data
    /// layer (the host's P2-core dependencies). An explicit <paramref name="driveId"/> pins the replayed drive;
    /// otherwise the newest drive of the primary (or explicit) vehicle is resolved.
    /// </summary>
    public static TripReplayMap Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        TripReplayMapDiagnostics? diagnostics = null,
        long? vehicleId = null,
        long? driveId = null)
    {
        var source = new TripReplayMapSource(vehicles, api, engine, options, vehicleId, driveId);
        return new TripReplayMap(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _map.MapStyle = MapStyleKind.Dark;            // web initial mapStyle = 'dark'
        _map.HorizontalAlignment = HorizontalAlignment.Stretch;
        _map.VerticalAlignment = VerticalAlignment.Stretch;
        _map.EmptyMessage = _viewModel.EmptyText;
        _map.Tapped += OnMapTapped;
        _map.SizeChanged += (_, _) => TryFitBounds();
        _map.Loaded += (_, _) => TryFitBounds();

        // web `<MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />` — floating bottom-left, where the
        // web component pins it so a top banner doesn't collide.
        _layerSwitcher.SelectedStyle = MapStyleKind.Dark;
        _layerSwitcher.HorizontalAlignment = HorizontalAlignment.Left;
        _layerSwitcher.VerticalAlignment = VerticalAlignment.Bottom;
        _layerSwitcher.Margin = new Thickness(12, 0, 0, 12);
        _layerSwitcher.StyleSelected += (_, style) => _map.MapStyle = style;

        _freshnessHolder.HorizontalAlignment = HorizontalAlignment.Right;
        _freshnessHolder.VerticalAlignment = VerticalAlignment.Top;
        _freshnessHolder.Margin = new Thickness(0, 8, 8, 0);
        _freshnessHolder.Padding = new Thickness(8, 4, 8, 4);
        _freshnessHolder.CornerRadius = new CornerRadius(8);
        _freshnessHolder.Background = DisplayTokens.Surface;
        _freshnessHolder.Child = _freshness;
        _freshnessHolder.Visibility = Visibility.Collapsed;

        // web stationary overlay: the AlertBanner pinned across the top of the map.
        _stationaryBanner.Variant = CalloutVariant.Info;
        _stationaryBanner.Dismissible = false;
        _stationaryBanner.HorizontalAlignment = HorizontalAlignment.Stretch;
        _stationaryBanner.VerticalAlignment = VerticalAlignment.Top;
        _stationaryBanner.Margin = new Thickness(12, 12, 12, 0);
        _stationaryBanner.Visibility = Visibility.Collapsed;

        AutomationProperties.SetName(_playhead, _viewModel.MapLabel);

        _mapGrid.Children.Add(_map);
        _mapGrid.Children.Add(_layerSwitcher);
        _mapGrid.Children.Add(_freshnessHolder);
        _mapGrid.Children.Add(_stationaryBanner);

        _bodyHost.Height = MapHeight;
        _panel.Content = _bodyHost;
        _panel.Height = MapHeight;
        _fade.Content = _panel;

        AutomationProperties.SetName(this, _viewModel.MapLabel);
        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Main);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.SeekRequested -= OnViewModelSeekRequested;
        _map.Tapped -= OnMapTapped;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelSeekRequested(object? sender, int index) => SeekRequested?.Invoke(this, index);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        switch (_viewModel.State)
        {
            case TripReplayMapState.Loading:
                _renderedDisplay = null;
                _bodyHost.Child = BuildLoading();
                break;

            case TripReplayMapState.Empty:
                _renderedDisplay = null;
                _bodyHost.Child = BuildEmpty();
                break;

            case TripReplayMapState.Error:
                _renderedDisplay = null;
                _bodyHost.Child = BuildError();
                break;

            default:
                UpdateMapBody();
                _bodyHost.Child = _mapGrid;
                break;
        }
    }

    // ── Map (web MapContainer + overlays) ────────────────────────────────────────────────────────────────
    private void UpdateMapBody()
    {
        var display = _viewModel.Display;

        // Only rebuild the (potentially large) overlay set when the projected geometry actually changed; a bare
        // playhead move (a seek or an externally-driven CurrentIndex) just repositions the marker.
        if (!ReferenceEquals(display, _renderedDisplay))
        {
            UpdateMap(display);
            _renderedDisplay = display;
        }
        else
        {
            MovePlayhead(display);
        }

        UpdateFreshness();
    }

    private void UpdateMap(TripReplayMapDisplay display)
    {
        AutomationProperties.SetName(_map, string.Concat(display.MapLabel, ". ", display.RouteSummary));
        AutomationProperties.SetName(this, display.MapLabel);

        _map.CenterLat = display.CenterLatitude;
        _map.CenterLng = display.CenterLongitude;
        _map.Zoom = display.Zoom;
        _map.EmptyMessage = display.EmptyMessage;

        _map.ClearOverlays();

        // web: hasRoute && speedSegments.map(seg => <Polyline color=seg.color weight=4 opacity=0.8 />).
        foreach (var segment in display.Segments)
        {
            if (segment.Positions.Count < 2)
            {
                continue;
            }

            var line = new TsMapPolyline();
            line.SetPoints(segment.Positions);
            line.SetStroke(DisplayPrimitives.HexBrush(segment.ColorHex));
            _map.AddOverlay(line);
        }

        // web: green start + red end CircleMarkers (route), or a single cyan anchor (stationary).
        if (display.StartPos is { } start)
        {
            _map.AddOverlay(new TripReplayDotMarker(
                DisplayPrimitives.HexBrush(StartColorHex), 1.0, TripReplayMapRegistration.StartLabel(_localizer))
            {
                Location = start,
            });
        }

        if (display.EndPos is { } end)
        {
            _map.AddOverlay(new TripReplayDotMarker(
                DisplayPrimitives.HexBrush(EndColorHex), 1.0, TripReplayMapRegistration.EndLabel(_localizer))
            {
                Location = end,
            });
        }

        if (display.AnchorPos is { } anchor)
        {
            _map.AddOverlay(new TripReplayDotMarker(
                DisplayPrimitives.HexBrush(AnchorColorHex), 0.9, TripReplayMapRegistration.AnchorLabel(_localizer))
            {
                Location = anchor,
            });
        }

        // web: AnimatedMarker (or, under reduced motion, a snapped CircleMarker) tracking the current sample.
        // TsAnimatedMarker honours the OS reduced-motion setting internally, so one marker covers both branches.
        if (display.HasRoute)
        {
            AutomationProperties.SetName(_playhead, TripReplayMapRegistration.PlayheadLabel(_localizer));
            _map.AddOverlay(_playhead);
        }

        // The surface is in a positions-present state, so the map always shows tiles (never its built-in empty
        // overlay); the no-positions case is the whole-surface empty state handled in Render().
        _map.SetHasGeometry(true);

        UpdateStationaryBanner(display);
        MovePlayhead(display);

        // web FitBounds: fit to the trail once the map has a measured size (one-shot, then free pan/zoom).
        _fitTrail = display.FitToTrail ? display.Trail : null;
        TryFitBounds();
    }

    private void MovePlayhead(TripReplayMapDisplay display)
    {
        if (display.HasRoute && _viewModel.CurrentLocation is { } location)
        {
            _playhead.Visibility = Visibility.Visible;
            _playhead.MoveTo(location, _map);
        }
        else
        {
            _playhead.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateStationaryBanner(TripReplayMapDisplay display)
    {
        if (display.ShowStationaryBanner)
        {
            _stationaryBanner.Title = display.StationaryTitle;
            _stationaryBanner.Message = display.StationaryBody;
            _stationaryBanner.Visibility = Visibility.Visible;
        }
        else
        {
            _stationaryBanner.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateFreshness()
    {
        bool show = _viewModel.IsStale || _viewModel.IsOffline;
        _freshnessHolder.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            return;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        AutomationProperties.SetName(
            _freshnessHolder, _viewModel.IsOffline ? _viewModel.OfflineLabel : _viewModel.StaleLabel);
    }

    // web: polyline click → nearestSampleIndex → onSeekToIndex. A tap (not a pan/drag) seeks the playhead.
    private void OnMapTapped(object sender, TappedRoutedEventArgs e)
    {
        if (_map.ActualWidth <= 0 || _map.ActualHeight <= 0)
        {
            return;
        }

        var point = e.GetPosition(_map);
        var center = new GeoPoint(_map.CenterLat, _map.CenterLng);
        var centerWorld = WebMercator.Project(center, _map.Zoom);
        var world = new PixelPoint(
            centerWorld.X + (point.X - (_map.ActualWidth / 2)),
            centerWorld.Y + (point.Y - (_map.ActualHeight / 2)));
        var geo = WebMercator.Unproject(world, _map.Zoom);
        _viewModel.RequestSeekToCoordinate(geo.Lat, geo.Lng);
    }

    private void TryFitBounds()
    {
        if (_fitTrail is not { Count: > 1 } trail)
        {
            return;
        }

        if (_map.ActualWidth <= 0 || _map.ActualHeight <= 0)
        {
            return;
        }

        _map.FitBounds(trail);
        _fitTrail = null; // one-shot, so the user can pan/zoom freely afterwards (web parity)
    }

    // ── Loading (the parent query still resolving — skeleton chrome) ───────────────────────────────────────
    private Border BuildLoading()
    {
        var skeleton = new TsSkeleton
        {
            BlockHeight = MapHeight,
            Radius = CornerRadiusPx,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        var host = new Border
        {
            CornerRadius = new CornerRadius(CornerRadiusPx),
            Height = MapHeight,
            Child = skeleton,
        };

        AutomationProperties.SetName(host, _viewModel.LoadingLabel);
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        return host;
    }

    // ── Empty (web positions.length === 0 — "No position data available for this drive") ───────────────────
    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TripReplayMapRegistration.MapPinGlyph,
        Message = _viewModel.EmptyText,
        MinHeight = MapHeight,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Error (hard failure, no cache — web QueryError) ────────────────────────────────────────────────────
    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorText,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            MinHeight = MapHeight,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();
}
