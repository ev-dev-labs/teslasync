using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Kiosk Overlay surface — a parity port of
/// web/src/features/dashboard/components/KioskOverlay.tsx. It reproduces the web component's screen-filling,
/// mostly click-through chrome: a black burn-in dim layer (opacity <c>1 - dimLevel</c>), an auto-hide of the
/// mouse cursor, a corner-anchored clock (locale time over weekday+short date, ticking once a second), a
/// bottom-centred row of dashboard-rotation dots (the active dashboard's dot wider), and a top-right exit
/// affordance that fades in on pointer activity and raises <see cref="ExitRequested"/> (web <c>onExit</c>).
/// Only the exit control is interactive; every other layer is hit-test invisible so input passes through to the
/// dashboard beneath, exactly as the web layers are <c>pointer-events-none</c>. All data flows through the
/// shared <see cref="KioskOverlayViewModel"/> (which binds the i18n + date-format ports); the view performs no
/// HTTP and the web component fetches none, so there are no loading / error / offline / stale data states to
/// render — only the conditional overlay layers, each reproduced. Every string resolves through the i18n
/// facade, the exit control carries a Narrator name, the clock exposes its reading to Narrator, font sizes
/// scale with the system text-scaling setting, and the fade is an instant opacity change (no storyboard) so the
/// system reduced-motion preference is honoured by construction.
/// </summary>
public sealed partial class KioskOverlay : ContentControl, IDisposable
{
    private const double EdgeMargin = 16;       // web clock corners: top-4 / left-4 (16px)
    private const double ExitMargin = 12;       // web exit container: top-3 / right-3 (12px)
    private const double DotHeight = 6;         // web h-1.5
    private const double DotActiveWidth = 24;   // web w-6
    private const double DotInactiveWidth = 6;  // web w-1.5
    private const double DotSpacing = 6;        // web gap-1.5
    private const double ClockTimeFontSize = 24;
    private const double ClockDateFontSize = 12;
    private const int ClockTickMs = 1000;       // web setInterval(…, 1000)
    private const int ExitHintSeconds = 3;      // web setTimeout(…, 3000)

    private readonly KioskOverlayViewModel _viewModel;
    private readonly KioskOverlayDiagnostics _diagnostics;
    private readonly IKioskCursorController _cursor;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Rectangle _dimLayer = new();
    private readonly StackPanel _clockPanel = new();
    private readonly TextBlock _clockTime = new();
    private readonly TextBlock _clockDate = new();
    private readonly StackPanel _dotsPanel = new();
    private readonly Grid _exitContainer = new();
    private readonly TsButton _exitButton = new();

    private DispatcherQueueTimer? _clockTimer;
    private DispatcherQueueTimer? _exitHintTimer;
    private UIElement? _pointerRoot;
    private PointerEventHandler? _pointerHandler;

    private bool _showExit;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its localizer, an optional initial input snapshot, diagnostics, clock and cursor seam.</summary>
    public KioskOverlay(
        ILocalizer localizer,
        KioskOverlayInputs? inputs = null,
        KioskOverlayDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null,
        IKioskCursorController? cursor = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new KioskOverlayDiagnostics();
        _cursor = cursor ?? new KioskCursorController(KioskCursorNative.SetHidden);
        _viewModel = new KioskOverlayViewModel(localizer, inputs, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildVisualTree();
        Content = _root;

        AutomationProperties.SetLandmarkType(_root, AutomationLandmarkType.Custom);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        ApplyPresentation(_viewModel.Presentation);
    }

    /// <summary>Raised when the user activates the exit affordance (web <c>onExit</c>).</summary>
    public event EventHandler? ExitRequested;

    /// <summary>The canonical diagnostics slug this surface reports under (<c>KioskOverlay</c>).</summary>
    public static string Slug => KioskOverlayRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public KioskOverlayViewModel ViewModel => _viewModel;

    /// <summary>Replace the whole input snapshot (web props change) and repaint.</summary>
    public void UpdateInputs(KioskOverlayInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        _viewModel.Update(inputs);
    }

    /// <summary>Replace the active configuration (web <c>config</c> prop) and repaint.</summary>
    public void SetConfig(KioskOverlayConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        _viewModel.SetConfig(config);
    }

    /// <summary>Set the burn-in dim flag (web <c>isDimmed</c> prop) and repaint.</summary>
    public void SetDimmed(bool isDimmed) => _viewModel.SetDimmed(isDimmed);

    /// <summary>Set the cursor-auto-hide flag (web <c>isCursorHidden</c> prop) and repaint.</summary>
    public void SetCursorHidden(bool isCursorHidden) => _viewModel.SetCursorHidden(isCursorHidden);

    /// <summary>Set the dashboard rotation position (web <c>dashboardCount</c> / <c>currentIndex</c>) and repaint.</summary>
    public void SetRotation(int dashboardCount, int currentIndex) =>
        _viewModel.SetRotation(dashboardCount, currentIndex);

    /// <summary>Re-resolve every label after the active language changes and repaint (react-i18next parity).</summary>
    public void Reload() => _viewModel.Reload();

    /// <summary>Detach from the view-model, stop timers, restore the cursor and pointer hooks (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _exitButton.Click -= OnExitClick;

        StopTimer(ref _clockTimer, OnClockTick);
        StopTimer(ref _exitHintTimer, OnExitHintElapsed);
        DetachPointerHint();
        _cursor.SetCursorHidden(false);

        GC.SuppressFinalize(this);
    }

