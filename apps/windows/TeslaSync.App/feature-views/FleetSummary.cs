using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>FleetSummary</c> feature surface — a parity port of
/// web/src/features/vehicles/components/FleetSummary.tsx. It reproduces the web responsive four-tile grid
/// (<c>grid-cols-2 sm:grid-cols-4</c>): the cyan Vehicles tile (<c>Car</c> glyph + count-up count), the green
/// Avg-Battery tile (<c>Battery</c> glyph + count-up percent), the purple Total-Range tile (<c>Gauge</c> glyph
/// + count-up distance in the user's unit) and the amber Charging/Online tile (<c>Zap</c> glyph + count-up
/// charging count with a muted "/ online" trailing). The web component is a pure child of its parent page; the
/// native surface binds its own cache-then-network <see cref="FleetSummaryViewModel"/> (the vehicle list + the
/// per-vehicle state fan-out), so it renders every state the P2 contract requires — the skeleton while loading,
/// a retry surface on a hard failure, a friendly empty state when no vehicle exists, and a freshness chip
/// (stale / offline) over the tiles otherwise — and refreshes on the web 30s cadence. SI metres are converted
/// to the user's distance unit only at this boundary (web <c>useUnits</c>). The view never performs HTTP. Every
/// string resolves through the i18n facade, the decorative glyphs are hidden from Narrator, every tile carries
/// a composed Narrator name, and the count-up / entrance motion is the system-honoured <see cref="TsFadeIn"/> /
/// <see cref="TsAnimatedNumber"/>, so reduced-motion is respected by construction.
/// </summary>
public sealed partial class FleetSummary : ContentControl, IDisposable
{
    private const double NarrowBreakpoint = 640;  // web Tailwind `sm:` (grid-cols-2 → grid-cols-4)
    private const int TileCount = 4;              // the four always-present tiles
    private const double CardSpacing = 16;        // web `gap-4`
    private const double SectionSpacing = 12;     // gap between the freshness row and the grid
    private const double TilePadding = 16;        // web `p-4`
    private const double TileHeight = 104;        // skeleton tile height ≈ a populated tile
    private const double IconSize = 20;           // web Lucide `h-5 w-5`
    private const double IconBottomMargin = 8;    // web `mb-2`
    private const double LabelFontSize = 11;      // web `text-[10px]`
    private const double TrailingFontSize = 14;   // web `text-sm` ("/ online" span)
    private const double ValueSpacing = 6;        // gap between the count-up value and the trailing span
    private const int FadeDelayMs = 150;          // web FadeIn cadence (sibling-surface entrance)
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh

