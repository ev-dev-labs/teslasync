using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>TimelinePage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/TimelinePage.tsx</c> (route <c>/timeline</c>, nav name <c>Timeline</c>). It
/// binds to a <see cref="TimelinePageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle), the actions row (vehicle picker / range preset / refresh), the
/// failure banner (web <c>anyError</c>), the full-page loading scaffold, the four summary metric cards
/// (Total Transitions / Driving Time / Charging Time / Idle &amp; Sleep), the state-distribution bar + legend, the
/// daily-breakdown bar chart and the transitions table — each data region switching between its loading shimmer,
/// its empty state and its content exactly as the web composes them. The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="TimelineDisplay"/> projection. State changes
/// are marshalled onto the UI thread.
/// </summary>
public sealed partial class TimelinePage : UserControl, IDisposable
{
    private readonly TimelinePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsSelect _rangeSelect = new() { MinWidth = 150 };
    private readonly TsButton _refreshButton = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE72C" };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly TsPageLoadSkeleton _loadingSkeleton = new();
    private readonly StackPanel _content = new() { Spacing = 24 };

    private readonly TsMetricCard _totalTransitionsCard = new();
    private readonly TsMetricCard _drivingCard = new();
    private readonly TsMetricCard _chargingCard = new();
    private readonly TsMetricCard _idleSleepCard = new();

    private readonly TsGlassPanel _distributionPanel = new();
    private readonly PanelTitle _distributionTitle = new();
    private readonly Border _distributionBarHost = new() { Height = 32, CornerRadius = new CornerRadius(16), Margin = new Thickness(0, 12, 0, 12) };
    private readonly Grid _distributionBar = new();
    private readonly StackPanel _legendRow = new() { Orientation = Orientation.Horizontal, Spacing = 16 };
    private readonly TsChartSkeleton _distributionSkeleton = new();
    private readonly TsEmptyState _distributionEmpty = new() { IconGlyph = "\uE823" };

    private readonly TsGlassPanel _dailyPanel = new();
    private readonly PanelTitle _dailyTitle = new();
    private readonly TsBarChart _dailyChart = new() { Height = 260, ShowLegend = true };
    private readonly TsChartSkeleton _dailySkeleton = new();
    private readonly TsEmptyState _dailyEmpty = new() { IconGlyph = "\uE9D2" };

    private readonly TsGlassPanel _transitionsPanel = new();
    private readonly PanelTitle _transitionsTitle = new();
    private readonly Grid _tableHeader = new() { Margin = new Thickness(0, 8, 0, 4) };
    private readonly StackPanel _tableRows = new() { Spacing = 0 };
    private readonly TsEmptyState _transitionsEmpty = new() { IconGlyph = "\uE823" };

