using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 <c>VehicleListPage</c> — a parity port of the web page
/// <c>web/src/features/vehicles/pages/VehicleListPage.tsx</c> (route <c>/vehicles</c>, nav name <c>Vehicles</c>).
/// It composes the shared <see cref="PageContainer"/> chrome (the "Fleet" title, the subtitle and the header
/// actions cluster — the data-freshness chip, the Compare-vehicles affordance and the Sync-from-Tesla button)
/// around the web section stack: the conditional Sync success / error banners, then one of the four
/// mutually-exclusive data states — the loading skeleton (stat-grid + card skeletons), the friendly empty state,
/// the retriable error panel, or the populated stack (the four-up fleet-summary tiles, the Fleet Battery Status
/// panel and the pinned-first vehicle cards each with their status badge, battery, live stats, lock / Sentry
/// flags and the pin / view-details / remove actions). The Remove action opens a destructive confirmation
/// dialog. The view is a thin renderer — every branch, format and i18n string comes from the
/// <see cref="VehicleListPageViewModel"/> / <see cref="VehicleListProjection"/>; units convert at the display
/// boundary only; state changes are marshalled onto the UI thread; every region carries an
/// <c>AutomationProperties</c> name and honours light / dark and reduced motion.
/// </summary>
public sealed partial class VehicleListPage : UserControl, IDisposable
{
    private const double SectionSpacing = 32;      // web space-y-8
    private const double StackSpacing = 16;        // web space-y-4 (card list)
    private const double PanelPadding = 20;        // web p-5
    private const double BannerPadding = 16;       // web p-4
    private const double TileSpacing = 16;         // web gap-4
    private const double TilePadding = 16;
    private const double TileIconSize = 20;        // web h-5 w-5
    private const double SkeletonHeight = 112;     // web h-28 card skeleton
    private const double WideBreakpoint = 1024;    // web lg: (grid-cols-4)
    private const double MediumBreakpoint = 640;   // web sm: (grid-cols-2)

    private readonly VehicleListPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly VehicleListPageDiagnostics _diagnostics;
    private readonly IPinStore _pinStore;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();

    private readonly PageContainer _container;

    // Header actions.
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _compareButton = new()
    {
        Variant = ButtonVariant.Outline,
        IconGlyph = VehicleListPageRegistration.CompareGlyph,
        VerticalAlignment = VerticalAlignment.Center,
        Visibility = Visibility.Collapsed,
    };

