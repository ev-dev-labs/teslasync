using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetSummary"/> view — the native port of the web
/// Fleet Summary component (web/src/features/vehicles/components/FleetSummary.tsx). The web component is a pure
/// child of its parent page that fans out one <c>fetchVehicleState</c> per vehicle; the native surface binds
/// its own cache-then-network <see cref="IFleetSummarySource"/> (the vehicle list + the per-vehicle state
/// fan-out), projects each rollup through <see cref="FleetSummaryProjection"/> in the user's distance unit, and
/// exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer.
/// The four tiles always render for the <see cref="FleetSummaryState.Loaded"/>,
/// <see cref="FleetSummaryState.Stale"/> and <see cref="FleetSummaryState.Offline"/> states; a friendly empty
/// state covers <see cref="FleetSummaryState.Empty"/> (no vehicles in the fleet). Reassigning
/// <see cref="Units"/> re-projects the cached rollup without a refetch. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class FleetSummaryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetSummarySource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private FleetSummaryState _state = FleetSummaryState.Loading;
    private FleetSummaryDisplay _display;
    private FleetSummaryReading _reading = FleetSummaryReading.Empty;
    private UnitPref _units;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network fleet rollup source (P1/S8 seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public FleetSummaryViewModel(IFleetSummarySource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = FleetSummaryDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public FleetSummaryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four fleet tiles + region label).</summary>
    public FleetSummaryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>The user's distance unit preference; reassigning re-projects the cached rollup in the new unit.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units.Equals(value))
            {
                return;
            }

            _units = value;
            if (HasContent())
            {
                Display = FleetSummaryProjection.Project(_reading, _units, _localizer);
            }
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (the freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown rollup is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
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

    /// <summary>True when the fleet has at least one vehicle (web <c>vehicles.length &gt; 0</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>The localized Narrator group label for the surface.</summary>
    public string RegionLabel => FleetSummaryRegistration.RegionLabel(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
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

    /// <summary>Retry after a failure (or the web 30s auto-refresh tick) — re-runs the load from the top.</summary>
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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is FleetSummaryState.Loaded
            or FleetSummaryState.Stale
            or FleetSummaryState.Offline
            or FleetSummaryState.Empty;

    private void Apply(RepositoryResult<FleetSummaryReading> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        FleetSummaryReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _reading = reading;
        Display = FleetSummaryProjection.Project(reading, _units, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? FleetSummaryState.Offline
            : stale
                ? FleetSummaryState.Stale
                : FleetSummaryState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = FleetSummaryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _reading = FleetSummaryReading.Empty;
        Display = FleetSummaryDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = FleetSummaryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FleetSummaryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                FleetSummaryRegistration.OfflineKey, FleetSummaryRegistration.OfflineFallback),
            _ => _localizer.GetString(FleetSummaryRegistration.ErrorKey, FleetSummaryRegistration.ErrorFallback),
        };
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
