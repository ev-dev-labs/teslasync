using System.Numerics;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Windows.AppLifecycle;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>NewVersionBanner</c> shared surface — a parity port of the web <c>NewVersionBanner</c>
/// export (web/src/components/feedback/NewVersionBanner.tsx). It is the soft "a new version is available" toast
/// anchored at the bottom-right of the window: an emerald-tinted <see cref="TsGlassPanel"/>-style card carrying a
/// Segoe Fluent sparkle glyph chip (standing in for the web Lucide <c>Sparkles</c>), the localized
/// "A new version of TeslaSync is available." message, and the "Later" (<see cref="ButtonVariant.Subtle"/>, the web
/// <c>ghost</c>) / "Reload" (<see cref="ButtonVariant.Primary"/>) actions. It binds the
/// <see cref="NewVersionBannerViewModel"/> (over the P1/S8 <see cref="IVersionWatcherSource"/> +
/// <see cref="IVersionDismissalStore"/>) and is shown only when a new deploy is detected AND the user has not
/// deferred that exact version (the web <c>!newVersionAvailable</c> / <c>dismissedVersion === latestVersion</c>
/// early returns); "Later" defers the current version through the store (which collapses the banner until a newer
/// version arrives), and "Reload" applies the update by restarting the app (the native analogue of the web
/// <c>window.location.reload()</c>, which fetches fresh assets to pre-empt a chunk-load failure). It is a polite
/// status live region named with the message (so Narrator announces the update), performs no HTTP / polling of its
/// own, and emits the <c>view.opened</c> diagnostic once when first shown.
///
/// <para>
/// State coverage: the web banner has no loading / error / stale / offline chrome of its own — the version probe
/// (web <c>useVersionWatcher</c> → <c>fetchVersion</c>) swallows transient failures and ignores a missing / empty
/// <c>app_version</c>, so a still-loading, failed or empty probe simply never flips <c>newVersionAvailable</c> and
/// the banner stays hidden. Those data-source lifecycle states therefore collapse to the hidden state, reproduced
/// and tested in <c>NewVersionBannerTests</c>. The states the web actually has are reproduced in full: hidden (no
/// new version, or the new version already deferred), visible (a new version awaiting reload), and the re-surface
/// case where a newer version arrives after a previous deferral. The surface uses no entrance / transition
/// animation (matching the web, which simply mounts), so the OS reduce-motion preference is honoured by
/// construction.
/// </para>
/// </summary>
public sealed partial class NewVersionBanner : ContentControl, IDisposable
{
    private const double MaxCardWidth = 384;        // web max-w-sm (24rem).
    private const double CardPaddingH = 16;         // web px-4.
    private const double CardPaddingV = 12;         // web py-3.
    private const double CardCornerRadius = 12;     // web rounded-xl.
    private const double CardBorderThickness = 1;   // web border.
    private const double OuterPadding = 16;         // web bottom-4 right-4.
    private const double ColumnSpacing = 12;        // web gap-3.
    private const double ChipPadding = 8;           // web p-2.
    private const double ChipCornerRadius = 8;      // web rounded-lg.
    private const double IconFontSize = 16;         // web Sparkles h-4 w-4.
    private const double MessageFontSize = 14;      // web text-sm.
    private const double ActionSpacing = 4;         // web gap-1.
    private const double ShadowDepth = 16;          // web shadow-lg elevation.

    private readonly NewVersionBannerViewModel _viewModel;
    private readonly NewVersionBannerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly Action _reload;

