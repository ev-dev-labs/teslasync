using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 trip route-playback surface — a parity port of the web <c>RoutePlayback</c>
/// (web/src/components/maps/RoutePlayback.tsx). Inside a <see cref="TsGlassPanel"/> it composes a native slippy
/// map (<see cref="TsMapControl"/>, the Leaflet <c>MapContainer</c> counterpart) carrying the GPS-trail polyline
/// (web <c>Polyline</c>), green start / red end dots (web <c>CircleMarker</c>), an animated current-position
/// marker (web <c>AnimatedMarker</c>) and a floating base-map switcher (web <c>MapLayerSwitcher</c>); a floating
/// metric chip over the top-right (web inline chip); and a bottom transport bar reproducing the web
/// <c>PlaybackControls</c> composition the surface mounts — reset / play-pause / stop, a wrapping speed cycle and
/// a drag scrubber with an elapsed / total clock. When the trip has no finite GPS points it renders a
/// <see cref="TsEmptyState"/> instead (web empty branch), never a blank panel.
///
/// <para>
/// State coverage: the web source is presentational and fully prop-driven (<c>points</c> + the
/// <c>onPositionChange</c> callback + display options) — it performs no data fetch, so (like the peer
/// presentational surfaces TimelineScrubber / PlaybackSpeedMenu) it has no loading / error / stale / offline
/// chrome to reproduce. The two branches it does have are reproduced in full: the empty state (no GPS points) and
/// the populated map + chip + transport, with the live playback (play / pause / stop / seek / speed-cycle), the
/// start/end dots, the moving marker and the per-tick cursor announcement.
/// </para>
///
/// <para>
/// Accessibility: the map container exposes the localized application-landmark name (web
/// <c>role="application" aria-label</c>); every transport control carries a localized accessible name; the
/// current cursor is announced through a polite live region (<see cref="TsAnnouncerRegion"/>); and the animated
/// marker honours the OS reduce-motion setting (web <c>prefers-reduced-motion</c>) via
/// <see cref="TsAnimatedMarker"/>. All geometry, formatting and transport state live in the UI-thread-free
/// <see cref="RoutePlaybackViewModel"/> + <see cref="RoutePlaybackEngine"/>; the view owns only the 50 ms timer
/// and the rendering.
/// </para>
/// </summary>
public sealed partial class RoutePlayback : ContentControl, IDisposable
{
    private const double ScrubberRange = 1000;
    private const double DotSize = 14;        // web CircleMarker radius 7 → diameter 14.
    private const string FlagGlyph = "\uE7C1";       // Segoe Fluent "Flag" — the web Lucide Flag chip icon.
    private const string MapPinGlyph = "\uE707";     // Segoe Fluent "MapPin" — the web Lucide MapPin empty icon.
    private const string ResetGlyph = "\uE892";      // "Previous" — the web SkipBack reset.
    private const string PlayGlyph = "\uE768";       // "Play".
    private const string PauseGlyph = "\uE769";      // "Pause".
    private const string StopGlyph = "\uE71A";       // "Stop".

    private readonly RoutePlaybackViewModel _viewModel;
    private readonly RoutePlaybackDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _glass = new();
    private readonly Grid _root = new();
    private readonly TsEmptyState _empty = new();
    private readonly StackPanel _populated = new();

    private readonly Grid _mapHost = new();
    private readonly TsMapControl _map = new();
    private readonly TsMapLayerSwitcher _layerSwitcher = new();
    private readonly TsMapPolyline _trail = new();
    private readonly RoutePlaybackDot _startDot;
    private readonly RoutePlaybackDot _endDot;
    private readonly TsAnimatedMarker _marker = new();
    private readonly TsAnnouncerRegion _announcer = new();

    private readonly Border _chip = new();
    private readonly FontIcon _chipFlag = new() { Glyph = FlagGlyph, FontSize = 12 };
    private readonly TextBlock _chipPosition;
    private readonly TextBlock _chipSpeed;
    private readonly TextBlock _chipSoc;

