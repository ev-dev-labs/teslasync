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
/// The native WinUI 3 <c>TeslaReauthBanner</c> shared surface — a parity port of the web <c>TeslaReauthBanner</c>
/// export (web/src/components/feedback/TeslaReauthBanner.tsx). It is the sticky, top-of-page recovery row shown when
/// the user's third-party Tesla OAuth grant expires (the refresh token's hard 8-week TTL lapses and every
/// Tesla-backed call starts returning 401 <c>TESLA_TOKEN_EXPIRED</c>): an amber-tinted row with a bottom hairline
/// carrying a Segoe Fluent warning glyph chip (standing in for the web Lucide <c>AlertTriangle</c>), the localized
/// "Tesla account disconnected" title and "Reconnect to resume live data and commands." body, a "Reconnect"
/// (<see cref="ButtonVariant.Primary"/>) CTA that deep-links to <c>/tesla-account</c>, and a "Dismiss"
/// (<see cref="ButtonVariant.Icon"/>, the web Lucide <c>X</c>) control. It binds the
/// <see cref="TeslaReauthBannerViewModel"/> over the P1/S8 <see cref="ITeslaAuthRecoverySource"/> +
/// <see cref="ITeslaReauthNavigator"/> seams and the P1/S10 i18n facade. It is an assertive alert live region
/// (web <c>role="alert"</c> / <c>aria-live="assertive"</c>) named with the title + body so Narrator interrupts to
/// announce the disconnect, performs no transport listening of its own, and emits the <c>view.opened</c> diagnostic
/// once when first shown.
///
/// <para>
/// State coverage: this surface reads no API query, so it has no loading / empty / error / stale / offline data
/// chrome — the generic data-lifecycle states collapse to the hidden state. The states the web actually has are
/// reproduced in full and tested in <c>TeslaReauthBannerTests</c>: hidden (token valid, or the banner dismissed /
/// the user reconnected — the web <c>if (!visible) return null</c> gate), and visible (the token expired). The
/// behavioural branches are reproduced too: an expiry signal re-shows a banner the user previously dismissed (the
/// web per-event <c>setVisible(true)</c>), "Dismiss" hides without resolving the expiry (web <c>handleDismiss</c>),
/// "Reconnect" deep-links to <c>/tesla-account</c> (web <c>handleReconnect</c>), and a recovery signal hides the
/// banner and replays the mutations queued during the disconnected window (web <c>handleRecovered</c> +
/// <c>drainQueuedTeslaMutations()</c>). The surface uses no entrance / transition animation (matching the web,
/// which simply mounts), so the OS reduce-motion preference is honoured by construction.
/// </para>
/// </summary>
public sealed partial class TeslaReauthBanner : ContentControl, IDisposable
{
    private const double PaddingH = 16;            // web px-4
    private const double PaddingV = 10;            // web py-2.5
    private const double ColumnSpacing = 12;       // web gap-3
    private const double ChipPadding = 6;          // web p-1.5
    private const double ChipCornerRadius = 8;     // web rounded-lg
    private const double IconFontSize = 16;        // web AlertTriangle / X h-4 w-4
    private const double TitleFontSize = 14;       // web text-sm
    private const double BodyFontSize = 12;        // web text-xs
    private const double TitleBodySpacing = 2;     // web stacked title/body
    private const double ActionSpacing = 8;        // web gap-2
    private const double BorderThicknessPx = 1;    // web border-b

