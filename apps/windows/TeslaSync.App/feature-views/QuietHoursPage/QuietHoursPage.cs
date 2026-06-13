using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>QuietHoursPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/QuietHoursPage.tsx</c> (route <c>/notifications/quiet-hours</c>, nav name
/// <c>NotificationsQuietHours</c>). The web page is a thin composition: a <c>PageContainer</c> carrying the page
/// title, subtitle and "Copy link" affordance, hosting the server-backed <c>QuietHoursPanel</c> (the deterministic
/// CRUD surface for quiet-hours / Do-Not-Disturb windows). This view reproduces that composition with the native
/// <see cref="PageContainer"/> shared surface bound to a <see cref="QuietHoursPageViewModel"/> for the two
/// page-tier strings, and the native <see cref="QuietHoursPanel"/> as the page body — the panel owns its own
/// cache-then-network read and renders the loading / empty / error / stale states the P2 contract requires. The
/// AI quiet-hours advisor that the web page can layer above the panel is gated off by default (ADR-015 §I3: the
/// deterministic panel is the canonical baseline) and is tracked as its own opt-in surface, so it is absent here.
/// The view is a thin renderer: it performs no I/O and binds every label through the i18n facade; the diagnostics
/// <c>view.opened</c> event fires once when the page is shown.
/// </summary>
public sealed partial class QuietHoursPage : UserControl, IDisposable
{
    private readonly QuietHoursPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly QuietHoursPanel _panel;
    private bool _disposed;

    /// <summary>Creates the page over the inert empty source and the shell resource localizer (the shell entry point).</summary>
    public QuietHoursPage()
        : this(EmptyQuietHoursSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit quiet-hours source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The cache-then-network quiet-hours source the hosted panel binds.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the page's <c>view.opened</c> event.</param>
    /// <param name="panelDiagnostics">Optional PII-safe diagnostics collector for the hosted panel.</param>
    public QuietHoursPage(
        IQuietHoursSource source,
        ILocalizer localizer,
        QuietHoursPageDiagnostics? diagnostics = null,
        QuietHoursDiagnostics? panelDiagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new QuietHoursPageViewModel(localizer, diagnostics);
        _panel = new QuietHoursPanel(source, localizer, panelDiagnostics);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            CopyLinkText = DeepLink.BuildUri(QuietHoursPageViewModel.CopyLinkRoute).ToString(),
            PageContent = _panel,
        };

        Content = _container;
        AutomationProperties.SetName(this, _viewModel.Title);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>QuietHoursPage</c>).</summary>
    public static string Slug => QuietHoursPageRegistration.Slug;

    private void OnLoaded(object sender, RoutedEventArgs e) => _viewModel.NotifyOpened();

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the hosted disposables (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _panel.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new QuietHoursPageAutomationPeer(this);

    private sealed class QuietHoursPageAutomationPeer(QuietHoursPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
