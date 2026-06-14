using System.Collections.Generic;
using System.Text;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.ApplicationModel.DataTransfer;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>TeslaChargingHistoryPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/TeslaChargingHistoryPage.tsx</c> (route <c>/tesla-charging-history</c>, nav name
/// <c>TeslaChargingHistory</c>). It binds to a <see cref="TeslaChargingHistoryPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header, the controls bar (vehicle selector + date-range
/// picker + refresh-from-Tesla + the last-synced caption), the four summary stat cards (Total Sessions / Total Energy /
/// Total Spend / Avg Cost·kWh), the monthly-spending <see cref="TsChartContainer"/> wrapping a <see cref="TsBarChart"/>,
/// and the session table (<c>GlassPanel6</c>: a search field + active-filter chips + the invoice-aware
/// <see cref="TsDataTable"/> + the export-CSV action) — each region switching between the loading shimmer, the failure
/// surface, the empty state and the populated content. The view is a thin renderer: all branch selection, formatting,
/// filtering and i18n happen in the view-model's <see cref="TeslaChargingHistoryDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class TeslaChargingHistoryPage : UserControl, IDisposable
{
    private const double ChartMinHeight = 280;   // web ResponsiveContainer height={280}

    private readonly TeslaChargingHistoryPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // Controls bar — vehicle selector + date-range picker + refresh + last-synced caption.
    private readonly TsGlassPanel _controlsPanel = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 220 };
    private readonly TsRangePicker _rangePicker = new();
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Primary, IconGlyph = TeslaChargingHistoryRegistration.RefreshGlyph };
    private readonly Caption _lastSync = new() { VerticalAlignment = VerticalAlignment.Center };

    // Page-level data states.
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentRoot = new() { Spacing = 24 };

    // Summary stat cards.
    private readonly TsStatCard _sessionsCard = new() { Glyph = TeslaChargingHistoryRegistration.SessionsGlyph };
    private readonly TsStatCard _energyCard = new() { Glyph = TeslaChargingHistoryRegistration.EnergyGlyph };
    private readonly TsStatCard _spendCard = new() { Glyph = TeslaChargingHistoryRegistration.SpendGlyph };
    private readonly TsStatCard _avgCostCard = new() { Glyph = TeslaChargingHistoryRegistration.AvgCostGlyph };

    // Monthly spending chart.
    private readonly TsChartContainer _chartContainer = new();
    private readonly TsBarChart _barChart = new() { MinHeight = ChartMinHeight, HorizontalAlignment = HorizontalAlignment.Stretch };

    // GlassPanel6 — session table.
    private readonly TsGlassPanel _tablePanel = new();
    private readonly PanelTitle _tableTitle = new();
    private readonly TsButton _exportButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = TeslaChargingHistoryRegistration.ExportGlyph };
    private readonly TsSearchInput _searchInput = new() { MinWidth = 280 };
    private readonly TsActiveFilterChips _filterChips = new();
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _table = new() { Selectable = false, PageSize = 25 };
    private readonly TsEmptyState _tableEmpty = new() { IconGlyph = TeslaChargingHistoryRegistration.TableGlyph };

    private TeslaChargingHistoryDisplay? _current;
    private bool _vehicleOptionsPopulated;
    private bool _suppressVehicleChange;
    private bool _suppressSearchChange;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public TeslaChargingHistoryPage()
        : this(EmptyTeslaChargingHistoryFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The charging-history data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TeslaChargingHistoryPage(ITeslaChargingHistoryFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaChargingHistoryPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _rangePicker.RangeChanged += OnRangeChanged;
        _refreshButton.Click += OnRefreshClick;
        _exportButton.Click += OnExportClick;
        _searchInput.QueryChanged += OnSearchQueryChanged;
        _filterChips.FilterRemoved += OnFilterRemoved;
        _filterChips.Cleared += OnFiltersCleared;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TeslaChargingHistoryPage</c>).</summary>
    public static string Slug => TeslaChargingHistoryRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentRoot);

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
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(4));
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildContent()
    {
        _contentRoot.Children.Add(BuildControlsBar());
        _contentRoot.Children.Add(BuildStatGrid());
        _contentRoot.Children.Add(BuildChartPanel());
        _contentRoot.Children.Add(BuildTablePanel());
    }

    // The web controls bar (vehicle selector + range picker + refresh + last-synced caption).
    private TsGlassPanel BuildControlsBar()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _vehicleSelect.VerticalAlignment = VerticalAlignment.Center;
        _rangePicker.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_vehicleSelect);
        row.Children.Add(_rangePicker);
        row.Children.Add(_refreshButton);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(row, 0);
        Grid.SetColumn(_lastSync, 1);
        grid.Children.Add(row);
        grid.Children.Add(_lastSync);

        _controlsPanel.Padding = new Thickness(16);
        _controlsPanel.Content = grid;
        return _controlsPanel;
    }

    // The four summary stat cards in an equal-width responsive grid (web 4-column StatCard grid).
    private Grid BuildStatGrid() =>
        BuildEqualColumns(16, _sessionsCard, _energyCard, _spendCard, _avgCostCard);

    // The monthly-spending ChartContainer wrapping the bar chart (web ChartContainer + <BarChart>).
    private TsChartContainer BuildChartPanel()
    {
        _chartContainer.Body = _barChart;
        return _chartContainer;
    }

    // GlassPanel6 — the session table panel (title + export action + search + filter chips + data table or empty state).
    private TsGlassPanel BuildTablePanel()
    {
        var headerRow = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _tableTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_tableTitle, 0);
        Grid.SetColumn(_exportButton, 1);
        headerRow.Children.Add(_tableTitle);
        headerRow.Children.Add(_exportButton);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(headerRow);
        body.Children.Add(_searchInput);
        body.Children.Add(_filterChips);
        body.Children.Add(_tableHost);

        _tablePanel.Padding = new Thickness(16);
        _tablePanel.Content = body;
        return _tablePanel;
    }

    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }

        return grid;
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
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _rangePicker.RangeChanged -= OnRangeChanged;
        _refreshButton.Click -= OnRefreshClick;
        _exportButton.Click -= OnExportClick;
        _searchInput.QueryChanged -= OnSearchQueryChanged;
        _filterChips.FilterRemoved -= OnFilterRemoved;
        _filterChips.Cleared -= OnFiltersCleared;
        _errorState.ActionInvoked -= OnRetryInvoked;
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

    private void Render(TeslaChargingHistoryDisplay display)
    {
        _current = display;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Page-level data states (web PageContainer loading / error / content).
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);
        _contentRoot.Visibility = Show(display.ShowContent);

        // Controls bar.
        RenderVehicleSelect(display);
        _refreshButton.Text = display.RefreshButtonLabel;
        _refreshButton.IsLoading = display.RefreshPending;
        _lastSync.Value = display.LastSyncText;
        _lastSync.Visibility = Show(display.ShowLastSync);

        // Summary stat cards.
        _sessionsCard.Label = display.SessionsStatLabel;
        _sessionsCard.Value = display.SessionsStatValue;
        _energyCard.Label = display.EnergyStatLabel;
        _energyCard.Value = display.EnergyStatValue;
        _spendCard.Label = display.SpendStatLabel;
        _spendCard.Value = display.SpendStatValue;
        _avgCostCard.Label = display.AvgCostStatLabel;
        _avgCostCard.Value = display.AvgCostStatValue;

        // Monthly spending chart (ChartContainer + BarChart + accessible data table).
        _chartContainer.Title = display.MonthlySpendingTitle;
        _chartContainer.AccessibleSummary = display.MonthlySpendingAria;
        _chartContainer.EmptyMessage = display.NoChartDataMessage;
        _chartContainer.DataViewLabel = display.MonthColumnLabel;
        _chartContainer.State = display.ShowChart ? ChartState.Ready : ChartState.Empty;
        _barChart.Series = display.ChartSeries;
        _chartContainer.DataView.XLabel = display.MonthColumnLabel;
        _chartContainer.DataView.Series = display.ChartSeries;

        // GlassPanel6 — session table.
        _tableTitle.Value = display.TableTitle;
        _exportButton.Text = display.ExportCsvLabel;
        AutomationProperties.SetName(_exportButton, display.ExportCsvLabel);
        _exportButton.IsEnabled = display.ShowTable;
        RenderSearch(display);
        RenderTable(display);
    }

    private void RenderVehicleSelect(TeslaChargingHistoryDisplay display)
    {
        _suppressVehicleChange = true;
        try
        {
            if (!_vehicleOptionsPopulated || _vehicleSelect.Items.Count != display.VehicleOptions.Count)
            {
                var labels = new List<string>(display.VehicleOptions.Count);
                foreach (var option in display.VehicleOptions)
                {
                    labels.Add(option.Label);
                }

                _vehicleSelect.ItemsSource = labels;
                _vehicleOptionsPopulated = true;
            }

            int selectedIndex = 0;
            for (var i = 0; i < display.VehicleOptions.Count; i++)
            {
                if (display.VehicleOptions[i].IsSelected)
                {
                    selectedIndex = i;
                    break;
                }
            }

            _vehicleSelect.SelectedIndex = display.VehicleOptions.Count > 0 ? selectedIndex : -1;
            AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleLabel);
        }
        finally
        {
            _suppressVehicleChange = false;
        }
    }

    private void RenderSearch(TeslaChargingHistoryDisplay display)
    {
        _searchInput.Visibility = Show(display.ShowFilterBar);
        _searchInput.PromptText = display.SearchPromptText;
        AutomationProperties.SetName(_searchInput, display.SearchPromptText);
        if (_searchInput.Query != display.SearchQuery)
        {
            _suppressSearchChange = true;
            try
            {
                _searchInput.Query = display.SearchQuery;
            }
            finally
            {
                _suppressSearchChange = false;
            }
        }

        _filterChips.Visibility = Show(display.ShowSearchChip);
        _filterChips.Filters = display.FilterChips;
    }

    private void RenderTable(TeslaChargingHistoryDisplay display)
    {
        // The invoice column is downloadable (web getTeslaChargingInvoiceURL); surface the affordance accessibly.
        AutomationProperties.SetHelpText(_table, display.DownloadInvoiceLabel);

        if (display.ShowTable)
        {
            _table.Columns = BuildColumns(display.Columns);
            _table.Rows = BuildRows(display.Rows);
            _table.EmptyMessage = display.NoDataMessage;
            AutomationProperties.SetName(_table, display.TableTitle);
            _tableHost.Content = _table;
        }
        else
        {
            string message = display.ShowNoMatches ? display.NoMatchesMessage : display.NoDataMessage;
            _tableEmpty.Message = message;
            AutomationProperties.SetName(_tableEmpty, message);
            _tableHost.Content = _tableEmpty;
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<TeslaChargingHistoryColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,
                IsNumeric = column.IsNumeric,
            });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<TeslaChargingHistoryRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["location"] = row.Location,
                ["duration"] = row.Duration,
                ["energy"] = row.Energy,
                ["cost"] = row.Cost,
                ["rate"] = row.Rate,
                ["invoice"] = row.Invoice,
            };
            built.Add(new TsDataRow(row.SessionId, values));
        }

        return built;
    }

    private void OnVehicleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressVehicleChange || _current is null)
        {
            return;
        }

        int index = _vehicleSelect.SelectedIndex;
        if (index < 0 || index >= _current.VehicleOptions.Count)
        {
            return;
        }

        string vin = _current.VehicleOptions[index].Value;
        InvokeAsync(() => _viewModel.SetVehicleAsync(vin));
    }

    private void OnRangeChanged(object? sender, DateRange range)
    {
        DateOnly? start = range.Start == default ? null : range.Start;
        DateOnly? end = range.End == default ? null : range.End;
        _viewModel.SetRange(start, end);
    }

    private void OnSearchQueryChanged(object? sender, string query)
    {
        if (_suppressSearchChange)
        {
            return;
        }

        _viewModel.SetSearch(query);
    }

    private void OnFilterRemoved(object? sender, string key) => _viewModel.ClearSearch();

    private void OnFiltersCleared(object? sender, EventArgs e) => _viewModel.ClearSearch();

    private void OnRefreshClick(object sender, RoutedEventArgs e) =>
        InvokeAsync(() => _viewModel.RefreshFromTeslaAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RefreshAsync());

    // The web bulk "Export CSV" action — copies the current table rows as a CSV document to the clipboard.
    private void OnExportClick(object sender, RoutedEventArgs e)
    {
        if (_current is not { ShowTable: true } display)
        {
            return;
        }

        var csv = BuildCsv(display);
        var package = new DataPackage();
        package.SetText(csv);
        Clipboard.SetContent(package);
    }

    private static string BuildCsv(TeslaChargingHistoryDisplay display)
    {
        var sb = new StringBuilder();
        var headers = new List<string>(display.Columns.Count);
        foreach (var column in display.Columns)
        {
            headers.Add(CsvField(column.Header));
        }

        sb.Append(string.Join(',', headers)).Append('\n');

        foreach (var row in display.Rows)
        {
            var fields = new[]
            {
                row.Date, row.Location, row.Duration, row.Energy,
                row.Cost, row.Rate, row.HasInvoice ? row.InvoiceUrl : string.Empty,
            };
            for (var i = 0; i < fields.Length; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }

                sb.Append(CsvField(fields[i]));
            }

            sb.Append('\n');
        }

        return sb.ToString();
    }

    private static string CsvField(string value) => $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaChargingHistoryPageAutomationPeer(this);

    private sealed class TeslaChargingHistoryPageAutomationPeer(TeslaChargingHistoryPage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
