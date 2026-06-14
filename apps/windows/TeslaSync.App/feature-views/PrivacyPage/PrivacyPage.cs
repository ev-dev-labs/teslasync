using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The native WinUI 3 <c>PrivacyPage</c> — a parity port of the web page
/// <c>web/src/features/settings/pages/PrivacyPage.tsx</c> (route <c>/account/privacy</c>, nav name
/// <c>Privacy</c>). The web page is a thin composition: a <c>PageContainer</c> carrying the page title,
/// subtitle and "Copy link" affordance, hosting the <c>PrivacySection</c> (which owns all of the browser-local
/// privacy controls — the recent-pages clearer with its destructive confirmation, the cookie / analytics
/// consent grant / withdraw / reset flow, and the deployment-wide consent-requirement read). This view
/// reproduces that composition with the native <see cref="PageContainer"/> shared surface bound to a
/// <see cref="PrivacyPageViewModel"/> for the two page-tier strings, and the native <see cref="PrivacySection"/>
/// as the page body — the section owns its own loading / live / stale / offline / error freshness handling and
/// renders every region the parity contract requires. The view is a thin renderer: it performs no I/O and binds
/// every label through the i18n facade; the diagnostics <c>view.opened</c> event fires once when the page is shown.
/// </summary>
public sealed partial class PrivacyPage : UserControl, IDisposable
{
    private readonly PrivacyPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly PrivacySection _section;
    private bool _disposed;

    /// <summary>Creates the page over the no-backend consent-requirement source and the shell localizer (the shell entry point).</summary>
    public PrivacyPage()
        : this(EmptyConsentRequirementSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit requirement source and localizer (used by tests / dependency injection).</summary>
    /// <param name="requirementSource">The deployment-wide <c>require_cookie_consent</c> read the hosted section binds.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the page's <c>view.opened</c> event.</param>
    /// <param name="sectionDiagnostics">Optional PII-safe diagnostics collector for the hosted section.</param>
    public PrivacyPage(
        IConsentRequirementSource requirementSource,
        ILocalizer localizer,
        PrivacyPageDiagnostics? diagnostics = null,
        PrivacySectionDiagnostics? sectionDiagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(requirementSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new PrivacyPageViewModel(localizer, diagnostics);
        _section = new PrivacySection(requirementSource, localizer, diagnostics: sectionDiagnostics);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            CopyLinkText = DeepLink.BuildUri(PrivacyPageViewModel.CopyLinkRoute).ToString(),
            PageContent = _section,
        };

        Content = _container;
        AutomationProperties.SetName(this, _viewModel.Title);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>PrivacyPage</c>).</summary>
    public static string Slug => PrivacyPageRegistration.Slug;

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
        _section.Dispose();
        _container.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PrivacyPageAutomationPeer(this);

    private sealed class PrivacyPageAutomationPeer(PrivacyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
