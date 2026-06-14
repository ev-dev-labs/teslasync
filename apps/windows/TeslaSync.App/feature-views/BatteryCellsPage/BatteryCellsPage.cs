using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>BatteryCellsPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/BatteryCellsPage.tsx</c> (route <c>/battery-cells</c>, nav name
/// <c>BatteryCells</c>). It binds to a <see cref="BatteryCellsPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the
/// loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the six summary metric cards, the cell-voltage heatmap with its bar/grid toggle, the cell-voltage bar
/// chart, the voltage-distribution histogram and imbalance-trend line chart, the cell-voltage-over-time line
/// chart, the cell-details table, the voltage-spread-trend area chart, the temperature summary, the health
/// recommendations and the bottom summary-stat row. The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="BatteryCellsDisplay"/> projection. State changes
/// are marshalled onto the UI thread.
/// </summary>
public sealed partial class BatteryCellsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly BatteryCellsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _showHeatmap = true;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = BatteryCellsRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public BatteryCellsPage()
        : this(EmptyBatteryCellsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source battery-cells data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public BatteryCellsPage(IBatteryCellsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new BatteryCellsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>BatteryCellsPage</c>).</summary>
    public static string Slug => BatteryCellsRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_emptyState);
        stack.Children.Add(_contentHost);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        _freshness.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(ColumnsGrid(6, 16, BuildSkeletonBlocks(6, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
        _loadingSkeleton.Children.Add(ColumnsGrid(2, 24, BuildSkeletonBlocks(2, 240)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void Render(BatteryCellsDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private StackPanel BuildContent(BatteryCellsDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildSummary(display.SummaryMetrics) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildHeatmap(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = ChartPanel(display.BarChart) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildDistributionAndImbalance(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = ChartPanel(display.OverTime) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildTable(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildSpreadTrend(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 350, Content = BuildTemperature(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 400, Content = BuildRecommendations(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 450, Content = BuildSummaryStats(display.SummaryStats) });
        return stack;
    }

    // ── Summary metrics (Total Cells / Avg Voltage / Min Cell / Max Cell / Imbalance / Pack Voltage) ──────
    private static Grid BuildSummary(IReadOnlyList<CellMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard { Label = metric.Label, Value = metric.Value, AccentBrushKey = metric.AccentBrushKey };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return ColumnsGrid(6, 16, cards);
    }

    // ── Cell Voltage Heatmap (with the bar/grid toggle) ──────────────────────────────────────────────────
    private TsGlassPanel BuildHeatmap(BatteryCellsDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new Subhead { Value = display.HeatmapTitle, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(heading, 0);
        header.Children.Add(heading);

        var toggle = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _showHeatmap ? display.HeatmapToBarLabel : display.HeatmapToGridLabel,
            IconGlyph = _showHeatmap ? BatteryCellsProjection.BarChartGlyph : BatteryCellsProjection.GridGlyph,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(toggle, 1);
        header.Children.Add(toggle);
        column.Children.Add(header);

        if (display.HasCells)
        {
            column.Children.Add(new Caption { Value = display.HeatmapCaption });

            var tiles = BuildHeatmapGrid(display.CellTiles);
            tiles.Visibility = Show(_showHeatmap);
            column.Children.Add(tiles);

            var legend = BuildHeatmapLegend(display);
            column.Children.Add(legend);

            toggle.Click += (_, _) =>
            {
                _showHeatmap = !_showHeatmap;
                toggle.Text = _showHeatmap ? display.HeatmapToBarLabel : display.HeatmapToGridLabel;
                toggle.IconGlyph = _showHeatmap ? BatteryCellsProjection.BarChartGlyph : BatteryCellsProjection.GridGlyph;
                tiles.Visibility = Show(_showHeatmap);
                legend.Visibility = Show(_showHeatmap);
            };
        }
        else
        {
            toggle.IsEnabled = false;
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryCellsProjection.GridGlyph,
                Message = display.HeatmapEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Grid BuildHeatmapGrid(IReadOnlyList<CellTileDisplay> tiles)
    {
        int columns = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(tiles.Count)));
        var grid = new Grid { ColumnSpacing = 4, RowSpacing = 4 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(tiles.Count / (double)columns);
        for (int rIdx = 0; rIdx < Math.Max(1, rows); rIdx++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var tile = BuildHeatmapTile(tiles[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static Border BuildHeatmapTile(CellTileDisplay tile)
    {
        Brush accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(tile.Deviation));
        var content = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, Spacing = 1 };
        content.Children.Add(new TextBlock
        {
            Text = tile.Id,
            FontSize = 10,
            FontWeight = FontWeights.SemiBold,
            FontFamily = MonoFont,
            Foreground = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        content.Children.Add(new TextBlock
        {
            Text = tile.VoltageText,
            FontSize = 9,
            FontFamily = MonoFont,
            Foreground = accent,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var border = new Border
        {
            Padding = new Thickness(4),
            CornerRadius = new CornerRadius(6),
            Background = Fade(accent, 0.15),
            Child = content,
        };
        AutomationProperties.SetName(border, tile.AutomationName);
        ToolTipService.SetToolTip(border, tile.AutomationName);
        return border;
    }

    private static StackPanel BuildHeatmapLegend(BatteryCellsDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        legend.Children.Add(LegendItem(StatusKind.Success, display.NominalLabel));
        legend.Children.Add(LegendItem(StatusKind.Warning, display.SlightLabel));
        legend.Children.Add(LegendItem(StatusKind.Danger, display.SignificantLabel));
        return legend;
    }

    private static StackPanel LegendItem(StatusKind status, string label)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new Ellipse
        {
            Width = 10,
            Height = 10,
            Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    // ── Voltage Distribution + Imbalance Trend (two columns) ──────────────────────────────────────────────
    private static Grid BuildDistributionAndImbalance(BatteryCellsDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var distribution = ChartPanel(display.Distribution);
        Grid.SetColumn(distribution, 0);
        grid.Children.Add(distribution);

        var imbalance = ChartPanel(display.ImbalanceTrend);
        Grid.SetColumn(imbalance, 1);
        grid.Children.Add(imbalance);

        return grid;
    }

    // ── Voltage Spread Trend (chart container + area chart) ───────────────────────────────────────────────
    private static TsChartContainer BuildSpreadTrend(BatteryCellsDisplay display)
    {
        var chart = display.SpreadTrend;
        TsAreaChart? body = chart.HasData ? NewAreaChart(chart) : null;

        return new TsChartContainer
        {
            Title = chart.Title,
            AccessibleSummary = display.SpreadTrendAria,
            State = chart.HasData ? ChartState.Ready : ChartState.Empty,
            Body = body,
            EmptyMessage = chart.EmptyMessage,
        };
    }

    private static TsAreaChart NewAreaChart(CellChartDisplay chart)
    {
        var area = new TsAreaChart
        {
            Title = chart.Title,
            Series = chart.Series,
            Annotations = chart.Annotations,
            ShowLegend = false,
            IncludeZero = false,
            MinHeight = 240,
        };
        AutomationProperties.SetName(area, chart.Title);
        return area;
    }

    // ── Cell Details table ───────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTable(BatteryCellsDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new Subhead { Value = display.TableTitle, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(heading, 0);
        header.Children.Add(heading);

        var countBadge = new TsBadge
        {
            Status = StatusKind.Neutral,
            Content = new TextBlock { Text = display.CountBadgeText },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(countBadge, display.CountBadgeText);
        Grid.SetColumn(countBadge, 1);
        header.Children.Add(countBadge);
        column.Children.Add(header);

        if (display.Rows.Count > 0)
        {
            var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
            table.Columns =
            [
                new TsDataColumn { Key = "cell", Header = display.CellColumnHeader, IsNumeric = true },
                new TsDataColumn { Key = "voltage", Header = display.VoltageColumnHeader, IsNumeric = true },
                new TsDataColumn { Key = "delta", Header = display.DeltaColumnHeader, IsNumeric = true },
                new TsDataColumn { Key = "status", Header = display.StatusColumnHeader, IsNumeric = false },
            ];

            var rows = new List<TsDataRow>(display.Rows.Count);
            foreach (var row in display.Rows)
            {
                rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["cell"] = row.CellLabel,
                    ["voltage"] = row.VoltageText,
                    ["delta"] = row.DeltaText,
                    ["status"] = row.StatusText,
                }));
            }

            table.Rows = rows;
            AutomationProperties.SetName(table, display.TableTitle);
            column.Children.Add(table);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryCellsProjection.BatteryGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Temperature Summary ──────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTemperature(BatteryCellsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryCellsProjection.ThermometerGlyph, display.TempTitle));

        if (display.HasTemperature)
        {
            column.Children.Add(ColumnsGrid(4, 16, BuildMetricCards(display.TemperatureMetrics)));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryCellsProjection.ThermometerGlyph,
                Message = display.TempEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Health Recommendations ───────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecommendations(BatteryCellsDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryCellsProjection.ShieldGlyph, display.RecommendationsTitle));

        if (display.Insights.Count > 0)
        {
            var cards = new List<FrameworkElement>(display.Insights.Count);
            foreach (var insight in display.Insights)
            {
                cards.Add(BuildInsightCard(insight));
            }

            column.Children.Add(ColumnsGrid(2, 12, cards));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryCellsProjection.InfoGlyph,
                Message = display.NoInsightsMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildInsightCard(CellInsightDisplay insight)
    {
        Brush accent = DisplayTokens.Brush(StatusResources.AccentBrushKey(insight.Status));
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = insight.Glyph,
            FontSize = 18,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
        });

        var text = new StackPanel { Spacing = 2 };
        text.Children.Add(new TextBlock
        {
            Text = insight.Title,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        text.Children.Add(new Caption { Value = insight.Description });
        row.Children.Add(text);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = row };
        AutomationProperties.SetName(panel, $"{insight.Title}. {insight.Description}");
        return panel;
    }

    // ── Bottom summary-stat row (six centered panels) ────────────────────────────────────────────────────
    private static Grid BuildSummaryStats(IReadOnlyList<CellSummaryStatDisplay> stats)
    {
        var cards = new List<FrameworkElement>(stats.Count);
        foreach (var stat in stats)
        {
            var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(new Caption
            {
                Value = stat.Label,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            column.Children.Add(new TextBlock
            {
                Text = stat.Value,
                FontSize = 22,
                FontWeight = FontWeights.Bold,
                Foreground = DisplayTokens.Brush(stat.AccentBrushKey),
                HorizontalAlignment = HorizontalAlignment.Center,
            });

            var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
            AutomationProperties.SetName(panel, stat.AutomationName);
            cards.Add(panel);
        }

        return ColumnsGrid(6, 12, cards);
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel ChartPanel(CellChartDisplay chart)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new Subhead { Value = chart.Title });

        if (chart.HasData)
        {
            var body = NewChart(chart.Series[0].Kind);
            body.Series = chart.Series;
            body.Annotations = chart.Annotations;
            body.ShowLegend = chart.Series.Count > 1;
            body.IncludeZero = false;
            body.MinHeight = 260;
            AutomationProperties.SetName(body, chart.Title);
            column.Children.Add(body);

            if (!string.IsNullOrEmpty(chart.AxisLabel))
            {
                column.Children.Add(new Caption
                {
                    Value = chart.AxisLabel,
                    HorizontalAlignment = HorizontalAlignment.Center,
                });
            }
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryCellsProjection.ActivityGlyph,
                Message = chart.EmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsCartesianChart NewChart(ChartSeriesKind kind) => kind switch
    {
        ChartSeriesKind.Bar => new TsBarChart(),
        ChartSeriesKind.Area => new TsAreaChart(),
        _ => new TsLineChart(),
    };

    private static List<FrameworkElement> BuildMetricCards(IReadOnlyList<CellMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard { Label = metric.Label, Value = metric.Value, AccentBrushKey = metric.AccentBrushKey };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return cards;
    }

    private static StackPanel TitleRow(string glyph, string title)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new SectionTitle { Value = title });
        return row;
    }

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < Math.Max(1, rows); r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % cols);
            Grid.SetRow(child, i / cols);
            grid.Children.Add(child);
        }

        return grid;
    }

    private static Brush Fade(Brush brush, double opacity)
    {
        if (brush is SolidColorBrush solid)
        {
            return new SolidColorBrush(solid.Color) { Opacity = opacity };
        }

        return brush;
    }

    private static FontFamily MonoFont { get; } = new("Consolas");

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new BatteryCellsPageAutomationPeer(this);

    private sealed class BatteryCellsPageAutomationPeer(BatteryCellsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
