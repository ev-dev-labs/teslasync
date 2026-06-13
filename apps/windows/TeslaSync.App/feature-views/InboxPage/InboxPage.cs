using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>InboxPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/InboxPage.tsx</c> (route <c>/notifications/inbox</c>, nav name
/// <c>NotificationsInbox</c>). Like the web page it is a thin host: it mounts the shared
/// <see cref="PageContainer"/> chrome — the localized title, the muted subtitle, the "Copy link" affordance and
/// a right-aligned "View archived" action — over the shared <see cref="InboxBody"/> surface for the active
/// (non-archived) inbox. The page owns the two auxiliary reads the web page performs (<c>useVehicles()</c> +
/// <c>useAlertRules()</c>) through its <see cref="InboxPageViewModel"/>; the hosted <see cref="InboxBody"/>
/// resolves its own vehicle/rule labels from the notification readings, so those reads back the page-level
/// data-source contract and freshness rather than being prop-drilled into the body. All label resolution flows
/// through the i18n facade; the page raises navigation intents (View archived → <c>notifications/archived</c>,
/// the body's empty CTA → <c>notifications/studio</c>) for the shell host to route.
/// </summary>
public sealed partial class InboxPage : UserControl, IDisposable
{
    private readonly InboxPageViewModel _viewModel;
    private readonly InboxBody _body;
    private readonly PageContainer _pageContainer;
    private readonly TsButton _viewArchived = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = InboxPageRegistration.ArchiveGlyph,
    };

    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the inert shell sources and the shell resource localizer.</summary>
    public InboxPage()
        : this(
            EmptyInboxPageSource.Instance,
            EmptyInboxSource.Instance,
            NoOpInboxCommands.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit sources and a localizer (used by tests / data-wired hosts).</summary>
    /// <param name="pageSource">The vehicles + alert-rules read source (web <c>useVehicles</c> / <c>useAlertRules</c>).</param>
    /// <param name="inboxSource">The cache-then-network inbox-reading source the hosted body binds.</param>
    /// <param name="inboxCommands">The inbox mutation commands the hosted body drives.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="pageDiagnostics">The PII-safe diagnostics sink for the page's <c>view.opened</c> event.</param>
    /// <param name="bodyDiagnostics">The PII-safe diagnostics sink for the hosted body.</param>
    public InboxPage(
        IInboxPageSource pageSource,
        IInboxSource inboxSource,
        IInboxCommands inboxCommands,
        ILocalizer localizer,
        InboxPageDiagnostics? pageDiagnostics = null,
        InboxBodyDiagnostics? bodyDiagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(pageSource);
        ArgumentNullException.ThrowIfNull(inboxSource);
        ArgumentNullException.ThrowIfNull(inboxCommands);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new InboxPageViewModel(pageSource, localizer, pageDiagnostics);
        _body = new InboxBody(inboxSource, inboxCommands, localizer, archived: false, bodyDiagnostics);

        _viewArchived.Text = _viewModel.ViewArchivedLabel;
        AutomationProperties.SetName(_viewArchived, _viewModel.ViewArchivedLabel);

        _pageContainer = new PageContainer(localizer, _viewModel.Title)
        {
            Subtitle = _viewModel.Subtitle,
            CopyLink = true,
            CopyLinkText = InboxPageRegistration.RouteName,
            Actions = _viewArchived,
            PageContent = _body,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.AutomationName);

        _viewArchived.Click += OnViewArchivedClick;
        _body.ConfigureAlertRulesRequested += OnConfigureAlertRulesRequested;
        _body.ViewContextRequested += OnViewContextRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _pageContainer;
    }

    /// <summary>Raised when the header "View archived" action is invoked (web <c>Link to /notifications/archived</c>).</summary>
    public event EventHandler? ViewArchivedRequested;

    /// <summary>Raised when the hosted body's empty CTA is invoked (web empty <c>to: /notifications/studio</c>).</summary>
    public event EventHandler? ConfigureAlertRulesRequested;

    /// <summary>Raised when a hosted-body row's "View context" command is invoked (host resolves the drill-through).</summary>
    public event EventHandler<long>? ViewContextRequested;

    /// <summary>The diagnostics surface slug (<c>InboxPage</c>).</summary>
    public static string Slug => InboxPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public InboxPageViewModel ViewModel => _viewModel;

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewArchivedClick(object sender, RoutedEventArgs e) =>
        ViewArchivedRequested?.Invoke(this, EventArgs.Empty);

    private void OnConfigureAlertRulesRequested(object? sender, EventArgs e) =>
        ConfigureAlertRulesRequested?.Invoke(this, EventArgs.Empty);

    private void OnViewContextRequested(object? sender, long alertId) =>
        ViewContextRequested?.Invoke(this, alertId);

    /// <summary>Unsubscribe from and dispose the owned surfaces (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewArchived.Click -= OnViewArchivedClick;
        _body.ConfigureAlertRulesRequested -= OnConfigureAlertRulesRequested;
        _body.ViewContextRequested -= OnViewContextRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        _body.Dispose();
        _pageContainer.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new InboxPageAutomationPeer(this);

    private sealed class InboxPageAutomationPeer(InboxPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