    private readonly TsButton _syncButton = new()
    {
        Variant = ButtonVariant.Primary,
        IconGlyph = VehicleListPageRegistration.RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Body hosts.
    private readonly TsAlertBanner _noticeBanner = new() { Dismissible = true, IsOpen = false, Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _syncSuccessBanner = new() { Padding = new Thickness(BannerPadding), Visibility = Visibility.Collapsed };
    private readonly TextBlock _syncSuccessText = new() { TextWrapping = TextWrapping.Wrap, FontSize = 14, Foreground = DisplayTokens.Brush("TsColorSuccessBrush") };
    private readonly TsGlassPanel _syncErrorBanner = new() { Padding = new Thickness(BannerPadding), Visibility = Visibility.Collapsed };
    private readonly TextBlock _syncErrorText = new() { TextWrapping = TextWrapping.Wrap, FontSize = 14, Foreground = DisplayTokens.Brush("TsColorDangerBrush") };

    private readonly StackPanel _successBody = new() { Spacing = SectionSpacing };
    private readonly Grid _summaryGrid = new() { ColumnSpacing = TileSpacing, RowSpacing = TileSpacing };
    private readonly TsGlassPanel _batteryPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _allVehiclesHeading = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly StackPanel _vehicleStack = new() { Spacing = StackSpacing };

    private readonly StackPanel _loadingHost = new() { Spacing = SectionSpacing, Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _emptyHost = new() { IconGlyph = VehicleListPageRegistration.CarGlyph, Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _errorHost = new() { Padding = new Thickness(PanelPadding), Visibility = Visibility.Collapsed };
    private readonly TextBlock _errorText = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, FontSize = 14, Foreground = DisplayTokens.Brush("TsColorDangerBrush") };

    private bool _started;
    private bool _disposed;
    private bool _ownsSettings;
    private bool _renderQueued;
    private int _summaryColumns = 4;

    /// <summary>Creates the page over the default empty source + no-op mutations + the shell resource localizer.</summary>
    public VehicleListPage()
        : this(EmptyVehicleListSource.Instance, NullVehicleListMutations.Instance, ShellLocalizer.Instance, new InMemoryPinStore())
    {
        ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        _ownsSettings = true;
    }

    /// <summary>Creates the page over an explicit source, mutation port, localizer and pin store (tests / DI).</summary>
    /// <param name="source">The cache-then-network roster source.</param>
    /// <param name="mutations">The sync + remove mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="pinStore">The pin seam the per-card pin toggle binds.</param>
    public VehicleListPage(
        IVehicleListSource source,
        IVehicleListMutations mutations,
        ILocalizer localizer,
        IPinStore pinStore)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(mutations);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(pinStore);

        _localizer = localizer;
        _pinStore = pinStore;
        _diagnostics = new VehicleListPageDiagnostics();
        _viewModel = new VehicleListPageViewModel(source, mutations, localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        _container = new PageContainer(localizer, _viewModel.Display.Title);
        Content = BuildLayout();

        _compareButton.Click += OnCompareClick;
        _syncButton.Click += OnSyncClick;
        _emptyHost.ActionInvoked += OnEmptySyncInvoked;
        _noticeBanner.Dismissed += OnNoticeDismissed;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;

        Render();
    }

    /// <summary>Raised when an in-card affordance requests in-app navigation (the host routes it).</summary>
    public event EventHandler<string>? NavigationRequested;

    /// <summary>The navigation route name the shell registers this page under (<c>Vehicles</c>).</summary>
    public static string RouteName => VehicleListPageRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>VehicleListPage</c>).</summary>
    public static string Slug => VehicleListPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehicleListPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="VehicleListSource"/> +
    /// <see cref="VehicleListMutationsClient"/> from the shared data layer (the generated client + cache-then-network
    /// engine), binding the live unit preference.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="pinStore">The pin seam the per-card pin toggle binds.</param>
    /// <returns>The fully wired page.</returns>
    public static VehicleListPage Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        IPinStore pinStore)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(pinStore);

        var source = new VehicleListSource(api, engine, options);
        var mutations = new VehicleListMutationsClient(api);
        var page = new VehicleListPage(source, mutations, localizer, pinStore);

        page.ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += page.OnSettingsChanged;
        page._ownsSettings = true;
        return page;
    }

    private PageContainer BuildLayout()
    {
        // ── Header actions (web: freshness chip + Compare + Sync) ────────────────────────────────────────
        _compareButton.Text = _localizer.GetString(VehicleListPageRegistration.CompareButtonKey, VehicleListPageRegistration.CompareButtonFallback);
        _syncButton.Text = _localizer.GetString(VehicleListPageRegistration.SyncButtonKey, VehicleListPageRegistration.SyncButtonFallback);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right };
        actions.Children.Add(_freshness);
        actions.Children.Add(_compareButton);
        actions.Children.Add(_syncButton);

        // ── Sync banners (web GlassPanel2 success / GlassPanel3 error) ───────────────────────────────────
        _syncSuccessBanner.Content = _syncSuccessText;
        _syncErrorBanner.Content = _syncErrorText;
        AutomationProperties.SetName(_syncSuccessBanner, _localizer.GetString(VehicleListPageRegistration.SyncSuccessKey, VehicleListPageRegistration.SyncSuccessFallback));
        AutomationProperties.SetName(_syncErrorBanner, _localizer.GetString(VehicleListPageRegistration.SyncErrorKey, VehicleListPageRegistration.SyncErrorFallback));

        // ── All Vehicles heading (web Car icon + "All Vehicles") ─────────────────────────────────────────
        _allVehiclesHeading.Children.Add(new FontIcon { Glyph = VehicleListPageRegistration.CarGlyph, FontSize = 16, Foreground = DisplayTokens.Brush(VehicleListPageRegistration.TotalRangeColor), VerticalAlignment = VerticalAlignment.Center });
        _allVehiclesHeading.Children.Add(new TextBlock { Text = _localizer.GetString(VehicleListPageRegistration.AllVehiclesKey, VehicleListPageRegistration.AllVehiclesFallback), FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DisplayTokens.TextPrimary, VerticalAlignment = VerticalAlignment.Center });

