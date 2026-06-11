using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TelemetryGrid"/> view — the native port of the web
/// <c>TelemetryGrid</c> child plus its parent's query lifecycle
/// (web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx +
/// the page's <c>useVehicleState</c> read). It consumes the cache-then-network
/// <see cref="ITelemetryGridSource"/>, projects each reading through <see cref="TelemetryGridProjection"/> with
/// the active units, and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view
/// is a thin renderer. A reading always renders the six tiles (web <c>state</c> truthy); the source collapses a
/// state-less response to <see cref="TelemetryGridState.Empty"/>. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class TelemetryGridViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITelemetryGridSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private VehicleTelemetryReading? _lastReading;
    private bool _disposed;

    private TelemetryGridState _state = TelemetryGridState.Loading;
    private TelemetryGridDisplay _display = TelemetryGridDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network vehicle-state source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public TelemetryGridViewModel(ITelemetryGridSource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public TelemetryGridState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six telemetry tiles).</summary>
    public TelemetryGridDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
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

    /// <summary>True when a vehicle-state reading has resolved and the tiles are renderable (web <c>state</c> truthy).</summary>
    public bool HasData => _display.HasData;

    /// <summary>The user's unit preference; reassigning re-projects the current reading in the new units.</summary>
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
            if (_lastReading is { } reading)
            {
                Display = TelemetryGridProjection.Project(reading, _units, _localizer);
            }
        }
    }

    /// <summary>Localized surface title (used as the accessible name; the web grid itself is headerless).</summary>
    public string Title => TelemetryGridRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (no resolved vehicle / no usable state).</summary>
    public string EmptyMessage => TelemetryGridRegistration.EmptyMessage(_localizer);

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("vehicles.telemetry.grid.loading", "Loading telemetry");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle => _localizer.GetString("vehicles.telemetry.grid.errorTitle", "Couldn't load telemetry");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel => _localizer.GetString("vehicles.telemetry.grid.refresh", "Refresh telemetry");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("common.offline", "Offline");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the tiles while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the emission stream is exhausted (or superseded).</returns>
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

    /// <summary>Retry after a failure — re-runs the load from the top (web query refetch).</summary>
    /// <returns>A task that completes when the reload finishes.</returns>
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
        _state is TelemetryGridState.Loaded or TelemetryGridState.Stale or TelemetryGridState.Offline;

    private void Apply(RepositoryResult<VehicleTelemetryReading> result)
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
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        VehicleTelemetryReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _lastReading = reading;
        Display = TelemetryGridProjection.Project(reading, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? TelemetryGridState.Offline
            : stale ? TelemetryGridState.Stale : TelemetryGridState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = TelemetryGridState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastReading = null;
        Display = TelemetryGridDisplay.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = TelemetryGridState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        _lastReading = null;
        Display = TelemetryGridDisplay.Empty;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = TelemetryGridState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "vehicles.telemetry.grid.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "vehicles.telemetry.grid.error.offline",
            _ => "vehicles.telemetry.grid.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view telemetry",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached telemetry",
            _ => "Couldn't load telemetry",
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
