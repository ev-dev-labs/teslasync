using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>RateLimitBanner</c> shared surface — a parity port of the web <c>RateLimitBanner</c>
/// export (web/src/components/feedback/RateLimitBanner.tsx). It is the app-chrome resilience strip pinned to the
/// top of the viewport: an amber "warning"-tinted bar with a bottom hairline, a rounded glyph chip (Segoe Fluent
/// <c>Clock</c> for a 429 rate-limit, <c>ErrorBadge</c> for an upstream-breaker trip — standing in for the web
/// Lucide <c>Clock</c> / <c>AlertCircle</c>), the localized countdown copy, a "Retry now"
/// (<see cref="ButtonVariant.Primary"/>) action that is disabled until the cooldown elapses, and a dismiss ("X")
/// button. It binds the <see cref="RateLimitBannerViewModel"/> (over the P1/S8 <see cref="IRateLimitSignalSource"/>
/// + <see cref="IQueryInvalidator"/>) and is shown only while a cooldown is in flight (the web <c>state</c> gate).
/// While visible it runs a one-second <see cref="DispatcherQueueTimer"/> that advances the countdown (the web
/// <c>setInterval</c>); retrying clears the banner and invalidates every query (the web <c>handleRetry</c>) and
/// dismissing clears it without invalidating (the web <c>handleDismiss</c>). It performs no event listening or
/// query access of its own — those are bound seams — is announced to Narrator as a polite live region named by the
/// countdown copy (the web <c>role="alert" aria-live="polite"</c>), and emits the <c>view.opened</c> diagnostic
/// once when first shown.
///
/// <para>
/// State coverage: the web source fetches no data, so it has no loading / error / stale / offline data chrome of
/// its own — its visibility derives purely from the resilience signals. Those data-source lifecycle states
/// therefore collapse to the hidden state, which is reproduced and tested. The states the web actually has are
/// reproduced in full: hidden (no signal in flight), the rate-limit countdown (Clock glyph, <c>ratelimit.banner</c>
/// copy), the upstream-down countdown (AlertCircle glyph, <c>upstream.banner</c> copy), and within each the
/// retry-locked (counting down) vs retry-armed (window elapsed) sub-states.
/// </para>
/// </summary>
public sealed partial class RateLimitBanner : ContentControl, IDisposable
{
    private const double BarHorizontalPadding = 16;  // web px-4.
    private const double BarVerticalPadding = 10;    // web py-2.5.
    private const double ColumnSpacing = 12;         // web gap-3.
    private const double ActionSpacing = 8;          // web gap-2.
    private const double ChipPadding = 6;            // web p-1.5.
    private const double ChipCornerRadius = 8;       // web rounded-lg.
    private const double GlyphSize = 16;             // web h-4 w-4.
    private const double MessageFontSize = 14;       // web text-sm.
    private const double HairlineThickness = 1;      // web border-b.
    private const double BarTintOpacity = 0.08;      // web bg-amber-300/[0.08].
    private const double ChipTintOpacity = 0.15;     // web bg-amber-300/15.
    private const double HairlineOpacity = 0.30;     // web border-amber-300/30.
    private const int CountdownIntervalSeconds = 1;  // web setInterval(…, 1000).

    private readonly RateLimitBannerViewModel _viewModel;
    private readonly RateLimitBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherQueueTimer? _timer;

