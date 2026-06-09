using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The native WinUI 3 drive-detail Hero Gauges surface — a parity port of
/// web/src/features/driving/components/drive-detail/HeroGauges.tsx. It renders the web layout: a single glass
/// panel holding a centred, wrapping row of radial gauges (Distance, Max Speed, Duration, Consumption, plus an
/// Efficiency gauge when the drive carries both battery endpoints). The web component is presentational (it
/// receives <c>drive</c> and <c>stats</c>); the native surface binds the same drive through the shared
/// <see cref="HeroGaugesViewModel"/> so every state — loading (gauge skeletons), loaded, empty, error (retry),
/// stale (stale chip) and offline (offline chip) — renders as a visible surface, never hidden. All value
/// derivation and unit conversion happen in the WinUI-free <see cref="HeroGaugesProjection"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade and every interactive element carries a Narrator
/// name.
/// </summary>
public sealed partial class HeroGauges : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string EmptyGlyph = "\uE804";   // Segoe Fluent — Car
    private const double GaugeDiameter = 110;
    private const double NarrowBreakpoint = 600;
    private const double MediumBreakpoint = 1024;
    private const int MaxGaugeCount = 5;

    private readonly HeroGaugesViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly HeroGaugesDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        Padding = new Thickness(0, 0, 0, 8),
    };

    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsGlassPanel _glass = new() { Padding = new Thickness(24) };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port the view-model binds to.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HeroGauges(
        IHeroGaugesSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        HeroGaugesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new HeroGaugesDiagnostics();
        _viewModel = new HeroGaugesViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HeroGauges</c>).</summary>
    public static string Slug => HeroGaugesRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public HeroGaugesViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the gauges in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="HeroGaugesSource"/> from the shared data
    /// layer (the drive-detail host's P2-core dependencies) for a single drive.
    /// </summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">The drive whose gauges to render (web <c>driveID</c> route parameter).</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <returns>A ready-to-host surface bound to the live data layer.</returns>
    public static HeroGauges Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        long driveId,
        UnitPref? units = null,
        HeroGaugesDiagnostics? diagnostics = null)
    {
        var source = new HeroGaugesSource(api, engine, options, driveId);
        return new HeroGauges(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetName(_refresh, _localizer.GetString("common.refresh", "Refresh"));
        _refresh.Click += OnRefreshClick;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_glass, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_glass);
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width != e.NewSize.Width && IsGridState(_viewModel.State))
        {
            ScheduleRender();
        }
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        SizeChanged -= OnSizeChanged;
        _viewModel.Dispose();
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

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
        AutomationProperties.SetName(this, _viewModel.SurfaceName);

        switch (_viewModel.State)
        {
            case HeroGaugesState.Loading:
                Content = BuildLoading();
                break;

            case HeroGaugesState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _glass.Content = _viewModel.HasData ? BuildGauges(_viewModel.Display) : BuildEmpty();
                Content = _root;
                break;
        }
    }

    // ── Header (freshness chip + stale/offline badge + refresh) ───────────────────────────────────────

    private void UpdateHeader()
    {
        _header.Children.Clear();

        if (_viewModel.State is HeroGaugesState.Stale or HeroGaugesState.Offline)
        {
            _header.Children.Add(BuildFreshnessChip(_viewModel.State));
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.State == HeroGaugesState.Offline;
        _header.Children.Add(_freshness);
        _header.Children.Add(_refresh);
    }

    private TsBadge BuildFreshnessChip(HeroGaugesState state)
    {
        bool offline = state == HeroGaugesState.Offline;
        string text = offline
            ? _localizer.GetString("common.offline", "Offline")
            : _localizer.GetString("common.stale", "Stale");

        var badge = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Content = new Caption { Value = text },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    // ── Gauge grid ────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildGauges(HeroGaugesDisplay display)
    {
        var tiles = new List<UIElement>(display.Gauges.Count);
        foreach (var gauge in display.Gauges)
        {
            tiles.Add(BuildGaugeTile(gauge));
        }

        return BuildResponsiveGrid(tiles);
    }

    private static TsRadialGauge BuildGaugeTile(HeroGauge gauge)
    {
        var control = new TsRadialGauge
        {
            Value = gauge.Value,
            Max = gauge.Max,
            Label = gauge.Label,
            Unit = gauge.Unit,
            Decimals = gauge.Decimals,
            Role = AccentRole(gauge.Accent),
            Diameter = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(control, gauge.AutomationName);
        return control;
    }

    private Grid BuildResponsiveGrid(List<UIElement> tiles)
    {
        int columns = Math.Max(1, Math.Min(ColumnsForWidth(AvailableWidth()), tiles.Count));
        var grid = new Grid
        {
            ColumnSpacing = 24,
            RowSpacing = 24,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(tiles.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < tiles.Count; i++)
        {
            var tile = tiles[i];
            if (tile is FrameworkElement element)
            {
                Grid.SetColumn(element, i % columns);
                Grid.SetRow(element, i / columns);
            }

            grid.Children.Add(tile);
        }

        return grid;
    }

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private TsGlassPanel BuildLoading()
    {
        var tiles = new List<UIElement>(MaxGaugeCount);
        for (int i = 0; i < MaxGaugeCount; i++)
        {
            tiles.Add(BuildSkeletonTile());
        }

        var grid = BuildResponsiveGrid(tiles);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(
            grid,
            string.Format(
                CultureInfo.CurrentCulture,
                "{0}. {1}",
                _viewModel.SurfaceName,
                _localizer.GetString("common.loading", "Loading...")));

        return new TsGlassPanel { Padding = new Thickness(24), Content = grid };
    }

    private static StackPanel BuildSkeletonTile()
    {
        var column = new StackPanel
        {
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = GaugeDiameter,
            BlockHeight = GaugeDiameter,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = 64,
            BlockHeight = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = EmptyGlyph,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString("driveDetail.gauges.error", "Couldn't load this drive"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private double AvailableWidth()
    {
        double width = _glass.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => MaxGaugeCount,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        _ => MaxGaugeCount,
    };

    private static bool IsGridState(HeroGaugesState state) =>
        state is HeroGaugesState.Loaded or HeroGaugesState.Empty or HeroGaugesState.Stale or HeroGaugesState.Offline;

    private static ChartRole AccentRole(HeroGaugeAccent accent) => accent switch
    {
        HeroGaugeAccent.Cyan => ChartRole.Regen,
        HeroGaugeAccent.Purple => ChartRole.Power,
        HeroGaugeAccent.Amber => ChartRole.Energy,
        HeroGaugeAccent.Red => ChartRole.Temperature,
        HeroGaugeAccent.Green => ChartRole.Battery,
        _ => ChartRole.None,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new HeroGaugesAutomationPeer(this);

    private sealed class HeroGaugesAutomationPeer(HeroGauges owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((HeroGauges)Owner).ViewModel.SurfaceName : name;
        }
    }
}