        // ── Success body (web section stack) ──────────────────────────────────────────────────────────────
        _successBody.Children.Add(new TsFadeIn { DelayMs = 50, Content = _summaryGrid });
        _successBody.Children.Add(new TsFadeIn { DelayMs = 100, Content = _batteryPanel });
        _successBody.Children.Add(new TsFadeIn { DelayMs = 150, Content = _allVehiclesHeading });
        _successBody.Children.Add(_vehicleStack);

        // ── Loading skeleton (web VehicleListSkeleton) ──────────────────────────────────────────────────
        BuildLoadingSkeleton();

        // ── Empty + error hosts ─────────────────────────────────────────────────────────────────────────
        _emptyHost.Title = _localizer.GetString(VehicleListPageRegistration.EmptyTitleKey, VehicleListPageRegistration.EmptyTitleFallback);
        _emptyHost.Message = _localizer.GetString(VehicleListPageRegistration.EmptyMessageKey, VehicleListPageRegistration.EmptyMessageFallback);
        _emptyHost.ActionText = _localizer.GetString(VehicleListPageRegistration.SyncButtonKey, VehicleListPageRegistration.SyncButtonFallback);
        _errorHost.Content = _errorText;
        AutomationProperties.SetName(_errorHost, _localizer.GetString(VehicleListPageRegistration.LoadErrorKey, VehicleListPageRegistration.LoadErrorFallback));

        var stateHost = new Grid();
        stateHost.Children.Add(_successBody);
        stateHost.Children.Add(_loadingHost);
        stateHost.Children.Add(_emptyHost);
        stateHost.Children.Add(_errorHost);

        var root = new StackPanel { Spacing = StackSpacing };
        root.Children.Add(_noticeBanner);
        root.Children.Add(_syncSuccessBanner);
        root.Children.Add(_syncErrorBanner);
        root.Children.Add(stateHost);

        _container.Title = _localizer.GetString(VehicleListPageRegistration.NavVehiclesKey, VehicleListPageRegistration.NavVehiclesFallback);
        _container.Subtitle = _localizer.GetString(VehicleListPageRegistration.SubtitleKey, VehicleListPageRegistration.SubtitleFallback);
        _container.Actions = actions;
        _container.PageContent = root;
        return _container;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingHost.Children.Clear();
        _loadingHost.Children.Add(new TsStatGridSkeleton(4) { MinHeight = SkeletonHeight });
        _loadingHost.Children.Add(new TsSkeleton { BlockHeight = 144, Radius = 12 });
        var cards = new StackPanel { Spacing = 12 };
        for (int i = 0; i < 3; i++)
        {
            cards.Children.Add(new TsSkeleton { BlockHeight = SkeletonHeight, Radius = 12 });
        }

        _loadingHost.Children.Add(cards);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSettingsChanged(object? sender, AppSettings settings)
    {
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

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        int columns = ColumnsForWidth(e.NewSize.Width);
        if (columns != _summaryColumns)
        {
            _summaryColumns = columns;
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        _dispatcher.TryEnqueue(() =>
        {
            _renderQueued = false;
            Render();
        });
    }

    private void Render()
    {
        var display = _viewModel.Display;

        // Header actions reflect the live roster + sync state.
        _compareButton.Visibility = _viewModel.CanCompare ? Visibility.Visible : Visibility.Collapsed;
        _syncButton.IsLoading = _viewModel.IsSyncing;
        _syncButton.IsEnabled = !_viewModel.IsSyncing;
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == VehicleListState.Error;

        RenderNotice();
        RenderSyncBanners();

        _successBody.Visibility = display.State == VehicleListState.Success ? Visibility.Visible : Visibility.Collapsed;
        _loadingHost.Visibility = display.State == VehicleListState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _emptyHost.Visibility = display.State == VehicleListState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _errorHost.Visibility = display.State == VehicleListState.Error ? Visibility.Visible : Visibility.Collapsed;

        if (display.State == VehicleListState.Error)
        {
            _errorText.Text = display.LoadErrorMessage;
        }

        if (display.State == VehicleListState.Success)
        {
            RenderSummary(display);
            RenderBatteryPanel(display);
            RenderVehicleCards(display);
        }
    }

    // ── Transient toast notice (web toast.success / toast.error) ─────────────────────────────────────────

    private void RenderNotice()
    {
        if (string.IsNullOrEmpty(_viewModel.Notice))
        {
            _noticeBanner.Visibility = Visibility.Collapsed;
            _noticeBanner.IsOpen = false;
            return;
        }

        _noticeBanner.Message = _viewModel.Notice;
        _noticeBanner.IsOpen = true;
        _noticeBanner.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_noticeBanner, _viewModel.Notice);
    }

