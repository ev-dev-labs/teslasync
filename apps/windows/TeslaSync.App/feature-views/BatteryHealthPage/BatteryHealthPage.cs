using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
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

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>BatteryHealthPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/BatteryHealthPage.tsx</c> (route <c>/battery</c>, nav name
/// <c>BatteryHealth</c>). It binds to a <see cref="BatteryHealthPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the
/// loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the four-gauge health-score hero, the three metric bars, the seven summary cards, the four thermal cards,
/// the smart insights, the capacity-trend &amp; range-trend charts, the charge-level distribution + habits,
/// the New-vs-Now comparison, the AC/DC breakdown + statistics, the quick links and the recommendations. Each
/// web <c>SectionErrorBoundary</c> maps to a guarded section that surfaces its localized fallback title. The
/// view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="BatteryHealthDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class BatteryHealthPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly BatteryHealthPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = BatteryHealthRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public BatteryHealthPage()
        : this(EmptyBatteryHealthFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The four-source battery data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public BatteryHealthPage(IBatteryHealthFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new BatteryHealthPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when a quick-link tile is invoked; the shell maps the route to a navigation.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The diagnostics surface slug (<c>BatteryHealthPage</c>).</summary>
    public static string Slug => BatteryHealthRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 180 });
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 16, BuildSkeletonBlocks(6, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 288 });
        _loadingSkeleton.Children.Add(ColumnsGrid(2, 24, BuildSkeletonBlocks(2, 220)));
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

    private void Render(BatteryHealthDisplay display)
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

    private StackPanel BuildContent(BatteryHealthDisplay display)
    {
        var titles = display.SectionTitles;
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = Section(titles.Hero, () => BuildHero(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = Section(titles.MetricBars, () => BuildMetricBars(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = Section(titles.SummaryCards, () => BuildSummaryCards(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 120, Content = Section(titles.Thermal, () => BuildThermal(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = Section(titles.Insights, () => BuildInsights(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildCapacityTrend(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildRangeTrend(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = Section(titles.ChargeDist, () => BuildChargeDist(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 350, Content = Section(titles.CapacityRange, () => BuildNewVsNow(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 400, Content = Section(titles.AcDc, () => BuildAcDc(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 450, Content = Section(titles.QuickLinks, () => BuildQuickLinks(display)) });
        stack.Children.Add(new TsFadeIn { DelayMs = 500, Content = Section(titles.Recommendations, () => BuildRecommendations(display)) });
        return stack;
    }

    // ── 1. Health-score hero (four radial gauges + years-to-80%) ─────────────────────────────────────────
    private static TsGlassPanel BuildHero(BatteryHealthDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < 5; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var healthColumn = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        healthColumn.Children.Add(BuildGauge(display.Gauges[0], 130));
        var badge = new TsBadge
        {
            Status = display.HealthBadgeStatus,
            Content = new TextBlock { Text = display.HealthBadgeText },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.HealthBadgeText);
        healthColumn.Children.Add(badge);
        Grid.SetColumn(healthColumn, 0);
        grid.Children.Add(healthColumn);

        for (int i = 1; i < display.Gauges.Count; i++)
        {
            var gauge = BuildGauge(display.Gauges[i], 112);
            Grid.SetColumn(gauge, i);
            grid.Children.Add(gauge);
        }

        var yearsColumn = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        yearsColumn.Children.Add(new MetricValue { Value = display.YearsTo80Value, HorizontalAlignment = HorizontalAlignment.Center });
        yearsColumn.Children.Add(new Caption { Value = display.YearsTo80Label, HorizontalAlignment = HorizontalAlignment.Center });
        yearsColumn.Children.Add(new Caption { Value = display.WarrantyNote, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(yearsColumn, $"{display.YearsTo80Label}, {display.YearsTo80Value}");
        Grid.SetColumn(yearsColumn, 4);
        grid.Children.Add(yearsColumn);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
    }

    private static TsRadialGauge BuildGauge(HealthGaugeDisplay gauge, double diameter)
    {
        var control = new TsRadialGauge
        {
            Value = gauge.Value,
            Max = gauge.Max,
            Label = gauge.Label,
            Unit = gauge.Unit,
            ColorIndex = gauge.ColorIndex,
            Decimals = gauge.Decimals,
            Diameter = diameter,
        };
        AutomationProperties.SetName(control, gauge.AutomationName);
        return control;
    }

    // ── 2. Metric bars (capacity / degradation / cycles) ─────────────────────────────────────────────────
    private static TsGlassPanel BuildMetricBars(BatteryHealthDisplay display)
    {
        var columns = new List<FrameworkElement>(display.MetricBars.Count);
        foreach (var bar in display.MetricBars)
        {
            var column = new StackPanel { Spacing = 4 };
            var control = new TsMetricBar
            {
                Label = bar.Label,
                Value = bar.Value,
                Max = bar.Max,
                AccentBrushKey = bar.AccentBrushKey,
            };
            AutomationProperties.SetName(control, bar.AutomationName);
            column.Children.Add(control);
            column.Children.Add(new Caption { Value = bar.Caption });
            columns.Add(column);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = ColumnsGrid(3, 24, columns) };
    }

    // ── 3. Summary cards (SOH / current / original / degradation / cycles / age / full-charge) ────────────
    private static Grid BuildSummaryCards(BatteryHealthDisplay display) =>
        ColumnsGrid(3, 16, BuildCards(display.SummaryCards));

    // ── 3b. Thermal monitoring (module temps / heater / spread) ──────────────────────────────────────────
    private static TsGlassPanel BuildThermal(BatteryHealthDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(TitleRow(BatteryHealthProjection.ThermometerGlyph, display.ThermalTitle));
        stack.Children.Add(ColumnsGrid(4, 16, BuildCards(display.ThermalCards)));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static List<FrameworkElement> BuildCards(IReadOnlyList<HealthMetricCard> cards)
    {
        var built = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var control = new TsStatCard
            {
                Label = card.Label,
                Value = card.Value,
                Glyph = card.Glyph,
                Sublabel = card.Sublabel ?? string.Empty,
            };
            AutomationProperties.SetName(control, card.AutomationName);
            built.Add(control);
        }

        return built;
    }

    // ── 4. Smart insights ────────────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildInsights(BatteryHealthDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(TitleRow(BatteryHealthProjection.HeartGlyph, display.InsightsTitle));

        if (display.Insights.Count > 0)
        {
            var cards = new List<FrameworkElement>(display.Insights.Count);
            foreach (var insight in display.Insights)
            {
                cards.Add(BuildInsightCard(insight));
            }

            stack.Children.Add(ColumnsGrid(2, 12, cards));
        }
        else
        {
            stack.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryHealthProjection.InfoGlyph,
                Message = display.InsightsEmptyMessage,
            });
        }

        return stack;
    }

    private static TsGlassPanel BuildInsightCard(HealthInsight insight)
    {
        var brush = DisplayTokens.Brush(StatusResources.AccentBrushKey(insight.Status));

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = insight.Glyph,
            FontSize = 16,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Top,
        });

        var text = new StackPanel { Spacing = 2 };
        text.Children.Add(new TextBlock
        {
            Text = insight.Title,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        text.Children.Add(new Caption { Value = insight.Description });
        row.Children.Add(text);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = row };
        AutomationProperties.SetName(panel, insight.AutomationName);
        return panel;
    }

    // ── 5. Capacity trend & prediction (composed chart) ──────────────────────────────────────────────────
    private static TsChartContainer BuildCapacityTrend(BatteryHealthDisplay display)
    {
        var trend = display.CapacityTrend;
        var chart = new TsComposedChart
        {
            Title = trend.Title,
            Series = trend.Series,
            Annotations = trend.Annotations,
            ShowLegend = true,
            IncludeZero = false,
            MinHeight = 288,
        };

        return new TsChartContainer
        {
            Title = trend.Title,
            Subtitle = trend.Subtitle,
            AccessibleSummary = trend.AriaLabel,
            State = trend.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = trend.EmptyMessage,
        };
    }

    // ── 6. Estimated range over time (area chart) ────────────────────────────────────────────────────────
    private static TsChartContainer BuildRangeTrend(BatteryHealthDisplay display)
    {
        var range = display.RangeTrend;
        var chart = new TsAreaChart
        {
            Title = range.Title,
            Series = range.Series,
            ShowLegend = true,
            IncludeZero = false,
            MinHeight = 240,
        };

        return new TsChartContainer
        {
            Title = range.Title,
            AccessibleSummary = range.AriaLabel,
            State = range.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = range.EmptyMessage,
        };
    }

    // ── 7. Charge level distribution (bar chart + habit stats) ───────────────────────────────────────────
    private static TsGlassPanel BuildChargeDist(BatteryHealthDisplay display)
    {
        var cd = display.ChargeDist;
        var stack = new StackPanel { Spacing = 16 };

        var titleRow = TitleRow(BatteryHealthProjection.LightningGlyph, display.ChargeDistTitle);
        titleRow.Children.Add(new Caption { Value = display.ChargeDistSubtitle, VerticalAlignment = VerticalAlignment.Center });
        stack.Children.Add(titleRow);

        if (cd.HasData)
        {
            stack.Children.Add(new TsBarChart
            {
                Title = display.ChargeDistTitle,
                Series = cd.Series,
                ShowLegend = true,
                MinHeight = 224,
            });

            if (cd.Habits.Count > 0)
            {
                var habitCells = new List<FrameworkElement>(cd.Habits.Count);
                foreach (var habit in cd.Habits)
                {
                    habitCells.Add(BuildHabitStat(habit));
                }

                stack.Children.Add(ColumnsGrid(4, 12, habitCells));
            }
        }
        else
        {
            stack.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryHealthProjection.LightningGlyph,
                Message = cd.EmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static StackPanel BuildHabitStat(HealthHabitStat habit)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new TextBlock
        {
            Text = habit.Value,
            FontWeight = FontWeights.Bold,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18),
            Foreground = DisplayTokens.Brush(habit.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Caption { Value = habit.Label, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(column, habit.AutomationName);
        return column;
    }

    // ── 8. Capacity & range: new vs now ──────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildNewVsNow(BatteryHealthDisplay display)
    {
        var stack = new StackPanel { Spacing = 16 };
        stack.Children.Add(TitleRow(BatteryHealthProjection.ActivityGlyph, display.NewVsNowTitle));

        var cards = new List<FrameworkElement>(display.NewVsNowCards.Count);
        foreach (var card in display.NewVsNowCards)
        {
            cards.Add(BuildNewVsNowCard(card));
        }

        stack.Children.Add(ColumnsGrid(4, 16, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static TsGlassPanel BuildNewVsNowCard(HealthNewVsNowCard card)
    {
        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new Caption { Value = card.Label, HorizontalAlignment = HorizontalAlignment.Center });

        var value = new TextBlock { HorizontalAlignment = HorizontalAlignment.Center };
        value.Inlines.Add(new Run
        {
            Text = card.Value,
            FontWeight = FontWeights.Bold,
            FontSize = TypographyTokens.Size("TsTypeHeadingFontSize", 22),
            Foreground = DisplayTokens.Brush(card.AccentBrushKey),
        });
        value.Inlines.Add(new Run { Text = $" {card.Unit}", Foreground = DisplayTokens.TextMuted });
        column.Children.Add(value);

        if (!string.IsNullOrEmpty(card.Delta))
        {
            column.Children.Add(new TextBlock
            {
                Text = card.Delta,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger)),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        string name = card.Delta is null ? $"{card.Label}, {card.Value} {card.Unit}" : $"{card.Label}, {card.Value} {card.Unit}, {card.Delta}";
        AutomationProperties.SetName(panel, name);
        return panel;
    }

    // ── 9. AC/DC energy breakdown (pie chart + charging statistics) ──────────────────────────────────────
    private static Grid BuildAcDc(BatteryHealthDisplay display)
    {
        var acdc = display.AcDc;
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var pie = new TsPieChart { Values = acdc.PieData, InnerRadiusRatio = 0.5, MinHeight = 208 };
        var chartContainer = new TsChartContainer
        {
            Title = acdc.ChartTitle,
            AccessibleSummary = acdc.ChartAriaLabel,
            State = acdc.HasData ? ChartState.Ready : ChartState.Empty,
            Body = pie,
            EmptyMessage = acdc.ChartEmptyMessage,
        };
        Grid.SetColumn(chartContainer, 0);
        grid.Children.Add(chartContainer);

        var statsColumn = new StackPanel { Spacing = 12 };
        statsColumn.Children.Add(TitleRow(BatteryHealthProjection.GaugeGlyph, acdc.StatsTitle));
        if (acdc.Stats.Count > 0)
        {
            foreach (var row in acdc.Stats)
            {
                statsColumn.Children.Add(BuildStatRow(row));
            }
        }
        else
        {
            statsColumn.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryHealthProjection.ActivityGlyph,
                Message = acdc.StatsEmptyMessage,
            });
        }

        var statsPanel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = statsColumn };
        Grid.SetColumn(statsPanel, 1);
        grid.Children.Add(statsPanel);

        return grid;
    }

    private static Grid BuildStatRow(HealthStatRow row)
    {
        var grid = new Grid { Padding = new Thickness(0, 8, 0, 8), BorderThickness = new Thickness(0, 0, 0, 1), BorderBrush = DisplayTokens.Border };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Caption { Value = row.Label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        var value = new TextBlock
        {
            Text = row.Value,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(value, 1);
        grid.Children.Add(value);
        AutomationProperties.SetName(grid, $"{row.Label}, {row.Value}");
        return grid;
    }

    // ── 10. Quick links ──────────────────────────────────────────────────────────────────────────────────
    private TsGlassPanel BuildQuickLinks(BatteryHealthDisplay display)
    {
        var buttons = new List<FrameworkElement>(display.QuickLinks.Count);
        foreach (var link in display.QuickLinks)
        {
            string route = link.Route;
            var button = new TsButton
            {
                Variant = ButtonVariant.Outline,
                Text = link.Label,
                IconGlyph = BatteryHealthProjection.ArrowGlyph,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            AutomationProperties.SetName(button, link.AutomationName);
            button.Click += (_, _) => NavigationRequested?.Invoke(this, route.TrimStart('/'));
            buttons.Add(button);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = ColumnsGrid(3, 12, buttons) };
    }

    // ── 11. Recommendations ──────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecommendations(BatteryHealthDisplay display)
    {
        var stack = new StackPanel { Spacing = 12 };

        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        badgeRow.Children.Add(new FontIcon { Glyph = BatteryHealthProjection.LightbulbGlyph, FontSize = 14, VerticalAlignment = VerticalAlignment.Center });
        badgeRow.Children.Add(new TextBlock { Text = display.RecommendationsTitle, VerticalAlignment = VerticalAlignment.Center });
        var badge = new TsBadge { Status = StatusKind.Success, Content = badgeRow, HorizontalAlignment = HorizontalAlignment.Left };
        AutomationProperties.SetName(badge, display.RecommendationsTitle);
        stack.Children.Add(badge);

        foreach (var tip in display.Recommendations)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(new FontIcon
            {
                Glyph = BatteryHealthProjection.LightbulbGlyph,
                FontSize = 16,
                Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
                VerticalAlignment = VerticalAlignment.Top,
            });
            row.Children.Add(new Text { Value = tip });
            AutomationProperties.SetName(row, tip);
            stack.Children.Add(row);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static UIElement Section(string fallbackTitle, Func<UIElement> build)
    {
        try
        {
            return build();
        }
        catch (Exception ex)
        {
            var stack = new StackPanel { Spacing = 8 };
            stack.Children.Add(new SectionTitle { Value = fallbackTitle });
            stack.Children.Add(new Text { Value = ex.Message });
            var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
            AutomationProperties.SetName(panel, fallbackTitle);
            return panel;
        }
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

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new BatteryHealthPageAutomationPeer(this);

    private sealed class BatteryHealthPageAutomationPeer(BatteryHealthPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
