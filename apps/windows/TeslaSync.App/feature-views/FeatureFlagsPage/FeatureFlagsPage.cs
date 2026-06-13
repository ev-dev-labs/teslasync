using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.FeatureFlags;
using TeslaSync.App.Notifications;
using Modals = TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>FeatureFlagsPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/FeatureFlagsPage.tsx</c> (route <c>/admin/flags</c>, nav name
/// <c>FeatureFlagsAdmin</c>). It binds to a <see cref="FeatureFlagsPageViewModel"/> and reproduces every web region
/// with Fluent components and design tokens: the page header (title + subtitle + the <c>query={flags}</c>
/// data-freshness chip + the "Add flag" CTA), the registry glass panel (GlassPanel 1 — a Flag-titled
/// <see cref="FlagsTable"/>) and the recent-changes glass panel (GlassPanel 2 — a History-titled
/// <see cref="ChangesPanel"/>), the slide-in <see cref="Modals.FlagEditDrawer"/> create/edit side sheet, and the
/// delete confirm dialog with its audit-required reason input. The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model and the composed surfaces' projections. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class FeatureFlagsPage : UserControl, IDisposable
{
    private const string RegistryGlyph = "\uE7C1"; // Segoe Fluent — Flag; web lucide Flag (the registry panel).
    private const string ChangesGlyph = "\uE81C";  // Segoe Fluent — History; web lucide History (the changes panel).
    private const string AddGlyph = "\uE710";      // Segoe Fluent — Add (plus); web lucide Plus (the "Add flag" CTA).

    private readonly FeatureFlagsPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _deleteShowing;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();
    private readonly TsButton _addButton = new() { Variant = ButtonVariant.Primary, IconGlyph = AddGlyph };

    private readonly PanelTitle _registryTitle = new();
    private readonly PanelTitle _changesTitle = new();

    private readonly FlagsTable _flagsTable;
    private readonly ChangesPanel _changesPanel;
    private readonly Modals.FlagEditDrawer _editDrawer;

    private FlagsTableModel? _lastFlagsModel;
    private ChangesPanelModel? _lastChangesModel;

    /// <summary>Creates the page over the default local-state feeds and the shell resource localizer.</summary>
    public FeatureFlagsPage()
        : this(
            EmptyFeatureFlagsFeed.Instance,
            EmptyFlagChangesFeed.Instance,
            NoopFlagWriteService.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / dependency injection).</summary>
    /// <param name="flagsFeed">The flag-registry data port (web <c>useFlags</c>).</param>
    /// <param name="changesFeed">The flag-change-audit data port (web <c>useFlagChanges</c>).</param>
    /// <param name="writeService">The set / delete write port (web <c>useSetFlag</c> / <c>useDeleteFlag</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public FeatureFlagsPage(
        IFeatureFlagsFeed flagsFeed,
        IFlagChangesFeed changesFeed,
        IFlagWriteService writeService,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(flagsFeed);
        ArgumentNullException.ThrowIfNull(changesFeed);
        ArgumentNullException.ThrowIfNull(writeService);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new FeatureFlagsPageViewModel(flagsFeed, changesFeed, writeService, localizer);

        _flagsTable = new FlagsTable(localizer);
        _changesPanel = new ChangesPanel(localizer);
        _editDrawer = new Modals.FlagEditDrawer(localizer);

        Content = BuildLayout();

        _addButton.Click += OnAddClick;
        _flagsTable.EditRequested += OnEditRequested;
        _flagsTable.DeleteRequested += OnDeleteRequested;
        _editDrawer.ViewModel.SaveRequested += OnSaveRequested;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The diagnostics surface slug (<c>FeatureFlagsPage</c>).</summary>
    public static string Slug => FeatureFlagsRegistration.Slug;

    private Grid BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildPanel(RegistryGlyph, _registryTitle, _flagsTable));
        stack.Children.Add(BuildPanel(ChangesGlyph, _changesTitle, _changesPanel));

        var scroller = new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        // The edit drawer is a right-anchored slide-in side sheet that overlays the page; it renders nothing until
        // a flag is created/edited, so it sits on top of the scrolled content in the page root.
        var root = new Grid();
        root.Children.Add(scroller);
        root.Children.Add(_editDrawer);
        return root;
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        // web PageContainer right cluster: {resolvedQuery && <DataFreshnessAuto/>}{actions} — the freshness chip,
        // then the "Add flag" CTA.
        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        _freshness.VerticalAlignment = VerticalAlignment.Center;
        actions.Children.Add(_freshness);
        actions.Children.Add(_addButton);

        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(heading, 0);
        Grid.SetColumn(actions, 1);
        header.Children.Add(heading);
        header.Children.Add(actions);
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
        _addButton.Click -= OnAddClick;
        _flagsTable.EditRequested -= OnEditRequested;
        _flagsTable.DeleteRequested -= OnDeleteRequested;
        _editDrawer.ViewModel.SaveRequested -= OnSaveRequested;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _editDrawer.Dispose();
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
        _addButton.Text = _viewModel.AddLabel;
        AutomationProperties.SetName(this, _viewModel.Title);
        AutomationProperties.SetName(_addButton, _viewModel.AddLabel);

        // web PageContainer query={flags}: the page-tier data-freshness chip (loading → "Updating…",
        // error → "Error", success → "Live") tied to the flag-registry query.
        _freshness.UpdatedAt = _viewModel.FlagsUpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsFlagsError;

        _registryTitle.Value = _viewModel.PanelRegistryTitle;
        _changesTitle.Value = _viewModel.PanelChangesTitle;

        // Only reassign a child model when it actually changed, so a background poll never resets the FlagsTable
        // pagination / sort or re-announces a static surface.
        FlagsTableModel flagsModel = _viewModel.FlagsModel;
        if (!flagsModel.Equals(_lastFlagsModel))
        {
            _flagsTable.Model = flagsModel;
            _lastFlagsModel = flagsModel;
        }

        ChangesPanelModel changesModel = _viewModel.ChangesModel;
        if (!changesModel.Equals(_lastChangesModel))
        {
            _changesPanel.Model = changesModel;
            _lastChangesModel = changesModel;
        }
    }

    // web handleCreate: setEditing(null); setEditorOpen(true) — open the drawer in "create new" mode.
    private void OnAddClick(object sender, RoutedEventArgs e) => _editDrawer.ViewModel.Open(null);

    // web handleEdit(row): setEditing(row); setEditorOpen(true) — open the drawer seeded with the flag.
    private void OnEditRequested(object? sender, FeatureFlagEntry entry) =>
        _editDrawer.ViewModel.Open(new Modals.FeatureFlagEntry(entry.Key, entry.Value));

    // web handleSave: await setFlag.mutateAsync(input); on success close the drawer, else keep it open for retry.
    private async void OnSaveRequested(object? sender, Modals.FlagEditSaveRequest request)
    {
        _editDrawer.ViewModel.Saving = true;
        bool ok = await _viewModel.SaveFlagAsync(request.Key, request.Value, request.Reason).ConfigureAwait(true);
        _editDrawer.ViewModel.Saving = false;
        if (ok)
        {
            _editDrawer.ViewModel.RequestClose();
        }
    }

    // web handleAskDelete(row): setPendingDelete(row); setDeleteReason('') — open the reason-gated confirm dialog.
    private async void OnDeleteRequested(object? sender, FeatureFlagEntry entry)
    {
        if (_deleteShowing)
        {
            return;
        }

        _deleteShowing = true;
        try
        {
            await ShowDeleteDialogAsync(entry).ConfigureAwait(true);
        }
        finally
        {
            _deleteShowing = false;
        }
    }

    private async Task ShowDeleteDialogAsync(FeatureFlagEntry entry)
    {
        var reasonInput = new TsInput
        {
            Header = _viewModel.DeleteReasonLabel,
            Hint = _viewModel.DeleteReasonPrompt,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(reasonInput, _viewModel.DeleteReasonLabel);

        var message = new Text { Value = _viewModel.DeleteMessage(entry.Key) };

        var body = new StackPanel { Spacing = 16, MinWidth = 320 };
        body.Children.Add(message);
        body.Children.Add(reasonInput);

        var dialog = new ContentDialog
        {
            Title = _viewModel.DeleteTitle,
            Content = body,
            PrimaryButtonText = _viewModel.DeleteConfirmLabel,
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Close,
            IsPrimaryButtonEnabled = false,
            XamlRoot = XamlRoot,
        };

        // web: the Delete button is disabled until the reason is non-empty (deleteReason.trim().length === 0).
        reasonInput.TextChanged += (_, _) => dialog.IsPrimaryButtonEnabled = reasonInput.Text.Trim().Length > 0;

        // web handleConfirmDelete: await deleteFlag.mutateAsync({ key, reason }); the dialog stays open (busy) while
        // the mutation runs and is kept open on failure so the operator can retry without re-typing.
        async void OnPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
        {
            string reason = reasonInput.Text.Trim();
            if (reason.Length == 0)
            {
                args.Cancel = true;
                return;
            }

            var deferral = args.GetDeferral();
            try
            {
                bool ok = await _viewModel.DeleteFlagAsync(entry.Key, reason).ConfigureAwait(true);
                if (!ok)
                {
                    args.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        }

        dialog.PrimaryButtonClick += OnPrimary;
        try
        {
            await dialog.ShowAsync().AsTask().ConfigureAwait(true);
        }
        finally
        {
            dialog.PrimaryButtonClick -= OnPrimary;
        }
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new FeatureFlagsPageAutomationPeer(this);

    private sealed class FeatureFlagsPageAutomationPeer(FeatureFlagsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Pane;
    }
}
