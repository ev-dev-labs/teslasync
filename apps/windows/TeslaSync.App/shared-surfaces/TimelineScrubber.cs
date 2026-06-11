using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using VirtualKey = Windows.System.VirtualKey;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 trip-replay timeline scrubber — a parity port of the web <c>TimelineScrubber</c>
/// (web/src/components/data-display/TimelineScrubber.tsx). It draws a rounded progress groove with an accent fill
/// (web <c>--neon</c>), an optional buffered bar, keyframe marker ticks coloured by kind (web
/// <c>MARKER_COLORS</c>), a hover ghost playhead, a draggable playhead thumb that grows while scrubbing, and a
/// floating preview tooltip showing the formatted time + sampled speed / power / SoC / elevation. A click or a
/// drag commits a normalised position through the injected <see cref="ITimelineSeekSink"/> (the web
/// <c>onSeek</c>); the preview values come from the injected <see cref="ITimelinePreviewSource"/> (the web
/// <c>getPreviewAt</c>). All geometry, formatting and interaction state live in the UI-thread-free
/// <see cref="TimelineScrubberViewModel"/> + <see cref="TimelineScrubberMath"/>; the view only lays out shapes
/// and forwards pointer / keyboard input.
///
/// <para>
/// State coverage: the web source is presentational and fully controlled (props <c>progress</c> / <c>buffered</c>
/// / <c>duration</c> / <c>markers</c> + the <c>onSeek</c> / <c>getPreviewAt</c> callbacks); it performs no data
/// fetch, so — like the peer presentational surfaces (PlaybackSpeedMenu / ElevationProfile's populated path) — it
/// has no loading / error / stale / offline chrome to reproduce. Every interaction branch it does have is
/// reproduced in full: the default fill, the buffered bar, the marker ticks (with the clustered-count badge), the
/// hover ghost + preview tooltip, the drag-to-scrub playhead growth and the reduced-motion path.
/// </para>
///
/// <para>
/// Accessibility: the control exposes the Slider control type with a RangeValue pattern (0..100), the localized
/// accessible name (web <c>aria-label</c>) and the formatted playback time as its help text (web
/// <c>aria-valuetext</c>); it is keyboard-operable (arrows / page / Home / End commit a seek); markers are
/// focusable buttons carrying their own accessible name + tooltip; and the preview tooltip's entrance animation
/// honours the OS reduce-motion setting (web <c>prefers-reduced-motion</c>).
/// </para>
/// </summary>
public sealed partial class TimelineScrubber : ContentControl, IDisposable
{
    private const double TrackHeight = 32;       // web h-8.
    private const double TrackCenterY = TrackHeight / 2;
    private const double GrooveHeight = 6;       // web h-1.5.
    private const double GrooveRadius = 3;
    private const double MarkerHitWidth = 12;    // web touch-target-overlay around the w-1 tick.
    private const double MarkerTickWidth = 3;    // web w-1.
    private const double MarkerHeight = 12;      // web h-3.
    private const double ThumbSize = 12;         // web h-3 w-3.
    private const double ThumbDragSize = 16;     // web h-4 w-4.
    private const double PreviewFadeMs = 120;