    private readonly Border _card = new()
    {
        MaxWidth = MaxCardWidth,
        Padding = new Thickness(CardPaddingH, CardPaddingV, CardPaddingH, CardPaddingV),
        BorderThickness = new Thickness(CardBorderThickness),
        CornerRadius = new CornerRadius(CardCornerRadius),
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _iconChip = new()
    {
        Padding = new Thickness(ChipPadding),
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        Glyph = NewVersionBannerRegistration.SparkleGlyph,
        FontSize = IconFontSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _message = new()
    {
        FontSize = MessageFontSize,
        TextWrapping = TextWrapping.Wrap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _later = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _reloadButton = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe banner with no composition root (the designer / parameterless host entry point): it
    /// binds an empty version-watcher (so, like the web banner on a healthy SPA, it stays hidden until a new deploy
    /// is detected) and the process-lifetime <see cref="SessionVersionDismissalStore"/> over the passthrough
    /// localizer. The real composition root binds a <see cref="RepositoryVersionWatcherSource"/> over the
    /// <c>/system/version</c> stream via the other constructors.
    /// </summary>
    public NewVersionBanner()
        : this(
            PassthroughLocalizer.Instance,
            new StaticVersionWatcherSource(),
            new SessionVersionDismissalStore(),
            diagnostics: null)
    {
    }

    /// <summary>Creates the banner over the i18n facade and the two bound P1/S8 seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the message / action strings resolve through.</param>
    /// <param name="source">The deploy-version-watcher seam (web <c>useVersionWatcher()</c>).</param>
    /// <param name="dismissalStore">The per-version dismissal seam (web <c>sessionStorage</c> flag).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="reload">The update-apply action (defaults to an app restart); overridable for hosting / tests.</param>
    public NewVersionBanner(
        ILocalizer localizer,
        IVersionWatcherSource source,
        IVersionDismissalStore dismissalStore,
        NewVersionBannerDiagnostics? diagnostics = null,
        Action? reload = null)
        : this(new NewVersionBannerViewModel(localizer, source, dismissalStore), diagnostics, reload)
    {
    }

    /// <summary>Creates the banner over an explicit state holder (tests / headless hosts), diagnostics and reload action.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="reload">The update-apply action (defaults to an app restart).</param>
    public NewVersionBanner(
        NewVersionBannerViewModel viewModel,
        NewVersionBannerDiagnostics? diagnostics = null,
        Action? reload = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new NewVersionBannerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reload = reload ?? PerformAppRestart;

        HorizontalContentAlignment = HorizontalAlignment.Right;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Padding = new Thickness(OuterPadding);
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, NewVersionBannerRegistration.BannerAutomationId);
        AutomationProperties.SetAutomationId(_later, NewVersionBannerRegistration.LaterAutomationId);
        AutomationProperties.SetAutomationId(_reloadButton, NewVersionBannerRegistration.ReloadAutomationId);

        // web wrapper div: role="status" aria-live="polite".
        LiveRegion.Configure(this);

        _later.Click += OnLaterClick;
        _reloadButton.Click += OnReloadClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ReloadRequested += OnReloadRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>NewVersionBanner</c>).</summary>
    public static string Slug => NewVersionBannerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public NewVersionBannerViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the banner message).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _later.Click -= OnLaterClick;
        _reloadButton.Click -= OnReloadClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ReloadRequested -= OnReloadRequested;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new NewVersionBannerAutomationPeer(this);

    private void BuildTree()
    {
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _iconChip.Child = _icon;

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_later);
        actions.Children.Add(_reloadButton);

        Grid.SetColumn(_iconChip, 0);
        Grid.SetColumn(_message, 1);
        Grid.SetColumn(actions, 2);

        _content.Children.Add(_iconChip);
        _content.Children.Add(_message);
        _content.Children.Add(actions);

        // The sparkle chip is decorative; the status region's Narrator name (the message) is authoritative.
        AutomationProperties.SetAccessibilityView(_iconChip, AccessibilityView.Raw);

        // web shadow-lg: a soft elevation behind the card.
        _card.Translation = new Vector3(0, 0, (float)ShadowDepth);
        _card.Shadow = new ThemeShadow();

        _card.Child = _content;
    }

    private void OnLaterClick(object sender, RoutedEventArgs e) => _viewModel.DismissForCurrentVersion();

