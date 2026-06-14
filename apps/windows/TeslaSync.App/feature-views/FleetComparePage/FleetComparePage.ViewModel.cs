using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetComparePage"/> view — the native port of the
/// web page's data flow (web/src/features/analytics/pages/FleetComparePage.tsx). It consumes the
/// cache-then-network <see cref="IFleetCompareSource"/> (the roster + per-vehicle fan-out), auto-selects the
/// first two vehicles (web <c>useEffect</c>), and projects the current A/B selection through
/// <see cref="FleetCompareProjection"/> into the render-ready <see cref="Display"/>. Selection changes are a
/// pure reprojection (no refetch), exactly like the web page where the queries are already resolved and the
/// two <c>Select</c>s just pick ids. The web gate maps onto <see cref="State"/>: vehicles loading → skeleton,
/// fewer than two vehicles → the single-vehicle empty surface, otherwise the side-by-side comparison. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FleetComparePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetCompareSource _source;
    private readonly ILocalizer _localizer;
    private readonly FleetCompareDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private FleetCompareData _data = FleetCompareData.Empty;
    private bool _disposed;

    private FleetCompareState _state = FleetCompareState.Loading;
    private FleetCompareDisplay _display;
    private long? _selectedA;
    private long? _selectedB;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network fleet-comparison port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference (display boundary).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FleetComparePageViewModel(
        IFleetCompareSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        FleetCompareDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new FleetCompareDiagnostics();
        _display = FleetCompareProjection.Project(FleetCompareData.Empty, null, null, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive page state (loading / content / single-vehicle / error / stale / offline).</summary>
    public FleetCompareState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready comparison for the current A/B selection.</summary>
    public FleetCompareDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The selected left-hand vehicle id (web <c>vehicleIdA</c>).</summary>
    public long? SelectedA
    {
        get => _selectedA;
        private set => Set(ref _selectedA, value);
    }

    /// <summary>The selected right-hand vehicle id (web <c>vehicleIdB</c>).</summary>
    public long? SelectedB
    {
        get => _selectedB;
        private set => Set(ref _selectedB, value);
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cached snapshot (drives the error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The localized page title (web <c>comparison.title</c>).</summary>
    public string Title => FleetCompareRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>comparison.subtitle</c>).</summary>
    public string Subtitle => FleetCompareRegistration.Subtitle(_localizer);

    /// <summary>True for the states where the side-by-side comparison is rendered (web success branch).</summary>
    public bool HasContent =>
        _state is FleetCompareState.Content or FleetCompareState.Stale or FleetCompareState.Offline;

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
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Select the left-hand vehicle (web <c>setVehicleIdA</c>); re-projects without a refetch.</summary>
    public void SelectA(long vehicleId)
    {
        if (_selectedA == vehicleId || vehicleId == _selectedB)
        {
            return;
        }

        SelectedA = vehicleId;
        Reproject();
    }

    /// <summary>Select the right-hand vehicle (web <c>setVehicleIdB</c>); re-projects without a refetch.</summary>
    public void SelectB(long vehicleId)
    {
        if (_selectedB == vehicleId || vehicleId == _selectedA)
        {
            return;
        }

        SelectedB = vehicleId;
        Reproject();
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the current snapshot (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Apply(RepositoryResult<FleetCompareData> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Empty:
                ApplySnapshot(FleetCompareData.Empty, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(
                    result.Value ?? FleetCompareData.Empty,
                    result.FetchedAt,
                    stale: true,
                    fetching: false,
                    offline: true,
                    error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        FleetCompareData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline = false,
        RepositoryError? error = null)
    {
        _data = data;
        ReconcileSelection(data);
        Display = FleetCompareProjection.Project(data, _selectedA, _selectedB, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        if (!data.HasComparison)
        {
            // Web parity: fewer than two vehicles renders the focused single-vehicle empty state.
            State = FleetCompareState.SingleVehicle;
            return;
        }

        State = offline
            ? FleetCompareState.Offline
            : stale ? FleetCompareState.Stale : FleetCompareState.Content;
    }

    // Web parity: auto-select the first two vehicles when no (valid) selection exists yet, and drop a selection
    // whose vehicle is no longer in the roster.
    private void ReconcileSelection(FleetCompareData data)
    {
        if (_selectedA is { } a && !Contains(data, a))
        {
            SelectedA = null;
        }

        if (_selectedB is { } b && !Contains(data, b))
        {
            SelectedB = null;
        }

        if (_selectedA is null && data.Vehicles.Count >= 1)
        {
            SelectedA = data.Vehicles[0].Id;
        }

        if (_selectedB is null && data.Vehicles.Count >= 2)
        {
            long second = data.Vehicles[1].Id;
            SelectedB = second == _selectedA ? FirstDifferent(data, _selectedA) : second;
        }
    }

    private static bool Contains(FleetCompareData data, long id)
    {
        foreach (var vehicle in data.Vehicles)
        {
            if (vehicle.Id == id)
            {
                return true;
            }
        }

        return false;
    }

    private static long? FirstDifferent(FleetCompareData data, long? exclude)
    {
        foreach (var vehicle in data.Vehicles)
        {
            if (vehicle.Id != exclude)
            {
                return vehicle.Id;
            }
        }

        return null;
    }

    private void Reproject() =>
        Display = FleetCompareProjection.Project(_data, _selectedA, _selectedB, _units, _localizer);

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = FleetCompareState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FleetCompareState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "comparison.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "comparison.error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to compare your vehicles",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached comparison",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
