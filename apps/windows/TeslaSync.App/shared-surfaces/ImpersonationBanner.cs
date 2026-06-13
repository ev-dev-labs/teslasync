using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ImpersonationBanner</c> shared surface — a parity port of the web <c>ImpersonationBanner</c>
/// export (web/src/components/feedback/ImpersonationBanner.tsx). It is the persistent, top-of-page amber sticky bar
/// shown whenever the calling session carries a valid admin-impersonation claim: an amber-tinted row with a bottom
/// hairline carrying a Segoe Fluent admin glyph chip (standing in for the web Lucide <c>UserCheck</c>), the localized
/// "Impersonating {target}" title, the "You are viewing TeslaSync as another subject…" body, a live remaining-cookie
/// countdown ("Expires in {time}" → "Session expired"), and an "End impersonation" (<see cref="ButtonVariant.Subtle"/>)
/// button. It binds the <see cref="ImpersonationBannerViewModel"/> over the P1/S8 <see cref="IImpersonationBannerSource"/>
/// seam and the P1/S10 i18n facade, never touching the transport itself. It is a polite alert live region (web
/// <c>role="alert"</c> / <c>aria-live="polite"</c>) named with the title + body + countdown so Narrator announces the
/// impersonation context without interrupting, and it emits the <c>view.opened</c> diagnostic once when first shown.
///
/// <para>
/// State coverage: the web banner reads the impersonation status query but renders <c>null</c> for every non-active
/// result (web <c>if (!isImpersonationActive(data)) return null</c>), so the generic loading / empty / error /
/// inactive / open-mode data-lifecycle states all collapse to the hidden state and are reproduced as such; the states
/// the web actually has are reproduced in full and tested in <c>ImpersonationBannerTests</c>: hidden (no active claim)
/// and visible (an active claim), with the visible sub-branches — the live "Expires in {time}" countdown, the
/// "Session expired" countdown, a claim with no parseable expiry (no countdown line), and the idle / busy
/// ("Ending…") end button. Because the surface is query-backed it additionally surfaces the freshness states it can
/// reach over an active cached claim — <see cref="ImpersonationBannerViewModel.IsStale"/> /
/// <see cref="ImpersonationBannerViewModel.IsOffline"/> — as a <see cref="TsDataFreshness"/> chip beside the still
/// visible banner, and re-runs the status read on a 30-second cadence (web <c>refetchInterval</c>) while ticking the
/// countdown once a second (web <c>setInterval</c>). The surface uses no entrance animation, so the OS reduce-motion
/// preference is honoured by construction.
/// </para>
/// </summary>
public sealed partial class ImpersonationBanner : ContentControl, IDisposable
{
    private const double PaddingH = 16;            // web px-4
    private const double PaddingV = 10;            // web py-2.5
    private const double ColumnSpacing = 12;       // web gap-3
    private const double ChipPadding = 6;          // web p-1.5
    private const double ChipCornerRadius = 8;     // web rounded-lg
    private const double IconFontSize = 16;        // web UserCheck h-4 w-4
    private const double TitleFontSize = 14;       // web text-sm
    private const double BodyFontSize = 14;        // web text-sm
    private const double CountdownFontSize = 12;   // web text-xs
    private const double TitleBodySpacing = 2;     // web stacked title/body/countdown
    private const double ActionSpacing = 8;        // web gap between chip and button
    private const double BorderThicknessPx = 1;    // web border-b

    private static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(1);     // web 1s setInterval
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(30); // web 30s refetchInterval

    private readonly ImpersonationBannerViewModel _viewModel;
    private readonly ImpersonationBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherQueueTimer? _tickTimer;
    private readonly DispatcherQueueTimer? _refreshTimer;