    private readonly TeslaReauthBannerViewModel _viewModel;
    private readonly TeslaReauthBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

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
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _iconChip = new()
    {
        Padding = new Thickness(ChipPadding),
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = TeslaReauthBannerRegistration.WarningGlyph,
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
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _body = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsButton _reconnect = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _dismiss = new()
    {
        Variant = ButtonVariant.Icon,
        Size = ControlSize.Small,
        IconGlyph = TeslaReauthBannerRegistration.DismissGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the banner with no composition root (the designer / parameterless host entry point): it binds a
    /// recovery hub already flagged expired so the surface renders its visible state, and a recording navigator.
    /// Supply an explicit <see cref="ILocalizer"/>, a bound <see cref="ITeslaAuthRecoverySource"/> and a bound
    /// <see cref="ITeslaReauthNavigator"/> via the other constructors to drive i18n, recovery and navigation from
    /// the composition root.
    /// </summary>
    public TeslaReauthBanner()
        : this(
            PassthroughLocalizer.Instance,
            CreateExpiredHub(),
            new RecordingTeslaReauthNavigator(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and bound seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="source">The Tesla-auth-recovery seam (web document events + <c>teslaAuthRecovery</c>).</param>
    /// <param name="navigator">The navigation seam the "Reconnect" CTA invokes (web <c>useNavigate()</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaReauthBanner(
        ILocalizer localizer,
        ITeslaAuthRecoverySource source,
        ITeslaReauthNavigator navigator,
        TeslaReauthBannerDiagnostics? diagnostics = null)
        : this(new TeslaReauthBannerViewModel(localizer, source, navigator), diagnostics)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaReauthBanner(TeslaReauthBannerViewModel viewModel, TeslaReauthBannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TeslaReauthBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        Padding = new Thickness(0);
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, TeslaReauthBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_reconnect, TeslaReauthBannerRegistration.ReconnectAutomationId);
        AutomationProperties.SetAutomationId(_dismiss, TeslaReauthBannerRegistration.DismissAutomationId);

        // web wrapper div: role="alert" aria-live="assertive" — interrupt to announce the disconnect.
        LiveRegion.Configure(this, assertive: true);

        _reconnect.Click += OnReconnectClick;
        _dismiss.Click += OnDismissClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _row;
        Render();
    }

    /// <summary>The canonical surface slug (<c>TeslaReauthBanner</c>).</summary>
    public static string Slug => TeslaReauthBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TeslaReauthBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the title and body together).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _reconnect.Click -= OnReconnectClick;
        _dismiss.Click -= OnDismissClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaReauthBannerAutomationPeer(this);

    private static TeslaAuthRecoveryHub CreateExpiredHub()
    {
        var hub = new TeslaAuthRecoveryHub();
        hub.NotifyExpired();
        return hub;
    }

    private void BuildTree()
    {
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _iconChip.Child = _icon;

        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_body);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_reconnect);
        actions.Children.Add(_dismiss);

        Grid.SetColumn(_iconChip, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(actions, 2);

        _content.Children.Add(_iconChip);
        _content.Children.Add(_textColumn);
        _content.Children.Add(actions);

        // The warning chip is decorative; the alert region's Narrator name (title + body) is authoritative.
        AutomationProperties.SetAccessibilityView(_iconChip, AccessibilityView.Raw);

        _row.Child = _content;
    }

    private void OnReconnectClick(object sender, RoutedEventArgs e) => _viewModel.Reconnect();

    private void OnDismissClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

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

        _title.Text = projection.Title;
        _body.Text = projection.Body;
        _reconnect.Text = projection.ReconnectLabel;

        _icon.Foreground = DisplayTokens.Brush(TeslaReauthBannerRegistration.WarningBrushKey);
        _title.Foreground = DisplayTokens.TextPrimary;
        _body.Foreground = DisplayTokens.TextSecondary;
        _iconChip.Background = TintBrush(TeslaReauthBannerRegistration.IconChipOpacity);
        _row.Background = TintBrush(TeslaReauthBannerRegistration.BannerBackgroundOpacity);
        _row.BorderBrush = TintBrush(TeslaReauthBannerRegistration.BannerBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_reconnect, projection.ReconnectLabel);
        AutomationProperties.SetName(_dismiss, projection.DismissLabel);
        ToolTipService.SetToolTip(_reconnect, projection.ReconnectLabel);
        ToolTipService.SetToolTip(_dismiss, projection.DismissLabel);

        // web: if (!visible) return null — the surface collapses entirely when hidden.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible && _opened)
        {
            LiveRegion.Announce(this);
        }
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveWarningColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveWarningColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(TeslaReauthBannerRegistration.WarningColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the warning brush's colour so the banner still tints when the colour token is absent.
        return DisplayTokens.Brush(TeslaReauthBannerRegistration.WarningBrushKey) is SolidColorBrush brush
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

    private sealed class TeslaReauthBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public TeslaReauthBannerAutomationPeer(TeslaReauthBanner owner)
            : base(owner)
        {
        }

        private TeslaReauthBanner Surface => (TeslaReauthBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
