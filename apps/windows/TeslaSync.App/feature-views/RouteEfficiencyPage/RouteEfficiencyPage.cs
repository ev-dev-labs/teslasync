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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>RouteEfficiencyPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/RouteEfficiencyPage.tsx</c> (route <c>/route-efficiency</c>, nav name
/// <c>RouteEfficiency</c>). It binds to a <see cref="RouteEfficiencyPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the four hero
/// summary tiles ("GlassPanel1"), the per-route comparison cards ("GlassPanel2"), the Route-Efficiency-Comparison
/// bar chart ("Route-Efficiency-Comparison" / <c>ChartContainer</c> + <c>BarChart</c>) and the route-metrics strip
/// with its four metric bars ("GlassPanel4"). The view is a thin renderer: all branch selection, SI conversion,
/// formatting and i18n happen in the view-model's <see cref="RouteEfficiencyDisplay"/> projection. State changes
/// are marshalled onto the UI thread.
/// </summary>
public sealed partial class RouteEfficiencyPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const string MapPinGlyph = "\uE707";       // map pin (web MapPin)
    private const string TrendingGlyph = "\uE9D2";     // activity / trending (web TrendingUp)

    private readonly RouteEfficiencyPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = RouteEfficiencyRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public RouteEfficiencyPage()
        : this(EmptyRouteEfficiencyFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The route-efficiency data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public RouteEfficiencyPage(IRouteEfficiencyFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new RouteEfficiencyPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>RouteEfficiencyPage</c>).</summary>
    public static string Slug => RouteEfficiencyRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 120 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 260 });
        _loadingSkeleton.Children.Add(ColumnsGrid(2, 16, BuildSkeletonBlocks(4, 120)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 160 });
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

    private void Render(RouteEfficiencyDisplay display)
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

    private static StackPanel BuildContent(RouteEfficiencyDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildSummary(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 80, Content = BuildComparisonChart(display.Comparison) });
        stack.Children.Add(new TsFadeIn { DelayMs = 160, Content = BuildRouteCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 240, Content = BuildMetricsStrip(display) });
        return stack;
    }

    // ── Hero summary tiles (GlassPanel1) ────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildSummary(RouteEfficiencyDisplay display)
    {
        var tiles = new List<FrameworkElement>(display.SummaryStats.Count);
        foreach (var stat in display.SummaryStats)
        {
            var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(new TsAnimatedNumber
            {
                Value = stat.Value,
                Precision = 0,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            column.Children.Add(new Caption { Value = stat.Label, HorizontalAlignment = HorizontalAlignment.Center });
            AutomationProperties.SetName(column, stat.AutomationName);
            tiles.Add(column);
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = ColumnsGrid(4, 16, tiles) };
    }

    // ── Route-Efficiency-Comparison (ChartContainer + BarChart) ─────────────────────────────────────────
    private static TsChartContainer BuildComparisonChart(RouteComparisonChartDisplay comparison)
    {
        var chart = new TsBarChart
        {
            Title = comparison.Title,
            Series = BuildSeries(comparison.Series),
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = 260,
        };

        var container = new TsChartContainer
        {
            Title = comparison.Title,
            AccessibleSummary = comparison.AriaLabel,
            State = comparison.Visible ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = comparison.AriaLabel,
        };

        AutomationProperties.SetName(container, comparison.AriaLabel);
        return container;
    }

    // ── Per-route comparison cards (GlassPanel2) ────────────────────────────────────────────────────────
    private static StackPanel BuildRouteCards(RouteEfficiencyDisplay display)
    {
        var cards = new List<FrameworkElement>(display.RouteCards.Count);
        foreach (var card in display.RouteCards)
        {
            cards.Add(BuildRouteCard(card, display.EfficiencyUnit));
        }

        var host = new StackPanel { Spacing = SectionSpacing };
        if (cards.Count > 0)
        {
            host.Children.Add(ColumnsGrid(2, 16, cards));
        }

        return host;
    }

    private static TsGlassPanel BuildRouteCard(RouteCardDisplay card, string unit)
    {
        var column = new StackPanel { Spacing = 12 };

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var pin = new FontIcon { Glyph = MapPinGlyph, FontSize = 16, Foreground = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(pin, AccessibilityView.Raw);
        identity.Children.Add(pin);
        identity.Children.Add(new Text { Value = card.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(identity, 0);
        headerRow.Children.Add(identity);

        var badge = new TsBadge { Status = card.BadgeStatus, Content = card.BadgeText, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(badge, 1);
        headerRow.Children.Add(badge);
        column.Children.Add(headerRow);

        column.Children.Add(new Caption { Value = card.Meta });

        column.Children.Add(new TsMetricBar
        {
            Label = card.AvgLabel,
            Value = card.BarValue,
            Max = card.BarMax,
            AccentBrushKey = card.BarAccentBrushKey,
        });

        var stats = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        for (int i = 0; i < 3; i++)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Grid.SetColumn(BuildStatPair(stats, card.BestLabel, $"{card.BestText} {unit}"), 0);
        Grid.SetColumn(BuildStatPair(stats, card.AvgLabel, $"{card.AvgText} {unit}"), 1);
        Grid.SetColumn(BuildStatPair(stats, card.WorstLabel, $"{card.WorstText} {unit}"), 2);
        column.Children.Add(stats);

        var panel = new TsGlassPanel { Padding = new Thickness(20), Content = column };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    private static StackPanel BuildStatPair(Grid host, string label, string value)
    {
        var pair = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };
        pair.Children.Add(new Caption { Value = label, HorizontalAlignment = HorizontalAlignment.Center });
        pair.Children.Add(new Text { Value = value, HorizontalAlignment = HorizontalAlignment.Center });
        host.Children.Add(pair);
        return pair;
    }

    // ── Route-metrics strip (GlassPanel4) ───────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildMetricsStrip(RouteEfficiencyDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = TrendingGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = display.MetricsTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        if (display.MetricBars.Count > 0)
        {
            var bars = new List<FrameworkElement>(display.MetricBars.Count);
            foreach (var bar in display.MetricBars)
            {
                bars.Add(BuildMetricBar(bar));
            }

            column.Children.Add(ColumnsGrid(4, 16, bars));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = RouteEfficiencyRegistration.EmptyGlyph,
                Message = display.MetricsEmptyMessage,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static StackPanel BuildMetricBar(RouteMetricBarDisplay bar)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new TsMetricBar
        {
            Label = bar.Label,
            Value = bar.Value,
            Max = bar.Max,
            AccentBrushKey = bar.AccentBrushKey,
        });
        column.Children.Add(new Caption { Value = bar.ValueText });
        AutomationProperties.SetName(column, $"{bar.Label}: {bar.ValueText}");
        return column;
    }

    // ── Shared primitives ───────────────────────────────────────────────────────────────────────────────
    private static List<ChartSeries> BuildSeries(IReadOnlyList<RouteSeriesDisplay> series)
    {
        var built = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            if (s.Points.Count == 0)
            {
                continue;
            }

            built.Add(new ChartSeries(s.Name, s.Points)
            {
                Kind = s.Kind,
                ColorIndex = s.ColorIndex,
            });
        }

        return built;
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

    protected override AutomationPeer OnCreateAutomationPeer() => new RouteEfficiencyPageAutomationPeer(this);

    private sealed class RouteEfficiencyPageAutomationPeer(RouteEfficiencyPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
