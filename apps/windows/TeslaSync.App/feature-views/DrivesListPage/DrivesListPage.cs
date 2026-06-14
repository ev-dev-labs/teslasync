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

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>DrivesListPage</c> — a parity port of the web page
/// <c>web/src/features/driving/pages/DrivesListPage.tsx</c> (route <c>/drives</c>, nav name <c>Drives</c>). It
/// composes the shared <see cref="PageContainer"/> chrome around the web section stack: the sticky summary; the
/// search + active-filter bar; the six-up overview KPI grid (Drives / Distance / Drive time / Avg score / Efficiency
/// / Cost) or the no-stats glass panel; the metric-switcher trend chart; the collection pill bar; the sort controls;
/// the date-grouped, searchable, sortable, paged drive list with bulk selection + delete + CSV/JSON export; and the
/// four data states (loading skeletons, empty, retriable error, success). The view is a thin renderer — every branch,
/// format and i18n string comes from the <see cref="DrivesListPageViewModel"/> / <see cref="DrivesListProjection"/>;
/// units convert at the display boundary only; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class DrivesListPage : UserControl, IDisposable
{
    private const double SectionSpacing = 16;
    private const double KpiSpacing = 12;
    private const int KpiColumns = 3;
    private const double PanelPadding = 20;
    private const double SkeletonHeight = 96;
    private const string EmeraldHex = "#34d399";

    private readonly DrivesListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _ownsSettings;
    private bool _suppressPager;
    private bool _suppressCollections;
    private bool _suppressSort;

    private readonly PageContainer _container;

    private readonly TextBlock _sticky = new() { TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = DisplayTokens.TextSecondary };
    private readonly TsSearchInput _search = new();
    private readonly TextBlock _pending = new() { FontSize = 12, Visibility = Visibility.Collapsed, Foreground = DisplayTokens.TextMuted };
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
    private readonly TsEmptyState _noStats = new() { IconGlyph = DrivesListRegistration.RouteGlyph };

    private readonly ContentControl _trendHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private MetricSwitcherChartStore? _trendStore;
    private MetricSwitcherChart? _trendChart;

    private readonly TsPillFilterBar _collections = new();
    private readonly TsPillFilterBar _sort = new();

    private readonly PanelTitle _listHeading = new();
    private readonly TextBlock _bulkCount = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = DisplayTokens.TextSecondary };
    private readonly TsButton _bulkDelete = new() { Variant = ButtonVariant.Destructive, IconGlyph = DrivesListRegistration.DeleteGlyph };
    private readonly TsButton _exportCsv = new() { Variant = ButtonVariant.Secondary, IconGlyph = DrivesListRegistration.ExportGlyph, Text = "CSV" };
    private readonly TsButton _exportJson = new() { Variant = ButtonVariant.Secondary, IconGlyph = DrivesListRegistration.ExportGlyph, Text = "JSON" };
    private readonly StackPanel _bulkToolbar = new() { Orientation = Orientation.Horizontal, Spacing = 8, Visibility = Visibility.Collapsed };
    private readonly StackPanel _groupsStack = new() { Spacing = 10 };
    private readonly TsEmptyState _listEmpty = new() { IconGlyph = DrivesListRegistration.RouteGlyph, Visibility = Visibility.Collapsed };

    private readonly TsPagination _pager = new() { PageSize = DrivesListProjection.DisplayPageSize, HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsFadeIn _pagerHost = new() { DelayMs = 200 };

    private readonly StackPanel _successBody = new() { Spacing = SectionSpacing };
    private readonly StackPanel _loadingHost = new() { Spacing = SectionSpacing, Visibility = Visibility.Collapsed };
    private readonly TsQueryError _errorState = new() { Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _pageEmpty = new() { IconGlyph = DrivesListRegistration.RouteGlyph, Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty source + shell localizer, binding the live unit preference.</summary>
    public DrivesListPage()
        : this(EmptyDrivesListSource.Instance, NullDriveBulkDeleteService.Instance, ShellLocalizer.Instance)
    {
        ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        _ownsSettings = true;
    }

    /// <summary>Creates the page over an explicit source, bulk-delete port and localizer (tests / dependency injection).</summary>
    /// <param name="source">The cache-then-network drives port.</param>
    /// <param name="bulkDelete">The bulk-delete mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public DrivesListPage(IDrivesListSource source, IDriveBulkDeleteService bulkDelete, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(bulkDelete);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new DrivesListPageViewModel(source, bulkDelete, localizer);
        _container = new PageContainer(localizer, _viewModel.Display.Title);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildLayout();

        _search.QueryChanged += OnSearchChanged;
        _collections.SelectionChanged += OnCollectionChanged;
        _sort.SelectionChanged += OnSortChanged;
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

    /// <summary>The navigation route name the shell registers this page under (<c>Drives</c>).</summary>
    public static string RouteName => DrivesListRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DrivesListPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DrivesListSource"/> +
    /// <see cref="DriveBulkDeleteClient"/> from the shared data layer (the generated client + cache-then-network
    /// engine + the vehicle scope source).
    /// </summary>
    /// <param name="vehicles">The vehicle scope source (web <c>useSelectedVehicle</c>).</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle.</param>
    /// <returns>The fully wired page.</returns>
    public static DrivesListPage Create(
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

        var source = new DrivesListSource(vehicles, api, engine, options, vehicleId);
        var bulk = new DriveBulkDeleteClient(api);
        var page = new DrivesListPage(source, bulk, localizer);

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
        _successBody.Children.Add(_sort);
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

    private void Render(DrivesListDisplay display)
    {
        if (_disposed)
        {
            return;
        }

        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        bool success = display.State == DrivesListState.Success;
        _successBody.Visibility = success ? Visibility.Visible : Visibility.Collapsed;
        _loadingHost.Visibility = display.State == DrivesListState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _errorState.Visibility = display.State == DrivesListState.Error ? Visibility.Visible : Visibility.Collapsed;
        _pageEmpty.Visibility = display.State == DrivesListState.Empty ? Visibility.Visible : Visibility.Collapsed;

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
        RenderList(display);
        RenderPager(display);
    }

    private void RenderSticky(DrivesListDisplay display)
    {
        _sticky.Text = display.StickySummary;
        AutomationProperties.SetName(_sticky, display.StickyAria);
    }

    private void RenderSearch(DrivesListDisplay display)
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

        if (_viewModel.Filters.Collection != DriveCollectionKind.All)
        {
            var label = display.CollectionOptions.FirstOrDefault(o => o.Value == display.ActiveCollection)?.Label ?? display.FilterCollectionLabel;
            _chips.Children.Add(BuildChip(display.FilterCollectionLabel, label));
        }
    }

    private void RenderOverview(DrivesListDisplay display)
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

    private void RenderTrend(DrivesListDisplay display)
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

    private void RenderCollections(DrivesListDisplay display)
    {
        _suppressCollections = true;
        _collections.Options = display.CollectionOptions;
        _collections.SelectedValue = display.ActiveCollection;
        AutomationProperties.SetName(_collections, display.CollectionsAria);
        _suppressCollections = false;
    }

    private void RenderControls(DrivesListDisplay display)
    {
        _suppressSort = true;
        _sort.Options = display.SortOptions;
        _sort.SelectedValue = display.ActiveSort;
        AutomationProperties.SetName(_sort, display.SortAria);
        _suppressSort = false;
    }

    private void RenderList(DrivesListDisplay display)
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
                _groupsStack.Children.Add(BuildRowCard(row));
            }
        }
    }

    private Border BuildRowCard(DriveRowModel row)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var check = new TsCheckbox { IsChecked = row.Selected, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(check, row.SelectAria);
        long id = row.Id;
        check.Checked += (_, _) => _viewModel.ToggleSelection(id, true);
        check.Unchecked += (_, _) => _viewModel.ToggleSelection(id, false);
        Grid.SetColumn(check, 0);

        var accent = DisplayPrimitives.HexBrush(row.ScoreColorHex);
        var scoreLabel = new TextBlock
        {
            Text = row.ScoreLabel,
            FontSize = 14,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var scorePill = DisplayPrimitives.Pill(scoreLabel, accent);
        scorePill.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(scorePill, row.ScoreAria);
        Grid.SetColumn(scorePill, 1);

        var body = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(BuildPrimaryRow(row));
        body.Children.Add(new TsRouteDisplay
        {
            StartAddress = row.RouteStartAddress,
            StartLat = row.RouteStartLat ?? double.NaN,
            StartLon = row.RouteStartLon ?? double.NaN,
            EndAddress = row.RouteEndAddress,
            EndLat = row.RouteEndLat ?? double.NaN,
            EndLon = row.RouteEndLon ?? double.NaN,
            SingleLocation = string.IsNullOrEmpty(row.RouteEndAddress) && row.RouteEndLat is null && row.RouteEndLon is null,
        });
        body.Children.Add(BuildMetricsRow(row));
        Grid.SetColumn(body, 2);

        grid.Children.Add(check);
        grid.Children.Add(scorePill);
        grid.Children.Add(body);

        var card = DisplayPrimitives.Card(grid);
        card.Padding = new Thickness(12);
        return card;
    }

    private static StackPanel BuildPrimaryRow(DriveRowModel row)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        line.Children.Add(new TextBlock
        {
            Text = row.TimeLabel,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        line.Children.Add(new TextBlock
        {
            Text = row.DurationLabel,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        line.Children.Add(new TsBadge { Status = ToStatus(row.PrimaryBadgeKind), Content = row.PrimaryBadgeText });
        if (row.HighSpeed)
        {
            line.Children.Add(new TsBadge { Status = StatusKind.Danger, Content = row.HighSpeedLabel });
        }

        if (row.IsAnomaly)
        {
            line.Children.Add(new TsBadge { Status = StatusKind.Danger, Content = row.AnomalyLabel });
        }

        return line;
    }

    private static StackPanel BuildMetricsRow(DriveRowModel row)
    {
        var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
        line.Children.Add(new TextBlock { Text = row.AvgText, FontSize = 12, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        if (!string.IsNullOrEmpty(row.MaxText))
        {
            line.Children.Add(new TextBlock { Text = row.MaxText, FontSize = 12, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        }

        if (row.HasBattery)
        {
            line.Children.Add(new TsBatteryDelta { StartPercent = row.BatteryStartPct, EndPercent = row.BatteryEndPct, VerticalAlignment = VerticalAlignment.Center });
        }

        if (!string.IsNullOrEmpty(row.EfficiencyText))
        {
            line.Children.Add(new TextBlock
            {
                Text = row.EfficiencyText,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = row.EfficiencyColorHex is null ? DisplayTokens.TextSecondary : DisplayPrimitives.HexBrush(row.EfficiencyColorHex),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        if (!string.IsNullOrEmpty(row.CostText))
        {
            line.Children.Add(new TextBlock
            {
                Text = row.CostText,
                FontSize = 12,
                Foreground = DisplayPrimitives.HexBrush(EmeraldHex),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return line;
    }

    private static StatusKind ToStatus(DriveBadgeKind kind) => kind switch
    {
        DriveBadgeKind.Warning => StatusKind.Warning,
        DriveBadgeKind.Success => StatusKind.Success,
        _ => StatusKind.Info,
    };

    private void RenderPager(DrivesListDisplay display)
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
        string content = DrivesListProjection.BuildCsv(_viewModel.ExportRows(false));
        await SaveExportAsync(content, "CSV", ".csv", "teslasync-drives").ConfigureAwait(true);
    }

    private async void OnExportJson(object sender, RoutedEventArgs e)
    {
        string content = DrivesListProjection.BuildJson(_viewModel.ExportRows(false));
        await SaveExportAsync(content, "JSON", ".json", "teslasync-drives").ConfigureAwait(true);
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
