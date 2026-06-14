using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces;
using Windows.Storage;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The native WinUI 3 <c>ChargingListPage</c> — a parity port of the web page
/// <c>web/src/features/charging/pages/ChargingListPage.tsx</c> (route <c>/charging</c>, nav name <c>Charging</c>).
/// It composes the shared <see cref="PageContainer"/> chrome around the web section stack: the sticky summary; the
/// search + active-filter bar; the six-up overview KPI grid (Sessions / Energy / Cost / Avg rate / Avg duration /
/// Avg power) or the no-stats glass panel; the metric-switcher trend chart; the collection pill bar; the
/// sort + density controls; the conditional analytical sections (battery distribution / charger specs / optimizer);
/// the date-grouped, searchable, sortable, paged session list with bulk selection + delete + CSV/JSON export; and
/// the four data states (loading skeletons, empty, retriable error, success). The view is a thin renderer — every
/// branch, format and i18n string comes from the <see cref="ChargingListPageViewModel"/> /
/// <see cref="ChargingListProjection"/>; units convert at the display boundary only; state changes are marshalled
/// onto the UI thread.
/// </summary>
public sealed partial class ChargingListPage : UserControl, IDisposable
{
    private const double SectionSpacing = 16;
    private const double KpiSpacing = 12;
    private const int KpiColumns = 3;
    private const double PanelPadding = 20;
    private const double SkeletonHeight = 96;

    private readonly ChargingListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _ownsSettings;
    private bool _suppressPager;
    private bool _suppressCollections;
    private bool _suppressSort;

    private readonly PageContainer _container;

    private readonly TextBlock _sticky = new() { TextWrapping = TextWrapping.Wrap, FontSize = 12 };
    private readonly TsSearchInput _search = new();
    private readonly TextBlock _pending = new() { FontSize = 12, Visibility = Visibility.Collapsed };
    private readonly StackPanel _chips = new() { Orientation = Orientation.Horizontal, Spacing = 8 };

    private readonly TsGlassPanel _overviewPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _overviewBody = new() { Spacing = 10 };
    private readonly PanelTitle _overviewTitle = new();
    private readonly Caption _periodCaption = new();
    private readonly Caption _priorCaption = new();
    private readonly Grid _kpiGrid = new() { ColumnSpacing = KpiSpacing, RowSpacing = KpiSpacing };
    private readonly TextBlock _secondary = new() { TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = DisplayTokens.TextSecondary };
    private readonly TextBlock _anomaly = new() { TextWrapping = TextWrapping.Wrap, FontSize = 12 };
    private readonly TsButton _viewAnomalies = new() { Variant = ButtonVariant.Subtle };
    private readonly StackPanel _anomalyRow = new() { Orientation = Orientation.Horizontal, Spacing = 8, Visibility = Visibility.Collapsed };

    private readonly TsGlassPanel _noStatsPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly TsEmptyState _noStats = new() { IconGlyph = ChargingListRegistration.RouteGlyph };

    private readonly ContentControl _trendHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private MetricSwitcherChartStore? _trendStore;
    private MetricSwitcherChart? _trendChart;

    private readonly TsPillFilterBar _collections = new();
    private readonly TsPillFilterBar _sort = new();
    private readonly TsButton _sortDirection = new() { Variant = ButtonVariant.Subtle };
    private readonly TsButton _density = new() { Variant = ButtonVariant.Subtle };

    private readonly StackPanel _sectionsHost = new() { Spacing = SectionSpacing };

