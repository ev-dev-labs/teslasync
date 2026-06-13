using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ExportsPage</c> view — the native port of the web page's data flow
/// (web/src/features/exports/pages/ExportsPage.tsx). It reads the export-jobs list through the injected
/// <see cref="IExportsFeed"/> (web <c>useExportJobs</c>), owns the bulk-selection set (web <c>useBulkSelection</c>) and
/// runs the bulk delete (web <c>useBulkExportsDelete</c>), and projects the result through
/// <see cref="ExportsProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus the in-flight + bulk-busy flags; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ExportsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IExportsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly ExportsDiagnostics _diagnostics;
    private readonly HashSet<string> _selected = new(StringComparer.Ordinal);

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<ExportJobSummary> _jobs = Array.Empty<ExportJobSummary>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _bulkBusy;
    private bool _hasLoaded;

    private ExportsState _state = ExportsState.Loading;
    private ExportsDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The export-jobs data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic created-timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ExportsPageViewModel(
        IExportsFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        ExportsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new ExportsDiagnostics();
        _display = ExportsProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public ExportsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ExportsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the list is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True while the bulk delete is in flight (web mutation pending flag).</summary>
    public bool IsBulkBusy
    {
        get => _bulkBusy;
        private set => Set(ref _bulkBusy, value);
    }

    /// <summary>The localized page title (web <c>exportsList.title</c>).</summary>
    public string Title => ExportsRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the export-jobs list load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _jobs = snapshot.Jobs ?? Array.Empty<ExportJobSummary>();
            PruneSelection();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web error: surface the failure panel; the table area falls back to the error branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _jobs = Array.Empty<ExportJobSummary>();
            _selected.Clear();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the list (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle a single row's selection (web <c>useBulkSelection.toggle</c>).</summary>
    public void ToggleRow(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        if (!_selected.Remove(id))
        {
            _selected.Add(id);
        }

        Reproject();
    }

    /// <summary>
    /// Master-checkbox toggle (web <c>useBulkSelection.toggleAll</c>): when every visible row is selected, clear them
    /// all; otherwise select every visible row.
    /// </summary>
    public void ToggleAll()
    {
        if (_jobs.Count == 0)
        {
            return;
        }

        bool allSelected = _jobs.All(j => _selected.Contains(j.Id));
        if (allSelected)
        {
            foreach (var job in _jobs)
            {
                _selected.Remove(job.Id);
            }
        }
        else
        {
            foreach (var job in _jobs)
            {
                _selected.Add(job.Id);
            }
        }

        Reproject();
    }

    /// <summary>Clear the entire selection (web <c>useBulkSelection.clear</c> / the toolbar Clear button).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        Reproject();
    }

    /// <summary>
    /// Run the bulk delete over the current selection (web <c>BulkActionToolbar</c> delete action →
    /// <c>useBulkExportsDelete</c>). On success the selection is cleared and the list reloads (web <c>onSuccess</c>
    /// invalidate + <c>sel.clear()</c>); on failure the selection is preserved so the user can retry.
    /// </summary>
    public async Task RunBulkDeleteAsync(CancellationToken cancellationToken = default)
    {
        if (_bulkBusy || _selected.Count == 0)
        {
            return;
        }

        var ids = _selected.ToList();
        IsBulkBusy = true;
        Reproject();

        try
        {
            _ = await _feed.BulkDeleteAsync(ids, cancellationToken).ConfigureAwait(false);
            _selected.Clear();
            IsBulkBusy = false;
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsBulkBusy = false;
        }
        catch (Exception)
        {
            // web onError raises a toast and leaves the selection intact; the list is untouched so the user retries.
            IsBulkBusy = false;
            Reproject();
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
    }

    private ExportsModel BuildModel() => new(
        Jobs: _jobs,
        SelectedIds: _selected,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        BulkBusy: _bulkBusy,
        DownloadBase: _feed.DownloadBaseUri,
        Now: _clock());

    private void Reproject()
    {
        var display = ExportsProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
    }

    // Drop any selected id that is no longer present in the reloaded list so the count / master state stay honest.
    private void PruneSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        var present = new HashSet<string>(_jobs.Select(j => j.Id), StringComparer.Ordinal);
        _selected.RemoveWhere(id => !present.Contains(id));
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
