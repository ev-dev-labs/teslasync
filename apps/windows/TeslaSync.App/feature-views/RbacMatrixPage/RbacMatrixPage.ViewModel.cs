using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// One ordered category band in the matrix — a category id and the permissions filed under it (web
/// <c>permsByCategory</c> + the ordered <c>payload.categories</c>). Empty bands are dropped, matching the web grid.
/// </summary>
public sealed record RbacCategoryGroup(string Category, IReadOnlyList<RbacPermissionEntry> Permissions);

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>RbacMatrixPage</c> view — the native port of the web page's data
/// flow (web/src/features/admin/pages/RbacMatrixPage.tsx). It owns the one read query the web page mounts
/// (<c>useRbacMatrix</c> → the matrix) behind an injected feed and the one sudo-gated mutation
/// (<c>useUpsertRbacCells</c>) behind an injected write service, plus the edit-mode draft + dirty-cell diff the web
/// page keeps in component state. It surfaces the five render branches the web page selects between
/// (<see cref="RbacMatrixState"/>) and projects every visible literal through the i18n facade. Observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RbacMatrixPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRbacMatrixFeed _feed;
    private readonly IRbacWriteService _writeService;
    private readonly ILocalizer _localizer;
    private readonly RbacMatrixPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RbacMatrixSnapshot? _snapshot;
    private bool _loading = true;
    private bool _loadError;
    private string? _loadErrorCode;
    private bool _isFetching;

    private readonly Dictionary<string, Dictionary<string, bool>> _draft = new(StringComparer.Ordinal);
    private bool _editing;
    private bool _isSaving;
    private string? _submitError;

    /// <summary>Creates the holder over its read feed, write service, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The matrix data port (web <c>useRbacMatrix</c>).</param>
    /// <param name="writeService">The cell upsert write port (web <c>useUpsertRbacCells</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RbacMatrixPageViewModel(
        IRbacMatrixFeed feed,
        IRbacWriteService writeService,
        ILocalizer localizer,
        RbacMatrixPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(writeService);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _writeService = writeService;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new RbacMatrixPageDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level render branch (loading / open-auth / error / empty / ready).</summary>
    public RbacMatrixState State
    {
        get
        {
            if (_loading)
            {
                return RbacMatrixState.Loading;
            }

            if (RbacMatrix.IsRbacOpenMode(_snapshot))
            {
                return RbacMatrixState.OpenMode;
            }

            if (_loadError || _snapshot is null)
            {
                return RbacMatrixState.Error;
            }

            return _snapshot.Roles.Count == 0 ? RbacMatrixState.Empty : RbacMatrixState.Ready;
        }
    }

    /// <summary>The resolved session payload (null while loading / errored / open-auth).</summary>
    public RbacMatrixSnapshot? Snapshot => _snapshot;

    /// <summary>True while the matrix query is (re)fetching — drives the freshness affordance.</summary>
    public bool IsFetching => _isFetching;

    /// <summary>True while the operator is in edit mode (web <c>editing</c>).</summary>
    public bool Editing => _editing;

    /// <summary>True while a save mutation is in flight (web <c>upsert.isPending</c>).</summary>
    public bool IsSaving => _isSaving;

    /// <summary>The number of cells changed against the snapshot (web <c>dirtyCount</c>).</summary>
    public int DirtyCount =>
        _snapshot is null || _snapshot.IsOpenMode ? 0 : RbacMatrix.DiffMatrices(_snapshot.Matrix, SnapshotDraft()).Count;

    /// <summary>The last save-failure message (web <c>submitError</c>), or null.</summary>
    public string? SubmitError => _submitError;

    /// <summary>The page title (web <c>rbac.title</c>).</summary>
    public string Title => RbacMatrixRegistration.Title(_localizer);

    /// <summary>The page subtitle (web <c>rbac.subtitle</c>).</summary>
    public string Subtitle => RbacMatrixRegistration.Subtitle(_localizer);

    /// <summary>The matrix permission-column header (web <c>rbac.permissionColumn</c>).</summary>
    public string PermissionColumn => RbacMatrixRegistration.PermissionColumn(_localizer);

    /// <summary>The open-auth notice title (web <c>rbac.openMode.title</c>).</summary>
    public string OpenModeTitle => RbacMatrixRegistration.OpenModeTitle(_localizer);

    /// <summary>The open-auth notice body (web <c>rbac.openMode.message</c>).</summary>
    public string OpenModeMessage => RbacMatrixRegistration.OpenModeMessage(_localizer);

    /// <summary>The "Edit" action label (web <c>rbac.actions.edit</c>).</summary>
    public string EditLabel => RbacMatrixRegistration.EditLabel(_localizer);

    /// <summary>The "Save (n)" action label with the current dirty-cell count (web <c>rbac.actions.save</c>).</summary>
    public string SaveLabel => RbacMatrixRegistration.SaveLabel(_localizer, DirtyCount);

    /// <summary>The in-flight "Saving…" action label (web <c>rbac.actions.saving</c>).</summary>
    public string SavingLabel => RbacMatrixRegistration.SavingLabel(_localizer);

    /// <summary>The "Cancel" action label (web <c>rbac.actions.cancel</c>).</summary>
    public string CancelLabel => RbacMatrixRegistration.CancelLabel(_localizer);

    /// <summary>The "Retry" action label (web <c>rbac.actions.retry</c>).</summary>
    public string RetryLabel => RbacMatrixRegistration.RetryLabel(_localizer);

    /// <summary>The empty-surface title (web <c>rbac.empty.title</c>).</summary>
    public string EmptyTitle => RbacMatrixRegistration.EmptyTitle(_localizer);

    /// <summary>The empty-surface message (web <c>rbac.empty.message</c>).</summary>
    public string EmptyMessage => RbacMatrixRegistration.EmptyMessage(_localizer);

    /// <summary>The load-failure banner title (web <c>rbac.errors.loadTitle</c>).</summary>
    public string ErrorLoadTitle => RbacMatrixRegistration.ErrorLoadTitle(_localizer);

    /// <summary>The load-failure message — the server error code when present, else the generic copy (web <c>code ?? loadGeneric</c>).</summary>
    public string ErrorLoadMessage => _loadErrorCode ?? RbacMatrixRegistration.ErrorLoadGeneric(_localizer);

    /// <summary>The accessible "allowed" cell label (web <c>rbac.cell.allowed</c>).</summary>
    public string CellAllowedLabel => RbacMatrixRegistration.CellAllowed(_localizer);

    /// <summary>The accessible "denied" cell label (web <c>rbac.cell.denied</c>).</summary>
    public string CellDeniedLabel => RbacMatrixRegistration.CellDenied(_localizer);

    /// <summary>The effective-permissions pill tooltip (web <c>rbac.effective.tooltip</c>).</summary>
    public string EffectiveTooltip => RbacMatrixRegistration.EffectiveTooltip(_localizer);

    /// <summary>The my-roles pill text (web <c>MyRolesPill</c>).</summary>
    public string MyRolesText
    {
        get
        {
            IReadOnlyList<string> roles = _snapshot?.MyRoles ?? Array.Empty<string>();
            return roles.Count == 0
                ? RbacMatrixRegistration.MyRolesNone(_localizer)
                : RbacMatrixRegistration.MyRolesLabel(_localizer, string.Join(", ", roles));
        }
    }

    /// <summary>The my-roles pill status (web <c>variant="neutral" | "info"</c>).</summary>
    public StatusKind MyRolesStatus =>
        (_snapshot?.MyRoles.Count ?? 0) == 0 ? StatusKind.Neutral : StatusKind.Info;

    /// <summary>The effective-permissions pill text (web <c>EffectivePill</c>).</summary>
    public string EffectiveText =>
        RbacMatrixRegistration.EffectiveCount(_localizer, EffectiveAllowedCount, _snapshot?.Permissions.Count ?? 0);

    /// <summary>The effective-permissions pill status (web <c>variant = allowedCount === 0 ? 'neutral' : 'success'</c>).</summary>
    public StatusKind EffectiveStatus => EffectiveAllowedCount == 0 ? StatusKind.Neutral : StatusKind.Success;

    /// <summary>True when the upstream proxy forwarded a groups header name (web <c>payload.groups_header_name &amp;&amp; ...</c>).</summary>
    public bool HasGroupsHeader => !string.IsNullOrEmpty(_snapshot?.GroupsHeaderName);

    /// <summary>The groups-header caption (web <c>rbac.groupsHeader.label</c>), empty when none was forwarded.</summary>
    public string GroupsHeaderCaption =>
        HasGroupsHeader ? RbacMatrixRegistration.GroupsHeaderLabel(_localizer, _snapshot!.GroupsHeaderName!) : string.Empty;

    private int EffectiveAllowedCount
    {
        get
        {
            if (_snapshot is null)
            {
                return 0;
            }

            int count = 0;
            foreach (bool allowed in _snapshot.EffectiveForMe.Values)
            {
                if (allowed)
                {
                    count++;
                }
            }

            return count;
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>The localized label for a category band (web <c>t(`rbac.category.${cat}`, cat)</c>).</summary>
    public string CategoryLabel(string category) => RbacMatrixRegistration.CategoryLabel(_localizer, category);

    /// <summary>The accessible edit-cell toggle label (web <c>rbac.cell.toggle</c>).</summary>
    public string CellToggleLabel(string roleId, string permId) =>
        RbacMatrixRegistration.CellToggle(_localizer, roleId, permId);

    /// <summary>True when the (draft) matrix grants <paramref name="permId"/> to <paramref name="roleId"/> (web cell read).</summary>
    public bool IsAllowed(string roleId, string permId) =>
        _draft.TryGetValue(roleId, out var row) && row.TryGetValue(permId, out bool allowed) && allowed;

    /// <summary>
    /// The ordered, non-empty category bands the matrix renders (web <c>orderedCategories</c> filtered to non-empty),
    /// each with its permissions in payload order.
    /// </summary>
    public IReadOnlyList<RbacCategoryGroup> GroupedPermissions()
    {
        if (_snapshot is null || _snapshot.Roles.Count == 0)
        {
            return Array.Empty<RbacCategoryGroup>();
        }

        var grouped = new Dictionary<string, List<RbacPermissionEntry>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (RbacPermissionEntry perm in _snapshot.Permissions)
        {
            if (!grouped.TryGetValue(perm.Category, out var bucket))
            {
                bucket = new List<RbacPermissionEntry>();
                grouped[perm.Category] = bucket;
                order.Add(perm.Category);
            }

            bucket.Add(perm);
        }

        // web: payload.categories drives ordering when present, else the discovered insertion order.
        IReadOnlyList<string> ordered = _snapshot.Categories.Count > 0 ? _snapshot.Categories : order;

        var result = new List<RbacCategoryGroup>();
        foreach (string cat in ordered)
        {
            if (grouped.TryGetValue(cat, out var items) && items.Count > 0)
            {
                result.Add(new RbacCategoryGroup(cat, items));
            }
        }

        return result;
    }

    /// <summary>Run (or re-run) the matrix read query (web mount + refetch).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        _isFetching = true;
        if (_snapshot is null)
        {
            _loading = true;
        }

        RaiseState();

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            if (cts.Token.IsCancellationRequested)
            {
                return;
            }

            _snapshot = snapshot;
            _loadError = false;
            _loadErrorCode = null;
            _loading = false;

            // web effect: resync the draft from a fresh snapshot unless the operator is mid-edit.
            if (!_editing)
            {
                SyncDraftFromSnapshot();
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (ApiException ex)
        {
            _loadError = true;
            _loadErrorCode = ex.ErrorCode;
            _loading = false;
        }
        catch (Exception)
        {
            _loadError = true;
            _loadErrorCode = null;
            _loading = false;
        }
        finally
        {
            if (!cts.Token.IsCancellationRequested)
            {
                _isFetching = false;
                RaiseState();
            }
        }
    }

    /// <summary>Refresh the matrix read query (web Retry / post-save invalidation).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Enter edit mode — reseed the draft from the snapshot and clear any prior error (web <c>handleEnterEdit</c>).</summary>
    public void EnterEdit()
    {
        if (_snapshot is null || _snapshot.IsOpenMode || _snapshot.Roles.Count == 0)
        {
            return;
        }

        _submitError = null;
        SyncDraftFromSnapshot();
        _editing = true;
        RaiseState();
    }

    /// <summary>Cancel edit mode — discard draft edits and clear the error (web <c>handleCancelEdit</c>).</summary>
    public void CancelEdit()
    {
        _editing = false;
        SyncDraftFromSnapshot();
        _submitError = null;
        RaiseState();
    }

    /// <summary>Toggle a single (role, permission) cell in the draft (web <c>handleToggle</c>).</summary>
    public void Toggle(string roleId, string permId, bool next)
    {
        ArgumentNullException.ThrowIfNull(roleId);
        ArgumentNullException.ThrowIfNull(permId);

        if (!_draft.TryGetValue(roleId, out var row))
        {
            row = new Dictionary<string, bool>(StringComparer.Ordinal);
            _draft[roleId] = row;
        }

        row[permId] = next;
        RaiseState();
    }

    /// <summary>
    /// Persist the changed cells — the native analogue of the web <c>handleSave</c> → <c>useUpsertRbacCells</c>. An
    /// empty diff just exits edit mode; otherwise it PUTs the batch and, on success, re-runs the read. Returns false
    /// on failure so the host keeps the matrix in edit mode (web parity) and records the error message.
    /// </summary>
    public async Task<bool> SaveAsync(CancellationToken cancellationToken = default)
    {
        if (_snapshot is null || _snapshot.IsOpenMode)
        {
            return false;
        }

        _submitError = null;
        IReadOnlyList<RbacUpsertCell> cells = RbacMatrix.DiffMatrices(_snapshot.Matrix, SnapshotDraft());
        if (cells.Count == 0)
        {
            _editing = false;
            RaiseState();
            return true;
        }

        _isSaving = true;
        RaiseState();
        try
        {
            await _writeService.UpsertAsync(cells, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _isSaving = false;
            RaiseState();
            return false;
        }
        catch (ApiException ex)
        {
            _isSaving = false;
            _submitError = ex.ErrorCode ?? RbacMatrixRegistration.ErrorSaveGeneric(_localizer);
            RaiseState();
            return false;
        }
        catch (Exception)
        {
            _isSaving = false;
            _submitError = RbacMatrixRegistration.ErrorSaveGeneric(_localizer);
            RaiseState();
            return false;
        }

        _isSaving = false;
        _editing = false;
        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
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

    private Dictionary<string, IReadOnlyDictionary<string, bool>> SnapshotDraft()
    {
        var view = new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);
        foreach (var (roleId, row) in _draft)
        {
            view[roleId] = row;
        }

        return view;
    }

    private void SyncDraftFromSnapshot()
    {
        _draft.Clear();
        if (_snapshot is null)
        {
            return;
        }

        foreach (var (roleId, row) in _snapshot.Matrix)
        {
            var copy = new Dictionary<string, bool>(StringComparer.Ordinal);
            foreach (var (permId, allowed) in row)
            {
                copy[permId] = allowed;
            }

            _draft[roleId] = copy;
        }
    }

    private void RaiseState()
    {
        Raise(nameof(State));
        Raise(nameof(Snapshot));
        Raise(nameof(IsFetching));
        Raise(nameof(Editing));
        Raise(nameof(IsSaving));
        Raise(nameof(DirtyCount));
        Raise(nameof(SaveLabel));
        Raise(nameof(SubmitError));
        Raise(nameof(MyRolesText));
        Raise(nameof(MyRolesStatus));
        Raise(nameof(EffectiveText));
        Raise(nameof(EffectiveStatus));
        Raise(nameof(HasGroupsHeader));
        Raise(nameof(GroupsHeaderCaption));
        Raise(nameof(ErrorLoadMessage));
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

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
