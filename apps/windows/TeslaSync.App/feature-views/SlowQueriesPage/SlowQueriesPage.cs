using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>SlowQueriesPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/SlowQueriesPage.tsx</c> (route <c>/admin/slow-queries</c>, nav name
/// <c>SlowQueries</c>). It binds to a <see cref="SlowQueriesPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle), the pg_stat_statements-not-configured
/// warning banner (web <c>AlertBanner</c>, surfaced on HTTP 503), and a single glass panel holding the panel title,
/// the order-by + limit filter controls, and the table body whose region switches between the loading spinner, the
/// query-error surface (web <c>QueryError</c> with Retry), the empty state and the slow-query table (which itself
/// shows an empty-table note when there are no rows). The view is a thin renderer: all branch selection, formatting
/// and i18n happen in the view-model's <see cref="SlowQueriesDisplay"/> projection. State changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class SlowQueriesPage : UserControl, IDisposable
{
    private const double FingerprintMinWidth = 240;

    private readonly SlowQueriesPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };

    private readonly PanelTitle _panelTitle = new();
    private readonly Caption _orderByLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsSelect _orderBySelect = new() { MinWidth = 160 };
    private readonly Caption _limitLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsSelect _limitSelect = new() { MinWidth = 96 };

    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE916" };

    private readonly Grid _tableHeader = new() { Padding = new Thickness(12, 8, 12, 8) };
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };
    private readonly Text _emptyTableText = new() { Margin = new Thickness(12) };
    private readonly StackPanel _tablePanel;

    private bool _suppressEvents;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public SlowQueriesPage()
        : this(EmptySlowQueriesFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The slow-queries data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SlowQueriesPage(ISlowQueriesFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SlowQueriesPageViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();
        _tablePanel = BuildTablePanel();

        Content = BuildLayout();

        _orderBySelect.SelectionChanged += OnOrderByChanged;
        _limitSelect.SelectionChanged += OnLimitChanged;
        _errorState.ActionInvoked += OnRetryInvoked;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SlowQueriesPage</c>).</summary>
    public static string Slug => SlowQueriesRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(BuildPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildPanel()
    {
        var body = new StackPanel { Spacing = 16, Padding = new Thickness(16) };

        var headerRow = new Grid { ColumnSpacing = 16 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _panelTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_panelTitle, 0);
        headerRow.Children.Add(_panelTitle);

        var controls = BuildControlsRow();
        Grid.SetColumn(controls, 1);
        headerRow.Children.Add(controls);

        body.Children.Add(headerRow);
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_emptyState);
        body.Children.Add(_tablePanel);

        return new TsGlassPanel { Content = body };
    }

    private StackPanel BuildControlsRow()
    {
        _orderBySelect.DisplayMemberPath = nameof(SlowQuerySelectOption.Label);
        _orderBySelect.SelectedValuePath = nameof(SlowQuerySelectOption.Value);
        _limitSelect.DisplayMemberPath = nameof(SlowQuerySelectOption.Label);
        _limitSelect.SelectedValuePath = nameof(SlowQuerySelectOption.Value);

        var orderGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        orderGroup.Children.Add(_orderByLabel);
        orderGroup.Children.Add(_orderBySelect);

        var limitGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        limitGroup.Children.Add(_limitLabel);
        limitGroup.Children.Add(_limitSelect);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        row.Children.Add(orderGroup);
        row.Children.Add(limitGroup);
        return row;
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        panel.Children.Add(_loadingText);
        return panel;
    }

    private StackPanel BuildTablePanel()
    {
        _emptyTableText.Foreground = Brush("TsColorTextMutedBrush");

        var panel = new StackPanel { Spacing = 0 };
        panel.Children.Add(_tableHeader);
        panel.Children.Add(_rowsPanel);
        panel.Children.Add(_emptyTableText);
        return panel;
    }

    private static void ApplyColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star), MinWidth = FingerprintMinWidth }); // Fingerprint
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) }); // Calls
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) }); // Mean
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(100) }); // Max
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) }); // Total
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });  // Rows
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(120) }); // Cache
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

    private void Render(SlowQueriesDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _subsystemBanner.Title = display.SubsystemUnavailableTitle;
        _subsystemBanner.Message = display.NotConfiguredText;
        _subsystemBanner.IsOpen = display.ShowSubsystemMissing;

        _panelTitle.Value = display.TableTitle;

        _orderByLabel.Value = display.OrderByLabel;
        _orderBySelect.ItemsSource = display.OrderByOptions;
        _orderBySelect.SelectedValue = display.SelectedOrderBy;
        _orderBySelect.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_orderBySelect, display.OrderByLabel);

        _limitLabel.Value = display.LimitLabel;
        _limitSelect.ItemsSource = display.LimitOptions;
        _limitSelect.SelectedValue = display.SelectedLimit;
        _limitSelect.IsEnabled = !_viewModel.IsFetching;
        AutomationProperties.SetName(_limitSelect, display.LimitLabel);

        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorState.Visibility = Show(display.HasError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _tablePanel.Visibility = Show(display.ShowTable);
        RebuildHeader(display.ColumnLabels);
        RebuildRows(display);

        bool hasRows = display.Rows.Count > 0;
        _rowsPanel.Visibility = Show(display.ShowTable && hasRows);
        _emptyTableText.Value = display.EmptyTableMessage;
        _emptyTableText.Visibility = Show(display.ShowTable && !hasRows);

        _suppressEvents = false;
    }

    private void RebuildHeader(SlowQueriesColumnLabels labels)
    {
        _tableHeader.Children.Clear();
        ApplyColumns(_tableHeader);

        AddHeaderCell(labels.Fingerprint, 0, HorizontalAlignment.Left);
        AddHeaderCell(labels.Calls, 1, HorizontalAlignment.Right);
        AddHeaderCell(labels.Mean, 2, HorizontalAlignment.Right);
        AddHeaderCell(labels.Max, 3, HorizontalAlignment.Right);
        AddHeaderCell(labels.Total, 4, HorizontalAlignment.Right);
        AddHeaderCell(labels.Rows, 5, HorizontalAlignment.Right);
        AddHeaderCell(labels.Cache, 6, HorizontalAlignment.Right);
    }

    private void AddHeaderCell(string text, int column, HorizontalAlignment alignment)
    {
        var label = new Label { Value = text, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = alignment };
        Grid.SetColumn(label, column);
        _tableHeader.Children.Add(label);
    }

    private void RebuildRows(SlowQueriesDisplay display)
    {
        _rowsPanel.Children.Clear();
        if (!display.ShowTable)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row));
        }
    }

    private static Grid BuildRow(SlowQueryRowDisplay row)
    {
        var grid = new Grid { Padding = new Thickness(12, 6, 12, 6), VerticalAlignment = VerticalAlignment.Center };
        ApplyColumns(grid);

        FrameworkElement fingerprintCell = row.HasFingerprint
            ? new Code
            {
                Value = row.Fingerprint,
                VerticalAlignment = VerticalAlignment.Center,
                MaxWidth = 420,
            }
            : MutedDash();
        if (fingerprintCell is Code code)
        {
            ToolTipService.SetToolTip(code, row.FingerprintTooltip);
        }

        AddCell(grid, fingerprintCell, 0, HorizontalAlignment.Left);
        AddCell(grid, NumericCell(row.Calls), 1, HorizontalAlignment.Right);
        AddCell(grid, NumericCell(row.Mean), 2, HorizontalAlignment.Right);
        AddCell(grid, NumericCell(row.Max), 3, HorizontalAlignment.Right);
        AddCell(grid, NumericCell(row.Total), 4, HorizontalAlignment.Right);
        AddCell(grid, NumericCell(row.Rows), 5, HorizontalAlignment.Right);
        AddCell(grid, NumericCell(row.Cache), 6, HorizontalAlignment.Right);

        AutomationProperties.SetName(grid, row.HasFingerprint ? row.FingerprintTooltip : row.Calls);
        return grid;
    }

    private static Text NumericCell(string value) => new()
    {
        Value = value,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private static TextBlock MutedDash() => new()
    {
        Text = SlowQueriesProjection.EmDash,
        VerticalAlignment = VerticalAlignment.Center,
        Foreground = Brush("TsColorTextMutedBrush"),
    };

    private static void AddCell(Grid grid, FrameworkElement element, int column, HorizontalAlignment alignment)
    {
        element.HorizontalAlignment = alignment;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void OnOrderByChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_orderBySelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetOrderByAsync(value));
        }
    }

    private void OnLimitChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        if (_limitSelect.SelectedValue is string value
            && int.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var limit))
        {
            InvokeAsync(() => _viewModel.SetLimitAsync(limit));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
