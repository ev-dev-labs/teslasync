using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Autopilot Section surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx. It renders the cruise / autopilot
/// glass panel: a title heading plus three stat tiles (current speed, cruise set-speed, follow distance),
/// converting both SI speeds to the user's display units at the render boundary (web <c>useUnits</c>) and
/// resolving every label through the i18n facade (web <c>useTranslation</c>). Every state renders — a loading
/// skeleton, the populated tile grid (with a per-tile em-dash for any absent value, web parity), a friendly
/// empty surface when no cruise/autopilot telemetry has arrived, an explicit retry surface on hard failure,
/// plus stale and offline freshness chips. All data flows through the shared
/// <see cref="AutopilotSectionViewModel"/>; the view never performs HTTP. Every interactive element carries a
/// Narrator name.
/// </summary>
public sealed partial class AutopilotSection : ContentControl, IDisposable
{
    private const int LoadingSkeletonTiles = 3;
    private const int CardCount = 3;
    private const double NarrowBreakpoint = 540;

    private readonly AutopilotSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AutopilotSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new();
    private readonly Grid _root = new();
    private readonly Grid _header = new();
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _bodyHost = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    public AutopilotSection(
        IAutopilotSectionSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        AutopilotSectionDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AutopilotSectionDiagnostics();
        _viewModel = new AutopilotSectionViewModel(source, localizer, units, clock);
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

    /// <summary>The canonical surface id (<c>autopilot-section</c>).</summary>
    public static string SurfaceId => AutopilotSectionRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AutopilotSectionViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the metrics in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="AutopilotSectionSource"/> from the
    /// shared data layer (the host's P2-core dependencies). Pass <paramref name="vehicleId"/> to scope the
    /// surface to a specific vehicle (the web <c>vehicleId</c> prop); leave it null to follow the primary one.
    /// </summary>
    public static AutopilotSection Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        AutopilotSectionDiagnostics? diagnostics = null)
    {
        var source = new AutopilotSectionSource(vehicles, api, engine, options, vehicleId);
        return new AutopilotSection(source, localizer, units, diagnostics);
    }

    private void BuildChrome()
    {
        // The web wraps the whole section in a GlassPanel with a visible h2 heading; the native superset keeps
        // that title and adds a right-aligned freshness chip so the mandated stale / offline / refreshing
        // states have a visible affordance.
        _title.Value = _viewModel.Title;

        _header.Padding = new Thickness(0, 0, 0, 12);
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_title, 0);
        Grid.SetColumn(_freshness, 1);
        _header.Children.Add(_title);
        _header.Children.Add(_freshness);

        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(_header, 0);
        Grid.SetRow(_bodyHost, 1);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Padding = new Thickness(24);
        _panel.Content = _root;
        Content = _panel;
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
        // Re-flow the responsive grid when the available width crosses the breakpoint.
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
        // The glass panel + title header stay visible in every state (web parity: the GlassPanel and its h2
        // are always rendered); only the body host swaps between the skeleton / grid / empty / error surfaces.
        UpdateHeader();
        _bodyHost.Child = BuildBody();
        Content = _panel;
    }

    private void UpdateHeader()
    {
        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private UIElement BuildBody()
    {
        if (_viewModel.State == AutopilotState.Loading)
        {
            return BuildLoading();
        }

        if (_viewModel.State == AutopilotState.Error)
        {
            return BuildError();
        }

        var display = _viewModel.Display;
        return display.HasData ? BuildGrid(display) : BuildEmpty();
    }

    // ── Grid ─────────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildGrid(AutopilotDisplay display)
    {
        int columns = ColumnsForWidth(AvailableWidth());
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
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
            var tile = BuildCardTile(display.Cards[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    private static TsStatCard BuildCardTile(AutopilotMetric card)
    {
        var tile = new TsStatCard
        {
            Label = card.Label,
            Value = card.Value,
            Sublabel = card.Sublabel,
            Glyph = card.Glyph,
        };

        // Override the card's default "{Label}: {Value}" name with the richer projection name that also
        // carries the unit (e.g. "Current Speed: 65 km/h").
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
        <= 0 => CardCount,
        < NarrowBreakpoint => 1,
        _ => CardCount,
    };

    private static bool IsGridState(AutopilotState state) =>
        state is AutopilotState.Loaded or AutopilotState.Stale or AutopilotState.Offline;

    // ── State bodies ─────────────────────────────────────────────────────────────────────────────────

    private Grid BuildLoading()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12, Padding = new Thickness(0, 4, 0, 4) };
        int columns = ColumnsForWidth(AvailableWidth());
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
            var tile = new TsStatSkeleton();
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
            Message = _viewModel.ErrorMessage
                ?? _localizer.GetString("dynamics.autopilotError", "Couldn't load autopilot & cruise"),
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
        Title = _viewModel.Title,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    protected override AutomationPeer OnCreateAutomationPeer() => new AutopilotSectionAutomationPeer(this);

    private sealed class AutopilotSectionAutomationPeer(AutopilotSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AutopilotSection)Owner).ViewModel.Title
                : name;
        }
    }
}
