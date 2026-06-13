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
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>RbacMatrixPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/RbacMatrixPage.tsx</c> (nav name <c>RbacMatrix</c>). It binds to a
/// <see cref="RbacMatrixPageViewModel"/> and reproduces every web region with Fluent components and design tokens:
/// the page header (title + subtitle), the forward-auth notice glass panel (GlassPanel 1), the summary glass panel
/// (GlassPanel 2 — the my-roles + effective-permissions pills, the optional groups-header caption and the
/// edit/save/cancel controls) and the matrix glass panel (GlassPanel 3 — the role × permission grid with read-only
/// check/dash cells or, in edit mode, toggle check boxes). The three remaining web branches — the loading spinner,
/// the "no roles configured" empty surface and the load-failure banner with Retry — are rendered through the shared
/// feedback surfaces. The view is a thin renderer: all branch selection, formatting, i18n and the dirty-cell diff
/// live in the view-model. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class RbacMatrixPage : UserControl, IDisposable
{
    private const string EffectiveGlyph = "\uEA18"; // Segoe Fluent — Shield; web lucide ShieldCheck (effective pill).
    private const string EditGlyph = "\uE785";      // Segoe Fluent — Unlock; web lucide Unlock (the Edit CTA).
    private const string SaveGlyph = "\uE72E";      // Segoe Fluent — Permissions/lock; web lucide Lock (the Save CTA).
    private const string EmptyGlyph = "\uEA18";     // Segoe Fluent — Shield; web lucide ShieldCheck (empty surface).
    private const string AllowedCell = "\u2713";    // ✓ — web allowed glyph.
    private const string DeniedCell = "\u2013";     // – — web denied glyph.

    private readonly RbacMatrixPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // GlassPanel 1 — the forward-auth (open-auth) notice.
    private readonly Heading _openModeTitle = new();
    private readonly HelperText _openModeMessage = new();
    private readonly TsGlassPanel _openModePanel;

    // Loading / empty / error feedback surfaces.
    private readonly TsSpinner _loading = new() { Size = ControlSize.Large };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EmptyGlyph };
    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, Dismissible = false };

    // GlassPanel 2 — the summary (pills + edit/save/cancel).
    private readonly TsBadge _myRolesBadge = new() { Status = StatusKind.Neutral };
    private readonly TextBlock _myRolesText = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TsBadge _effectiveBadge = new() { Status = StatusKind.Success };
    private readonly TextBlock _effectiveText = new();
    private readonly Caption _groupsHeaderCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _editButton = new() { Variant = ButtonVariant.Secondary, IconGlyph = EditGlyph };
    private readonly TsButton _cancelButton = new() { Variant = ButtonVariant.Subtle };
    private readonly TsButton _saveButton = new() { Variant = ButtonVariant.Primary, IconGlyph = SaveGlyph };
    private readonly StackPanel _actionCluster;
    private readonly TsGlassPanel _summaryPanel;

    // The save-failure banner (web submitError).
    private readonly TsAlertBanner _submitErrorBanner = new() { Variant = CalloutVariant.Danger, Dismissible = false };

    // GlassPanel 3 — the matrix grid host.
    private readonly Border _matrixHost = new();
    private readonly TsGlassPanel _matrixPanel;

    private readonly StackPanel _readyHost;
    private readonly Grid _contentHost;

    private RbacMatrixSnapshot? _lastStructuralSnapshot;
    private bool _lastStructuralEditing;
    private bool _structureBuilt;

    /// <summary>Creates the page over the default open-auth feed and the shell resource localizer.</summary>
    public RbacMatrixPage()
        : this(OpenModeRbacMatrixFeed.Instance, NoopRbacWriteService.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data ports and a localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The matrix data port (web <c>useRbacMatrix</c>).</param>
    /// <param name="writeService">The cell upsert write port (web <c>useUpsertRbacCells</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public RbacMatrixPage(IRbacMatrixFeed feed, IRbacWriteService writeService, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(writeService);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RbacMatrixPageViewModel(feed, writeService, localizer);

        _openModePanel = BuildOpenModePanel();
        _actionCluster = BuildActionCluster();
        _summaryPanel = BuildSummaryPanel();
        _matrixPanel = BuildMatrixPanel();
        _readyHost = BuildReadyHost();
        _contentHost = BuildContentHost();

        Content = BuildLayout();

        _editButton.Click += OnEditClick;
        _cancelButton.Click += OnCancelClick;
        _saveButton.Click += OnSaveClick;
        _errorBanner.ActionInvoked += OnRetryInvoked;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The diagnostics surface slug (<c>RbacMatrixPage</c>).</summary>
    public static string Slug => RbacMatrixRegistration.Slug;

    private Grid BuildLayout()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(heading);
        stack.Children.Add(_contentHost);

        var scroller = new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };

        var root = new Grid();
        root.Children.Add(scroller);
        return root;
    }

    private Grid BuildContentHost()
    {
        var host = new Grid { MinHeight = 200 };

        var loadingHost = new Grid { MinHeight = 200 };
        loadingHost.Children.Add(_loading);
        _loading.HorizontalAlignment = HorizontalAlignment.Center;
        _loading.VerticalAlignment = VerticalAlignment.Center;

        host.Children.Add(loadingHost);
        host.Children.Add(_openModePanel);
        host.Children.Add(_errorBanner);
        host.Children.Add(_emptyState);
        host.Children.Add(_readyHost);

        _loadingRegion = loadingHost;
        return host;
    }

    private Grid? _loadingRegion;

    private TsGlassPanel BuildOpenModePanel()
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(_openModeTitle);
        stack.Children.Add(_openModeMessage);

        var panel = new TsGlassPanel { Content = stack, Padding = new Thickness(24) };
        AutomationProperties.SetName(panel, _viewModel.OpenModeTitle);
        return panel;
    }

    private StackPanel BuildActionCluster()
    {
        var cluster = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        cluster.Children.Add(_editButton);
        cluster.Children.Add(_cancelButton);
        cluster.Children.Add(_saveButton);
        return cluster;
    }

    private TsGlassPanel BuildSummaryPanel()
    {
        _myRolesBadge.Content = _myRolesText;

        var effectiveContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var shield = new FontIcon { Glyph = EffectiveGlyph, FontSize = 12 };
        AutomationProperties.SetAccessibilityView(shield, AccessibilityView.Raw);
        effectiveContent.Children.Add(shield);
        effectiveContent.Children.Add(_effectiveText);
        _effectiveBadge.Content = effectiveContent;

        var pills = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pills.Children.Add(_myRolesBadge);
        pills.Children.Add(_effectiveBadge);
        pills.Children.Add(_groupsHeaderCaption);

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(pills, 0);
        Grid.SetColumn(_actionCluster, 1);
        row.Children.Add(pills);
        row.Children.Add(_actionCluster);

        return new TsGlassPanel { Content = row, Padding = new Thickness(16) };
    }

    private TsGlassPanel BuildMatrixPanel()
    {
        var scroller = new ScrollViewer
        {
            Content = _matrixHost,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };
        return new TsGlassPanel { Content = scroller, Padding = new Thickness(0) };
    }

    private StackPanel BuildReadyHost()
    {
        var host = new StackPanel { Spacing = 16 };
        host.Children.Add(_summaryPanel);
        host.Children.Add(_submitErrorBanner);
        host.Children.Add(_matrixPanel);
        return host;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _editButton.Click -= OnEditClick;
        _cancelButton.Click -= OnCancelClick;
        _saveButton.Click -= OnSaveClick;
        _errorBanner.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
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

    private void OnEditClick(object sender, RoutedEventArgs e) => _viewModel.EnterEdit();

    private void OnCancelClick(object sender, RoutedEventArgs e) => _viewModel.CancelEdit();

    private async void OnSaveClick(object sender, RoutedEventArgs e) =>
        await _viewModel.SaveAsync().ConfigureAwait(true);

    private async void OnRetryInvoked(object? sender, EventArgs e) =>
        await _viewModel.RefreshAsync().ConfigureAwait(true);

    private void Render()
    {
        _title.Value = _viewModel.Title;
        _subtitle.Value = _viewModel.Subtitle;
        AutomationProperties.SetName(this, _viewModel.Title);

        RbacMatrixState state = _viewModel.State;

        // web: the subtitle rides on PageContainer for the open-auth / empty / ready branches; loading + error show
        // the title alone.
        _subtitle.Visibility = state is RbacMatrixState.OpenMode or RbacMatrixState.Empty or RbacMatrixState.Ready
            ? Visibility.Visible
            : Visibility.Collapsed;

        SetRegionVisibility(_loadingRegion, state == RbacMatrixState.Loading);
        SetRegionVisibility(_openModePanel, state == RbacMatrixState.OpenMode);
        SetRegionVisibility(_errorBanner, state == RbacMatrixState.Error);
        SetRegionVisibility(_emptyState, state == RbacMatrixState.Empty);
        SetRegionVisibility(_readyHost, state == RbacMatrixState.Ready);

        _openModeTitle.Value = _viewModel.OpenModeTitle;
        _openModeMessage.Value = _viewModel.OpenModeMessage;
        AutomationProperties.SetName(_openModePanel, _viewModel.OpenModeTitle);

        _errorBanner.Title = _viewModel.ErrorLoadTitle;
        _errorBanner.Message = _viewModel.ErrorLoadMessage;
        _errorBanner.ActionText = _viewModel.RetryLabel;

        _emptyState.Title = _viewModel.EmptyTitle;
        _emptyState.Message = _viewModel.EmptyMessage;

        if (state == RbacMatrixState.Ready)
        {
            RenderReady();
        }
    }

    private void RenderReady()
    {
        _myRolesText.Text = _viewModel.MyRolesText;
        _myRolesBadge.Status = _viewModel.MyRolesStatus;
        AutomationProperties.SetName(_myRolesBadge, _viewModel.MyRolesText);

        _effectiveText.Text = _viewModel.EffectiveText;
        _effectiveBadge.Status = _viewModel.EffectiveStatus;
        AutomationProperties.SetName(_effectiveBadge, _viewModel.EffectiveText);
        ToolTipService.SetToolTip(_effectiveBadge, _viewModel.EffectiveTooltip);

        _groupsHeaderCaption.Value = _viewModel.GroupsHeaderCaption;
        _groupsHeaderCaption.Visibility = _viewModel.HasGroupsHeader ? Visibility.Visible : Visibility.Collapsed;

        bool editing = _viewModel.Editing;
        _editButton.Visibility = editing ? Visibility.Collapsed : Visibility.Visible;
        _cancelButton.Visibility = editing ? Visibility.Visible : Visibility.Collapsed;
        _saveButton.Visibility = editing ? Visibility.Visible : Visibility.Collapsed;

        _editButton.Text = _viewModel.EditLabel;
        AutomationProperties.SetName(_editButton, _viewModel.EditLabel);

        _cancelButton.Text = _viewModel.CancelLabel;
        _cancelButton.IsEnabled = !_viewModel.IsSaving;
        AutomationProperties.SetName(_cancelButton, _viewModel.CancelLabel);

        _saveButton.Text = _viewModel.IsSaving ? _viewModel.SavingLabel : _viewModel.SaveLabel;
        _saveButton.IsEnabled = !_viewModel.IsSaving && _viewModel.DirtyCount > 0;
        AutomationProperties.SetName(_saveButton, _saveButton.Text);

        string? submitError = _viewModel.SubmitError;
        _submitErrorBanner.Visibility = string.IsNullOrEmpty(submitError) ? Visibility.Collapsed : Visibility.Visible;
        _submitErrorBanner.Message = submitError ?? string.Empty;

        RbacMatrixSnapshot? snapshot = _viewModel.Snapshot;
        if (!_structureBuilt || !ReferenceEquals(snapshot, _lastStructuralSnapshot) || editing != _lastStructuralEditing)
        {
            _matrixHost.Child = BuildMatrixGrid(editing);
            _lastStructuralSnapshot = snapshot;
            _lastStructuralEditing = editing;
            _structureBuilt = true;
        }
    }

    // GlassPanel 3 body: the role × permission grid. Rebuilt only when the snapshot or edit mode changes so an
    // in-edit toggle never tears down the check boxes (web reconciles; we rebuild structurally).
    private Grid BuildMatrixGrid(bool editing)
    {
        var grid = new Grid { Padding = new Thickness(4) };
        RbacMatrixSnapshot? snapshot = _viewModel.Snapshot;
        if (snapshot is null)
        {
            return grid;
        }

        AutomationProperties.SetName(grid, _viewModel.Title);

        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, MinWidth = 220 });
        foreach (RbacRole _ in snapshot.Roles)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto, MinWidth = 96 });
        }

        int rowIndex = 0;

        // Header row.
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var permHeader = new Label { Value = _viewModel.PermissionColumn };
        ApplyCellPadding(permHeader);
        Grid.SetRow(permHeader, rowIndex);
        Grid.SetColumn(permHeader, 0);
        grid.Children.Add(permHeader);

        for (int c = 0; c < snapshot.Roles.Count; c++)
        {
            var roleHeader = new Label
            {
                Value = snapshot.Roles[c].Name,
                HorizontalAlignment = HorizontalAlignment.Center,
                HorizontalContentAlignment = HorizontalAlignment.Center,
            };
            ApplyCellPadding(roleHeader);
            Grid.SetRow(roleHeader, rowIndex);
            Grid.SetColumn(roleHeader, c + 1);
            grid.Children.Add(roleHeader);
        }

        rowIndex++;

        foreach (RbacCategoryGroup group in _viewModel.GroupedPermissions())
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var categoryHeader = new Border
            {
                Background = DisplayTokens.Surface,
                Child = new Label { Value = _viewModel.CategoryLabel(group.Category) },
            };
            ApplyCellPadding((Label)categoryHeader.Child);
            Grid.SetRow(categoryHeader, rowIndex);
            Grid.SetColumn(categoryHeader, 0);
            Grid.SetColumnSpan(categoryHeader, 1 + snapshot.Roles.Count);
            grid.Children.Add(categoryHeader);
            rowIndex++;

            foreach (RbacPermissionEntry perm in group.Permissions)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

                var permCell = new StackPanel { Spacing = 0 };
                permCell.Children.Add(new Text { Value = perm.Name });
                permCell.Children.Add(new Caption { Value = perm.Id });
                ApplyCellPadding(permCell);
                Grid.SetRow(permCell, rowIndex);
                Grid.SetColumn(permCell, 0);
                grid.Children.Add(permCell);

                for (int c = 0; c < snapshot.Roles.Count; c++)
                {
                    RbacRole role = snapshot.Roles[c];
                    FrameworkElement cell;
                    if (editing)
                    {
                        cell = BuildEditCell(role.Id, perm.Id);
                    }
                    else
                    {
                        cell = BuildReadCell(role.Id, perm.Id);
                    }

                    Grid.SetRow(cell, rowIndex);
                    Grid.SetColumn(cell, c + 1);
                    grid.Children.Add(cell);
                }

                rowIndex++;
            }
        }

        return grid;
    }

    private TextBlock BuildReadCell(string roleId, string permId)
    {
        bool allowed = _viewModel.IsAllowed(roleId, permId);
        var glyph = new TextBlock
        {
            Text = allowed ? AllowedCell : DeniedCell,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = allowed ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextMuted,
            Margin = new Thickness(12, 8, 12, 8),
        };
        AutomationProperties.SetName(glyph, allowed ? _viewModel.CellAllowedLabel : _viewModel.CellDeniedLabel);
        return glyph;
    }

    private TsCheckbox BuildEditCell(string roleId, string permId)
    {
        var checkbox = new TsCheckbox
        {
            IsChecked = _viewModel.IsAllowed(roleId, permId),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            MinWidth = 0,
            Margin = new Thickness(12, 4, 0, 4),
        };
        AutomationProperties.SetName(checkbox, _viewModel.CellToggleLabel(roleId, permId));
        checkbox.Checked += (_, _) => _viewModel.Toggle(roleId, permId, true);
        checkbox.Unchecked += (_, _) => _viewModel.Toggle(roleId, permId, false);
        return checkbox;
    }

    private static void ApplyCellPadding(FrameworkElement element) =>
        element.Margin = new Thickness(12, 8, 12, 8);

    private static void SetRegionVisibility(UIElement? element, bool visible)
    {
        if (element is not null)
        {
            element.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        }
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new RbacMatrixPageAutomationPeer(this);

    private sealed class RbacMatrixPageAutomationPeer(RbacMatrixPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Pane;
    }
}
