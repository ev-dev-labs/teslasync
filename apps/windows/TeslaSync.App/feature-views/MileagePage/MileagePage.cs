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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>MileagePage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/MileagePage.tsx</c> (route <c>/mileage</c>, nav name <c>Mileage</c>). It
/// binds to a <see cref="MileagePageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle + data-freshness chip), the loading shimmer, the retriable error
/// surface, the page-level empty surface, and — in the success state — the four summary metric cards
/// (Total-Distance, Total-Drives, Daily-Avg-30d, Annual-Projection), the Odometer-Over-Time area chart
/// (GlassPanel5), the Daily-Distance bar chart (GlassPanel6) and the Monthly-Summary table (GlassPanel7). The
/// view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="MileageDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class MileagePage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double ChartHeight = 280;

    private readonly MileagePageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = MileageRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public MileagePage()
        : this(EmptyMileageFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The three-source mileage data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MileagePage(IMileageFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MileagePageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Mileage</c>).</summary>
    public static string RouteName => MileageRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public MileagePageViewModel ViewModel => _viewModel;

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
        _loadingSkeleton.Children.Add(ColumnsGrid(4, 12, BuildSkeletonBlocks(4, 96)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
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

    private void Render(MileageDisplay display)
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

    private static StackPanel BuildContent(MileageDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = BuildMetricCards(display.MetricCards) });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildChart(display.OdometerChart, ChartSeriesKind.Area, includeZero: false) });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildChart(display.DailyChart, ChartSeriesKind.Bar, includeZero: true) });
        stack.Children.Add(new TsFadeIn { DelayMs = 300, Content = BuildMonthlyTable(display) });
        return stack;
    }

    // ── Four summary metric cards (Total-Distance / Total-Drives / Daily-Avg-30d / Annual-Projection) ────────
    private static Grid BuildMetricCards(IReadOnlyList<MileageMetricCardDisplay> cards)
    {
        var tiles = new List<FrameworkElement>(cards.Count);
        foreach (var card in cards)
        {
            var tile = new TsMetricCard { Label = card.Label, Value = card.Value, AccentBrushKey = card.AccentBrushKey };
            AutomationProperties.SetName(tile, card.AutomationName);
            tiles.Add(tile);
        }

        return ColumnsGrid(4, 16, tiles);
    }

    // ── Odometer-Over-Time area chart (GlassPanel5) + Daily-Distance bar chart (GlassPanel6) ─────────────────
    private static TsChartContainer BuildChart(MileageChartDisplay chart, ChartSeriesKind kind, bool includeZero)
    {
        object? body = null;
        if (chart.HasData)
        {
            var series = new[]
            {
                new ChartSeries(chart.SeriesName, chart.Points) { Kind = kind, ColorIndex = chart.ColorIndex },
            };

            TsCartesianChart inner = kind == ChartSeriesKind.Bar ? new TsBarChart() : new TsAreaChart();
            inner.Series = series;
            inner.ShowLegend = false;
            inner.IncludeZero = includeZero;
            inner.MinHeight = ChartHeight;
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

    // ── Monthly-Summary table (GlassPanel7) ─────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildMonthlyTable(MileageDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new PanelTitle { Value = display.MonthlyTitle });

        if (display.TableRows.Count > 0)
        {
            column.Children.Add(BuildDataTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = MileageRegistration.EmptyGlyph,
                Message = display.TableEmptyMessage,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.MonthlyTitle);
        return panel;
    }

    private static TsDataTable BuildDataTable(MileageDisplay display)
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
            rows.Add(new TsDataRow(row.Month, new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["month"] = row.Month,
                ["distance"] = row.Distance,
                ["drives"] = row.Drives,
                ["dailyAvg"] = row.DistancePerDrive,
            }));
        }

        table.Rows = rows;
        AutomationProperties.SetName(table, display.MonthlyTitle);
        return table;
    }

    // ── Shared primitives ───────────────────────────────────────────────────────────────────────────────────
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

    protected override AutomationPeer OnCreateAutomationPeer() => new MileagePageAutomationPeer(this);

    private sealed class MileagePageAutomationPeer(MileagePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
