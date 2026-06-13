using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>EfficiencyPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/EfficiencyPage.tsx</c> (route <c>/efficiency</c>, nav name
/// <c>Efficiency</c>). It binds to an <see cref="EfficiencyPageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the hero
/// efficiency gauge with its three readouts, the four stat cards, the Daily-Efficiency area chart beside the
/// Efficiency-by-Speed-Range bar chart, the Speed-vs-Efficiency and Temperature-vs-Efficiency scatter clouds,
/// the temperature-bucketed efficiency table, the four summary metric bars and the six energy-insight readouts.
/// The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="EfficiencyDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class EfficiencyPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const string ThermometerGlyph = "\uE9CA";

    private readonly EfficiencyPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EfficiencyRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public EfficiencyPage()
        : this(EmptyEfficiencyFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source driving data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public EfficiencyPage(IEfficiencyFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new EfficiencyPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Efficiency</c>).</summary>
    public static string RouteName => EfficiencyRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public EfficiencyPageViewModel ViewModel => _viewModel;

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

        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 140 });
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 12, BuildSkeletonBlocks(4, 84)));
        _loadingSkeleton.Children.Add(ColumnsGrid(2, SectionSpacing, BuildSkeletonBlocks(2, 240)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 260 });
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
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Render(EfficiencyDisplay display)
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

    private static StackPanel BuildContent(EfficiencyDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHero(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildStatCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = TwoColumn(BuildChart(display.TrendChart, ChartSeriesKind.Area, 240), BuildChart(display.SpeedDistChart, ChartSeriesKind.Bar, 240)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = TwoColumn(BuildChart(display.SpeedVsEffChart, ChartSeriesKind.Scatter, 220), BuildChart(display.TempVsEffChart, ChartSeriesKind.Scatter, 220)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildTable(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildSummary(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildInsights(display) });
        return stack;
    }

    // ── Hero gauge + three readouts (web GlassPanel1) ──────────────────────────────────────────────────────
    private static TsGlassPanel BuildHero(EfficiencyDisplay display)
    {
        if (!display.HasStats)
        {
            return EmptyPanel(EfficiencyRegistration.EmptyGlyph, display.HeroEmptyMessage);
        }

        var gauge = new TsRadialGauge
        {
            Value = display.GaugeValue,
            Max = display.GaugeMax,
            Label = display.GaugeLabel,
            Role = display.GaugeRole,
            Diameter = 160,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var cells = new List<FrameworkElement> { gauge };
        foreach (var readout in display.HeroReadouts)
        {
            cells.Add(BuildReadout(readout));
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = ColumnsGrid(4, 16, cells) };
    }

    private static StackPanel BuildReadout(EfficiencyReadoutDisplay readout)
    {
        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TsAnimatedNumber
        {
            Value = readout.Value,
            Precision = readout.Decimals,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Caption { Value = readout.Label, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(column, $"{readout.Label}");
        return column;
    }

    // ── Stat cards (web GlassPanel2..5; the empty fallback is web GlassPanel6) ──────────────────────────────
    private static FrameworkElement BuildStatCards(EfficiencyDisplay display)
    {
        if (!display.HasStats)
        {
            return EmptyPanel(EfficiencyRegistration.EmptyGlyph, display.StatCardsEmptyMessage);
        }

        var cards = new List<FrameworkElement>(display.StatCards.Count);
        foreach (var card in display.StatCards)
        {
            var tile = new TsStatCard { Label = card.Label, Value = card.Value, Glyph = card.Glyph };
            AutomationProperties.SetName(tile, $"{card.Label}: {card.Value}");
            cards.Add(tile);
        }

        return ColumnsGrid(4, 12, cards);
    }

    // ── Charts (web efficiency-dailyTrend / Efficiency-by-Speed-Range / two scatter clouds) ─────────────────
    private static TsChartContainer BuildChart(EfficiencyChartDisplay chart, ChartSeriesKind kind, double height)
    {
        object? body = null;
        if (chart.HasData)
        {
            // The concrete wrapper fixes the recharts kind (area / bar / scatter); the role-driven brush keeps
            // the brand colour parity (cyan trend, amber speed scatter, purple temperature scatter).
            var series = new[]
            {
                new ChartSeries(chart.SeriesName, chart.Points) { Kind = kind, Role = chart.Role },
            };

            TsCartesianChart inner = kind switch
            {
                ChartSeriesKind.Bar => new TsBarChart(),
                ChartSeriesKind.Scatter => new TsScatterChart(),
                _ => new TsAreaChart(),
            };

            inner.Series = series;
            inner.ShowLegend = false;
            inner.IncludeZero = false;
            inner.MinHeight = height;
            inner.Title = chart.Title;
            body = inner;
        }

        return new TsChartContainer
        {
            Title = chart.Title,
            AccessibleSummary = chart.AriaLabel,
            State = chart.HasData ? ChartState.Ready : ChartState.Empty,
            EmptyMessage = chart.EmptyMessage,
            Body = body,
        };
    }

    // ── Temperature-bucketed table (web GlassPanel11) ──────────────────────────────────────────────────────
    private static TsGlassPanel BuildTable(EfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(ThermometerGlyph, display.TableTitle));

        if (display.TableHasData)
        {
            var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
            var columns = new List<TsDataColumn>(display.TableColumns.Count);
            foreach (var col in display.TableColumns)
            {
                columns.Add(new TsDataColumn { Key = col.Key, Header = col.Header, IsNumeric = col.IsNumeric });
            }

            table.Columns = columns;

            var rows = new List<TsDataRow>(display.TableRows.Count);
            foreach (var row in display.TableRows)
            {
                rows.Add(new TsDataRow(row.Range, new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["range"] = row.Range,
                    ["drives"] = row.Drives,
                    ["avgEff"] = row.AvgEff,
                    ["kmPerKwh"] = row.KmPerKwh,
                    ["totalDist"] = row.TotalDistance,
                    ["avgSpeed"] = row.AvgSpeed,
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
                IconGlyph = ThermometerGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Summary metric bars (web GlassPanel12) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSummary(EfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(EfficiencyProjection.ZapGlyph, display.SummaryTitle));

        if (display.HasStats)
        {
            var tiles = new List<FrameworkElement>(display.SummaryBars.Count);
            foreach (var bar in display.SummaryBars)
            {
                var tile = new StackPanel { Spacing = 4 };
                tile.Children.Add(new TsMetricBar
                {
                    Label = bar.Label,
                    Value = bar.Value,
                    Max = bar.Max,
                    AccentBrushKey = bar.AccentBrushKey,
                });
                tile.Children.Add(new Caption { Value = bar.ValueText });
                AutomationProperties.SetName(tile, $"{bar.Label}: {bar.ValueText}");
                tiles.Add(tile);
            }

            column.Children.Add(ColumnsGrid(2, 16, tiles));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = EfficiencyProjection.ZapGlyph, Message = display.SummaryEmptyMessage });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Energy insights (web GlassPanel13) ─────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildInsights(EfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(ThermometerGlyph, display.InsightsTitle));

        if (display.HasStats)
        {
            var tiles = new List<FrameworkElement>(display.Insights.Count);
            foreach (var insight in display.Insights)
            {
                tiles.Add(BuildInsight(insight));
            }

            column.Children.Add(ColumnsGrid(3, 16, tiles));
        }
        else
        {
            column.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = display.InsightsEmptyMessage });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static StackPanel BuildInsight(EfficiencyInsightDisplay insight)
    {
        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new Caption { Value = insight.Label, HorizontalAlignment = HorizontalAlignment.Center });
        column.Children.Add(new TextBlock
        {
            Text = insight.Value,
            FontWeight = FontWeights.SemiBold,
            FontSize = 18,
            Foreground = DisplayTokens.Brush(insight.ColorKey),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        AutomationProperties.SetName(column, $"{insight.Label}: {insight.Value}");
        return column;
    }

    // ── Shared primitives ──────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel EmptyPanel(string glyph, string message)
    {
        var empty = new TsEmptyState { IconGlyph = glyph, Message = message };
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = empty };
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

    private static Grid TwoColumn(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = SectionSpacing, RowSpacing = SectionSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
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

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