    private readonly PanelTitle _listHeading = new();
    private readonly TextBlock _bulkCount = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextSecondary };
    private readonly TsButton _bulkDelete = new() { Variant = ButtonVariant.Destructive, IconGlyph = ChargingListRegistration.DeleteGlyph };
    private readonly TsButton _exportCsv = new() { Variant = ButtonVariant.Subtle, IconGlyph = ChargingListRegistration.ExportGlyph, Text = "CSV" };
    private readonly TsButton _exportJson = new() { Variant = ButtonVariant.Subtle, IconGlyph = ChargingListRegistration.ExportGlyph, Text = "JSON" };
    private readonly StackPanel _bulkToolbar = new() { Orientation = Orientation.Horizontal, Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly StackPanel _groupsStack = new() { Spacing = 10 };
    private readonly TsEmptyState _listEmpty = new() { IconGlyph = ChargingListRegistration.RouteGlyph, Visibility = Visibility.Collapsed };

    private readonly TsPagination _pager = new() { PageSize = ChargingListProjection.DisplayPageSize, HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsFadeIn _pagerHost = new() { DelayMs = 200 };

    private readonly StackPanel _successBody = new() { Spacing = SectionSpacing };
    private readonly StackPanel _loadingHost = new() { Spacing = SectionSpacing, Visibility = Visibility.Collapsed };
    private readonly TsQueryError _errorState = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _pageEmpty = new() { IconGlyph = ChargingListRegistration.RouteGlyph, Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty source + shell localizer, binding the live unit preference.</summary>
    public ChargingListPage()
        : this(EmptyChargingListSource.Instance, NullChargingBulkDeleteService.Instance, ShellLocalizer.Instance)
    {
        ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        _ownsSettings = true;
    }

    /// <summary>Creates the page over an explicit source, bulk-delete port and localizer (tests / dependency injection).</summary>
    /// <param name="source">The cache-then-network charging-sessions port.</param>
    /// <param name="bulkDelete">The bulk-delete mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ChargingListPage(IChargingListSource source, IChargingBulkDeleteService bulkDelete, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(bulkDelete);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new ChargingListPageViewModel(source, bulkDelete, localizer);
        _container = new PageContainer(localizer, _viewModel.Display.Title);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildLayout();

        _search.QueryChanged += OnSearchChanged;
        _collections.SelectionChanged += OnCollectionChanged;
        _sort.SelectionChanged += OnSortChanged;
        _sortDirection.Click += OnSortDirectionClick;
        _density.Click += OnDensityClick;
        _viewAnomalies.Click += OnViewAnomaliesClick;
        _bulkDelete.Click += OnBulkDeleteClick;
        _exportCsv.Click += OnExportCsv;
        _exportJson.Click += OnExportJson;
        _pager.PageChanged += OnPageChanged;
        _errorState.ActionInvoked += OnRetry;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Charging</c>).</summary>
    public static string RouteName => ChargingListRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ChargingListPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ChargingListSource"/> +
    /// <see cref="ChargingBulkDeleteClient"/> from the shared data layer (the generated client + cache-then-network
    /// engine + the vehicle scope source).
    /// </summary>
    /// <param name="vehicles">The vehicle scope source (web <c>useSelectedVehicle</c>).</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle.</param>
    /// <returns>The fully wired page.</returns>
    public static ChargingListPage Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);

        var source = new ChargingListSource(vehicles, api, engine, options, vehicleId);
        var bulk = new ChargingBulkDeleteClient(api);
        var page = new ChargingListPage(source, bulk, localizer);

        page.ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += page.OnSettingsChanged;
        page._ownsSettings = true;
        return page;
    }

    private PageContainer BuildLayout()
    {
        for (int c = 0; c < KpiColumns; c++)
        {
            _kpiGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        // Overview panel: title + period/prior + KPI grid + secondary + anomaly callout.
        _anomalyRow.Children.Add(new FontIcon { Glyph = "\uE7BA", FontSize = 14, Foreground = DisplayTokens.Brush("TsColorWarningBrush"), VerticalAlignment = VerticalAlignment.Center });
        _anomalyRow.Children.Add(_anomaly);
        _anomalyRow.Children.Add(_viewAnomalies);
        _overviewBody.Children.Add(_overviewTitle);
        _overviewBody.Children.Add(_periodCaption);
        _overviewBody.Children.Add(_priorCaption);
        _overviewBody.Children.Add(_kpiGrid);
        _overviewBody.Children.Add(_secondary);
        _overviewBody.Children.Add(_anomalyRow);
        _overviewPanel.Content = _overviewBody;
        _noStatsPanel.Content = _noStats;

        // Sort + density control row.
        var controlRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        controlRow.Children.Add(_sort);
        controlRow.Children.Add(_sortDirection);
        controlRow.Children.Add(_density);

        // Session list panel.
        var listHeader = new Grid();
        listHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        listHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_listHeading, 0);
        _bulkToolbar.Children.Add(_bulkCount);
        _bulkToolbar.Children.Add(_bulkDelete);
        var headerActions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        headerActions.Children.Add(_bulkToolbar);
        headerActions.Children.Add(_exportCsv);
        headerActions.Children.Add(_exportJson);
        Grid.SetColumn(headerActions, 1);
        listHeader.Children.Add(_listHeading);
        listHeader.Children.Add(headerActions);

        var listStack = new StackPanel { Spacing = 12 };
        listStack.Children.Add(listHeader);
        listStack.Children.Add(_groupsStack);
        listStack.Children.Add(_listEmpty);
        var listPanel = new TsGlassPanel { Content = listStack, Padding = new Thickness(PanelPadding) };

        _pagerHost.Content = _pager;

        _successBody.Children.Add(_sticky);
        var searchRow = new StackPanel { Spacing = 6 };
        var searchLine = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        _search.MinWidth = 360;
        searchLine.Children.Add(_search);
        searchLine.Children.Add(_pending);
        searchRow.Children.Add(searchLine);
        searchRow.Children.Add(_chips);
        _successBody.Children.Add(new TsFadeIn { DelayMs = 40, Content = searchRow });
        _successBody.Children.Add(new TsFadeIn { DelayMs = 60, Content = _overviewPanel });
        _successBody.Children.Add(_noStatsPanel);
        _successBody.Children.Add(new TsFadeIn { DelayMs = 90, Content = _trendHost });
        _successBody.Children.Add(new TsFadeIn { DelayMs = 110, Content = _collections });
        _successBody.Children.Add(controlRow);
        _successBody.Children.Add(_sectionsHost);
        _successBody.Children.Add(new TsFadeIn { DelayMs = 140, Content = listPanel });
        _successBody.Children.Add(_pagerHost);

        for (int i = 0; i < 3; i++)
        {
            _loadingHost.Children.Add(new TsSkeleton { BlockHeight = SkeletonHeight, Radius = 12 });
        }

        var root = new Grid();
        root.Children.Add(_successBody);
        root.Children.Add(_loadingHost);
        root.Children.Add(_errorState);
        root.Children.Add(_pageEmpty);

        _container.Subtitle = _viewModel.Display.Subtitle;
        _container.CopyLink = true;
        _container.Actions = null;
        _container.PageContent = root;
        return _container;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
        if (settings is null)
        {
            return;
        }

        if (_dispatcher.HasThreadAccess)
        {
            ApplyUnits(settings.ToUnitPref());
        }
        else
        {
            _dispatcher.TryEnqueue(() => ApplyUnits(settings.ToUnitPref()));
        }
    }

    private void ApplyUnits(UnitPref units) => _viewModel.Units = units;

    private void OnSearchChanged(object? sender, string query) => _viewModel.SetSearch(query);

    private void OnCollectionChanged(object? sender, string? value)
    {
        if (_suppressCollections)
        {
            return;
        }

        _viewModel.SetCollection(value);
    }

    private void OnSortChanged(object? sender, string? value)
    {
        if (_suppressSort)
        {
            return;
        }

        _viewModel.SetSort(value);
    }

    private void OnSortDirectionClick(object sender, RoutedEventArgs e) => _viewModel.ToggleSortDirection();

    private void OnDensityClick(object sender, RoutedEventArgs e) =>
        _viewModel.SetDensity(_viewModel.Filters.Density == ChargingCardDensity.Comfortable
            ? ChargingCardDensity.Compact
            : ChargingCardDensity.Comfortable);

    private void OnViewAnomaliesClick(object sender, RoutedEventArgs e) => _viewModel.SetCollection("anomalies");

    private void OnPageChanged(object? sender, int page)
    {
        if (_suppressPager)
        {
            return;
        }

        _viewModel.GoToPage(page);
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

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

    private void Render(ChargingListDisplay display)
    {
        if (_disposed)
        {
            return;
        }

        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        bool success = display.State == ChargingListState.Success;
        _successBody.Visibility = success ? Visibility.Visible : Visibility.Collapsed;
        _loadingHost.Visibility = display.State == ChargingListState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _errorState.Visibility = display.State == ChargingListState.Error ? Visibility.Visible : Visibility.Collapsed;
        _pageEmpty.Visibility = display.State == ChargingListState.Empty ? Visibility.Visible : Visibility.Collapsed;

        _errorState.Title = display.EmptyTitle;
        _errorState.Message = display.NoStatsMessage;
        _errorState.ActionText = display.ViewAnomaliesLabel;
        _errorState.AttemptCount = _viewModel.Attempts;

        _pageEmpty.Title = display.EmptyTitle;
        _pageEmpty.Message = display.EmptyMessage;
        _pageEmpty.ActionText = display.EmptyCta;

        if (!success)
        {
            return;
        }

        RenderSticky(display);
        RenderSearch(display);
        RenderOverview(display);
        RenderTrend(display);
        RenderCollections(display);
        RenderControls(display);
        RenderSections(display);
        RenderList(display);
        RenderPager(display);
    }

    private void RenderSticky(ChargingListDisplay display)
    {
        _sticky.Text = display.StickySummary;
        AutomationProperties.SetName(_sticky, display.StickyAria);
    }

    private void RenderSearch(ChargingListDisplay display)
    {
        _search.PromptText = display.SearchPrompt;
        AutomationProperties.SetName(_search, display.SearchPrompt);
        _pending.Text = display.FilterPendingLabel;
        _pending.Visibility = _viewModel.IsFetching ? Visibility.Visible : Visibility.Collapsed;

        _chips.Children.Clear();
        if (!string.IsNullOrEmpty(_viewModel.Filters.Search))
        {
            _chips.Children.Add(BuildChip(display.FilterSearchLabel, _viewModel.Filters.Search));
        }

        if (_viewModel.Filters.Collection != ChargingCollectionKind.All)
        {
            var label = display.CollectionOptions.FirstOrDefault(o => o.Value == display.ActiveCollection)?.Label ?? display.FilterCollectionLabel;
            _chips.Children.Add(BuildChip(display.FilterCollectionLabel, label));
        }
    }

    private void RenderOverview(ChargingListDisplay display)
    {
        _overviewPanel.Visibility = display.HasStats ? Visibility.Visible : Visibility.Collapsed;
        _noStatsPanel.Visibility = display.HasStats ? Visibility.Collapsed : Visibility.Visible;
        _noStats.Message = display.NoStatsMessage;
        _noStats.Title = display.OverviewTitle;

        if (!display.HasStats)
        {
            return;
        }

        _overviewTitle.Value = display.OverviewTitle;
        _periodCaption.Value = display.PeriodLabel;
        _priorCaption.Value = display.PriorLabel;
        _priorCaption.Visibility = string.IsNullOrEmpty(display.PriorLabel) ? Visibility.Collapsed : Visibility.Visible;
        _secondary.Text = display.SecondaryLine;

        _kpiGrid.Children.Clear();
        _kpiGrid.RowDefinitions.Clear();
        int rows = (display.KpiCards.Count + KpiColumns - 1) / KpiColumns;
        for (int r = 0; r < rows; r++)
        {
            _kpiGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.KpiCards.Count; i++)
        {
            var kpi = display.KpiCards[i];
            var card = new TsMetricCard
            {
                Label = kpi.Label,
                Value = kpi.Value,
                AccentBrushKey = kpi.AccentBrushKey,
                DeltaText = kpi.DeltaText,
            };
            AutomationProperties.SetName(card, kpi.AutomationName);
            Grid.SetColumn(card, i % KpiColumns);
            Grid.SetRow(card, i / KpiColumns);
            _kpiGrid.Children.Add(card);
        }

        _anomalyRow.Visibility = display.HasAnomalyCallout ? Visibility.Visible : Visibility.Collapsed;
        _anomaly.Text = display.AnomalyCallout;
        _anomaly.Foreground = DisplayTokens.Brush("TsColorWarningBrush");
        _viewAnomalies.Text = display.ViewAnomaliesLabel;
        AutomationProperties.SetName(_viewAnomalies, display.ViewAnomaliesLabel);
    }

    private void RenderTrend(ChargingListDisplay display)
    {
        bool show = display.HasStats;
        _trendHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            return;
        }

        if (_trendStore is null)
        {
            _trendStore = new MetricSwitcherChartStore(
                display.TrendTitle,
                display.TrendAria,
                display.TrendEmpty,
                display.TrendMetrics,
                display.TrendSeries,
                display.TrendActiveKey);
            _trendChart = new MetricSwitcherChart(_trendStore, _localizer);
            _trendHost.Content = _trendChart;
        }
        else
        {
            foreach (var metric in display.TrendMetrics)
            {
                display.TrendSeries.TryGetValue(metric.Key, out var points);
                _trendStore.ReplaceSeries(metric.Key, points ?? Array.Empty<MetricPoint>());
            }
        }
    }

    private void RenderCollections(ChargingListDisplay display)
    {
        _suppressCollections = true;
        _collections.Options = display.CollectionOptions;
        _collections.SelectedValue = display.ActiveCollection;
        AutomationProperties.SetName(_collections, display.CollectionsAria);
        _suppressCollections = false;
    }

    private void RenderControls(ChargingListDisplay display)
    {
        _suppressSort = true;
        _sort.Options = display.SortOptions;
        _sort.SelectedValue = display.ActiveSort;
        _suppressSort = false;

        _sortDirection.IconGlyph = _viewModel.Filters.SortDescending ? "\uE74B" : "\uE74A";
        AutomationProperties.SetName(_sortDirection, _viewModel.Filters.SortDescending ? "Descending" : "Ascending");
        _density.Text = _viewModel.Filters.Density == ChargingCardDensity.Comfortable ? "\u2261" : "\u2630";
        AutomationProperties.SetName(_density, "Density");
    }

    private void RenderSections(ChargingListDisplay display)
    {
        _sectionsHost.Children.Clear();
        foreach (var section in display.Sections)
        {
            _sectionsHost.Children.Add(BuildSection(section, display.NoDataLabel));
        }
    }

    private static TsGlassPanel BuildSection(ChargingSectionDisplay section, string noDataLabel)
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(new PanelTitle { Value = section.Title });
        if (!string.IsNullOrEmpty(section.Description))
        {
            stack.Children.Add(new Caption { Value = section.Description });
        }

        if (section.HasData && section.Bars.Count > 0)
        {
            foreach (var bar in section.Bars)
            {
                stack.Children.Add(BuildBar(bar));
            }
        }
        else if (section.HasData && section.Specs.Count > 0)
        {
            foreach (var spec in section.Specs)
            {
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
                row.Children.Add(new Text { Value = spec.Label });
                row.Children.Add(new Caption { Value = spec.Detail });
                stack.Children.Add(row);
            }
        }
        else
        {
            stack.Children.Add(new Caption { Value = string.IsNullOrEmpty(section.EmptyMessage) ? noDataLabel : section.EmptyMessage });
        }

        return new TsGlassPanel { Content = stack, Padding = new Thickness(PanelPadding) };
    }

    private static Grid BuildBar(ChargingBucketBar bar)
    {
        var grid = new Grid { ColumnSpacing = 8, Height = 22 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(64) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock { Text = bar.Label, FontSize = 11, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 0);

        var track = new Grid { VerticalAlignment = VerticalAlignment.Center };
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.0001, bar.Ratio), GridUnitType.Star) });
        track.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(0.0001, 1 - bar.Ratio), GridUnitType.Star) });
        var fill = new Border
        {
            Background = DisplayTokens.Brush("TsChartBatteryBrush"),
            CornerRadius = new CornerRadius(0, 4, 4, 0),
            Height = 14,
            MinWidth = bar.Ratio > 0 ? 2 : 0,
        };
        Grid.SetColumn(fill, 0);
        track.Children.Add(fill);
        Grid.SetColumn(track, 1);

        var count = new TextBlock { Text = bar.Count.ToString(System.Globalization.CultureInfo.InvariantCulture), FontSize = 11, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(count, 2);

        grid.Children.Add(label);
        grid.Children.Add(track);
        grid.Children.Add(count);
        return grid;
    }

    private void RenderList(ChargingListDisplay display)
    {
        _listHeading.Value = display.ListHeading;
        _bulkToolbar.Visibility = display.SelectedCount > 0 ? Visibility.Visible : Visibility.Collapsed;
        _bulkCount.Text = display.SelectedCount.ToString(System.Globalization.CultureInfo.InvariantCulture);
        _bulkDelete.Text = display.BulkDeleteLabel;
        AutomationProperties.SetName(_bulkDelete, display.BulkDeleteLabel);
        _exportCsv.Text = "CSV";
        _exportJson.Text = "JSON";

        bool hasRows = display.HasRows;
        _groupsStack.Visibility = hasRows ? Visibility.Visible : Visibility.Collapsed;
        _listEmpty.Visibility = hasRows ? Visibility.Collapsed : Visibility.Visible;
        _listEmpty.Title = display.EmptyForCollectionTitle;
        _listEmpty.Message = display.EmptyForCollectionMessage;

        _groupsStack.Children.Clear();
        if (!hasRows)
        {
            return;
        }

        foreach (var group in display.Groups)
        {
            var header = new StackPanel { Spacing = 2 };
            header.Children.Add(new SectionTitle { Value = group.DateLabel });
            header.Children.Add(new Caption { Value = group.Summary });
            _groupsStack.Children.Add(header);

            foreach (var row in group.Rows)
            {
                var card = new ChargingSessionCard(
                    _localizer,
                    row.Card,
                    currencySymbol: "$",
                    decimalPrecision: 2,
                    onToggleSelect: OnRowToggleSelect);
                _groupsStack.Children.Add(card);
            }
        }
    }

    private void OnRowToggleSelect(long id, bool selected) => _viewModel.ToggleSelection(id, selected);

    private void RenderPager(ChargingListDisplay display)
    {
        bool show = display.HasRows && display.TotalRowCount > display.PageSize;
        _pagerHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            return;
        }

        _suppressPager = true;
        _pager.PageSize = display.PageSize;
        _pager.TotalItems = display.TotalRowCount;
        _pager.Page = display.Page;
        _pager.FirstLabel = _localizer.GetString("common.pagination.first", "First page");
        _pager.PreviousLabel = _localizer.GetString("common.pagination.previous", "Previous page");
        _pager.NextLabel = _localizer.GetString("common.pagination.next", "Next page");
        _pager.LastLabel = _localizer.GetString("common.pagination.last", "Last page");
        _suppressPager = false;
    }

    private static Border BuildChip(string label, string value)
    {
        var stack = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        stack.Children.Add(new TextBlock { Text = label, FontSize = 11, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
        stack.Children.Add(new TextBlock { Text = value, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        return new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(10, 4, 10, 4),
            Child = stack,
        };
    }

    private async void OnBulkDeleteClick(object sender, RoutedEventArgs e)
    {
        var display = _viewModel.Display;
        var dialog = new ContentDialog
        {
            Title = display.BulkConfirmTitle,
            Content = display.BulkConfirmDescription,
            PrimaryButtonText = display.CommonDeleteLabel,
            CloseButtonText = _localizer.GetString("common.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };

        var result = await dialog.ShowAsync().AsTask().ConfigureAwait(true);
        if (result == ContentDialogResult.Primary)
        {
            await _viewModel.DeleteSelectedAsync().ConfigureAwait(true);
        }
    }

    private async void OnExportCsv(object sender, RoutedEventArgs e)
    {
        string content = ChargingListProjection.BuildCsv(_viewModel.ExportRows(false));
        await SaveExportAsync(content, "CSV", ".csv", "teslasync-charging").ConfigureAwait(true);
    }

    private async void OnExportJson(object sender, RoutedEventArgs e)
    {
        string content = ChargingListProjection.BuildJson(_viewModel.ExportRows(false));
        await SaveExportAsync(content, "JSON", ".json", "teslasync-charging").ConfigureAwait(true);
    }

    private static async Task SaveExportAsync(string content, string typeName, string extension, string baseName)
    {
        var window = App.MainWindow;
        if (window is null)
        {
            return;
        }

        var picker = new FileSavePicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            SuggestedFileName = baseName,
        };
        picker.FileTypeChoices.Add(typeName, new List<string> { extension });
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(window));

        var file = await picker.PickSaveFileAsync().AsTask().ConfigureAwait(true);
        if (file is not null)
        {
            await FileIO.WriteTextAsync(file, content, Windows.Storage.Streams.UnicodeEncoding.Utf8).AsTask().ConfigureAwait(true);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_ownsSettings)
        {
            AppSettingsHost.Service.Changed -= OnSettingsChanged;
            _ownsSettings = false;
        }

        _search.QueryChanged -= OnSearchChanged;
        _collections.SelectionChanged -= OnCollectionChanged;
        _sort.SelectionChanged -= OnSortChanged;
        _sortDirection.Click -= OnSortDirectionClick;
        _density.Click -= OnDensityClick;
        _viewAnomalies.Click -= OnViewAnomaliesClick;
        _bulkDelete.Click -= OnBulkDeleteClick;
        _exportCsv.Click -= OnExportCsv;
        _exportJson.Click -= OnExportJson;
        _pager.PageChanged -= OnPageChanged;
        _errorState.ActionInvoked -= OnRetry;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _trendChart?.Dispose();
        _viewModel.Dispose();
    }
}