    private readonly FleetSummaryViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly FleetSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };
    private readonly DispatcherTimer _refreshTimer;

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private double _lastWidth;

    /// <summary>Creates the surface over its data source, localizer, unit preference and (optional) diagnostics.</summary>
    /// <param name="source">The cache-then-network fleet rollup source (P1/S8 seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetSummary(
        IFleetSummarySource source,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetSummaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new FleetSummaryDiagnostics();
        _viewModel = new FleetSummaryViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _refreshTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMilliseconds(FleetSummaryRegistration.RefreshIntervalMs),
        };
        _refreshTimer.Tick += OnRefreshTick;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Content = _fade;
        AutomationProperties.SetName(this, _viewModel.RegionLabel);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FleetSummary</c>).</summary>
    public static string Slug => FleetSummaryRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public FleetSummaryViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="FleetSummarySource"/> from the shared
    /// data layer (the host's P2-core dependencies). The vehicle list comes straight from the API
    /// (<see cref="Operations.Vehicles.List"/>) — the web <c>useVehicles</c> — so no selected-vehicle scope is
    /// needed.
    /// </summary>
    public static FleetSummary Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetSummaryDiagnostics? diagnostics = null)
    {
        var source = new FleetSummarySource(api, engine, options);
        return new FleetSummary(source, localizer, units, diagnostics);
    }

    /// <summary>The user's distance unit preference; reassigning re-projects the cached rollup in the new unit.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _refreshTimer.Start(); // web refetchInterval: 30_000 — keep the fleet fresh.
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model, stop the auto-refresh and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _refreshTimer.Stop();
        _refreshTimer.Tick -= OnRefreshTick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshTick(object? sender, object e)
    {
        if (!_disposed)
        {
            _ = _viewModel.RetryAsync();
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // Reflow the 2 → 4 column grid only when crossing the breakpoint with tiles on screen.
        if (e.PreviousSize.Width != e.NewSize.Width
            && _viewModel.HasData
            && ColumnsForWidth(e.PreviousSize.Width) != ColumnsForWidth(e.NewSize.Width))
        {
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
        AutomationProperties.SetName(this, display.RegionLabel);

        _fade.Content = _viewModel.State switch
        {
            FleetSummaryState.Loading => BuildLoading(display),
            FleetSummaryState.Error => BuildErrorSurface(display),
            FleetSummaryState.Empty => BuildEmpty(display),
            _ => BuildContent(display),
        };
    }

    // ── Loaded / Stale / Offline (the web stat-card grid) ────────────────────────────────────────────────

    private FrameworkElement BuildContent(FleetSummaryDisplay display)
    {
        var grid = BuildGrid(display);

        // Web parity: the Loaded state is just the grid. Stale / offline add the freshness chip + refresh.
        if (_viewModel.State is not (FleetSummaryState.Stale or FleetSummaryState.Offline))
        {
            return grid;
        }

        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildFreshnessRow());
        column.Children.Add(grid);
        AutomationProperties.SetName(column, display.RegionLabel);
        return column;
    }

    private Grid BuildGrid(FleetSummaryDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = BuildColumnGrid(columns, display.Tiles.Count);
        AutomationProperties.SetName(grid, display.RegionLabel);

        for (int i = 0; i < display.Tiles.Count; i++)
        {
            var tile = BuildTile(display.Tiles[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static TsGlassPanel BuildTile(FleetSummaryTile tile)
    {
        // web `<GlassPanel className="p-4 text-center">`.
        var icon = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush(tile.ColorKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            Margin = new Thickness(0, 0, 0, IconBottomMargin), // web `mb-2`
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        stack.Children.Add(icon);
        stack.Children.Add(BuildValue(tile));
        stack.Children.Add(new TextBlock
        {
            Text = tile.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted, // web text-[var(--text-muted)]
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(TilePadding), Content = stack };
        AutomationProperties.SetName(panel, tile.AutomationName);
        return panel;
    }

    private static FrameworkElement BuildValue(FleetSummaryTile tile)
    {
        // web `<p className="text-2xl font-bold"><AnimatedNumber .../></p>` — count-up via TsAnimatedNumber.
        var number = new TsAnimatedNumber
        {
            Value = tile.Value,
            Precision = tile.Precision,
            Suffix = tile.Suffix,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        if (tile.TrailingText is not { } trailing)
        {
            return number;
        }

        // web Charging/Online tile: `<AnimatedNumber/> <span className="text-sm text-muted">/ {online}</span>`.
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ValueSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(number);
        row.Children.Add(new TextBlock
        {
            Text = trailing,
            FontSize = TrailingFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Bottom,
        });
        return row;
    }

    // ── Freshness chip + refresh (stale / offline) ───────────────────────────────────────────────────────

    private StackPanel BuildFreshnessRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(BuildFreshnessChip(_viewModel.State));
        row.Children.Add(new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.State == FleetSummaryState.Offline,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(BuildRefreshButton());
        return row;
    }

    private TsBadge BuildFreshnessChip(FleetSummaryState state)
    {
        bool offline = state == FleetSummaryState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private TsButton BuildRefreshButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = RefreshGlyph,
            VerticalAlignment = VerticalAlignment.Center,
            IsEnabled = !_viewModel.IsFetching,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.refresh", "Refresh"));
        button.Click += OnRefreshClick;
        return button;
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Empty (no vehicles in the fleet) ─────────────────────────────────────────────────────────────────

    private static TsEmptyState BuildEmpty(FleetSummaryDisplay display) => new()
    {
        // TsEmptyState names itself from its message, so Narrator announces the friendly empty copy.
        IconGlyph = FleetSummaryRegistration.VehiclesGlyph,
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    // ── Loading (skeleton chrome) ────────────────────────────────────────────────────────────────────────

    private static TsStatGridSkeleton BuildLoading(FleetSummaryDisplay display)
    {
        var skeleton = new TsStatGridSkeleton(TileCount) { MinHeight = TileHeight };
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        AutomationProperties.SetName(
            skeleton,
            string.Create(CultureInfo.CurrentCulture, $"{display.RegionLabel}. {display.LoadingLabel}"));
        return skeleton;
    }

    // ── Error surface (web QueryError) ───────────────────────────────────────────────────────────────────

    private TsQueryError BuildErrorSurface(FleetSummaryDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.RegionLabel,
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString(FleetSummaryRegistration.ErrorKey, FleetSummaryRegistration.ErrorFallback),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        AutomationProperties.SetName(error, error.Message);
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    // ── Layout helpers ───────────────────────────────────────────────────────────────────────────────────

    private static Grid BuildColumnGrid(int columns, int itemCount)
    {
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = Math.Max(1, (int)Math.Ceiling(itemCount / (double)columns));
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }

    private double AvailableWidth()
    {
        double width = ActualWidth;
        if (width > 0)
        {
            _lastWidth = width;
        }

        return _lastWidth;
    }

    // web grid-cols-2 / sm:grid-cols-4.
    private static int ColumnsForWidth(double width) => width is <= 0 or >= NarrowBreakpoint ? 4 : 2;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new FleetSummaryAutomationPeer(this);

    private sealed class FleetSummaryAutomationPeer(FleetSummary owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((FleetSummary)Owner)._viewModel.RegionLabel : name;
        }
    }
}
