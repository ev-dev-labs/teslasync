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
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Driving-Dynamics summary surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/SummaryStats.tsx. It renders the six motor summary tiles
/// (Total Readings, Avg Torque, Peak Power, Peak Regen, Avg Power and Avg Motor Temp) in the web's responsive
/// grid (<c>grid-cols-2 md:grid-cols-3 lg:grid-cols-6</c>), reducing the motor-history stream into the web's
/// <c>computeMotorStats</c> aggregate, converting the Avg Motor Temp tile to the user's display unit at the
/// render boundary (web <c>useUnits</c>) and resolving every label through the i18n facade (web
/// <c>useTranslation</c>). Each tile maps to the shared <see cref="TsStatCard"/> (web <c>&lt;StatCard&gt;</c>)
/// with its Segoe Fluent accent glyph (the native mapping of the web lucide icon). Every state renders — a
/// loading skeleton, the populated tile grid (entrance-faded, the native mapping of the web
/// <c>StaggerContainer</c>/<c>StaggerItem</c>), a friendly empty surface when there is no motor history, an
/// explicit retry surface on hard failure, plus stale and offline freshness chips. All data flows through the
/// shared <see cref="SummaryStatsViewModel"/>; the view never performs HTTP. Every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class SummaryStats : ContentControl, IDisposable
{
    private const int LoadingSkeletonTiles = 6;
    private const double TileSkeletonHeight = 84;
    private const double NarrowBreakpoint = 540;
    private const double MediumBreakpoint = 900;
    private const double ChipFontSize = 12;

    private readonly SummaryStatsViewModel _viewModel;
    private readonly MotorSummaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Grid _header = new();
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
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network motor-history source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public SummaryStats(
        IMotorSummarySource source,
        ILocalizer localizer,
        UnitPref? units = null,
        MotorSummaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new MotorSummaryDiagnostics();
        _viewModel = new SummaryStatsViewModel(source, localizer, units);
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

    /// <summary>The canonical surface id (<c>summary-stats</c>).</summary>
    public static string SurfaceId => MotorSummaryRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SummaryStatsViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the Avg Motor Temp tile in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="MotorSummarySource"/> from the shared
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
    public static SummaryStats Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        MotorSummaryDiagnostics? diagnostics = null)
    {
        var source = new MotorSummarySource(vehicles, api, engine, options, vehicleId);
        return new SummaryStats(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web grid is headerless; the native superset adds a single right-aligned freshness chip + control
        // so the mandated stale / offline / refreshing states have a visible affordance.
        _freshnessChip.Content = _freshnessChipText;
        _actions.Children.Add(_freshnessChip);
        _actions.Children.Add(_freshness);

        _header.Padding = new Thickness(0, 0, 0, 8);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_actions);

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
        // Re-flow the responsive grid when the available width crosses a breakpoint.
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
        switch (_viewModel.State)
        {
            case MotorSummaryState.Loading:
                Content = BuildLoading();
                break;

            case MotorSummaryState.Error:
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
        bool stale = state == MotorSummaryState.Stale;
        bool offline = state == MotorSummaryState.Offline;

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
    }

    private UIElement BuildBody()
    {
        if (!_viewModel.HasData)
        {
            return BuildEmpty();
        }

        // Map the web StaggerContainer/StaggerItem entrance to a single section-level fade-in that honours
        // reduce-motion while preserving the responsive grid layout.
        return new TsFadeIn { Content = BuildGrid(_viewModel.Display) };
    }

    private Grid BuildGrid(MotorSummaryDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Cards.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Cards.Count; i++)
        {
            var tile = BuildTile(display.Cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static TsStatCard BuildTile(MotorSummaryTile card)
    {
        var tile = new TsStatCard
        {
            Label = card.Label,
            Value = card.Value,
            Glyph = card.Glyph,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(tile, card.AutomationName);
        return tile;
    }

    private double AvailableWidth()
    {
        double width = _bodyHost.ActualWidth;
        if (width <= 0)
        {
            width = ActualWidth;
        }

        return width;
    }

    private static int ColumnsForWidth(double width) => width switch
    {
        // web: grid-cols-2 md:grid-cols-3 lg:grid-cols-6.
        <= 0 => 3,
        < NarrowBreakpoint => 2,
        < MediumBreakpoint => 3,
        _ => 6,
    };

    private static bool IsGridState(MotorSummaryState state) =>
        state is MotorSummaryState.Loaded or MotorSummaryState.Stale or MotorSummaryState.Offline;

    private Grid BuildLoading()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16, Padding = new Thickness(0, 4, 0, 4) };
        const int columns = 3;
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(LoadingSkeletonTiles / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < LoadingSkeletonTiles; i++)
        {
            var tile = new TsSkeleton
            {
                BlockHeight = TileSkeletonHeight,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        AutomationProperties.SetName(grid, _viewModel.LoadingLabel);
        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        return grid;
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
        IconGlyph = MotorSummaryProjection.TotalReadingsGlyph,
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SummaryStatsAutomationPeer(this);

    private sealed class SummaryStatsAutomationPeer(SummaryStats owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SummaryStats)Owner).ViewModel.Title
                : name;
        }
    }
}