    private readonly TimelineScrubberViewModel _viewModel;
    private readonly TimelineScrubberDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Canvas _surface = new() { Height = TrackHeight, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Canvas _overlay = new() { Height = TrackHeight, HorizontalAlignment = HorizontalAlignment.Stretch, IsHitTestVisible = false };
    private readonly Border _backgroundHost = new() { Opacity = 0.2, IsHitTestVisible = false };
    private readonly Rectangle _groove = new() { Height = GrooveHeight, RadiusX = GrooveRadius, RadiusY = GrooveRadius };
    private readonly Rectangle _buffered = new() { Height = GrooveHeight, RadiusX = GrooveRadius, RadiusY = GrooveRadius, Opacity = 0.25, Visibility = Visibility.Collapsed };
    private readonly Rectangle _fill = new() { Height = GrooveHeight, RadiusX = GrooveRadius, RadiusY = GrooveRadius };
    private readonly Rectangle _ghost = new() { Width = 1, Height = MarkerHeight, Visibility = Visibility.Collapsed };
    private readonly Ellipse _thumb = new() { Width = ThumbSize, Height = ThumbSize };
    private readonly Border _preview;
    private readonly StackPanel _previewStack = new() { Spacing = 1 };
    private readonly TextBlock _previewTime = NewPreviewLine("TsColorTextSecondaryBrush");
    private readonly TextBlock _previewSpeed = NewPreviewLine("TsColorInfoBrush");
    private readonly TextBlock _previewPower = NewPreviewLine("TsColorWarningBrush");
    private readonly TextBlock _previewSoc = NewPreviewLine("TsColorSuccessBrush");
    private readonly TextBlock _previewElevation = NewPreviewLine("TsColorTextSecondaryBrush");
    private readonly List<Button> _markerButtons = new();

    private IDisposable? _motionSubscription;
    private UIElement? _decorativeBackground;
    private bool _reduce;
    private bool _markersDirty = true;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe scrubber bound to the inert seek sink, the empty preview source and the
    /// passthrough localizer — the native analogue of mounting the web component with a no-op <c>onSeek</c> and no
    /// <c>getPreviewAt</c>. Useful for galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public TimelineScrubber()
        : this(NoOpTimelineSeekSink.Instance, NullTimelinePreviewSource.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the scrubber over its seek seam, preview sampler, localizer and optional diagnostics.</summary>
    /// <param name="seek">The seek seam (web <c>onSeek</c>); pass <see cref="NoOpTimelineSeekSink.Instance"/> when none is wired.</param>
    /// <param name="preview">The preview sampler (web <c>getPreviewAt</c>); pass <see cref="NullTimelinePreviewSource.Instance"/> for none.</param>
    /// <param name="localizer">The i18n facade the accessible names resolve through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TimelineScrubber(
        ITimelineSeekSink seek,
        ITimelinePreviewSource preview,
        ILocalizer localizer,
        TimelineScrubberDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(seek);
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TimelineScrubberDiagnostics();
        _viewModel = new TimelineScrubberViewModel(seek, preview, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _preview = BuildPreview();
        BuildTree();

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface slug (<c>TimelineScrubber</c>).</summary>
    public static string Slug => TimelineScrubberRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TimelineScrubberViewModel ViewModel => _viewModel;

    /// <summary>The current playhead position 0..1 (web <c>progress</c> prop).</summary>
    public double Progress
    {
        get => _viewModel.Progress;
        set => _viewModel.Progress = value;
    }

    /// <summary>The buffered position 0..1, or null (web <c>buffered</c> prop).</summary>
    public double? Buffered
    {
        get => _viewModel.Buffered;
        set => _viewModel.Buffered = value;
    }

    /// <summary>The drive duration in seconds (web <c>duration</c> prop).</summary>
    public double Duration
    {
        get => _viewModel.Duration;
        set => _viewModel.Duration = value;
    }

    /// <summary>The keyframe markers along the track (web <c>markers</c> prop).</summary>
    public IReadOnlyList<TimelineMarker> Markers
    {
        get => _viewModel.Markers;
        set
        {
            _markersDirty = true;
            _viewModel.Markers = value;
        }
    }

    /// <summary>
    /// The optional decorative element rendered behind the track at low opacity (web <c>background</c> — typically
    /// a sparkline of speed-over-time). Null clears it.
    /// </summary>
    public UIElement? DecorativeBackground
    {
        get => _decorativeBackground;
        set
        {
            _decorativeBackground = value;
            _backgroundHost.Child = value;
            _backgroundHost.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _motionSubscription?.Dispose();
        _motionSubscription = null;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TimelineScrubberAutomationPeer(this);

    /// <inheritdoc />
    protected override void OnKeyDown(KeyRoutedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        switch (e.Key)
        {
            case VirtualKey.Left:
            case VirtualKey.Down:
                _viewModel.Nudge(-0.01);
                e.Handled = true;
                break;
            case VirtualKey.Right:
            case VirtualKey.Up:
                _viewModel.Nudge(0.01);
                e.Handled = true;
                break;
            case VirtualKey.PageUp:
                _viewModel.Nudge(0.10);
                e.Handled = true;
                break;
            case VirtualKey.PageDown:
                _viewModel.Nudge(-0.10);
                e.Handled = true;
                break;
            case VirtualKey.Home:
                _viewModel.SeekTo(0);
                e.Handled = true;
                break;
            case VirtualKey.End:
                _viewModel.SeekTo(1);
                e.Handled = true;
                break;
            default:
                base.OnKeyDown(e);
                break;
        }
    }

    private static TextBlock NewPreviewLine(string brushKey) => new()
    {
        FontSize = 11,
        FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
        Foreground = ChartBrushes.Resolve(brushKey),
        Visibility = Visibility.Collapsed,
    };

    private Border BuildPreview()
    {
        _previewStack.Children.Add(_previewTime);
        _previewStack.Children.Add(_previewSpeed);
        _previewStack.Children.Add(_previewPower);
        _previewStack.Children.Add(_previewSoc);
        _previewStack.Children.Add(_previewElevation);

        var preview = new Border
        {
            Background = ChartBrushes.Surface,
            BorderBrush = ChartBrushes.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(10, 6, 10, 6),
            Visibility = Visibility.Collapsed,
            Child = _previewStack,
        };
        AutomationProperties.SetAccessibilityView(preview, AccessibilityView.Raw);
        return preview;
    }

    private void BuildTree()
    {
        _groove.Fill = ChartBrushes.Border;
        _buffered.Fill = ChartBrushes.TextMuted;
        _fill.Fill = ChartBrushes.Resolve("TsColorAccentBrush");
        _ghost.Fill = ChartBrushes.TextMuted;
        _thumb.Fill = ChartBrushes.TextPrimary;
        _thumb.Stroke = ChartBrushes.Resolve("TsColorAccentBrush");
        _thumb.StrokeThickness = 0;

        _surface.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _surface.Children.Add(_backgroundHost);
        _surface.Children.Add(_groove);
        _surface.Children.Add(_buffered);
        _surface.Children.Add(_fill);
        _surface.Children.Add(_ghost);
        _surface.Children.Add(_thumb);

        _overlay.Children.Add(_preview);

        _root.Children.Add(_surface);
        _root.Children.Add(_overlay);

        _surface.SizeChanged += OnSurfaceSizeChanged;
        _surface.PointerPressed += OnPointerPressedTrack;
        _surface.PointerMoved += OnPointerMovedTrack;
        _surface.PointerReleased += OnPointerReleasedTrack;
        _surface.PointerExited += OnPointerExitedTrack;
        _surface.PointerCanceled += OnPointerCanceledTrack;
        _surface.PointerCaptureLost += OnPointerCanceledTrack;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _diagnostics.RecordViewOpened();
        }

        _reduce = MotionPreference.ReduceMotion;
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
        {
            _motionSubscription ??= MotionPreference.Observe(_dispatcher, OnReduceMotionChanged);
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnReduceMotionChanged(bool reduce)
    {
        _reduce = reduce;
        ScheduleRender();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private double TrackWidth => _surface.ActualWidth > 0 ? _surface.ActualWidth : _surface.Width;

    private double NormalizedAt(PointerRoutedEventArgs e)
    {
        double x = e.GetCurrentPoint(_surface).Position.X;
        return TimelineScrubberMath.NormalizedFromX(x, 0, TrackWidth);
    }

    private void OnSurfaceSizeChanged(object sender, SizeChangedEventArgs e)
    {
        _overlay.Width = e.NewSize.Width;
        Render();
    }

    private void OnPointerPressedTrack(object sender, PointerRoutedEventArgs e)
    {
        var point = e.GetCurrentPoint(_surface);
        if (point.Properties.IsRightButtonPressed || point.Properties.IsMiddleButtonPressed)
        {
            return;
        }

        Focus(FocusState.Pointer);
        _viewModel.BeginScrub(NormalizedAt(e));
        _surface.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void OnPointerMovedTrack(object sender, PointerRoutedEventArgs e)
    {
        if (_viewModel.IsDragging)
        {
            _viewModel.Scrub(NormalizedAt(e));
        }
        else
        {
            _viewModel.Hover(NormalizedAt(e));
        }
    }

    private void OnPointerReleasedTrack(object sender, PointerRoutedEventArgs e)
    {
        if (_viewModel.IsDragging)
        {
            _viewModel.EndScrub(NormalizedAt(e));
            _surface.ReleasePointerCapture(e.Pointer);
            e.Handled = true;
        }
    }

    private void OnPointerExitedTrack(object sender, PointerRoutedEventArgs e) => _viewModel.EndHover();

    private void OnPointerCanceledTrack(object sender, PointerRoutedEventArgs e) => _viewModel.CancelScrub();

    private void OnMarkerClick(TimelineMarker marker) => _viewModel.SeekToMarker(marker);

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
        double width = TrackWidth;

        AutomationProperties.SetName(this, _viewModel.AccessibleName);
        AutomationProperties.SetHelpText(this, _viewModel.AriaValueText ?? string.Empty);

        if (double.IsNaN(width) || width <= 0)
        {
            return;
        }

        LayoutGroove(width);
        LayoutBuffered(width);
        LayoutFill(width);
        LayoutMarkers(width);
        LayoutGhost(width);
        LayoutThumb(width);
        LayoutPreview(width);
    }

    private void LayoutGroove(double width)
    {
        _backgroundHost.Width = width;
        _backgroundHost.Height = TrackHeight - 8;
        Canvas.SetLeft(_backgroundHost, 0);
        Canvas.SetTop(_backgroundHost, 4);

        _groove.Width = width;
        Canvas.SetLeft(_groove, 0);
        Canvas.SetTop(_groove, TrackCenterY - (GrooveHeight / 2));
    }

    private void LayoutBuffered(double width)
    {
        if (_viewModel.BufferedPercent is { } bufferedPercent)
        {
            _buffered.Width = Math.Max(0, width * bufferedPercent / 100);
            _buffered.Visibility = Visibility.Visible;
            Canvas.SetLeft(_buffered, 0);
            Canvas.SetTop(_buffered, TrackCenterY - (GrooveHeight / 2));
        }
        else
        {
            _buffered.Visibility = Visibility.Collapsed;
        }
    }

    private void LayoutFill(double width)
    {
        _fill.Width = Math.Max(0, width * _viewModel.PlayheadPercent / 100);
        Canvas.SetLeft(_fill, 0);
        Canvas.SetTop(_fill, TrackCenterY - (GrooveHeight / 2));
    }

    private void LayoutMarkers(double width)
    {
        if (_markersDirty)
        {
            RebuildMarkers();
            _markersDirty = false;
        }

        IReadOnlyList<TimelineMarker> markers = _viewModel.Markers;
        for (int i = 0; i < _markerButtons.Count && i < markers.Count; i++)
        {
            double center = width * markers[i].At;
            Canvas.SetLeft(_markerButtons[i], center - (MarkerHitWidth / 2));
            Canvas.SetTop(_markerButtons[i], TrackCenterY - (MarkerHeight / 2));
        }
    }

    private void RebuildMarkers()
    {
        foreach (Button existing in _markerButtons)
        {
            existing.Click -= OnMarkerButtonClick;
            _surface.Children.Remove(existing);
        }

        _markerButtons.Clear();

        foreach (TimelineMarker marker in _viewModel.Markers)
        {
            Button button = BuildMarkerButton(marker);
            _markerButtons.Add(button);
            _surface.Children.Add(button);
        }
    }

    private Button BuildMarkerButton(TimelineMarker marker)
    {
        var tick = new Rectangle
        {
            Width = MarkerTickWidth,
            Height = MarkerHeight,
            RadiusX = 1,
            RadiusY = 1,
            Fill = ChartBrushes.Resolve(TimelineMarkerKinds.BrushKey(marker.Kind)),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        FrameworkElement content = tick;
        if (marker.ShowCountBadge)
        {
            var stack = new Grid { Width = MarkerHitWidth };
            var badge = new TextBlock
            {
                Text = marker.Count!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
                FontSize = 8,
                FontFamily = TypographyTokens.Mono ?? new FontFamily("Consolas"),
                Foreground = ChartBrushes.TextPrimary,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Top,
            };
            stack.Children.Add(tick);
            stack.Children.Add(badge);
            content = stack;
        }

        var button = new Button
        {
            Width = MarkerHitWidth,
            Height = MarkerHeight,
            Padding = new Thickness(0),
            BorderThickness = new Thickness(0),
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            Content = content,
            Tag = marker,
        };
        AutomationProperties.SetName(button, _viewModel.MarkerAccessibleName(marker));
        ToolTipService.SetToolTip(button, TimelineScrubberMath.MarkerTooltip(marker));
        button.Click += OnMarkerButtonClick;
        return button;
    }

    private void OnMarkerButtonClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: TimelineMarker marker })
        {
            OnMarkerClick(marker);
        }
    }

    private void LayoutGhost(double width)
    {
        if (_viewModel.ShowGhost)
        {
            _ghost.Visibility = Visibility.Visible;
            Canvas.SetLeft(_ghost, (width * _viewModel.PreviewPercent / 100) - 0.5);
            Canvas.SetTop(_ghost, TrackCenterY - (MarkerHeight / 2));
        }
        else
        {
            _ghost.Visibility = Visibility.Collapsed;
        }
    }

    private void LayoutThumb(double width)
    {
        double size = _viewModel.IsDragging ? ThumbDragSize : ThumbSize;
        _thumb.Width = size;
        _thumb.Height = size;
        _thumb.StrokeThickness = _viewModel.IsDragging ? 2 : 0;
        Canvas.SetLeft(_thumb, (width * _viewModel.PlayheadPercent / 100) - (size / 2));
        Canvas.SetTop(_thumb, TrackCenterY - (size / 2));
    }

    private void LayoutPreview(double width)
    {
        if (!_viewModel.ShowPreview)
        {
            _preview.Visibility = Visibility.Collapsed;
            return;
        }

        bool wasHidden = _preview.Visibility == Visibility.Collapsed;

        SetPreviewLine(_previewTime, _viewModel.PreviewTimeText);
        TimelinePreviewPoint? sample = _viewModel.HoverPreview;
        SetPreviewLine(_previewSpeed, sample?.Speed);
        SetPreviewLine(_previewPower, sample?.Power);
        SetPreviewLine(_previewSoc, sample?.Soc);
        SetPreviewLine(_previewElevation, sample?.Elevation);

        _preview.Visibility = Visibility.Visible;
        _preview.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        double tipWidth = _preview.DesiredSize.Width;
        double tipHeight = _preview.DesiredSize.Height;

        double center = width * _viewModel.PreviewPercent / 100;
        double left = Math.Clamp(center - (tipWidth / 2), 0, Math.Max(0, width - tipWidth));
        Canvas.SetLeft(_preview, left);
        Canvas.SetTop(_preview, -(tipHeight + 6));

        if (wasHidden)
        {
            PlayPreviewEntrance();
        }
    }

    private static void SetPreviewLine(TextBlock line, string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            line.Visibility = Visibility.Collapsed;
            line.Text = string.Empty;
        }
        else
        {
            line.Text = text;
            line.Visibility = Visibility.Visible;
        }
    }

    private void PlayPreviewEntrance()
    {
        int durationMs = MotionDuration.Resolve(_reduce, (int)PreviewFadeMs);
        if (durationMs <= 0)
        {
            _preview.Opacity = 1;
            return;
        }

        var animation = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = new Duration(TimeSpan.FromMilliseconds(durationMs)),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(animation, _preview);
        Storyboard.SetTargetProperty(animation, "Opacity");
        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        storyboard.Begin();
    }

    private sealed class TimelineScrubberAutomationPeer : FrameworkElementAutomationPeer, IRangeValueProvider
    {
        public TimelineScrubberAutomationPeer(TimelineScrubber owner)
            : base(owner)
        {
        }

        public bool IsReadOnly => false;

        public double LargeChange => 10;

        public double Maximum => 100;

        public double Minimum => 0;

        public double SmallChange => 1;

        public double Value => Vm.AriaValueNow;

        private TimelineScrubberViewModel Vm => ((TimelineScrubber)Owner).ViewModel;

        public void SetValue(double value) => Vm.SeekTo(value / 100.0);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Slider;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.RangeValue ? this : base.GetPatternCore(patternInterface);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Vm.AccessibleName : name;
        }
    }
}