    private void OnNoticeDismissed(object? sender, EventArgs e) => _viewModel.ClearNotice();

    // ── Sync banners — GlassPanel2 (success) / GlassPanel3 (error) ────────────────────────────────────────

    private void RenderSyncBanners()
    {
        bool success = _viewModel.SyncFeedback == VehicleListSyncFeedback.Success;
        bool error = _viewModel.SyncFeedback == VehicleListSyncFeedback.Error;

        _syncSuccessBanner.Visibility = success ? Visibility.Visible : Visibility.Collapsed;
        _syncErrorBanner.Visibility = error ? Visibility.Visible : Visibility.Collapsed;

        if (success)
        {
            _syncSuccessText.Text = _viewModel.SyncBannerMessage
                ?? _localizer.GetString(VehicleListPageRegistration.SyncSuccessKey, VehicleListPageRegistration.SyncSuccessFallback);
        }
        else if (error)
        {
            _syncErrorText.Text = _viewModel.SyncBannerMessage
                ?? _localizer.GetString(VehicleListPageRegistration.SyncErrorKey, VehicleListPageRegistration.SyncErrorFallback);
        }
    }

    // ── Fleet summary tiles — Total-Vehicles / Avg-Battery / MetricCard6 / Charging-Online ───────────────

    private void RenderSummary(VehicleListDisplay display)
    {
        _summaryGrid.Children.Clear();
        _summaryGrid.ColumnDefinitions.Clear();
        _summaryGrid.RowDefinitions.Clear();

        int columns = Math.Max(1, _summaryColumns);
        for (int c = 0; c < columns; c++)
        {
            _summaryGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Metrics.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            _summaryGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Metrics.Count; i++)
        {
            var tile = BuildMetricTile(display.Metrics[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            _summaryGrid.Children.Add(tile);
        }
    }

    private static TsGlassPanel BuildMetricTile(VehicleListMetricTile tile)
    {
        var icon = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = TileIconSize,
            Foreground = DisplayTokens.Brush(tile.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 8),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var number = new TsAnimatedNumber
        {
            Value = tile.Value,
            Precision = tile.Precision,
            Suffix = tile.Suffix,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        FrameworkElement valueElement = number;
        if (tile.TrailingText is { } trailing)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
            };
            row.Children.Add(number);
            row.Children.Add(new TextBlock { Text = trailing, FontSize = 14, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Bottom });
            valueElement = row;
        }

        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        stack.Children.Add(icon);
        stack.Children.Add(valueElement);
        stack.Children.Add(new TextBlock
        {
            Text = tile.Label,
            FontSize = 11,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(TilePadding), Content = stack };
        AutomationProperties.SetName(panel, tile.AutomationName);
        return panel;
    }

    // ── Fleet Battery Status panel (GlassPanel8) ──────────────────────────────────────────────────────────

    private void RenderBatteryPanel(VehicleListDisplay display)
    {
        var body = new StackPanel { Spacing = 12 };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        titleRow.Children.Add(new FontIcon { Glyph = VehicleListPageRegistration.ActivityGlyph, FontSize = 16, Foreground = DisplayTokens.Brush(VehicleListPageRegistration.VehiclesColor), VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new TextBlock { Text = display.BatteryStatusTitle, FontSize = 14, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = DisplayTokens.TextPrimary, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);

        var avgRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        avgRow.Children.Add(new TsAnimatedNumber { Value = display.AvgBatteryRounded, Precision = 0, Suffix = VehicleListPageRegistration.PercentSuffix, ReduceMotion = MotionPreference.ReduceMotion, VerticalAlignment = VerticalAlignment.Center });
        avgRow.Children.Add(new TextBlock { Text = display.AvgLabel, FontSize = 12, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(avgRow, 1);

        header.Children.Add(titleRow);
        header.Children.Add(avgRow);
        body.Children.Add(header);

        if (display.BatteryRows.Count > 0)
        {
            var rows = new StackPanel { Spacing = 12 };
            foreach (var row in display.BatteryRows)
            {
                rows.Children.Add(BuildBatteryRow(row));
            }

            body.Children.Add(rows);
        }
        else
        {
            body.Children.Add(new TsEmptyState
            {
                IconGlyph = VehicleListPageRegistration.ActivityGlyph,
                Message = display.NoDataMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        _batteryPanel.Content = body;
        AutomationProperties.SetName(_batteryPanel, display.BatteryStatusTitle);
    }

    private static Grid BuildBatteryRow(VehicleListBatteryRow row)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(110) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(44) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(72) });

        var name = new TextBlock { Text = row.Name, FontSize = 12, Foreground = DisplayTokens.TextSecondary, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(name, 0);

        var bar = new ProgressBar { Value = row.Level, Minimum = 0, Maximum = 100, Height = 8, Foreground = DisplayTokens.Brush(row.BatteryBrushKey), VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(bar, 1);

        var level = new TextBlock { Text = row.LevelText, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = DisplayTokens.TextPrimary, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(level, 2);

        var range = new TextBlock { Text = row.RangeText, FontSize = 11, Foreground = DisplayTokens.TextSecondary, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(range, 3);

        grid.Children.Add(name);
        grid.Children.Add(bar);
        grid.Children.Add(level);
        grid.Children.Add(range);
        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    // ── Vehicle cards (GlassPanel9) ──────────────────────────────────────────────────────────────────────

    private void RenderVehicleCards(VehicleListDisplay display)
    {
        _vehicleStack.Children.Clear();
        for (int i = 0; i < display.VehicleRows.Count; i++)
        {
            _vehicleStack.Children.Add(new TsFadeIn { DelayMs = 40 + (i * 30), Content = BuildVehicleCard(display.VehicleRows[i]) });
        }
    }

    private TsGlassPanel BuildVehicleCard(VehicleListVehicleRow row)
    {
        var content = new StackPanel { Spacing = 12 };

        // Gradient accent strip (web h-1 cyan→purple→green).
        content.Children.Add(new Rectangle { Height = 3, RadiusX = 2, RadiusY = 2, Fill = DisplayTokens.Brush("TsColorAccentBrush"), HorizontalAlignment = HorizontalAlignment.Stretch });

        var bodyGrid = new Grid { ColumnSpacing = 16 };
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        bodyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var info = new StackPanel { Spacing = 8 };

        // Header: name link + status badge.
        var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var nameButton = new HyperlinkButton { Content = row.Name, Padding = new Thickness(0), FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
        nameButton.Click += (_, _) => OnNavigate(row.DetailRoute);
        AutomationProperties.SetName(nameButton, row.Name);
        headerRow.Children.Add(nameButton);
        headerRow.Children.Add(new TsBadge { Status = row.StatusKind, Dot = true, Content = new TextBlock { Text = row.StatusText, FontSize = 12 }, VerticalAlignment = VerticalAlignment.Center });
        info.Children.Add(headerRow);

        // Subtitle: model · trim · vin.
        info.Children.Add(new TextBlock { Text = row.Subtitle, FontSize = 12, Foreground = DisplayTokens.TextSecondary, TextWrapping = TextWrapping.Wrap });

        // Stats row: battery bar + level, range, odometer, charge power, lock / Sentry flags.
        var stats = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, VerticalAlignment = VerticalAlignment.Center };

        var batteryGroup = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        batteryGroup.Children.Add(new ProgressBar { Value = row.Level, Minimum = 0, Maximum = 100, Width = 80, Height = 8, Foreground = DisplayTokens.Brush(row.BatteryBrushKey), VerticalAlignment = VerticalAlignment.Center });
        batteryGroup.Children.Add(new TsAnimatedNumber { Value = row.Level, Precision = 0, Suffix = VehicleListPageRegistration.PercentSuffix, ReduceMotion = MotionPreference.ReduceMotion, VerticalAlignment = VerticalAlignment.Center });
        stats.Children.Add(batteryGroup);

        if (row.HasState)
        {
            stats.Children.Add(new TextBlock { Text = row.RangeText, FontSize = 12, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
            stats.Children.Add(new TextBlock { Text = row.OdometerText, FontSize = 12, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center });
            if (row.ChargerPowerText is { } power)
            {
                stats.Children.Add(new TextBlock { Text = power, FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.Medium, Foreground = DisplayTokens.Brush("TsColorSuccessBrush"), VerticalAlignment = VerticalAlignment.Center });
            }
        }

        var flags = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        if (row.IsLocked)
        {
            flags.Children.Add(BuildFlagGlyph(VehicleListPageRegistration.LockGlyph, "TsColorSuccessBrush", _localizer.GetString("card.locked", "Locked")));
        }

        if (row.SentryMode)
        {
            flags.Children.Add(BuildFlagGlyph(VehicleListPageRegistration.ShieldGlyph, VehicleListPageRegistration.VehiclesColor, _localizer.GetString("card.sentry", "Sentry")));
        }

        stats.Children.Add(flags);
        info.Children.Add(stats);
        Grid.SetColumn(info, 0);

        // Actions: pin + view details + remove.
        var actions = new StackPanel { Orientation = Orientation.Vertical, Spacing = 4, VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Center };
        actions.Children.Add(new PinButton(_pinStore, PinItemType.Vehicle, row.Id.ToString(CultureInfo.InvariantCulture), null, _localizer));

        var viewButton = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = VehicleListPageRegistration.ViewDetailsGlyph };
        AutomationProperties.SetName(viewButton, string.Create(CultureInfo.CurrentCulture, $"{row.Name} \u2014 {_localizer.GetString("vehicles.viewDetails", "View details")}"));
        viewButton.Click += (_, _) => OnNavigate(row.DetailRoute);
        actions.Children.Add(viewButton);

        var deleteButton = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = VehicleListPageRegistration.DeleteGlyph };
        AutomationProperties.SetName(deleteButton, string.Create(CultureInfo.CurrentCulture, $"{_localizer.GetString(VehicleListPageRegistration.DeleteKey, VehicleListPageRegistration.DeleteFallback)}: {row.Name}"));
        deleteButton.Click += (_, _) => OnDeleteClick(row);
        actions.Children.Add(deleteButton);
        Grid.SetColumn(actions, 1);

        bodyGrid.Children.Add(info);
        bodyGrid.Children.Add(actions);
        content.Children.Add(bodyGrid);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, row.AutomationName);
        return panel;
    }

    private static FontIcon BuildFlagGlyph(string glyph, string brushKey, string name)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = 14, Foreground = DisplayTokens.Brush(brushKey), VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(icon, name);
        return icon;
    }

    // ── Interaction ──────────────────────────────────────────────────────────────────────────────────────

    private async void OnSyncClick(object sender, RoutedEventArgs e) => await _viewModel.SyncAsync().ConfigureAwait(true);

    private async void OnEmptySyncInvoked(object? sender, EventArgs e) => await _viewModel.SyncAsync().ConfigureAwait(true);

    private void OnCompareClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.CompareIds is { } ids)
        {
            OnNavigate(string.Create(CultureInfo.InvariantCulture, $"/vehicle-comparison?leftId={ids.Left}&rightId={ids.Right}"));
        }
    }

    private void OnNavigate(string route) => NavigationRequested?.Invoke(this, route);

    private async void OnDeleteClick(VehicleListVehicleRow row)
    {
        var dialog = new TsConfirmDialog
        {
            Title = _localizer.GetString(VehicleListPageRegistration.RemoveTitleKey, VehicleListPageRegistration.RemoveTitleFallback),
            Content = VehicleListPageRegistration.RemoveMessage(_localizer, row.Name),
            PrimaryButtonText = _localizer.GetString(VehicleListPageRegistration.DeleteKey, VehicleListPageRegistration.DeleteFallback),
            CloseButtonText = _localizer.GetString(VehicleListPageRegistration.CancelKey, VehicleListPageRegistration.CancelFallback),
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        var result = await dialog.ShowAsync().AsTask().ConfigureAwait(true);
        if (result == ContentDialogResult.Primary)
        {
            await _viewModel.DeleteAsync(row.Id).ConfigureAwait(true);
        }
    }

    private static int ColumnsForWidth(double width)
    {
        if (width <= 0 || width >= WideBreakpoint)
        {
            return 4;
        }

        return width >= MediumBreakpoint ? 2 : 1;
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
        }

        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehicleListPageAutomationPeer(this);

    private sealed class VehicleListPageAutomationPeer(VehicleListPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((VehicleListPage)Owner)._viewModel.Display.Title : name;
        }
    }
}
