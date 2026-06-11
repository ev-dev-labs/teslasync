using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ServiceStatusBanner</c> shared surface — a parity port of the web
/// <c>ServiceStatusBanner</c> export (web/src/components/data-display/ServiceStatus.tsx L7-41). It is the
/// app-chrome offline strip: a full-width, danger-tinted bar carrying a Segoe Fluent "offline" glyph (standing in
/// for the web Lucide <c>WifiOff</c>) and the localized "You are offline…" message. It binds the
/// <see cref="ServiceStatusBannerViewModel"/> (over the P1/S8 <see cref="IServiceStatusConnectionSource"/>) and
/// is shown only while the device is offline (the web <c>isOffline</c> + <c>AnimatePresence</c> gate); when the
/// connection moves it slides in / out with a height + opacity transition (the web <c>height 0 → auto</c>,
/// <c>opacity 0 → 1</c>, 0.3s), snapping to the final state under the OS reduce-motion preference (the web
/// <c>motion-safe</c> behaviour). It is a polite status live region named with the offline message (so Narrator
/// announces the drop), reads no connectivity itself, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class ServiceStatusBanner : ContentControl, IDisposable
{
    private const double IconFontSize = 14;          // web WifiOff h-3.5 w-3.5
    private const double TextFontSize = 12;          // web text-xs
    private const double RowSpacing = 8;             // web gap-2
    private const double PadH = 16;                  // web px-4
    private const double PadV = 8;                   // web py-2
    private const double BorderThicknessPx = 1;      // web borderBottom 1px
    private const int TransitionMs = 300;            // web transition duration 0.3s
    private const double FallbackHeight = 36;        // measurement fallback before first layout

    private readonly ServiceStatusBannerViewModel _viewModel;
    private readonly ServiceStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _bar = new()
    {
        Padding = new Thickness(PadH, PadV, PadH, PadV),
        BorderThickness = new Thickness(0, 0, 0, BorderThicknessPx),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly StackPanel _content = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = RowSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = ServiceStatusRegistration.WifiOffGlyph,
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _text = new()
    {
        FontSize = TextFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds a
    /// static offline source so the surface renders its visible state. Supply an explicit <see cref="ILocalizer"/>
    /// and a bound <see cref="IServiceStatusConnectionSource"/> via the other constructors to drive i18n and
    /// connectivity from the composition root.
    /// </summary>
    public ServiceStatusBanner()
        : this(
            PassthroughLocalizer.Instance,
            new StaticServiceStatusConnectionSource(ServiceStatusConnectionSnapshot.Offline),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and a bound connection seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the offline message resolves through.</param>
    /// <param name="source">The connection state-holder seam (web <c>onStatusChange</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ServiceStatusBanner(
        ILocalizer localizer,
        IServiceStatusConnectionSource source,
        ServiceStatusDiagnostics? diagnostics = null)
        : this(new ServiceStatusBannerViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ServiceStatusBanner(ServiceStatusBannerViewModel viewModel, ServiceStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ServiceStatusDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);

        _bar.Child = _content;
        _content.Children.Add(_icon);
        _content.Children.Add(_text);
        _root.Children.Add(_bar);

        // The icon + text subtree is decorative; the control's Narrator name (the offline message) is authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_text, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ServiceStatusRegistration.BannerAutomationId);

        // web has no explicit role; the offline strip is surfaced as a polite status live region.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ServiceStatus</c>).</summary>
    public static string Slug => ServiceStatusRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ServiceStatusBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the offline message).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _storyboard?.Stop();
        _storyboard = null;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ServiceStatusBannerAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // Snap to the correct state once layout is valid, then animate subsequent transitions.
        _ready = false;
        ApplyVisualState();
        _ready = true;

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _text.Text = projection.Message;

        var foreground = DisplayTokens.Brush(ServiceStatusRegistration.DangerBrushKey);
        _icon.Foreground = foreground;
        _text.Foreground = foreground;
        _bar.Background = TintBrush(ServiceStatusRegistration.BannerBackgroundOpacity);
        _bar.BorderBrush = TintBrush(ServiceStatusRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        ToolTipService.SetToolTip(this, projection.Message);

        ApplyVisualState();

        if (_ready && projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyVisualState()
    {
        var visible = _viewModel.Projection.IsVisible;

        if (!_ready || _reduceMotion)
        {
            StopStoryboard();
            Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            _root.Height = double.NaN;
            _bar.Opacity = 1;
            return;
        }

        if (visible)
        {
            AnimateIn();
        }
        else
        {
            AnimateOut();
        }
    }

    private void AnimateIn()
    {
        Visibility = Visibility.Visible;
        _bar.Opacity = 0;
        _root.Height = 0;

        var target = MeasureTarget();
        AnimateTo(from: 0, to: target, opacityTo: 1, onComplete: () => _root.Height = double.NaN);
    }

    private void AnimateOut()
    {
        var from = _root.ActualHeight > 0 ? _root.ActualHeight : MeasureTarget();
        _root.Height = from;

        AnimateTo(from: from, to: 0, opacityTo: 0, onComplete: () =>
        {
            Visibility = Visibility.Collapsed;
            _root.Height = double.NaN;
        });
    }

    private void AnimateTo(double from, double to, double opacityTo, Action onComplete)
    {
        StopStoryboard();

        var duration = new Duration(TimeSpan.FromMilliseconds(TransitionMs));
        var storyboard = new Storyboard();

        var height = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = duration,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(height, _root);
        Storyboard.SetTargetProperty(height, "Height");
        storyboard.Children.Add(height);

        var opacity = new DoubleAnimation
        {
            From = _bar.Opacity,
            To = opacityTo,
            Duration = duration,
        };
        Storyboard.SetTarget(opacity, _bar);
        Storyboard.SetTargetProperty(opacity, "Opacity");
        storyboard.Children.Add(opacity);

        storyboard.Completed += (_, _) => onComplete();
        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private double MeasureTarget()
    {
        var width = _root.ActualWidth > 0
            ? _root.ActualWidth
            : ActualWidth > 0 ? ActualWidth : FallbackHeight * 8;
        _bar.Measure(new Size(width, double.PositiveInfinity));
        var height = _bar.DesiredSize.Height;
        return height > 0 ? height : FallbackHeight;
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveDangerColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveDangerColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(ServiceStatusRegistration.DangerColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the danger brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(ServiceStatusRegistration.DangerBrushKey) is SolidColorBrush brush
            ? brush.Color
            : Microsoft.UI.Colors.Red;
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

    private sealed class ServiceStatusBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public ServiceStatusBannerAutomationPeer(ServiceStatusBanner owner)
            : base(owner)
        {
        }

        private ServiceStatusBanner Surface => (ServiceStatusBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The native WinUI 3 <c>SystemHealthDot</c> shared surface — a parity port of the web <c>SystemHealthDot</c>
/// export (web/src/components/data-display/ServiceStatus.tsx L44-74). It is the compact sidebar health indicator:
/// a small status dot tinted from the bound system-status rollup — healthy → success/green, degraded →
/// warning/amber, anything else → danger/red — wrapped in a soft glow (the web
/// <c>shadow-[0_0_6px_rgba(...,0.5)]</c>). It binds the <see cref="ServiceStatusHealthDotViewModel"/> (over the
/// P1/S8 <see cref="IServiceStatusHealthSource"/>) and is rendered only once a status has resolved (the web
/// <c>if (!data) return null</c> gate). It is a polite status live region whose Narrator name and tooltip are
/// "System: {status}" (the web <c>title</c>), reads no query itself, and emits the <c>view.opened</c> diagnostic
/// once when shown.
/// </summary>
public sealed partial class SystemHealthDot : ContentControl, IDisposable
{
    private const double DotSize = 8;        // web h-2 w-2
    private const double GlowSize = 16;      // web 6px shadow spread around the dot

    private readonly ServiceStatusHealthDotViewModel _viewModel;
    private readonly ServiceStatusDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new()
    {
        Width = GlowSize,
        Height = GlowSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Ellipse _glow = new()
    {
        Width = GlowSize,
        Height = GlowSize,
        Opacity = ServiceStatusRegistration.DotGlowOpacity,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false,
    };

    private readonly Ellipse _dot = new()
    {
        Width = DotSize,
        Height = DotSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the dot with no composition root (the designer / parameterless host entry point): it binds a
    /// static healthy source so the surface renders its visible state. Supply an explicit <see cref="ILocalizer"/>
    /// and a bound <see cref="IServiceStatusHealthSource"/> via the other constructors to drive i18n and data from
    /// the composition root.
    /// </summary>
    public SystemHealthDot()
        : this(
            PassthroughLocalizer.Instance,
            new StaticServiceStatusHealthSource(new ServiceStatusHealthSnapshot(ServiceStatusRegistration.HealthyToken)),
            diagnostics: null)
    {
    }

    /// <summary>Creates the dot over the i18n facade and a bound health seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the tooltip resolves through.</param>
    /// <param name="source">The system-health state-holder seam (web query result).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SystemHealthDot(
        ILocalizer localizer,
        IServiceStatusHealthSource source,
        ServiceStatusDiagnostics? diagnostics = null)
        : this(new ServiceStatusHealthDotViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the dot over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SystemHealthDot(ServiceStatusHealthDotViewModel viewModel, ServiceStatusDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ServiceStatusDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Center;
        Padding = new Thickness(0);

        _root.Children.Add(_glow);
        _root.Children.Add(_dot);

        // The glow is decorative; the control's Narrator name ("System: {status}") is authoritative.
        AutomationProperties.SetAccessibilityView(_glow, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ServiceStatusRegistration.HealthDotAutomationId);
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ServiceStatus</c>).</summary>
    public static string Slug => ServiceStatusRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ServiceStatusHealthDotViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (web <c>title</c>).</summary>
    internal string AccessibleName => _viewModel.Tooltip;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SystemHealthDotAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        // web: if (!data) return null — the dot is not rendered until a status resolves.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (!projection.IsVisible)
        {
            return;
        }

        var accent = DisplayTokens.Brush(projection.AccentBrushKey);
        _dot.Fill = accent;
        _glow.Fill = accent;

        AutomationProperties.SetName(this, projection.AccessibleName);
        ToolTipService.SetToolTip(this, projection.Tooltip);

        if (IsLoaded)
        {
            LiveRegion.Announce(this);
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

    private sealed class SystemHealthDotAutomationPeer : FrameworkElementAutomationPeer
    {
        public SystemHealthDotAutomationPeer(SystemHealthDot owner)
            : base(owner)
        {
        }

        private SystemHealthDot Surface => (SystemHealthDot)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
