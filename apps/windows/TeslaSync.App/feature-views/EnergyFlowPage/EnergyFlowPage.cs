using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>EnergyFlowPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/EnergyFlowPage.tsx</c> (route <c>/energy-flow</c>, nav name <c>EnergyFlow</c>).
/// It binds to an <see cref="EnergyFlowPageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the page header; the loading shimmer; the retryable failure surface; the "no energy flow data"
/// empty state; and the six success sections — the real-time energy-flow diagram (Grid → Battery SOC gauge → Motor
/// with the DC/AC/HVAC/Accessories breakdown), the six historical summary tiles, the daily-energy area chart, the
/// daily distance + efficiency bar charts, the efficiency-metrics sub-cards, and the daily-energy history table.
/// The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="EnergyFlowDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class EnergyFlowPage : UserControl, IDisposable
{
    private readonly EnergyFlowPageViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _loadingPanel;
    private readonly TsQueryError _errorState = new();
    private readonly TsGlassPanel _emptyPanel = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EnergyFlowRegistration.EmptyGlyph };
    private readonly StackPanel _contentPanel = new() { Spacing = 24 };

    // Section 1 — energy flow diagram.
    private readonly TsGlassPanel _flowPanel = new();
    private readonly PanelTitle _flowTitle = new();
    private readonly TsBadge _chargeBadge = new() { Status = StatusKind.Neutral };
    private readonly FlowNode _gridNode = new(GlassGlow.Green, "\uE945");
    private readonly FlowEdge _chargingEdge = new();
    private readonly TsGlassPanel _batteryNode = new() { Glow = GlassGlow.Cyan, Padding = new Thickness(16) };
    private readonly TsRadialGauge _batteryGauge = new() { Max = 100, Diameter = 100, Decimals = 0, ColorIndex = 0 };
    private readonly Caption _energyRemaining = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly FlowEdge _drivingEdge = new();
    private readonly FlowNode _motorNode = new(GlassGlow.None, "\uE804");
    private readonly FlowNode _dcNode = new(GlassGlow.None, "\uE945");
    private readonly FlowNode _acNode = new(GlassGlow.None, "\uE9D9");
    private readonly FlowNode _hvacNode = new(GlassGlow.None, "\uE9CA");
    private readonly FlowNode _accessoriesNode = new(GlassGlow.None, "\uE950");

    // Section 2 — six historical summary tiles.
    private readonly TsStatCard _totalEnergyCard = new();
    private readonly TsStatCard _totalChargedCard = new();
    private readonly TsStatCard _distanceCard = new();
    private readonly TsStatCard _efficiencyCard = new();
    private readonly TsStatCard _co2Card = new();
    private readonly TsStatCard _periodCard = new();

    // Section 3/4 — charts.
    private readonly TsChartContainer _energyContainer = new();
    private readonly TsAreaChart _energyChart = new() { ShowLegend = false, Height = 280, IncludeZero = true };
    private readonly TsChartContainer _distanceContainer = new();
    private readonly TsBarChart _distanceChart = new() { ShowLegend = false, Height = 280, IncludeZero = true };
    private readonly TsChartContainer _efficiencyContainer = new();
    private readonly TsBarChart _efficiencyChart = new() { ShowLegend = false, Height = 280, IncludeZero = true };

    // Section 5 — efficiency metrics.
    private readonly TsGlassPanel _metricsPanel = new();
    private readonly PanelTitle _metricsTitle = new();
    private readonly EfficiencyTile _efficiencyMetricTile = new();
    private readonly EfficiencyTile _co2MetricTile = new();
    private readonly EfficiencyTile _avgPerDayTile = new();

    // Section 6 — daily energy history table.
    private readonly TsGlassPanel _historyPanel = new();
    private readonly PanelTitle _historyTitle = new();
    private readonly ContentControl _historyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _historyTable = new() { Selectable = false };
    private readonly TsEmptyState _historyEmpty = new();

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public EnergyFlowPage()
        : this(EmptyEnergyFlowFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The energy-flow data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id; null renders the empty state.</param>
    public EnergyFlowPage(IEnergyFlowFeed feed, Core.Notifications.ILocalizer localizer, string? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new EnergyFlowPageViewModel(feed, localizer, vehicleId);
        _loadingPanel = BuildLoadingPanel();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>EnergyFlow</c>).</summary>
    public static string RouteName => EnergyFlowRegistration.RouteName;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);

        BuildContent();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_errorState);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_emptyPanel);
        stack.Children.Add(_contentPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(3));
        panel.Children.Add(new TsChartBlockSkeleton());
        panel.Children.Add(new TsTableSkeleton());
        return panel;
    }

    private void BuildContent()
    {
        _emptyPanel.Padding = new Thickness(32);
        _emptyPanel.Content = _emptyState;
        _emptyPanel.Visibility = Visibility.Collapsed;

        BuildFlowSection();
        _contentPanel.Children.Add(BuildEqualColumns(16,
            _totalEnergyCard, _totalChargedCard, _distanceCard, _efficiencyCard, _co2Card, _periodCard));

        _energyContainer.Body = _energyChart;
        _contentPanel.Children.Add(_energyContainer);

        _distanceContainer.Body = _distanceChart;
        _efficiencyContainer.Body = _efficiencyChart;
        _contentPanel.Children.Add(BuildEqualColumns(24, _distanceContainer, _efficiencyContainer));

        BuildMetricsSection();
        BuildHistorySection();

        _contentPanel.Visibility = Visibility.Collapsed;
    }

    private void BuildFlowSection()
    {
        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _flowTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_flowTitle, 0);
        _chargeBadge.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_chargeBadge, 1);
        headerRow.Children.Add(_flowTitle);
        headerRow.Children.Add(_chargeBadge);

        var batteryColumn = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        batteryColumn.Children.Add(_batteryGauge);
        batteryColumn.Children.Add(_energyRemaining);
        _batteryNode.Content = batteryColumn;

        var topRow = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        for (var i = 0; i < 5; i++)
        {
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        AddColumn(topRow, _gridNode.Panel, 0);
        AddColumn(topRow, _chargingEdge.Root, 1);
        AddColumn(topRow, _batteryNode, 2);
        AddColumn(topRow, _drivingEdge.Root, 3);
        AddColumn(topRow, _motorNode.Panel, 4);

        var bottomRow = BuildEqualColumns(16, _dcNode.Panel, _acNode.Panel, _hvacNode.Panel, _accessoriesNode.Panel);

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(headerRow);
        body.Children.Add(topRow);
        body.Children.Add(bottomRow);

        _flowPanel.Padding = new Thickness(24);
        _flowPanel.Content = body;
        _contentPanel.Children.Add(_flowPanel);
    }

    private void BuildMetricsSection()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_metricsTitle);
        body.Children.Add(BuildEqualColumns(16, _efficiencyMetricTile.Panel, _co2MetricTile.Panel, _avgPerDayTile.Panel));

        _metricsPanel.Padding = new Thickness(24);
        _metricsPanel.Content = body;
        _contentPanel.Children.Add(_metricsPanel);
    }

    private void BuildHistorySection()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_historyTitle);
        body.Children.Add(_historyHost);

        _historyPanel.Padding = new Thickness(24);
        _historyPanel.Content = body;
        _contentPanel.Children.Add(_historyPanel);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(EnergyFlowDisplay d)
    {
        if (_disposed)
        {
            return;
        }

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.AutomationName);

        _loadingPanel.Visibility = Show(d.ShowLoading);

        _errorState.Visibility = Show(d.ShowError);
        _errorState.Title = d.ErrorText;
        _errorState.ActionText = d.RetryLabel;
        AutomationProperties.SetName(_errorState, d.ErrorText);

        _emptyPanel.Visibility = Show(d.ShowEmpty);
        _emptyState.Title = d.EmptyTitle;
        _emptyState.Message = d.EmptyMessage;
        AutomationProperties.SetName(_emptyState, d.EmptyTitle);

        _contentPanel.Visibility = Show(d.ShowContent);

        RenderFlowSection(d);
        RenderMetricCards(d);
        RenderCharts(d);
        RenderMetricsSection(d);
        RenderHistorySection(d);
    }

    private void RenderFlowSection(EnergyFlowDisplay d)
    {
        _flowTitle.Value = d.FlowDiagramTitle;
        AutomationProperties.SetName(_flowPanel, d.FlowDiagramTitle);

        _chargeBadge.Visibility = Show(d.ChargeStateVisible);
        _chargeBadge.Content = d.ChargeStateText;
        _chargeBadge.Status = d.ChargeStateStatus;

        _gridNode.Apply(d.Grid);
        _chargingEdge.Apply(d.ChargingEdge);

        _batteryGauge.Label = d.BatteryLabel;
        _batteryGauge.Unit = d.BatterySocUnit;
        _batteryGauge.Value = d.BatterySoc;
        _energyRemaining.Value = d.EnergyRemainingText;
        _energyRemaining.Visibility = Show(d.EnergyRemainingVisible);

        _drivingEdge.Apply(d.DrivingEdge);
        _motorNode.Apply(d.Motor);
        _dcNode.Apply(d.DcPower);
        _acNode.Apply(d.AcPower);
        _hvacNode.Apply(d.Hvac);
        _accessoriesNode.Apply(d.Accessories);
    }

    private void RenderMetricCards(EnergyFlowDisplay d)
    {
        ApplyCard(_totalEnergyCard, d.TotalEnergy);
        ApplyCard(_totalChargedCard, d.TotalCharged);
        ApplyCard(_distanceCard, d.Distance);
        ApplyCard(_efficiencyCard, d.Efficiency);
        ApplyCard(_co2Card, d.Co2Saved);
        ApplyCard(_periodCard, d.Period);
    }

    private void RenderCharts(EnergyFlowDisplay d)
    {
        _energyContainer.Title = d.DailyEnergyTitle;
        _energyContainer.EmptyMessage = d.NoDailyEnergyMessage;
        _energyContainer.AccessibleSummary = d.DailyEnergyTitle;
        _energyChart.Series = d.DailyEnergySeries;
        _energyContainer.DataView.Series = d.DailyEnergySeries;
        _energyContainer.State = d.HasDailyEnergy ? ChartState.Ready : ChartState.Empty;

        _distanceContainer.Title = d.DailyDistanceTitle;
        _distanceContainer.EmptyMessage = d.NoDailyDistanceMessage;
        _distanceContainer.AccessibleSummary = d.DailyDistanceTitle;
        _distanceChart.Series = d.DailyDistanceSeries;
        _distanceContainer.DataView.Series = d.DailyDistanceSeries;
        _distanceContainer.State = d.HasDailyDistance ? ChartState.Ready : ChartState.Empty;

        _efficiencyContainer.Title = d.DailyEfficiencyTitle;
        _efficiencyContainer.EmptyMessage = d.NoEfficiencyMessage;
        _efficiencyContainer.AccessibleSummary = d.DailyEfficiencyTitle;
        _efficiencyChart.Series = d.DailyEfficiencySeries;
        _efficiencyContainer.DataView.Series = d.DailyEfficiencySeries;
        _efficiencyContainer.State = d.HasDailyEfficiency ? ChartState.Ready : ChartState.Empty;
    }

    private void RenderMetricsSection(EnergyFlowDisplay d)
    {
        _metricsTitle.Value = d.EfficiencyMetricsTitle;
        AutomationProperties.SetName(_metricsPanel, d.EfficiencyMetricsTitle);
        _efficiencyMetricTile.Apply(d.EfficiencyCard);
        _co2MetricTile.Apply(d.Co2Card);
        _avgPerDayTile.Apply(d.AvgPerDayCard);
    }

    private void RenderHistorySection(EnergyFlowDisplay d)
    {
        _historyTitle.Value = d.DailyHistoryTitle;
        AutomationProperties.SetName(_historyPanel, d.DailyHistoryTitle);

        if (d.HasHistory)
        {
            _historyTable.Columns = BuildColumns(d.HistoryColumns);
            _historyTable.Rows = BuildRows(d.HistoryRows);
            _historyTable.EmptyMessage = d.HistoryTableEmptyMessage;
            AutomationProperties.SetName(_historyTable, d.DailyHistoryTitle);
            _historyHost.Content = _historyTable;
        }
        else
        {
            _historyEmpty.Message = d.HistoryEmptyMessage;
            AutomationProperties.SetName(_historyEmpty, d.HistoryEmptyMessage);
            _historyHost.Content = _historyEmpty;
        }
    }

    private static void ApplyCard(TsStatCard card, EnergyMetricTile tile)
    {
        card.Label = tile.Label;
        card.Value = tile.Value;
        card.Sublabel = tile.Sublabel;
        card.Glyph = tile.Glyph;
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<EnergyHistoryColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn { Key = column.Key, Header = column.Header, IsNumeric = column.IsNumeric });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<EnergyHistoryRowDisplay> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["energy"] = row.Energy,
                ["distance"] = row.Distance,
                ["efficiency"] = row.Efficiency,
            };
            built.Add(new TsDataRow(row.Key, values));
        }

        return built;
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

    private static void AddColumn(Grid grid, FrameworkElement child, int column)
    {
        Grid.SetColumn(child, column);
        grid.Children.Add(child);
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new EnergyFlowPageAutomationPeer(this);

    private sealed class EnergyFlowPageAutomationPeer(EnergyFlowPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }

    /// <summary>A flow-diagram node — a tokenized glass panel with an accent glyph, a label and an optional value/state line.</summary>
    private sealed class FlowNode
    {
        private readonly FontIcon _icon;
        private readonly Caption _label = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly Caption _value = new() { HorizontalAlignment = HorizontalAlignment.Center };

        public FlowNode(GlassGlow glow, string glyph)
        {
            _icon = new FontIcon { Glyph = glyph, FontSize = 20, HorizontalAlignment = HorizontalAlignment.Center };

            var column = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(_icon);
            column.Children.Add(_label);
            column.Children.Add(_value);

            Panel = new TsGlassPanel { Glow = glow, Padding = new Thickness(16), Content = column };
        }

        public TsGlassPanel Panel { get; }

        public void Apply(EnergyFlowNode node)
        {
            _label.Value = node.Label;
            _value.Value = node.Value;
            _value.Visibility = string.IsNullOrEmpty(node.Value) ? Visibility.Collapsed : Visibility.Visible;
            AutomationProperties.SetName(Panel, string.IsNullOrEmpty(node.Value) ? node.Label : $"{node.Label}: {node.Value}");
        }
    }

    /// <summary>A flow-diagram edge (web <c>FlowArrow</c>) — a label caption over a value chip dimmed when inactive.</summary>
    private sealed class FlowEdge
    {
        private readonly Caption _label = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly Text _value = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly Border _chip;

        public FlowEdge()
        {
            _chip = new Border
            {
                CornerRadius = new CornerRadius(999),
                Padding = new Thickness(12, 4, 12, 4),
                BorderThickness = new Thickness(1),
                BorderBrush = Brush("TsColorBorderBrush"),
                Child = _value,
                HorizontalAlignment = HorizontalAlignment.Center,
            };

            var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            column.Children.Add(_label);
            column.Children.Add(_chip);
            Root = column;
        }

        public StackPanel Root { get; }

        public void Apply(EnergyFlowEdge edge)
        {
            _label.Value = edge.Label;
            _value.Value = edge.Value;
            Root.Opacity = edge.Active ? 1.0 : 0.3;
            AutomationProperties.SetName(Root, $"{edge.Label}: {edge.Value}");
        }
    }

    /// <summary>An efficiency-metrics sub-card — a tokenized glass panel with a caption, large value and a status badge.</summary>
    private sealed class EfficiencyTile
    {
        private readonly Caption _label = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly MetricValue _value = new() { HorizontalAlignment = HorizontalAlignment.Center };
        private readonly TsBadge _badge = new() { HorizontalAlignment = HorizontalAlignment.Center };

        public EfficiencyTile()
        {
            var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(_label);
            column.Children.Add(_value);
            column.Children.Add(_badge);

            Panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        }

        public TsGlassPanel Panel { get; }

        public void Apply(EnergyEfficiencyTile tile)
        {
            _label.Value = tile.Label;
            _value.Value = tile.Value;
            _badge.Content = tile.BadgeText;
            _badge.Status = tile.BadgeStatus;
            AutomationProperties.SetName(Panel, $"{tile.Label}: {tile.Value}, {tile.BadgeText}");
        }
    }

    private static Brush? Brush(string key) =>
        Application.Current?.Resources is { } r && r.TryGetValue(key, out var v) && v is Brush b ? b : null;
}
