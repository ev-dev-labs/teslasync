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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 <c>TripReplayPage</c> — a parity port of the web page
/// <c>web/src/features/trips/pages/TripReplayPage.tsx</c> (route <c>drives/:id/replay</c>, nav name
/// <c>TripReplay</c>). It binds to a <see cref="TripReplayPageViewModel"/> and owns the query lifecycle plus the
/// page-level loading / retriable-error / "no GPS data" surfaces, then — in the success state — renders the six
/// web regions in order: the GPS replay <see cref="TripReplayMap"/>, the playback transport (speed sparkline +
/// scrubber + play/step/speed controls), the six current-position metric tiles, the elevation profile, the
/// speed/power <see cref="TripReplayCharts"/> timeline, and the eight drive-summary tiles. A single source of truth
/// — the view-model's replay clock <see cref="TripReplayPageViewModel.CurrentIndex"/> — is threaded through the map
/// playhead, the chart cursor, the scrubber and the metric tiles; the map polyline tap and the chart cursor both
/// seek back through the view-model so every surface stays in lockstep. The view is a thin renderer: all branch
/// selection, formatting, gating and i18n happen in the view-model + projection. State changes are marshalled onto
/// the UI thread.
/// </summary>
public sealed partial class TripReplayPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 24;
    private const double PlaybackPadding = 16;
    private const double RowGap = 12;
    private const int MetricColumns = 3;
    private const int SummaryColumns = 4;
    private const int MetricCount = 6;
    private const int SummaryCount = 8;
    private const double SparkWidth = 480;
    private const double SparkHeight = 24;
    private const double ElevationHeight = 200;

    private readonly TripReplayPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly Func<TripReplayMap> _mapFactory;
    private readonly Func<TripReplayCharts> _chartsFactory;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();
    private readonly DispatcherQueueTimer? _timer;

    private readonly TsButton _back = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = TripReplayPageRegistration.BackGlyph,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(0, 0, RowGap, 0),
    };

    private readonly PageTitle _title = new();
    private readonly Caption _subtitle = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = SectionSpacing };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = TripReplayPageRegistration.EmptyGlyph };
    private readonly ContentControl _contentHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    // Persistent content controls (built once on first success, reused across replay frames).
    private readonly SectionTitle _currentStatsTitle = new();
    private readonly SectionTitle _summaryTitle = new();
    private readonly TsMetricCard[] _metricCards = new TsMetricCard[MetricCount];
    private readonly TsStatCard[] _summaryCards = new TsStatCard[SummaryCount];
    private readonly TsPlaybackControls _controls = new();
    private readonly TsTimelineScrubber _scrubber = new();
    private readonly TsSparkline _sparkline = new()
    {
        ChartWidth = SparkWidth,
        ChartHeight = SparkHeight,
        Role = ChartRole.Speed,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly TsElevationProfile _elevation = new() { Height = ElevationHeight, Unit = "m" };

    private TripReplayMap? _map;
    private TripReplayCharts? _charts;
    private bool _contentBuilt;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the page over the default empty feed + shell localizer (no drive bound).</summary>
    public TripReplayPage()
        : this(0)
    {
    }

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied drive id.</summary>
    /// <param name="driveId">The drive id from the <c>drives/:id/replay</c> route param.</param>
    public TripReplayPage(long driveId)
        : this(EmptyTripReplayPageFeed.Instance, ShellLocalizer.Instance, driveId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer, drive id and child factories (tests / DI).</summary>
    /// <param name="feed">The drive data port (native <c>useDrive</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">The drive id from the route.</param>
    /// <param name="mapFactory">Builds the replay-map child surface (null = an empty-data map).</param>
    /// <param name="chartsFactory">Builds the speed/power timeline child surface (null = an empty-data timeline).</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    public TripReplayPage(
        ITripReplayPageFeed feed,
        ILocalizer localizer,
        long driveId,
        Func<TripReplayMap>? mapFactory = null,
        Func<TripReplayCharts>? chartsFactory = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new TripReplayPageViewModel(feed, localizer, driveId, units);
        _mapFactory = mapFactory ?? (() => new TripReplayMap(EmptyTripReplayMapSource.Instance, localizer));
        _chartsFactory = chartsFactory
            ?? (() => new TripReplayCharts(EmptyTripReplayChartsSource.Instance, localizer, null, units));

        for (int i = 0; i < MetricCount; i++)
        {
            _metricCards[i] = new TsMetricCard();
        }

        for (int i = 0; i < SummaryCount; i++)
        {
            _summaryCards[i] = new TsStatCard();
        }

        if (_dispatcher is { } dispatcher)
        {
            _timer = dispatcher.CreateTimer();
            _timer.Interval = TimeSpan.FromMilliseconds(TripReplayEngine.TickMs);
            _timer.Tick += OnTimerTick;
        }

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _errorState.ActionInvoked += OnRetryInvoked;
        _back.Click += OnBackClick;
        _controls.PlayPauseToggled += OnPlayPauseToggled;
        _controls.StepBack += OnStepBack;
        _controls.StepForward += OnStepForward;
        _controls.SpeedChanged += OnSpeedChanged;
        _scrubber.PositionChanged += OnScrubberPositionChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.ReplayStateChanged += OnReplayStateChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        AutomationProperties.SetName(_back, _localizer.GetString("replay.backToDrive", "Back to Drive"));

        Render(_viewModel.Display);
    }

    /// <summary>Raised when the in-content back affordance is invoked (web back link to <c>/drives/:id</c>).</summary>
    public event EventHandler? BackRequested;

    /// <summary>The diagnostics surface slug (<c>TripReplayPage</c>).</summary>
    public static string Slug => TripReplayPageRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public TripReplayPageViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the repository-backed feed + child surfaces from the shared data layer (the
    /// host's P2-core dependencies). Mirrors <see cref="TripReplayMap.Create"/> / <see cref="TripReplayCharts.Create"/>.
    /// </summary>
    /// <param name="vehicles">Resolves the primary vehicle when needed by the child surfaces.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="driveId">The drive id (the Trip-Replay route).</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    public static TripReplayPage Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long driveId,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(localizer);

        var feed = new TripReplayPageClientFeed(api);
        TripReplayMap MapFactory() => TripReplayMap.Create(vehicles, api, engine, options, localizer, null, null, driveId);
        TripReplayCharts ChartsFactory() =>
            TripReplayCharts.Create(vehicles, api, engine, options, localizer, null, driveId, null, units);

        return new TripReplayPage(feed, localizer, driveId, MapFactory, ChartsFactory, units);
    }

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
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid.SetColumn(_back, 0);
        grid.Children.Add(_back);

        var heading = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 1);
        grid.Children.Add(heading);

        return grid;
    }

    private void BuildLoadingSkeleton()
    {
        // Mirrors the web layout: map (h-450) → controls → 6 stat cards → elevation → timeline → summary.
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 320, Radius = 12 });
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = 64 });
        _loadingSkeleton.Children.Add(UniformGrid(MetricColumns, RowGap, BuildSkeletonBlocks(MetricCount, 88)));
        _loadingSkeleton.Children.Add(new TsSkeleton { BlockHeight = ElevationHeight });
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
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Stop the frame timer, unsubscribe and dispose the view-model + child surfaces (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopTimer();
        if (_timer is { } timer)
        {
            timer.Tick -= OnTimerTick;
        }

        _errorState.ActionInvoked -= OnRetryInvoked;
        _back.Click -= OnBackClick;
        _controls.PlayPauseToggled -= OnPlayPauseToggled;
        _controls.StepBack -= OnStepBack;
        _controls.StepForward -= OnStepForward;
        _controls.SpeedChanged -= OnSpeedChanged;
        _scrubber.PositionChanged -= OnScrubberPositionChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.ReplayStateChanged -= OnReplayStateChanged;
        _map?.Dispose();
        _charts?.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName is not (nameof(TripReplayPageViewModel.Display) or nameof(TripReplayPageViewModel.State)))
        {
            return;
        }

        Marshal(() => Render(_viewModel.Display));
    }

    private void OnReplayStateChanged(object? sender, EventArgs e) => Marshal(ApplyReplayState);

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private void Render(TripReplayPageDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _subtitle.Visibility = string.IsNullOrEmpty(display.Subtitle) ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties.SetName(this, display.AutomationName);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Message = display.EmptyMessage;

        _contentHost.Visibility = Show(display.ShowContent);

        if (display.ShowContent)
        {
            EnsureContentBuilt();
            UpdateContent(display);
            ApplyReplayState();
        }
        else
        {
            StopTimer();
        }
    }

    private void EnsureContentBuilt()
    {
        if (_contentBuilt)
        {
            return;
        }

        _contentBuilt = true;
        _map = _mapFactory();
        _charts = _chartsFactory();
        _map.SeekRequested += OnChildSeekRequested;
        _charts.SeekToIndexRequested += OnChildSeekRequested;

        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new TsFadeIn { Content = _map });
        stack.Children.Add(new TsFadeIn { DelayMs = 50, Content = BuildPlaybackPanel() });
        stack.Children.Add(new TsFadeIn { DelayMs = 100, Content = BuildCurrentStatsPanel() });
        stack.Children.Add(new TsFadeIn { DelayMs = 150, Content = BuildElevationPanel() });
        stack.Children.Add(new TsFadeIn { DelayMs = 200, Content = _charts });
        stack.Children.Add(new TsFadeIn { DelayMs = 250, Content = BuildSummaryPanel() });

        _contentHost.Content = stack;
    }

    private TsGlassPanel BuildPlaybackPanel()
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_sparkline);
        column.Children.Add(_scrubber);

        _controls.HorizontalAlignment = HorizontalAlignment.Center;
        column.Children.Add(_controls);

        var panel = new TsGlassPanel { Padding = new Thickness(PlaybackPadding), Content = column };
        AutomationProperties.SetName(panel, _viewModel.Display.PlaybackLabel);
        return panel;
    }

    private TsGlassPanel BuildCurrentStatsPanel()
    {
        var column = new StackPanel { Spacing = RowGap };
        column.Children.Add(_currentStatsTitle);
        column.Children.Add(UniformGrid(MetricColumns, RowGap, new List<FrameworkElement>(_metricCards)));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsGlassPanel BuildElevationPanel()
    {
        _elevation.HorizontalAlignment = HorizontalAlignment.Stretch;
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _elevation };
    }

    private TsGlassPanel BuildSummaryPanel()
    {
        var column = new StackPanel { Spacing = RowGap };
        column.Children.Add(_summaryTitle);
        column.Children.Add(UniformGrid(SummaryColumns, RowGap, new List<FrameworkElement>(_summaryCards)));
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private void UpdateContent(TripReplayPageDisplay display)
    {
        _currentStatsTitle.Value = display.CurrentStatsTitle;
        _summaryTitle.Value = display.SummaryTitle;

        var summary = display.SummaryCards;
        for (int i = 0; i < _summaryCards.Length; i++)
        {
            if (i < summary.Count)
            {
                var card = summary[i];
                _summaryCards[i].Label = card.Label;
                _summaryCards[i].Value = card.Unit is { Length: > 0 } unit ? $"{card.Value} {unit}" : card.Value;
                _summaryCards[i].Glyph = card.Glyph;
            }
        }

        _elevation.Points = display.ElevationPoints;
        _elevation.Unit = display.ElevationUnit;
        _sparkline.Data = display.SpeedSparkData;
        _scrubber.TotalSeconds = _viewModel.TotalSeconds;
    }

    private void ApplyReplayState()
    {
        if (!_contentBuilt)
        {
            return;
        }

        var stats = _viewModel.CurrentStats;
        for (int i = 0; i < _metricCards.Length; i++)
        {
            if (i < stats.Count)
            {
                _metricCards[i].Label = stats[i].Label;
                _metricCards[i].Value = stats[i].Value;
                _metricCards[i].AccentBrushKey = stats[i].AccentBrushKey;
            }
        }

        _controls.IsPlaying = _viewModel.IsPlaying;
        _controls.Speed = _viewModel.Speed;
        _scrubber.TotalSeconds = _viewModel.TotalSeconds;
        _scrubber.ElapsedSeconds = _viewModel.ElapsedSeconds;

        if (_map is { } map)
        {
            map.CurrentIndex = _viewModel.CurrentIndex;
        }

        _charts?.SeekTo(_viewModel.CurrentIndex);

        ManageTimer();
    }

    private void ManageTimer()
    {
        if (_viewModel.IsPlaying && _viewModel.HasTimeline)
        {
            StartTimer();
        }
        else
        {
            StopTimer();
        }
    }

    private void StartTimer() => _timer?.Start();

    private void StopTimer() => _timer?.Stop();

    private void OnTimerTick(DispatcherQueueTimer sender, object args) => _viewModel.Tick();

    private void OnChildSeekRequested(object? sender, int index) => _viewModel.SeekToIndex(index);

    private void OnPlayPauseToggled(object? sender, bool isPlaying) => _viewModel.TogglePlay();

    private void OnStepBack(object? sender, EventArgs e) => _viewModel.StepFrame(-1);

    private void OnStepForward(object? sender, EventArgs e) => _viewModel.StepFrame(1);

    private void OnSpeedChanged(object? sender, int speed) => _viewModel.SetSpeed(speed);

    private void OnScrubberPositionChanged(object? sender, double seconds) => _viewModel.SeekToSeconds(seconds);

    private void OnBackClick(object sender, RoutedEventArgs e) => BackRequested?.Invoke(this, EventArgs.Empty);

    private static Grid UniformGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = children.Count == 0 ? 0 : ((children.Count + columns - 1) / columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var element = children[i];
            Grid.SetColumn(element, i % columns);
            Grid.SetRow(element, i / columns);
            grid.Children.Add(element);
        }

        return grid;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TripReplayPageAutomationPeer(this);

    private sealed class TripReplayPageAutomationPeer(TripReplayPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override string GetClassNameCore() => nameof(TripReplayPage);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
