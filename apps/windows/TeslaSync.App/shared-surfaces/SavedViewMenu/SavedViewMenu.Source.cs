using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The read seam the menu binds to (P1/S8 state-holder layer) — the native port of the web
/// <c>useSavedViews(route)</c> query (web/src/api/hooks/useSavedViews.ts). The web hook returns the route's
/// views plus the TanStack query lifecycle (loading / error / stale); the native analogue surfaces the same
/// information as a single immutable <see cref="RepositoryResult{T}"/> snapshot the surface re-projects on
/// <see cref="Changed"/>. The view never fetches — it reads <see cref="Current"/> and calls
/// <see cref="Refresh"/> for the error-retry / stale-auto-refresh affordances (the native analogue of the
/// query's <c>refetch</c>). A shell adapter (or a test double) supplies the implementation.
/// </summary>
public interface ISavedViewsStore
{
    /// <summary>The current query snapshot — the route's views plus their load lifecycle (web <c>useSavedViews</c> result).</summary>
    RepositoryResult<IReadOnlyList<SavedView>> Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes (a new query emission); the bound surface re-projects.</summary>
    event EventHandler? Changed;

    /// <summary>Request a refresh (web <c>refetch</c> / cache invalidation) — drives error-retry and stale auto-refresh.</summary>
    void Refresh();
}

/// <summary>
/// The canonical in-memory <see cref="ISavedViewsStore"/> — the native analogue of the TanStack query cache
/// for one route's saved views. A host seeds it with the latest emission and calls <see cref="Set"/> to push
/// a new snapshot (the analogue of the query transitioning Loading → Loaded → …); <see cref="Refresh"/>
/// invokes the optional refresh callback the host wires to its real refetch. UI-thread-confined; not
/// internally synchronised.
/// </summary>
public sealed class SavedViewsStore : ISavedViewsStore
{
    private readonly Action? _onRefresh;
    private RepositoryResult<IReadOnlyList<SavedView>> _current;

