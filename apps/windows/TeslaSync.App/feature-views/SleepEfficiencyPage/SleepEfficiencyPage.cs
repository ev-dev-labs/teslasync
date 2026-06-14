using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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
/// The native WinUI 3 <c>SleepEfficiencyPage</c> — a parity port of the web page
/// <c>web/src/features/battery/pages/SleepEfficiencyPage.tsx</c> (route <c>/sleep-efficiency</c>, nav name
/// <c>SleepEfficiency</c>). It binds to a <see cref="SleepEfficiencyPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip),
/// the loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the four key-metric cards (Sleep-Efficiency, Avg-Time-to-Sleep, Sentry-Drain-Rate, Sentry-Monthly-Cost), the
/// State-Distribution donut with its per-state legend, the Sentry-vs-No-Sentry comparison bar chart, the
/// monthly-sentry-impact callout ("GlassPanel7") and the recent-drain-events table ("GlassPanel8"). The view is
/// a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="SleepEfficiencyDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SleepEfficiencyPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double DonutSize = 220;
    private const double DonutInnerRadiusRatio = 0.6;
    private const double LegendDotSize = 10;
    private const double ComparisonChartHeight = 224;

    private readonly SleepEfficiencyPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = SleepEfficiencyRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SleepEfficiencyPage()
        : this(EmptySleepEfficiencyFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source sleep data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SleepEfficiencyPage(ISleepEfficiencyFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SleepEfficiencyPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SleepEfficiencyPage</c>).</summary>
    public static string Slug => SleepEfficiencyRegistration.Slug;

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
        _loadingSkeleton.Children.Add(ColumnsGrid(2, 24, BuildSkeletonBlocks(2, 264)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
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

    private void Render(SleepEfficiencyDisplay display)
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
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(SleepEfficiencyDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildMetricCards(display.MetricCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildChartsRow(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildRecentEvents(display) });
        return stack;
    }

    // ── Key metric cards (Sleep-Efficiency / Avg-Time-to-Sleep / Sentry-Drain-Rate / Sentry-Monthly-Cost) ──
    private static Grid BuildMetricCards(IReadOnlyList<SleepMetricCardDisplay> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsStatCard { Label = card.Label, Value = card.Value, Glyph = card.Glyph };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(4, 16, tiles);
    }

    // ── State-Distribution donut (left) + Sentry comparison bar + impact callout (right) ──────────────────
    private static Grid BuildChartsRow(SleepEfficiencyDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var donut = BuildDonutPanel(display.Donut);
        Grid.SetColumn(donut, 0);
        grid.Children.Add(donut);

        var right = new StackPanel { Spacing = 16 };
        right.Children.Add(BuildComparisonPanel(display.Comparison));
        right.Children.Add(BuildImpactCallout(display));
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        return grid;
    }

    // ── State-Distribution: ChartContainer wrapping the donut + a per-state legend ────────────────────────
    private static TsChartContainer BuildDonutPanel(SleepDonutDisplay donut)
    {
        var body = new StackPanel { Spacing = 12 };

        var pie = new TsPieChart
        {
            Values = donut.Points,
            InnerRadiusRatio = DonutInnerRadiusRatio,
            Width = DonutSize,
            Height = DonutSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(pie, donut.AriaLabel);
        body.Children.Add(pie);
        body.Children.Add(BuildDonutLegend(donut.Slices));

        return new TsChartContainer
        {
            Title = donut.Title,
            AccessibleSummary = donut.AriaLabel,
            State = donut.HasData ? ChartState.Ready : ChartState.Empty,
            Body = body,
            EmptyMessage = donut.EmptyMessage,
        };
    }

    private static StackPanel BuildDonutLegend(IReadOnlyList<SleepStateSliceDisplay> slices)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var slice in slices)
        {
            var item = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var dot = new Ellipse
            {
                Width = LegendDotSize,
                Height = LegendDotSize,
                Fill = ChartBrushes.ForIndex(slice.ColorIndex),
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
            item.Children.Add(dot);

            item.Children.Add(new TextBlock
            {
                Text = slice.Name,
                Foreground = DisplayTokens.TextSecondary,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
            });
            item.Children.Add(new TextBlock
            {
                Text = slice.HoursText,
                Foreground = DisplayTokens.TextMuted,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
            });

            AutomationProperties.SetName(item, $"{slice.Name} {slice.HoursText}");
            legend.Children.Add(item);
        }

        return legend;
    }

    // ── Sentry-vs-No-Sentry: ChartContainer wrapping the grouped comparison bar chart ─────────────────────
    private static TsChartContainer BuildComparisonPanel(SleepComparisonDisplay comparison)
    {
        var chart = new TsBarChart
        {
            Series = BuildComparisonSeries(comparison.Series),
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = ComparisonChartHeight,
        };
        AutomationProperties.SetName(chart, comparison.AriaLabel);

        return new TsChartContainer
        {
            Title = comparison.Title,
            AccessibleSummary = comparison.AriaLabel,
            State = comparison.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = comparison.EmptyMessage,
        };
    }

    private static List<ChartSeries> BuildComparisonSeries(IReadOnlyList<SleepComparisonSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
    }

    // ── Monthly Sentry Mode Impact callout (GlassPanel7) — Eye header + three amber/rose stats ────────────
    private static TsGlassPanel BuildImpactCallout(SleepEfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = SleepEfficiencyProjection.EyeGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new PanelTitle { Value = display.ImpactTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        var statsGrid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < display.ImpactStats.Count; i++)
        {
            statsGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < display.ImpactStats.Count; i++)
        {
            var stat = display.ImpactStats[i];
            // Web parity: the first two figures are amber (warning), the cost is rose (danger).
            StatusKind tone = i == display.ImpactStats.Count - 1 ? StatusKind.Danger : StatusKind.Warning;
            var cell = BuildImpactStat(stat, tone);
            Grid.SetColumn(cell, i);
            statsGrid.Children.Add(cell);
        }

        column.Children.Add(statsGrid);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, display.ImpactTitle);
        return panel;
    }

    private static StackPanel BuildImpactStat(SleepImpactStatDisplay stat, StatusKind tone)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(tone)),
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new Caption { Value = stat.Label, HorizontalAlignment = HorizontalAlignment.Center });
        AutomationProperties.SetName(column, $"{stat.Label}: {stat.Value}");
        return column;
    }

    // ── Recent Drain Events table (GlassPanel8) ───────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRecentEvents(SleepEfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var icon = new FontIcon
        {
            Glyph = SleepEfficiencyProjection.ZapGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        titleRow.Children.Add(icon);
        titleRow.Children.Add(new SectionTitle { Value = display.RecentTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        if (display.TableRows.Count > 0)
        {
            column.Children.Add(BuildDrainTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = SleepEfficiencyProjection.MoonGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsDataTable BuildDrainTable(SleepEfficiencyDisplay display)
    {
        var table = new TsDataTable { Selectable = false, EmptyMessage = display.TableEmptyMessage };
        table.Columns =
        [
            new TsDataColumn { Key = "date", Header = display.TableColumns[0], IsNumeric = false },
            new TsDataColumn { Key = "duration", Header = display.TableColumns[1], IsNumeric = true },
            new TsDataColumn { Key = "batteryLost", Header = display.TableColumns[2], IsNumeric = true },
            new TsDataColumn { Key = "drainRate", Header = display.TableColumns[3], IsNumeric = true },
            new TsDataColumn { Key = "sentry", Header = display.TableColumns[4], IsNumeric = false },
            new TsDataColumn { Key = "temp", Header = display.TableColumns[5], IsNumeric = true },
        ];

        var rows = new List<TsDataRow>(display.TableRows.Count);
        foreach (var row in display.TableRows)
        {
            rows.Add(new TsDataRow(row.Id, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["date"] = row.Date,
                ["duration"] = row.Duration,
                ["batteryLost"] = row.BatteryLost,
                ["drainRate"] = row.DrainRate,
                ["sentry"] = row.Sentry,
                ["temp"] = row.Temp,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.RecentTitle);
        return table;
    }

    // ── Shared primitives ─────────────────────────────────────────────────────────────────────────────────
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

    protected override AutomationPeer OnCreateAutomationPeer() => new SleepEfficiencyPageAutomationPeer(this);

    private sealed class SleepEfficiencyPageAutomationPeer(SleepEfficiencyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
