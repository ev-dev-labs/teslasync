using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>PeriodComparePage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/PeriodComparePage.tsx</c> (route <c>/period-compare</c>, nav name
/// <c>PeriodCompare</c>). It binds to a <see cref="PeriodComparePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header, the disambiguation banner that points multi-vehicle accounts
/// at the fleet-comparison page, the failure banner (web <c>error</c>), the selectors panel (vehicle + the two
/// periods), the loading skeleton, the page-level empty state, the six comparison metric cards, the side-by-side bar
/// chart, the comparison table (with a percentage-change badge per row) and the insights list. The view is a thin
/// renderer: all branch selection, formatting, unit conversion and i18n happen in the view-model's
/// <see cref="PeriodCompareDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class PeriodComparePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 16;

    private readonly PeriodComparePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _disambiguationBanner = new() { Variant = CalloutVariant.Info, IsOpen = false, Dismissible = true };
    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };

    private readonly TsGlassPanel _selectorsPanel = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsSelect _periodASelect = new() { MinWidth = 176 };
    private readonly TsSelect _periodBSelect = new() { MinWidth = 176 };

    private readonly TsPageLoadSkeleton _loadingSkeleton = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE787" };

    private readonly StackPanel _content = new() { Spacing = SectionSpacing };

    private readonly MetricTile _distanceTile = new();
    private readonly MetricTile _drivesTile = new();
    private readonly MetricTile _energyTile = new();
    private readonly MetricTile _efficiencyTile = new();
    private readonly MetricTile _costTile = new();
    private readonly MetricTile _co2Tile = new();

    private readonly TsChartContainer _chartContainer = new();
    private readonly TsBarChart _chart = new() { Height = 320, ShowLegend = true, IncludeZero = true };

    private readonly TsGlassPanel _tablePanel = new();
    private readonly PanelTitle _tableTitle = new();
    private readonly Grid _tableHeader = new() { Margin = new Thickness(0, 8, 0, 4) };
    private readonly StackPanel _tableRows = new() { Spacing = 0 };
    private readonly Caption _metricHeader = new();
    private readonly Caption _periodAHeader = new();
    private readonly Caption _periodBHeader = new();
    private readonly Caption _changeHeader = new();
    private readonly Caption _pctChangeHeader = new();

    private readonly TsGlassPanel _insightsPanel = new();
    private readonly PanelTitle _insightsTitle = new();
    private readonly StackPanel _insightsList = new() { Spacing = 6 };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public PeriodComparePage()
        : this(EmptyPeriodCompareFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / period-stats data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public PeriodComparePage(IPeriodCompareFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new PeriodComparePageViewModel(feed, localizer);

        BuildContent();
        Content = BuildLayout();

        _disambiguationBanner.ActionInvoked += OnFleetComparisonRequested;
        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _periodASelect.SelectionChanged += OnPeriodAChanged;
        _periodBSelect.SelectionChanged += OnPeriodBChanged;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the disambiguation banner's "Open Fleet comparison" affordance is invoked.</summary>
    public event EventHandler? FleetComparisonRequested;

    /// <summary>The diagnostics surface slug (<c>PeriodComparePage</c>).</summary>
    public static string Slug => PeriodCompareRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_disambiguationBanner);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(BuildSelectorsPanel());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_content);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        return heading;
    }

    private TsGlassPanel BuildSelectorsPanel()
    {
        _vehicleSelect.DisplayMemberPath = nameof(PeriodCompareVehicleOption.Label);
        _vehicleSelect.SelectedValuePath = nameof(PeriodCompareVehicleOption.Value);
        _periodASelect.DisplayMemberPath = nameof(PeriodCompareOption.Label);
        _periodASelect.SelectedValuePath = nameof(PeriodCompareOption.Days);
        _periodBSelect.DisplayMemberPath = nameof(PeriodCompareOption.Label);
        _periodBSelect.SelectedValuePath = nameof(PeriodCompareOption.Days);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
        };
        row.Children.Add(_vehicleSelect);
        row.Children.Add(_periodASelect);
        row.Children.Add(_periodBSelect);

        _selectorsPanel.Padding = new Thickness(PanelPadding);
        _selectorsPanel.Content = row;
        return _selectorsPanel;
    }

    private void BuildContent()
    {
        _content.Children.Add(BuildMetricsGrid());
        _content.Children.Add(BuildChartPanel());
        _content.Children.Add(BuildTablePanel());
        _content.Children.Add(BuildInsightsPanel());
    }

    private Grid BuildMetricsGrid()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (var c = 0; c < 3; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (var r = 0; r < 2; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        var tiles = new[] { _distanceTile, _drivesTile, _energyTile, _efficiencyTile, _costTile, _co2Tile };
        for (var i = 0; i < tiles.Length; i++)
        {
            var root = tiles[i].Root;
            root.HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(root, i % 3);
            Grid.SetRow(root, i / 3);
            grid.Children.Add(root);
        }

        return grid;
    }

    private TsChartContainer BuildChartPanel()
    {
        _chartContainer.Body = _chart;
        _chartContainer.State = ChartState.Ready;
        return _chartContainer;
    }

    private TsGlassPanel BuildTablePanel()
    {
        BuildTableHeader();

        var body = new StackPanel { Spacing = 4, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_tableTitle);
        body.Children.Add(_tableHeader);
        body.Children.Add(_tableRows);

        _tablePanel.Content = body;
        return _tablePanel;
    }

    private void BuildTableHeader()
    {
        ApplyTableColumns(_tableHeader);
        _periodAHeader.HorizontalAlignment = HorizontalAlignment.Right;
        _periodBHeader.HorizontalAlignment = HorizontalAlignment.Right;
        var cells = new FrameworkElement[] { _metricHeader, _periodAHeader, _periodBHeader, _changeHeader, _pctChangeHeader };
        for (var i = 0; i < cells.Length; i++)
        {
            Grid.SetColumn(cells[i], i);
            _tableHeader.Children.Add(cells[i]);
        }
    }

    private TsGlassPanel BuildInsightsPanel()
    {
        var body = new StackPanel { Spacing = 8, Padding = new Thickness(PanelPadding) };
        body.Children.Add(_insightsTitle);
        body.Children.Add(_insightsList);

        _insightsPanel.Content = body;
        return _insightsPanel;
    }

    private static void ApplyTableColumns(Grid grid)
    {
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Clear();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.6, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
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
        _disambiguationBanner.ActionInvoked -= OnFleetComparisonRequested;
        _vehicleSelect.SelectionChanged -= OnVehicleChanged;
        _periodASelect.SelectionChanged -= OnPeriodAChanged;
        _periodBSelect.SelectionChanged -= OnPeriodBChanged;
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

    private void OnFleetComparisonRequested(object? sender, EventArgs e) =>
        FleetComparisonRequested?.Invoke(this, EventArgs.Empty);

    private void Render(PeriodCompareDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Disambiguation banner (web compare.banner.*).
        _disambiguationBanner.Message = display.BannerPrefix;
        _disambiguationBanner.ActionText = display.BannerCta;
        _disambiguationBanner.IsOpen = display.ShowBanner;
        _disambiguationBanner.Visibility = Show(display.ShowBanner);

        // Failure banner (web error) — shown above the panels.
        _errorBanner.IsOpen = display.ShowError;
        _errorBanner.Visibility = Show(display.ShowError);
        _errorBanner.Message = display.ErrorBannerText;

        // Selectors panel (always visible).
        _vehicleSelect.Header = display.VehicleLabel;
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedValue = display.SelectedVehicleValue;
        AutomationProperties.SetName(_vehicleSelect, display.VehicleLabel);
        _periodASelect.Header = display.PeriodALabel;
        _periodASelect.ItemsSource = display.PeriodOptions;
        _periodASelect.SelectedValue = display.SelectedPeriodADays;
        AutomationProperties.SetName(_periodASelect, display.PeriodALabel);
        _periodBSelect.Header = display.PeriodBLabel;
        _periodBSelect.ItemsSource = display.PeriodOptions;
        _periodBSelect.SelectedValue = display.SelectedPeriodBDays;
        AutomationProperties.SetName(_periodBSelect, display.PeriodBLabel);

        // State scaffolds.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _emptyState.Message = display.EmptyMessage;
        _emptyState.Visibility = Show(display.ShowEmpty);
        _content.Visibility = Show(display.ShowContent);

        if (display.ShowContent)
        {
            RenderContent(display);
        }

        _suppressEvents = false;
    }

    private void RenderContent(PeriodCompareDisplay display)
    {
        // Metric cards.
        _distanceTile.Apply(display.Metrics[0]);
        _drivesTile.Apply(display.Metrics[1]);
        _energyTile.Apply(display.Metrics[2]);
        _efficiencyTile.Apply(display.Metrics[3]);
        _costTile.Apply(display.Metrics[4]);
        _co2Tile.Apply(display.Metrics[5]);

        // Side-by-side bar chart.
        _chartContainer.Title = display.ChartTitle;
        _chartContainer.AccessibleSummary = BuildChartSummary(display);
        _chart.Series = BuildSeries(display);

        // Comparison table.
        _tableTitle.Value = display.TableTitle;
        _metricHeader.Value = display.MetricHeader;
        _periodAHeader.Value = display.PeriodAHeader;
        _periodBHeader.Value = display.PeriodBHeader;
        _changeHeader.Value = display.ChangeHeader;
        _pctChangeHeader.Value = display.PctChangeHeader;
        AutomationProperties.SetName(_tablePanel, display.TableTitle);
        RebuildRows(display);

        // Insights.
        _insightsTitle.Value = display.InsightsTitle;
        AutomationProperties.SetName(_insightsPanel, display.InsightsTitle);
        RebuildInsights(display);
    }

    private static IReadOnlyList<ChartSeries> BuildSeries(PeriodCompareDisplay display)
    {
        var metrics = display.Metrics;
        var seriesA = new ChartPoint[metrics.Count];
        var seriesB = new ChartPoint[metrics.Count];
        for (var i = 0; i < metrics.Count; i++)
        {
            seriesA[i] = new ChartPoint(i, metrics[i].ChartA, metrics[i].Label);
            seriesB[i] = new ChartPoint(i, metrics[i].ChartB, metrics[i].Label);
        }

        return
        [
            new ChartSeries(display.ChartSeriesAName, seriesA) { Kind = ChartSeriesKind.Bar, ColorIndex = 0 },
            new ChartSeries(display.ChartSeriesBName, seriesB) { Kind = ChartSeriesKind.Bar, ColorIndex = 1 },
        ];
    }

    private static string BuildChartSummary(PeriodCompareDisplay display) =>
        $"{display.ChartTitle}. {display.ChartSeriesAName} vs {display.ChartSeriesBName} across {display.ChartCategories.Count} metrics.";

    private void RebuildRows(PeriodCompareDisplay display)
    {
        _tableRows.Children.Clear();
        foreach (var row in display.Rows)
        {
            _tableRows.Children.Add(BuildRow(row));
        }
    }

    private static Grid BuildRow(PeriodCompareTableRow row)
    {
        var grid = new Grid { Padding = new Thickness(0, 8, 0, 8) };
        ApplyTableColumns(grid);

        var metric = new Text { Value = row.Metric, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(metric, 0);
        grid.Children.Add(metric);

        var periodA = new Text { Value = row.PeriodA, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(periodA, 1);
        grid.Children.Add(periodA);

        var periodB = new Text { Value = row.PeriodB, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(periodB, 2);
        grid.Children.Add(periodB);

        var change = new Text { Value = row.ChangeText, VerticalAlignment = VerticalAlignment.Center };
        var changeBrush = Brush(row.ChangePositive ? "TsColorSuccessBrush" : "TsColorDangerBrush");
        if (changeBrush is not null)
        {
            change.Foreground = changeBrush;
        }

        Grid.SetColumn(change, 3);
        grid.Children.Add(change);

        var pct = new TsBadge { Status = row.PctStatus, Content = row.PctChange, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(pct, 4);
        grid.Children.Add(pct);

        AutomationProperties.SetName(grid, $"{row.Metric}: {row.PeriodA} vs {row.PeriodB}, {row.PctChange}");
        return grid;
    }

    private void RebuildInsights(PeriodCompareDisplay display)
    {
        _insightsList.Children.Clear();
        foreach (var line in display.Insights)
        {
            _insightsList.Children.Add(new Text { Value = $"\u2022 {line}" });
        }
    }

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

    private void OnPeriodAChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _periodASelect.SelectedValue is not int days)
        {
            return;
        }

        if (days != _viewModel.PeriodADays)
        {
            InvokeAsync(() => _viewModel.SetPeriodADaysAsync(days));
        }
    }

    private void OnPeriodBChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _periodBSelect.SelectedValue is not int days)
        {
            return;
        }

        if (days != _viewModel.PeriodBDays)
        {
            InvokeAsync(() => _viewModel.SetPeriodBDaysAsync(days));
        }
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    /// <summary>
    /// A single comparison metric tile — a tokenized glass panel with an accent glyph, label, the Period A value, the
    /// Period B sub-line and the percentage-change caption (mirrors the web <c>MetricCard</c>).
    /// </summary>
    private sealed class MetricTile
    {
        private readonly FontIcon _icon = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
        private readonly Caption _label = new();
        private readonly MetricValue _value = new();
        private readonly Caption _subtitle = new();
        private readonly Caption _delta = new();

        public MetricTile()
        {
            var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            header.Children.Add(_icon);
            header.Children.Add(_label);

            var column = new StackPanel { Spacing = 6 };
            column.Children.Add(header);
            column.Children.Add(_value);
            column.Children.Add(_subtitle);
            column.Children.Add(_delta);

            Root = new TsGlassPanel { Padding = new Thickness(20), Content = column };
        }

        public TsGlassPanel Root { get; }

        public void Apply(PeriodCompareMetric metric)
        {
            _icon.Glyph = metric.Glyph;
            var accent = Brush(metric.AccentBrushKey);
            if (accent is not null)
            {
                _icon.Foreground = accent;
            }

            Root.Glow = GlowFor(metric.AccentBrushKey);

            _label.Value = metric.Label;
            _value.Value = metric.ValueText;
            _subtitle.Value = metric.SubtitleText;

            _delta.Value = metric.DeltaText;
            var deltaBrush = Brush(metric.DeltaPositive ? "TsColorSuccessBrush" : "TsColorDangerBrush");
            if (deltaBrush is not null)
            {
                _delta.Foreground = deltaBrush;
            }

            AutomationProperties.SetName(Root, $"{metric.Label}: {metric.ValueText}, {metric.SubtitleText}, {metric.DeltaText}");
        }

        private static GlassGlow GlowFor(string accentBrushKey) => accentBrushKey switch
        {
            "TsColorInfoBrush" => GlassGlow.Cyan,
            "TsColorSuccessBrush" => GlassGlow.Green,
            "TsColorAccentBrush" => GlassGlow.Purple,
            _ => GlassGlow.None,
        };
    }
}
