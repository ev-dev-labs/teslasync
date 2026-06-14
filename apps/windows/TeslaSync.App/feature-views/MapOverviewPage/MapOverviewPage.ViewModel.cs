using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>MapOverviewPage</c> view — the native port of the web
/// page's data flow (web/src/features/maps/pages/MapOverviewPage.tsx). It owns the four reads the web page
/// performs through the injected <see cref="IMapOverviewFeed"/> (the native <c>useVehicles</c> +
/// <c>useQuery(['position-latest'/'position-history'/'location-latest', …])</c> hooks), projects them through
/// <see cref="MapOverviewProjection"/> with the active units, and surfaces the four web data states
/// (loading / empty / error / success) plus the header freshness flags so the view is a thin renderer. It owns
/// the two view controls the web page owns: the selected vehicle (<see cref="SelectVehicle"/>, web header
/// picker / <c>useSelectedVehicle</c>) and the base-map style (<see cref="SetMapStyle"/>, web
/// <c>useUrlEnum('layer')</c>), plus the 15-second latest-position auto-refresh (web
/// <c>refetchInterval: 15_000</c>) exposed as <see cref="RefreshLatestAsync"/>. Observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class MapOverviewPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMapOverviewFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly MapOverviewDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _vehicleCts;
    private bool _disposed;

    private MapOverviewSnapshot _snapshot = MapOverviewSnapshot.Empty;
    private bool _vehiclesLoading = true;
    private bool _latestLoading;
    private bool _historyLoading;
    private bool _hasVehiclesData;
    private string? _vehiclesError;
    private string? _latestError;
    private string? _historyError;
    private long? _selectedVehicleId;
    private string _mapStyleId = "dark";

    private MapOverviewState _state = MapOverviewState.Loading;
    private MapOverviewDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The map-overview data port (the four reads the web page performs).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MapOverviewPageViewModel(
        IMapOverviewFeed feed,
        ILocalizer localizer,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        MapOverviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new MapOverviewDiagnostics();
        _display = MapOverviewProjection.Project(BuildModel(), _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public MapOverviewState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public MapOverviewDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _vehiclesError is not null || _latestError is not null || _historyError is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The loaded fleet (drives the header vehicle picker options).</summary>
    public IReadOnlyList<MapVehicleRef> Vehicles => _snapshot.Vehicles;

    /// <summary>The currently-selected vehicle id (web <c>useSelectedVehicle().vehicleId</c>), or null.</summary>
    public long? SelectedVehicleId => _selectedVehicleId;

    /// <summary>True while the fleet read is in flight (drives the picker loading state).</summary>
    public bool VehiclesLoading => _vehiclesLoading;

    /// <summary>The fleet-load error message, or null (drives the picker error state).</summary>
    public string? VehiclesError => _vehiclesError;

    /// <summary>The active base-map style id ("dark" / "satellite" / "streets" / "terrain").</summary>
    public string MapStyleId => _mapStyleId;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Load the fleet, resolve the selected vehicle, then load that vehicle's live data (web mount).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsFetching = true;
        _vehiclesLoading = true;
        Reproject();

        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cancellationToken).ConfigureAwait(false);
            _snapshot = _snapshot with { Vehicles = vehicles };
            _hasVehiclesData = true;
            _vehiclesError = null;

            if (_selectedVehicleId is null && vehicles.Count > 0)
            {
                _selectedVehicleId = vehicles[0].Id;
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException ex)
        {
            _vehiclesError = Describe(ex);
        }
        catch (Exception ex)
        {
            _vehiclesError = Describe(ex);
        }

        _vehiclesLoading = false;
        _updatedAt = _clock();

        if (_selectedVehicleId is { } id)
        {
            await LoadVehicleDataAsync(id, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            IsFetching = false;
            UpdatedAt = _updatedAt;
            Reproject();
        }
    }

    /// <summary>Refresh everything (the retry path / web query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Change the scoped vehicle (web header picker) and load its live data.</summary>
    public Task SelectVehicleAsync(long? vehicleId, CancellationToken cancellationToken = default)
    {
        if (vehicleId == _selectedVehicleId)
        {
            return Task.CompletedTask;
        }

        _selectedVehicleId = vehicleId;
        _snapshot = _snapshot with { Latest = null, History = Array.Empty<PositionRecord>(), Location = null };
        _latestError = null;
        _historyError = null;

        if (vehicleId is { } id)
        {
            return LoadVehicleDataAsync(id, cancellationToken);
        }

        Reproject();
        return Task.CompletedTask;
    }

    /// <summary>Set the base-map style (web <c>useUrlEnum('layer')</c>); re-projects without a refetch.</summary>
    public void SetMapStyle(string styleId)
    {
        string next = MapStyles.Id(MapStyles.FromId(styleId));
        if (string.Equals(_mapStyleId, next, StringComparison.Ordinal))
        {
            return;
        }

        _mapStyleId = next;
        Reproject();
    }

    /// <summary>Re-fetch only the latest position (web <c>refetchInterval: 15_000</c> on the latest query).</summary>
    public async Task RefreshLatestAsync(CancellationToken cancellationToken = default)
    {
        if (_selectedVehicleId is not { } id)
        {
            return;
        }

        IsFetching = true;
        try
        {
            var latest = await _feed.FetchLatestPositionAsync(id, cancellationToken).ConfigureAwait(false);
            _snapshot = _snapshot with { Latest = latest };
            _latestError = null;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException ex)
        {
            _latestError = Describe(ex);
        }
        catch (Exception ex)
        {
            _latestError = Describe(ex);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    private async Task LoadVehicleDataAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _vehicleCts, cancellationToken);

        IsFetching = true;
        _latestLoading = true;
        _historyLoading = true;
        Reproject();

        try
        {
            var latest = await _feed.FetchLatestPositionAsync(vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _snapshot = _snapshot with { Latest = latest };
            _latestError = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _latestError = Describe(ex);
        }

        _latestLoading = false;

        try
        {
            var history = await _feed.FetchPositionHistoryAsync(vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _snapshot = _snapshot with { History = history };
            _historyError = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _historyError = Describe(ex);
        }

        _historyLoading = false;

        // The web location-snapshot query is best-effort: its failure is not folded into anyError, so a missing
        // snapshot never breaks the page. Swallow the error and leave the detail rows in their empty state.
        try
        {
            var location = await _feed.FetchLocationSnapshotAsync(vehicleId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _snapshot = _snapshot with { Location = location };
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _snapshot = _snapshot with { Location = null };
        }

        _updatedAt = _clock();
        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _vehicleCts);
    }

    private MapOverviewModel BuildModel() =>
        new(
            _snapshot,
            _vehiclesLoading && !_hasVehiclesData,
            _latestLoading,
            _historyLoading,
            _vehiclesError,
            _vehiclesError ?? _latestError ?? _historyError,
            _selectedVehicleId,
            _mapStyleId);

    private void Reproject()
    {
        var display = MapOverviewProjection.Project(BuildModel(), _units, _localizer, _clock());
        Display = display;
        State = display.State;
        OnPropertyChanged(nameof(IsError));
    }

    private static string Describe(Exception ex) =>
        string.IsNullOrWhiteSpace(ex.Message) ? "unknown error" : ex.Message;

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        OnPropertyChanged(name);
    }

    private void OnPropertyChanged(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
