using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SystemStatusPage</c> view — the native port of the web page's
/// data flow (web/src/features/system/pages/SystemStatusPage.tsx). It reads the seven status queries through the
/// injected <see cref="ISystemStatusFeed"/> (web <c>useSystemHealth</c> / <c>useVehicles</c> /
/// <c>useNotificationStats</c> / <c>useAuthStatus</c> / <c>useBackupRuns</c> / <c>useBackupConfigs</c> /
/// <c>useMaintenanceState</c>), tracks each source's independent loading / error / data state, and projects the
/// combined result through <see cref="SystemStatusProjection"/> so the view is a thin renderer. It surfaces the four
/// web data states (loading / empty / error / success) per source plus an in-flight flag; observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SystemStatusPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISystemStatusFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _healthLoading = true;
    private bool _healthHasError;
    private string? _healthError;
    private SystemHealthSnapshot _health = SystemHealthSnapshot.Empty;
    private DateTimeOffset? _healthUpdatedAt;

    private bool _vehiclesLoading = true;
    private bool _vehiclesHasError;
    private StatusVehiclesSnapshot _vehicles = StatusVehiclesSnapshot.Empty;

    private bool _notifLoading = true;
    private bool _notifHasError;
    private NotificationStatsSnapshot _notif = NotificationStatsSnapshot.Empty;

    private bool _authLoading = true;
    private bool _authHasError;
    private AuthStatusSnapshot _auth = AuthStatusSnapshot.Empty;

    private bool _runsLoading = true;
    private bool _runsHasError;
    private BackupRunsSnapshot _runs = BackupRunsSnapshot.Empty;

    private bool _configsLoading = true;
    private bool _configsHasError;
    private BackupConfigsSnapshot _configs = BackupConfigsSnapshot.Empty;

    private bool _maintLoading = true;
    private bool _maintHasError;
    private MaintenanceSnapshot _maint = MaintenanceSnapshot.Empty;

    private SystemStatusState _state = SystemStatusState.Loading;
    private SystemStatusDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock.</summary>
    /// <param name="feed">The status data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time formatting in tests.</param>
    public SystemStatusPageViewModel(ISystemStatusFeed feed, ILocalizer localizer, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = SystemStatusProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SystemStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SystemStatusDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (web <c>isFetching</c> — drives the refresh spinner).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>System Status</c>).</summary>
    public string Title => SystemStatusRegistration.Title(_localizer);

    /// <summary>Run (or re-run) all seven status queries (web initial load + 30 s refetch).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_health.HasData)
        {
            _healthLoading = true;
        }

        Reproject();

        await Task.WhenAll(
            LoadHealthAsync(cts.Token),
            LoadVehiclesAsync(cts.Token),
            LoadNotificationsAsync(cts.Token),
            LoadAuthAsync(cts.Token),
            LoadBackupRunsAsync(cts.Token),
            LoadBackupConfigsAsync(cts.Token),
            LoadMaintenanceAsync(cts.Token)).ConfigureAwait(true);

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh all seven queries (web refetch / auto-refresh / Retry / R shortcut).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private async Task LoadHealthAsync(CancellationToken token)
    {
        try
        {
            var snapshot = await _feed.FetchHealthAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _health = snapshot;
            _healthHasError = false;
            _healthError = null;
            _healthLoading = false;
            _healthUpdatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _healthHasError = true;
            _healthError = ex.Message;
            _healthLoading = false;
        }

        Reproject();
    }

    private async Task LoadVehiclesAsync(CancellationToken token)
    {
        try
        {
            _vehicles = await _feed.FetchVehiclesAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _vehiclesHasError = false;
            _vehiclesLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _vehiclesHasError = true;
            _vehiclesLoading = false;
        }

        Reproject();
    }

    private async Task LoadNotificationsAsync(CancellationToken token)
    {
        try
        {
            _notif = await _feed.FetchNotificationsAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _notifHasError = false;
            _notifLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _notifHasError = true;
            _notifLoading = false;
        }

        Reproject();
    }

    private async Task LoadAuthAsync(CancellationToken token)
    {
        try
        {
            _auth = await _feed.FetchAuthAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _authHasError = false;
            _authLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _authHasError = true;
            _authLoading = false;
        }

        Reproject();
    }

    private async Task LoadBackupRunsAsync(CancellationToken token)
    {
        try
        {
            _runs = await _feed.FetchBackupRunsAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _runsHasError = false;
            _runsLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _runsHasError = true;
            _runsLoading = false;
        }

        Reproject();
    }

    private async Task LoadBackupConfigsAsync(CancellationToken token)
    {
        try
        {
            _configs = await _feed.FetchBackupConfigsAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _configsHasError = false;
            _configsLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _configsHasError = true;
            _configsLoading = false;
        }

        Reproject();
    }

    private async Task LoadMaintenanceAsync(CancellationToken token)
    {
        try
        {
            _maint = await _feed.FetchMaintenanceAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _maintHasError = false;
            _maintLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _maintHasError = true;
            _maintLoading = false;
        }

        Reproject();
    }

    private SystemStatusModel BuildModel() => new(
        HealthLoading: _healthLoading, HealthHasError: _healthHasError, HealthError: _healthError, Health: _health,
        VehiclesLoading: _vehiclesLoading, VehiclesHasError: _vehiclesHasError, Vehicles: _vehicles,
        NotificationsLoading: _notifLoading, NotificationsHasError: _notifHasError, Notifications: _notif,
        AuthLoading: _authLoading, AuthHasError: _authHasError, Auth: _auth,
        BackupRunsLoading: _runsLoading, BackupRunsHasError: _runsHasError, BackupRuns: _runs,
        BackupConfigsLoading: _configsLoading, BackupConfigsHasError: _configsHasError, BackupConfigs: _configs,
        MaintenanceLoading: _maintLoading, MaintenanceHasError: _maintHasError, Maintenance: _maint,
        HealthUpdatedAt: _healthUpdatedAt);

    private void Reproject()
    {
        var display = SystemStatusProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
