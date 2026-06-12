using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>The route a <see cref="AutomationListPage.NavigationRequested"/> event carries (web row link / empty CTA target).</summary>
public sealed class AutomationListNavigationEventArgs : EventArgs
{
    /// <summary>Creates the navigation request for <paramref name="route"/>.</summary>
    public AutomationListNavigationEventArgs(string route) => Route = route;

    /// <summary>The shell route to navigate to (e.g. <c>automations/new</c> or <c>automations/{id}</c>).</summary>
    public string Route { get; }
}

/// <summary>
/// The native WinUI 3 <c>AutomationListPage</c> — a parity port of the web page
/// <c>web/src/features/automations/pages/AutomationListPage.tsx</c> (route <c>/automations/list</c>, nav name
/// <c>AutomationList</c>). It binds to an <see cref="AutomationListPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle), the bulk-action toolbar (web
/// <c>BulkActionToolbar</c>: count + Enable / Disable / Delete with a destructive confirm + Clear), and the
/// <see cref="TsGlassPanel"/> table (GlassPanel1) whose body switches between the loading shimmer, the failure surface
/// (<see cref="TsErrorDisplay"/> + Retry), the "no automations yet" <see cref="TsEmptyState"/> + builder CTA, and the
/// bulk-selectable table (master + per-row checkboxes, name link, description, run count and the enabled/disabled
/// status chip). The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="AutomationListDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AutomationListPage : UserControl, IDisposable
{
    private const double SelectColumnWidth = 44;
    private const double RunsColumnWidth = 88;
    private const double StatusColumnWidth = 132;

    private readonly AutomationListPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly Border _bulkBar = new() { Visibility = Visibility.Collapsed };
    private readonly Text _bulkCount = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _bulkNoun = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _enableButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly TsButton _disableButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small };
    private readonly TsButton _deleteButton = new() { Variant = ButtonVariant.Destructive, Size = ControlSize.Small };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None };
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 8, Padding = new Thickness(16) };
    private readonly TsErrorDisplay _errorState = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = AutomationListRegistration.EmptyGlyph, Visibility = Visibility.Collapsed };

    private readonly StackPanel _tableRoot = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 10, 12, 10) };
    private readonly StackPanel _tableBody = new();
    private readonly TsCheckbox _masterCheck = new() { IsThreeState = true, Width = SelectColumnWidth };
    private readonly Label _nameHeader = new();
    private readonly Label _descHeader = new();
    private readonly Label _runsHeader = new();
    private readonly Label _statusHeader = new();

    private bool _suppressMasterToggle;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public AutomationListPage()
        : this(EmptyAutomationListFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The automations-list data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AutomationListPage(IAutomationListFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AutomationListPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        BuildBulkBar();
        BuildTable();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _emptyState.ActionInvoked += OnEmptyCtaInvoked;
        _masterCheck.Click += OnMasterToggle;
        _enableButton.Click += (_, _) => OnBulkAction(AutomationBulkOp.Enable);
        _disableButton.Click += (_, _) => OnBulkAction(AutomationBulkOp.Disable);
        _deleteButton.Click += (_, _) => OnBulkAction(AutomationBulkOp.Delete);
        _clearButton.Click += (_, _) => _viewModel.ClearSelection();
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when a row's name link or the empty-state CTA requests navigation (web router links).</summary>
    public event EventHandler<AutomationListNavigationEventArgs>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>AutomationListPage</c>).</summary>
    public static string Slug => AutomationListRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_bulkBar);
        stack.Children.Add(_panel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        // web: three Skeleton h-10 bars inside the GlassPanel (space-y-2 p-4).
        for (var i = 0; i < 3; i++)
        {
            _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 40, Radius = 8 });
        }
    }

    private void BuildBulkBar()
    {
        var summary = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        summary.Children.Add(_bulkCount);
        summary.Children.Add(_bulkNoun);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        actions.Children.Add(_enableButton);
        actions.Children.Add(_disableButton);
        actions.Children.Add(_deleteButton);
        actions.Children.Add(_clearButton);

        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(summary, 0);
        Grid.SetColumn(actions, 1);
        row.Children.Add(summary);
        row.Children.Add(actions);

        _bulkBar.Child = row;
        _bulkBar.Padding = new Thickness(16, 12, 16, 12);
        _bulkBar.CornerRadius = new CornerRadius(12);
        _bulkBar.BorderThickness = new Thickness(1);
        _bulkBar.Background = TokenBrush("TsColorSurfaceGlassBrush");
        _bulkBar.BorderBrush = TokenBrush("TsColorBorderBrush");
        AutomationProperties.SetName(_bulkBar, "Bulk actions");
    }

    private void BuildTable()
    {
        AddColumns(_tableHeader);
        Grid.SetColumn(_masterCheck, 0);
        PlaceCell(_nameHeader, 1);
        PlaceCell(_descHeader, 2);
        PlaceCell(_runsHeader, 3);
        PlaceCell(_statusHeader, 4);
        _tableHeader.Children.Add(_masterCheck);
        _tableHeader.Children.Add(_nameHeader);
        _tableHeader.Children.Add(_descHeader);
        _tableHeader.Children.Add(_runsHeader);
        _tableHeader.Children.Add(_statusHeader);
        _tableHeader.BorderBrush = TokenBrush("TsColorBorderBrush");
        _tableHeader.BorderThickness = new Thickness(0, 0, 0, 1);

        _tableRoot.Children.Add(_tableHeader);
        _tableRoot.Children.Add(_tableBody);

        var host = new Grid();
        host.Children.Add(_loadingSkeleton);
        host.Children.Add(_errorState);
        host.Children.Add(_emptyState);
        host.Children.Add(_tableRoot);

        _panel.Content = host;
        AutomationProperties.SetName(_panel, Slug);
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
        _errorState.ActionInvoked -= OnRetryInvoked;
        _emptyState.ActionInvoked -= OnEmptyCtaInvoked;
        _masterCheck.Click -= OnMasterToggle;
        _viewModel.PropertyChanged -= OnViewModelChanged;
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

    private void Render(AutomationListDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        RenderBulkBar(display);

        // GlassPanel1 is always visible; its body switches between the four data states (never a blank region).
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _errorState.Visibility = Show(display.ShowError);
        _emptyState.Visibility = Show(display.ShowEmpty);
        _tableRoot.Visibility = Show(display.ShowTable);

        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.ActionText = display.EmptyCtaLabel;
        AutomationProperties.SetName(_emptyState, display.EmptyTitle);

        RenderTableChrome(display);
        RenderRows(display);
    }

    private void RenderBulkBar(AutomationListDisplay display)
    {
        _bulkBar.Visibility = Show(display.ShowBulkBar);
        _bulkCount.Value = display.SelectedCountLabel;
        _bulkNoun.Value = display.ItemNoun;
        _clearButton.Text = display.ClearLabel;

        foreach (var action in display.Actions)
        {
            var button = ButtonFor(action.Op);
            button.Text = action.Label;
            button.IconGlyph = action.Glyph;
            button.IsEnabled = !display.BulkBusy;
        }

        _clearButton.IsEnabled = !display.BulkBusy;
    }

    private void RenderTableChrome(AutomationListDisplay display)
    {
        _nameHeader.Value = display.NameHeader;
        _descHeader.Value = display.DescriptionHeader;
        _runsHeader.Value = display.RunsHeader;
        _statusHeader.Value = display.StatusHeader;
        AutomationProperties.SetName(_masterCheck, display.SelectAllLabel);
        ToolTipService.SetToolTip(_masterCheck, display.SelectAllLabel);

        _suppressMasterToggle = true;
        try
        {
            _masterCheck.IsChecked = display.MasterState switch
            {
                MasterSelectionState.All => true,
                MasterSelectionState.None => false,
                _ => null,
            };
        }
        finally
        {
            _suppressMasterToggle = false;
        }
    }

    private void RenderRows(AutomationListDisplay display)
    {
        _tableBody.Children.Clear();
        foreach (var row in display.Rows)
        {
            _tableBody.Children.Add(BuildRow(row, display.SelectRowLabel));
        }
    }

    private Border BuildRow(AutomationRowDisplay row, string selectRowFallback)
    {
        var grid = new Grid { Padding = new Thickness(12, 8, 12, 8) };
        AddColumns(grid);

        var check = new TsCheckbox
        {
            Width = SelectColumnWidth,
            IsChecked = row.Selected,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(check, string.IsNullOrEmpty(row.SelectLabel) ? selectRowFallback : row.SelectLabel);
        ToolTipService.SetToolTip(check, selectRowFallback);
        long id = row.Id;
        check.Click += (_, _) => _viewModel.ToggleRow(id);
        Grid.SetColumn(check, 0);

        var name = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = row.Name,
            HorizontalAlignment = HorizontalAlignment.Left,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        name.Click += (_, _) => RaiseNavigation(AutomationListRegistration.DetailRoute(id));
        PlaceCell(name, 1);

        var description = new Text
        {
            Value = row.Description,
            VerticalAlignment = VerticalAlignment.Center,
        };
        PlaceCell(description, 2);

        var runs = new Text
        {
            Value = row.Runs,
            VerticalAlignment = VerticalAlignment.Center,
        };
        PlaceCell(runs, 3);

        var status = new TsBadge
        {
            Status = row.StatusKind,
            Content = row.StatusLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        PlaceCell(status, 4);

        grid.Children.Add(check);
        grid.Children.Add(name);
        grid.Children.Add(description);
        grid.Children.Add(runs);
        grid.Children.Add(status);

        var rowBorder = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        rowBorder.BorderBrush = TokenBrush("TsColorBorderBrush");
        return rowBorder;
    }

    private TsButton ButtonFor(AutomationBulkOp op) => op switch
    {
        AutomationBulkOp.Enable => _enableButton,
        AutomationBulkOp.Disable => _disableButton,
        _ => _deleteButton,
    };

    private void OnMasterToggle(object sender, RoutedEventArgs e)
    {
        if (_suppressMasterToggle)
        {
            return;
        }

        _viewModel.ToggleAll();
    }

    private async void OnBulkAction(AutomationBulkOp op)
    {
        if (op == AutomationBulkOp.Delete && !await ConfirmDeleteAsync().ConfigureAwait(true))
        {
            return;
        }

        await _viewModel.RunBulkAsync(op).ConfigureAwait(true);
    }

    private async Task<bool> ConfirmDeleteAsync()
    {
        var display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.DeleteConfirmTitle,
            Content = display.DeleteConfirmBody,
            PrimaryButtonText = display.DeleteConfirmLabel,
            CloseButtonText = display.DeleteCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnEmptyCtaInvoked(object? sender, EventArgs e) => RaiseNavigation(AutomationListRegistration.BuilderRoute);

    private void RaiseNavigation(string route) =>
        NavigationRequested?.Invoke(this, new AutomationListNavigationEventArgs(route));

    private static void AddColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SelectColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.5, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(RunsColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(StatusColumnWidth) });
    }

    private static void PlaceCell(FrameworkElement element, int column)
    {
        element.Margin = new Thickness(8, 0, 8, 0);
        Grid.SetColumn(element, column);
    }

    private static Brush? TokenBrush(string resourceKey) =>
        Application.Current.Resources.TryGetValue(resourceKey, out var value) && value is Brush brush ? brush : null;

    private static async void InvokeAsync(Func<Task> action) =>
        await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new AutomationListPageAutomationPeer(this);

    private sealed class AutomationListPageAutomationPeer(AutomationListPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
