using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>The transient outcome of the last Sync mutation — drives the inline success / error banners.</summary>
public enum VehicleListSyncFeedback
{
    /// <summary>No sync has been run since the page mounted (no banner).</summary>
    None,

    /// <summary>The last sync succeeded — render the success banner (web <c>syncMut.isSuccess</c>).</summary>
    Success,

    /// <summary>The last sync failed — render the error banner (web <c>syncMut.isError</c>).</summary>
    Error,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleListPage"/> view — the native port of the web
/// page's hook composition (web/src/features/vehicles/pages/VehicleListPage.tsx). It consumes the
/// cache-then-network <see cref="IVehicleListSource"/> (the roster spine + per-vehicle state fan-out + pinned
/// ordering), folds the snapshot through <see cref="VehicleListProjection"/> in the user's units, and exposes
/// the mutually-exclusive <see cref="State"/> + the render-ready <see cref="Display"/> so the view is a thin
/// renderer. It owns the page's two mutations (the Sync mutation with its success / error banners + toast, and
/// the per-vehicle Remove mutation with its toast), and reprojects (without a refetch) when the unit preference
/// changes. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VehicleListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleListSource _source;
    private readonly IVehicleListMutations _mutations;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private VehicleListState _state = VehicleListState.Loading;
    private VehicleListReading _reading = VehicleListReading.Empty;
    private VehicleListDisplay _display;
    private UnitPref _units;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    private bool _isSyncing;
    private VehicleListSyncFeedback _syncFeedback = VehicleListSyncFeedback.None;
    private string? _notice;
    private bool _noticeIsError;

