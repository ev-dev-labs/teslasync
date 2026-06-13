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

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The native WinUI 3 <c>TemperatureImpactPage</c> — a parity port of the web page
/// <c>web/src/features/maps/pages/TemperatureImpactPage.tsx</c> (route <c>/temperature-impact</c>, nav name
/// <c>TemperatureImpact</c>). It binds to a <see cref="TemperatureImpactPageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the page header (title + subtitle + data-freshness chip),
/// the loading shimmer, the retriable error surface, the page-level empty surface, and — in the success state —
/// the four summary metric cards ("Avg-Efficiency".."Total-Data-Points"), the temperature-versus-efficiency
/// scatter with its average reference line ("GlassPanel5"), the efficiency-by-temperature-range line chart
/// ("GlassPanel6"), the optimal-temperature analysis ("GlassPanel7") and the recommendations strip
/// ("GlassPanel8"). The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="TemperatureImpactDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class TemperatureImpactPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double ScatterHeight = 288;
    private const double LineHeight = 256;

    private readonly TemperatureImpactPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = TemperatureImpactRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public TemperatureImpactPage()
        : this(EmptyTemperatureImpactFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The single-source temperature-impact data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TemperatureImpactPage(ITemperatureImpactFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TemperatureImpactPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>TemperatureImpactPage</c>).</summary>
    public static string Slug => TemperatureImpactRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ScatterHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = LineHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 140 });
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

    private void Render(TemperatureImpactDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorTitle;
        _errorState.Message = display.ErrorDetail;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, $"{display.ErrorTitle}. {display.ErrorDetail}");

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);
        _contentHost.Content = display.ShowContent ? BuildContent(display) : null;
    }

    private static StackPanel BuildContent(TemperatureImpactDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildStatCards(display.StatCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildScatterPanel(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildLinePanel(display) });
        if (display.HasOptimal)
        {
            stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildOptimalPanel(display) });
        }

        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildTipsPanel(display) });
        return stack;
    }

    // ── Summary metric cards (Avg-Efficiency / Best-Temp-Range / Worst-Temp-Range / Total-Data-Points) ────
    private static Grid BuildStatCards(IReadOnlyList<TempStatCardDisplay> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsMetricCard
            {
                Label = card.Label,
                Value = card.Value,
                AccentBrushKey = card.AccentBrushKey,
                DeltaText = card.Subtitle,
            };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(4, 16, tiles);
    }

    // ── Temperature vs Efficiency scatter (GlassPanel5 + ScatterChart) ───────────────────────────────────
    private static TsGlassPanel BuildScatterPanel(TemperatureImpactDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.ScatterTitle });

        var chart = new TsScatterChart
        {
            Title = $"{display.ScatterTitle}. {display.ScatterXAxisLabel}, {display.ScatterYAxisLabel}",
            Series = [new ChartSeries(display.ScatterSeriesName, display.ScatterPoints) { Role = ChartRole.Temperature }],
            ShowLegend = false,
            IncludeZero = false,
            MinHeight = ScatterHeight,
        };

        if (display.HasAverageLine)
        {
            chart.Annotations =
            [
                new ChartAnnotation("avg-eff", ChartAnnotationKind.HorizontalLine, display.AverageLine)
                {
                    Label = display.AverageLineLabel,
                },
            ];
        }

        column.Children.Add(chart);
        return Panel(column);
    }

    // ── Efficiency by Temperature Range line chart (GlassPanel6 + LineChart) ─────────────────────────────
    private static TsGlassPanel BuildLinePanel(TemperatureImpactDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new SectionTitle { Value = display.BucketTitle });

        var points = new List<ChartPoint>(display.Buckets.Count);
        for (int i = 0; i < display.Buckets.Count; i++)
        {
            var bucket = display.Buckets[i];
            points.Add(new ChartPoint(i, bucket.Avg, bucket.Label));
        }

        var chart = new TsLineChart
        {
            Title = $"{display.BucketTitle}. {display.BucketYAxisLabel}",
            Series = [new ChartSeries(display.BucketSeriesName, points) { Role = ChartRole.Temperature }],
            ShowLegend = true,
            IncludeZero = true,
            MinHeight = LineHeight,
        };

        column.Children.Add(chart);
        return Panel(column);
    }

    // ── Optimal Temperature Analysis (GlassPanel7) ───────────────────────────────────────────────────────
    private static TsGlassPanel BuildOptimalPanel(TemperatureImpactDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var icon = new FontIcon
        {
            Glyph = TemperatureImpactProjection.ThermometerGlyph,
            FontSize = 28,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(new SectionTitle { Value = display.OptimalTitle });
        column.Children.Add(new Text { Value = display.OptimalDesc });
        if (!string.IsNullOrEmpty(display.OptimalDelta))
        {
            column.Children.Add(new Caption { Value = display.OptimalDelta });
        }

        if (display.OptimalBadges.Count > 0)
        {
            column.Children.Add(BuildBadgeRow(display.OptimalBadges));
        }

        Grid.SetColumn(column, 1);
        grid.Children.Add(column);

        var panel = new TsGlassPanel { Glow = GlassGlow.Green, Padding = new Thickness(PanelPadding), Content = grid };
        AutomationProperties.SetName(panel, $"{display.OptimalTitle}. {display.OptimalDesc}");
        return panel;
    }

    private static StackPanel BuildBadgeRow(IReadOnlyList<TempBadgeDisplay> badges)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        foreach (var badge in badges)
        {
            var chip = new TsBadge { Status = badge.Variant, Content = badge.Text };
            AutomationProperties.SetName(chip, badge.Text);
            row.Children.Add(chip);
        }

        return row;
    }

    // ── Recommendations (GlassPanel8) ────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildTipsPanel(TemperatureImpactDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = TemperatureImpactProjection.LightbulbGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new SectionTitle { Value = display.TipsTitle, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        if (display.Tips.Count > 0)
        {
            var list = new StackPanel { Spacing = 8 };
            foreach (var tip in display.Tips)
            {
                list.Children.Add(BuildTipRow(tip));
            }

            column.Children.Add(list);
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = TemperatureImpactProjection.ActivityGlyph,
                Message = display.TipsEmptyMessage,
            });
        }

        return Panel(column);
    }

    private static StackPanel BuildTipRow(TempTipDisplay tip)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Top };
        row.Children.Add(new FontIcon
        {
            Glyph = tip.Glyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        });

        var badge = new TsBadge { Status = tip.Variant, Dot = true, Content = tip.Text };
        AutomationProperties.SetName(badge, tip.Text);
        row.Children.Add(badge);
        return row;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
    private static TsGlassPanel Panel(UIElement content) =>
        new() { Padding = new Thickness(PanelPadding), Content = content };

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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TemperatureImpactPageAutomationPeer(this);

    private sealed class TemperatureImpactPageAutomationPeer(TemperatureImpactPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
