using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AlertRulesPage</c> view — the native port of the web page's
/// data + bulk-selection flow (web/src/features/notifications/pages/AlertRulesPage.tsx). It owns the rule list,
/// the four data states (loading / empty / error / success), the bulk selection (web <c>useBulkSelection</c>) and
/// the transient inline-rename validation error, reads the list through the injected <see cref="IAlertRulesFeed"/>
/// (web <c>useAlertRules</c>), writes bulk enable / disable, per-id delete and rename back through the same port
/// (web <c>useBulkEnableRules</c> / <c>useBulkDisableRules</c> / <c>useDeleteAlertRule</c> / <c>useSaveAlertRule</c>),
/// and projects the result through <see cref="AlertRulesProjection"/> so the view is a thin renderer. Observable
/// so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class AlertRulesPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAlertRulesFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly AlertRulesDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<AlertRule> _items = Array.Empty<AlertRule>();
    private readonly HashSet<long> _selected = new();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string? _nameError;

    private AlertRulesState _state = AlertRulesState.Loading;
    private AlertRulesDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The rule-list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertRulesPageViewModel(
        IAlertRulesFeed feed,
        ILocalizer localizer,
        AlertRulesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AlertRulesDiagnostics();
        _display = AlertRulesProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public AlertRulesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AlertRulesDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight (web <c>isFetching</c> / mutation pending).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>alertRules.title</c>).</summary>
    public string Title => AlertRulesRegistration.Title(_localizer);

    /// <summary>The ids currently in the bulk selection (web <c>sel.selectedIds</c>).</summary>
    public IReadOnlyList<long> SelectedIds => _selected.ToArray();

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the rule-list load (web <c>useAlertRules</c> query).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_items.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var rules = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _items = rules ?? Array.Empty<AlertRule>();
            PruneSelection();
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
            // web error branch: surface the ErrorDisplay; the table falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _items = Array.Empty<AlertRule>();
            _selected.Clear();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the rule list (web query refetch / retry button).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle a single row's selection (web <c>sel.toggle(id)</c>).</summary>
    public void ToggleSelect(long id)
    {
        if (!_selected.Remove(id))
        {
            _selected.Add(id);
        }

        Reproject();
    }

    /// <summary>Toggle every visible row (web <c>sel.toggleAll(visibleIds)</c>): clear when all are selected, else select all.</summary>
    public void ToggleSelectAll()
    {
        var visible = _items.Select(r => r.Id).ToList();
        bool allSelected = visible.Count > 0 && visible.All(_selected.Contains);
        if (allSelected)
        {
            foreach (var id in visible)
            {
                _selected.Remove(id);
            }
        }
        else
        {
            foreach (var id in visible)
            {
                _selected.Add(id);
            }
        }

        Reproject();
    }

    /// <summary>Clear the bulk selection (web <c>sel.clear()</c>).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        Reproject();
    }

    /// <summary>Bulk-enable the supplied ids (web <c>bulkEnable.mutateAsync(ids)</c>), then clear + reload.</summary>
    public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        RunBulkAsync((c) => _feed.BulkEnableAsync(ids, c), cancellationToken);

    /// <summary>Bulk-disable the supplied ids (web <c>bulkDisable.mutateAsync(ids)</c>), then clear + reload.</summary>
    public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        RunBulkAsync((c) => _feed.BulkDisableAsync(ids, c), cancellationToken);

    /// <summary>
    /// Bulk-delete the supplied ids (web <c>onBulkDelete</c>): there is no bulk-delete endpoint, so each id is
    /// deleted with its own DELETE (web <c>Promise.allSettled(ids.map(deleteOne))</c> — a single failure does not
    /// abort the rest), then the selection is cleared and the list reloaded.
    /// </summary>
    public Task BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        RunBulkAsync(
            async (c) =>
            {
                foreach (var id in ids)
                {
                    try
                    {
                        await _feed.DeleteAsync(id, c).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (Exception)
                    {
                        // web Promise.allSettled: a rejected per-id delete is swallowed so the rest proceed.
                    }
                }
            },
            cancellationToken);

    /// <summary>
    /// Rename a rule (web <c>EditableText.onSave</c> → <c>saveRule.mutateAsync({ id, name })</c>). Validates the
    /// candidate first (web <c>validate</c>): on a too-long name it surfaces the inline error and does not write;
    /// otherwise it clears the error, writes the new name and reloads. Returns true when the write was attempted.
    /// </summary>
    public async Task<bool> RenameAsync(long id, string name, CancellationToken cancellationToken = default)
    {
        string candidate = name ?? string.Empty;
        string? validation = AlertRulesProjection.ValidateName(candidate, _localizer);
        if (validation is not null)
        {
            _nameError = validation;
            Reproject();
            return false;
        }

        _nameError = null;
        IsFetching = true;
        try
        {
            await _feed.RenameAsync(id, candidate, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return false;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _errorDetail = ex.Message;
            IsFetching = false;
            Reproject();
            return true;
        }

        // web useSaveAlertRule.onSuccess invalidates the alertRules query → the list reloads.
        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>Clear the transient inline-rename validation error (web editor cancel / successful re-edit).</summary>
    public void ClearNameError()
    {
        if (_nameError is null)
        {
            return;
        }

        _nameError = null;
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

    private async Task RunBulkAsync(Func<CancellationToken, Task> mutation, CancellationToken cancellationToken)
    {
        IsFetching = true;
        try
        {
            await mutation(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _errorDetail = ex.Message;
            IsFetching = false;
            Reproject();
            return;
        }

        // web onSuccess invalidates the alertRules query and the page calls sel.clear().
        _selected.Clear();
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private void PruneSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        var present = new HashSet<long>(_items.Select(r => r.Id));
        _selected.RemoveWhere(id => !present.Contains(id));
    }

    private AlertRulesModel BuildModel() => new(
        Items: _items,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SelectedIds: _selected,
        NameError: _nameError);

    private void Reproject()
    {
        var display = AlertRulesProjection.Project(BuildModel(), _localizer);
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
