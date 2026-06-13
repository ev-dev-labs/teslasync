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
/// The native WinUI 3 <c>TwoFactorAuthPage</c> — a parity port of the web page
/// <c>web/src/features/settings/pages/TwoFactorAuthPage.tsx</c> (route <c>/account/2fa</c>, nav name
/// <c>TwoFactorAuth</c>). The web page is a thin composition: a <c>PageContainer</c> carrying the page title,
/// subtitle and "Copy link" affordance, hosting the <c>TOTPEnrollmentSection</c> (which owns all of the per-user
/// TOTP status, enrollment, verify, backup-codes and disable flow). This view reproduces that composition with the
/// native <see cref="PageContainer"/> shared surface bound to a <see cref="TwoFactorAuthPageViewModel"/> for the two
/// page-tier strings, and the native <see cref="TotpEnrollmentSection"/> as the page body — the section owns its own
/// status read and renders the loading / open-mode / not-enrolled / active states the parity contract requires. The
/// view is a thin renderer: it performs no I/O and binds every label through the i18n facade; the diagnostics
/// <c>view.opened</c> event fires once when the page is shown.
/// </summary>
public sealed partial class TwoFactorAuthPage : UserControl, IDisposable
{
    private readonly TwoFactorAuthPageViewModel _viewModel;
    private readonly PageContainer _container;
    private readonly TotpEnrollmentSection _section;
    private bool _disposed;

    /// <summary>Creates the page over the inert open-mode controller and the shell localizer (the shell entry point).</summary>
    public TwoFactorAuthPage()
        : this(OpenModeTotpController.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit controller and localizer (used by tests / dependency injection).</summary>
    /// <param name="controller">The TOTP status/enroll/verify/revoke/regenerate seam the hosted section binds.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the page's <c>view.opened</c> event.</param>
    /// <param name="sectionDiagnostics">Optional PII-safe diagnostics collector for the hosted section.</param>
    public TwoFactorAuthPage(
        ITotpEnrollmentController controller,
        ILocalizer localizer,
        TwoFactorAuthPageDiagnostics? diagnostics = null,
        TotpEnrollmentDiagnostics? sectionDiagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TwoFactorAuthPageViewModel(localizer, diagnostics);
        _section = new TotpEnrollmentSection(controller, localizer, sectionDiagnostics);

        _container = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            CopyLinkText = DeepLink.BuildUri(TwoFactorAuthPageViewModel.CopyLinkRoute).ToString(),
            PageContent = _section,
        };

        Content = _container;
        AutomationProperties.SetName(this, _viewModel.Title);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics surface slug (<c>TwoFactorAuthPage</c>).</summary>
    public static string Slug => TwoFactorAuthPageRegistration.Slug;

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
    protected override AutomationPeer OnCreateAutomationPeer() => new TwoFactorAuthPageAutomationPeer(this);

    private sealed class TwoFactorAuthPageAutomationPeer(TwoFactorAuthPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
