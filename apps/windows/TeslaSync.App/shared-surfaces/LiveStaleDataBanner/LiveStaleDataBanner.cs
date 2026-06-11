using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>LiveStaleDataBanner</c> shared surface — a parity port of
/// web/src/components/feedback/LiveStaleDataBanner.tsx. It is the page-level companion to the <c>LiveIndicator</c>
/// pill: a warning-tinted card (the native analogue of the web <c>&lt;AlertBanner variant="warning"&gt;</c>)
/// carrying a Segoe Fluent "offline" glyph (standing in for the web Lucide <c>WifiOff</c>), the localized
/// "Live data unavailable" title and the "values may be stale" message, shown only once the live-data pipeline has
/// been continuously <c>disconnected</c> for longer than two minutes (the web <c>STALE_BANNER_THRESHOLD_MS</c>
/// sustained-disconnection debounce). It binds the <see cref="LiveStaleDataBannerViewModel"/> (over the P1/S8
/// <see cref="ILiveStaleDataBannerSource"/> <c>useLiveConnection</c> seam) and drives a one-shot wake timer off the
/// view-model's <see cref="LiveStaleDataBannerViewModel.RetryAfter"/> (the web <c>setTimeout</c>) so the banner
/// promotes to shown without any further wire traffic; any non-disconnected status clears the timer and collapses
/// it. When the state moves it slides in / out with a height + opacity transition, snapping to the final state under
/// the OS reduce-motion preference. It is a polite status live region named with the title + message (so Narrator
/// announces the warning), opens no stream itself, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class LiveStaleDataBanner : ContentControl, IDisposable
{
    private const double IconFontSize = 20;             // web WifiOff h-5 w-5
    private const double TitleFontSize = 14;            // web text-sm
    private const double BodyFontSize = 12;             // web text-xs
    private const double ColumnSpacing = 12;            // web gap-3
    private const double TitleBodySpacing = 2;          // web mt-0.5
    private const double CardPadding = 16;              // web p-4
    private const double CardCornerRadius = 12;         // web rounded-xl
    private const double BorderThicknessPx = 1;         // web border
    private const double BodyForegroundOpacity = 0.80;  // web text-neon-amber/80
    private const int TransitionMs = 300;               // web transition-like reveal
    private const double FallbackHeight = 64;           // measurement fallback before first layout

    private readonly LiveStaleDataBannerViewModel _viewModel;
    private readonly LiveStaleDataBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _card = new()
    {
        Padding = new Thickness(CardPadding),
        BorderThickness = new Thickness(BorderThicknessPx),
        CornerRadius = new CornerRadius(CardCornerRadius),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Top,
        Glyph = LiveStaleDataBannerRegistration.WifiOffGlyph,
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = TitleBodySpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        Opacity = BodyForegroundOpacity,
    };

    private Storyboard? _storyboard;
    private DispatcherQueueTimer? _retryTimer;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds the
    /// passthrough localizer and an unknown <see cref="StaticLiveStaleDataBannerSource"/>, so the surface renders
    /// collapsed (exactly as the web banner is hidden until the pipe has been disconnected for two minutes). Supply
    /// an explicit <see cref="ILocalizer"/> and a bound <see cref="ILiveStaleDataBannerSource"/> via the other
    /// constructors to drive i18n and the live status from the composition root.
    /// </summary>
    public LiveStaleDataBanner()
        : this(PassthroughLocalizer.Instance, new StaticLiveStaleDataBannerSource(), diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and a bound live-connection seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the title / message resolve through.</param>
    /// <param name="source">The live-connection state-holder seam (web <c>useLiveConnection</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveStaleDataBanner(
        ILocalizer localizer,
        ILiveStaleDataBannerSource source,
        LiveStaleDataBannerDiagnostics? diagnostics = null)
        : this(new LiveStaleDataBannerViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveStaleDataBanner(LiveStaleDataBannerViewModel viewModel, LiveStaleDataBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new LiveStaleDataBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);

        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_textColumn, 1);

        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_body);

        _content.Children.Add(_icon);
        _content.Children.Add(_textColumn);
        _card.Child = _content;
        _root.Children.Add(_card);

        // The icon subtree is decorative for navigation; the control's Narrator name (title + message) is authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, LiveStaleDataBannerRegistration.RootAutomationId);

        // web companion role="status" aria-live="polite": a polite status live region.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>LiveStaleDataBanner</c>).</summary>
    public static string Slug => LiveStaleDataBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public LiveStaleDataBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the title + message).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopStoryboard();
        if (_retryTimer is { } timer)
        {
            timer.Stop();
            _retryTimer = null;
        }

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LiveStaleDataBannerAutomationPeer(this);

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

        ScheduleRetry();

        if (_viewModel.IsVisible)
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

        _icon.Glyph = projection.IconGlyph;
        _title.Text = projection.Title;
        _body.Text = projection.Message;

        var foreground = DisplayTokens.Brush(LiveStaleDataBannerRegistration.WarningBrushKey);
        _icon.Foreground = foreground;
        _title.Foreground = foreground;
        _body.Foreground = foreground;
        _card.Background = TintBrush(LiveStaleDataBannerRegistration.BannerBackgroundOpacity);
        _card.BorderBrush = TintBrush(LiveStaleDataBannerRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);

        ApplyVisualState();
        ScheduleRetry();

        if (_ready && projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ScheduleRetry()
    {
        _retryTimer?.Stop();
        _retryTimer = null;

        var retry = _viewModel.RetryAfter;
        if (retry is null || _dispatcher is null)
        {
            return;
        }

        // web: window.setTimeout(() => setShow(true), THRESHOLD - elapsed + 50) — a single one-shot wake.
        var interval = retry.Value <= TimeSpan.Zero ? TimeSpan.FromMilliseconds(1) : retry.Value;
        var timer = _dispatcher.CreateTimer();
        timer.Interval = interval;
        timer.IsRepeating = false;
        timer.Tick += (t, _) =>
        {
            t.Stop();
            if (!_disposed)
            {
                _viewModel.NotifyTimeElapsed();
            }
        };
        timer.Start();
        _retryTimer = timer;
    }

    private void ApplyVisualState()
    {
        var visible = _viewModel.IsVisible;

        if (!_ready || _reduceMotion)
        {
            StopStoryboard();
            Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            _root.Height = double.NaN;
            _card.Opacity = 1;
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
        _card.Opacity = 0;
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
            From = _card.Opacity,
            To = opacityTo,
            Duration = duration,
        };
        Storyboard.SetTarget(opacity, _card);
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
        _card.Measure(new Size(width, double.PositiveInfinity));
        var height = _card.DesiredSize.Height;
        return height > 0 ? height : FallbackHeight;
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveWarningColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveWarningColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(LiveStaleDataBannerRegistration.WarningColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the warning brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(LiveStaleDataBannerRegistration.WarningBrushKey) is SolidColorBrush brush
            ? brush.Color
            : Microsoft.UI.Colors.Orange;
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

    private sealed class LiveStaleDataBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public LiveStaleDataBannerAutomationPeer(LiveStaleDataBanner owner)
            : base(owner)
        {
        }

        private LiveStaleDataBanner Surface => (LiveStaleDataBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
