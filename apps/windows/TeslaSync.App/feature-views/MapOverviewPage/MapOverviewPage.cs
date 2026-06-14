using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Maps;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The native WinUI 3 <c>MapOverviewPage</c> — a parity port of the web page
/// <c>web/src/features/maps/pages/MapOverviewPage.tsx</c> (route <c>/live</c>, nav name <c>LiveMap</c>). It binds
/// to a <see cref="MapOverviewPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header (title + subtitle + vehicle picker + data-freshness + live indicator), the
/// load-failure and no-GPS banners, the live map (layer switcher + marker + GPS trail), the recent route
/// playback, the four vehicle-status metric cards (current speed / heading / lat-lon / last-updated), the
/// location-detail rows (at home / at work / HomeLink / odometer), the quick links and the recent
/// location-history table — each with its loading / empty surface. When no vehicle is selected it shows the
/// shared <see cref="NoVehicleSelected"/> onboarding surface (web early return). The view is a thin renderer:
/// all branch selection, formatting and i18n happen in the view-model's <see cref="MapOverviewDisplay"/>
/// projection. State changes are marshalled onto the UI thread, and the latest position auto-refreshes every
/// 15 seconds (web <c>refetchInterval: 15_000</c>).
/// </summary>
public sealed partial class MapOverviewPage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const double PanelPadding = 20;
    private const double MapHeight = 360;
    private const int AutoRefreshSeconds = 15;
    private const int MapZoom = 15;

    private readonly MapOverviewPageViewModel _viewModel;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
    private readonly DispatcherTimer _refreshTimer = new() { Interval = TimeSpan.FromSeconds(AutoRefreshSeconds) };
    private bool _disposed;
    private bool _syncingVehicle;

    // ── Top-level surfaces ──
    private readonly Grid _root = new();
    private readonly TsPageContainer _scaffold = new();
    private NoVehicleSelected? _noVehicleHost;

    // ── Header actions ──
    private readonly TsVehicleSelect _vehicleSelect = new() { MinWidth = 200 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsLiveIndicator _live = new() { VerticalAlignment = VerticalAlignment.Center };

    // ── Banners ──
    private readonly TsLiveStaleDataBanner _staleBanner = new() { IsOpen = false, Visibility = Visibility.Collapsed };
    private readonly TsAlertBanner _errorBanner = new() { Variant = CalloutVariant.Danger, Visibility = Visibility.Collapsed };
    private readonly TsAlertBanner _noGpsBanner = new() { Variant = CalloutVariant.Info, Visibility = Visibility.Collapsed };

    // ── Map (GlassPanel1) ──
    private readonly TsGlassPanel _mapPanel = new();
    private readonly Grid _mapHost = new();
    private readonly TsMapControl _map = new() { MinHeight = MapHeight };
    private readonly TsMapLayerSwitcher _layerSwitcher = new() { HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 8, 8, 0) };
    private readonly TsMapInvalidator _mapInvalidator = new();
    private readonly TsMapMarker _marker = new();
    private readonly TsMapPolyline _trail = new();
    private readonly TsEmptyState _mapEmpty = new() { IconGlyph = MapOverviewProjection.MapPinGlyph, MinHeight = MapHeight, Visibility = Visibility.Collapsed };
    private bool _mapOverlaysAttached;

    // ── Route playback (GlassPanel2) ──
    private readonly TsFadeIn _playbackSection = new() { DelayMs = 40, Visibility = Visibility.Collapsed };
    private readonly SectionTitle _playbackTitle = new();
    private readonly TsRoutePlayback _playback = new();

    // ── Metric cards (Current-Speed / Heading / Lat-Lon / Last-Updated) ──
    private readonly TsFadeIn _metricsSection = new() { DelayMs = 60 };
    private readonly Grid _metricsGrid = new() { ColumnSpacing = 16, RowSpacing = 16 };

    // ── Location details (GlassPanel7) ──
    private readonly SectionTitle _detailsTitle = new();
    private readonly Grid _detailsGrid = new() { ColumnSpacing = 16, RowSpacing = 16 };
    private readonly TsEmptyState _detailsEmpty = new() { Visibility = Visibility.Collapsed };

    // ── Quick links (GlassPanel8) ──
    private readonly Caption _quickLinksTitle = new();
    private readonly StackPanel _quickLinksRow = new() { Orientation = Orientation.Horizontal, Spacing = 12 };

    // ── Recent history (GlassPanel9) ──
    private readonly SectionTitle _historyTitle = new();
    private readonly TsDataColumn _colTime = new() { Key = "time", CanResize = false, Width = 200 };
    private readonly TsDataColumn _colLat = new() { Key = "lat", CanResize = false, Width = 110, IsNumeric = true };
    private readonly TsDataColumn _colLon = new() { Key = "lon", CanResize = false, Width = 110, IsNumeric = true };
    private readonly TsDataColumn _colSpeed = new() { Key = "speed", CanResize = false, Width = 110 };
    private readonly TsDataColumn _colHeading = new() { Key = "heading", CanResize = false, Width = 110 };
    private readonly TsDataTable _historyTable = new() { Selectable = false, PageSize = 10 };
    private readonly TsSkeleton _historySkeleton = new() { BlockHeight = 200, Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _historyEmpty = new() { IconGlyph = MapOverviewProjection.ClockGlyph, Visibility = Visibility.Collapsed };

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public MapOverviewPage()
        : this(EmptyMapOverviewFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The map-overview data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public MapOverviewPage(IMapOverviewFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new MapOverviewPageViewModel(feed, localizer);

        Content = BuildLayout();

        _vehicleSelect.SelectionChanged += OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested += OnRetryInvoked;
        _layerSwitcher.StyleSelected += OnMapStyleSelected;
        _scaffold.RetryRequested += OnRetryInvoked;
        _errorBanner.ActionInvoked += OnRetryInvoked;
        _refreshTimer.Tick += OnRefreshTick;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>Raised when an in-page link requests navigation to another route (web <c>Link to</c>).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell registers this page under (<c>LiveMap</c>).</summary>
    public static string RouteName => MapOverviewRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public MapOverviewPageViewModel ViewModel => _viewModel;

    private Grid BuildLayout()
    {
        _scaffold.Title = _viewModel.Display.Title;
        _scaffold.Subtitle = _viewModel.Display.Subtitle;
        _scaffold.AddHeaderAction(_vehicleSelect);
        _scaffold.AddHeaderAction(_freshness);
        _scaffold.AddHeaderAction(_live);
        _scaffold.PageContent = BuildScrollableContent();

        _root.Children.Add(_scaffold);
        return _root;
    }

    private ScrollViewer BuildScrollableContent()
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(_staleBanner);
        stack.Children.Add(_errorBanner);
        stack.Children.Add(_noGpsBanner);
        stack.Children.Add(new TsFadeIn { Content = BuildMapPanel() });
        stack.Children.Add(BuildPlaybackPanel());
        stack.Children.Add(BuildMetricsSection());
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildLocationDetailsPanel() });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildQuickLinksPanel() });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = BuildHistoryPanel() });

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildMapPanel()
    {
        _map.HorizontalAlignment = HorizontalAlignment.Stretch;
        _map.VerticalAlignment = VerticalAlignment.Stretch;

        _mapHost.Children.Add(_map);
        _mapHost.Children.Add(_layerSwitcher);
        _mapHost.Children.Add(_mapInvalidator);
        _mapHost.Children.Add(_mapEmpty);
        _mapHost.MinHeight = MapHeight;

        _mapPanel.Padding = new Thickness(0);
        _mapPanel.Content = _mapHost;
        return _mapPanel;
    }

    private TsFadeIn BuildPlaybackPanel()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_playbackTitle);
        column.Children.Add(_playback);
        _playbackSection.Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        return _playbackSection;
    }

    private TsFadeIn BuildMetricsSection()
    {
        _metricsSection.Content = _metricsGrid;
        return _metricsSection;
    }

    private TsGlassPanel BuildLocationDetailsPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_detailsTitle);
        column.Children.Add(_detailsGrid);
        column.Children.Add(_detailsEmpty);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsGlassPanel BuildQuickLinksPanel()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_quickLinksTitle);
        column.Children.Add(_quickLinksRow);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsGlassPanel BuildHistoryPanel()
    {
        _historyTable.Columns = new[] { _colTime, _colLat, _colLon, _colSpeed, _colHeading };

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(_historyTitle);
        column.Children.Add(_historySkeleton);
        column.Children.Add(_historyTable);
        column.Children.Add(_historyEmpty);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _mapInvalidator.Attach(_map);
        _viewModel.NotifyOpened();
        _refreshTimer.Start();
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
        _refreshTimer.Stop();
        _refreshTimer.Tick -= OnRefreshTick;
        _vehicleSelect.SelectionChanged -= OnVehicleSelectionChanged;
        _vehicleSelect.RetryRequested -= OnRetryInvoked;
        _layerSwitcher.StyleSelected -= OnMapStyleSelected;
        _scaffold.RetryRequested -= OnRetryInvoked;
        _errorBanner.ActionInvoked -= OnRetryInvoked;
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

    private void OnRefreshTick(object? sender, object e) => _ = _viewModel.RefreshLatestAsync();

    private void OnMapStyleSelected(object? sender, MapStyleKind style) => _viewModel.SetMapStyle(MapStyles.Id(style));

    private void OnVehicleSelectionChanged(object? sender, long? vehicleId)
    {
        if (_syncingVehicle)
        {
            return;
        }

        _ = _viewModel.SelectVehicleAsync(vehicleId);
    }

    private void Render(MapOverviewDisplay display)
    {
        AutomationProperties.SetName(this, display.AutomationName);

        if (display.ShowNoVehicle)
        {
            ShowNoVehicleSurface(display);
            return;
        }

        if (_noVehicleHost is not null)
        {
            _noVehicleHost.Visibility = Visibility.Collapsed;
        }

        _scaffold.Visibility = Visibility.Visible;
        _scaffold.Title = display.Title;
        _scaffold.Subtitle = display.Subtitle;
        _scaffold.IsLoading = display.PageLoading;
        _scaffold.ErrorMessage = display.PageError;

        RenderHeaderActions(display);
        RenderBanners(display);
        RenderMap(display);
        RenderPlayback(display);
        RenderMetrics(display);
        RenderLocationDetails(display);
        RenderQuickLinks(display);
        RenderHistory(display);
    }

    private void ShowNoVehicleSurface(MapOverviewDisplay display)
    {
        _scaffold.Visibility = Visibility.Collapsed;

        if (_noVehicleHost is null)
        {
            _noVehicleHost = new NoVehicleSelected(new OnboardingNavigator(this), ShellLocalizer.Instance, display.Title);
            _root.Children.Add(_noVehicleHost);
        }

        _noVehicleHost.Visibility = Visibility.Visible;
    }

    private void RenderHeaderActions(MapOverviewDisplay display)
    {
        _syncingVehicle = true;
        _vehicleSelect.SetLoaded(BuildVehicleOptions());
        if (_viewModel.VehiclesLoading)
        {
            _vehicleSelect.SetLoading();
        }
        else if (_viewModel.VehiclesError is { } error)
        {
            _vehicleSelect.SetError(error);
        }

        _vehicleSelect.SelectedId = _viewModel.SelectedVehicleId;
        _vehicleSelect.PromptText = display.Title;
        _syncingVehicle = false;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _live.State = _viewModel.IsError ? LiveConnectionState.Disconnected
            : _viewModel.IsFetching ? LiveConnectionState.Reconnecting
            : LiveConnectionState.Connected;
    }

    private List<VehicleOption> BuildVehicleOptions()
    {
        var options = new List<VehicleOption>(_viewModel.Vehicles.Count);
        foreach (var vehicle in _viewModel.Vehicles)
        {
            options.Add(new VehicleOption(vehicle.Id, vehicle.DisplayName));
        }

        return options;
    }

    private void RenderBanners(MapOverviewDisplay display)
    {
        _errorBanner.Message = display.ErrorBannerText;
        _errorBanner.IsOpen = display.ShowErrorBanner;
        _errorBanner.Visibility = display.ShowErrorBanner ? Visibility.Visible : Visibility.Collapsed;

        _noGpsBanner.Message = display.NoGpsBannerText;
        _noGpsBanner.IsOpen = display.ShowNoGpsBanner;
        _noGpsBanner.Visibility = display.ShowNoGpsBanner ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderMap(MapOverviewDisplay display)
    {
        _mapEmpty.Message = display.MapEmptyMessage;
        _layerSwitcher.SelectedStyle = MapStyles.FromId(display.MapStyleId);

        if (!display.HasValidLocation)
        {
            _map.Visibility = Visibility.Collapsed;
            _layerSwitcher.Visibility = Visibility.Collapsed;
            _mapEmpty.Visibility = Visibility.Visible;
            return;
        }

        _map.Visibility = Visibility.Visible;
        _layerSwitcher.Visibility = Visibility.Visible;
        _mapEmpty.Visibility = Visibility.Collapsed;

        EnsureMapOverlays();
        _map.MapStyle = MapStyles.FromId(display.MapStyleId);
        _map.CenterLat = display.MapCenterLat;
        _map.CenterLng = display.MapCenterLng;
        _map.Zoom = MapZoom;

        _marker.Location = new GeoPoint(display.MarkerLat, display.MarkerLng);
        _marker.LabelText = display.MarkerLabel;
        _trail.SetPoints(display.Trail);
        _trail.SetStroke(new SolidColorBrush(Windows.UI.Color.FromArgb(0xFF, 0x00, 0xF0, 0xFF)));
        _map.SetHasGeometry(true);
        _map.Invalidate();
    }

    private void EnsureMapOverlays()
    {
        if (_mapOverlaysAttached)
        {
            return;
        }

        _map.AddOverlay(_trail);
        _map.AddOverlay(_marker);
        _mapOverlaysAttached = true;
    }

    private void RenderPlayback(MapOverviewDisplay display)
    {
        _playbackTitle.Value = display.PlaybackTitle;
        _playback.PlayLabel = display.PlayLabel;
        _playback.PauseLabel = display.PauseLabel;
        AutomationProperties.SetName(_playback, display.PlaybackAriaLabel);

        if (display.ShowPlayback)
        {
            _playback.SetTrail(display.PlaybackPoints);
            _playbackSection.Visibility = Visibility.Visible;
        }
        else
        {
            _playbackSection.Visibility = Visibility.Collapsed;
        }
    }

    private void RenderMetrics(MapOverviewDisplay display)
    {
        if (display.MetricsLoading)
        {
            var skeletons = new List<FrameworkElement>(4);
            for (int i = 0; i < 4; i++)
            {
                skeletons.Add(new TsSkeleton { BlockHeight = 88 });
            }

            FillColumnsGrid(_metricsGrid, 4, skeletons);
            _metricsSection.Visibility = Visibility.Visible;
            return;
        }

        if (!display.HasLatest || display.Metrics.Count == 0)
        {
            _metricsGrid.Children.Clear();
            _metricsSection.Visibility = Visibility.Collapsed;
            return;
        }

        var cards = new List<FrameworkElement>(display.Metrics.Count);
        foreach (var metric in display.Metrics)
        {
            var card = new TsMetricCard { Label = metric.Label, Value = metric.Value, AccentBrushKey = metric.AccentBrushKey };
            AutomationProperties.SetName(card, metric.Subtitle is { Length: > 0 } sub
                ? $"{metric.Label}: {metric.Value}. {sub}"
                : $"{metric.Label}: {metric.Value}");
            cards.Add(card);
        }

        FillColumnsGrid(_metricsGrid, 4, cards);
        _metricsSection.Visibility = Visibility.Visible;
    }

    private void RenderLocationDetails(MapOverviewDisplay display)
    {
        _detailsTitle.Value = display.LocationDetailsTitle;
        _detailsEmpty.Message = display.LocationEmptyMessage;

        if (!display.HasLocationDetails || display.LocationDetails.Count == 0)
        {
            _detailsGrid.Children.Clear();
            _detailsGrid.Visibility = Visibility.Collapsed;
            _detailsEmpty.Visibility = Visibility.Visible;
            return;
        }

        _detailsGrid.Visibility = Visibility.Visible;
        _detailsEmpty.Visibility = Visibility.Collapsed;

        var rows = new List<FrameworkElement>(display.LocationDetails.Count);
        foreach (var detail in display.LocationDetails)
        {
            rows.Add(BuildDetailRow(detail));
        }

        FillColumnsGrid(_detailsGrid, 4, rows);
    }

    private static StackPanel BuildDetailRow(LocationDetailDisplay detail)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };

        var glyph = new FontIcon { Glyph = detail.Glyph, FontSize = 18, VerticalAlignment = VerticalAlignment.Center };
        var glyphBrush = DisplayTokens.Brush(detail.GlyphBrushKey);
        if (glyphBrush is not null)
        {
            glyph.Foreground = glyphBrush;
        }

        row.Children.Add(glyph);

        var label = new Text { Value = detail.Label, VerticalAlignment = VerticalAlignment.Center };
        label.Width = 110;
        row.Children.Add(label);

        if (detail.ShowBadge)
        {
            var badge = new TsBadge { Status = ToStatus(detail.BadgeStatus), Dot = detail.BadgeDot, Content = detail.BadgeText };
            badge.VerticalAlignment = VerticalAlignment.Center;
            row.Children.Add(badge);
        }
        else
        {
            row.Children.Add(new Text
            {
                Value = detail.ValueText,
                VerticalAlignment = VerticalAlignment.Center,
                FontWeight = FontWeights.SemiBold,
            });
        }

        AutomationProperties.SetName(row, detail.ShowBadge ? $"{detail.Label}: {detail.BadgeText}" : $"{detail.Label}: {detail.ValueText}");
        return row;
    }

    private void RenderQuickLinks(MapOverviewDisplay display)
    {
        _quickLinksTitle.Value = display.QuickLinksTitle;
        _quickLinksRow.Children.Clear();

        foreach (var link in display.QuickLinks)
        {
            var button = new TsButton { Variant = ButtonVariant.Outline, Text = link.Label, IconGlyph = link.Glyph };
            string route = link.Route;
            button.Click += (_, _) => NavigationRequested?.Invoke(this, route);
            AutomationProperties.SetName(button, link.Label);
            _quickLinksRow.Children.Add(button);
        }
    }

    private void RenderHistory(MapOverviewDisplay display)
    {
        _historyTitle.Value = display.RecentHistoryTitle;
        _colTime.Header = display.ColTime;
        _colLat.Header = display.ColLat;
        _colLon.Header = display.ColLon;
        _colSpeed.Header = display.ColSpeed;
        _colHeading.Header = display.ColHeading;
        _historyTable.EmptyMessage = display.HistoryEmptyMessage;
        _historyEmpty.Message = display.HistoryEmptyMessage;

        if (display.HistoryLoading)
        {
            _historySkeleton.Visibility = Visibility.Visible;
            _historyTable.Visibility = Visibility.Collapsed;
            _historyEmpty.Visibility = Visibility.Collapsed;
            return;
        }

        _historySkeleton.Visibility = Visibility.Collapsed;

        if (!display.HasHistory)
        {
            _historyTable.Visibility = Visibility.Collapsed;
            _historyEmpty.Visibility = Visibility.Visible;
            return;
        }

        _historyTable.Visibility = Visibility.Visible;
        _historyEmpty.Visibility = Visibility.Collapsed;
        _historyTable.Rows = BuildHistoryRows(display.HistoryRows);
    }

    private static List<TsDataRow> BuildHistoryRows(IReadOnlyList<HistoryRowDisplay> rows)
    {
        var result = new List<TsDataRow>(rows.Count);
        foreach (var row in rows)
        {
            var values = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["time"] = row.Time,
                ["lat"] = row.Lat,
                ["lon"] = row.Lon,
                ["speed"] = row.Speed,
                ["heading"] = row.Heading,
            };
            result.Add(new TsDataRow(row.Id, values));
        }

        return result;
    }

    private static StatusKind ToStatus(int status) => status switch
    {
        2 => StatusKind.Success,
        1 => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

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

    /// <summary>
    /// Adapts the page's <see cref="NavigationRequested"/> event to the <see cref="INoVehicleSelectedNavigator"/>
    /// seam so the no-vehicle onboarding call-to-action routes through the shell (web <c>navigate('/onboarding')</c>).
    /// </summary>
    private sealed class OnboardingNavigator(MapOverviewPage owner) : INoVehicleSelectedNavigator
    {
        public void NavigateToOnboarding() =>
            owner.NavigationRequested?.Invoke(owner, NoVehicleSelectedRegistration.OnboardingRouteName);
    }
}
