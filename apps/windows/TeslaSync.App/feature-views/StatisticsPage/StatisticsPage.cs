using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>StatisticsPage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/StatisticsPage.tsx</c> (route <c>/statistics</c>, nav name
/// <c>Statistics</c>). It binds to a <see cref="StatisticsPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle); the loading shimmer; the failure
/// surface (InfoBar-equivalent + Retry); the page-level "No Data" <see cref="TsEmptyState"/>; the five period
/// stat tiles + three average tiles; the battery-health <see cref="TsGlassPanel"/> (a <see cref="TsRadialGauge"/>
/// SOH gauge + four tiles, or its empty state); the state-distribution <see cref="TsChartContainer"/>
/// (<see cref="TsPieChart"/>); the mileage <see cref="TsGlassPanel"/> (four tiles or its empty state); and the
/// vehicle-comparison <see cref="TsChartContainer"/> (<see cref="TsBarChart"/>). The view is a thin renderer: all
/// branch selection, SI conversion, formatting and i18n happen in the view-model's
/// <see cref="StatisticsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class StatisticsPage : UserControl, IDisposable
{
    private readonly StatisticsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 24 };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = StatisticsRegistration.NoDataGlyph };

    private readonly StackPanel _contentRoot = new() { Spacing = 24 };

    private readonly TsMetricCard[] _periodCards = CreateCards(8);

    private readonly TsGlassPanel _batteryPanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _batteryTitle = new();
    private readonly ContentControl _batteryHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsRadialGauge _gauge = new() { Diameter = 140, Role = ChartRole.Battery };
    private readonly TsMetricCard[] _batteryCards = CreateCards(4);
    private readonly TsEmptyState _batteryEmpty = new() { IconGlyph = StatisticsRegistration.NoBatteryGlyph };
    private FrameworkElement? _batteryContent;

    private readonly TsChartContainer _stateContainer = new();
    private readonly TsPieChart _pie = new() { InnerRadiusRatio = 0.55, MinHeight = 256 };

    private readonly TsGlassPanel _mileagePanel = new() { Padding = new Thickness(24) };
    private readonly PanelTitle _mileageTitle = new();
    private readonly ContentControl _mileageHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly TsMetricCard[] _mileageCards = CreateCards(4);
    private readonly TsEmptyState _mileageEmpty = new() { IconGlyph = StatisticsRegistration.NoMileageGlyph };
    private Grid? _mileageGrid;

    private readonly TsChartContainer _comparisonContainer = new();
    private readonly TsBarChart _bar = new() { MinHeight = 288 };

    /// <summary>Creates the page over the default empty source and the shell resource localizer.</summary>
    public StatisticsPage()
        : this(EmptyStatisticsSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The statistics data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public StatisticsPage(IStatisticsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new StatisticsPageViewModel(source, localizer);

        BuildLoadingSkeleton();
        BuildContent();

        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>StatisticsPage</c>).</summary>
    public static string Slug => StatisticsRegistration.Slug;

    private static TsMetricCard[] CreateCards(int count)
    {
        var cards = new TsMetricCard[count];
        for (var i = 0; i < count; i++)
        {
            cards[i] = new TsMetricCard();
        }

        return cards;
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_contentRoot);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    // Mirrors the web StatisticsSkeleton: 5 stat cards → 3 averages → 1 block → chart + block → chart.
    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(5));
        _loadingSkeleton.Children.Add(new TsStatGridSkeleton(3));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 220, Radius = 12 });

        var row = new Grid { ColumnSpacing = 24 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var chartBlock = new TsChartBlockSkeleton();
        var block = new TsSkeleton { BlockHeight = 288, Radius = 12 };
        Grid.SetColumn(chartBlock, 0);
        Grid.SetColumn(block, 1);
        row.Children.Add(chartBlock);
        row.Children.Add(block);
        _loadingSkeleton.Children.Add(row);

        _loadingSkeleton.Children.Add(new TsChartBlockSkeleton());
    }

    private void BuildContent()
    {
        // Period stats: five tiles (web grid-cols-5) then three averages (web grid-cols-3).
        _contentRoot.Children.Add(new TsFadeIn { Content = BuildEqualColumns(12, _periodCards[0], _periodCards[1], _periodCards[2], _periodCards[3], _periodCards[4]) });
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildEqualColumns(12, _periodCards[5], _periodCards[6], _periodCards[7]) });

        // Battery health panel (web GlassPanel: gauge + four tiles | empty).
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildBatteryPanel() });

        // State distribution + mileage (web grid lg:cols-2).
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildStateAndMileageRow() });

        // Vehicle comparison (web full-width ChartContainer + BarChart).
        _comparisonContainer.Body = _bar;
        _contentRoot.Children.Add(new TsFadeIn { DelayMs = 200, Content = _comparisonContainer });
    }

    private TsGlassPanel BuildBatteryPanel()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_batteryTitle);
        body.Children.Add(_batteryHost);

        var gaugeHost = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        gaugeHost.Children.Add(_gauge);

        var cardGrid = BuildCardMatrix(_batteryCards);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(gaugeHost, 0);
        Grid.SetColumn(cardGrid, 1);
        grid.Children.Add(gaugeHost);
        grid.Children.Add(cardGrid);
        _batteryContent = grid;

        _batteryHost.Content = _batteryContent;
        _batteryPanel.Content = body;
        return _batteryPanel;
    }

    private Grid BuildStateAndMileageRow()
    {
        _stateContainer.Body = _pie;

        var mileageBody = new StackPanel { Spacing = 16 };
        mileageBody.Children.Add(_mileageTitle);
        mileageBody.Children.Add(_mileageHost);
        _mileageGrid = BuildCardMatrix(_mileageCards);
        _mileageHost.Content = _mileageGrid;
        _mileagePanel.Content = mileageBody;

        var grid = new Grid { ColumnSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(_stateContainer, 0);
        Grid.SetColumn(_mileagePanel, 1);
        grid.Children.Add(_stateContainer);
        grid.Children.Add(_mileagePanel);
        return grid;
    }

    // A 2-column matrix hosting the supplied cards (web Grid cols 2).
    private static Grid BuildCardMatrix(TsMetricCard[] cards)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        int rows = (cards.Length + 1) / 2;
        for (var r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (var i = 0; i < cards.Length; i++)
        {
            cards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetRow(cards[i], i / 2);
            Grid.SetColumn(cards[i], i % 2);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    // A single row of equal-width star columns hosting each child (web responsive card grid).
    private static Grid BuildEqualColumns(double spacing, params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = spacing };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            children[i].HorizontalAlignment = HorizontalAlignment.Stretch;
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

    private void Render(StatisticsDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryText;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.NoDataTitle;
        _emptyState.Message = display.NoDataMessage;

        _contentRoot.Visibility = Show(display.ShowContent);

        RenderMetrics(_periodCards, display.PeriodMetrics);
        RenderBattery(display);
        RenderStateDistribution(display);
        RenderMileage(display);
        RenderComparison(display);
    }

    private static void RenderMetrics(TsMetricCard[] cards, IReadOnlyList<StatisticsMetric> metrics)
    {
        for (var i = 0; i < cards.Length && i < metrics.Count; i++)
        {
            var metric = metrics[i];
            cards[i].Label = metric.Label;
            cards[i].Value = metric.Value;
            cards[i].AccentBrushKey = metric.AccentBrushKey;
            AutomationProperties.SetName(cards[i], metric.AutomationName);
        }
    }

    private void RenderBattery(StatisticsDisplay display)
    {
        _batteryTitle.Value = display.BatteryHealthTitle;
        AutomationProperties.SetName(_batteryPanel, display.BatteryHealthTitle);

        if (display.HasBattery)
        {
            _gauge.Value = display.GaugeValue;
            _gauge.Label = display.GaugeLabel;
            _gauge.Unit = display.GaugeUnit;
            RenderMetrics(_batteryCards, display.BatteryMetrics);
            _batteryHost.Content = _batteryContent;
        }
        else
        {
            _batteryEmpty.Message = display.NoBatteryMessage;
            AutomationProperties.SetName(_batteryEmpty, display.NoBatteryMessage);
            _batteryHost.Content = _batteryEmpty;
        }
    }

    private void RenderStateDistribution(StatisticsDisplay display)
    {
        _stateContainer.Title = display.StateDistributionTitle;
        _stateContainer.AccessibleSummary = display.StateDistributionAria;
        _stateContainer.EmptyMessage = display.NoStatesMessage;

        if (display.HasStates)
        {
            var points = new List<ChartPoint>(display.StateSlices.Count);
            for (var i = 0; i < display.StateSlices.Count; i++)
            {
                var slice = display.StateSlices[i];
                points.Add(new ChartPoint(i, slice.Percentage, slice.Name));
            }

            _pie.Values = points;
            _stateContainer.State = ChartState.Ready;
        }
        else
        {
            _pie.Values = [];
            _stateContainer.State = ChartState.Empty;
        }
    }

    private void RenderMileage(StatisticsDisplay display)
    {
        _mileageTitle.Value = display.MileageTitle;
        AutomationProperties.SetName(_mileagePanel, display.MileageTitle);

        if (display.HasMileage)
        {
            RenderMetrics(_mileageCards, display.MileageMetrics);
            _mileageHost.Content = _mileageGrid;
        }
        else
        {
            _mileageEmpty.Message = display.NoMileageMessage;
            AutomationProperties.SetName(_mileageEmpty, display.NoMileageMessage);
            _mileageHost.Content = _mileageEmpty;
        }
    }

    private void RenderComparison(StatisticsDisplay display)
    {
        _comparisonContainer.Title = display.VehicleComparisonTitle;
        _comparisonContainer.AccessibleSummary = display.VehicleComparisonAria;
        _comparisonContainer.EmptyMessage = display.SingleVehicleMessage;

        if (display.HasComparison)
        {
            _bar.Series = BuildComparisonSeries(display);
            _comparisonContainer.State = ChartState.Ready;
        }
        else
        {
            _bar.Series = [];
            _comparisonContainer.State = ChartState.Empty;
        }
    }

    private static IReadOnlyList<ChartSeries> BuildComparisonSeries(StatisticsDisplay display)
    {
        var distance = new List<ChartPoint>(display.Comparisons.Count);
        var energy = new List<ChartPoint>(display.Comparisons.Count);
        for (var i = 0; i < display.Comparisons.Count; i++)
        {
            var bar = display.Comparisons[i];
            distance.Add(new ChartPoint(i, bar.Distance, bar.Name));
            energy.Add(new ChartPoint(i, bar.Energy, bar.Name));
        }

        return
        [
            new ChartSeries(display.DistanceSeriesName, distance) { Kind = ChartSeriesKind.Bar, ColorIndex = 0 },
            new ChartSeries(display.EnergySeriesName, energy) { Kind = ChartSeriesKind.Bar, ColorIndex = 1 },
        ];
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new StatisticsPageAutomationPeer(this);

    private sealed class StatisticsPageAutomationPeer(StatisticsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