    private readonly Border _row = new()
    {
        Padding = new Thickness(PaddingH, PaddingV, PaddingH, PaddingV),
        BorderThickness = new Thickness(0, 0, 0, BorderThicknessPx),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _iconChip = new()
    {
        Padding = new Thickness(ChipPadding),
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = ImpersonationBannerRegistration.IdentityGlyph,
        FontSize = IconFontSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
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
    };

    private readonly TextBlock _countdown = new()
    {
        FontSize = CountdownFontSize,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsDataFreshness _freshness = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsButton _end = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the banner over its data source, localizer and diagnostics (the production entry point).</summary>
    /// <param name="source">The status + end seam (web <c>useImpersonationStatus</c> / <c>useEndImpersonation</c>).</param>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the view-opened / end events.</param>
    /// <param name="clock">The "now" source the countdown is measured against (web <c>Date.now()</c>).</param>
    public ImpersonationBanner(
        IImpersonationBannerSource source,
        ILocalizer localizer,
        ImpersonationBannerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
        : this(diagnostics ?? new ImpersonationBannerDiagnostics(), source, localizer, clock)
    {
    }

    // Threads a single diagnostics instance into both the state holder (end events) and the view (view.opened) so
    // the operational counters are not split across two sinks.
    private ImpersonationBanner(
        ImpersonationBannerDiagnostics diagnostics,
        IImpersonationBannerSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock)
        : this(new ImpersonationBannerViewModel(source, localizer, diagnostics, clock), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ImpersonationBanner(
        ImpersonationBannerViewModel viewModel,
        ImpersonationBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ImpersonationBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, ImpersonationBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_countdown, ImpersonationBannerRegistration.CountdownAutomationId);
        AutomationProperties.SetAutomationId(_end, ImpersonationBannerRegistration.EndAutomationId);

        // web wrapper div: role="alert" aria-live="polite" — announce the impersonation context without interrupting.
        LiveRegion.Configure(this);

        if (_dispatcher is { } dispatcher)
        {
            _tickTimer = dispatcher.CreateTimer();
            _tickTimer.Interval = TickInterval;
            _tickTimer.IsRepeating = true;
            _tickTimer.Tick += OnTick;

            _refreshTimer = dispatcher.CreateTimer();
            _refreshTimer.Interval = RefreshInterval;
            _refreshTimer.IsRepeating = true;
            _refreshTimer.Tick += OnRefresh;
        }

        _end.Click += OnEndClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _row;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ImpersonationBanner</c>).</summary>
    public static string Slug => ImpersonationBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ImpersonationBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (title + body + countdown).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ImpersonationBannerSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public static ImpersonationBanner Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        ImpersonationBannerDiagnostics? diagnostics = null)
    {
        var source = new ImpersonationBannerSource(api, engine, options);
        return new ImpersonationBanner(source, localizer, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopTimers();

        if (_tickTimer is { } tick)
        {
            tick.Tick -= OnTick;
        }

        if (_refreshTimer is { } refresh)
        {
            refresh.Tick -= OnRefresh;
        }

        _end.Click -= OnEndClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ImpersonationBannerAutomationPeer(this);

    private void BuildTree()
    {
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _iconChip.Child = _icon;

        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_body);
        _textColumn.Children.Add(_countdown);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionSpacing,
            VerticalAlignment = VerticalAlignment.Top,
        };
        actions.Children.Add(_freshness);
        actions.Children.Add(_end);

        Grid.SetColumn(_iconChip, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(actions, 2);

        _content.Children.Add(_iconChip);
        _content.Children.Add(_textColumn);
        _content.Children.Add(actions);

        // The admin chip is decorative; the alert region's Narrator name (title + body + countdown) is authoritative.
        AutomationProperties.SetAccessibilityView(_iconChip, AccessibilityView.Raw);

        _row.Child = _content;
    }

    private void OnEndClick(object sender, RoutedEventArgs e) => _ = _viewModel.EndImpersonationAsync();

    private void OnTick(DispatcherQueueTimer sender, object args) => _viewModel.Tick();

    private void OnRefresh(DispatcherQueueTimer sender, object args) => _ = _viewModel.RefreshAsync();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();

            // web useImpersonationStatus polls every 30s while mounted, regardless of the active claim — so the
            // refresh cadence runs the whole time the surface is hosted, even while the banner is collapsed.
            _refreshTimer?.Start();
            _ = _viewModel.LoadAsync();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var projection = _viewModel.Projection;

        _title.Text = projection.Title;
        _body.Text = projection.Body;
        _countdown.Text = projection.Countdown;
        _countdown.Visibility = projection.HasCountdown ? Visibility.Visible : Visibility.Collapsed;

        _end.Text = projection.EndLabel;
        _end.IsLoading = projection.IsEnding;
        _end.IsEnabled = _viewModel.IsEndEnabled;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsOffline;
        _freshness.Visibility = projection.IsVisible && _viewModel.UpdatedAt is not null
            ? Visibility.Visible
            : Visibility.Collapsed;

        _icon.Foreground = DisplayTokens.Brush(ImpersonationBannerRegistration.WarningBrushKey);
        _title.Foreground = DisplayTokens.TextPrimary;
        _body.Foreground = DisplayTokens.TextSecondary;
        _countdown.Foreground = DisplayTokens.TextMuted;
        _iconChip.Background = TintBrush(ImpersonationBannerRegistration.IconChipOpacity);
        _row.Background = TintBrush(ImpersonationBannerRegistration.BannerBackgroundOpacity);
        _row.BorderBrush = TintBrush(ImpersonationBannerRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_end, projection.EndLabel);
        AutomationProperties.SetName(_countdown, projection.Countdown);
        ToolTipService.SetToolTip(_end, projection.EndLabel);

        // web: if (!isImpersonationActive(data)) return null — the surface collapses entirely when not active.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        SyncTickTimer(projection.IsVisible);

        if (projection.IsVisible && _opened)
        {
            LiveRegion.Announce(this);
        }
    }

    private void SyncTickTimer(bool isVisible)
    {
        if (_tickTimer is not { } timer)
        {
            return;
        }

        if (!_disposed && isVisible && _viewModel.IsCountingDown)
        {
            if (!timer.IsRunning)
            {
                timer.Start();
            }
        }
        else if (timer.IsRunning)
        {
            timer.Stop();
        }
    }

    private void StopTimers()
    {
        _tickTimer?.Stop();
        _refreshTimer?.Stop();
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveWarningColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveWarningColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(ImpersonationBannerRegistration.WarningColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the warning brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(ImpersonationBannerRegistration.WarningBrushKey) is SolidColorBrush brush
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

    private sealed class ImpersonationBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public ImpersonationBannerAutomationPeer(ImpersonationBanner owner)
            : base(owner)
        {
        }

        private ImpersonationBanner Surface => (ImpersonationBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