    private readonly Caption _timeHeader = new();
    private readonly Caption _fromHeader = new();
    private readonly Caption _toHeader = new();
    private readonly Caption _durationHeader = new();
    private readonly Caption _triggerHeader = new();

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public TimelinePage()
        : this(EmptyTimelineFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / timeline / summary data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TimelinePage(ITimelineFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TimelinePageViewModel(feed, localizer);

        BuildContent();
        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _rangeSelect.SelectionChanged += OnRangeChanged;
        _refreshButton.Click += OnRefreshClick;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TimelinePage</c>).</summary>
    public static string Slug => TimelineRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_content);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        _vehicleSelect.DisplayMemberPath = nameof(TimelineVehicleOption.Label);
        _vehicleSelect.SelectedValuePath = nameof(TimelineVehicleOption.Value);
        _rangeSelect.DisplayMemberPath = nameof(TimelineRangeOption.Label);
        _rangeSelect.SelectedValuePath = nameof(TimelineRangeOption.Days);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_vehicleSelect);
        actions.Children.Add(_rangeSelect);
        actions.Children.Add(_refreshButton);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(heading);
        grid.Children.Add(actions);
        return grid;
    }

    private void BuildContent()
    {
        _content.Children.Add(BuildMetricsGrid());
        _content.Children.Add(BuildDistributionPanel());
        _content.Children.Add(BuildDailyPanel());
        _content.Children.Add(BuildTransitionsPanel());
    }

    private Grid BuildMetricsGrid()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        var cards = new[] { _totalTransitionsCard, _drivingCard, _chargingCard, _idleSleepCard };
        for (var i = 0; i < cards.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private TsGlassPanel BuildDistributionPanel()
    {
        _distributionBar.HorizontalAlignment = HorizontalAlignment.Stretch;
        _distributionBarHost.Child = _distributionBar;

        var body = new StackPanel { Spacing = 0, Padding = new Thickness(16) };
        body.Children.Add(_distributionTitle);
        body.Children.Add(_distributionBarHost);
        body.Children.Add(_legendRow);
        body.Children.Add(_distributionSkeleton);
        body.Children.Add(_distributionEmpty);

        _distributionPanel.Content = body;
        return _distributionPanel;
    }

    private TsGlassPanel BuildDailyPanel()
    {
        AutomationProperties.SetName(_dailyChart, "Daily Breakdown");

        var body = new StackPanel { Spacing = 12, Padding = new Thickness(16) };
        body.Children.Add(_dailyTitle);
        body.Children.Add(_dailyChart);
        body.Children.Add(_dailySkeleton);
        body.Children.Add(_dailyEmpty);

        _dailyPanel.Content = body;
        return _dailyPanel;
    }

    private TsGlassPanel BuildTransitionsPanel()
    {
        BuildTableHeader();

        var body = new StackPanel { Spacing = 4, Padding = new Thickness(16) };
        body.Children.Add(_transitionsTitle);
        body.Children.Add(_tableHeader);
        body.Children.Add(_tableRows);
        body.Children.Add(_transitionsEmpty);

        _transitionsPanel.Content = body;
        return _transitionsPanel;
    }

    private void BuildTableHeader()
    {
        ApplyTableColumns(_tableHeader);
        var cells = new[] { _timeHeader, _fromHeader, _toHeader, _durationHeader, _triggerHeader };
        for (var i = 0; i < cells.Length; i++)
        {
            Grid.SetColumn(cells[i], i);
            _tableHeader.Children.Add(cells[i]);
        }
    }

    private static void ApplyTableColumns(Grid grid)
    {
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Clear();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) });
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

    private void Render(TimelineDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Actions row.
        _vehicleSelect.Hint = display.SelectVehicleHint;
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedValue = display.SelectedVehicleValue;
        _vehicleSelect.Visibility = Show(display.VehicleOptions.Count > 0);
        _rangeSelect.ItemsSource = display.RangeOptions;
        _rangeSelect.SelectedValue = display.SelectedDays;
        AutomationProperties.SetName(_rangeSelect, display.RangeLabel);
        _refreshButton.Text = display.RefreshLabel;
        AutomationProperties.SetName(_refreshButton, display.RefreshLabel);

        // Failure banner (web anyError) — shown above the panels.
        _errorBanner.IsOpen = display.ShowError;
        _errorBanner.Visibility = Show(display.ShowError);
        _errorBanner.Message = display.ErrorBannerText;

        // Full-page loading scaffold vs the panels.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _content.Visibility = Show(display.ShowContent);

        // Summary metric cards.
        ApplyMetric(_totalTransitionsCard, display.Metrics[0]);
        ApplyMetric(_drivingCard, display.Metrics[1]);
        ApplyMetric(_chargingCard, display.Metrics[2]);
        ApplyMetric(_idleSleepCard, display.Metrics[3]);

        // State distribution panel.
        _distributionTitle.Value = display.DistributionTitle;
        var showBar = display.DistributionMode == TimelinePanelMode.Content;
        _distributionBarHost.Visibility = Show(showBar);
        _legendRow.Visibility = Show(showBar);
        _distributionSkeleton.Visibility = Show(display.DistributionMode == TimelinePanelMode.Loading);
        _distributionEmpty.Visibility = Show(display.DistributionMode == TimelinePanelMode.Empty);
        _distributionEmpty.Message = display.DistributionEmptyText;
        AutomationProperties.SetName(_distributionPanel, display.DistributionTitle);
        if (showBar)
        {
            RebuildDistribution(display);
        }

        // Daily breakdown chart.
        _dailyTitle.Value = display.DailyTitle;
        var showChart = display.DailyMode == TimelinePanelMode.Content;
        _dailyChart.Visibility = Show(showChart);
        _dailySkeleton.Visibility = Show(display.DailyMode == TimelinePanelMode.Loading);
        _dailyEmpty.Visibility = Show(display.DailyMode == TimelinePanelMode.Empty);
        _dailyEmpty.Message = display.DailyEmptyText;
        if (showChart)
        {
            _dailyChart.Series = BuildSeries(display);
        }

        // Transitions table.
        _transitionsTitle.Value = display.TransitionsTitle;
        _timeHeader.Value = display.TimeHeader;
        _fromHeader.Value = display.FromStateHeader;
        _toHeader.Value = display.ToStateHeader;
        _durationHeader.Value = display.DurationHeader;
        _triggerHeader.Value = display.TriggerHeader;
        _tableHeader.Visibility = Show(display.ShowTransitions);
        _tableRows.Visibility = Show(display.ShowTransitions);
        _transitionsEmpty.Visibility = Show(!display.ShowTransitions);
        _transitionsEmpty.Message = display.NoTransitionsText;
        AutomationProperties.SetName(_transitionsPanel, display.TransitionsTitle);
        RebuildRows(display);

        _suppressEvents = false;
    }

    private static void ApplyMetric(TsMetricCard card, TimelineMetric metric)
    {
        card.Label = metric.Label;
        card.Value = metric.Value;
        card.AccentBrushKey = metric.AccentBrushKey;
    }

    private void RebuildDistribution(TimelineDisplay display)
    {
        _distributionBar.ColumnDefinitions.Clear();
        _distributionBar.Children.Clear();
        for (var i = 0; i < display.DistributionSegments.Count; i++)
        {
            var segment = display.DistributionSegments[i];
            _distributionBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(segment.WidthStar, GridUnitType.Star) });
            var fill = new Border { Background = Brush(segment.BrushKey) };
            ToolTipService.SetToolTip(fill, segment.AutomationName);
            AutomationProperties.SetName(fill, segment.AutomationName);
            Grid.SetColumn(fill, i);
            _distributionBar.Children.Add(fill);
        }

        _legendRow.Children.Clear();
        foreach (var item in display.Legend)
        {
            var swatch = new Ellipse { Width = 10, Height = 10, Fill = Brush(item.BrushKey), VerticalAlignment = VerticalAlignment.Center };
            var label = new Caption { Value = item.Label, VerticalAlignment = VerticalAlignment.Center };
            var entry = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            entry.Children.Add(swatch);
            entry.Children.Add(label);
            _legendRow.Children.Add(entry);
        }
    }

    private static IReadOnlyList<ChartSeries> BuildSeries(TimelineDisplay display)
    {
        var bars = display.DailyBars;
        var driving = new ChartPoint[bars.Count];
        var charging = new ChartPoint[bars.Count];
        var idle = new ChartPoint[bars.Count];
        var sleeping = new ChartPoint[bars.Count];
        for (var i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];
            driving[i] = new ChartPoint(i, bar.Driving, bar.Day);
            charging[i] = new ChartPoint(i, bar.Charging, bar.Day);
            idle[i] = new ChartPoint(i, bar.Idle, bar.Day);
            sleeping[i] = new ChartPoint(i, bar.Sleeping, bar.Day);
        }

        return
        [
            new ChartSeries(display.DrivingSeriesName, driving) { Kind = ChartSeriesKind.Bar, ColorIndex = 0 },
            new ChartSeries(display.ChargingSeriesName, charging) { Kind = ChartSeriesKind.Bar, ColorIndex = 1 },
            new ChartSeries(display.IdleSeriesName, idle) { Kind = ChartSeriesKind.Bar, ColorIndex = 2 },
            new ChartSeries(display.SleepingSeriesName, sleeping) { Kind = ChartSeriesKind.Bar, ColorIndex = 3 },
        ];
    }

    private void RebuildRows(TimelineDisplay display)
    {
        _tableRows.Children.Clear();
        if (!display.ShowTransitions)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _tableRows.Children.Add(BuildRow(row));
        }
    }

    private static Grid BuildRow(TimelineTableRow row)
    {
        var grid = new Grid { Padding = new Thickness(0, 8, 0, 8) };
        ApplyTableColumns(grid);

        var time = new Text { Value = row.Time, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(time, 0);
        grid.Children.Add(time);

        var from = StateChip(row.FromState, row.FromStatus);
        Grid.SetColumn(from, 1);
        grid.Children.Add(from);

        var to = StateChip(row.ToState, row.ToStatus);
        Grid.SetColumn(to, 2);
        grid.Children.Add(to);

        var duration = new Text { Value = row.Duration, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(duration, 3);
        grid.Children.Add(duration);

        var trigger = new Caption { Value = row.Trigger, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(trigger, 4);
        grid.Children.Add(trigger);

        AutomationProperties.SetName(grid, $"{row.Time}: {row.FromState} \u2192 {row.ToState}");
        return grid;
    }

    private static TsBadge StateChip(string state, StatusKind status) => new()
    {
        Status = status,
        Content = state,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _vehicleSelect.SelectedValue is not string value)
        {
            return;
        }

        if (long.TryParse(value, out var id) && id != _viewModel.SelectedVehicleId)
        {
            InvokeAsync(() => _viewModel.SelectVehicleAsync(id));
        }
    }

    private void OnRangeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _rangeSelect.SelectedValue is not int days)
        {
            return;
        }

        if (days != _viewModel.Days)
        {
            InvokeAsync(() => _viewModel.SetDaysAsync(days));
        }
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
