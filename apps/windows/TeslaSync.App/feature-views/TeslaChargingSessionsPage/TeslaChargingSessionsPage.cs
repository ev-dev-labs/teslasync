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
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using Windows.ApplicationModel.DataTransfer;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>TeslaChargingSessionsPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/TeslaChargingSessionsPage.tsx</c> (route <c>/tesla-charging-sessions</c>, nav
/// name <c>TeslaChargingSessions</c>). It binds to a <see cref="TeslaChargingSessionsPageViewModel"/> and renders every
/// web region with Fluent components and design tokens: the page header, the business-account info banner
/// (<c>GlassPanel1</c>), the controls bar (<c>GlassPanel2</c>: vehicle selector + refresh-from-Tesla + the
/// "business account required" 403 note + the last-synced caption), the five fleet-summary stat cards (Total Sessions
/// / Total Energy / Total Cost / Avg Cost·kWh / Peak Power), the monthly-cost <see cref="TsChartContainer"/> wrapping a
/// <see cref="TsBarChart"/>, the session-locations panel (<c>GlassPanel9</c>) and the session table
/// (<c>GlassPanel10</c>) — each region switching between the loading shimmer, the failure surface, the empty state and
/// the populated content. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="TeslaChargingSessionsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TeslaChargingSessionsPage : UserControl, IDisposable
{
    private const double ChartMinHeight = 280;     // web ResponsiveContainer height={280}
    private const double LocationsMaxHeight = 350;  // web map h-[350px]

    private readonly TeslaChargingSessionsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    // GlassPanel1 — business-account info banner.
    private readonly TsGlassPanel _infoPanel = new();
    private readonly Text _businessNote = new();

    // GlassPanel2 — controls bar.
    private readonly TsGlassPanel _controlsPanel = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 220 };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Primary, IconGlyph = TeslaChargingSessionsRegistration.RefreshGlyph };
    private readonly Text _businessOnly = new();
    private readonly Caption _lastSync = new() { VerticalAlignment = VerticalAlignment.Center };

    // Page-level data states.
    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsQueryError _errorState = new();

    private readonly StackPanel _contentRoot = new() { Spacing = 24 };

    // Summary stat cards.
    private readonly TsStatCard _sessionsCard = new() { Glyph = "\uE945" };
    private readonly TsStatCard _energyCard = new() { Glyph = "\uEC4A" };
    private readonly TsStatCard _costCard = new() { Glyph = "\uE825" };
    private readonly TsStatCard _avgCostCard = new() { Glyph = "\uF0CE" };
    private readonly TsStatCard _peakPowerCard = new() { Glyph = "\uEC4A" };

    // Monthly cost chart.
    private readonly TsChartContainer _chartContainer = new();
    private readonly TsBarChart _barChart = new() { MinHeight = ChartMinHeight, HorizontalAlignment = HorizontalAlignment.Stretch };

    // GlassPanel9 — session locations.
    private readonly TsGlassPanel _mapPanel = new();
    private readonly PanelTitle _mapTitle = new();
    private readonly ContentControl _mapHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly StackPanel _mapList = new() { Spacing = 8 };
    private readonly ScrollViewer _mapScroller;
    private readonly TsEmptyState _mapEmpty = new() { IconGlyph = TeslaChargingSessionsRegistration.MapGlyph };

    // GlassPanel10 — session table.
    private readonly TsGlassPanel _tablePanel = new();
    private readonly PanelTitle _tableTitle = new();
    private readonly TsButton _exportButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uEDE1" };
    private readonly ContentControl _tableHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _table = new() { Selectable = false, PageSize = 25 };
    private readonly TsEmptyState _tableEmpty = new() { IconGlyph = TeslaChargingSessionsRegistration.TableGlyph };

    private TeslaChargingSessionsDisplay? _current;
    private bool _vehicleOptionsPopulated;
    private bool _suppressVehicleChange;

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public TeslaChargingSessionsPage()
        : this(EmptyTeslaChargingSessionsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The charging-sessions data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TeslaChargingSessionsPage(ITeslaChargingSessionsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TeslaChargingSessionsPageViewModel(feed, localizer);

        _mapScroller = new ScrollViewer
        {
            Content = _mapList,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = LocationsMaxHeight,
        };

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _refreshButton.Click += OnRefreshClick;
        _exportButton.Click += OnExportClick;
        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TeslaChargingSessionsPage</c>).</summary>
    public static string Slug => TeslaChargingSessionsRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(5));
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildContent()
    {
        _contentRoot.Children.Add(BuildInfoBanner());
        _contentRoot.Children.Add(BuildControlsBar());
        _contentRoot.Children.Add(BuildStatGrid());
        _contentRoot.Children.Add(BuildChartPanel());
        _contentRoot.Children.Add(BuildLocationsPanel());
        _contentRoot.Children.Add(BuildTablePanel());
    }

    // GlassPanel1 — the web business-account info banner (Building2 glyph + note text).
    private TsGlassPanel BuildInfoBanner()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = TeslaChargingSessionsRegistration.BusinessGlyph,
            FontSize = 18,
            VerticalAlignment = VerticalAlignment.Top,
        });
        _businessNote.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_businessNote);

        _infoPanel.Padding = new Thickness(16);
        _infoPanel.Content = row;
        return _infoPanel;
    }

    // GlassPanel2 — the web controls bar (vehicle selector + refresh + 403 note + last-synced caption).
    private TsGlassPanel BuildControlsBar()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _vehicleSelect.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.VerticalAlignment = VerticalAlignment.Center;
        _businessOnly.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(_vehicleSelect);
        row.Children.Add(_refreshButton);
        row.Children.Add(_businessOnly);

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

    // The five fleet-summary stat cards in an equal-width responsive grid (web 5-column StatCard grid).
    private Grid BuildStatGrid() =>
        BuildEqualColumns(16, _sessionsCard, _energyCard, _costCard, _avgCostCard, _peakPowerCard);

    // The monthly-cost ChartContainer wrapping the bar chart (web ChartContainer + <BarChart>).
    private TsChartContainer BuildChartPanel()
    {
        _chartContainer.Body = _barChart;
        return _chartContainer;
    }

    // GlassPanel9 — the session-locations panel (title + locations list or "no location data" empty state).
    private TsGlassPanel BuildLocationsPanel()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_mapTitle);
        _mapHost.Content = _mapScroller;
        body.Children.Add(_mapHost);

        _mapPanel.Padding = new Thickness(16);
        _mapPanel.Content = body;
        return _mapPanel;
    }

    // GlassPanel10 — the session table panel (title + export action + data table or "no data" empty state).
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

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(headerRow);
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
        _refreshButton.Click -= OnRefreshClick;
        _exportButton.Click -= OnExportClick;
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

    private void Render(TeslaChargingSessionsDisplay display)
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

        // GlassPanel1 — info banner.
        _businessNote.Value = display.BusinessNote;
        AutomationProperties.SetName(_infoPanel, display.BusinessNote);

        // GlassPanel2 — controls bar.
        RenderVehicleSelect(display);
        _refreshButton.Text = display.RefreshButtonLabel;
        _refreshButton.IsLoading = display.RefreshPending;
        _businessOnly.Value = display.BusinessOnlyLabel;
        _businessOnly.Visibility = Show(display.ShowBusinessOnly);
        _lastSync.Value = display.LastSyncText;
        _lastSync.Visibility = Show(display.ShowLastSync);

        // Summary stat cards.
        _sessionsCard.Label = display.SessionsStatLabel;
        _sessionsCard.Value = display.SessionsStatValue;
        _energyCard.Label = display.EnergyStatLabel;
        _energyCard.Value = display.EnergyStatValue;
        _costCard.Label = display.CostStatLabel;
        _costCard.Value = display.CostStatValue;
        _avgCostCard.Label = display.AvgCostStatLabel;
        _avgCostCard.Value = display.AvgCostStatValue;
        _peakPowerCard.Label = display.PeakPowerStatLabel;
        _peakPowerCard.Value = display.PeakPowerStatValue;

        // Monthly cost chart (ChartContainer + BarChart + accessible data table).
        _chartContainer.Title = display.MonthlyCostTitle;
        _chartContainer.AccessibleSummary = display.MonthlyCostAria;
        _chartContainer.EmptyMessage = display.NoChartDataMessage;
        _chartContainer.DataViewLabel = display.MonthColumnLabel;
        _chartContainer.State = display.ShowChart ? ChartState.Ready : ChartState.Empty;
        _barChart.Series = display.ChartSeries;
        _chartContainer.DataView.XLabel = display.MonthColumnLabel;
        _chartContainer.DataView.Series = display.ChartSeries;

        // GlassPanel9 — session locations.
        _mapTitle.Value = display.MapTitle;
        AutomationProperties.SetName(_mapPanel, display.MapTitle);
        RenderLocations(display);

        // GlassPanel10 — session table.
        _tableTitle.Value = display.TableTitle;
        _exportButton.Text = display.ExportCsvLabel;
        _exportButton.IsEnabled = display.ShowTable;
        RenderTable(display);
    }

    private void RenderVehicleSelect(TeslaChargingSessionsDisplay display)
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
            AutomationProperties.SetName(_vehicleSelect, display.AllVehiclesLabel);
        }
        finally
        {
            _suppressVehicleChange = false;
        }
    }

    private void RenderLocations(TeslaChargingSessionsDisplay display)
    {
        if (display.ShowMapPoints)
        {
            _mapList.Children.Clear();
            foreach (var point in display.MapPoints)
            {
                var entry = new StackPanel { Spacing = 2 };
                entry.Children.Add(new Text { Value = point.SiteName });
                entry.Children.Add(new Caption { Value = point.Coordinates });
                AutomationProperties.SetName(entry, point.AutomationName);
                _mapList.Children.Add(entry);
            }

            _mapHost.Content = _mapScroller;
        }
        else
        {
            _mapEmpty.Message = display.NoMapDataMessage;
            AutomationProperties.SetName(_mapEmpty, display.NoMapDataMessage);
            _mapHost.Content = _mapEmpty;
        }
    }

    private void RenderTable(TeslaChargingSessionsDisplay display)
    {
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
            _tableEmpty.Message = display.NoDataMessage;
            AutomationProperties.SetName(_tableEmpty, display.NoDataMessage);
            _tableHost.Content = _tableEmpty;
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<TeslaChargingColumn> columns)
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

    private static List<TsDataRow> BuildRows(IReadOnlyList<TeslaChargingRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["location"] = row.Location,
                ["vin"] = row.Vin,
                ["energy"] = row.Energy,
                ["peakPower"] = row.PeakPower,
                ["duration"] = row.Duration,
                ["cost"] = row.Cost,
                ["rate"] = row.Rate,
                ["type"] = row.Type,
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

    private static string BuildCsv(TeslaChargingSessionsDisplay display)
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
                row.Date, row.Location, row.Vin, row.Energy, row.PeakPower,
                row.Duration, row.Cost, row.Rate, row.Type,
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

    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaChargingSessionsPageAutomationPeer(this);

    private sealed class TeslaChargingSessionsPageAutomationPeer(TeslaChargingSessionsPage owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
