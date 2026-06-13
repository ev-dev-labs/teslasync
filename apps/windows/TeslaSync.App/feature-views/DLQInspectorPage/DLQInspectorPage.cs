using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>DLQInspectorPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/DLQInspectorPage.tsx</c> (route <c>/admin/dlq</c>, nav name <c>DLQInspector</c>).
/// It binds to a <see cref="DlqInspectorPageViewModel"/> and reproduces every web region with Fluent components and
/// design tokens: the page header (title + subtitle + the <c>query={list}</c> data-freshness chip), the dismissible
/// replay-blocked warning banner (web <c>replayDisabledBanner</c>), the retryable list-error InfoBar, the status
/// tiles (<see cref="StatusHeader"/>), the dead-letter-entries glass panel (GlassPanel 1 — an <see cref="EntriesTable"/>
/// behind an AlertOctagon-titled header), the recent-replay-activity glass panel (GlassPanel 2 — an
/// <see cref="AuditPanel"/> behind a History-titled header), the slide-in <see cref="EntryDrawer"/> and the replay
/// confirm dialog. The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model
/// and the composed surfaces' projections. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DLQInspectorPage : UserControl, IDisposable
{
    private const string EntriesGlyph = "\uEA39"; // ErrorBadge — the web lucide AlertOctagon (dead-letter entries).
    private const string AuditGlyph = "\uE81C";   // History — the web lucide History (recent replay activity).

    private readonly DlqInspectorPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _confirmShowing;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly TsAlertBanner _replayBlockedBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false };
    private readonly TsQueryError _listError = new();

    private readonly StatusHeader _statusHeader;
    private readonly EntriesTable _entriesTable;
    private readonly AuditPanel _auditPanel;
    private readonly EntryDrawer _entryDrawer;

    private readonly PanelTitle _entriesTitle = new();
    private readonly PanelTitle _auditTitle = new();

    private StatusHeaderModel? _lastStatusModel;
    private EntriesTableModel? _lastEntriesModel;
    private AuditPanelModel? _lastAuditModel;

    /// <summary>Creates the page over the default local-state feeds and the shell resource localizer.</summary>
    public DLQInspectorPage()
        : this(
            EmptyDlqListFeed.Instance,
            EmptyDlqEntryFeed.Instance,
            EmptyDlqAuditFeed.Instance,
            EmptyDlqReplayService.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / dependency injection).</summary>
    /// <param name="listFeed">The DLQ list port (web <c>useDLQList</c>).</param>
    /// <param name="entryFeed">The single-entry port (web <c>useDLQEntry</c>).</param>
    /// <param name="auditFeed">The replay-audit port (web <c>useDLQAudit</c>).</param>
    /// <param name="replayService">The replay command port (web <c>useDLQReplay</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DLQInspectorPage(
        IDlqListFeed listFeed,
        IDlqEntryFeed entryFeed,
        IDlqAuditFeed auditFeed,
        IDlqReplayService replayService,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(listFeed);
        ArgumentNullException.ThrowIfNull(entryFeed);
        ArgumentNullException.ThrowIfNull(auditFeed);
        ArgumentNullException.ThrowIfNull(replayService);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new DlqInspectorPageViewModel(listFeed, entryFeed, auditFeed, replayService, localizer);

        _statusHeader = new StatusHeader(localizer);
        _entriesTable = new EntriesTable(localizer) { Inspect = OnInspect };
        _auditPanel = new AuditPanel(localizer);
        _entryDrawer = new EntryDrawer(_viewModel.Drawer, localizer);

        Content = BuildLayout();

        _replayBlockedBanner.Dismissed += OnBannerDismissed;
        _listError.ActionInvoked += OnRetryInvoked;
        _viewModel.ReplayConfirmRequested += OnReplayConfirmRequested;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The diagnostics surface slug (<c>DLQInspectorPage</c>).</summary>
    public static string Slug => DlqInspectorRegistration.Slug;

    private Grid BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_replayBlockedBanner);
        stack.Children.Add(_listError);
        stack.Children.Add(_statusHeader);
        stack.Children.Add(BuildPanel(EntriesGlyph, _entriesTitle, _entriesTable));
        stack.Children.Add(BuildPanel(AuditGlyph, _auditTitle, _auditPanel));

        var scroller = new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        // The entry drawer is a right-anchored slide-in side sheet that overlays the page; it renders nothing until
        // an entry is inspected, so it sits on top of the scrolled content in the page root.
        var root = new Grid();
        root.Children.Add(scroller);
        root.Children.Add(_entryDrawer);
        return root;
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(heading, 0);
        _freshness.VerticalAlignment = VerticalAlignment.Top;
        _freshness.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(_freshness, 1);

        header.Children.Add(heading);
        header.Children.Add(_freshness);
        return header;
    }

    // A web `<GlassPanel className="p-6">` whose header is an icon + PanelTitle row above the section content.
    private static TsGlassPanel BuildPanel(string glyph, PanelTitle title, FrameworkElement content)
    {
        var headerRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(0, 0, 0, 16),
        };
        var icon = new FontIcon { Glyph = glyph, FontSize = 18, Foreground = DisplayTokens.TextMuted };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        title.VerticalAlignment = VerticalAlignment.Center;
        headerRow.Children.Add(icon);
        headerRow.Children.Add(title);

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(headerRow);
        body.Children.Add(content);

        return new TsGlassPanel { Content = body, Padding = new Thickness(24) };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + drawer (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _replayBlockedBanner.Dismissed -= OnBannerDismissed;
        _listError.ActionInvoked -= OnRetryInvoked;
        _viewModel.ReplayConfirmRequested -= OnReplayConfirmRequested;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _entryDrawer.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render();
        }
        else
        {
            _dispatcher.TryEnqueue(Render);
        }
    }

    private void Render()
    {
        _title.Value = _viewModel.Title;
        _subtitle.Value = _viewModel.Subtitle;
        AutomationProperties.SetName(this, _viewModel.Title);

        // web PageContainer query={list}: the page-tier data-freshness chip (loading → "Updating…",
        // error → "Error", success → "Live") tied to the DLQ list query.
        _freshness.UpdatedAt = _viewModel.ListUpdatedAt;
        _freshness.IsFetching = _viewModel.IsListFetching;
        _freshness.IsError = _viewModel.IsListError;

        // Replay-blocked banner (web replayDisabledBanner).
        _replayBlockedBanner.Title = _viewModel.BannerTitle;
        _replayBlockedBanner.Message = _viewModel.BannerMessage;
        _replayBlockedBanner.IsOpen = _viewModel.ReplayDisabledBannerVisible;
        _replayBlockedBanner.Visibility = Show(_viewModel.ReplayDisabledBannerVisible);

        // Retryable list-error surface (the native InfoBar + Retry for the list data state).
        _listError.Title = _viewModel.ListErrorText;
        _listError.ActionText = _viewModel.RetryLabel;
        _listError.Visibility = Show(_viewModel.ShowListError);
        AutomationProperties.SetName(_listError, _viewModel.ListErrorText);

        _entriesTitle.Value = _viewModel.PanelEntriesTitle;
        _auditTitle.Value = _viewModel.PanelAuditTitle;

        // Only reassign a child model when it actually changed, so a background poll never resets the entries-table
        // pagination or re-announces a static surface.
        StatusHeaderModel status = _viewModel.StatusModel;
        if (!status.Equals(_lastStatusModel))
        {
            _statusHeader.Model = status;
            _lastStatusModel = status;
        }

        EntriesTableModel entries = _viewModel.EntriesModel;
        if (!entries.Equals(_lastEntriesModel))
        {
            _entriesTable.Model = entries;
            _lastEntriesModel = entries;
        }

        AuditPanelModel audit = _viewModel.AuditModel;
        if (!audit.Equals(_lastAuditModel))
        {
            _auditPanel.Model = audit;
            _lastAuditModel = audit;
        }
    }

    private void OnInspect(DlqEntrySummary row) => _viewModel.Inspect(row);

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnBannerDismissed(object? sender, EventArgs e) => _viewModel.DismissReplayBanner();

    private async void OnReplayConfirmRequested(object? sender, EventArgs e)
    {
        if (_confirmShowing)
        {
            return;
        }

        _confirmShowing = true;
        try
        {
            var dialog = new TsConfirmDialog
            {
                Title = _viewModel.ConfirmTitle,
                Content = _viewModel.ConfirmMessage,
                PrimaryButtonText = _viewModel.ConfirmLabel,
                CloseButtonText = _viewModel.CancelLabel,
                IsDestructive = false,
                XamlRoot = XamlRoot,
            };

            // web ConfirmDialog loading={replay.isPending}: keep the dialog open with its primary button busy while
            // the replay runs (the ContentDialog deferral disables the buttons until ConfirmReplayAsync completes).
            dialog.PrimaryButtonClick += OnConfirmPrimary;

            ContentDialogResult result = await dialog.ShowAsync().AsTask().ConfigureAwait(true);
            dialog.PrimaryButtonClick -= OnConfirmPrimary;

            if (result != ContentDialogResult.Primary)
            {
                _viewModel.CancelReplay();
            }
        }
        finally
        {
            _confirmShowing = false;
        }
    }

    private async void OnConfirmPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            await _viewModel.ConfirmReplayAsync().ConfigureAwait(true);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
