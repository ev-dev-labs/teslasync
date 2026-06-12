using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AutomationListPage</c> view — the native port of the web page's
/// data flow (web/src/features/automations/pages/AutomationListPage.tsx). It reads the automations list through the
/// injected <see cref="IAutomationListFeed"/> (web <c>useAutomations</c>), owns the bulk-selection set (web
/// <c>useBulkSelection</c>) and runs the allowlisted bulk operations (web <c>useBulkAutomationsUpdate</c>), and
/// projects the result through <see cref="AutomationListProjection"/> so the view is a thin renderer. It surfaces the
/// four web data states (loading / empty / error / success) plus the in-flight + bulk-busy flags; observable so the
/// view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class AutomationListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAutomationListFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly AutomationListDiagnostics _diagnostics;
    private readonly HashSet<long> _selected = [];

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<AutomationRow> _automations = Array.Empty<AutomationRow>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _bulkBusy;
    private bool _hasLoaded;

    private AutomationListState _state = AutomationListState.Loading;
    private AutomationListDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The automations-list data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AutomationListPageViewModel(
        IAutomationListFeed feed,
        ILocalizer localizer,
        AutomationListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AutomationListDiagnostics();
        _display = AutomationListProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public AutomationListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AutomationListDisplay Display
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

    /// <summary>True while a bulk operation is in flight (web per-action pending flag).</summary>
    public bool IsBulkBusy
    {
        get => _bulkBusy;
        private set => Set(ref _bulkBusy, value);
    }

    /// <summary>The localized page title (web <c>automationList.title</c>).</summary>
    public string Title => AutomationListRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the automations list load.</summary>
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

            _automations = snapshot.Automations ?? Array.Empty<AutomationRow>();
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
            _automations = Array.Empty<AutomationRow>();
            _selected.Clear();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the list (web auto-refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle a single row's selection (web <c>useBulkSelection.toggle</c>).</summary>
    public void ToggleRow(long id)
    {
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
        if (_automations.Count == 0)
        {
            return;
        }

        bool allSelected = _automations.All(a => _selected.Contains(a.Id));
        if (allSelected)
        {
            foreach (var row in _automations)
            {
                _selected.Remove(row.Id);
            }
        }
        else
        {
            foreach (var row in _automations)
            {
                _selected.Add(row.Id);
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
    /// Run an allowlisted bulk operation over the current selection (web <c>BulkActionToolbar</c> action →
    /// <c>useBulkAutomationsUpdate</c>). On success the selection is cleared and the list reloads (web
    /// <c>onSuccess</c> invalidate + <c>sel.clear()</c>); on failure the selection is preserved so the user can retry.
    /// </summary>
    public async Task RunBulkAsync(AutomationBulkOp op, CancellationToken cancellationToken = default)
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
            _ = await _feed.BulkUpdateAsync(ids, op, cancellationToken).ConfigureAwait(false);
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

    private AutomationListModel BuildModel() => new(
        Automations: _automations,
        SelectedIds: _selected,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        BulkBusy: _bulkBusy);

    private void Reproject()
    {
        var display = AutomationListProjection.Project(BuildModel(), _localizer);
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

        var present = new HashSet<long>(_automations.Select(a => a.Id));
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
