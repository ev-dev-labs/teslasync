using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SlowQueriesPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/SlowQueriesPage.tsx). It owns the URL-equivalent state (the order key and
/// row limit), reads each result through the injected <see cref="ISlowQueriesFeed"/>, and projects the result
/// through <see cref="SlowQueriesProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus the pg_stat_statements-not-configured warning flag and an in-flight
/// flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class SlowQueriesPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISlowQueriesFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly SlowQueriesDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<SlowQueryRow> _rows = Array.Empty<SlowQueryRow>();
    private string _orderBy = SlowQueriesRegistration.DefaultOrderBy;
    private int _limit = SlowQueriesRegistration.DefaultLimit;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _subsystemMissing;

    private SlowQueriesState _state = SlowQueriesState.Loading;
    private SlowQueriesDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The slow-queries data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SlowQueriesPageViewModel(
        ISlowQueriesFeed feed,
        ILocalizer localizer,
        SlowQueriesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new SlowQueriesDiagnostics();
        _display = SlowQueriesProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public SlowQueriesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SlowQueriesDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The current order key (web <c>orderBy</c>).</summary>
    public string OrderBy => _orderBy;

    /// <summary>The current row limit (web <c>limit</c>).</summary>
    public int Limit => _limit;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the slow-queries load for the current order key / limit.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_rows.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(BuildQuery(), cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _rows = snapshot.Rows ?? Array.Empty<SlowQueryRow>();
            _subsystemMissing = snapshot.SubsystemMissing;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web query.error (non-503): surface the failure surface; the table falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _subsystemMissing = false;
            _loading = false;
            _rows = Array.Empty<SlowQueryRow>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current result (web auto-refetch / retry affordance).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the order key from the dropdown (web <c>setOrderBy</c>); reloads.</summary>
    public Task SetOrderByAsync(string orderBy, CancellationToken cancellationToken = default)
    {
        var next = string.IsNullOrEmpty(orderBy) ? SlowQueriesRegistration.DefaultOrderBy : orderBy;
        if (string.Equals(next, _orderBy, StringComparison.Ordinal))
        {
            return Task.CompletedTask;
        }

        _orderBy = next;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Set the row limit from the dropdown (web <c>setLimit</c>); reloads.</summary>
    public Task SetLimitAsync(int limit, CancellationToken cancellationToken = default)
    {
        var next = limit <= 0 ? SlowQueriesRegistration.DefaultLimit : limit;
        if (next == _limit)
        {
            return Task.CompletedTask;
        }

        _limit = next;
        return LoadAsync(cancellationToken);
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

    private SlowQueriesQuery BuildQuery() => new(_orderBy, _limit);

    private SlowQueriesModel BuildModel() => new(
        Rows: _rows,
        OrderBy: _orderBy,
        Limit: _limit,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SubsystemMissing: _subsystemMissing);

    private void Reproject()
    {
        var display = SlowQueriesProjection.Project(BuildModel(), _localizer);
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
