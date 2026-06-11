using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
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
/// The native WinUI 3 Telemetry Grid feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx. It reproduces the web responsive grid
/// (web <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6</c>) of six <c>InfoTile</c>s — Battery (with
/// the emerald / amber / rose state-of-charge tint and the rated-range sub-line), Speed (with the Driving /
/// Parked sub-line), Inside (cabin temperature with the outside-temperature sub-line), Odometer, Charger (kW or
/// "Not charging", with the "Full in {h}h" sub-line) and Sentry (Active / Off) — each a glyph + label + value
/// converted to the user's units at the render boundary (web <c>useUnits</c>) with the em-dash for a missing
/// reading. The web child is a pure page child whose parent owns the query lifecycle; the native surface owns its
/// own cache-then-network read and so renders every P2 state — a skeleton while loading, a retry surface on a
/// hard failure, a friendly "No telemetry data available" empty state, and stale / offline freshness chips with a
/// refresh affordance otherwise. Each tile's entrance is staggered (the native mapping of the web
/// <c>StaggerContainer</c> / <c>StaggerItem</c>) and honours reduce-motion. All data flows through the shared
/// <see cref="TelemetryGridViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every tile carries a Narrator name.
/// </summary>
public sealed partial class TelemetryGrid : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C";    // Segoe Fluent — Refresh
    private const double HeaderBottomPadding = 8;
    private const double GridGap = 12;               // web gap-3
    private const double PanelPadding = 16;          // web GlassPanel p-4
    private const double TileInnerSpacing = 6;       // web mb-1.5
    private const double IconRowSpacing = 8;         // web gap-2
    private const double IconSize = 14;              // web h-3.5 w-3.5
    private const double LabelFontSize = 12;         // web text-xs
    private const double ValueFontSize = 18;         // web text-lg
    private const double SubFontSize = 11;           // web text-[10px]
    private const double ChipFontSize = 12;
    private const int StaggerStepMs = 50;            // web StaggerContainer per-child delay
    private const int StaggerBaseMs = 10;
    private const int SkeletonTileCount = 6;
    private const double SkeletonLabelHeight = 12;
    private const double SkeletonValueHeight = 20;
    private const double SkeletonRadius = 6;
    private const double SkeletonTileSpacing = 10;

    // web Tailwind grid-cols breakpoints (sm / lg / xl).
    private const double SmBreakpoint = 640;
    private const double LgBreakpoint = 1024;
    private const double XlBreakpoint = 1280;

    private readonly TelemetryGridViewModel _viewModel;
    private readonly TelemetryGridDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly StackPanel _actions = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = IconRowSpacing,
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

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network vehicle-state source.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public TelemetryGrid(
        ITelemetryGridSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        TelemetryGridDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new TelemetryGridDiagnostics();
        _viewModel = new TelemetryGridViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical surface id (<c>telemetry-grid</c>).</summary>
    public static string SurfaceId => TelemetryGridRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public TelemetryGridViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the tiles in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="TelemetryGridSource"/> from the shared
    /// data layer (the host's P2-core dependencies), scoping the read to the primary (or explicit) vehicle.
    /// </summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static TelemetryGrid Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        TelemetryGridDiagnostics? diagnostics = null)
    {
        var source = new TelemetryGridSource(vehicles, api, engine, options, vehicleId);
        return new TelemetryGrid(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web grid is headerless; the native superset adds a single right-aligned freshness chip + refresh
        // control so the mandated stale / offline / refreshing states have a visible affordance.
        _freshnessChip.Content = _freshnessChipText;
        AutomationProperties.SetName(_refresh, _viewModel.RefreshLabel);
        _refresh.Click += OnRefreshClick;

        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);
        _actions.Children.Add(_refresh);

        _header.Padding = new Thickness(0, 0, 0, HeaderBottomPadding);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_actions);

        _bodyHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _bodyHost.VerticalAlignment = VerticalAlignment.Top;

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);
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
        // Re-flow the responsive grid when the available width crosses a column breakpoint.
        if (e.PreviousSize.Width != e.NewSize.Width &&
            ColumnsForWidth(e.PreviousSize.Width) != ColumnsForWidth(e.NewSize.Width) &&
            IsGridState(_viewModel.State))
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
        AutomationProperties.SetName(this, _viewModel.Title);

        switch (_viewModel.State)
        {
            case TelemetryGridState.Loading:
                Content = BuildLoading();
                break;

            case TelemetryGridState.Error:
                Content = BuildError();
                break;

            default:
                UpdateHeader();
                _bodyHost.Child = BuildBody();
                Content = _root;
                break;
        }
    }

    private void UpdateHeader()
    {
        var state = _viewModel.State;
        bool stale = state == TelemetryGridState.Stale;
        bool offline = state == TelemetryGridState.Offline;

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
        AutomationProperties.SetName(_freshness, _viewModel.RefreshLabel);
        _refresh.IsEnabled = !_viewModel.IsFetching;
    }

    private UIElement BuildBody() => _viewModel.HasData ? BuildGrid(_viewModel.Display) : BuildEmpty();

    private Grid BuildGrid(TelemetryGridDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = BuildColumnGrid(columns, display.Tiles.Count);

        for (int i = 0; i < display.Tiles.Count; i++)
        {
            // Web parity: each tile is a StaggerItem inside a StaggerContainer — reproduce the staggered
            // entrance with a per-tile fade-in whose delay increases with the tile index (reduce-motion aware).
            var tile = new TsFadeIn
            {
                DelayMs = StaggerBaseMs + (i * StaggerStepMs),
                Content = BuildTile(display.Tiles[i]),
            };
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static Grid BuildColumnGrid(int columns, int itemCount)
    {
        var grid = new Grid
        {
            ColumnSpacing = GridGap,
            RowSpacing = GridGap,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

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

    // The native InfoTile: a glass panel with a muted glyph + label row above the tinted value and optional sub.
    private static TsGlassPanel BuildTile(TelemetryTile tile)
    {
        var iconRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = IconRowSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        iconRow.Children.Add(icon);

        iconRow.Children.Add(new TextBlock
        {
            Text = tile.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var column = new StackPanel { Spacing = TileInnerSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(iconRow);
        column.Children.Add(new TextBlock
        {
            Text = tile.ValueText,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = AccentBrush(tile.Accent),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        });

        if (tile.SubText is { Length: > 0 } sub)
        {
            column.Children.Add(new TextBlock
            {
                Text = sub,
                FontSize = SubFontSize,
                Foreground = DisplayTokens.TextMuted,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, tile.AutomationName);
        return panel;
    }

    private Grid BuildLoading()
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = BuildColumnGrid(columns, SkeletonTileCount);

        for (int i = 0; i < SkeletonTileCount; i++)
        {
            var tile = BuildSkeletonTile();
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
    }

    private static TsGlassPanel BuildSkeletonTile()
    {
        var column = new StackPanel { Spacing = SkeletonTileSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonLabelHeight,
            Radius = SkeletonRadius,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = double.NaN,
            BlockHeight = SkeletonValueHeight,
            Radius = SkeletonRadius,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = TelemetryGridProjection.SpeedGlyph,
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

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

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    // web Tailwind: grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6.
    private static int ColumnsForWidth(double width) => width switch
    {
        <= 0 => 3,
        < SmBreakpoint => 2,
        < LgBreakpoint => 3,
        < XlBreakpoint => 4,
        _ => 6,
    };

    private static bool IsGridState(TelemetryGridState state) =>
        state is TelemetryGridState.Loaded or TelemetryGridState.Stale or TelemetryGridState.Offline or TelemetryGridState.Loading;

    private static Brush AccentBrush(TelemetryTileAccent accent) => accent switch
    {
        TelemetryTileAccent.Success => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Success)),
        TelemetryTileAccent.Warning => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Warning)),
        TelemetryTileAccent.Danger => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger)),
        TelemetryTileAccent.Muted => DisplayTokens.TextMuted,
        _ => DisplayTokens.TextPrimary,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TelemetryGridAutomationPeer(this);

    private sealed class TelemetryGridAutomationPeer(TelemetryGrid owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((TelemetryGrid)Owner).ViewModel.Title
                : name;
        }
    }
}
