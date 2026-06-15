using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>SpeedProfilePage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/SpeedProfilePage.tsx</c> (route <c>/speed-profile</c>, nav name
/// <c>SpeedProfile</c>). It binds to a <see cref="SpeedProfilePageViewModel"/> and renders every web region with
/// Fluent components and design tokens: the page header (title + subtitle + data-freshness chip), the loading
/// shimmer, the retriable error surface, the page-level empty surface, and — in the success state — the hero
/// speed gauges ("GlassPanel1"), the speed-distribution bar chart ("Speed-Distribution"), the per-bucket detail
/// cards grid ("GlassPanel3"), the efficiency-vs-speed scatter with its colour legend ("Efficiency-vs-Speed")
/// and the efficiency-insight callout ("GlassPanel5"). The view is a thin renderer: all branch selection,
/// formatting and i18n happen in the view-model's <see cref="SpeedProfileDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class SpeedProfilePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double GaugeDiameter = 150;

    private readonly SpeedProfilePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = SpeedProfileRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SpeedProfilePage()
        : this(EmptySpeedProfileFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The two-source speed-profile data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SpeedProfilePage(ISpeedProfileFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SpeedProfilePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SpeedProfilePage</c>).</summary>
    public static string Slug => SpeedProfileRegistration.Slug;

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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 200 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
        _loadingSkeleton.Children.Add(ColumnsGrid(5, 12, BuildSkeletonBlocks(5, 120)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 240 });
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

    private void Render(SpeedProfileDisplay display)
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

    private static StackPanel BuildContent(SpeedProfileDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildHeroGauges(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildDistributionChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildBucketCards(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildScatterChart(display) });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildInsightPanel(display) });
        return stack;
    }

    // ── Hero speed gauges (GlassPanel1) ──────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildHeroGauges(SpeedProfileDisplay display)
    {
        var gauges = new List<FrameworkElement>(display.Gauges.Count);
        foreach (var gauge in display.Gauges)
        {
            var control = new TsRadialGauge
            {
                Value = gauge.Value,
                Max = gauge.Max,
                Label = gauge.Label,
                Unit = gauge.Unit,
                Role = gauge.Role,
                Decimals = 0,
                Diameter = GaugeDiameter,
            };
            AutomationProperties.SetName(control, $"{gauge.Label} {gauge.Value} {gauge.Unit}");
            gauges.Add(control);
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = ColumnsGrid(3, 16, gauges) };
        AutomationProperties.SetName(panel, display.Gauges.Count > 0 ? display.Gauges[0].Label : display.Title);
        return panel;
    }

    // ── Speed-distribution bar chart (Speed-Distribution) ────────────────────────────────────────────────
    private static TsChartContainer BuildDistributionChart(SpeedProfileDisplay display)
    {
        var chart = new TsBarChart
        {
            Title = display.Distribution.Title,
            Series = display.Distribution.Series,
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = 260,
        };

        return new TsChartContainer
        {
            Title = display.Distribution.Title,
            AccessibleSummary = display.Distribution.AriaLabel,
            State = display.Distribution.HasData ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = display.EmptyMessage,
        };
    }

    // ── Speed-bucket detail cards (GlassPanel3) ──────────────────────────────────────────────────────────
    private static FrameworkElement BuildBucketCards(SpeedProfileDisplay display)
    {
        if (display.BucketCards.Count == 0)
        {
            return new TsGlassPanel
            {
                Padding = new Thickness(PanelPadding),
                Content = new TsEmptyState
                {
                    IconGlyph = SpeedProfileRegistration.EmptyGlyph,
                    Message = display.EmptyMessage,
                },
            };
        }

        var cards = new List<FrameworkElement>(display.BucketCards.Count);
        foreach (var card in display.BucketCards)
        {
            cards.Add(BuildBucketCard(card));
        }

        return ColumnsGrid(5, 12, cards);
    }

    private static TsGlassPanel BuildBucketCard(SpeedBucketCardDisplay card)
    {
        var column = new StackPanel { Spacing = 8 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon
        {
            Glyph = card.Glyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(new PanelTitle { Value = card.Range, VerticalAlignment = VerticalAlignment.Center });
        column.Children.Add(titleRow);

        column.Children.Add(DetailRow(card.TimeShareLabel, card.TimeShareText, DisplayTokens.Brush(card.TimeShareBrushKey)));
        column.Children.Add(DetailRow(card.DrivesLabel, card.DrivesText, DisplayTokens.Accent));

        if (card.HasEfficiency)
        {
            column.Children.Add(DetailRow(card.AvgSpeedLabel, card.AvgSpeedText, DisplayTokens.TextSecondary));
            column.Children.Add(DetailRow(card.EfficiencyLabel, card.EfficiencyText, DisplayTokens.Brush(card.EfficiencyBrushKey)));
        }

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        AutomationProperties.SetName(panel, card.AutomationName);
        return panel;
    }

    private static Grid DetailRow(string label, string value, Brush valueBrush)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var key = new Caption { Value = label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(key, 0);
        grid.Children.Add(key);

        var val = new Text { Value = value, Foreground = valueBrush, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(val, 1);
        grid.Children.Add(val);

        return grid;
    }

    // ── Efficiency-vs-speed scatter + colour legend (Efficiency-vs-Speed) ────────────────────────────────
    private static StackPanel BuildScatterChart(SpeedProfileDisplay display)
    {
        var chart = new TsScatterChart
        {
            Title = display.Scatter.Title,
            Series = display.Scatter.Series,
            ShowLegend = false,
            IncludeZero = true,
            MinHeight = 240,
        };

        var container = new TsChartContainer
        {
            Title = display.Scatter.Title,
            Subtitle = display.Scatter.Subtitle,
            AccessibleSummary = display.Scatter.AriaLabel,
            State = display.Scatter.Visible ? ChartState.Ready : ChartState.Empty,
            Body = chart,
            EmptyMessage = display.EmptyMessage,
        };

        var section = new StackPanel { Spacing = 8 };
        section.Children.Add(container);
        section.Children.Add(BuildScatterLegend(display.Scatter.Legend));
        return section;
    }

    private static StackPanel BuildScatterLegend(IReadOnlyList<SpeedScatterLegendDisplay> legend)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        foreach (var chip in legend)
        {
            var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            item.Children.Add(new Ellipse
            {
                Width = 8,
                Height = 8,
                Fill = DisplayTokens.Brush(chip.BrushKey),
                VerticalAlignment = VerticalAlignment.Center,
            });
            item.Children.Add(new Caption { Value = chip.Label, VerticalAlignment = VerticalAlignment.Center });
            AutomationProperties.SetName(item, chip.Label);
            row.Children.Add(item);
        }

        return row;
    }

    // ── Efficiency insight callout (GlassPanel5) ─────────────────────────────────────────────────────────
    private static TsGlassPanel BuildInsightPanel(SpeedProfileDisplay display)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        content.Children.Add(new FontIcon
        {
            Glyph = display.InsightGlyph,
            FontSize = 18,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });

        var textColumn = new StackPanel { Spacing = 4 };
        textColumn.Children.Add(new PanelTitle { Value = display.InsightTitle });
        textColumn.Children.Add(new Text { Value = display.InsightText, Foreground = DisplayTokens.TextSecondary });
        content.Children.Add(textColumn);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, $"{display.InsightTitle}. {display.InsightText}");
        return panel;
    }

    // ── Shared primitives ────────────────────────────────────────────────────────────────────────────────
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

    protected override AutomationPeer OnCreateAutomationPeer() => new SpeedProfilePageAutomationPeer(this);

    private sealed class SpeedProfilePageAutomationPeer(SpeedProfilePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
