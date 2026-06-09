using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Driving Temperature Stats surface — a parity port of
/// web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx. It composes the web's single
/// <c>GlassPanel</c>: a <c>SectionTitle</c> ("Temperature Stats") above either a responsive grid of six
/// <c>MetricCard</c>s (inside min/avg/max, outside min/avg/max — each carrying the temperature value, its
/// unit subtitle and a cyan/green/amber accent) or a friendly empty state when the fleet reports no
/// temperature data. Every state renders — a loading skeleton, the populated grid, the empty surface, an
/// explicit retry surface on hard failure, plus stale and offline freshness chips. All data flows through
/// the shared <see cref="DrivingTemperatureStatsViewModel"/>; the view never performs HTTP. Every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class DrivingTemperatureStats : ContentControl, IDisposable
{
    private const int GridColumns = 3;
    private const int CellCount = 6;

    private readonly DrivingTemperatureStatsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DrivingTemperatureStatsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label flows through.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public DrivingTemperatureStats(
        IDrivingTemperatureStatsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        DrivingTemperatureStatsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new DrivingTemperatureStatsDiagnostics();
        _viewModel = new DrivingTemperatureStatsViewModel(source, localizer, units);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, DrivingTemperatureStatsRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>driving-temperature-stats</c>).</summary>
    public static string SurfaceId => DrivingTemperatureStatsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public DrivingTemperatureStatsViewModel ViewModel => _viewModel;

    /// <summary>The user's unit preference; reassigning re-projects the cells in the new units.</summary>
    public UnitPref Units
    {
        get => _viewModel.Units;
        set => _viewModel.Units = value;
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="DrivingTemperatureStatsSource"/> from
    /// the shared data layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="units">The user's unit preference; defaults to metric.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    /// <returns>A wired surface ready to host.</returns>
    public static DrivingTemperatureStats Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UnitPref? units = null,
        DrivingTemperatureStatsDiagnostics? diagnostics = null)
    {
        var source = new DrivingTemperatureStatsSource(api, engine, options);
        return new DrivingTemperatureStats(source, localizer, units, diagnostics);
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

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
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
        _root.Children.Clear();
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildBody());

        return new TsGlassPanel
        {
            Padding = new Thickness(16),
            Content = column,
        };
    }

    // ── Header (always visible, mirroring the web SectionTitle) ───────────────────────────────────────

    private Grid BuildHeader()
    {
        var title = new SectionTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var freshness = new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(title, 0);
        Grid.SetColumn(freshness, 1);
        grid.Children.Add(title);
        grid.Children.Add(freshness);
        return grid;
    }

    // ── Body (state switch — every state renders) ─────────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        DrivingTemperatureState.Loading => BuildLoading(),
        DrivingTemperatureState.Error => BuildError(),
        DrivingTemperatureState.Empty => BuildEmpty(),
        _ => _viewModel.HasData ? BuildGrid() : BuildEmpty(),
    };

    private Grid BuildGrid()
    {
        var tiles = _viewModel.Display.Tiles;
        var grid = NewUniformGrid(tiles.Count);

        for (int i = 0; i < tiles.Count; i++)
        {
            var card = BuildCard(tiles[i]);
            Grid.SetColumn(card, i % GridColumns);
            Grid.SetRow(card, i / GridColumns);
            grid.Children.Add(card);
        }

        AutomationProperties.SetName(grid, _viewModel.Title);
        return grid;
    }

    private static TsMetricCard BuildCard(DrivingTemperatureTile tile)
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

    private Grid BuildLoading()
    {
        var grid = NewUniformGrid(CellCount);
        for (int i = 0; i < CellCount; i++)
        {
            var skeleton = new TsSkeleton
            {
                BlockHeight = 56,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(skeleton, i % GridColumns);
            Grid.SetRow(skeleton, i / GridColumns);
            grid.Children.Add(skeleton);
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
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
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
        IconGlyph = DrivingTemperatureStatsProjection.ThermometerGlyph,
        Message = _viewModel.EmptyMessage,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid NewUniformGrid(int cellCount)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < GridColumns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(cellCount / (double)GridColumns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        return grid;
    }
}
