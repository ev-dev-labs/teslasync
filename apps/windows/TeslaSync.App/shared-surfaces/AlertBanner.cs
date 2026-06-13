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
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>AlertBanner</c> shared surface — a parity port of the web <c>AlertBanner</c> export
/// (web/src/components/feedback/AlertBanner.tsx). It is the persistent, page-level inline notification primitive
/// (info / success / warning / danger) the rest of the feedback family composes (e.g.
/// <see cref="BrowserCompatBanner"/> is an <c>AlertBanner variant="warning"</c>): an accent-tinted, hairline-bordered
/// card carrying an optional leading Segoe Fluent glyph (the web <c>icon</c> prop), an optional emphasised title
/// (web <c>title</c>), the body message (web <c>children</c>), and — when dismissible (the web <c>onClose</c>) — a
/// trailing dismiss button standing in for the web Lucide <c>X</c>. It binds the <see cref="AlertBannerViewModel"/>
/// over the P1/S8 <see cref="IAlertBannerSource"/> content seam, never fetching data itself: the owning page feeds
/// the resolved alert, exactly as a React parent feeds props, so there is no loading / error / stale / offline
/// chrome here (those live data states belong to the owning page). The only "empty" state is the absence of an
/// alert, which collapses the card; when the alert moves the card slides in / out with a height + opacity
/// transition, snapping to the final state under the OS reduce-motion preference. It is a live region (polite for
/// info / success / warning, assertive for danger) named with the title + body so Narrator announces it, exposes the
/// dismiss control with a localized name, treats the icon as decorative, and emits the <c>view.opened</c> diagnostic
/// once when shown.
/// </summary>
public sealed partial class AlertBanner : ContentControl, IDisposable
{
    private const double IconFontSize = 16;            // web icon ~h-4 w-4
    private const double TitleFontSize = 14;           // web text-sm
    private const double BodyFontSize = 12;            // web text-xs
    private const double ColumnGap = 12;               // web gap-3
    private const double TitleBodySpacing = 2;         // web mt-0.5
    private const double IconTopNudge = 2;             // web icon mt-0.5
    private const double CardPadding = 16;             // web p-4
    private const double CardCornerRadius = 12;        // web rounded-xl
    private const double BorderThicknessPx = 1;        // web border
    private const double DismissPadding = 6;           // web p-1.5
    private const double DismissCornerRadius = 8;      // web rounded-lg
    private const double DismissGlyphSize = 14;        // web X h-3.5 w-3.5
    private const int TransitionMs = 300;              // web transition-like reveal
    private const double FallbackHeight = 64;          // measurement fallback before first layout

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
        ColumnSpacing = 0,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, IconTopNudge, ColumnGap, 0),
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = TitleBodySpacing,
        VerticalAlignment = VerticalAlignment.Top,
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
    };

    private readonly Button _dismiss = new()
    {
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
        BorderThickness = new Thickness(0),
        Padding = new Thickness(DismissPadding),
        CornerRadius = new CornerRadius(DismissCornerRadius),
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(ColumnGap, 0, 0, 0),
    };

    private readonly FontIcon _dismissGlyph = new()
    {
        Glyph = AlertBannerRegistration.DismissGlyph,
        FontSize = DismissGlyphSize,
    };

    private AlertBannerViewModel _viewModel = null!;
    private AlertBannerDiagnostics _diagnostics = null!;
    private StaticAlertBannerSource? _ownedSource;
    private DispatcherQueue? _dispatcher;
    private bool _reduceMotion;
    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds an
    /// empty <see cref="StaticAlertBannerSource"/>, so the surface starts collapsed (no alert) exactly as the web
    /// banner renders nothing until its parent supplies content. Call <see cref="Show"/> to display an alert.
    /// </summary>
    public AlertBanner()
    {
        var owned = new StaticAlertBannerSource();
        Initialize(new AlertBannerViewModel(PassthroughLocalizer.Instance, owned), owned, diagnostics: null);
    }

    /// <summary>Creates the banner seeded with an initial alert over a private content source (a one-line host entry point).</summary>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    /// <param name="model">The initial alert to display (web props).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertBanner(ILocalizer localizer, AlertBannerModel model, AlertBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        var owned = new StaticAlertBannerSource(model);
        Initialize(new AlertBannerViewModel(localizer, owned), owned, diagnostics);
    }

    /// <summary>Creates the banner over the i18n facade and a bound content seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the dismiss label resolves through.</param>
    /// <param name="source">The content state-holder seam (the web parent-owned props).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertBanner(ILocalizer localizer, IAlertBannerSource source, AlertBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        Initialize(new AlertBannerViewModel(localizer, source), source as StaticAlertBannerSource, diagnostics);
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertBanner(AlertBannerViewModel viewModel, AlertBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        Initialize(viewModel, ownedSource: null, diagnostics);
    }

    /// <summary>Raised when the banner is dismissed (the web <c>onClose</c> callback).</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>AlertBanner</c>).</summary>
    public static string Slug => AlertBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AlertBannerViewModel ViewModel => _viewModel;

    /// <summary>The alert currently displayed (null when collapsed). Setting it routes through <see cref="Show"/>.</summary>
    public AlertBannerModel? Model
    {
        get => _viewModel.CurrentModel;
        set => Show(value);
    }

    /// <summary>The composed accessible name the automation peer reports (the title + body).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>
    /// Display an alert (or null to collapse the banner) when the surface owns its content source. Throws when the
    /// banner was constructed over an external <see cref="IAlertBannerSource"/> — update that source instead.
    /// </summary>
    /// <param name="model">The alert to display, or null to collapse.</param>
    public void Show(AlertBannerModel? model)
    {
        if (_ownedSource is null)
        {
            throw new InvalidOperationException(
                "This AlertBanner is bound to an external IAlertBannerSource; update that source to change its content.");
        }

        _ownedSource.Set(model);
    }

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
        _viewModel.Closed -= OnViewModelClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AlertBannerAutomationPeer(this);

    private void Initialize(
        AlertBannerViewModel viewModel,
        StaticAlertBannerSource? ownedSource,
        AlertBannerDiagnostics? diagnostics)
    {
        _viewModel = viewModel;
        _ownedSource = ownedSource;
        _diagnostics = diagnostics ?? new AlertBannerDiagnostics();
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

        // The icon is decorative for navigation; the control's Narrator name (title + body) is authoritative, and
        // the dismiss button keeps its own localized name.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, AlertBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_dismiss, AlertBannerRegistration.DismissAutomationId);

        _viewModel.Closed += OnViewModelClosed;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

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

    private void OnViewModelClosed(object? sender, EventArgs e) => Marshal(() => Closed?.Invoke(this, EventArgs.Empty));

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        AlertBannerProjection projection = _viewModel.Projection;

        Brush accent = DisplayTokens.Brush(projection.AccentBrushKey);

        _title.Text = projection.Title;
        _title.Visibility = projection.HasTitle ? Visibility.Visible : Visibility.Collapsed;
        _title.Foreground = accent;

        _body.Text = projection.Body;
        _body.Foreground = accent;
        _body.Opacity = projection.BodyForegroundOpacity;

        if (projection.HasIcon)
        {
            _icon.Glyph = projection.IconGlyph;
            _icon.Foreground = accent;
            _icon.Visibility = Visibility.Visible;
        }
        else
        {
            _icon.Visibility = Visibility.Collapsed;
        }

        _dismissGlyph.Foreground = accent;
        _dismissGlyph.Opacity = projection.BodyForegroundOpacity;
        _dismiss.Visibility = projection.Dismissible ? Visibility.Visible : Visibility.Collapsed;

        _card.Background = TintBrush(projection, projection.BackgroundOpacity);
        _card.BorderBrush = TintBrush(projection, projection.BorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_dismiss, projection.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, projection.DismissLabel);

        // web info/success/warning are polite status; danger interrupts as an assertive alert.
        LiveRegion.Configure(this, assertive: projection.IsAssertive);

        ApplyVisualState();

        if (_ready && projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyVisualState()
    {
        bool visible = _viewModel.Projection.IsVisible;

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

        double target = MeasureTarget();
        AnimateTo(from: 0, to: target, opacityTo: 1, onComplete: () => _root.Height = double.NaN);
    }

    private void AnimateOut()
    {
        double from = _root.ActualHeight > 0 ? _root.ActualHeight : MeasureTarget();
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
        double width = _root.ActualWidth > 0
            ? _root.ActualWidth
            : ActualWidth > 0 ? ActualWidth : FallbackHeight * 8;
        _card.Measure(new Size(width, double.PositiveInfinity));
        double height = _card.DesiredSize.Height;
        return height > 0 ? height : FallbackHeight;
    }

    private static SolidColorBrush TintBrush(AlertBannerProjection projection, double opacity) =>
        new(AccentColor(projection.AccentBrushKey, projection.Variant)) { Opacity = opacity };

    private static Color AccentColor(string accentKey, CalloutVariant variant)
    {
        if (DisplayTokens.Brush(accentKey) is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush.Color;
        }

        // Token resolution miss (no XAML host / absent resource): fall back to the variant's web accent hue so the
        // tint still reads, mirroring the peer banners' colour fallback.
        return variant switch
        {
            CalloutVariant.Success => Color.FromArgb(0xFF, 0x34, 0xD3, 0x99), // emerald-400
            CalloutVariant.Warning => Color.FromArgb(0xFF, 0xFB, 0xBF, 0x24), // amber-400
            CalloutVariant.Danger => Color.FromArgb(0xFF, 0xFB, 0x71, 0x85),  // rose-400
            _ => Color.FromArgb(0xFF, 0x22, 0xD3, 0xEE),                       // cyan-400 (info)
        };
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

    private sealed class AlertBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public AlertBannerAutomationPeer(AlertBanner owner)
            : base(owner)
        {
        }

        private AlertBanner Surface => (AlertBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