    /// <summary>Creates the holder over its data source, mutation port, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network roster source (P1/S8 seam).</param>
    /// <param name="mutations">The sync + remove mutation port (web <c>syncMut</c> / <c>deleteMut</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public VehicleListPageViewModel(
        IVehicleListSource source,
        IVehicleListMutations mutations,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(mutations);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _mutations = mutations;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = VehicleListDisplay.Empty(VehicleListState.Loading, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive lifecycle state.</summary>
    public VehicleListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display the view binds to.</summary>
    public VehicleListDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps content visible while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown roster is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
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

    /// <summary>True while the Sync mutation is in flight (web <c>syncMut.isPending</c>).</summary>
    public bool IsSyncing
    {
        get => _isSyncing;
        private set => Set(ref _isSyncing, value);
    }

    /// <summary>The transient outcome of the last Sync mutation (drives the inline banners).</summary>
    public VehicleListSyncFeedback SyncFeedback
    {
        get => _syncFeedback;
        private set => Set(ref _syncFeedback, value);
    }

    /// <summary>The localized inline Sync banner message (web <c>syncSuccess</c> / <c>syncError</c>), or null.</summary>
    public string? SyncBannerMessage => SyncFeedback switch
    {
        VehicleListSyncFeedback.Success => _localizer.GetString(
            VehicleListPageRegistration.SyncSuccessKey, VehicleListPageRegistration.SyncSuccessFallback),
        VehicleListSyncFeedback.Error => _localizer.GetString(
            VehicleListPageRegistration.SyncErrorKey, VehicleListPageRegistration.SyncErrorFallback),
        _ => null,
    };

    /// <summary>The transient toast message (web <c>toast.success</c> / <c>toast.error</c>), or null when cleared.</summary>
    public string? Notice
    {
        get => _notice;
        private set => Set(ref _notice, value);
    }

    /// <summary>Whether the active <see cref="Notice"/> is an error (drives its tone).</summary>
    public bool NoticeIsError
    {
        get => _noticeIsError;
        private set => Set(ref _noticeIsError, value);
    }

    /// <summary>True when the roster has at least one vehicle (web <c>vehicleList.length &gt; 0</c>).</summary>
    public bool HasVehicles => _reading.VehicleCount > 0;

    /// <summary>True when the roster has at least two vehicles (web <c>vehicleList.length &gt;= 2</c>) — Compare affordance.</summary>
    public bool CanCompare => _reading.VehicleCount >= 2;

    /// <summary>The first two vehicle ids the Compare affordance pre-fills (web <c>leftId</c> / <c>rightId</c>).</summary>
    public (long Left, long Right)? CompareIds =>
        _reading.VehicleCount >= 2 ? (_reading.Entries[0].Vehicle.Id, _reading.Entries[1].Vehicle.Id) : null;

    /// <summary>The user's unit preference; reassigning re-projects the cached roster in the new units.</summary>
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
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the loading skeleton only when nothing is
    /// already resolved (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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

    /// <summary>Refresh the current roster (web auto-refetch / post-mutation invalidation).</summary>
    /// <param name="cancellationToken">Cancels the refresh.</param>
    /// <returns>A task that completes when the refreshed load's sequence is exhausted.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a hard failure — re-runs the load from the top (web <c>error</c> retry).</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Run the Sync mutation (web <c>syncMut.mutate()</c>): marks pending, posts the sync, then on success sets
    /// the success banner + toast and refreshes the roster, or on failure sets the error banner + toast.
    /// </summary>
    /// <param name="cancellationToken">Cancels the sync.</param>
    /// <returns>A task that completes when the sync (and any refresh) resolves.</returns>
    public async Task SyncAsync(CancellationToken cancellationToken = default)
    {
        if (IsSyncing)
        {
            return;
        }

        IsSyncing = true;
        try
        {
            await _mutations.SyncAsync(cancellationToken).ConfigureAwait(false);
            SyncFeedback = VehicleListSyncFeedback.Success;
            Raise(nameof(SyncBannerMessage));
            ShowNotice(
                _localizer.GetString(VehicleListPageRegistration.SyncToastKey, VehicleListPageRegistration.SyncToastFallback),
                isError: false);
            await RefreshAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            SyncFeedback = VehicleListSyncFeedback.Error;
            Raise(nameof(SyncBannerMessage));
            ShowNotice(
                _localizer.GetString(VehicleListPageRegistration.SyncFailedKey, VehicleListPageRegistration.SyncFailedFallback),
                isError: true);
        }
        finally
        {
            IsSyncing = false;
        }
    }

    /// <summary>
    /// Run the Remove mutation for one vehicle (web <c>deleteMut.mutate(id)</c>): deletes it, then on success
    /// sets the success toast and refreshes the roster, or on failure sets the error toast.
    /// </summary>
    /// <param name="vehicleId">The id of the vehicle to remove.</param>
    /// <param name="cancellationToken">Cancels the delete.</param>
    /// <returns>True when the delete succeeded.</returns>
    public async Task<bool> DeleteAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _mutations.DeleteAsync(vehicleId, cancellationToken).ConfigureAwait(false);
            ShowNotice(
                _localizer.GetString(VehicleListPageRegistration.DeleteSuccessKey, VehicleListPageRegistration.DeleteSuccessFallback),
                isError: false);
            await RefreshAsync(cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            ShowNotice(
                _localizer.GetString(VehicleListPageRegistration.DeleteFailedKey, VehicleListPageRegistration.DeleteFailedFallback),
                isError: true);
            return false;
        }
    }

    /// <summary>Dismiss the active transient toast (web toast auto-dismiss / user dismiss).</summary>
    public void ClearNotice()
    {
        Notice = null;
        NoticeIsError = false;
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
    }

    private bool HasContent() => _state is VehicleListState.Success or VehicleListState.Empty;

    private void Apply(RepositoryResult<VehicleListReading> result)
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

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            default:
                if (!HasContent())
                {
                    SetError(result.Error);
                }

                break;
        }
    }

    private void ApplySnapshot(
        VehicleListReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: a resolved roster with no vehicles is the empty state, not an empty success page.
        if (reading.VehicleCount == 0 && !offline)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _reading = reading;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = VehicleListState.Success;
        Reproject();
        Raise(nameof(HasVehicles));
        Raise(nameof(CanCompare));
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        IsStale = false;
        State = VehicleListState.Loading;
        Reproject();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _reading = VehicleListReading.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = VehicleListState.Empty;
        Reproject();
        Raise(nameof(HasVehicles));
        Raise(nameof(CanCompare));
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleListState.Error;
        Reproject();
    }

    private void Reproject() =>
        Display = VehicleListProjection.Project(_reading, _state, _units, _localizer);

    private string ErrorTextFor(RepositoryError? error) =>
        _localizer.GetString(VehicleListPageRegistration.LoadErrorKey, VehicleListPageRegistration.LoadErrorFallback);

    private void ShowNotice(string message, bool isError)
    {
        NoticeIsError = isError;
        Notice = message;
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
