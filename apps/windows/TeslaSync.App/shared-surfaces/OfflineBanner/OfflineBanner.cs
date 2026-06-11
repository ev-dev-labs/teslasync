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

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>OfflineBanner</c> shared surface — a parity port of the web <c>OfflineBanner</c> export
/// (web/src/components/feedback/OfflineBanner.tsx L22-44). It is the small, non-blocking "you're offline" notice:
/// a warning-tinted card (the native analogue of the web <c>AlertBanner variant="warning"</c>) carrying a Segoe
/// Fluent "offline" glyph (standing in for the web Lucide <c>WifiOff</c>), the localized "You're offline" title,
/// and the "Showing cached data…" body. It binds the <see cref="OfflineBannerViewModel"/> (over the P1/S8
/// <see cref="IOnlineStatusSource"/>) and is shown only while the device is offline (the web
/// <c>if (online) return null</c> gate); it auto-hides the moment connectivity returns — there is no dismiss
/// affordance (the web banner has none). When the state moves it slides in / out with a height + opacity
/// transition, snapping to the final state under the OS reduce-motion preference. To echo the web's
/// bottom-right, <c>max-w-sm</c> placement the card is right-aligned and width-capped; the host pins it into the
/// corner. It is a polite status live region named with the title + body (so Narrator announces the drop), reads
/// no connectivity itself, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class OfflineBanner : ContentControl, IDisposable
{
    private const double IconFontSize = 16;            // web WifiOff h-4 w-4
    private const double TitleFontSize = 14;           // web text-sm
    private const double BodyFontSize = 12;            // web text-xs
    private const double ColumnSpacing = 12;           // web gap-3
    private const double TitleBodySpacing = 2;         // web mt-0.5
    private const double CardPadding = 16;             // web p-4
    private const double CardCornerRadius = 12;        // web rounded-xl
    private const double CardMaxWidth = 384;           // web max-w-sm (24rem)
    private const double OuterPad = 16;                // web fixed inset (bottom/right-4) breathing room
    private const double BorderThicknessPx = 1;        // web border
    private const int TransitionMs = 300;              // web transition-like reveal
    private const double FallbackHeight = 64;          // measurement fallback before first layout

    private readonly OfflineBannerViewModel _viewModel;
    private readonly OfflineBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _card = new()
    {
        Padding = new Thickness(CardPadding),
        Margin = new Thickness(OuterPad),
        BorderThickness = new Thickness(BorderThicknessPx),
        CornerRadius = new CornerRadius(CardCornerRadius),
        MaxWidth = CardMaxWidth,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = OfflineBannerRegistration.WifiOffGlyph,
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = TitleBodySpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        Opacity = OfflineBannerRegistration.BodyForegroundOpacity,
    };

    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds a
    /// static offline source so the surface renders its visible state. Supply an explicit <see cref="ILocalizer"/>
    /// and a bound <see cref="IOnlineStatusSource"/> via the other constructors to drive i18n and connectivity
    /// from the composition root.
    /// </summary>
    public OfflineBanner()
        : this(
            PassthroughLocalizer.Instance,
            new StaticOnlineStatusSource(OnlineStatusSnapshot.Offline),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and a bound connectivity seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the title / body resolve through.</param>
    /// <param name="source">The online-status state-holder seam (web <c>useOnlineStatus()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public OfflineBanner(
        ILocalizer localizer,
        IOnlineStatusSource source,
        OfflineBannerDiagnostics? diagnostics = null)
        : this(new OfflineBannerViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public OfflineBanner(OfflineBannerViewModel viewModel, OfflineBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new OfflineBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

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

        // The icon + body subtree is decorative for navigation; the control's Narrator name (title + body) is
        // authoritative.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, OfflineBannerRegistration.BannerAutomationId);

        // web role="status" aria-live="polite": a polite status live region.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>OfflineBanner</c>).</summary>
    public static string Slug => OfflineBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public OfflineBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the title + body).</summary>
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
    protected override AutomationPeer OnCreateAutomationPeer() => new OfflineBannerAutomationPeer(this);

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

        _title.Text = projection.Title;
        _body.Text = projection.Body;

        var foreground = DisplayTokens.Brush(OfflineBannerRegistration.WarningBrushKey);
        _icon.Foreground = foreground;
        _title.Foreground = foreground;
        _body.Foreground = foreground;
        _card.Background = TintBrush(OfflineBannerRegistration.BannerBackgroundOpacity);
        _card.BorderBrush = TintBrush(OfflineBannerRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        ToolTipService.SetToolTip(this, projection.Body);

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
            : ActualWidth > 0 ? ActualWidth : CardMaxWidth;
        _card.Measure(new Size(width, double.PositiveInfinity));
        var height = _card.DesiredSize.Height;
        return height > 0 ? height : FallbackHeight;
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveWarningColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveWarningColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(OfflineBannerRegistration.WarningColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the warning brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(OfflineBannerRegistration.WarningBrushKey) is SolidColorBrush brush
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

    private sealed class OfflineBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public OfflineBannerAutomationPeer(OfflineBanner owner)
            : base(owner)
        {
        }

        private OfflineBanner Surface => (OfflineBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
