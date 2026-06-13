using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>AlertRulesPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/AlertRulesPage.tsx</c> (route <c>/notifications/rules</c>, nav name
/// <c>NotificationsRules</c>). It binds to an <see cref="AlertRulesPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page title + subtitle, the cross-tab edit-conflict banner, the
/// bulk-action toolbar (enable / disable / delete-with-confirm), and a single glass panel that switches between
/// the loading skeletons, the error surface, the empty state and the rules table. Each table row carries a
/// selection checkbox, an inline-rename editor + an open-in-studio affordance, the signal, a severity chip and an
/// enabled/disabled badge. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="AlertRulesDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AlertRulesPage : UserControl, IDisposable
{
    private const string EnableGlyph = "\uE768";   // Segoe Fluent "Play".
    private const string DisableGlyph = "\uE769";  // Segoe Fluent "Pause".
    private const string DeleteGlyph = "\uE74D";   // Segoe Fluent "Delete".
    private const string AddGlyph = "\uE710";      // Segoe Fluent "Add".
    private const string StudioGlyph = "\uE8A7";   // Segoe Fluent "OpenInNewWindow".

    private readonly AlertRulesPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly EditConflictBanner _conflictBanner;
    private readonly BulkActionsToolbar _bulkBar;

    private readonly StackPanel _loadingPanel;
    private readonly TsErrorDisplay _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uEA8F" };

    private readonly StackPanel _tableSection;
    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 8, 12, 8) };
    private readonly TsCheckbox _masterCheck = new() { IsThreeState = true, MinWidth = 0 };
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };
    private readonly ErrorText _nameError = new() { Margin = new Thickness(12, 8, 12, 0) };

    private readonly TsButton _openStudioButton = new()
    {
        Variant = ButtonVariant.Secondary,
        Size = ControlSize.Small,
        IconGlyph = AddGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly Dictionary<long, TsCheckbox> _rowChecks = new();
    private bool _suppressEvents;
    private string _rowsSignature = "\u0000";

    /// <summary>Raised when a rule link or the studio affordances request navigation (web router push).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>Creates the page over the default empty-state feed and the shell resource localizer.</summary>
    public AlertRulesPage()
        : this(EmptyAlertRulesFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The rule-list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AlertRulesPage(IAlertRulesFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AlertRulesPageViewModel(feed, localizer);

        var display = _viewModel.Display;

        // Claim-scoped edit-conflict banner (web useEditLease('alert-rules/list') + EditConflictBanner). A peer
        // lease drives the visible "another tab is editing" warning; until then the banner stays collapsed.
        _conflictBanner = new EditConflictBanner(
            localizer,
            new StaticEditLeaseSource(),
            display.EditConflictResourceLabel);

        _bulkBar = new BulkActionsToolbar(
            BuildBulkActions(display.BulkLabels),
            localizer,
            new BulkItemNoun(display.BulkLabels.NounOne, display.BulkLabels.NounOther));

        _loadingPanel = BuildLoadingPanel();
        _tableSection = BuildTableSection();

        Content = BuildLayout();

        _masterCheck.Click += OnMasterToggle;
        _errorState.ActionInvoked += OnRetryInvoked;
        _emptyState.ActionInvoked += OnOpenStudio;
        _openStudioButton.Click += OnOpenStudioClick;
        _bulkBar.SelectionCleared += OnSelectionCleared;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(display);
    }

    /// <summary>The diagnostics surface slug (<c>AlertRulesPage</c>).</summary>
    public static string Slug => AlertRulesRegistration.Slug;

    private BulkAction[] BuildBulkActions(AlertRulesBulkLabels labels)
    {
        var enable = new BulkAction(
            "enable",
            labels.Enable,
            _ => _viewModel.BulkEnableAsync(_viewModel.SelectedIds),
            BulkActionVariant.Default,
            iconGlyph: EnableGlyph);

        var disable = new BulkAction(
            "disable",
            labels.Disable,
            _ => _viewModel.BulkDisableAsync(_viewModel.SelectedIds),
            BulkActionVariant.Default,
            iconGlyph: DisableGlyph);

        var delete = new BulkAction(
            "delete",
            labels.Delete,
            _ => _viewModel.BulkDeleteAsync(_viewModel.SelectedIds),
            BulkActionVariant.Danger,
            iconGlyph: DeleteGlyph,
            confirm: new BulkActionConfirmation(
                labels.DeleteConfirmTitle,
                labels.DeleteConfirmBody,
                labels.DeleteConfirmLabel));

        return new BulkAction[] { enable, disable, delete };
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(_title);
        stack.Children.Add(_subtitle);
        stack.Children.Add(_conflictBanner);
        stack.Children.Add(_bulkBar);
        stack.Children.Add(BuildPanel());
        stack.Children.Add(_openStudioButton);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildPanel()
    {
        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_emptyState);
        body.Children.Add(_tableSection);

        return new TsGlassPanel { Content = body };
    }

    private StackPanel BuildTableSection()
    {
        var section = new StackPanel { Spacing = 0 };
        ApplyColumns(_tableHeader);
        section.Children.Add(_tableHeader);
        section.Children.Add(_rowsPanel);
        section.Children.Add(_nameError);
        return section;
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 8, Padding = new Thickness(16) };
        for (int i = 0; i < 3; i++)
        {
            panel.Children.Add(new TsSkeleton { BlockHeight = 40, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        return panel;
    }

    private static void ApplyColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });                 // Select
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Name
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(200) });                // Signal
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(150) });                // Severity
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });                // Status
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _masterCheck.Click -= OnMasterToggle;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _emptyState.ActionInvoked -= OnOpenStudio;
        _openStudioButton.Click -= OnOpenStudioClick;
        _bulkBar.SelectionCleared -= OnSelectionCleared;
        _conflictBanner.Dispose();
        _bulkBar.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

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

    private void Render(AlertRulesDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        _loadingPanel.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.HasError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.ActionText = display.EmptyCtaLabel;

        _tableSection.Visibility = Show(display.ShowRows);
        RebuildHeader(display);
        RenderTable(display);

        _nameError.Value = display.NameError ?? string.Empty;
        _nameError.Visibility = Show(display.HasNameError);

        _openStudioButton.Text = display.OpenStudioLabel;
        AutomationProperties.SetName(_openStudioButton, display.OpenStudioLabel);

        _bulkBar.SetSelection(SelectionIds(display), display.TotalCount);

        _suppressEvents = false;
    }

    private void RebuildHeader(AlertRulesDisplay display)
    {
        _tableHeader.Children.Clear();
        ApplyColumns(_tableHeader);

        _masterCheck.IsChecked = ToCheckState(display.MasterState);
        AutomationProperties.SetName(_masterCheck, display.SelectAllLabel);
        ToolTipService.SetToolTip(_masterCheck, display.SelectAllLabel);
        Grid.SetColumn(_masterCheck, 0);
        _tableHeader.Children.Add(_masterCheck);

        AddHeaderCell(display.ColumnLabels.Name, 1);
        AddHeaderCell(display.ColumnLabels.Signal, 2);
        AddHeaderCell(display.ColumnLabels.Severity, 3);
        AddHeaderCell(display.ColumnLabels.Status, 4);
    }

    private void AddHeaderCell(string text, int column)
    {
        var label = new Label { Value = text, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, column);
        _tableHeader.Children.Add(label);
    }

    private void RenderTable(AlertRulesDisplay display)
    {
        string signature = RowsSignature(display.Rows);
        if (signature != _rowsSignature)
        {
            _rowsSignature = signature;
            RebuildRows(display);
            return;
        }

        // Same rule set — update only the per-row selection so an in-progress inline rename is preserved.
        foreach (var row in display.Rows)
        {
            if (_rowChecks.TryGetValue(row.Id, out var check))
            {
                check.IsChecked = row.IsSelected;
            }
        }
    }

    private void RebuildRows(AlertRulesDisplay display)
    {
        _rowsPanel.Children.Clear();
        _rowChecks.Clear();

        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row, display.SelectRowLabel));
        }
    }

    private Border BuildRow(AlertRuleRow row, string selectRowLabel)
    {
        var grid = new Grid { Padding = new Thickness(12, 6, 12, 6), VerticalAlignment = VerticalAlignment.Center };
        ApplyColumns(grid);

        long id = row.Id;
        var check = new TsCheckbox { IsChecked = row.IsSelected, MinWidth = 0, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(check, row.SelectRuleLabel);
        ToolTipService.SetToolTip(check, selectRowLabel);
        check.Click += (_, _) =>
        {
            if (!_suppressEvents)
            {
                _viewModel.ToggleSelect(id);
            }
        };
        _rowChecks[id] = check;
        Grid.SetColumn(check, 0);
        grid.Children.Add(check);

        var nameCell = BuildNameCell(row);
        Grid.SetColumn(nameCell, 1);
        grid.Children.Add(nameCell);

        var signal = new Text { Value = row.SignalName, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(signal, 2);
        grid.Children.Add(signal);

        var severity = new TsSeverityBadge { Severity = row.Severity, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left };
        Grid.SetColumn(severity, 3);
        grid.Children.Add(severity);

        var status = new TsBadge
        {
            Status = row.StatusVariant,
            Content = row.StatusLabel,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        Grid.SetColumn(status, 4);
        grid.Children.Add(status);

        var border = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = Brush("TsColorBorderBrush"),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private StackPanel BuildNameCell(AlertRuleRow row)
    {
        long id = row.Id;
        string originalName = row.Name;

        var editor = new TsEditableText
        {
            Value = row.Name,
            EditLabel = row.RenameLabel,
            ConfirmLabel = _localizer.GetString("common.save", "Save"),
            CancelLabel = _localizer.GetString("common.cancel", "Cancel"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        editor.ValueCommitted += async (_, next) =>
        {
            bool attempted = await _viewModel.RenameAsync(id, next).ConfigureAwait(true);
            if (!attempted && _viewModel.Display.HasNameError)
            {
                // Validation rejected the rename — restore the editor to the persisted name (web keeps the old value).
                editor.Value = originalName;
            }
        };

        var openStudio = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = StudioGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        string openLabel = string.Create(CultureInfo.CurrentCulture, $"{_viewModel.Display.OpenStudioLabel}: {row.Name}");
        AutomationProperties.SetName(openStudio, openLabel);
        ToolTipService.SetToolTip(openStudio, openLabel);
        openStudio.Click += (_, _) => RequestNavigation(row.StudioRoute);

        var cell = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        cell.Children.Add(editor);
        cell.Children.Add(openStudio);
        return cell;
    }

    private void OnMasterToggle(object sender, RoutedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.ToggleSelectAll();
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnSelectionCleared(object? sender, EventArgs e) => _viewModel.ClearSelection();

    private void OnOpenStudio(object? sender, EventArgs e) => RequestNavigation(_viewModel.Display.StudioRoute);

    private void OnOpenStudioClick(object sender, RoutedEventArgs e) => RequestNavigation(_viewModel.Display.StudioRoute);

    private void RequestNavigation(string route) => NavigationRequested?.Invoke(this, route);

    private static List<BulkSelectionId> SelectionIds(AlertRulesDisplay display) =>
        display.Rows.Where(r => r.IsSelected).Select(r => BulkSelectionId.Number(r.Id)).ToList();

    private static bool? ToCheckState(MasterSelectionState state) => state switch
    {
        MasterSelectionState.All => true,
        MasterSelectionState.Some => null,
        _ => false,
    };

    private static string RowsSignature(IReadOnlyList<AlertRuleRow> rows)
    {
        if (rows.Count == 0)
        {
            return "\u0001";
        }

        var parts = rows.Select(r => string.Create(
            CultureInfo.InvariantCulture,
            $"{r.Id}:{r.Name}:{r.SignalName}:{r.Severity}:{r.Enabled}"));
        return string.Join("|", parts);
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