    private readonly Border _bar = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        BorderThickness = new Thickness(0, 0, 0, HairlineThickness),
        Padding = new Thickness(BarHorizontalPadding, BarVerticalPadding, BarHorizontalPadding, BarVerticalPadding),
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _chip = new()
    {
        Padding = new Thickness(ChipPadding),
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _glyph = new()
    {
        FontSize = GlyphSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _message = new()
    {
        FontSize = MessageFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = ActionSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _retry = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _dismiss = new()
    {
        Variant = ButtonVariant.Icon,
        Size = ControlSize.Small,
        IconGlyph = RateLimitBannerRegistration.DismissGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _ready;
    private bool _opened;
    private bool _timerRunning;
    private bool _disposed;
    private string _announcedFor = string.Empty;

    /// <summary>
    /// Creates a headless-safe banner with no composition root (the designer / parameterless host entry point): it
    /// binds an in-memory signal source seeded with a sample rate-limit cooldown over the passthrough localizer, so
    /// the surface renders its visible countdown state. Supply explicit seams via the other constructors to drive
    /// i18n, the resilience signals and the query cache from the composition root.
    /// </summary>
    public RateLimitBanner()
        : this(CreateDesignerViewModel(), diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and the two bound P1/S8 seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The resilience-signal seam (web <c>teslasync:rate-limited</c> / <c>teslasync:upstream-down</c>).</param>
    /// <param name="invalidator">The query-invalidation seam (web <c>useQueryClient().invalidateQueries()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The current-instant source the countdown is computed against.</param>
    public RateLimitBanner(
        ILocalizer localizer,
        IRateLimitSignalSource source,
        IQueryInvalidator invalidator,
        RateLimitBannerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
        : this(new RateLimitBannerViewModel(localizer, source, invalidator, clock), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RateLimitBanner(RateLimitBannerViewModel viewModel, RateLimitBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new RateLimitBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        if (_dispatcher is not null)
        {
            _timer = _dispatcher.CreateTimer();
            _timer.Interval = TimeSpan.FromSeconds(CountdownIntervalSeconds);
            _timer.Tick += OnCountdownTick;
        }

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;

        BuildTree();

        AutomationProperties.SetAutomationId(this, RateLimitBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_retry, RateLimitBannerRegistration.RetryAutomationId);
        AutomationProperties.SetAutomationId(_dismiss, RateLimitBannerRegistration.DismissAutomationId);

        // web role="alert" aria-live="polite": surface the banner to Narrator without stealing focus.
        LiveRegion.Configure(this);

        _retry.Click += OnRetryClick;
        _dismiss.Click += OnDismissClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _bar;
        Render();
    }

    /// <summary>The canonical surface slug (<c>RateLimitBanner</c>).</summary>
    public static string Slug => RateLimitBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RateLimitBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the banner countdown copy).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopCountdown();
        if (_timer is not null)
        {
            _timer.Tick -= OnCountdownTick;
        }

        _retry.Click -= OnRetryClick;
        _dismiss.Click -= OnDismissClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RateLimitBannerAutomationPeer(this);

    private static RateLimitBannerViewModel CreateDesignerViewModel()
    {
        var source = new InMemoryRateLimitSignalSource();
        var viewModel = new RateLimitBannerViewModel(
            PassthroughLocalizer.Instance,
            source,
            new CountingQueryInvalidator());

        // Seed a visible rate-limit countdown so the designer / headless host renders the populated state.
        source.RaiseRateLimited("/vehicles", 30);
        return viewModel;
    }

    private void BuildTree()
    {
        _glyph.Foreground = AccentBrush(1.0);
        _chip.Background = AccentBrush(ChipTintOpacity);
        _chip.Child = _glyph;

        _message.Foreground = DisplayTokens.TextPrimary;

        _actions.Children.Add(_retry);
        _actions.Children.Add(_dismiss);

        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_chip, 0);
        Grid.SetColumn(_message, 1);
        Grid.SetColumn(_actions, 2);

        _content.Children.Add(_chip);
        _content.Children.Add(_message);
        _content.Children.Add(_actions);

        // The glyph chip is a decorative semantic mark; the surface's Narrator name (the message) is authoritative.
        AutomationProperties.SetAccessibilityView(_chip, AccessibilityView.Raw);

        _bar.BorderBrush = AccentBrush(HairlineOpacity);
        _bar.Background = AccentBrush(BarTintOpacity);
        _bar.Child = _content;
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => _viewModel.Retry();

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnCountdownTick(DispatcherQueueTimer sender, object args)
    {
        if (!_disposed)
        {
            _viewModel.Tick();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        _ready = true;
        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        _glyph.Glyph = projection.Glyph;
        _message.Text = projection.Message;

        _retry.Text = projection.RetryLabel;
        _retry.IsEnabled = projection.RetryEnabled;
        AutomationProperties.SetName(_retry, projection.RetryLabel);

        AutomationProperties.SetName(_dismiss, projection.DismissLabel);
        ToolTipService.SetToolTip(_dismiss, projection.DismissLabel);

        AutomationProperties.SetName(this, projection.AccessibleName);

        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible)
        {
            StartCountdown();
        }
        else
        {
            StopCountdown();
        }

        // web aria-live="polite": announce on first appearance and when the banner kind changes, but not on every
        // countdown tick (which would spam Narrator). The key omits the remaining seconds for exactly that reason.
        var announceKey = projection.IsVisible ? projection.Kind.ToString() : string.Empty;
        if (_ready && projection.IsVisible && !string.Equals(_announcedFor, announceKey, StringComparison.Ordinal))
        {
            LiveRegion.Announce(this);
        }

        _announcedFor = announceKey;
    }

    private void StartCountdown()
    {
        if (_timer is not null && !_timerRunning)
        {
            _timerRunning = true;
            _timer.Start();
        }
    }

    private void StopCountdown()
    {
        if (_timer is not null && _timerRunning)
        {
            _timerRunning = false;
            _timer.Stop();
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

    private static SolidColorBrush AccentBrush(double opacity) => new(AccentColor()) { Opacity = opacity };

    private static Windows.UI.Color AccentColor()
    {
        if (Application.Current?.Resources is { } resources)
        {
            if (resources.TryGetValue(RateLimitBannerRegistration.AccentColorKey, out var colorValue)
                && colorValue is Windows.UI.Color color)
            {
                return color;
            }

            if (resources.TryGetValue(RateLimitBannerRegistration.AccentBrushKey, out var brushValue)
                && brushValue is SolidColorBrush brush)
            {
                return brush.Color;
            }
        }

        return ColorFromHex(RateLimitBannerRegistration.AccentFallback);
    }

    private static Windows.UI.Color ColorFromHex(string hex)
    {
        var span = hex.AsSpan().TrimStart('#');
        if (span.Length == 6
            && byte.TryParse(span[..2], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var r)
            && byte.TryParse(span[2..4], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var g)
            && byte.TryParse(span[4..6], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var b))
        {
            return Windows.UI.Color.FromArgb(255, r, g, b);
        }

        // Tailwind amber-500 (#F59E0B) — the documented accent fallback.
        return Windows.UI.Color.FromArgb(255, 0xF5, 0x9E, 0x0B);
    }

    private sealed class RateLimitBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public RateLimitBannerAutomationPeer(RateLimitBanner owner)
            : base(owner)
        {
        }

        private RateLimitBanner Surface => (RateLimitBanner)Owner;

        // The banner is a named, non-modal status region; the countdown copy is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