    private readonly Border _controlsHost = new();
    private readonly TsButton _reset = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = ResetGlyph };
    private readonly TsButton _playPause = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = PlayGlyph };
    private readonly TsButton _stop = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = StopGlyph };
    private readonly TsButton _speed = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TextBlock _speedBadge;
    private readonly Slider _scrubber = new() { Minimum = 0, Maximum = ScrubberRange, StepFrequency = 1, HorizontalAlignment = HorizontalAlignment.Stretch, MinWidth = 120 };
    private readonly TextBlock _clock;

    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(RoutePlaybackEngine.TickMs) };

    private bool _opened;
    private bool _renderQueued;
    private bool _suppressScrub;
    private bool _geometryDirty;
    private bool _fitted;
    private bool _disposed;
    private int _lastAnnouncedIndex = -1;
    private double _mapHeight = RoutePlaybackRegistration.DefaultHeight;
    private bool _showLayerSwitcher = true;
    private bool _showControls = true;

    /// <summary>
    /// Creates a headless-safe surface bound to the inert position sink and the passthrough localizer — the
    /// native analogue of mounting the web component with a no-op <c>onPositionChange</c>. Useful for galleries /
    /// design hosts; production callers use the seam constructor.
    /// </summary>
    public RoutePlayback()
        : this(NoOpRoutePositionSink.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its position seam, localizer and optional diagnostics.</summary>
    /// <param name="sink">The position seam (web <c>onPositionChange</c>); pass <see cref="NoOpRoutePositionSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible label, empty message and control labels resolve through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RoutePlayback(IRoutePositionSink sink, ILocalizer localizer, RoutePlaybackDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new RoutePlaybackDiagnostics();
        _viewModel = new RoutePlaybackViewModel(sink, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _startDot = new RoutePlaybackDot(ResolveBrush("TsColorSuccessBrush", 0x10, 0xB9, 0x81));
        _endDot = new RoutePlaybackDot(ResolveBrush("TsColorDangerBrush", 0xEF, 0x44, 0x44));
        _chipPosition = NewChipLine("TsColorTextPrimaryBrush");
        _chipSpeed = NewChipLine("TsColorTextSecondaryBrush");
        _chipSoc = NewChipLine("TsColorSuccessBrush");
        _speedBadge = NewChipLine("TsColorTextPrimaryBrush");
        _clock = NewChipLine("TsColorTextSecondaryBrush");
        _clock.MinWidth = 90;
        _clock.TextAlignment = TextAlignment.Right;

        BuildTree();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        Content = _glass;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _timer.Tick += OnTick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>RoutePlayback</c>).</summary>
    public static string Slug => RoutePlaybackRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RoutePlaybackViewModel ViewModel => _viewModel;

    /// <summary>The time-ordered GPS samples to replay (web <c>points</c> prop). Loading resets to the start.</summary>
    public IReadOnlyList<PlaybackPoint> Points
    {
        get => _viewModel.Points;
        set
        {
            _geometryDirty = true;
            _fitted = false;
            _lastAnnouncedIndex = -1;
            _viewModel.SetPoints(value ?? []);
        }
    }

    /// <summary>Whether replay auto-starts once two or more points are loaded (web <c>autoPlay</c> prop).</summary>
    public bool AutoPlay
    {
        get => _viewModel.AutoPlay;
        set => _viewModel.AutoPlay = value;
    }

    /// <summary>Whether the floating base-map switcher is shown (web <c>showLayerSwitcher</c> prop, default true).</summary>
    public bool ShowLayerSwitcher
    {
        get => _showLayerSwitcher;
        set
        {
            _showLayerSwitcher = value;
            ScheduleRender();
        }
    }

    /// <summary>Whether the bottom transport bar is shown (web <c>showControls</c> prop, default true).</summary>
    public bool ShowControls
    {
        get => _showControls;
        set
        {
            _showControls = value;
            ScheduleRender();
        }
    }

    /// <summary>The visible map height in effective pixels (web <c>height</c> prop, default 400).</summary>
    public double MapHeight
    {
        get => _mapHeight;
        set
        {
            _mapHeight = value;
            _mapHost.Height = value;
        }
    }

    /// <summary>The initial base-map style (web <c>initialMapStyle</c> prop, default dark).</summary>
    public MapStyleKind InitialMapStyle
    {
        get => _viewModel.MapStyle;
        set => _viewModel.MapStyle = value;
    }

    /// <summary>Optional empty-state message override (web <c>emptyMessage</c> prop).</summary>
    public string? EmptyMessage
    {
        get => _viewModel.EmptyMessageOverride;
        set => _viewModel.EmptyMessageOverride = value;
    }

    /// <summary>Optional accessible-name override for the map landmark (web <c>ariaLabel</c> prop).</summary>
    public string? AriaLabel
    {
        get => _viewModel.AriaLabelOverride;
        set => _viewModel.AriaLabelOverride = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _timer.Stop();
        _timer.Tick -= OnTick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _map.SizeChanged -= OnMapSizeChanged;
        _reset.Click -= OnResetClick;
        _playPause.Click -= OnPlayPauseClick;
        _stop.Click -= OnStopClick;
        _speed.Click -= OnSpeedClick;
        _scrubber.ValueChanged -= OnScrub;
        _layerSwitcher.StyleSelected -= OnStyleSelected;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private static TextBlock NewChipLine(string brushKey) => new()
    {
        FontSize = 11,
        FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
        VerticalAlignment = VerticalAlignment.Center,
        Foreground = ResolveBrush(brushKey, 0xFF, 0xFF, 0xFF),
    };

    private static Brush ResolveBrush(string tokenKey, byte r, byte g, byte b) =>
        TypographyTokens.Brush(tokenKey) ?? new SolidColorBrush(Color.FromArgb(0xFF, r, g, b));

    private void BuildTree()
    {
        _trail.SetStroke(ResolveBrush("TsChartSpeedBrush", 0x22, 0xD3, 0xEE));

        _map.HorizontalAlignment = HorizontalAlignment.Stretch;
        _map.VerticalAlignment = VerticalAlignment.Stretch;
        _map.MapStyle = _viewModel.MapStyle;
        _map.AddOverlay(_trail);
        _map.AddOverlay(_startDot);
        _map.AddOverlay(_endDot);
        _map.AddOverlay(_marker);
        _map.SizeChanged += OnMapSizeChanged;

        _layerSwitcher.HorizontalAlignment = HorizontalAlignment.Left;
        _layerSwitcher.VerticalAlignment = VerticalAlignment.Top;
        _layerSwitcher.Margin = new Thickness(8);
        _layerSwitcher.SelectedStyle = _viewModel.MapStyle;
        _layerSwitcher.StyleSelected += OnStyleSelected;

        BuildChip();

        _mapHost.Height = _mapHeight;
        _mapHost.Children.Add(_map);
        _mapHost.Children.Add(_layerSwitcher);
        _mapHost.Children.Add(_chip);
        _mapHost.Children.Add(_announcer);
        AutomationProperties.SetLocalizedControlType(_mapHost, "application");

        BuildControls();

        _populated.Children.Add(_mapHost);
        _populated.Children.Add(_controlsHost);

        _empty.IconGlyph = MapPinGlyph;

        _root.Children.Add(_populated);
        _root.Children.Add(_empty);
        _glass.Content = _root;

        _reset.Click += OnResetClick;
        _playPause.Click += OnPlayPauseClick;
        _stop.Click += OnStopClick;
        _speed.Click += OnSpeedClick;
        _scrubber.ValueChanged += OnScrub;
    }

    private void BuildChip()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _chipFlag.Foreground = ResolveBrush("TsChartSpeedBrush", 0x22, 0xD3, 0xEE);
        AutomationProperties.SetAccessibilityView(_chipFlag, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        row.Children.Add(_chipFlag);
        row.Children.Add(_chipPosition);
        row.Children.Add(_chipSpeed);
        row.Children.Add(_chipSoc);

        _chip.Child = row;
        _chip.Padding = new Thickness(12, 6, 12, 6);
        _chip.CornerRadius = new CornerRadius(8);
        _chip.HorizontalAlignment = HorizontalAlignment.Right;
        _chip.VerticalAlignment = VerticalAlignment.Top;
        _chip.Margin = new Thickness(8);
        _chip.IsHitTestVisible = false;
        _chip.Background = ResolveBrush("TsColorSurfaceOverlayBrush", 0x14, 0x1B, 0x2B);
        _chip.BorderBrush = ResolveBrush("TsColorBorderBrush", 0x33, 0x3B, 0x4D);
        _chip.BorderThickness = new Thickness(1);
    }

    private void BuildControls()
    {
        var row = new Grid { ColumnSpacing = 8, VerticalAlignment = VerticalAlignment.Center };
        for (int i = 0; i < 4; i++)
        {
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _speed.Content = _speedBadge;

        AddColumn(row, _reset, 0);
        AddColumn(row, _playPause, 1);
        AddColumn(row, _stop, 2);
        AddColumn(row, _speed, 3);
        AddColumn(row, _scrubber, 4);
        AddColumn(row, _clock, 5);

        _controlsHost.Child = row;
        _controlsHost.Padding = new Thickness(12);
        _controlsHost.BorderThickness = new Thickness(0, 1, 0, 0);
        _controlsHost.BorderBrush = ResolveBrush("TsColorBorderBrush", 0x33, 0x3B, 0x4D);
    }

    private static void AddColumn(Grid grid, FrameworkElement element, int column)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        _geometryDirty = true;
        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnMapSizeChanged(object sender, SizeChangedEventArgs e)
    {
        TryFit();
        ScheduleRender();
    }

    private void OnTick(object? sender, object e) => _viewModel.Advance();

    private void OnResetClick(object sender, RoutedEventArgs e) => _viewModel.Stop();

    private void OnPlayPauseClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.IsPlaying)
        {
            _viewModel.Pause();
        }
        else
        {
            _viewModel.Play();
        }
    }

    private void OnStopClick(object sender, RoutedEventArgs e) => _viewModel.Stop();

    private void OnSpeedClick(object sender, RoutedEventArgs e) => _viewModel.CycleSpeedForward();

    private void OnScrub(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_suppressScrub)
        {
            return;
        }

        _viewModel.SeekToProgress(e.NewValue / ScrubberRange);
    }

    private void OnStyleSelected(object? sender, MapStyleKind style) => _viewModel.MapStyle = style;

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        bool empty = _viewModel.IsEmpty;
        _empty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        _populated.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
        _empty.Message = _viewModel.EmptyMessage;

        if (empty)
        {
            _timer.Stop();
            return;
        }

        AutomationProperties.SetName(_mapHost, _viewModel.AccessibleMapLabel);

        _map.MapStyle = _viewModel.MapStyle;
        _layerSwitcher.SelectedStyle = _viewModel.MapStyle;
        _layerSwitcher.Visibility = _showLayerSwitcher ? Visibility.Visible : Visibility.Collapsed;
        _controlsHost.Visibility = _showControls ? Visibility.Visible : Visibility.Collapsed;

        if (_geometryDirty)
        {
            RebuildGeometry();
            _geometryDirty = false;
        }

        UpdateMarker();
        UpdateChip();
        UpdateTransport();
        AnnouncePosition();
        SyncTimer();
    }

    private void RebuildGeometry()
    {
        _trail.SetPoints(_viewModel.Trail);
        _map.SetHasGeometry(_viewModel.Trail.Count > 0);

        if (_viewModel.StartPoint is { } start)
        {
            _startDot.Location = start;
            _startDot.Visibility = Visibility.Visible;
        }
        else
        {
            _startDot.Visibility = Visibility.Collapsed;
        }

        if (_viewModel.EndPoint is { } end)
        {
            _endDot.Location = end;
            _endDot.Visibility = Visibility.Visible;
        }
        else
        {
            _endDot.Visibility = Visibility.Collapsed;
        }

        _fitted = false;
        TryFit();
    }

    private void TryFit()
    {
        if (_disposed || _viewModel.IsEmpty || _fitted || _map.ViewWidth <= 0)
        {
            return;
        }

        _map.FitBounds(_viewModel.Trail);
        _map.Invalidate();
        _fitted = true;
    }

    private void UpdateMarker()
    {
        if (_viewModel.CurrentPoint is { } point)
        {
            _marker.Visibility = Visibility.Visible;
            _marker.Location = new GeoPoint(point.Lat, point.Lng);
            if (_map.ViewWidth > 0)
            {
                _marker.Project(_map);
            }
        }
        else
        {
            _marker.Visibility = Visibility.Collapsed;
        }
    }

    private void UpdateChip()
    {
        _chip.Visibility = _viewModel.ShowChip ? Visibility.Visible : Visibility.Collapsed;
        if (!_viewModel.ShowChip)
        {
            return;
        }

        _chipPosition.Text = _viewModel.PositionLabel;

        _chipSpeed.Text = _viewModel.SpeedText;
        _chipSpeed.Visibility = _viewModel.ShowSpeed ? Visibility.Visible : Visibility.Collapsed;

        _chipSoc.Text = _viewModel.SocText;
        _chipSoc.Visibility = _viewModel.ShowSoc ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateTransport()
    {
        bool playing = _viewModel.IsPlaying;
        _playPause.IconGlyph = playing ? PauseGlyph : PlayGlyph;

        AutomationProperties.SetName(_reset, Localize(RoutePlaybackRegistration.ResetKey, RoutePlaybackRegistration.ResetFallback));
        AutomationProperties.SetName(_stop, Localize(RoutePlaybackRegistration.StopKey, RoutePlaybackRegistration.StopFallback));
        AutomationProperties.SetName(
            _playPause,
            playing
                ? Localize(RoutePlaybackRegistration.PauseKey, RoutePlaybackRegistration.PauseFallback)
                : Localize(RoutePlaybackRegistration.PlayKey, RoutePlaybackRegistration.PlayFallback));

        _speedBadge.Text = string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{_viewModel.Speed}\u00d7");
        string speedName = Localize(RoutePlaybackRegistration.SpeedKey, RoutePlaybackRegistration.SpeedFallback);
        AutomationProperties.SetName(_speed, speedName);
        ToolTipService.SetToolTip(_speed, speedName);

        _suppressScrub = true;
        _scrubber.Value = _viewModel.Progress * ScrubberRange;
        _suppressScrub = false;
        AutomationProperties.SetName(_scrubber, speedName);

        _clock.Text = $"{_viewModel.ElapsedText} / {_viewModel.TotalText}";
    }

    private void AnnouncePosition()
    {
        if (_viewModel.CurrentPoint is not { } point || _viewModel.CurrentIndex == _lastAnnouncedIndex)
        {
            return;
        }

        _lastAnnouncedIndex = _viewModel.CurrentIndex;
        _announcer.Announce(
            CoordinateSummary.Position(_viewModel.CurrentIndex, _viewModel.PointCount, new GeoPoint(point.Lat, point.Lng)));
    }

    private void SyncTimer()
    {
        bool shouldRun = !_disposed && IsLoaded && _viewModel.IsPlaying && !_viewModel.IsEmpty;
        if (shouldRun && !_timer.IsEnabled)
        {
            _timer.Start();
        }
        else if (!shouldRun && _timer.IsEnabled)
        {
            _timer.Stop();
        }
    }

    private string Localize(string key, string fallback) => _viewModel.Localize(key, fallback);

    /// <summary>
    /// A fixed-pixel coloured dot pinned to a geographic coordinate — the native port of the web
    /// <c>CircleMarker</c> used for the green start / red end markers (a constant screen radius, unlike the
    /// metre-radius <see cref="TsMapCircle"/>). Repositions on every projection change.
    /// </summary>
    private sealed partial class RoutePlaybackDot : ContentControl, IMapOverlay
    {
        private readonly Ellipse _dot;

        public RoutePlaybackDot(Brush brush)
        {
            IsTabStop = false;
            IsHitTestVisible = false;
            Width = DotSize;
            Height = DotSize;
            _dot = new Ellipse
            {
                Width = DotSize,
                Height = DotSize,
                Fill = brush,
                Stroke = brush,
                StrokeThickness = 2,
            };
            Content = _dot;
        }

        public GeoPoint Location { get; set; }

        public void Project(IMapProjection projection)
        {
            ArgumentNullException.ThrowIfNull(projection);
            var screen = projection.ToScreen(Location);
            Canvas.SetLeft(this, screen.X - (DotSize / 2));
            Canvas.SetTop(this, screen.Y - (DotSize / 2));
        }
    }
}
