using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// The native WinUI 3 <c>SharingTripsPage</c> — a parity port of the web page
/// <c>web/src/features/sharing/pages/SharingTripsPage.tsx</c> (route <c>/sharing/trips</c>, nav name
/// <c>SharingTrips</c>). It composes the shared <see cref="PageContainer"/> chrome (title + subtitle +
/// copy-link) around the web page's three stacked regions: the recent-trips glass panel (GlassPanel1) whose
/// body resolves the <c>useTrips</c> data source's three states — a shimmer of skeleton rows while loading, a
/// friendly empty state when no trips exist, and a single-select listbox of shareable trips on success (each
/// row showing the resolved name, the date, the duration, the "{n} drives" tally, the unit-converted distance
/// and the watt-hour energy); the static-share-card hint glass panel (GlassPanel2); and the opt-in,
/// default-off trip-postcard drafter (<see cref="AITripPostcardShareCardImageGeneration"/>) which collapses to
/// nothing until an AI backend is composed, exactly like the web <c>withAiFeature</c> gate. Picking a trip in
/// the list writes the page's single selection (web <c>selectedTripId</c>), which the hosted drafter consumes.
/// The view is a thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="SharingTripsDisplay"/> projection; state changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class SharingTripsPage : UserControl, IDisposable
{
    private const double SectionSpacing = 16;     // web mt-4 between regions
    private const double PanelSpacing = 12;       // web space within a panel
    private const double RowSpacing = 8;          // web space-y-2 between trip rows
    private const double SkeletonHeight = 64;     // web h-16
    private const double AvatarSize = 36;         // web h-9 w-9

    private const string CalendarGlyph = "\uE787";
    private const string ClockGlyph = "\uE823";
    private const string DistanceGlyph = "\uE81D";
    private const string EnergyGlyph = "\uE945";

    private readonly SharingTripsPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _started;
    private bool _suppressSelection;
    private bool _ownsSettings;

    private readonly PageContainer _container;
    private readonly AITripPostcardShareCardImageGeneration _aiCard;

    private readonly PanelTitle _recentHeading = new();
    private readonly Grid _recentBody = new();
    private readonly StackPanel _skeletons = new() { Spacing = PanelSpacing };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = SharingTripsRegistration.RouteGlyph };
    private readonly ListView _list = new()
    {
        SelectionMode = ListViewSelectionMode.Single,
        IsItemClickEnabled = false,
        Padding = new Thickness(0),
    };

    private readonly PanelTitle _staticHeading = new();
    private readonly Text _staticBody = new();

    /// <summary>Creates the page over the default empty trips source and the shell resource localizer.</summary>
    public SharingTripsPage()
        : this(EmptySharingTripsSource.Instance, ShellLocalizer.Instance)
    {
        // App composition root: bind the live unit preference and track committed changes so the recent-trips
        // distances re-project when the user switches metric/imperial (web useUnits()).
        ApplyUnits(AppSettingsHost.Current.ToUnitPref());
        AppSettingsHost.Service.Changed += OnSettingsChanged;
        _ownsSettings = true;
    }

    /// <summary>Creates the page over an explicit trips source and localizer (used by tests / dependency injection).</summary>
    /// <param name="source">The cache-then-network recent-trips port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public SharingTripsPage(ISharingTripsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new SharingTripsPageViewModel(source, localizer);

        // The opt-in trip-postcard drafter (web region 3). Default-off gate + off-mode transport: it collapses
        // to nothing until a host composes a real AI backend, the native analogue of withAiFeature -> null.
        _aiCard = new AITripPostcardShareCardImageGeneration(
            OffModeAiTripPostcardTransport.Instance,
            StaticAiFeatureGate.Off,
            localizer);

        _container = new PageContainer(localizer, SharingTripsProjection.Title(localizer));

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildSkeletons();
        Content = BuildLayout();

        _list.SelectionChanged += OnListSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>SharingTrips</c>).</summary>
    public static string RouteName => SharingTripsRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SharingTripsPageViewModel ViewModel => _viewModel;

    /// <summary>The hosted trip-postcard drafter (exposed for hosting / diagnostics / tests).</summary>
    public AITripPostcardShareCardImageGeneration AiCard => _aiCard;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SharingTripsSource"/> from the shared
    /// data layer (the generated client + cache-then-network engine + the vehicle scope source).
    /// </summary>
    /// <param name="vehicles">The vehicle scope source (web <c>useSelectedVehicle</c>).</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle (or the fleet).</param>
    /// <returns>The fully wired page.</returns>
    public static SharingTripsPage Create(
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

        var source = new SharingTripsSource(vehicles, api, engine, options, vehicleId);
        return new SharingTripsPage(source, localizer);
    }

    private PageContainer BuildLayout()
    {
        _list.Visibility = Visibility.Collapsed;
        _emptyState.Visibility = Visibility.Collapsed;
        _skeletons.Visibility = Visibility.Collapsed;
        _recentBody.Children.Add(_skeletons);
        _recentBody.Children.Add(_emptyState);
        _recentBody.Children.Add(_list);
        AutomationProperties.SetName(_list, SharingTripsProjection.RecentHeading(_localizer));

        var recentPanel = new TsGlassPanel();
        var recentStack = new StackPanel { Spacing = PanelSpacing };
        recentStack.Children.Add(_recentHeading);
        recentStack.Children.Add(_recentBody);
        recentPanel.Content = recentStack;

        var hintPanel = new TsGlassPanel();
        var hintStack = new StackPanel { Spacing = RowSpacing };
        hintStack.Children.Add(_staticHeading);
        hintStack.Children.Add(_staticBody);
        hintPanel.Content = hintStack;

        var body = new StackPanel { Spacing = SectionSpacing };
        body.Children.Add(new TsFadeIn { DelayMs = 50, Content = recentPanel });
        body.Children.Add(new TsFadeIn { DelayMs = 100, Content = hintPanel });
        body.Children.Add(new TsFadeIn { DelayMs = 150, Content = _aiCard });

        _container.CopyLink = true;
        _container.CopyLinkText = SharingTripsRegistration.CopyLink;
        _container.PageContent = body;
        return _container;
    }

    private void BuildSkeletons()
    {
        for (int i = 0; i < 3; i++)
        {
            _skeletons.Children.Add(new TsSkeleton { BlockHeight = SkeletonHeight, Radius = 12 });
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _viewModel.NotifyOpened();
        }

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

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Dispatch(e.PropertyName);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Dispatch(e.PropertyName));
        }
    }

    private void Dispatch(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(SharingTripsPageViewModel.Display):
                Render(_viewModel.Display);
                break;

            case nameof(SharingTripsPageViewModel.SelectedTripId):
                _aiCard.TripId = _viewModel.SelectedTripId;
                SyncListSelection(_viewModel.SelectedTripId);
                break;

            default:
                break;
        }
    }

    private void Render(SharingTripsDisplay display)
    {
        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;

        _recentHeading.Value = display.RecentHeading;
        _staticHeading.Value = display.StaticHintHeading;
        _staticBody.Value = display.StaticHintBody;

        _emptyState.Message = display.EmptyMessage;

        _skeletons.Visibility = display.State == SharingTripsState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _emptyState.Visibility = display.State == SharingTripsState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _list.Visibility = display.State == SharingTripsState.Success ? Visibility.Visible : Visibility.Collapsed;

        if (display.State == SharingTripsState.Success)
        {
            RebuildList(display.Rows, _viewModel.SelectedTripId);
        }
        else
        {
            ClearList();
        }

        _aiCard.TripId = _viewModel.SelectedTripId;
        AutomationProperties.SetName(this, display.Title);
    }

    private void RebuildList(IReadOnlyList<SharingTripRow> rows, long? selectedId)
    {
        _suppressSelection = true;
        _list.Items.Clear();

        object? selectedItem = null;
        foreach (var row in rows)
        {
            var element = BuildRow(row);
            _list.Items.Add(element);
            if (selectedId is { } id && row.Id == id)
            {
                selectedItem = element;
            }
        }

        _list.SelectedItem = selectedItem;
        _suppressSelection = false;
    }

    private void ClearList()
    {
        _suppressSelection = true;
        _list.Items.Clear();
        _list.SelectedItem = null;
        _suppressSelection = false;
    }

    private void SyncListSelection(long? selectedId)
    {
        if (_list.Visibility != Visibility.Visible)
        {
            return;
        }

        object? match = null;
        if (selectedId is { } id)
        {
            foreach (var item in _list.Items)
            {
                if (item is FrameworkElement element && element.Tag is long tag && tag == id)
                {
                    match = item;
                    break;
                }
            }
        }

        if (!ReferenceEquals(_list.SelectedItem, match))
        {
            _suppressSelection = true;
            _list.SelectedItem = match;
            _suppressSelection = false;
        }
    }

    private void OnListSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressSelection)
        {
            return;
        }

        long? id = _list.SelectedItem is FrameworkElement element && element.Tag is long tag ? tag : null;
        _viewModel.SelectTrip(id);
    }

    private static Grid BuildRow(SharingTripRow row)
    {
        var grid = new Grid { Tag = row.Id };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var lead = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = PanelSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        lead.Children.Add(BuildAvatar());

        var titleColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(new Text { Value = row.Name });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = PanelSpacing };
        meta.Children.Add(InlineMetric(CalendarGlyph, row.DateText));
        meta.Children.Add(InlineMetric(ClockGlyph, row.DurationText));
        meta.Children.Add(new Caption { Value = row.DrivesText, VerticalAlignment = VerticalAlignment.Center });
        titleColumn.Children.Add(meta);
        lead.Children.Add(titleColumn);

        Grid.SetColumn(lead, 0);
        grid.Children.Add(lead);

        var trailing = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = SectionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        trailing.Children.Add(InlineMetric(DistanceGlyph, row.DistanceText));
        trailing.Children.Add(InlineMetric(EnergyGlyph, row.EnergyText));
        Grid.SetColumn(trailing, 1);
        grid.Children.Add(trailing);

        AutomationProperties.SetName(grid, row.AutomationName);
        return grid;
    }

    private static Border BuildAvatar()
    {
        var icon = new FontIcon { Glyph = SharingTripsRegistration.RouteGlyph, FontSize = 16 };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        var accent = TypographyTokens.Brush("TsChartSpeedBrush");
        if (accent is not null)
        {
            icon.Foreground = accent;
        }

        return new Border
        {
            Width = AvatarSize,
            Height = AvatarSize,
            CornerRadius = new CornerRadius(AvatarSize / 2),
            Background = TypographyTokens.Brush("TsColorSurfaceGlassBrush"),
            Child = icon,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static StackPanel InlineMetric(string glyph, string text)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var stack = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stack.Children.Add(icon);
        stack.Children.Add(new Caption { Value = text, VerticalAlignment = VerticalAlignment.Center });
        return stack;
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

        _list.SelectionChanged -= OnListSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _aiCard.Dispose();
        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SharingTripsPageAutomationPeer(this);

    private sealed class SharingTripsPageAutomationPeer(SharingTripsPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