    /// <summary>Creates the store over an initial snapshot (defaults to <see cref="RepositoryResult{T}.Loading"/>) and an optional refresh callback.</summary>
    public SavedViewsStore(
        RepositoryResult<IReadOnlyList<SavedView>>? initial = null,
        Action? onRefresh = null)
    {
        _current = initial ?? RepositoryResult<IReadOnlyList<SavedView>>.Loading();
        _onRefresh = onRefresh;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public RepositoryResult<IReadOnlyList<SavedView>> Current => _current;

    /// <summary>Push a new query snapshot and raise <see cref="Changed"/> so the bound surface re-projects.</summary>
    public void Set(RepositoryResult<IReadOnlyList<SavedView>> result)
    {
        ArgumentNullException.ThrowIfNull(result);
        _current = result;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Convenience: push a freshly-loaded list (or the empty snapshot when the list has no rows).</summary>
    public void SetViews(IReadOnlyList<SavedView> views, DateTimeOffset? fetchedAt = null)
    {
        ArgumentNullException.ThrowIfNull(views);
        DateTimeOffset stamp = fetchedAt ?? DateTimeOffset.UtcNow;
        Set(views.Count == 0
            ? RepositoryResult<IReadOnlyList<SavedView>>.Empty(stamp)
            : RepositoryResult<IReadOnlyList<SavedView>>.Loaded(views, stamp));
    }

    /// <inheritdoc />
    public void Refresh() => _onRefresh?.Invoke();
}

/// <summary>
/// The write seam the menu routes saved-view mutations through (P1/S8 state-holder layer) — the native port
/// of the web create / update / delete / set-default hooks (web/src/api/hooks/useSavedViews.ts:
/// <c>useCreateSavedView</c>, <c>useUpdateSavedView</c>, <c>useDeleteSavedView</c>,
/// <c>useSetDefaultSavedView</c>). Each method returns a <see cref="Task"/> the view-model awaits to drive
/// its per-dialog pending state (web <c>isPending</c>); after a mutation completes the view-model refreshes
/// the store (the native analogue of the hooks' <c>invalidateAndBroadcast</c> on success). The route is
/// passed alongside the id so a host can invalidate the right cache without a read-back, exactly as the web
/// hooks carry <c>route</c>.
/// </summary>
public interface ISavedViewMutations
{
    /// <summary>Create a saved view (web <c>useCreateSavedView</c>).</summary>
    Task CreateAsync(SavedViewCreateInput input, CancellationToken cancellationToken = default);

    /// <summary>Patch a saved view (web <c>useUpdateSavedView</c>) — used by rename and pin toggles.</summary>
    Task UpdateAsync(long id, string route, SavedViewUpdateInput patch, CancellationToken cancellationToken = default);

    /// <summary>Delete a saved view (web <c>useDeleteSavedView</c>).</summary>
    Task DeleteAsync(long id, string route, CancellationToken cancellationToken = default);

    /// <summary>Toggle the default flag (web <c>useSetDefaultSavedView</c>).</summary>
    Task SetDefaultAsync(long id, string route, bool isDefault, CancellationToken cancellationToken = default);
}

/// <summary>
/// A delegate-backed <see cref="ISavedViewMutations"/> — the canonical implementation a host builds from its
/// repository calls (the native analogue of passing the web mutation functions to the component). Any null
/// delegate degrades to a completed no-op so a partially-wired host never throws.
/// </summary>
public sealed class SavedViewMutations : ISavedViewMutations
{
    private readonly Func<SavedViewCreateInput, CancellationToken, Task>? _create;
    private readonly Func<long, string, SavedViewUpdateInput, CancellationToken, Task>? _update;
    private readonly Func<long, string, CancellationToken, Task>? _delete;
    private readonly Func<long, string, bool, CancellationToken, Task>? _setDefault;

    /// <summary>Creates the mutation set from its delegates; any omitted delegate degrades to a completed no-op.</summary>
    public SavedViewMutations(
        Func<SavedViewCreateInput, CancellationToken, Task>? create = null,
        Func<long, string, SavedViewUpdateInput, CancellationToken, Task>? update = null,
        Func<long, string, CancellationToken, Task>? delete = null,
        Func<long, string, bool, CancellationToken, Task>? setDefault = null)
    {
        _create = create;
        _update = update;
        _delete = delete;
        _setDefault = setDefault;
    }

    /// <inheritdoc />
    public Task CreateAsync(SavedViewCreateInput input, CancellationToken cancellationToken = default) =>
        _create?.Invoke(input, cancellationToken) ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task UpdateAsync(long id, string route, SavedViewUpdateInput patch, CancellationToken cancellationToken = default) =>
        _update?.Invoke(id, route, patch, cancellationToken) ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(long id, string route, CancellationToken cancellationToken = default) =>
        _delete?.Invoke(id, route, cancellationToken) ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task SetDefaultAsync(long id, string route, bool isDefault, CancellationToken cancellationToken = default) =>
        _setDefault?.Invoke(id, route, isDefault, cancellationToken) ?? Task.CompletedTask;
}

/// <summary>
/// The inert mutation set — every mutation is a completed no-op. The safe default when a host has not wired a
/// repository yet (galleries / design hosts), so the menu still renders and its dialogs open without a write
/// seam to drive.
/// </summary>
public sealed class InertSavedViewMutations : ISavedViewMutations
{
    /// <summary>The shared inert instance.</summary>
    public static InertSavedViewMutations Instance { get; } = new();

    private InertSavedViewMutations()
    {
    }

    /// <inheritdoc />
    public Task CreateAsync(SavedViewCreateInput input, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task UpdateAsync(long id, string route, SavedViewUpdateInput patch, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task DeleteAsync(long id, string route, CancellationToken cancellationToken = default) => Task.CompletedTask;

    /// <inheritdoc />
    public Task SetDefaultAsync(long id, string route, bool isDefault, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

/// <summary>
/// The apply seam the menu drives the URL through (P1/S8 state-holder layer) — the native port of the web
/// <c>onApply(query)</c> prop (web/src/components/data-display/SavedViewMenu.tsx), which the parent page wires
/// to <c>setSearchParams</c>. <see cref="Apply"/> with a view's querystring re-applies the view; the empty
/// string clears the URL back to the unfiltered route (web <c>onApply('')</c>).
/// </summary>
public interface ISavedViewApplier
{
    /// <summary>Apply <paramref name="query"/> to the page URL; the empty string clears all filters (web <c>onApply</c>).</summary>
    void Apply(string query);
}

/// <summary>
/// A delegate-backed <see cref="ISavedViewApplier"/> — the canonical implementation a host builds from its
/// router (the native analogue of the web parent passing <c>setSearchParams</c>-derived <c>onApply</c>).
/// </summary>
public sealed class SavedViewApplier : ISavedViewApplier
{
    private readonly Action<string> _apply;

    /// <summary>Creates the applier over the host's apply callback.</summary>
    public SavedViewApplier(Action<string> apply)
    {
        ArgumentNullException.ThrowIfNull(apply);
        _apply = apply;
    }

    /// <inheritdoc />
    public void Apply(string query) => _apply(query ?? string.Empty);
}

/// <summary>
/// The inert applier — applying a query is a no-op. The safe default for galleries / design hosts (and the
/// headless default), so the menu renders and routes without a router wired.
/// </summary>
public sealed class InertSavedViewApplier : ISavedViewApplier
{
    /// <summary>The shared inert instance.</summary>
    public static InertSavedViewApplier Instance { get; } = new();

    private InertSavedViewApplier()
    {
    }

    /// <inheritdoc />
    public void Apply(string query)
    {
        // No router wired — the apply is dropped, the native analogue of a parent that passes a no-op onApply.
    }
}