    private void BuildVisualTree()
    {
        _dimLayer.Fill = new SolidColorBrush(Colors.Black);
        _dimLayer.IsHitTestVisible = false;
        _dimLayer.HorizontalAlignment = HorizontalAlignment.Stretch;
        _dimLayer.VerticalAlignment = VerticalAlignment.Stretch;
        _dimLayer.Visibility = Visibility.Collapsed;
        AutomationProperties.SetAccessibilityView(_dimLayer, AccessibilityView.Raw);

        _clockTime.FontSize = ClockTimeFontSize;
        _clockTime.Foreground = DisplayTokens.TextMuted;
        _clockTime.IsTextScaleFactorEnabled = true;

        _clockDate.FontSize = ClockDateFontSize;
        _clockDate.Foreground = DisplayTokens.TextMuted;
        _clockDate.IsTextScaleFactorEnabled = true;

        _clockPanel.IsHitTestVisible = false;
        _clockPanel.Margin = new Thickness(EdgeMargin);
        _clockPanel.Visibility = Visibility.Collapsed;
        _clockPanel.Children.Add(_clockTime);
        _clockPanel.Children.Add(_clockDate);

        _dotsPanel.Orientation = Orientation.Horizontal;
        _dotsPanel.Spacing = DotSpacing;
        _dotsPanel.HorizontalAlignment = HorizontalAlignment.Center;
        _dotsPanel.VerticalAlignment = VerticalAlignment.Bottom;
        _dotsPanel.Margin = new Thickness(0, 0, 0, EdgeMargin);
        _dotsPanel.IsHitTestVisible = false;
        _dotsPanel.Visibility = Visibility.Collapsed;
        AutomationProperties.SetAccessibilityView(_dotsPanel, AccessibilityView.Raw);

        _exitButton.Variant = ButtonVariant.Subtle;
        _exitButton.Size = ControlSize.Small;
        _exitButton.IconGlyph = KioskOverlayRegistration.ExitGlyph;
        _exitButton.Click += OnExitClick;

        _exitContainer.HorizontalAlignment = HorizontalAlignment.Right;
        _exitContainer.VerticalAlignment = VerticalAlignment.Top;
        _exitContainer.Margin = new Thickness(ExitMargin);
        _exitContainer.Opacity = 0;
        _exitContainer.Children.Add(_exitButton);

        _root.Children.Add(_dimLayer);
        _root.Children.Add(_clockPanel);
        _root.Children.Add(_dotsPanel);
        _root.Children.Add(_exitContainer);
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is null or nameof(KioskOverlayViewModel.Presentation))
        {
            ApplyPresentation(_viewModel.Presentation);
        }
    }

    private void ApplyPresentation(KioskOverlayPresentation presentation)
    {
        _dimLayer.Visibility = presentation.ShowDim ? Visibility.Visible : Visibility.Collapsed;
        _dimLayer.Opacity = presentation.DimOpacity;

        _cursor.SetCursorHidden(presentation.HideCursor);

        if (presentation.ShowClock && presentation.Clock is { } clock)
        {
            _clockTime.Text = clock.Time;
            _clockDate.Text = clock.DateWithDay;
            ApplyClockCorner(clock.Corner);
            AutomationProperties.SetName(_clockPanel, $"{clock.Time}, {clock.DateWithDay}");
            _clockPanel.Visibility = Visibility.Visible;
        }
        else
        {
            _clockPanel.Visibility = Visibility.Collapsed;
        }

        if (presentation.ShowRotationDots)
        {
            SyncDots(presentation.RotationDots);
            _dotsPanel.Visibility = Visibility.Visible;
        }
        else
        {
            _dotsPanel.Visibility = Visibility.Collapsed;
        }

        _exitButton.Text = presentation.ExitButtonLabel;
        AutomationProperties.SetName(_exitButton, presentation.ExitAriaLabel);
        ToolTipService.SetToolTip(_exitButton, presentation.ExitAriaLabel);

        AutomationProperties.SetName(_root, presentation.RegionName);
        AutomationProperties.SetLocalizedLandmarkType(_root, presentation.RegionName);

        SyncClockTimer(presentation.ShowClock);
    }

    private void ApplyClockCorner(KioskClockCorner corner)
    {
        bool right = corner is KioskClockCorner.TopRight or KioskClockCorner.BottomRight;
        bool bottom = corner is KioskClockCorner.BottomLeft or KioskClockCorner.BottomRight;

        _clockPanel.HorizontalAlignment = right ? HorizontalAlignment.Right : HorizontalAlignment.Left;
        _clockPanel.VerticalAlignment = bottom ? VerticalAlignment.Bottom : VerticalAlignment.Top;

        TextAlignment alignment = right ? TextAlignment.Right : TextAlignment.Left;
        _clockTime.TextAlignment = alignment;
        _clockDate.TextAlignment = alignment;
    }

    private void SyncDots(IReadOnlyList<KioskRotationDot> dots)
    {
        if (_dotsPanel.Children.Count != dots.Count)
        {
            _dotsPanel.Children.Clear();
            for (int i = 0; i < dots.Count; i++)
            {
                _dotsPanel.Children.Add(BuildDot(dots[i].IsActive));
            }

            return;
        }

        for (int i = 0; i < dots.Count; i++)
        {
            if (_dotsPanel.Children[i] is Border dot)
            {
                dot.Width = dots[i].IsActive ? DotActiveWidth : DotInactiveWidth;
            }
        }
    }

    private static Border BuildDot(bool active) => new()
    {
        Height = DotHeight,
        Width = active ? DotActiveWidth : DotInactiveWidth,
        CornerRadius = new CornerRadius(DotHeight / 2),
        Background = DisplayTokens.Brush("TsColorTextSecondaryBrush"),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
        AttachPointerHint();
        SyncClockTimer(_viewModel.Presentation.ShowClock);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnExitClick(object sender, RoutedEventArgs e) => ExitRequested?.Invoke(this, EventArgs.Empty);

    // ── Clock tick (web setInterval 1s) ─────────────────────────────────────────────────────────────────

    private void SyncClockTimer(bool shouldRun)
    {
        if (!_opened || _dispatcher is null)
        {
            return;
        }

        if (shouldRun && _clockTimer is null)
        {
            _clockTimer = _dispatcher.CreateTimer();
            _clockTimer.Interval = TimeSpan.FromMilliseconds(ClockTickMs);
            _clockTimer.IsRepeating = true;
            _clockTimer.Tick += OnClockTick;
            _clockTimer.Start();
        }
        else if (!shouldRun && _clockTimer is not null)
        {
            StopTimer(ref _clockTimer, OnClockTick);
        }
    }

    private void OnClockTick(DispatcherQueueTimer sender, object args) => _viewModel.Tick();

    // ── Exit-hint fade (web mousemove/touchstart → 3s) ──────────────────────────────────────────────────

    private void AttachPointerHint()
    {
        if (_pointerHandler is not null)
        {
            return;
        }

        if (XamlRoot?.Content is not UIElement root)
        {
            // No window root to observe — keep the exit affordance permanently reachable (web parity: it is
            // always in the tree and touch-accessible) rather than gating it behind pointer activity.
            SetExitVisible(true);
            return;
        }

        _pointerRoot = root;
        _pointerHandler = OnPointerHint;
        _pointerRoot.AddHandler(PointerMovedEvent, _pointerHandler, handledEventsToo: true);
        _pointerRoot.AddHandler(PointerPressedEvent, _pointerHandler, handledEventsToo: true);
    }

    private void DetachPointerHint()
    {
        if (_pointerRoot is { } root && _pointerHandler is { } handler)
        {
            root.RemoveHandler(PointerMovedEvent, handler);
            root.RemoveHandler(PointerPressedEvent, handler);
        }

        _pointerRoot = null;
        _pointerHandler = null;
    }

    private void OnPointerHint(object sender, PointerRoutedEventArgs e) => ShowExitHint();

    private void ShowExitHint()
    {
        SetExitVisible(true);

        if (_dispatcher is null)
        {
            return;
        }

        _exitHintTimer ??= CreateExitHintTimer();
        _exitHintTimer.Stop();
        _exitHintTimer.Start();
    }

    private DispatcherQueueTimer CreateExitHintTimer()
    {
        DispatcherQueueTimer timer = _dispatcher!.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(ExitHintSeconds);
        timer.IsRepeating = false;
        timer.Tick += OnExitHintElapsed;
        return timer;
    }

    private void OnExitHintElapsed(DispatcherQueueTimer sender, object args)
    {
        sender.Stop();
        SetExitVisible(false);
    }

    private void SetExitVisible(bool visible)
    {
        if (_showExit == visible)
        {
            return;
        }

        _showExit = visible;
        _exitContainer.Opacity = visible ? 1 : 0;
    }

    private static void StopTimer(ref DispatcherQueueTimer? timer, TypedEventHandler<DispatcherQueueTimer, object> handler)
    {
        if (timer is null)
        {
            return;
        }

        timer.Stop();
        timer.Tick -= handler;
        timer = null;
    }
}

/// <summary>
/// The native cursor-visibility effect for <see cref="KioskOverlay"/> — the canonical kiosk technique of
/// toggling the Win32 cursor display count (<c>ShowCursor</c>). It is driven only through the idempotent
/// <see cref="KioskCursorController"/>, which calls it once per real transition so the global display counter
/// stays balanced. Kept out of the headless-tested logic file so the test project never links Win32.
/// </summary>
internal static partial class KioskCursorNative
{
    /// <summary>Hide (<paramref name="hidden"/> true) or show the system mouse cursor.</summary>
    public static void SetHidden(bool hidden) => _ = ShowCursor(!hidden);

    [LibraryImport("user32.dll")]
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    private static partial int ShowCursor([MarshalAs(UnmanagedType.Bool)] bool bShow);
}
