using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>DriveScorePage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/DriveScorePage.tsx</c> (route <c>/drive-score</c>, nav name
/// <c>DriveScore</c>). It binds to a <see cref="DriveScorePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the hero
/// overall-score gauge, the grade banner, the three category-breakdown gauges, the Score-Trend line chart, the
/// Category-Breakdown and Score-Distribution bar charts, the improvement-tips panel, the best/worst drive cards,
/// the paginated drive-history table, the four summary stat cards, the six weekly/monthly period tiles, the
/// achievement badges and the two key/value summary cards. The view is a thin renderer: all branch selection,
/// scoring, formatting and i18n happen in the view-model's <see cref="DriveScoreDisplay"/> projection. State
/// changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DriveScorePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly DriveScorePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = DriveScoreRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public DriveScorePage()
        : this(EmptyDriveScoreFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source drives + score data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DriveScorePage(IDriveScoreFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new DriveScorePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>DriveScorePage</c>).</summary>
    public static string Slug => DriveScoreRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 240 });
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 16, BuildSkeletonBlocks(3, 200)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 96)));
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

    private void Render(DriveScoreDisplay display)
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

    private StackPanel BuildContent(DriveScoreDisplay d)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHero(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 40, Content = BuildGrade(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 80, Content = BuildCategories(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 120, Content = BuildTrendChart(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildCategoryChart(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 170, Content = BuildDistributionChart(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 190, Content = BuildTips(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 210, Content = BuildBestWorst(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 230, Content = BuildHistory(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildStatCards(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 270, Content = BuildPeriod(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 290, Content = BuildAchievements(d) });
        stack.Children.Add(new TsFadeIn { DelayMs = 310, Content = BuildKvCards(d) });
        return stack;
    }

    // ── Section 1: Hero overall score gauge (GlassPanel1) ───────────────────────────────────────────────────
    private static TsGlassPanel BuildHero(DriveScoreDisplay d)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new TsRadialGauge
        {
            Value = d.OverallScore,
            Max = 100,
            Label = d.OverallLabel,
            ColorIndex = d.OverallColorIndex,
            Diameter = 200,
        });

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TsAnimatedNumber { Value = d.OverallScore });
        valueRow.Children.Add(new TextBlock { Text = "/100", Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Bottom });
        var help = new FontIcon { Glyph = "\uE946", FontSize = 13, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(help, d.HelpAria);
        ToolTipService.SetToolTip(help, d.HelpAria);
        valueRow.Children.Add(help);
        column.Children.Add(valueRow);

        var trendRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        trendRow.Children.Add(new FontIcon { Glyph = d.TrendGlyph, FontSize = 14, Foreground = StatusBrush(d.TrendStatus), VerticalAlignment = VerticalAlignment.Center });
        trendRow.Children.Add(new TextBlock { Text = d.OverallTrendLabel, Foreground = StatusBrush(d.TrendStatus), VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(trendRow);

        if (d.HasBasedOn)
        {
            column.Children.Add(new Caption { Value = d.BasedOnText, HorizontalAlignment = HorizontalAlignment.Center });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Section 3: Grade banner (GlassPanel2) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildGrade(DriveScoreDisplay d)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };
        var badge = new TsBadge { Status = d.GradeStatus, Content = new TextBlock { Text = d.GradeText, FontWeight = FontWeights.Bold }, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(badge, d.GradeText);
        left.Children.Add(badge);

        var labels = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        labels.Children.Add(new TextBlock { Text = d.GradeLabelText, FontWeight = FontWeights.SemiBold, Foreground = DisplayTokens.TextPrimary });
        var trendRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        trendRow.Children.Add(new FontIcon { Glyph = d.TrendGlyph, FontSize = 12, Foreground = StatusBrush(d.TrendStatus), VerticalAlignment = VerticalAlignment.Center });
        trendRow.Children.Add(new TextBlock { Text = d.OverallTrendLabel, Foreground = StatusBrush(d.TrendStatus) });
        labels.Children.Add(trendRow);
        left.Children.Add(labels);
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = new TextBlock { Text = d.DrivesInPeriodText, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center, HorizontalTextAlignment = TextAlignment.Right };
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding, 16, PanelPadding, 16), Content = grid };
    }

    // ── Section 2: Category breakdown gauges (GlassPanel3/4/5) ───────────────────────────────────────────────
    private static Grid BuildCategories(DriveScoreDisplay d)
    {
        var cards = new List<FrameworkElement>(d.Categories.Count);
        foreach (var c in d.Categories)
        {
            cards.Add(BuildCategoryPanel(c));
        }

        return ColumnsGrid(3, 16, cards);
    }

    private static TsGlassPanel BuildCategoryPanel(CategoryGaugeDisplay c)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };

        column.Children.Add(new TsRadialGauge
        {
            Value = c.Value,
            Max = c.Max,
            Label = c.Label,
            ColorIndex = c.ColorIndex,
            Diameter = 120,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TsAnimatedNumber { Value = c.Value });
        valueRow.Children.Add(new TextBlock { Text = c.MaxText, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Bottom });
        column.Children.Add(valueRow);

        column.Children.Add(new TsMetricBar
        {
            Label = c.Label,
            Value = c.Value,
            Max = c.Max,
            AccentBrushKey = c.AccentBrushKey,
        });

        column.Children.Add(new TsInlineMetric { Label = c.MetricLabel, Value = c.MetricValue });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Section 4: Score-Trend chart (GlassPanel6 + Score-Trend container + LineChart) ──────────────────────
    private static TsGlassPanel BuildTrendChart(DriveScoreDisplay d)
    {
        var chart = new TsLineChart
        {
            Title = d.TrendTitle,
            Series = BuildSeries(d.TrendSeries),
            Annotations =
            [
                new ChartAnnotation("gradeA", ChartAnnotationKind.HorizontalLine, d.GradeLineValue)
                {
                    Label = d.GradeLineLabel,
                    Role = ChartRole.Regen,
                },
            ],
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = 300,
        };

        var container = new TsChartContainer
        {
            Title = d.TrendTitle,
            AccessibleSummary = d.TrendAria,
            State = d.TrendHasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = d.TrendAria,
        };

        return new TsGlassPanel { Padding = new Thickness(8), Content = container };
    }

    // ── Section 5: Category-Breakdown chart (GlassPanel8 + Category-Breakdown container + BarChart) ──────────
    private static TsGlassPanel BuildCategoryChart(DriveScoreDisplay d)
    {
        var chart = new TsBarChart
        {
            Title = d.CategoryTitle,
            Series = BuildSeries(d.CategorySeries),
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = 260,
        };

        var container = new TsChartContainer
        {
            Title = d.CategoryTitle,
            AccessibleSummary = d.CategoryAria,
            State = ChartState.Ready,
            Body = chart,
            EmptyMessage = d.CategoryAria,
        };

        return new TsGlassPanel { Padding = new Thickness(8), Content = container };
    }

    // ── Section 5b: Score-Distribution histogram (GlassPanel10 + Score-Distribution container + BarChart) ───
    private static TsGlassPanel BuildDistributionChart(DriveScoreDisplay d)
    {
        var chart = new TsBarChart
        {
            Title = d.DistributionTitle,
            Series = BuildSeries(d.DistributionSeries),
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = 220,
        };

        var container = new TsChartContainer
        {
            Title = d.DistributionTitle,
            AccessibleSummary = d.DistributionAria,
            State = ChartState.Ready,
            Body = chart,
            EmptyMessage = d.DistributionAria,
        };

        return new TsGlassPanel { Padding = new Thickness(8), Content = container };
    }

    // ── Section 6: Improvement tips (GlassPanel12) ──────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTips(DriveScoreDisplay d)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new PanelTitle { Value = d.TipsTitle });
        column.Children.Add(new Text { Value = d.TipsSubtitle });

        foreach (var tip in d.Tips)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
            row.Children.Add(new FontIcon
            {
                Glyph = DriveScoreProjection.LightbulbGlyph,
                FontSize = 16,
                Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
                VerticalAlignment = VerticalAlignment.Top,
            });
            row.Children.Add(new Text { Value = tip });

            var border = new Border { Padding = new Thickness(12), CornerRadius = new CornerRadius(12), Background = DisplayTokens.Surface, Child = row };
            AutomationProperties.SetName(border, tip);
            column.Children.Add(border);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Section 6b: Best & Worst drives (GlassPanel13 / GlassPanel14) ───────────────────────────────────────
    private static Grid BuildBestWorst(DriveScoreDisplay d)
    {
        return ColumnsGrid(2, 16, [BuildBestWorstPanel(d.Best), BuildBestWorstPanel(d.Worst)]);
    }

    private static TsGlassPanel BuildBestWorstPanel(BestWorstDisplay b)
    {
        var column = new StackPanel { Spacing = 12 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new FontIcon { Glyph = b.Glyph, FontSize = 16, Foreground = StatusBrush(b.TipStatus), VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new PanelTitle { Value = b.Title });
        column.Children.Add(titleRow);

        if (b.Has)
        {
            var head = new Grid();
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var date = new Caption { Value = b.DateText, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(date, 0);
            head.Children.Add(date);
            var badge = new TsBadge { Status = b.GradeStatus, Content = new TextBlock { Text = b.Grade } };
            AutomationProperties.SetName(badge, b.Grade);
            Grid.SetColumn(badge, 1);
            head.Children.Add(badge);
            column.Children.Add(head);

            var body = new Grid { ColumnSpacing = 16 };
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var gauge = new TsRadialGauge { Value = b.Score, Max = 100, Label = string.Empty, ColorIndex = b.ScoreColorIndex, Diameter = 80 };
            Grid.SetColumn(gauge, 0);
            body.Children.Add(gauge);

            var rows = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            rows.Children.Add(StatRow(b.DistanceLabel, b.DistanceText));
            rows.Children.Add(StatRow(b.DurationLabel, b.DurationText));
            rows.Children.Add(StatRow(b.ConsumptionLabel, b.ConsumptionText));
            Grid.SetColumn(rows, 1);
            body.Children.Add(rows);
            column.Children.Add(body);

            var tipRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            tipRow.Children.Add(new FontIcon { Glyph = b.Glyph, FontSize = 12, Foreground = StatusBrush(b.TipStatus), VerticalAlignment = VerticalAlignment.Top });
            tipRow.Children.Add(new TextBlock { Text = b.TipText, TextWrapping = TextWrapping.Wrap, Foreground = StatusBrush(b.TipStatus) });
            var tipBorder = new Border { Padding = new Thickness(12), CornerRadius = new CornerRadius(12), Background = DisplayTokens.Surface, Child = tipRow };
            column.Children.Add(tipBorder);
        }
        else
        {
            column.Children.Add(new Caption { Value = b.NoDataText });
        }

        return new TsGlassPanel { Padding = new Thickness(20), Content = column };
    }

    private static Grid StatRow(string label, string value)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var l = new Caption { Value = label };
        Grid.SetColumn(l, 0);
        grid.Children.Add(l);
        var v = new TextBlock { Text = value, Foreground = DisplayTokens.TextPrimary };
        Grid.SetColumn(v, 1);
        grid.Children.Add(v);
        return grid;
    }

    // ── Section 7: Drive history table + pagination (GlassPanel15) ───────────────────────────────────────────
    private TsGlassPanel BuildHistory(DriveScoreDisplay d)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new PanelTitle { Value = d.HistoryTitle });

        var table = new StackPanel { Spacing = 0 };
        table.Children.Add(BuildHistoryHeaderRow(d.HistoryHeaders));

        if (d.HistoryRows.Count == 0)
        {
            column.Children.Add(table);
            column.Children.Add(new TsEmptyState { IconGlyph = DriveScoreProjection.GaugeGlyph, Message = d.HistoryEmptyText });
            return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        }

        foreach (var row in d.HistoryRows)
        {
            table.Children.Add(BuildHistoryRow(row));
        }

        var scroller = new ScrollViewer
        {
            Content = table,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };
        column.Children.Add(scroller);

        if (d.ShowPagination)
        {
            var pager = new TsPagination
            {
                Page = d.Page,
                PageSize = d.PageSize,
                TotalItems = d.TotalRows,
                SummaryFormat = d.PaginationSummaryFormat,
                HorizontalAlignment = HorizontalAlignment.Center,
            };
            pager.PageChanged += (_, page) => _viewModel.Page = page;
            column.Children.Add(pager);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Grid BuildHistoryHeaderRow(IReadOnlyList<string> headers)
    {
        var grid = HistoryGrid();
        grid.Padding = new Thickness(8, 0, 8, 8);
        grid.BorderBrush = DisplayTokens.Border;
        grid.BorderThickness = new Thickness(0, 0, 0, 1);
        for (int i = 0; i < headers.Count; i++)
        {
            var cell = new Caption { Value = headers[i], VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static Grid BuildHistoryRow(DriveRowDisplay row)
    {
        var grid = HistoryGrid();
        grid.Padding = new Thickness(8, 10, 8, 10);
        grid.BorderBrush = DisplayTokens.Border;
        grid.BorderThickness = new Thickness(0, 0, 0, 1);

        AddCell(grid, 0, new TextBlock { Text = row.Date, Foreground = DisplayTokens.TextPrimary, TextTrimming = TextTrimming.CharacterEllipsis });
        AddCell(grid, 1, new TextBlock { Text = row.Route, Foreground = DisplayTokens.TextSecondary, TextTrimming = TextTrimming.CharacterEllipsis });
        AddCell(grid, 2, new TextBlock { Text = row.Distance, Foreground = DisplayTokens.TextPrimary });
        AddCell(grid, 3, new TextBlock { Text = row.Duration, Foreground = DisplayTokens.TextPrimary });
        AddCell(grid, 4, new TextBlock { Text = row.Consumption, Foreground = DisplayTokens.TextPrimary });
        AddCell(grid, 5, new TextBlock { Text = row.ScoreText, FontWeight = FontWeights.SemiBold, Foreground = StatusBrush(row.ScoreStatus) });

        var badge = new TsBadge { Status = row.GradeStatus, Content = new TextBlock { Text = row.Grade }, HorizontalAlignment = HorizontalAlignment.Left };
        AutomationProperties.SetName(badge, row.Grade);
        AddCell(grid, 6, badge);

        AddCell(grid, 7, new TextBlock { Text = row.Breakdown, Foreground = DisplayTokens.TextMuted });
        return grid;
    }

    private static Grid HistoryGrid()
    {
        var grid = new Grid { ColumnSpacing = 8, MinWidth = 760 };
        double[] weights = [1.1, 1.6, 1, 1, 1.1, 1, 0.8, 0.9];
        foreach (double w in weights)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w, GridUnitType.Star) });
        }

        return grid;
    }

    private static void AddCell(Grid grid, int column, FrameworkElement element)
    {
        element.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    // ── Section 8: Summary stat cards (Avg-Score / Best-Score / Total-Drives / Avg-Efficiency) ──────────────
    private static Grid BuildStatCards(DriveScoreDisplay d)
    {
        var cards = new List<FrameworkElement>(d.StatCards.Count);
        foreach (var c in d.StatCards)
        {
            var card = new TsStatCard { Label = c.Label, Value = c.Value, Glyph = c.Glyph, Sublabel = c.Sublabel };
            AutomationProperties.SetName(card, $"{c.Label}: {c.Value}");
            cards.Add(card);
        }

        return ColumnsGrid(4, 16, cards);
    }

    // ── Section 9: Weekly / monthly period tiles (GlassPanel20-25 / GlassPanel-empty) ───────────────────────
    private static FrameworkElement BuildPeriod(DriveScoreDisplay d)
    {
        if (!d.HasPeriodStats)
        {
            var empty = new TsEmptyState { IconGlyph = DriveScoreProjection.GaugeGlyph, Message = d.NoPeriodStatsText };
            return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = empty };
        }

        var panels = new List<FrameworkElement>(d.PeriodPanels.Count);
        foreach (var p in d.PeriodPanels)
        {
            panels.Add(BuildPeriodPanel(p));
        }

        return ColumnsGrid(3, 12, panels);
    }

    private static TsGlassPanel BuildPeriodPanel(PeriodPanelDisplay p)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new Caption { Value = p.Label });

        var valueRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Bottom };
        valueRow.Children.Add(new TextBlock { Text = p.Value, FontSize = 24, FontWeight = FontWeights.Bold, Foreground = StatusBrush(p.ValueStatus) });
        if (p.HasDelta)
        {
            var deltaStatus = p.DeltaPositive ? StatusKind.Success : StatusKind.Danger;
            var deltaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            deltaRow.Children.Add(new FontIcon { Glyph = p.DeltaPositive ? DriveScoreProjection.TrendUpGlyph : DriveScoreProjection.TrendDownGlyph, FontSize = 12, Foreground = StatusBrush(deltaStatus), VerticalAlignment = VerticalAlignment.Center });
            deltaRow.Children.Add(new TextBlock { Text = p.DeltaText, Foreground = StatusBrush(deltaStatus), VerticalAlignment = VerticalAlignment.Center });
            valueRow.Children.Add(deltaRow);
        }

        column.Children.Add(valueRow);
        column.Children.Add(new Caption { Value = p.SubText });

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, $"{p.Label}: {p.Value}");
        return panel;
    }

    // ── Section 10: Achievement badges (GlassPanel26) ───────────────────────────────────────────────────────
    private static TsGlassPanel BuildAchievements(DriveScoreDisplay d)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = d.AchievementsTitle });

        var cards = new List<FrameworkElement>(d.Achievements.Count);
        foreach (var a in d.Achievements)
        {
            cards.Add(BuildAchievementCard(a));
        }

        column.Children.Add(ColumnsGrid(4, 12, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Border BuildAchievementCard(AchievementDisplay a)
    {
        var column = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        var iconBg = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(999),
            Background = a.Unlocked ? Fade(DisplayTokens.Brush("TsColorWarningBrush")) : DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = a.Glyph,
                FontSize = 18,
                Foreground = a.Unlocked ? DisplayTokens.Brush("TsColorWarningBrush") : DisplayTokens.TextMuted,
            },
        };
        column.Children.Add(iconBg);
        column.Children.Add(new TextBlock { Text = a.Label, FontWeight = FontWeights.SemiBold, Foreground = a.Unlocked ? DisplayTokens.TextPrimary : DisplayTokens.TextMuted, HorizontalTextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap });
        column.Children.Add(new Caption { Value = a.Description, HorizontalAlignment = HorizontalAlignment.Center });

        if (a.Unlocked)
        {
            var badge = new TsBadge { Status = StatusKind.Success, Content = new TextBlock { Text = a.UnlockedText }, HorizontalAlignment = HorizontalAlignment.Center };
            AutomationProperties.SetName(badge, a.UnlockedText);
            column.Children.Add(badge);
        }

        var card = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            BorderThickness = new Thickness(1),
            BorderBrush = a.Unlocked ? DisplayTokens.Brush("TsColorWarningBrush") : DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Opacity = a.Unlocked ? 1 : 0.55,
            Child = column,
        };
        AutomationProperties.SetName(card, $"{a.Label}. {a.Description}");
        return card;
    }

    // ── Score Breakdown / Period Statistics (Card28 / Card29) ───────────────────────────────────────────────
    private static Grid BuildKvCards(DriveScoreDisplay d)
    {
        return ColumnsGrid(2, 16, [BuildKvCard(d.ScoreBreakdown), BuildKvCard(d.PeriodStatistics)]);
    }

    private static TsCard BuildKvCard(KvCardDisplay c)
    {
        var column = new StackPanel { Spacing = 12, Padding = new Thickness(PanelPadding) };
        column.Children.Add(new PanelTitle { Value = c.Title });

        var items = new List<TsKeyValue>(c.Rows.Count);
        foreach (var row in c.Rows)
        {
            items.Add(new TsKeyValue(row.Label, row.Value));
        }

        column.Children.Add(new TsKVList { Items = items });
        return new TsCard { Content = column };
    }

    // ── Shared primitives ───────────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<SeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            if (s.Points.Count == 0)
            {
                continue;
            }

            built.Add(new ChartSeries(s.Name, s.Points) { ColorIndex = s.ColorIndex });
        }

        return built;
    }

    private static Brush StatusBrush(StatusKind status) =>
        DisplayTokens.Brush(StatusResources.AccentBrushKey(status));

    private static Brush Fade(Brush brush)
    {
        if (brush is SolidColorBrush solid)
        {
            return new SolidColorBrush(solid.Color) { Opacity = 0.15 };
        }

        return brush;
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

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new DriveScorePageAutomationPeer(this);

    private sealed class DriveScorePageAutomationPeer(DriveScorePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
