using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The native WinUI 3 <c>SignalGapDetectorPage</c> — a parity port of the web page
/// <c>web/src/features/telemetry/pages/SignalGapDetectorPage.tsx</c> (route <c>/signal-gaps</c>, nav name
/// <c>SignalGapDetector</c>). It binds to a <see cref="SignalGapDetectorPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page header (title + subtitle + vehicle picker), the fleet-failure
/// banner, the no-vehicle empty state (web <c>!vehicleId</c>) and the staleness-aware signal catalog (web
/// <c>SignalCatalogPanel</c> — the four summary cards, the search / filter / sort controls, the data table and its
/// loading / empty / error states). The view is a thin renderer: all branch selection, formatting and i18n happen in
/// the view-model's <see cref="SignalGapDetectorDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SignalGapDetectorPage : UserControl, IDisposable
{
    private const string ActivityGlyph = "\uE9D9"; // StatusCircle (web Activity icon)
    private const string FilterGlyph = "\uE71C";   // Filter
    private const string SortGlyph = "\uE8CB";     // Sort (web ArrowUpDown)
    private const string RefreshGlyph = "\uE72C";  // Refresh (web RefreshCw)

    private readonly SignalGapDetectorPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsSelect _vehicleSelect = new() { MinWidth = 200 };

    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsPageLoadSkeleton _loadingSkeleton = new();
    private readonly TsEmptyState _noVehicleEmpty = new() { IconGlyph = ActivityGlyph };

    private readonly StackPanel _catalog = new() { Spacing = 16 };

    private readonly TsStatCard _statTotal = new();
    private readonly TsStatCard _statActive = new();
    private readonly TsStatCard _statStale = new();
    private readonly TsStatCard _statNever = new();

    private readonly TsGlassPanel _controlsPanel = new();
    private readonly TsInput _searchInput = new() { MinWidth = 240 };
    private readonly Caption _refreshCaption = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly (SignalGapFilterMode Mode, TsButton Button)[] _filterButtons;
    private readonly (SignalGapSortMode Mode, TsButton Button)[] _sortButtons;

    private readonly TsTableSkeleton _catalogLoading = new();
    private readonly TsAlertBanner _catalogErrorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsDataTable _table = new() { Selectable = false };
    private readonly TsEmptyState _catalogEmpty = new() { IconGlyph = ActivityGlyph };
    private readonly Caption _lastRefreshed = new() { HorizontalAlignment = HorizontalAlignment.Right };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public SignalGapDetectorPage()
        : this(EmptySignalGapDetectorFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The vehicles / live-signals data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SignalGapDetectorPage(ISignalGapDetectorFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SignalGapDetectorPageViewModel(feed, localizer);

        _filterButtons =
        [
            (SignalGapFilterMode.All, new TsButton { Variant = ButtonVariant.Subtle }),
            (SignalGapFilterMode.Stale, new TsButton { Variant = ButtonVariant.Subtle }),
            (SignalGapFilterMode.Active, new TsButton { Variant = ButtonVariant.Subtle }),
        ];
        _sortButtons =
        [
            (SignalGapSortMode.Staleness, new TsButton { Variant = ButtonVariant.Subtle }),
            (SignalGapSortMode.Alpha, new TsButton { Variant = ButtonVariant.Subtle }),
            (SignalGapSortMode.Category, new TsButton { Variant = ButtonVariant.Subtle }),
        ];

        BuildCatalog();
        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _searchInput.TextChanged += OnSearchChanged;
        foreach (var (mode, button) in _filterButtons)
        {
            button.Click += (_, _) => OnFilterClick(mode);
        }

        foreach (var (mode, button) in _sortButtons)
        {
            button.Click += (_, _) => OnSortClick(mode);
        }

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>SignalGapDetectorPage</c>).</summary>
    public static string Slug => SignalGapDetectorRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_noVehicleEmpty);
        stack.Children.Add(_catalog);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var heading = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);

        _vehicleSelect.DisplayMemberPath = nameof(SignalGapVehicleOption.Label);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_vehicleSelect);

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(heading, 0);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(heading);
        grid.Children.Add(actions);
        return grid;
    }

    private void BuildCatalog()
    {
        _catalog.Children.Add(BuildSummary());
        _catalog.Children.Add(BuildControlsPanel());
        _catalog.Children.Add(BuildCatalogBody());
    }

    private Grid BuildSummary()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        TsStatCard[] cards = [_statTotal, _statActive, _statStale, _statNever];
        for (int i = 0; i < cards.Length; i++)
        {
            cards[i].HorizontalAlignment = HorizontalAlignment.Stretch;
            Grid.SetColumn(cards[i], i);
            grid.Children.Add(cards[i]);
        }

        return grid;
    }

    private TsGlassPanel BuildControlsPanel()
    {
        var body = new StackPanel { Spacing = 12, Padding = new Thickness(20) };

        // Row 1: search input (left) + refresh caption (right).
        var searchRow = new Grid { ColumnSpacing = 12 };
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _searchInput.HorizontalAlignment = HorizontalAlignment.Left;
        Grid.SetColumn(_searchInput, 0);

        var refreshCluster = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        var refreshIcon = new FontIcon { Glyph = RefreshGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(refreshIcon, AccessibilityView.Raw);
        refreshCluster.Children.Add(refreshIcon);
        refreshCluster.Children.Add(_refreshCaption);
        Grid.SetColumn(refreshCluster, 1);

        searchRow.Children.Add(_searchInput);
        searchRow.Children.Add(refreshCluster);
        body.Children.Add(searchRow);

        // Row 2: filter group (left) + sort group (right).
        var toggleRow = new Grid { ColumnSpacing = 12 };
        toggleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        toggleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var filterGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        filterGroup.Children.Add(GroupIcon(FilterGlyph));
        foreach (var (_, button) in _filterButtons)
        {
            filterGroup.Children.Add(button);
        }

        Grid.SetColumn(filterGroup, 0);

        var sortGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
        sortGroup.Children.Add(GroupIcon(SortGlyph));
        foreach (var (_, button) in _sortButtons)
        {
            sortGroup.Children.Add(button);
        }

        Grid.SetColumn(sortGroup, 1);

        toggleRow.Children.Add(filterGroup);
        toggleRow.Children.Add(sortGroup);
        body.Children.Add(toggleRow);

        _controlsPanel.Content = body;
        return _controlsPanel;
    }

    private StackPanel BuildCatalogBody()
    {
        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(_catalogLoading);
        body.Children.Add(_catalogErrorBanner);
        body.Children.Add(_table);
        body.Children.Add(_catalogEmpty);
        body.Children.Add(_lastRefreshed);
        return body;
    }

    private static FontIcon GroupIcon(string glyph)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
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

    private void Render(SignalGapDetectorDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);

        // Header — vehicle picker (web VehicleSelect).
        _vehicleSelect.ItemsSource = display.VehicleOptions;
        _vehicleSelect.SelectedItem = display.VehicleOptions.FirstOrDefault(o => o.Id == display.SelectedVehicleId);
        _vehicleSelect.Visibility = Show(display.VehicleOptions.Count > 0);
        AutomationProperties.SetName(_vehicleSelect, display.SelectVehicleLabel);

        // Fleet-failure banner.
        _errorBanner.IsOpen = display.HasError;
        _errorBanner.Visibility = Show(display.HasError);
        _errorBanner.Message = display.ErrorBannerText;

        // Loading scaffold vs the body.
        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        // No-vehicle empty state (web !vehicleId).
        _noVehicleEmpty.Visibility = Show(display.ShowNoVehicle);
        _noVehicleEmpty.Title = display.NoVehicleTitle;
        _noVehicleEmpty.Message = display.NoVehicleMessage;

        // Catalog region (web SignalCatalogPanel).
        _catalog.Visibility = Show(display.ShowCatalog);
        if (display.ShowCatalog)
        {
            RenderStats(display.Stats);
            RenderControls(display);
            RenderCatalogBody(display);
        }

        _suppressEvents = false;
    }

    private void RenderStats(IReadOnlyList<SignalGapStatDisplay> stats)
    {
        TsStatCard[] cards = [_statTotal, _statActive, _statStale, _statNever];
        for (int i = 0; i < cards.Length && i < stats.Count; i++)
        {
            cards[i].Label = stats[i].Label;
            cards[i].Value = stats[i].Value;
            cards[i].Glyph = stats[i].Glyph;
        }
    }

    private void RenderControls(SignalGapDetectorDisplay display)
    {
        _searchInput.Hint = display.SearchHint;
        if (_searchInput.Text != display.Search)
        {
            _searchInput.Text = display.Search;
        }

        AutomationProperties.SetName(_searchInput, display.SearchLabel);

        _refreshCaption.Value = display.RefreshIntervalText;
        AutomationProperties.SetName(_controlsPanel, display.Title);

        foreach (var option in display.FilterOptions)
        {
            var button = _filterButtons.First(f => f.Mode == option.Mode).Button;
            button.Text = option.Label;
            button.Variant = option.IsActive ? ButtonVariant.Primary : ButtonVariant.Subtle;
            AutomationProperties.SetName(button, option.Label);
        }

        foreach (var option in display.SortOptions)
        {
            var button = _sortButtons.First(s => s.Mode == option.Mode).Button;
            button.Text = option.Label;
            button.Variant = option.IsActive ? ButtonVariant.Primary : ButtonVariant.Subtle;
            AutomationProperties.SetName(button, option.Label);
        }
    }

    private void RenderCatalogBody(SignalGapDetectorDisplay display)
    {
        _catalogLoading.Visibility = Show(display.ShowCatalogLoading);

        _catalogErrorBanner.IsOpen = display.ShowCatalogError;
        _catalogErrorBanner.Visibility = Show(display.ShowCatalogError);
        _catalogErrorBanner.Message = display.CatalogErrorText;

        _table.Visibility = Show(display.ShowTable);
        if (display.ShowTable)
        {
            _table.Columns = BuildColumns(display.Columns);
            _table.Rows = BuildRows(display.Rows);
            _table.PageSize = 50;
            _table.EmptyMessage = display.TableEmptyMessage;
        }

        _catalogEmpty.Visibility = Show(display.ShowCatalogEmpty);
        _catalogEmpty.Title = display.CatalogEmptyText;

        _lastRefreshed.Visibility = Show(display.ShowLastRefreshed);
        _lastRefreshed.Value = display.LastRefreshedText;
    }

    private static List<TsDataColumn> BuildColumns(IReadOnlyList<SignalGapColumnDisplay> columns)
    {
        var result = new List<TsDataColumn>(columns.Count);
        foreach (var column in columns)
        {
            result.Add(new TsDataColumn
            {
                Key = column.Key,
                Header = column.Header,
                Width = column.Width,
                IsNumeric = column.IsNumeric,
                CanSort = false,
                CanResize = false,
            });
        }

        return result;
    }

    private static List<TsDataRow> BuildRows(IReadOnlyList<SignalGapRowDisplay> rows)
    {
        var result = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["status"] = row.Status,
                ["signal"] = row.Signal,
                ["value"] = row.Value,
                ["lastUpdated"] = row.LastUpdated,
                ["timeSince"] = row.TimeSince,
            };
            result.Add(new TsDataRow(row.RowKey, values));
        }

        return result;
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressEvents || _vehicleSelect.SelectedItem is not SignalGapVehicleOption option)
        {
            return;
        }

        if (option.Id != _viewModel.SelectedVehicleId)
        {
            InvokeAsync(() => _viewModel.SelectVehicleAsync(option.Id));
        }
    }

    private void OnSearchChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSearch(_searchInput.Text);
    }

    private void OnFilterClick(SignalGapFilterMode mode)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetFilterMode(mode);
    }

    private void OnSortClick(SignalGapSortMode mode)
    {
        if (_suppressEvents)
        {
            return;
        }

        _viewModel.SetSortMode(mode);
    }

    private static async void InvokeAsync(Func<Task> action)
    {
        await action().ConfigureAwait(true);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    protected override AutomationPeer OnCreateAutomationPeer() => new FrameworkElementAutomationPeer(this);
}
