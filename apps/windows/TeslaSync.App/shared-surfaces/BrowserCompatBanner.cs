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
using Windows.Foundation.Collections;
using Windows.Storage;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>BrowserCompatBanner</c> shared surface — a parity port of the web
/// <c>BrowserCompatBanner</c> export (web/src/components/feedback/BrowserCompatBanner.tsx L46-101). It is the
/// app-chrome "unsupported environment" notice: a warning-tinted card (the native analogue of the web
/// <c>AlertBanner variant="warning"</c>) carrying a Segoe Fluent warning glyph (standing in for the web Lucide
/// <c>AlertTriangle</c>), the localized "Your browser is missing required features" title, the body listing the
/// missing capabilities + the recommended environment, and a dismiss button. It binds the
/// <see cref="BrowserCompatBannerViewModel"/> (over the P1/S8 <see cref="IBrowserCompatSource"/> +
/// <see cref="IBrowserCompatDismissalStore"/>) and is shown only when detection found a missing required capability
/// AND the user has not dismissed it (the web <c>dismissed || missing.length === 0</c> early return). When the
/// state moves it slides in / out with a height + opacity transition, snapping to the final state under the OS
/// reduce-motion preference. It is a polite status live region named with the title + body (so Narrator announces
/// the warning), probes no host capability itself, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class BrowserCompatBanner : ContentControl, IDisposable
{
    private const double IconFontSize = 16;          // web AlertTriangle h-4 w-4
    private const double TitleFontSize = 14;         // web text-sm
    private const double BodyFontSize = 12;          // web text-xs
    private const double ColumnSpacing = 12;         // web gap-3
    private const double TitleBodySpacing = 2;       // web mt-0.5
    private const double CardPadding = 16;           // web p-4
    private const double CardCornerRadius = 12;      // web rounded-xl
    private const double OuterPadH = 16;             // web px-4 sticky wrapper
    private const double OuterPadV = 8;              // web py-2 sticky wrapper
    private const double BorderThicknessPx = 1;      // web border
    private const double DismissGlyphSize = 12;      // web X h-3.5 w-3.5
    private const double BodyForegroundOpacity = 0.85; // web text-neon-amber/80
    private const int TransitionMs = 300;            // web transition-like reveal
    private const double FallbackHeight = 64;        // measurement fallback before first layout
    private const string DismissGlyph = "\uE711";    // Segoe Fluent ChromeClose (web Lucide X)

    private readonly BrowserCompatBannerViewModel _viewModel;
    private readonly BrowserCompatDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _card = new()
    {
        Padding = new Thickness(CardPadding),
        Margin = new Thickness(OuterPadH, OuterPadV, OuterPadH, OuterPadV),
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
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = TitleBodySpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        Opacity = BodyForegroundOpacity,
    };

    private readonly Button _dismiss = new()
    {
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        BorderThickness = new Thickness(0),
        Padding = new Thickness(4),
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly FontIcon _dismissGlyph = new()
    {
        Glyph = DismissGlyph,
        FontSize = DismissGlyphSize,
    };

    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds the
    /// real production seams — <see cref="CapabilityBrowserCompatSource"/> over the default requirement registry
    /// and the <see cref="ApplicationData.LocalSettings"/>-backed dismissal store — so the surface reflects the
    /// genuine host state (collapsed on a healthy host, exactly as the web banner is hidden on a supported
    /// browser). Supply an explicit <see cref="ILocalizer"/> and bound seams via the other constructors to drive
    /// i18n and detection from the composition root.
    /// </summary>
    public BrowserCompatBanner()
        : this(
            PassthroughLocalizer.Instance,
            new CapabilityBrowserCompatSource(),
            new ApplicationDataBrowserCompatDismissalStore(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and bound seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the title / body / dismiss strings resolve through.</param>
    /// <param name="source">The host-capability state-holder seam (web <c>detectMissingFeatures()</c>).</param>
    /// <param name="dismissalStore">The persisted-dismissal seam (web localStorage flag).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BrowserCompatBanner(
        ILocalizer localizer,
        IBrowserCompatSource source,
        IBrowserCompatDismissalStore dismissalStore,
        BrowserCompatDiagnostics? diagnostics = null)
        : this(new BrowserCompatBannerViewModel(localizer, source, dismissalStore), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BrowserCompatBanner(BrowserCompatBannerViewModel viewModel, BrowserCompatDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new BrowserCompatDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);

        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(_dismiss, 2);

        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_body);

        _dismiss.Content = _dismissGlyph;
        _dismiss.Click += OnDismissClick;

        _content.Children.Add(_icon);
        _content.Children.Add(_textColumn);
        _content.Children.Add(_dismiss);
        _card.Child = _content;
        _root.Children.Add(_card);

        // The icon + body subtree is decorative for navigation; the control's Narrator name (title + body) is
        // authoritative, and the dismiss button keeps its own localized name.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, BrowserCompatRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_dismiss, BrowserCompatRegistration.DismissAutomationId);

        // web role="status" aria-live="polite": a polite status live region.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>BrowserCompatBanner</c>).</summary>
    public static string Slug => BrowserCompatRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public BrowserCompatBannerViewModel ViewModel => _viewModel;

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
        _dismiss.Click -= OnDismissClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new BrowserCompatBannerAutomationPeer(this);

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

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _title.Text = projection.Title;
        _body.Text = projection.Body;

        var foreground = DisplayTokens.Brush(BrowserCompatRegistration.WarningBrushKey);
        _icon.Glyph = BrowserCompatRegistration.WarningGlyph;
        _icon.Foreground = foreground;
        _title.Foreground = foreground;
        _body.Foreground = foreground;
        _dismissGlyph.Foreground = foreground;
        _card.Background = TintBrush(BrowserCompatRegistration.BannerBackgroundOpacity);
        _card.BorderBrush = TintBrush(BrowserCompatRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_dismiss, projection.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, projection.DismissLabel);

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
            && resources.TryGetValue(BrowserCompatRegistration.WarningColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the warning brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(BrowserCompatRegistration.WarningBrushKey) is SolidColorBrush brush
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

    private sealed class BrowserCompatBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public BrowserCompatBannerAutomationPeer(BrowserCompatBanner owner)
            : base(owner)
        {
        }

        private BrowserCompatBanner Surface => (BrowserCompatBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The production <see cref="IBrowserCompatDismissalStore"/> — persists the dismissal in the packaged app's
/// <see cref="ApplicationData.LocalSettings"/> under the versioned key the web stores in localStorage
/// (<see cref="BrowserCompatRegistration.DismissalStorageKey"/>), the native analogue of
/// <c>dismissCompatWarning()</c> / <c>isCompatWarningDismissed()</c> (web/src/lib/browserCompat.ts L96-116). Every
/// access is defensive: in unpackaged or first-run contexts the store may be unavailable, in which case a read
/// degrades to "not dismissed" (so the banner reappears) and a write is silently skipped — never throws — exactly
/// as the web wraps localStorage in try/catch. WinUI-free callers never construct this; it lives in the view layer
/// because it depends on <c>Windows.Storage</c>.
/// </summary>
public sealed class ApplicationDataBrowserCompatDismissalStore : IBrowserCompatDismissalStore
{
    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsDismissed
    {
        get
        {
            var values = Values;
            return values is not null
                && values.TryGetValue(BrowserCompatRegistration.DismissalStorageKey, out var stored)
                && stored is string text
                && text == BrowserCompatRegistration.DismissalStorageValue;
        }
    }

    /// <inheritdoc />
    public void Dismiss()
    {
        var values = Values;
        if (values is null)
        {
            // Private-mode / unpackaged equivalent: the acknowledgement cannot be persisted; the banner reappears
            // on relaunch, mirroring the web localStorage-write failure path. Still surface the change so the
            // current view collapses for this session.
            Changed?.Invoke(this, EventArgs.Empty);
            return;
        }

        try
        {
            values[BrowserCompatRegistration.DismissalStorageKey] = BrowserCompatRegistration.DismissalStorageValue;
        }
        catch (Exception)
        {
            // Quota / serialization failure — ignore (web swallows the localStorage write error).
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    private static IPropertySet? Values
    {
        get
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
