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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>EnergyPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/EnergyPage.tsx</c> (route <c>/energy</c>, nav name <c>Energy</c>). It binds
/// to an <see cref="EnergyPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header with a data-freshness chip; the loading skeleton; the retry surface; the hero panel
/// (four <see cref="TsRadialGauge"/> gauges or the empty-hero state); the six quick-metric cards; the Lifetime
/// Metrics panel; the two cost-vs-gas comparison cards; the Energy &amp; Cost Daily composed chart; the
/// Efficiency Trend area chart; the Charging by Time of Day bar chart with its two tips; the Charger Type
/// Breakdown pie chart with its legend; and the Recent Charging Sessions table. The view is a thin renderer:
/// all branch selection, formatting and i18n happen in the view-model's <see cref="EnergyDisplay"/> projection.
/// State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class EnergyPage : UserControl, IDisposable
{
    private readonly EnergyPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingPanel;
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _contentPanel = new() { Spacing = 24 };

    // GlassPanel1 — hero gauges (or empty hero).
    private readonly TsGlassPanel _heroPanel = new() { Padding = new Thickness(20) };
    private readonly Grid _gaugeGrid;
    private readonly TsRadialGauge[] _gauges =
    [
        new() { Diameter = 120 }, new() { Diameter = 120 }, new() { Diameter = 120 }, new() { Diameter = 120 },
    ];
    private readonly TsEmptyState _emptyHero = new() { IconGlyph = "\uE945" };

    // GlassPanel2 — quick-metrics strip (6 cards).
    private readonly TsStatCard[] _metrics = [new(), new(), new(), new(), new(), new()];

    // GlassPanel3 — lifetime metrics.
    private readonly TsGlassPanel _lifetimePanel = new() { Padding = new Thickness(20), Glow = GlassGlow.Cyan };
    private readonly SectionTitle _lifetimeTitle = new();
    private readonly TsStatCard[] _lifetimeCards = [new(), new()];

    // GlassPanel4 — cost-vs-gas comparison.
    private readonly CompareTile[] _compares = [new(), new()];

    // Energy-Cost-Daily — composed chart.
    private readonly TsChartContainer _energyCostContainer = new();
    private readonly TsComposedChart _energyCostChart = new() { Height = 260, IncludeZero = true };

    // Efficiency-Trend — area chart.
    private readonly TsChartContainer _efficiencyContainer = new();
    private readonly TsAreaChart _efficiencyChart = new() { Height = 260, IncludeZero = true };

    // Charging-by-Time-of-Day — bar chart + tips.
    private readonly TsChartContainer _timeOfDayContainer = new();
    private readonly TsBarChart _timeOfDayChart = new() { Height = 240, IncludeZero = true };
    private readonly Caption _offPeakTip = new();
    private readonly Caption _solarTip = new();

    // Charger-Type-Breakdown — pie chart + legend.
    private readonly TsChartContainer _chargerContainer = new();
    private readonly TsPieChart _chargerPie = new() { Width = 180, Height = 180, InnerRadiusRatio = 0.55 };
    private readonly StackPanel _chargerLegend = new() { Spacing = 10, VerticalAlignment = VerticalAlignment.Center };

    // GlassPanel9 — recent charging sessions.
    private readonly TsGlassPanel _sessionsPanel = new() { Padding = new Thickness(20), Glow = GlassGlow.Green };
    private readonly SectionTitle _sessionsTitle = new();
    private readonly ContentControl _sessionsHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsDataTable _sessionsTable = new() { Selectable = false, PageSize = 15 };
    private readonly TsEmptyState _sessionsEmpty = new() { IconGlyph = "\uE945" };

    /// <summary>Creates the page over the default empty feeds and the shell resource localizer.</summary>
    public EnergyPage()
        : this(
            EmptyEnergyStatsSource.Instance,
            EmptyChargingSessionsSource.Instance,
            EmptyChargingTelemetryLatestSource.Instance,
            ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over explicit data sources and a localizer (used by tests / DI hosts).</summary>
    /// <param name="statsSource">The cache-then-network energy-stats port (native <c>useEnergyStats</c>).</param>
    /// <param name="sessionsSource">The charging-sessions port (native <c>useChargingSessionsPaginated</c>).</param>
    /// <param name="liveSource">The latest-live-charging port (native <c>useChargingTelemetryLatest</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public EnergyPage(
        IEnergyStatsSource statsSource,
        IChargingSessionsSource sessionsSource,
        IChargingTelemetryLatestSource liveSource,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(statsSource);
        ArgumentNullException.ThrowIfNull(sessionsSource);
        ArgumentNullException.ThrowIfNull(liveSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new EnergyPageViewModel(statsSource, sessionsSource, liveSource, localizer);
        _gaugeGrid = UniformGrid(4, 16, _gauges[0], _gauges[1], _gauges[2], _gauges[3]);
        _loadingPanel = BuildLoadingPanel();
        _errorState.ActionText = localizer.GetString("error.retry", "Retry");

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Energy</c>).</summary>
    public static string RouteName => EnergyRegistration.RouteName;

    private ScrollViewer BuildLayout()
    {
        var header = new StackPanel { Spacing = 4 };
        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var titleStack = new StackPanel { Spacing = 4 };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        Grid.SetColumn(titleStack, 0);
        Grid.SetColumn(_freshness, 1);
        titleRow.Children.Add(titleStack);
        titleRow.Children.Add(_freshness);
        header.Children.Add(titleRow);

        BuildContentPanel();

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(header);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorState);
        stack.Children.Add(_contentPanel);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
        };
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 24, Visibility = Visibility.Collapsed };
        panel.Children.Add(new TsStatGridSkeleton(4));
        panel.Children.Add(new TsStatGridSkeleton(6));
        panel.Children.Add(new TsTableSkeleton());
        panel.Children.Add(new TsTableSkeleton());
        return panel;
    }

    private void BuildContentPanel()
    {
        // GlassPanel1 — hero gauges / empty hero.
        _heroPanel.Content = _gaugeGrid;
        _contentPanel.Children.Add(_heroPanel);

        // GlassPanel2 — quick metrics (6 cards, two rows of three).
        _contentPanel.Children.Add(UniformGrid(3, 12, _metrics[0], _metrics[1], _metrics[2], _metrics[3], _metrics[4], _metrics[5]));

        // GlassPanel3 — lifetime metrics.
        var lifetimeColumn = new StackPanel { Spacing = 12 };
        lifetimeColumn.Children.Add(_lifetimeTitle);
        lifetimeColumn.Children.Add(UniformGrid(2, 12, _lifetimeCards[0], _lifetimeCards[1]));
        _lifetimePanel.Content = lifetimeColumn;
        _contentPanel.Children.Add(_lifetimePanel);

        // GlassPanel4 — cost vs gas comparison.
        _contentPanel.Children.Add(UniformGrid(2, 16, _compares[0].Root, _compares[1].Root));

        // Charts row 1 — Energy & Cost Daily + Efficiency Trend.
        _energyCostChart.ShowLegend = true;
        _energyCostContainer.Body = _energyCostChart;
        _efficiencyChart.ShowLegend = true;
        _efficiencyContainer.Body = _efficiencyChart;
        _contentPanel.Children.Add(UniformGrid(2, 24, _energyCostContainer, _efficiencyContainer));

        // Charts row 2 — Charging by Time of Day + Charger Type Breakdown.
        var timeBody = new StackPanel { Spacing = 12 };
        timeBody.Children.Add(_timeOfDayChart);
        var tips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        tips.Children.Add(TipRow("\uEC46", _offPeakTip));
        tips.Children.Add(TipRow("\uE706", _solarTip));
        timeBody.Children.Add(tips);
        _timeOfDayContainer.Body = timeBody;

        var chargerBody = new Grid { ColumnSpacing = 24 };
        chargerBody.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        chargerBody.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_chargerPie, 0);
        Grid.SetColumn(_chargerLegend, 1);
        chargerBody.Children.Add(_chargerPie);
        chargerBody.Children.Add(_chargerLegend);
        _chargerContainer.Body = chargerBody;

        _contentPanel.Children.Add(UniformGrid(2, 24, _timeOfDayContainer, _chargerContainer));

        // GlassPanel9 — recent charging sessions.
        var sessionsColumn = new StackPanel { Spacing = 16 };
        sessionsColumn.Children.Add(_sessionsTitle);
        sessionsColumn.Children.Add(_sessionsHost);
        _sessionsPanel.Content = sessionsColumn;
        _contentPanel.Children.Add(_sessionsPanel);

        _contentPanel.Visibility = Visibility.Collapsed;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher is null || _dispatcher.HasThreadAccess)
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
        if (_disposed)
        {
            return;
        }

        var d = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = d.Title;
        _subtitle.Value = d.Subtitle;
        AutomationProperties.SetName(this, d.DocumentTitle);

        RenderHero(d);
        RenderMetrics(d);
        RenderLifetime(d);
        RenderCompares(d);
        RenderEnergyCostChart(d);
        RenderEfficiencyChart(d);
        RenderTimeOfDayChart(d);
        RenderChargerBreakdown(d);
        RenderSessions(d);

        // Header freshness chip (web DataFreshnessAuto).
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError || state == EnergyState.Offline;

        // State machine: loading / error / content (ready|stale|offline).
        bool content = state is EnergyState.Ready or EnergyState.Stale or EnergyState.Offline;
        _loadingPanel.Visibility = state == EnergyState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _errorState.Visibility = state == EnergyState.Error ? Visibility.Visible : Visibility.Collapsed;
        _contentPanel.Visibility = content ? Visibility.Visible : Visibility.Collapsed;

        _errorState.Title = _viewModel.ErrorMessage ?? string.Empty;
        AutomationProperties.SetName(_errorState, _viewModel.ErrorMessage ?? d.Title);
    }

    private void RenderHero(EnergyDisplay d)
    {
        if (d.ShowEmptyHero)
        {
            _emptyHero.Message = d.EmptyHeroMessage;
            _heroPanel.Content = _emptyHero;
            AutomationProperties.SetName(_heroPanel, d.EmptyHeroMessage);
            return;
        }

        _heroPanel.Content = _gaugeGrid;
        for (int i = 0; i < _gauges.Length && i < d.Gauges.Count; i++)
        {
            var g = d.Gauges[i];
            _gauges[i].Label = g.Label;
            _gauges[i].Value = g.Value;
            _gauges[i].Max = g.Max;
            _gauges[i].Unit = g.Unit;
            _gauges[i].ColorIndex = g.ColorIndex;
        }

        AutomationProperties.SetName(_heroPanel, d.Title);
    }

    private void RenderMetrics(EnergyDisplay d)
    {
        for (int i = 0; i < _metrics.Length && i < d.Metrics.Count; i++)
        {
            _metrics[i].Label = d.Metrics[i].Label;
            _metrics[i].Value = d.Metrics[i].Value;
            AutomationProperties.SetName(_metrics[i], $"{d.Metrics[i].Label}: {d.Metrics[i].Value}");
        }
    }

    private void RenderLifetime(EnergyDisplay d)
    {
        _lifetimeTitle.Value = d.LifetimeTitle;
        for (int i = 0; i < _lifetimeCards.Length && i < d.LifetimeCards.Count; i++)
        {
            _lifetimeCards[i].Label = d.LifetimeCards[i].Label;
            _lifetimeCards[i].Value = d.LifetimeCards[i].Value;
            _lifetimeCards[i].Sublabel = d.LifetimeCards[i].Description;
        }
    }

    private void RenderCompares(EnergyDisplay d)
    {
        for (int i = 0; i < _compares.Length && i < d.CostCompares.Count; i++)
        {
            _compares[i].Apply(d.CostCompares[i]);
        }
    }

    private void RenderEnergyCostChart(EnergyDisplay d)
    {
        _energyCostContainer.Title = d.EnergyCostTitle;
        _energyCostContainer.AccessibleSummary = d.EnergyCostAria;
        _energyCostContainer.EmptyMessage = d.NoEnergyDataMessage;
        _energyCostChart.Series = d.EnergyCostSeries;
        _energyCostContainer.State = d.EnergyCostState;
    }

    private void RenderEfficiencyChart(EnergyDisplay d)
    {
        _efficiencyContainer.Title = d.EfficiencyTitle;
        _efficiencyContainer.AccessibleSummary = d.EfficiencyAria;
        _efficiencyContainer.EmptyMessage = d.NoEfficiencyDataMessage;
        _efficiencyChart.Series = d.EfficiencySeries;
        _efficiencyContainer.State = d.EfficiencyState;
    }

    private void RenderTimeOfDayChart(EnergyDisplay d)
    {
        _timeOfDayContainer.Title = d.TimeOfDayTitle;
        _timeOfDayContainer.AccessibleSummary = d.TimeOfDayAria;
        _timeOfDayContainer.EmptyMessage = d.NoDataMessage;
        _timeOfDayChart.Series = d.TimeOfDaySeries;
        _timeOfDayContainer.State = d.TimeOfDayState;
        _offPeakTip.Value = d.OffPeakTip;
        _solarTip.Value = d.SolarTip;
    }

    private void RenderChargerBreakdown(EnergyDisplay d)
    {
        _chargerContainer.Title = d.ChargerBreakdownTitle;
        _chargerContainer.AccessibleSummary = d.ChargerBreakdownAria;
        _chargerContainer.EmptyMessage = d.NoDataMessage;
        _chargerPie.Values = d.ChargerSlices;
        _chargerContainer.State = d.ChargerBreakdownState;

        _chargerLegend.Children.Clear();
        foreach (var row in d.ChargerRows)
        {
            _chargerLegend.Children.Add(BuildChargerLegendRow(row));
        }
    }

    private void RenderSessions(EnergyDisplay d)
    {
        _sessionsTitle.Value = d.SessionsTitle;
        if (d.HasSessions)
        {
            _sessionsTable.Columns = BuildColumns(d.SessionColumns);
            _sessionsTable.Rows = BuildRows(d.SessionRows);
            _sessionsTable.EmptyMessage = d.SessionsEmptyMessage;
            AutomationProperties.SetName(_sessionsTable, d.SessionsTitle);
            _sessionsHost.Content = _sessionsTable;
        }
        else
        {
            _sessionsEmpty.Message = d.SessionsEmptyMessage;
            AutomationProperties.SetName(_sessionsEmpty, d.SessionsEmptyMessage);
            _sessionsHost.Content = _sessionsEmpty;
        }
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<EnergyColumn> columns)
    {
        var built = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            built.Add(new TsDataColumn { Key = column.Key, Header = column.Header, IsNumeric = column.IsNumeric });
        }

        return built;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<EnergySessionRow> rows)
    {
        var built = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["energy"] = row.Energy,
                ["battery"] = row.Battery,
                ["power"] = row.Power,
                ["type"] = row.Type,
                ["cost"] = row.Cost,
                ["perKwh"] = row.PerKwh,
            };
            built.Add(new TsDataRow(row.Id, values));
        }

        return built;
    }

    private static StackPanel BuildChargerLegendRow(EnergyChargerRow row)
    {
        var topRow = new Grid();
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var swatch = new Microsoft.UI.Xaml.Shapes.Ellipse
        {
            Width = 10,
            Height = 10,
            VerticalAlignment = VerticalAlignment.Center,
            Fill = ChartBrushes.ForIndex(row.ColorIndex),
        };
        nameRow.Children.Add(swatch);
        nameRow.Children.Add(new Text { Value = row.Name });
        Grid.SetColumn(nameRow, 0);

        var sessions = new Caption { Value = row.SessionsText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(sessions, 1);
        topRow.Children.Add(nameRow);
        topRow.Children.Add(sessions);

        var statsRow = new Grid();
        statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var energyText = new Caption { Value = row.EnergyText };
        var costText = new Caption { Value = row.CostText, Margin = new Thickness(12, 0, 12, 0) };
        var perKwhText = new Caption { Value = row.PerKwhText };
        Grid.SetColumn(energyText, 0);
        Grid.SetColumn(costText, 1);
        Grid.SetColumn(perKwhText, 2);
        statsRow.Children.Add(energyText);
        statsRow.Children.Add(costText);
        statsRow.Children.Add(perKwhText);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(topRow);
        column.Children.Add(statsRow);
        AutomationProperties.SetName(column, $"{row.Name}: {row.SessionsText}, {row.EnergyText}, {row.CostText}, {row.PerKwhText}");
        return column;
    }

    private static StackPanel TipRow(string glyph, Caption caption)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        caption.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(caption);
        return row;
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

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

    protected override AutomationPeer OnCreateAutomationPeer() => new EnergyPageAutomationPeer(this);

    private static Grid UniformGrid(int columns, double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int i = 0; i < columns; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < children.Length; i++)
        {
            int col = i % columns;
            int row = i / columns;
            while (grid.RowDefinitions.Count <= row)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            }

            Grid.SetColumn(children[i], col);
            Grid.SetRow(children[i], row);
            grid.Children.Add(children[i]);
        }

        return grid;
    }

    private static Brush? Brush(string key) =>
        Application.Current?.Resources is { } r && r.TryGetValue(key, out var v) && v is Brush b ? b : null;

    /// <summary>A cost-vs-gas comparison card (web <c>CostComparisonCard</c>) — EV vs gas with the saving chip.</summary>
    private sealed class CompareTile
    {
        private readonly Caption _label = new();
        private readonly Caption _evLabel = new();
        private readonly MetricValue _evValue = new();
        private readonly Caption _gasLabel = new();
        private readonly Text _gasValue = new();
        private readonly Text _saving = new();
        private readonly Caption _percent = new() { VerticalAlignment = VerticalAlignment.Center };

        public CompareTile()
        {
            var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            header.Children.Add(new FontIcon { Glyph = "\uE945", FontSize = 16, VerticalAlignment = VerticalAlignment.Center });
            header.Children.Add(_label);

            var evColumn = new StackPanel { Spacing = 2 };
            evColumn.Children.Add(_evLabel);
            evColumn.Children.Add(_evValue);

            var gasColumn = new StackPanel { Spacing = 2 };
            gasColumn.Children.Add(_gasLabel);
            gasColumn.Children.Add(_gasValue);

            var costRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };
            costRow.Children.Add(evColumn);
            costRow.Children.Add(new FontIcon { Glyph = "\uE72A", FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
            costRow.Children.Add(gasColumn);

            var chip = new Border
            {
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(8, 2, 8, 2),
                BorderThickness = new Thickness(1),
                BorderBrush = Brush("TsColorBorderBrush"),
                VerticalAlignment = VerticalAlignment.Center,
                Child = _percent,
            };

            var savingRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
            savingRow.Children.Add(_saving);
            savingRow.Children.Add(chip);

            var column = new StackPanel { Spacing = 12 };
            column.Children.Add(header);
            column.Children.Add(costRow);
            column.Children.Add(savingRow);

            Root = new TsGlassPanel { Padding = new Thickness(20), Content = column };
        }

        public TsGlassPanel Root { get; }

        public void Apply(EnergyCostCompare compare)
        {
            _label.Value = compare.Label;
            _evLabel.Value = compare.EvCostLabel;
            _evValue.Value = compare.EvCostValue;
            _gasLabel.Value = compare.GasLabel;
            _gasValue.Value = compare.GasValue;
            _saving.Value = compare.SavingText;
            _percent.Value = compare.PercentLessText;
            AutomationProperties.SetName(Root, $"{compare.Label}. {compare.SavingText}, {compare.PercentLessText}");
        }
    }

    private sealed class EnergyPageAutomationPeer(EnergyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetClassNameCore() => nameof(EnergyPage);
    }
}
