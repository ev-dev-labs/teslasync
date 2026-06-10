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
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 drive-detail Tire-Pressure feature surface — a parity port of
/// web/src/features/driving/components/drive-detail/TirePressureSection.tsx. It reproduces the web
/// <c>ChartContainer</c> chrome (title) wrapping a four-up row of per-corner stat tiles (front-left,
/// front-right, rear-left, rear-right min–max pressure ranges) above a multi-line tyre-pressure trace over the
/// drive timeline, with the recharts <c>&lt;Legend&gt;</c> reproduced by the chart's built-in interactive
/// legend. The web component is a pure child of the Drive-Detail page that draws an empty "No telemetry data
/// available" empty state when its <c>stats.hasTirePressure</c> gate is false; the native feature-view owns its
/// cache-then-network drive-telemetry read and therefore renders every state the P2 contract mandates — a
/// loading skeleton, the populated tiles + chart, a friendly empty surface, an explicit retry surface on hard
/// failure, plus stale and offline freshness chips. All data flows through the shared
/// <see cref="TirePressureSectionViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class TirePressureSection : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const double ChartHeight = 220;        // web ResponsiveContainer height={220}
    private const double FadeInDelayMs = 300;
    private const double ChipFontSize = 12;
    private const int GridColumns = 4;

    private readonly TirePressureSectionViewModel _viewModel;
    private readonly TirePressureSectionDiagnostics _diagnostics;
    private readonly ChartCursorSyncGroup? _cursorSync;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsFadeIn _fade = new() { DelayMs = (int)FadeInDelayMs };
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 16 };
    private readonly Grid _header = new();
    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = ChipFontSize };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units, (optional) cursor sync and diagnostics.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="cursorSync">Optional cross-chart cursor-sync group (web <c>useSyncedCursor</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public TirePressureSection(
        ITirePressureSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        ChartCursorSyncGroup? cursorSync = null,
        TirePressureSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TirePressureSectionDiagnostics();
        _cursorSync = cursorSync;
        _viewModel = new TirePressureSectionViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _refresh.Click += OnRefreshClick;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _fade;
        Render();
    }

    /// <summary>The canonical surface id (<c>tire-pressure-section</c>).</summary>
    public static string SurfaceId => TirePressureSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TirePressureSectionViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the chart + tiles in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TirePressureSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies), scoped to <paramref name="driveId"/> (the
    /// Drive-Detail route) or, when null, the primary vehicle's latest drive.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle when no explicit drive is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="driveId">An explicit drive id; when null the newest drive is resolved.</param>
    /// <param name="cursorSync">Optional cross-chart cursor-sync group.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static TirePressureSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        long? driveId = null,
        ChartCursorSyncGroup? cursorSync = null,
        TirePressureSectionDiagnostics? diagnostics = null)
    {
        var source = new TirePressureSectionSource(vehicles, api, engine, options, vehicleId, driveId);
        return new TirePressureSection(source, localizer, units, cursorSync, diagnostics);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_actions);

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
        AutomationProperties.SetName(this, display.Title);

        UpdateFreshness(state);
        _bodyHost.Child = BuildBody(display, state);
    }

    private void UpdateFreshness(TirePressureSectionState state)
    {
        bool showActions = state is not (TirePressureSectionState.Loading or TirePressureSectionState.Error);
        _actions.Visibility = showActions ? Visibility.Visible : Visibility.Collapsed;
        if (!showActions)
        {
            return;
        }

        bool stale = state == TirePressureSectionState.Stale;
        bool offline = state == TirePressureSectionState.Offline;
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

    private UIElement BuildBody(TirePressureSectionDisplay display, TirePressureSectionState state) => state switch
    {
        TirePressureSectionState.Loading => BuildLoading(),
        TirePressureSectionState.Error => BuildError(),
        TirePressureSectionState.Empty => BuildEmpty(),
        _ => _viewModel.HasData ? BuildContent(display) : BuildEmpty(),
    };

    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = 12 };
        stack.Children.Add(new TsSkeleton
        {
            BlockHeight = ChartHeight,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });
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
        IconGlyph = TirePressureSectionProjection.GaugeGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private StackPanel BuildContent(TirePressureSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        if (display.Tiles.Count > 0)
        {
            content.Children.Add(BuildTiles(display));
        }

        content.Children.Add(BuildChart(display));
        return content;
    }

    private Grid BuildTiles(TirePressureSectionDisplay display)
    {
        var tiles = display.Tiles;
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(tiles.Count / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var card = BuildTile(tiles[i]);
            Grid.SetColumn(card, i % GridColumns);
            Grid.SetRow(card, i / GridColumns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static TsMetricCard BuildTile(TirePressureSectionTile tile)
    {
        var card = new TsMetricCard
        {
            Label = tile.Label,
            Value = tile.Value,
            DeltaText = tile.Unit,
            AccentBrushKey = tile.AccentBrushKey,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(card, tile.AutomationName);
        return card;
    }

    private TsCartesianChart BuildChart(TirePressureSectionDisplay display)
    {
        var series = new List<ChartSeries>(display.Series.Count);
        foreach (var line in display.Series)
        {
            var points = new List<ChartPoint>(line.Points.Count);
            foreach (var point in line.Points)
            {
                points.Add(new ChartPoint(point.Index, point.ValueDisplay, point.TimeLabel));
            }

            // The localized series Label already carries the pressure unit (e.g. "FL (psi)"), so the tooltip
            // needs no extra Unit suffix.
            series.Add(new ChartSeries(line.Label, points)
            {
                Kind = ChartSeriesKind.Line,
                ColorIndex = line.ColorIndex,
            });
        }

        var chart = new TsCartesianChart
        {
            Series = series,
            Title = display.Title,
            Height = ChartHeight,
            ShowLegend = true,
            // Tyre pressures sit well above zero (~250 kPa / ~36 psi); auto-fit the domain so the per-corner
            // variation over the drive is legible rather than flattened against a zero baseline.
            IncludeZero = false,
        };

        if (_cursorSync is { } group)
        {
            chart.AttachCursorSync(group);
        }

        AutomationProperties.SetName(chart, display.ChartAriaLabel);
        return chart;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TirePressureSectionAutomationPeer(this);

    private sealed class TirePressureSectionAutomationPeer(TirePressureSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TirePressureSection)Owner).ViewModel.Title
                : name;
        }
    }
}
