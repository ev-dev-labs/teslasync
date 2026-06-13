using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The native WinUI 3 <c>LocationsPage</c> — a parity port of the web page
/// <c>web/src/features/maps/pages/LocationsPage.tsx</c> (route <c>/locations</c>, nav name <c>Locations</c>).
/// It binds to a <see cref="LocationsPageViewModel"/> and renders every web region with Fluent components and
/// design tokens: the page header (title + subtitle + data-freshness chip), the loading shimmer, the retriable
/// error surface, and — in the content state — the six summary metric cards, the Top-Locations-by-Visits and
/// Top-Locations-by-Time bar charts, and the searchable, paginated all-locations list (with its two empty
/// surfaces). The interactive search field and pagination are persistent so typing never loses focus; only the
/// data-driven regions (metric cards, chart bodies, rows) are rebuilt. The view is a thin renderer: all branch
/// selection, formatting and i18n happen in the view-model's <see cref="LocationsDisplay"/> projection. State
/// changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class LocationsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly LocationsPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _syncingSearch;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly StackPanel _content = new() { Spacing = SectionSpacing };

    private readonly Grid _metricsGrid = new() { ColumnSpacing = 12, RowSpacing = 12 };
    private readonly TsChartContainer _visitsChart = new();
    private readonly TsChartContainer _timeChart = new();

    private readonly SectionTitle _listTitle = new();
    private readonly TsSearchInput _searchInput = new();
    private readonly Border _filterChip = new() { Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly Caption _filterChipText = new();
    private readonly StackPanel _rowsPanel = new() { Spacing = 8 };
    private readonly TsEmptyState _listEmpty = new() { IconGlyph = LocationsRegistration.EmptyGlyph, Visibility = Visibility.Collapsed };
    private readonly TsPagination _pagination = new() { Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public LocationsPage()
        : this(EmptyLocationsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The visited-locations data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public LocationsPage(ILocationsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new LocationsPageViewModel(feed, localizer);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _searchInput.QueryChanged += OnSearchChanged;
        _listEmpty.ActionInvoked += OnListEmptyActionInvoked;
        _pagination.PageChanged += OnPageChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when an in-page link requests navigation to another route (web <c>Link to</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell registers this page under (<c>Locations</c>).</summary>
    public static string RouteName => LocationsRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public LocationsPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(BuildContent());

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
        _loadingSkeleton.Children.Add(ColumnsGrid(3, 12, BuildSkeletonBlocks(6, 84)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 300 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320 });
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

    private StackPanel BuildContent()
    {
        _content.Children.Add(new TsFadeIn { Content = _metricsGrid });
        _content.Children.Add(new TsFadeIn { DelayMs = 50, Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _visitsChart } });
        _content.Children.Add(new TsFadeIn { DelayMs = 100, Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _timeChart } });
        _content.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildListPanel() });
        return _content;
    }

    private TsGlassPanel BuildListPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_listTitle);

        _searchInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        column.Children.Add(_searchInput);

        _filterChip.Padding = new Thickness(10, 4, 10, 4);
        _filterChip.CornerRadius = DisplayTokens.Radius("TsRadiusPillRadius", 999);
        _filterChip.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _filterChip.BorderBrush = DisplayTokens.Brush("TsColorBorderBrush");
        _filterChip.BorderThickness = new Thickness(1);
        _filterChip.Child = _filterChipText;
        column.Children.Add(_filterChip);

        column.Children.Add(_rowsPanel);
        column.Children.Add(_listEmpty);
        column.Children.Add(_pagination);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
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
        _searchInput.QueryChanged -= OnSearchChanged;
        _listEmpty.ActionInvoked -= OnListEmptyActionInvoked;
        _pagination.PageChanged -= OnPageChanged;
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

    private void OnSearchChanged(object? sender, string query)
    {
        if (_syncingSearch)
        {
            return;
        }

        _viewModel.Search = query;
    }

    private void OnPageChanged(object? sender, int page) => _ = _viewModel.GoToPageAsync(page);

    private void OnListEmptyActionInvoked(object? sender, EventArgs e)
    {
        if (_viewModel.Display.ListEmptyActionIsClear)
        {
            _viewModel.Search = string.Empty;
        }
        else
        {
            NavigationRequested?.Invoke(this, LocationsRegistration.DrivesRoute);
        }
    }

    private void Render(LocationsDisplay display)
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

        _content.Visibility = Show(display.ShowContent);
        if (display.ShowContent)
        {
            RenderMetrics(display.Metrics);
            RenderChart(_visitsChart, display.VisitsChart, 300);
            RenderChart(_timeChart, display.TimeChart, 280);
            RenderList(display);
        }
    }

    private void RenderMetrics(IReadOnlyList<LocationMetricDisplay> metrics)
    {
        var cards = new List<FrameworkElement>(metrics.Count);
        foreach (var metric in metrics)
        {
            var card = new TsMetricCard { Label = metric.Label, Value = metric.Value, AccentBrushKey = metric.AccentBrushKey };
            AutomationProperties.SetName(card, $"{metric.Label}: {metric.Value}");
            cards.Add(card);
        }

        FillColumnsGrid(_metricsGrid, 3, cards);
    }

    private static void RenderChart(TsChartContainer container, LocationsChartDisplay chart, double baseHeight)
    {
        container.Title = chart.Title;
        container.AccessibleSummary = chart.AriaLabel;
        container.EmptyMessage = chart.EmptyMessage;

        if (chart.HasData)
        {
            var inner = new TsBarChart
            {
                Series = new[] { new ChartSeries(chart.SeriesName, chart.Points) { Kind = ChartSeriesKind.Bar, Role = chart.Role } },
                ShowLegend = false,
                IncludeZero = true,
                Title = chart.Title,
                MinHeight = Math.Max(baseHeight, chart.Points.Count * 36),
            };
            container.Body = inner;
            container.State = ChartState.Ready;
        }
        else
        {
            container.Body = null;
            container.State = ChartState.Empty;
        }
    }

    private void RenderList(LocationsDisplay display)
    {
        _listTitle.Value = display.ListTitle;
        _searchInput.PromptText = display.SearchHint;

        if (!string.Equals(_searchInput.Query, display.SearchQuery, StringComparison.Ordinal))
        {
            _syncingSearch = true;
            _searchInput.Query = display.SearchQuery;
            _syncingSearch = false;
        }

        _filterChip.Visibility = Show(display.ShowFilterChip);
        _filterChipText.Value = display.FilterChipLabel;

        bool hasRows = display.ListHasLocations && display.ListHasMatches;
        _rowsPanel.Visibility = Show(hasRows);
        _pagination.Visibility = Show(hasRows);
        _listEmpty.Visibility = Show(!hasRows);

        if (hasRows)
        {
            _rowsPanel.Children.Clear();
            foreach (var row in display.Rows)
            {
                _rowsPanel.Children.Add(BuildRow(row));
            }

            _pagination.PageSize = display.PageSize;
            _pagination.TotalItems = display.TotalItems;
            _pagination.Page = display.Page;
        }
        else
        {
            _listEmpty.Title = display.ListEmptyTitle;
            _listEmpty.Message = display.ListEmptyMessage;
            _listEmpty.ActionText = display.ListEmptyActionLabel;
        }
    }

    // ── Per-row card (web GlassPanel10) ────────────────────────────────────────────────────────────────────
    private static TsGlassPanel BuildRow(LocationRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 16, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var rank = new Border
        {
            Width = 36,
            Height = 36,
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = row.Rank,
                FontWeight = FontWeights.SemiBold,
                FontSize = 12,
                Foreground = DisplayTokens.Brush(row.RankAccentKey),
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            },
        };
        Grid.SetColumn(rank, 0);
        grid.Children.Add(rank);

        var details = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        details.Children.Add(new Text { Value = row.Name });
        details.Children.Add(new Caption { Value = row.Stats });
        Grid.SetColumn(details, 1);
        grid.Children.Add(details);

        var visitChip = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        visitChip.Children.Add(new FontIcon { Glyph = LocationsProjection.HashGlyph, FontSize = 12, Foreground = DisplayTokens.Brush("TsColorSuccessBrush") });
        visitChip.Children.Add(new TextBlock
        {
            Text = row.VisitCountText,
            FontSize = 12,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(visitChip, 2);
        grid.Children.Add(visitChip);

        AutomationProperties.SetName(grid, $"{row.Rank} {row.Name}. {row.Stats}");
        return new TsGlassPanel { Padding = new Thickness(16), Content = grid };
    }

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        FillColumnsGrid(grid, columns, children);
        return grid;
    }

    private static void FillColumnsGrid(Grid grid, int columns, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        grid.Children.Clear();
        grid.ColumnDefinitions.Clear();
        grid.RowDefinitions.Clear();

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
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
