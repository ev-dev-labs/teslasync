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

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The native WinUI 3 <c>ExportsPage</c> — a parity port of the web page
/// <c>web/src/features/exports/pages/ExportsPage.tsx</c> (route <c>/exports</c>, nav name <c>Exports</c>). It binds to
/// an <see cref="ExportsPageViewModel"/> and renders every web region with Fluent components and design tokens: the
/// page header (title + subtitle), the bulk-action toolbar (web <c>BulkActionToolbar</c>: count + a destructive Delete
/// behind a confirm + Clear), and the <see cref="TsGlassPanel"/> table (GlassPanel1) whose body switches between the
/// loading shimmer, the failure surface (<see cref="TsErrorDisplay"/> + Retry), the "no exports yet"
/// <see cref="TsEmptyState"/>, and the bulk-selectable table (master + per-row checkboxes, type, format, size, created
/// time, the status chip and a download link for ready jobs). The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="ExportsDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class ExportsPage : UserControl, IDisposable
{
    private const double SelectColumnWidth = 44;
    private const double StatusColumnWidth = 120;
    private const double DownloadColumnWidth = 104;

    private readonly ExportsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly Border _bulkBar = new() { Visibility = Visibility.Collapsed };
    private readonly Text _bulkCount = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _bulkNoun = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _deleteButton = new() { Variant = ButtonVariant.Destructive, Size = ControlSize.Small };
    private readonly TsButton _clearButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.None };
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 8, Padding = new Thickness(16) };
    private readonly TsErrorDisplay _errorState = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = ExportsRegistration.EmptyGlyph, Visibility = Visibility.Collapsed };

    private readonly StackPanel _tableRoot = new() { Visibility = Visibility.Collapsed };
    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 10, 12, 10) };
    private readonly StackPanel _tableBody = new();
    private readonly TsCheckbox _masterCheck = new() { IsThreeState = true, Width = SelectColumnWidth };
    private readonly Label _typeHeader = new();
    private readonly Label _formatHeader = new();
    private readonly Label _sizeHeader = new();
    private readonly Label _createdHeader = new();
    private readonly Label _statusHeader = new();

    private bool _suppressMasterToggle;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public ExportsPage()
        : this(EmptyExportsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The export-jobs data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ExportsPage(IExportsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ExportsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        BuildBulkBar();
        BuildTable();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _masterCheck.Click += OnMasterToggle;
        _deleteButton.Click += OnDeleteClick;
        _clearButton.Click += (_, _) => _viewModel.ClearSelection();
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ExportsPage</c>).</summary>
    public static string Slug => ExportsRegistration.Slug;

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
        PlaceCell(_typeHeader, 1);
        PlaceCell(_formatHeader, 2);
        PlaceCell(_sizeHeader, 3);
        PlaceCell(_createdHeader, 4);
        PlaceCell(_statusHeader, 5);
        _tableHeader.Children.Add(_masterCheck);
        _tableHeader.Children.Add(_typeHeader);
        _tableHeader.Children.Add(_formatHeader);
        _tableHeader.Children.Add(_sizeHeader);
        _tableHeader.Children.Add(_createdHeader);
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
        _masterCheck.Click -= OnMasterToggle;
        _deleteButton.Click -= OnDeleteClick;
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

    private void Render(ExportsDisplay display)
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
        AutomationProperties.SetName(_emptyState, display.EmptyTitle);

        RenderTableChrome(display);
        RenderRows(display);
    }

    private void RenderBulkBar(ExportsDisplay display)
    {
        _bulkBar.Visibility = Show(display.ShowBulkBar);
        _bulkCount.Value = display.SelectedCountLabel;
        _bulkNoun.Value = display.ItemNoun;
        _deleteButton.Text = display.DeleteLabel;
        _deleteButton.IconGlyph = display.DeleteGlyph;
        _deleteButton.IsEnabled = !display.BulkBusy;
        _clearButton.Text = display.ClearLabel;
        _clearButton.IsEnabled = !display.BulkBusy;
    }

    private void RenderTableChrome(ExportsDisplay display)
    {
        _typeHeader.Value = display.TypeHeader;
        _formatHeader.Value = display.FormatHeader;
        _sizeHeader.Value = display.SizeHeader;
        _createdHeader.Value = display.CreatedHeader;
        _statusHeader.Value = display.StatusHeader;
        AutomationProperties.SetName(_masterCheck, display.SelectAllLabel);
        ToolTipService.SetToolTip(_masterCheck, display.SelectAllLabel);

        _suppressMasterToggle = true;
        try
        {
            _masterCheck.IsChecked = display.MasterState switch
            {
                ExportsMasterState.All => true,
                ExportsMasterState.None => false,
                _ => null,
            };
        }
        finally
        {
            _suppressMasterToggle = false;
        }
    }

    private void RenderRows(ExportsDisplay display)
    {
        _tableBody.Children.Clear();
        foreach (var row in display.Rows)
        {
            _tableBody.Children.Add(BuildRow(row, display.SelectRowLabel));
        }
    }

    private Border BuildRow(ExportRowDisplay row, string selectRowFallback)
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
        string id = row.Id;
        check.Click += (_, _) => _viewModel.ToggleRow(id);
        Grid.SetColumn(check, 0);

        var type = new Text { Value = row.Type, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(type, 1);

        var format = new Text { Value = row.Format, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(format, 2);

        var size = new Text { Value = row.Size, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(size, 3);

        var created = new Text { Value = row.Created, VerticalAlignment = VerticalAlignment.Center };
        PlaceCell(created, 4);

        var status = new TsBadge
        {
            Status = row.StatusKind,
            Content = row.StatusLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        PlaceCell(status, 5);

        grid.Children.Add(check);
        grid.Children.Add(type);
        grid.Children.Add(format);
        grid.Children.Add(size);
        grid.Children.Add(created);
        grid.Children.Add(status);

        var download = BuildDownload(row);
        PlaceCell(download, 6);
        grid.Children.Add(download);

        var rowBorder = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
        };
        rowBorder.BorderBrush = TokenBrush("TsColorBorderBrush");
        return rowBorder;
    }

    private static FrameworkElement BuildDownload(ExportRowDisplay row)
    {
        if (!row.CanDownload || row.DownloadUri is null)
        {
            // Non-downloadable rows reserve the column so the table stays aligned (web renders an empty cell).
            var empty = new Border();
            AutomationProperties.SetAccessibilityView(empty, AccessibilityView.Raw);
            return empty;
        }

        var button = new HyperlinkButton
        {
            NavigateUri = row.DownloadUri,
            Content = row.DownloadLabel,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, row.DownloadLabel);
        ToolTipService.SetToolTip(button, row.DownloadLabel);
        return button;
    }

    private void OnMasterToggle(object sender, RoutedEventArgs e)
    {
        if (_suppressMasterToggle)
        {
            return;
        }

        _viewModel.ToggleAll();
    }

    private async void OnDeleteClick(object sender, RoutedEventArgs e)
    {
        if (!await ConfirmDeleteAsync().ConfigureAwait(true))
        {
            return;
        }

        await _viewModel.RunBulkDeleteAsync().ConfigureAwait(true);
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

    private static void AddColumns(Grid grid)
    {
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SelectColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.8, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(0.8, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(StatusColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(DownloadColumnWidth) });
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

    protected override AutomationPeer OnCreateAutomationPeer() => new ExportsPageAutomationPeer(this);

    private sealed class ExportsPageAutomationPeer(ExportsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
