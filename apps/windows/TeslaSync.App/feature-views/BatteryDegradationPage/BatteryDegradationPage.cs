using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The native WinUI 3 <c>BatteryDegradationPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/BatteryDegradationPage.tsx</c> (route <c>/battery-degradation</c>, nav name
/// <c>BatteryDegradation</c>). It binds to a <see cref="BatteryDegradationPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip),
/// the loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the four summary metric cards, the state-of-health radial gauge, the degradation-prediction panel, the
/// Health-Trend &amp; Projection composed chart, the Range-Loss area chart, the scored risk-factor cards, the
/// recommendations list, the charging-habits impact banner, the three battery-health-factor cards and the
/// degradation-history table. The view is a thin renderer: all branch selection, formatting and i18n happen in
/// the view-model's <see cref="BatteryDegradationDisplay"/> projection. State changes are marshalled onto the UI
/// thread.
/// </summary>
public sealed partial class BatteryDegradationPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly BatteryDegradationPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = BatteryDegradationRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public BatteryDegradationPage()
        : this(EmptyBatteryDegradationFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source battery data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public BatteryDegradationPage(IBatteryDegradationFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new BatteryDegradationPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>BatteryDegradationPage</c>).</summary>
    public static string Slug => BatteryDegradationRegistration.Slug;

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
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 16, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(ColumnsGrid(2, 24, BuildSkeletonBlocks(2, 220)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
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

    private void Render(BatteryDegradationDisplay display)
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

    private static StackPanel BuildContent(BatteryDegradationDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildSummary(display.SummaryMetrics) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildGaugeAndPrediction(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildTrendChart(display.Trend) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildRangeChart(display.Range) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildRiskFactors(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 270, Content = BuildRecommendations(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildChargingImpact(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildFactors(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildHistory(display) });
        return stack;
    }

    // ── Summary metrics (Current SOH / Estimated Capacity / Degradation Rate / Battery Age) ──────────────
    private static Grid BuildSummary(IReadOnlyList<BatteryMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsStatCard { Label = metric.Label, Value = metric.Value, Glyph = metric.Glyph };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return ColumnsGrid(4, 16, cards);
    }

    // ── Health gauge + Prediction (two columns) ──────────────────────────────────────────────────────────
    private static Grid BuildGaugeAndPrediction(BatteryDegradationDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var gauge = BuildGaugePanel(display);
        Grid.SetColumn(gauge, 0);
        grid.Children.Add(gauge);

        var prediction = BuildPredictionPanel(display);
        Grid.SetColumn(prediction, 1);
        grid.Children.Add(prediction);

        return grid;
    }

    private static TsGlassPanel BuildGaugePanel(BatteryDegradationDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(new TsRadialGauge
        {
            Value = display.GaugeValue,
            Max = display.GaugeMax,
            Label = display.GaugeLabel,
            Unit = display.GaugeUnit,
            ColorIndex = display.GaugeColorIndex,
            Diameter = 180,
        });

        var badge = new TsBadge
        {
            Status = display.HealthBadgeStatus,
            Content = new TextBlock { Text = display.HealthBadgeText },
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.HealthBadgeText);
        column.Children.Add(badge);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildPredictionPanel(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryDegradationProjection.TrendingDownGlyph, display.PredictionTitle));

        if (display.HasEnoughData)
        {
            column.Children.Add(BuildPredictionSummary(display));
            column.Children.Add(ColumnsGrid(2, 16, BuildMetricCards(display.PredictionMetrics)));
        }
        else
        {
            column.Children.Add(BuildNeedMore(display.NeedMoreMessage));
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Border BuildPredictionSummary(BatteryDegradationDisplay display)
    {
        var text = new TextBlock { TextWrapping = TextWrapping.Wrap, Foreground = DisplayTokens.TextSecondary };
        text.Inlines.Add(new Run { Text = display.PredictionLeadText + " " });
        text.Inlines.Add(new Run { Text = display.PredictionThresholdText, FontWeight = FontWeights.Bold });
        text.Inlines.Add(new Run { Text = " " + display.PredictionInApproxText + " " });
        text.Inlines.Add(new Run { Text = display.PredictionYearsText, FontWeight = FontWeights.Bold });
        if (!string.IsNullOrEmpty(display.PredictionDateText))
        {
            text.Inlines.Add(new Run { Text = " " + display.PredictionDateText });
        }

        return new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            Background = DisplayTokens.Brush("TsColorInfoBrush") is { } b ? Fade(b) : DisplayTokens.Border,
            Child = text,
        };
    }

    private static Border BuildNeedMore(string message)
    {
        var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new FontIcon
        {
            Glyph = BatteryDegradationProjection.WarningGlyph,
            FontSize = 28,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Text
        {
            Value = message,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        var border = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(12),
            Child = column,
        };
        AutomationProperties.SetName(border, message);
        return border;
    }

    private static List<FrameworkElement> BuildMetricCards(IReadOnlyList<BatteryMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard
            {
                Label = metric.Label,
                Value = metric.Value,
                AccentBrushKey = metric.AccentBrushKey,
            };
            AutomationProperties.SetName(card, metric.AutomationName);
            cards.Add(card);
        }

        return cards;
    }

    // ── Health Trend & Projection (composed chart) ───────────────────────────────────────────────────────
    private static TsChartContainer BuildTrendChart(TrendChartDisplay trend)
    {
        var chart = new TsComposedChart
        {
            Title = trend.Title,
            Series = BuildSeries(trend.Series),
            Annotations =
            [
                new ChartAnnotation("warranty", ChartAnnotationKind.HorizontalLine, trend.WarrantyValue)
                {
                    Label = trend.WarrantyLabel,
                    Role = ChartRole.Temperature,
                },
                new ChartAnnotation("eol", ChartAnnotationKind.HorizontalLine, trend.EndOfLifeValue),
            ],
            ShowLegend = true,
            IncludeZero = false,
            MinHeight = 300,
        };

        return new TsChartContainer
        {
            Title = trend.Title,
            AccessibleSummary = trend.AriaLabel,
            State = trend.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = trend.AriaLabel,
        };
    }

    // ── Range Loss (area chart) ──────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRangeChart(RangeChartDisplay range)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = range.Title });

        if (range.HasData)
        {
            column.Children.Add(new TsAreaChart
            {
                Title = range.Title,
                Series = BuildSeries(range.Series),
                ShowLegend = true,
                IncludeZero = false,
                MinHeight = 260,
            });
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryDegradationProjection.BatteryGlyph,
                Message = range.EmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Risk Factors (scored cards) ──────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRiskFactors(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryDegradationProjection.ShieldGlyph, display.RiskTitle));

        if (display.RiskFactors.Count > 0)
        {
            var cards = new List<FrameworkElement>(display.RiskFactors.Count);
            foreach (var risk in display.RiskFactors)
            {
                cards.Add(BuildRiskCard(risk));
            }

            column.Children.Add(ColumnsGrid(3, 16, cards));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryDegradationProjection.ShieldGlyph,
                Message = display.RiskEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildRiskCard(RiskFactorDisplay risk)
    {
        var column = new StackPanel { Spacing = 8 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        labelRow.Children.Add(new FontIcon
        {
            Glyph = risk.Glyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(risk.BarStatus)) ?? DisplayTokens.TextMuted,
        });
        labelRow.Children.Add(new TextBlock { Text = risk.Label, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(labelRow, 0);
        header.Children.Add(labelRow);

        var badge = new TsBadge { Status = risk.BadgeStatus, Content = new TextBlock { Text = risk.BadgeText } };
        AutomationProperties.SetName(badge, risk.BadgeText);
        Grid.SetColumn(badge, 1);
        header.Children.Add(badge);
        column.Children.Add(header);

        var barRow = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        barRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var bar = BuildScoreBar(risk.ScoreFraction, risk.BarStatus);
        Grid.SetColumn(bar, 0);
        barRow.Children.Add(bar);

        var score = new TextBlock
        {
            Text = risk.ScoreText,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(risk.BarStatus)) ?? DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(score, 1);
        barRow.Children.Add(score);
        column.Children.Add(barRow);

        column.Children.Add(new Caption { Value = risk.Detail });

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, risk.AutomationName);
        return panel;
    }

    private static Grid BuildScoreBar(double fraction, StatusKind status)
    {
        double clamped = Math.Clamp(fraction, 0, 1);
        var grid = new Grid { Height = 8, VerticalAlignment = VerticalAlignment.Center };

        var track = new Border
        {
            Background = DisplayTokens.Border,
            CornerRadius = new CornerRadius(999),
        };
        grid.Children.Add(track);

        var fillHost = new Grid();
        fillHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(clamped, GridUnitType.Star) });
        fillHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - clamped, GridUnitType.Star) });

        var fill = new Border
        {
            Background = DisplayTokens.Brush(StatusResources.AccentBrushKey(status)) ?? DisplayTokens.Accent,
            CornerRadius = new CornerRadius(999),
        };
        Grid.SetColumn(fill, 0);
        fillHost.Children.Add(fill);
        grid.Children.Add(fillHost);

        AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Raw);
        return grid;
    }

    // ── Recommendations ──────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecommendations(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(TitleRow(BatteryDegradationProjection.WarningGlyph, display.RecommendationsTitle));

        if (display.Recommendations.Count > 0)
        {
            foreach (var recommendation in display.Recommendations)
            {
                column.Children.Add(BuildRecommendationRow(recommendation));
            }
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryDegradationProjection.WarningGlyph,
                Message = display.RecommendationsEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Border BuildRecommendationRow(string recommendation)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(new FontIcon
        {
            Glyph = BatteryDegradationProjection.LightningGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new Text { Value = recommendation });

        var border = new Border { Padding = new Thickness(12), CornerRadius = new CornerRadius(12), Child = row };
        AutomationProperties.SetName(border, recommendation);
        return border;
    }

    // ── Charging Habits Impact ───────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildChargingImpact(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryDegradationProjection.LightningGlyph, display.ChargingImpactTitle));
        column.Children.Add(new TsAlertBanner
        {
            Variant = ToCalloutVariant(display.ImpactVariant),
            Title = display.ImpactBannerTitle,
            Message = display.ImpactBannerBody,
            IsOpen = true,
            Dismissible = false,
        });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Battery Health Factors (three cards) ─────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildFactors(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(TitleRow(BatteryDegradationProjection.ShieldGlyph, display.FactorsTitle));

        var cards = new List<FrameworkElement>(display.FactorCards.Count);
        foreach (var card in display.FactorCards)
        {
            cards.Add(BuildFactorCard(card));
        }

        column.Children.Add(ColumnsGrid(3, 16, cards));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildFactorCard(BatteryFactorCard card)
    {
        var column = new StackPanel { Spacing = 8 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock { Text = card.Title, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        var badge = new TsBadge { Status = card.ScoreStatus, Content = new TextBlock { Text = card.ScoreText } };
        AutomationProperties.SetName(badge, $"{card.Title}, {card.ScoreText}");
        Grid.SetColumn(badge, 1);
        header.Children.Add(badge);
        column.Children.Add(header);

        foreach (var row in card.Rows)
        {
            column.Children.Add(BuildFactorRow(row));
        }

        if (!string.IsNullOrEmpty(card.FooterText))
        {
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            footer.Children.Add(new FontIcon
            {
                Glyph = BatteryDegradationProjection.ThermometerGlyph,
                FontSize = 12,
                Foreground = DisplayTokens.TextMuted,
                VerticalAlignment = VerticalAlignment.Center,
            });
            footer.Children.Add(new Caption { Value = card.FooterText });
            column.Children.Add(footer);
        }

        return new TsGlassPanel { Padding = new Thickness(16), Content = column };
    }

    private static Grid BuildFactorRow(BatteryFactorRow row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new Caption { Value = row.Label };
        Grid.SetColumn(label, 0);
        grid.Children.Add(label);

        var value = new TextBlock
        {
            Text = row.Value,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
        };
        Grid.SetColumn(value, 1);
        grid.Children.Add(value);
        return grid;
    }

    // ── Degradation History (data table) ─────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHistory(BatteryDegradationDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.HistoryTitle });

        if (display.HistoryRows.Count > 0)
        {
            var table = new TsDataTable { Selectable = false, EmptyMessage = display.HistoryEmptyMessage };
            var columns = new List<TsDataColumn>(display.HistoryColumns.Count);
            foreach (var col in display.HistoryColumns)
            {
                columns.Add(new TsDataColumn { Key = col.Key, Header = col.Header, IsNumeric = col.IsNumeric });
            }

            table.Columns = columns;

            var rows = new List<TsDataRow>(display.HistoryRows.Count);
            foreach (var row in display.HistoryRows)
            {
                rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
                {
                    ["date"] = row.Date,
                    ["odometer"] = row.Odometer,
                    ["soh"] = row.Soh,
                    ["capacity"] = row.Capacity,
                    ["range"] = row.Range,
                }));
            }

            table.Rows = rows;
            AutomationProperties.SetName(table, display.HistoryTitle);
            column.Children.Add(table);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = BatteryDegradationProjection.ActivityGlyph,
                Message = display.HistoryEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<BatterySeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = s.Kind == BatterySeriesKind.Area ? ChartSeriesKind.Area : ChartSeriesKind.Line,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
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

    private static CalloutVariant ToCalloutVariant(CalloutVariantKind kind) => kind switch
    {
        CalloutVariantKind.Success => CalloutVariant.Success,
        CalloutVariantKind.Warning => CalloutVariant.Warning,
        _ => CalloutVariant.Danger,
    };

    private static Microsoft.UI.Xaml.Media.Brush Fade(Microsoft.UI.Xaml.Media.Brush brush)
    {
        // A faint tinted fill behind the prediction summary (web bg-neon-purple/[0.08]); keep the source brush
        // intact by cloning a low-opacity copy when it is a solid colour, otherwise fall back to the token brush.
        if (brush is Microsoft.UI.Xaml.Media.SolidColorBrush solid)
        {
            return new Microsoft.UI.Xaml.Media.SolidColorBrush(solid.Color) { Opacity = 0.12 };
        }

        return brush;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    protected override AutomationPeer OnCreateAutomationPeer() => new BatteryDegradationPageAutomationPeer(this);

    private sealed class BatteryDegradationPageAutomationPeer(BatteryDegradationPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
