using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleHeader"/> view — the native port of the web
/// header (web/src/features/vehicles/components/VehicleHeader.tsx) together with the hook composition that feeds
/// it (<c>useVehicles</c> + <c>useVehicleState</c> + <c>useWakeVehicle</c>). The web component is a pure child
/// of the vehicle-detail page; the native surface binds its own cache-then-network <see cref="IVehicleHeaderSource"/>,
/// projects each snapshot through <see cref="VehicleHeaderProjection"/>, and exposes the mutually-exclusive
/// <see cref="State"/>, the wake-action <see cref="WakePhase"/> and the freshness flags so the view is a thin
/// renderer. On a successful wake it waits a settle window then refetches the vehicle state, mirroring the web
/// <c>setTimeout(onRefetchState, 5000)</c>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class VehicleHeaderViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly TimeSpan DefaultWakeSettle = TimeSpan.FromSeconds(5);

    private readonly IVehicleHeaderSource _source;
    private readonly ILocalizer _localizer;
    private readonly VehicleHeaderDiagnostics _diagnostics;
    private readonly Func<CancellationToken, Task> _wakeSettleDelay;

    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleHeaderData>? _last;
    private long _vehicleId;
    private bool _disposed;

    private VehicleHeaderState _state = VehicleHeaderState.Loading;
    private VehicleHeaderDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    private VehicleHeaderWakePhase _wakePhase = VehicleHeaderWakePhase.Idle;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) wake-settle delay.</summary>
    /// <param name="source">The cache-then-network header source plus wake mutation.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink, or null for a no-op collector.</param>
    /// <param name="wakeSettleDelay">
    /// The delay awaited after a successful wake before refetching state (web <c>setTimeout(…, 5000)</c>);
    /// null uses a 5-second <see cref="Task.Delay(TimeSpan, CancellationToken)"/>. Tests inject a no-op.
    /// </param>
    public VehicleHeaderViewModel(
        IVehicleHeaderSource source,
        ILocalizer localizer,
        VehicleHeaderDiagnostics? diagnostics = null,
        Func<CancellationToken, Task>? wakeSettleDelay = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new VehicleHeaderDiagnostics();
        _wakeSettleDelay = wakeSettleDelay ?? (ct => Task.Delay(DefaultWakeSettle, ct));
        _display = VehicleHeaderDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public VehicleHeaderState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (name, status, subtitle).</summary>
    public VehicleHeaderDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasVehicle));
            Raise(nameof(CanWake));
            Raise(nameof(WakeButtonEnabled));
        }
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

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
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

    /// <summary>Localized error / offline message shown in the error surface or beside the cached header.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries and the post-wake refetch).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The wake-action lifecycle phase (idle / waking / sent / failed).</summary>
    public VehicleHeaderWakePhase WakePhase
    {
        get => _wakePhase;
        private set
        {
            if (Set(ref _wakePhase, value))
            {
                Raise(nameof(IsWaking));
                Raise(nameof(CanWake));
                Raise(nameof(WakeButtonEnabled));
                Raise(nameof(WakeStatusMessage));
                Raise(nameof(WakeFailed));
            }
        }
    }

    /// <summary>True while the wake command is in flight (the button shows its busy ring).</summary>
    public bool IsWaking => _wakePhase == VehicleHeaderWakePhase.Waking;

    /// <summary>True once a real vehicle backs the header (the wake action is offered).</summary>
    public bool HasVehicle => _display.HasVehicle;

    /// <summary>
    /// True when the wake action can be offered: a vehicle is resolved and no wake is already in flight.
    /// Mirrors the web guard (the button is disabled only while <c>wakeMut.isPending</c>), extended with the
    /// "a vehicle exists" precondition the standalone surface owns.
    /// </summary>
    public bool CanWake => HasVehicle && _wakePhase != VehicleHeaderWakePhase.Waking;

    /// <summary>True when the wake button is interactive. Always rendered; never hidden.</summary>
    public bool WakeButtonEnabled => CanWake;

    /// <summary>
    /// The transient wake-result message (web toast): the success confirmation once sent, the failure message
    /// once failed, or null while idle / in flight.
    /// </summary>
    public string? WakeStatusMessage => _wakePhase switch
    {
        VehicleHeaderWakePhase.Sent => VehicleHeaderRegistration.WakeSuccessMessage(_localizer),
        VehicleHeaderWakePhase.Failed => VehicleHeaderRegistration.WakeErrorMessage(_localizer),
        _ => null,
    };

    /// <summary>True when the last wake failed (drives the inline wake-error treatment).</summary>
    public bool WakeFailed => _wakePhase == VehicleHeaderWakePhase.Failed;

    /// <summary>Localized surface title.</summary>
    public string Title => VehicleHeaderRegistration.Name(_localizer);

    /// <summary>Localized "no vehicle" empty-state message.</summary>
    public string EmptyMessage => VehicleHeaderRegistration.EmptyMessage(_localizer);

    /// <summary>Localized back-affordance label.</summary>
    public string BackLabel => VehicleHeaderRegistration.BackLabel(_localizer);

    /// <summary>Localized wake-action label.</summary>
    public string WakeLabel => VehicleHeaderRegistration.WakeLabel(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the cache-then-network sequence is exhausted.</returns>
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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Send the wake command (web <c>handleWake</c> → <c>wakeMut.mutate</c>). No-ops when the action is not
    /// available so an accidental call can never wake a non-resolved vehicle. On success it records the
    /// resolution, then waits the settle window and refetches the vehicle state
    /// (web <c>setTimeout(onRefetchState, 5000)</c>); on failure it surfaces the inline wake error.
    /// </summary>
    /// <param name="cancellationToken">Cancels the wake command and the post-wake settle / refetch.</param>
    /// <returns>A task that completes when the wake (and any follow-up refetch) resolves.</returns>
    public async Task WakeAsync(CancellationToken cancellationToken = default)
    {
        if (!CanWake)
        {
            return;
        }

        long id = _vehicleId;
        WakePhase = VehicleHeaderWakePhase.Waking;
        _diagnostics.RecordWakeRequested();

        VehicleHeaderWakeOutcome outcome;
        try
        {
            outcome = await _source.WakeAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            WakePhase = VehicleHeaderWakePhase.Idle;
            return;
        }

        if (!outcome.Success)
        {
            WakePhase = VehicleHeaderWakePhase.Failed;
            _diagnostics.RecordWakeResolved(false);
            return;
        }

        WakePhase = VehicleHeaderWakePhase.Sent;
        _diagnostics.RecordWakeResolved(true);

        // Web parity: wait for the vehicle to wake, then refetch its state.
        try
        {
            await _wakeSettleDelay(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

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
        _state is VehicleHeaderState.Loaded
            or VehicleHeaderState.Stale
            or VehicleHeaderState.Offline
            or VehicleHeaderState.Empty;

    private void Apply(RepositoryResult<VehicleHeaderData> result)
    {
        _last = result;
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
        VehicleHeaderData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // A resolved vehicle always renders the header; only a vehicle-less snapshot is classified Empty (via
        // the engine's isEmpty predicate, surfaced as LoadStatus.Empty).
        if (!data.HasVehicle)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _vehicleId = data.Vehicle.Id;
        Display = VehicleHeaderProjection.Project(data, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? VehicleHeaderState.Offline
            : stale
                ? VehicleHeaderState.Stale
                : VehicleHeaderState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleHeaderState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _vehicleId = 0;
        Display = VehicleHeaderDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleHeaderState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleHeaderState.Error;
    }

    private string ErrorTextFor(RepositoryError? error) => error?.Kind switch
    {
        RepositoryErrorKind.Unauthorized => VehicleHeaderRegistration.AuthErrorMessage(_localizer),
        RepositoryErrorKind.Offline or RepositoryErrorKind.Network => VehicleHeaderRegistration.OfflineMessage(_localizer),
        _ => VehicleHeaderRegistration.LoadErrorMessage(_localizer),
    };

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
