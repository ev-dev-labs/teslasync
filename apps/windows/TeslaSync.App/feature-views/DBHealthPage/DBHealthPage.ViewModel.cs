using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DBHealthPage</c> view — the native port of the web page's data
/// flow (web/src/features/system/pages/DBHealthPage.tsx). It reads the three diagnostics queries through the injected
/// <see cref="IDbHealthFeed"/> (web <c>useDBStats</c> / <c>useMigrations</c> / <c>useConnectionPool</c>), tracks each
/// source's independent loading / error / data state plus the local table-sort selection, and projects the combined
/// result through <see cref="DbHealthProjection"/> so the view is a thin renderer. It surfaces the four web data
/// states (loading / empty / error / success) — the error banner being driven by a stats or migration failure (web
/// <c>queryError</c>) — plus an in-flight flag; observable so the view re-renders on <see cref="PropertyChanged"/>.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DBHealthPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDbHealthFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly DbHealthDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _statsLoading = true;
    private bool _statsHasError;
    private bool _statsHasData;
    private string? _statsError;
    private DbStatsSnapshot _stats = DbStatsSnapshot.Empty;

    private bool _migrationLoading = true;
    private bool _migrationHasError;
    private bool _migrationHasData;
    private string? _migrationError;
    private MigrationSnapshot _migration = MigrationSnapshot.Empty;

    private bool _poolLoading = true;
    private bool _poolHasData;
    private PoolSnapshot _pool = PoolSnapshot.Empty;

    private DbHealthSortKey _sortKey = DbHealthSortKey.Size;

    private DbHealthState _state = DbHealthState.Loading;
    private DbHealthDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The DB-health data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DBHealthPageViewModel(
        IDbHealthFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        DbHealthDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DbHealthDiagnostics();
        _display = DbHealthProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public DbHealthState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public DbHealthDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (web <c>statsFetching</c> — drives the auto-refresh spinner).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The active table-list sort key (web <c>sortKey</c>).</summary>
    public DbHealthSortKey SortKey => _sortKey;

    /// <summary>The localized page title (web <c>dbHealth.title</c>).</summary>
    public string Title => DbHealthRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) all three DB-health queries.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_statsHasData)
        {
            _statsLoading = true;
        }

        if (!_migrationHasData)
        {
            _migrationLoading = true;
        }

        if (!_poolHasData)
        {
            _poolLoading = true;
        }

        Reproject();

        await LoadStatsAsync(cts.Token).ConfigureAwait(true);
        await LoadMigrationAsync(cts.Token).ConfigureAwait(true);
        await LoadPoolAsync(cts.Token).ConfigureAwait(true);

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh all three queries (web query refetch / auto-refresh / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Change the table-list sort key (web <c>setSortKey</c>) and re-project.</summary>
    public void SetSort(DbHealthSortKey sortKey)
    {
        if (_sortKey == sortKey)
        {
            return;
        }

        _sortKey = sortKey;
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
        Cancel(ref _cts);
    }

    private async Task LoadStatsAsync(CancellationToken token)
    {
        try
        {
            var snapshot = await _feed.FetchDbStatsAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _stats = snapshot;
            _statsHasData = snapshot.HasData;
            _statsHasError = false;
            _statsError = null;
            _statsLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _statsHasError = true;
            _statsError = ex.Message;
            _statsHasData = false;
            _statsLoading = false;
        }

        Reproject();
    }

    private async Task LoadMigrationAsync(CancellationToken token)
    {
        try
        {
            var snapshot = await _feed.FetchMigrationAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _migration = snapshot;
            _migrationHasData = snapshot.HasData;
            _migrationHasError = false;
            _migrationError = null;
            _migrationLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _migrationHasError = true;
            _migrationError = ex.Message;
            _migrationHasData = false;
            _migrationLoading = false;
        }

        Reproject();
    }

    private async Task LoadPoolAsync(CancellationToken token)
    {
        try
        {
            var snapshot = await _feed.FetchPoolAsync(token).ConfigureAwait(true);
            token.ThrowIfCancellationRequested();
            _pool = snapshot;
            _poolHasData = snapshot.HasData;
            _poolLoading = false;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web useConnectionPool surfaces no page-level error; a failure simply renders the "no pool data" empty state.
            _pool = PoolSnapshot.Empty;
            _poolHasData = false;
            _poolLoading = false;
        }

        Reproject();
    }

    private DbHealthModel BuildModel() => new(
        StatsLoading: _statsLoading,
        StatsHasError: _statsHasError,
        StatsError: _statsError,
        Stats: _stats,
        MigrationLoading: _migrationLoading,
        MigrationHasError: _migrationHasError,
        MigrationError: _migrationError,
        Migration: _migration,
        PoolLoading: _poolLoading,
        Pool: _pool,
        SortKey: _sortKey);

    private void Reproject()
    {
        var display = DbHealthProjection.Project(BuildModel(), _localizer, _clock());
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
