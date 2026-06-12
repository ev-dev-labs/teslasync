using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DashboardPage</c> view — the native port of the web page's
/// data flow (web/src/features/dashboard/pages/DashboardPage.tsx). It consumes the connected-account port
/// (<see cref="IAuthStatusSource"/> = <c>useAuthStatus</c>) as a cache-then-network stream, drives the
/// vehicle-sync command port (<see cref="IVehicleSyncGateway"/> = <c>useSyncVehicles</c>), owns the local
/// edit-mode toggle (web <c>editMode</c>), derives the three-state matrix (loading / error / success) from the
/// auth spine, and projects everything through <see cref="DashboardProjection"/> into a render-ready
/// <see cref="Display"/>. A populated auth snapshot always renders the success layout (the onboarding hero covers
/// its own branch), so the page never collapses to a blank surface. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DashboardPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAuthStatusSource _authSource;
    private readonly IVehicleSyncGateway _syncGateway;
    private readonly ILocalizer _localizer;
    private readonly DashboardDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<DashboardAuthStatus> _authResult = RepositoryResult<DashboardAuthStatus>.Loading();
    private RepositoryError? _actionError;
    private bool _editMode;

    private DashboardState _state = DashboardState.Loading;
    private DashboardDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isSyncing;

    /// <summary>Creates the holder over its auth-status source, vehicle-sync gateway, localizer and clock / diagnostics.</summary>
    /// <param name="authSource">The cache-then-network connected-account port (native <c>useAuthStatus</c>).</param>
    /// <param name="syncGateway">The one-shot vehicle-sync command port (native <c>useSyncVehicles</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp stamping in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DashboardPageViewModel(
        IAuthStatusSource authSource,
        IVehicleSyncGateway syncGateway,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        DashboardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(authSource);
        ArgumentNullException.ThrowIfNull(syncGateway);
        ArgumentNullException.ThrowIfNull(localizer);

        _authSource = authSource;
        _syncGateway = syncGateway;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DashboardDiagnostics();
        _display = DashboardProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / error / success).</summary>
    public DashboardState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DashboardDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful auth-read timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background auth refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the auth read failed with no value (drives the top-level error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True while a vehicle sync is in flight (web <c>syncVehicles.isPending</c>; drives the button ring).</summary>
    public bool IsSyncing
    {
        get => _isSyncing;
        private set => Set(ref _isSyncing, value);
    }

    /// <summary>The current edit-mode state (web <c>editMode</c>).</summary>
    public bool EditMode => _editMode;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the cache-then-network auth-status read (web <c>useAuthStatus</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        _actionError = null;
        if (!_authResult.HasValue)
        {
            _authResult = RepositoryResult<DashboardAuthStatus>.Loading();
            Reproject();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _authSource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                cts.Token.ThrowIfCancellationRequested();
                _authResult = result;
                Reproject();
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the auth status (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Trigger a one-shot vehicle sync (web <c>syncVehicles.mutate()</c>): marks the action in flight, runs the
    /// gateway, and on success re-loads the auth status so the onboarding branch refreshes. A failure is surfaced
    /// as the additive error banner without discarding the resolved auth value.
    /// </summary>
    public async Task SyncAsync(CancellationToken cancellationToken = default)
    {
        if (_isSyncing)
        {
            return;
        }

        IsSyncing = true;
        _actionError = null;
        Reproject();

        RepositoryResult<bool> result;
        try
        {
            result = await _syncGateway.SyncAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsSyncing = false;
            return;
        }

        IsSyncing = false;

        if (result.Status == LoadStatus.Error && result.Error is { } error)
        {
            _actionError = error;
            Reproject();
            return;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Enter or leave the dashboard edit mode (web <c>setEditMode</c>); re-projects without a reload.</summary>
    public void SetEditMode(bool editMode)
    {
        if (_editMode == editMode)
        {
            return;
        }

        _editMode = editMode;
        Reproject();
    }

    /// <summary>Toggle the dashboard edit mode (web Customize / Done).</summary>
    public void ToggleEditMode() => SetEditMode(!_editMode);

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

    private DashboardModel BuildModel()
    {
        var hasValue = _authResult.HasValue;
        var loading = !hasValue && _authResult.Status == LoadStatus.Loading;
        var loadFailed = !hasValue && _authResult.Status == LoadStatus.Error;
        var auth = hasValue ? _authResult.Value! : DashboardAuthStatus.Unknown;

        var errorDetail = _actionError?.Message
            ?? (loadFailed ? _authResult.Error?.Message : null);

        return new DashboardModel(
            Auth: auth,
            Loading: loading,
            LoadFailed: loadFailed,
            ErrorDetail: errorDetail,
            EditMode: _editMode,
            Syncing: _isSyncing);
    }

    private void Reproject()
    {
        var display = DashboardProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
        IsError = display.State == DashboardState.Error;

        if (_authResult.HasValue && _authResult.FetchedAt is { } fetchedAt)
        {
            UpdatedAt = fetchedAt;
        }
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
