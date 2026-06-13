using System.Runtime.CompilerServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>ArchivedPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/ArchivedPage.tsx</c> (route <c>/notifications/archived</c>, nav name
/// <c>NotificationsArchived</c>). Faithful to the thin web page, it composes the shared
/// <see cref="PageContainer"/> chrome (title + subtitle + copy-link + a "Back to inbox" action) around the
/// shared <see cref="InboxBody"/> body in its archive mode (<c>archived: true</c>), so the bulk-action set swaps
/// Archive for Restore exactly as the web source does. Its <see cref="ArchivedPageViewModel"/> binds the page's
/// two data hooks — <c>useVehicles</c> (<c>GET /vehicles</c>) and <c>useAlertRules</c> (<c>GET /alerts/rules</c>)
/// — into the vehicle + rule context; that read is non-blocking (the inbox always renders) and only a hard
/// failure surfaces the retriable <see cref="TsAlertBanner"/> strip. The view is a thin renderer: all branch
/// selection and i18n happen in the view-model's <see cref="ArchivedDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class ArchivedPage : UserControl, IDisposable
{
    private readonly ArchivedPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageContainer _container;
    private readonly InboxBody _inbox;

    private readonly TsButton _backButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = "\uE72B",
    };

    private readonly TsAlertBanner _contextError = new()
    {
        Variant = CalloutVariant.Danger,
        IsOpen = false,
        Dismissible = false,
    };

    /// <summary>Creates the page over the default empty context + inbox sources and the shell resource localizer.</summary>
    public ArchivedPage()
        : this(
            EmptyArchivedContextSource.Instance,
            EmptyInboxSource.Instance,
            EmptyInboxCommands.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / DI hosts).</summary>
    /// <param name="context">The vehicle + rule context port (web <c>useVehicles</c> + <c>useAlertRules</c>).</param>
    /// <param name="inboxSource">The cache-then-network inbox read source for the hosted <see cref="InboxBody"/>.</param>
    /// <param name="inboxCommands">The inbox mutation command port for the hosted <see cref="InboxBody"/>.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ArchivedPage(
        IArchivedContextSource context,
        IInboxSource inboxSource,
        IInboxCommands inboxCommands,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(inboxSource);
        ArgumentNullException.ThrowIfNull(inboxCommands);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ArchivedPageViewModel(context, localizer);
        _inbox = new InboxBody(inboxSource, inboxCommands, localizer, archived: true);
        _container = new PageContainer(localizer, ArchivedRegistration.Title(localizer));

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildLayout();

        _backButton.Click += OnBackClick;
        _contextError.ActionInvoked += OnContextRetry;
        _inbox.ViewContextRequested += OnInboxViewContext;
        _inbox.ConfigureAlertRulesRequested += OnInboxConfigureRules;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the "Back to inbox" action is invoked (web <c>Link to="/notifications/inbox"</c>).</summary>
    public event EventHandler? BackToInboxRequested;

    /// <summary>Raised when a row's "View context" command is invoked — the host navigates to the drill-through.</summary>
    public event EventHandler<long>? ViewContextRequested;

    /// <summary>Raised when the empty-state CTA is invoked — the host navigates to the alert-rule studio.</summary>
    public event EventHandler? ConfigureAlertRulesRequested;

    /// <summary>The diagnostics surface slug (<c>ArchivedPage</c>).</summary>
    public static string Slug => ArchivedRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ArchivedPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ArchivedContextSource"/> and the
    /// generated-client-backed inbox source + commands from the shared data layer.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The fully wired page.</returns>
    public static ArchivedPage Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);

        var context = new ArchivedContextSource(api, engine, options);
        var inboxSource = new InboxSource(api, engine, options);
        var inboxCommands = new InboxCommands(api);
        return new ArchivedPage(context, inboxSource, inboxCommands, localizer);
    }

    private PageContainer BuildLayout()
    {
        _contextError.Visibility = Visibility.Collapsed;

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(_contextError);
        body.Children.Add(_inbox);

        _container.CopyLink = true;
        _container.Actions = _backButton;
        _container.PageContent = body;
        return _container;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _viewModel.NotifyOpened();
        }

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(ArchivedDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.CopyLink = true;
        _container.CopyLinkText = display.CopyLinkText;

        _backButton.Text = display.BackToInboxText;
        AutomationProperties.SetName(_backButton, display.BackToInboxText);

        _contextError.Title = display.ContextErrorText;
        _contextError.ActionText = display.RetryText;
        _contextError.IsOpen = display.ShowContextError;
        _contextError.Visibility = display.ShowContextError ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void OnBackClick(object sender, RoutedEventArgs e) =>
        BackToInboxRequested?.Invoke(this, EventArgs.Empty);

    private void OnContextRetry(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RetryAsync());

    private void OnInboxViewContext(object? sender, long id) =>
        ViewContextRequested?.Invoke(this, id);

    private void OnInboxConfigureRules(object? sender, EventArgs e) =>
        ConfigureAlertRulesRequested?.Invoke(this, EventArgs.Empty);

    private static async void InvokeAsync(Func<Task> action) =>
        await action().ConfigureAwait(true);

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (CA1001; mirrors sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _backButton.Click -= OnBackClick;
        _contextError.ActionInvoked -= OnContextRetry;
        _inbox.ViewContextRequested -= OnInboxViewContext;
        _inbox.ConfigureAlertRulesRequested -= OnInboxConfigureRules;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _inbox.Dispose();
        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ArchivedPageAutomationPeer(this);

    private sealed class ArchivedPageAutomationPeer(ArchivedPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>
    /// The default <see cref="IInboxSource"/> for the shell registration — resolves to the empty inbox so the
    /// archive surface renders its friendly empty state until a host wires the generated-client-backed
    /// <see cref="InboxSource"/> via <see cref="Create"/>.
    /// </summary>
    private sealed class EmptyInboxSource : IInboxSource
    {
        public static EmptyInboxSource Instance { get; } = new();

        private EmptyInboxSource()
        {
        }

        public async IAsyncEnumerable<RepositoryResult<InboxReading>> StreamAsync(
            InboxQuery query,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(query);
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<InboxReading>.Empty();
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    /// <summary>The default <see cref="IInboxCommands"/> for the shell registration — every mutation is a no-op.</summary>
    private sealed class EmptyInboxCommands : IInboxCommands
    {
        public static EmptyInboxCommands Instance { get; } = new();

        private EmptyInboxCommands()
        {
        }

        public Task MarkReadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkAllReadAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task MarkUnreadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task ArchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task UnarchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
