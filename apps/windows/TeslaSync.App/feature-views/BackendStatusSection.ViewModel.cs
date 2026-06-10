using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BackendStatusSection"/> view — the native port of
/// the web component's hook composition
/// (web/src/features/system/components/status/BackendStatusSection.tsx). It drives the three independent
/// cache-then-network reads through the <see cref="IBackendStatusSource"/> — the extended health snapshot
/// (web <c>useQuery(getExtendedHealth)</c>), the database connection pool (web <c>useConnectionPool</c>) and
/// the runtime version (web <c>useQuery(getVersionInfo)</c>) — folds them into a single section state
/// (loading / loaded / empty / error / stale / offline, where the combined initial loading mirrors the web
/// <c>extLoading || poolLoading</c>), projects them through <see cref="BackendStatusProjection"/>, and exposes
/// the projected display plus freshness so the view is a thin renderer. The three streams pump concurrently,
/// so result application is serialised through a gate; raise/observe it from the UI thread.
/// </summary>
public sealed class BackendStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackendStatusSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    // Latest health emission (drives status/freshness classification once both gating queries have settled).
    private RepositoryResult<BackendHealthSnapshot> _healthResult = RepositoryResult<BackendHealthSnapshot>.Loading();

    // Last good snapshot per stream (kept across transient Loading emissions to avoid content flicker).
    private BackendHealthSnapshot _health = BackendHealthSnapshot.Empty;
    private ConnectionPoolSnapshot _pool = ConnectionPoolSnapshot.Absent;
    private VersionSnapshot _version = VersionSnapshot.Absent;

    // Sticky "the query produced its first result" flags — the native analogue of TanStack's isLoading
    // (true only until the first settle; a later refetch is isFetching, not isLoading). Version is excluded
    // from the loading gate to match the web (only extLoading || poolLoading drive the skeleton).
    private bool _healthResolved;
    private bool _poolResolved;

    private BackendStatusSectionState _state = BackendStatusSectionState.Loading;
    private BackendStatusDisplay _display = BackendStatusDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public BackendStatusViewModel(
        IBackendStatusSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Section state ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The section's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public BackendStatusSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (component rows, pool, runtime, badge).</summary>
    public BackendStatusDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (hard error or offline).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown content is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh + reload is running (drives the button spinner).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>Localized error message for the error/offline states (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries / refreshes).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Section title (web <c>t('Backend Status')</c>).</summary>
    public string Title => BackendStatusRegistration.Title(_localizer);

    /// <summary>Section description (web accordion description).</summary>
    public string Description => BackendStatusRegistration.Description(_localizer);

    /// <summary>"Component Health" sub-header (web <c>t('Component Health')</c>).</summary>
    public string ComponentHealthTitle =>
        _localizer.GetString("featureView.backendStatus.componentHealth", "Component Health");

    /// <summary>"Database Connection Pool" sub-header (web <c>t('Database Connection Pool')</c>).</summary>
    public string DatabasePoolTitle =>
        _localizer.GetString("featureView.backendStatus.databasePool", "Database Connection Pool");

    /// <summary>"System Runtime" sub-header (web <c>t('System Runtime')</c>).</summary>
    public string SystemRuntimeTitle =>
        _localizer.GetString("featureView.backendStatus.systemRuntime", "System Runtime");

    /// <summary>Component table "Status" column header.</summary>
    public string StatusHeader => _localizer.GetString("featureView.backendStatus.col.status", "Status");

    /// <summary>Component table "Component" column header.</summary>
    public string ComponentHeader => _localizer.GetString("featureView.backendStatus.col.component", "Component");

    /// <summary>Component table "Latency" column header.</summary>
    public string LatencyHeader => _localizer.GetString("featureView.backendStatus.col.latency", "Latency");

    /// <summary>Component table "Failures" column header.</summary>
    public string FailuresHeader => _localizer.GetString("featureView.backendStatus.col.failures", "Failures");

    /// <summary>Component table "Last Check" column header.</summary>
    public string LastCheckHeader => _localizer.GetString("featureView.backendStatus.col.lastCheck", "Last Check");

    /// <summary>Pool "Max Open" card label.</summary>
    public string MaxOpenLabel => _localizer.GetString("featureView.backendStatus.pool.maxOpen", "Max Open");

    /// <summary>Pool "Open" card label.</summary>
    public string OpenLabel => _localizer.GetString("featureView.backendStatus.pool.open", "Open");

    /// <summary>Pool "In Use" card label.</summary>
    public string InUseLabel => _localizer.GetString("featureView.backendStatus.pool.inUse", "In Use");

    /// <summary>Pool "Idle" card label.</summary>
    public string IdleLabel => _localizer.GetString("featureView.backendStatus.pool.idle", "Idle");

    /// <summary>Pool "Wait Count" card label.</summary>
    public string WaitCountLabel => _localizer.GetString("featureView.backendStatus.pool.waitCount", "Wait Count");

    /// <summary>Empty-table message for the component health table (web <c>emptyMessage</c>).</summary>
    public string NoComponentsMessage =>
        _localizer.GetString("featureView.backendStatus.noComponents", "No components found");

    /// <summary>Empty-state message for the pool sub-section when no pool data is available.</summary>
    public string NoPoolMessage =>
        _localizer.GetString("featureView.backendStatus.noPool", "Connection pool statistics are unavailable.");

    /// <summary>Empty-state message for the runtime sub-section when no runtime data is available.</summary>
    public string NoRuntimeMessage =>
        _localizer.GetString("featureView.backendStatus.noRuntime", "Runtime information is unavailable.");

    /// <summary>Section-level empty message (no components, pool or runtime at all).</summary>
    public string EmptyMessage => _localizer.GetString(
        "featureView.backendStatus.empty",
        "No backend status is available yet. Health, pool and runtime counters appear here once the API has reported in.");

    /// <summary>Loading announcement.</summary>
    public string LoadingLabel =>
        _localizer.GetString("featureView.backendStatus.loading", "Loading backend status\u2026");

    /// <summary>Hard-failure message (the error/offline surface default).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "featureView.backendStatus.error", "Could not load backend status. Check API logs and try again.");

    /// <summary>"Refresh" button label.</summary>
    public string RefreshLabel => _localizer.GetString("featureView.backendStatus.refresh", "Refresh");

    /// <summary>Retry affordance label — the Refresh action doubles as the retry (no separate mutation).</summary>
    public string RetryLabel => RefreshLabel;

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the three cache-then-network loads (web initial queries).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>Retry after a hard failure (web Refresh from the error surface).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — re-run the loads with the button in its busy state (web <c>refetch()</c>). The GET
    /// endpoints are authoritative, so there is no mutation; the reload reflects current server state.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        try
        {
            await RunAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        var token = cts.Token;

        var pumps = new[]
        {
            PumpHealthAsync(token),
            PumpPoolAsync(token),
            PumpVersionAsync(token),
        };

        try
        {
            await Task.WhenAll(pumps).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop these emissions silently.
        }
    }

    private async Task PumpHealthAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamHealthAsync(token).ConfigureAwait(false))
        {
            ApplyHealth(result);
        }
    }

    private async Task PumpPoolAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamPoolAsync(token).ConfigureAwait(false))
        {
            ApplyPool(result);
        }
    }

    private async Task PumpVersionAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamVersionAsync(token).ConfigureAwait(false))
        {
            ApplyVersion(result);
        }
    }

    private void ApplyHealth(RepositoryResult<BackendHealthSnapshot> result)
    {
        lock (_gate)
        {
            _healthResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _healthResolved = true;
            }

            _health = NextSnapshot(result, _health, BackendHealthSnapshot.Empty);
            Recompute();
        }
    }

    private void ApplyPool(RepositoryResult<ConnectionPoolSnapshot> result)
    {
        lock (_gate)
        {
            if (result.Status != LoadStatus.Loading)
            {
                _poolResolved = true;
            }

            _pool = NextSnapshot(result, _pool, ConnectionPoolSnapshot.Absent);
            Recompute();
        }
    }

    private void ApplyVersion(RepositoryResult<VersionSnapshot> result)
    {
        lock (_gate)
        {
            _version = NextSnapshot(result, _version, VersionSnapshot.Absent);
            Recompute();
        }
    }

    private void Recompute()
    {
        var now = _clock();
        Display = BackendStatusProjection.Project(_health, _pool, _version, _localizer, now);

        if (_healthResult.FetchedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        // web parity: the combined skeleton shows while (extLoading || poolLoading) — i.e. while the health
        // OR the pool query has not yet produced its first result. Once a query has resolved it never reverts
        // to the loading surface (a later refetch is a background fetch, not a first load).
        if (!_healthResolved || !_poolResolved)
        {
            State = BackendStatusSectionState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            ErrorMessage = null;
            return;
        }

        var outcome = Classify(_healthResult, Display.HasAnyContent);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
    }

    private SectionOutcome Classify(RepositoryResult<BackendHealthSnapshot> health, bool hasContent) =>
        health.Status switch
        {
            LoadStatus.Loading => hasContent
                ? new SectionOutcome(BackendStatusSectionState.Loaded, true, false, false, null)
                : new SectionOutcome(BackendStatusSectionState.Loading, true, false, false, null),

            LoadStatus.Cached or LoadStatus.Refreshing => new SectionOutcome(
                !hasContent ? BackendStatusSectionState.Empty
                    : (health.IsStale ? BackendStatusSectionState.Stale : BackendStatusSectionState.Loaded),
                true, false, hasContent && health.IsStale, null),

            LoadStatus.Loaded => new SectionOutcome(
                hasContent ? BackendStatusSectionState.Loaded : BackendStatusSectionState.Empty,
                false, false, false, null),

            // Health resolved empty: still surface pool / runtime content if either read produced something.
            LoadStatus.Empty => new SectionOutcome(
                hasContent ? BackendStatusSectionState.Loaded : BackendStatusSectionState.Empty,
                false, false, false, null),

            LoadStatus.Offline => hasContent
                ? new SectionOutcome(BackendStatusSectionState.Offline, false, true, true, ErrorMessageDefault)
                : new SectionOutcome(BackendStatusSectionState.Error, false, true, false, ErrorMessageDefault),

            _ => new SectionOutcome(BackendStatusSectionState.Error, false, true, false, ErrorMessageDefault),
        };

    private static T NextSnapshot<T>(RepositoryResult<T> result, T previous, T empty)
        where T : class =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                 // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => empty,  // resolved with nothing to show
            _ => result.Value ?? previous,                  // cached / refreshing / loaded / offline carry the value
        };

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

    private readonly record struct SectionOutcome(
        BackendStatusSectionState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage);
}