    private void OnReloadClick(object sender, RoutedEventArgs e) => _viewModel.RequestReload();

    private void OnReloadRequested(object? sender, EventArgs e) => Marshal(_reload);

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

        _message.Text = projection.Message;
        _later.Text = projection.LaterLabel;
        _reloadButton.Text = projection.ReloadLabel;

        var accent = DisplayTokens.Brush(NewVersionBannerRegistration.AccentBrushKey);
        _icon.Foreground = accent;
        _message.Foreground = DisplayTokens.TextPrimary;
        _iconChip.Background = AccentTint(NewVersionBannerRegistration.ChipBackgroundOpacity);
        _card.Background = OverlayBrush();
        _card.BorderBrush = AccentTint(NewVersionBannerRegistration.CardBorderOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetName(_later, projection.LaterLabel);
        AutomationProperties.SetName(_reloadButton, projection.ReloadLabel);
        ToolTipService.SetToolTip(_later, projection.LaterLabel);
        ToolTipService.SetToolTip(_reloadButton, projection.ReloadLabel);

        // web: returns null unless newVersionAvailable && not-deferred — the surface collapses entirely otherwise.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        if (projection.IsVisible && _opened)
        {
            LiveRegion.Announce(this);
        }
    }

    private static void PerformAppRestart()
    {
        try
        {
            // Native analogue of window.location.reload(): relaunch the process so it boots against the new deploy.
            _ = AppInstance.Restart(string.Empty);
        }
        catch (Exception)
        {
            // Unpackaged / headless / restart-denied contexts cannot relaunch; swallow so the click never crashes
            // the app, mirroring the web reload being a best-effort navigation.
        }
    }

    private static SolidColorBrush AccentTint(double opacity) =>
        new(ResolveAccentColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveAccentColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(NewVersionBannerRegistration.AccentColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the accent brush's colour so the chip / border still tint when the colour token is absent.
        return DisplayTokens.Brush(NewVersionBannerRegistration.AccentBrushKey) is SolidColorBrush brush
            ? brush.Color
            : Microsoft.UI.Colors.MediumSeaGreen;
    }

    private static Brush OverlayBrush()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(NewVersionBannerRegistration.OverlayBrushKey, out var value)
            && value is Brush brush)
        {
            return brush;
        }

        return DisplayTokens.Surface;
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

    private sealed class NewVersionBannerAutomationPeer : FrameworkElementAutomationPeer
    {
        public NewVersionBannerAutomationPeer(NewVersionBanner owner)
            : base(owner)
        {
        }

        private NewVersionBanner Surface => (NewVersionBanner)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The production <see cref="IVersionDismissalStore"/> — the native analogue of the web banner's per-tab
/// <c>sessionStorage</c> flag (web/src/components/feedback/NewVersionBanner.tsx L25, L30-37, L57-66). The web keys
/// the deferral on <c>latestVersion</c> in <c>sessionStorage</c> so it survives navigations within the same tab but
/// a fresh tab (or a relaunch) starts clean; the closest native analogue of a single tab's session is the running
/// process, so this store keeps the deferred version in process-static memory: it persists across re-mounts of the
/// banner within one app run and resets on the next launch (exactly when we want to re-nudge a long-lived,
/// stale-asset session). Access is guarded and never throws (mirroring the web try/catch around
/// <c>sessionStorage</c>). Thread-safe.
/// </summary>
public sealed class SessionVersionDismissalStore : IVersionDismissalStore
{
    private static readonly object Gate = new();
    private static string? _shared;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? DismissedVersion
    {
        get
        {
            lock (Gate)
            {
                return _shared;
            }
        }
    }

    /// <inheritdoc />
    public void Dismiss(string version)
    {
        ArgumentException.ThrowIfNullOrEmpty(version);

        lock (Gate)
        {
            if (string.Equals(_shared, version, StringComparison.Ordinal))
            {
                return;
            }

            _shared = version;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}
