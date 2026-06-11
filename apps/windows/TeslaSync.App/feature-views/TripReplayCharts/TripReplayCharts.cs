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
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Trip-Replay Speed &amp; Power timeline feature surface — a parity port of
/// web/src/features/trips/components/TripReplayCharts.tsx. It reproduces the web <c>ChartContainer</c> chrome
/// (title "Speed &amp; Power Timeline" + subtitle "Click to seek replay position" + accessible summary)
/// wrapping a dual-axis area trace — speed on the left axis, power (kW) on the right — overlaid by a dashed
/// playhead reference line, beneath a two-series legend. The web component is a pure child of the Trip-Replay
/// page that draws an empty "No telemetry data available" surface when its <c>data</c> prop is empty; the
/// native feature-view owns its cache-then-network drive-telemetry read and therefore renders every state the
/// P2 contract mandates — a loading skeleton, the populated chart, that friendly empty surface, an explicit
/// retry surface on hard failure, plus stale and offline freshness chips.
/// <para>
/// Interaction mirrors the web: hovering, tapping or arrow-keying the chart seeks the replay through the
/// shared cursor-sync group (web <c>useSyncedCursor</c> / <c>ChartCursorBridge</c>), moving the playhead and
/// raising <see cref="SeekToIndexRequested"/> (web <c>onSeekToIndex</c>) so a host can keep sibling surfaces
/// in lockstep; a host can drive the playhead back via <see cref="SeekTo(int)"/> (web <c>currentIndex</c>).
/// </para>
/// All data flows through the shared <see cref="TripReplayChartsViewModel"/>; the view never performs HTTP.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TripReplayCharts : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 220;        // web ChartContainer height={220}
    private const double FadeInDelayMs = 150;
    private const double LegendSwatchWidth = 16;
    private const double LegendFontSize = 12;

    private readonly TripReplayChartsViewModel _viewModel;
    private readonly TripReplayChartsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly StackPanel _heading = new() { Spacing = 2 };
    private readonly SectionTitle _title = new();
    private readonly Caption _subtitle = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = LegendFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();
    private readonly StackPanel _chartContent = new() { Spacing = 8 };
    private readonly TripReplayTimelineChart _chart = new() { MinHeight = ChartHeight };
    private readonly StackPanel _legend = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 16,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private TripReplayTimelineModel? _lastTimeline;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, (optional) diagnostics and units.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public TripReplayCharts(
        ITripReplayChartsSource source,
        ILocalizer localizer,
        TripReplayChartsDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TripReplayChartsDiagnostics();
        _viewModel = new TripReplayChartsViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        _chart.CursorSync = _viewModel.CursorSync;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>trip-replay-charts</c>).</summary>
    public static string SurfaceId => TripReplayChartsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TripReplayChartsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Raised when the user seeks via the chart (hover / click / keyboard) — the web <c>onSeekToIndex</c>
    /// callback. Carries the parent-array index of the chosen sample so a host can drive the shared replay
    /// engine and sibling surfaces (map / scrubber).
    /// </summary>
    public event EventHandler<int>? SeekToIndexRequested
    {
        add => _viewModel.SeekToIndexRequested += value;
        remove => _viewModel.SeekToIndexRequested -= value;
    }

    /// <summary>
    /// Move the replay playhead to <paramref name="index"/> (web parent-controlled <c>currentIndex</c>), e.g.
    /// from a host's shared replay engine. Does not re-raise <see cref="SeekToIndexRequested"/>.
    /// </summary>
    public void SeekTo(int index) => _viewModel.SeekTo(index);

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TripReplayChartsSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to an explicit <paramref name="driveId"/>
    /// (the Trip-Replay route) or — when null — the newest drive of the <paramref name="vehicleId"/> / primary
    /// vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle when no drive id is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="vehicleId">An explicit vehicle id; null uses the primary cached vehicle.</param>
    /// <param name="driveId">An explicit drive id (the Trip-Replay route); null resolves the newest drive.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; a private collector is used when null.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    public static TripReplayCharts Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long? vehicleId = null,
        long? driveId = null,
        TripReplayChartsDiagnostics? diagnostics = null,
        UnitPref? units = null)
    {
        var source = new TripReplayChartsSource(vehicles, api, engine, options, vehicleId, driveId);
        return new TripReplayCharts(source, localizer, diagnostics, units);
    }

    private void BuildChrome()
    {
        _heading.Children.Add(_title);
        _heading.Children.Add(_subtitle);

        _freshnessChip.Content = _freshnessChipText;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_heading, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_heading);
        _header.Children.Add(_actions);

        _chart.HorizontalAlignment = HorizontalAlignment.Stretch;
        _chart.VerticalAlignment = VerticalAlignment.Stretch;
        _chartContent.Children.Add(_chart);
        _chartContent.Children.Add(_legend);

        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(16);
        _panel.Content = _root;
        _fade.Content = _panel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _refresh.Click -= OnRefreshClick;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;
        var state = _viewModel.State;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(TripReplayChartsState state)
    {
        bool showActions = state is not (TripReplayChartsState.Loading or TripReplayChartsState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == TripReplayChartsState.Stale;
        bool offline = state == TripReplayChartsState.Offline;
        if (stale || offline)
        {
            _freshnessChip.Visibility = Visibility.Visible;
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = offline ? _viewModel.OfflineChip : _viewModel.StaleChip;
            AutomationProperties.SetName(_freshnessChip, _freshnessChipText.Text);
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
    }

    private UIElement BuildBody(TripReplayChartsDisplay display, TripReplayChartsState state) => state switch
    {
        TripReplayChartsState.Loading => BuildLoading(),
        TripReplayChartsState.Error => BuildError(),
        TripReplayChartsState.Empty => BuildEmpty(),
        _ => BuildChart(display),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new TsSkeleton { BlockHeight = ChartHeight });
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        AutomationProperties.SetName(stack, _viewModel.LoadingLabel);
        return stack;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.ErrorTitle,
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildChart(TripReplayChartsDisplay display)
    {
        var timeline = display.Timeline;
        if (!ReferenceEquals(_lastTimeline, timeline))
        {
            _lastTimeline = timeline;
            _chart.Model = timeline;
            AutomationProperties.SetName(_chart, display.ChartAriaLabel);
            RebuildLegend(timeline);
        }

        _chart.CurrentIndex = _viewModel.CurrentIndex;
        return _chartContent;
    }

    // Web: the AreaChart's series names surface in the tooltip; the native surface adds a compact legend so
    // the speed / power colours are nameable without hovering (and Narrator-reachable).
    private void RebuildLegend(TripReplayTimelineModel timeline)
    {
        _legend.Children.Clear();
        _legend.Children.Add(LegendItem(timeline.SpeedSeriesName, DisplayTokens.Brush(TripReplayTimelineChart.SpeedBrush)));
        _legend.Children.Add(LegendItem(timeline.PowerSeriesName, DisplayTokens.Brush(TripReplayTimelineChart.PowerBrush)));
    }

    private static StackPanel LegendItem(string label, Brush brush)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var swatch = new Line
        {
            X1 = 0,
            X2 = LegendSwatchWidth,
            Y1 = 0,
            Y2 = 0,
            Stroke = brush,
            StrokeThickness = 2,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(swatch, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = label,
            FontSize = LegendFontSize,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(swatch);
        row.Children.Add(text);
        AutomationProperties.SetName(row, label);
        return row;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TripReplayChartsAutomationPeer(this);

    private sealed class TripReplayChartsAutomationPeer(TripReplayCharts owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TripReplayCharts)Owner).ViewModel.Title
                : name;
        }
    }
}
