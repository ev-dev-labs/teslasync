using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The native WinUI 3 <c>AnalyticsPage</c> — a parity port of the web page
/// <c>web/src/features/analytics/pages/AnalyticsPage.tsx</c> (route <c>/analytics</c>, nav name
/// <c>Analytics</c>). It binds to an <see cref="AnalyticsPageViewModel"/> over the single
/// <c>useFleetAnalytics</c> read and renders every web region with Fluent components and design tokens: the
/// page header (title + subtitle + data-freshness chip), the loading shimmer, the retriable error surface,
/// and — in the success state — the <c>HeroGauges</c> strip plus the four-tab body (Overview / Driving /
/// Charging / Battery), each tab a separately-shipped parity surface. The page owns the page's one fleet
/// fetch and feeds every tab from it: the self-fetching Hero / Overview / Charging surfaces are replayed
/// through their own result mappers, and the presentational Driving / Battery surfaces are handed models
/// parsed from the same snapshot. The view is a thin renderer: all branch selection, formatting and i18n
/// happen in the view-model's <see cref="AnalyticsDisplay"/> projection. State changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class AnalyticsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;

    private readonly AnalyticsPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    // Success body: the hero strip plus the four-tab navigator (built once; the surfaces inside are
    // (re)composed whenever a new snapshot resolves).
    private readonly ContentControl _heroHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly ContentControl _overviewHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly ContentControl _chargingHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly DrivingTab _drivingTab;
    private readonly BatteryTab _batteryTab;
    private readonly TsTabs _tabView = new();
    private readonly TabViewItem[] _tabItems = new TabViewItem[4];

    private int _renderedDataVersion = -1;
    private bool _syncingSelection;

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public AnalyticsPage()
        : this(EmptyAnalyticsFleetFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The fleet-analytics data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AnalyticsPage(IAnalyticsFleetFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AnalyticsPageViewModel(feed, localizer);
        _drivingTab = new DrivingTab(localizer, DrivingTabModel.Pending, _viewModel.Units);
        _batteryTab = new BatteryTab(localizer, _viewModel.Units, BatteryTabModel.Pending);

        AutomationProperties.SetLandmarkType(this, AutomationLandmarkType.Main);

        BuildLoadingSkeleton();
        BuildSuccessBody();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _drivingTab.RetryRequested += OnRetryInvoked;
        _tabView.SelectionChanged += OnTabSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Analytics</c>).</summary>
    public static string RouteName => AnalyticsRegistration.RouteName;

    /// <summary>Raised when an in-page link (Overview Quick Links) requests navigation to an in-app route.</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AnalyticsPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
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
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 96 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 48 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 280 });
    }

    private void BuildSuccessBody()
    {
        _tabItems[0] = NewTabItem(AnalyticsTabKey.Overview, _overviewHost);
        _tabItems[1] = NewTabItem(AnalyticsTabKey.Driving, _drivingTab);
        _tabItems[2] = NewTabItem(AnalyticsTabKey.Charging, _chargingHost);
        _tabItems[3] = NewTabItem(AnalyticsTabKey.Battery, _batteryTab);

        foreach (var item in _tabItems)
        {
            _tabView.TabItems.Add(item);
        }

        _tabView.SelectedIndex = 0;
        _tabView.MinHeight = 360;

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(_heroHost);
        body.Children.Add(_tabView);
        _contentHost.Content = body;
    }

    private static TabViewItem NewTabItem(AnalyticsTabKey key, UIElement content) => new()
    {
        Tag = key,
        IsClosable = false,
        Content = content,
    };

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

    /// <summary>Unsubscribe from and dispose the view-model and the composed sub-surfaces (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _drivingTab.RetryRequested -= OnRetryInvoked;
        _tabView.SelectionChanged -= OnTabSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;

        DisposeContent(_heroHost);
        DisposeContent(_overviewHost);
        DisposeContent(_chargingHost);
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

    private void OnTabSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingSelection)
        {
            return;
        }

        if (_tabView.SelectedItem is TabViewItem { Tag: AnalyticsTabKey key })
        {
            _viewModel.SetActiveTab(key);
        }
    }

    private void Render(AnalyticsDisplay display)
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

        _contentHost.Visibility = Show(display.ShowContent);

        UpdateTabHeaders(display.Tabs);

        if (display.ShowContent && _renderedDataVersion != _viewModel.DataVersion)
        {
            RebuildTabSurfaces();
            _renderedDataVersion = _viewModel.DataVersion;
        }

        SyncSelection(display.ActiveTab);
    }

    private void UpdateTabHeaders(IReadOnlyList<AnalyticsTabItem> tabs)
    {
        for (int i = 0; i < _tabItems.Length && i < tabs.Count; i++)
        {
            var tab = tabs[i];
            _tabItems[i].Header = tab.Label;
            _tabItems[i].IconSource = new FontIconSource { Glyph = tab.Glyph };
            AutomationProperties.SetName(_tabItems[i], tab.AutomationName);
        }
    }

    private void RebuildTabSurfaces()
    {
        var snapshot = _viewModel.Snapshot;
        var units = _viewModel.Units;
        var currency = _viewModel.CurrencySymbol;
        var raw = snapshot.RawFleet;

        var hero = new HeroGauges(new ReplayHeroGaugesSource(raw), _localizer, units, currency);
        SwapContent(_heroHost, hero);

        var overview = new OverviewTab(new ReplayOverviewTabSource(raw), _localizer, units);
        overview.QuickLinkInvoked += OnQuickLinkInvoked;
        SwapContent(_overviewHost, overview);

        var charging = new ChargingTab(new ReplayChargingTabSource(raw), _localizer, currencySymbol: currency);
        SwapContent(_chargingHost, charging);

        _drivingTab.Units = units;
        _drivingTab.Model = AnalyticsProjection.BuildDrivingModel(snapshot);

        _batteryTab.Units = units;
        _batteryTab.Model = AnalyticsProjection.BuildBatteryModel(snapshot);
    }

    private void OnQuickLinkInvoked(object? sender, string route) => NavigationRequested?.Invoke(this, route);

    private void SyncSelection(AnalyticsTabKey active)
    {
        int index = active switch
        {
            AnalyticsTabKey.Driving => 1,
            AnalyticsTabKey.Charging => 2,
            AnalyticsTabKey.Battery => 3,
            _ => 0,
        };

        if (_tabView.SelectedIndex == index)
        {
            return;
        }

        _syncingSelection = true;
        _tabView.SelectedIndex = index;
        _syncingSelection = false;
    }

    private static void SwapContent(ContentControl host, UIElement content)
    {
        DisposeContent(host);
        host.Content = content;
    }

    private static void DisposeContent(ContentControl host)
    {
        if (host.Content is IDisposable disposable)
        {
            disposable.Dispose();
        }

        host.Content = null;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
