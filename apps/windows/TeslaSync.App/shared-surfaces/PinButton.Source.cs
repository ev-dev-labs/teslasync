using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The unified pin seam the <c>PinButton</c> surface binds through (P1/S8 state-holder layer) — the native port
/// of the web pin hooks the component composes (web/src/api/hooks/usePinned.ts): the read side mirrors
/// <c>usePinned(itemType, context)</c> (does the (type, context) bucket contain this item id?) and the write side
/// mirrors <c>useTogglePin(itemType).mutate({ itemId, context, pin })</c>. The view never fetches; a composition
/// root binds an implementation that reads the <c>/pinned?type=…</c> cache and issues the POST (pin) / DELETE
/// (unpin), and raises <see cref="Changed"/> when the pin set moves (the web mutation's <c>invalidateAndBroadcast</c>
/// re-running every <c>pinned[type]</c> query) so every open <c>PinButton</c> over the same bucket re-projects.
///
/// <para>
/// Failure semantics follow the web's <c>request()</c> path exactly: <see cref="SetPinnedAsync"/> completes on
/// success and <b>throws</b> on failure (a rejected network call), so the view-model branches success → confirm +
/// success toast versus the thrown error → error toast carrying the error's message (web
/// <c>useMutationToast.error(e, …)</c>). <see cref="InMemoryPinStore"/> is the process-local default used by
/// headless hosts and success-path tests; <see cref="DelegatePinStore"/> adapts arbitrary read / write delegates
/// (used by the production composition root and to simulate latency / failure in tests).
/// </para>
/// </summary>
public interface IPinStore
{
    /// <summary>
    /// Raised when the pin set changes (web: the <c>usePinned</c> query result moving after a toggle's
    /// invalidation, or another surface toggling the same bucket). May be raised from a background thread.
    /// </summary>
    event EventHandler? Changed;

    /// <summary>
    /// Whether <paramref name="itemId"/> is currently pinned in the (<paramref name="itemType"/>,
    /// <paramref name="context"/>) bucket (web <c>pinned.some(p =&gt; String(p.item_id) === idStr)</c>). A
    /// still-loading or failed pin query reads as not-pinned (the web defaults <c>data</c> to <c>[]</c>), so the
    /// trigger degrades to its idle state rather than blocking.
    /// </summary>
    /// <param name="itemType">The domain bucket (web <c>itemType</c>).</param>
    /// <param name="itemId">The stable item id, already stringified (web <c>String(itemId)</c>).</param>
    /// <param name="context">The optional sub-surface scope (web <c>context</c>); null for the default bucket.</param>
    /// <returns>True when the item is pinned.</returns>
    bool IsPinned(PinItemType itemType, string itemId, string? context);

    /// <summary>
    /// Pin or unpin <paramref name="itemId"/> in the (<paramref name="itemType"/>, <paramref name="context"/>)
    /// bucket (web <c>toggle.mutate({ itemId, context, pin })</c>): <paramref name="pinned"/> chooses create
    /// (POST) versus delete (DELETE). The task completes on success and <b>throws</b> on failure, reproducing the
    /// web <c>request()</c> rejection that drives <c>onError</c>. Implementations raise <see cref="Changed"/> only
    /// after a successful write (the web post-success invalidation), never on failure.
    /// </summary>
    /// <param name="itemType">The domain bucket (web <c>type</c>).</param>
    /// <param name="itemId">The stable item id, already stringified (web <c>itemId</c>).</param>
    /// <param name="context">The optional sub-surface scope (web <c>context</c>); null for the default bucket.</param>
    /// <param name="pinned">The target state — true to pin (POST), false to unpin (DELETE).</param>
    /// <returns>A task that completes on success and faults on failure.</returns>
    Task SetPinnedAsync(PinItemType itemType, string itemId, string? context, bool pinned);
}

/// <summary>
/// The process-local <see cref="IPinStore"/> used by headless hosts, the surface's default construction, and
/// success-path tests. It holds the pinned item ids per (type, context) bucket in memory, flips them in
/// <see cref="SetPinnedAsync"/> and raises <see cref="Changed"/>, exactly as the web <c>usePinned</c> query result
/// updates its subscribers after a successful toggle; the production composition root replaces it with a
/// <see cref="DelegatePinStore"/> bound to the <c>/pinned</c> cache + mutation. Starts empty (the web default
/// before the query resolves), so a fresh button reads as not-pinned. Thread-safe: bucket mutations are
/// serialized and <see cref="Changed"/> fires outside the lock.
/// </summary>
public sealed class InMemoryPinStore : IPinStore
{
    private readonly object _gate = new();
    private readonly Dictionary<BucketKey, HashSet<string>> _buckets = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsPinned(PinItemType itemType, string itemId, string? context)
    {
        ArgumentNullException.ThrowIfNull(itemId);

        lock (_gate)
        {
            return _buckets.TryGetValue(new BucketKey(itemType, context), out var ids) && ids.Contains(itemId);
        }
    }

    /// <inheritdoc />
    public Task SetPinnedAsync(PinItemType itemType, string itemId, string? context, bool pinned)
    {
        ArgumentNullException.ThrowIfNull(itemId);

        bool mutated;
        lock (_gate)
        {
            var key = new BucketKey(itemType, context);
            if (pinned)
            {
                if (!_buckets.TryGetValue(key, out var ids))
                {
                    ids = new HashSet<string>(StringComparer.Ordinal);
                    _buckets[key] = ids;
                }

                mutated = ids.Add(itemId);
            }
            else
            {
                mutated = _buckets.TryGetValue(key, out var ids) && ids.Remove(itemId);
            }
        }

        // web: a successful toggle invalidates the pinned query, so subscribers re-read. A no-op write (already in
        // the target state) still resolves successfully on the web (the mutation runs and onSuccess fires).
        if (mutated)
        {
            RaiseChanged();
        }

        return Task.CompletedTask;
    }

    /// <summary>
    /// Pre-pin <paramref name="itemIds"/> in the (<paramref name="itemType"/>, <paramref name="context"/>) bucket
    /// without raising <see cref="Changed"/> — the in-memory analogue of the pin query resolving with seed data
    /// before the surface mounts. For headless hosts and test setup.
    /// </summary>
    public void Seed(PinItemType itemType, string? context, params string[] itemIds)
    {
        ArgumentNullException.ThrowIfNull(itemIds);

        lock (_gate)
        {
            var key = new BucketKey(itemType, context);
            if (!_buckets.TryGetValue(key, out var ids))
            {
                ids = new HashSet<string>(StringComparer.Ordinal);
                _buckets[key] = ids;
            }

            foreach (var id in itemIds)
            {
                if (id is not null)
                {
                    ids.Add(id);
                }
            }
        }
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    private readonly record struct BucketKey(PinItemType Type, string? Context);
}

/// <summary>
/// A delegate-backed <see cref="IPinStore"/> — lets a host supply the pin read and write as functions. The
/// production composition root binds the read to the <c>/pinned?type=…</c> cache lookup and the write to the
/// POST / DELETE mutation; tests use it to simulate latency (an awaitable the test completes) or failure (a
/// delegate that throws, exercising the error-toast path). A successful write raises <see cref="Changed"/>; a
/// faulted write propagates the exception and raises nothing, reproducing the web <c>request()</c> rejection that
/// drives <c>onError</c>. External invalidations (another surface toggling the same bucket) are surfaced through
/// <see cref="NotifyChanged"/>.
/// </summary>
public sealed class DelegatePinStore : IPinStore
{
    private readonly Func<PinItemType, string, string?, bool> _isPinned;
    private readonly Func<PinItemType, string, string?, bool, Task> _setPinned;

    /// <summary>Creates the store over its read predicate and write delegate.</summary>
    /// <param name="isPinned">Reads whether an item is pinned (web <c>usePinned</c> membership check).</param>
    /// <param name="setPinned">Performs the pin / unpin write (web <c>useTogglePin</c>); throws on failure.</param>
    public DelegatePinStore(
        Func<PinItemType, string, string?, bool> isPinned,
        Func<PinItemType, string, string?, bool, Task> setPinned)
    {
        ArgumentNullException.ThrowIfNull(isPinned);
        ArgumentNullException.ThrowIfNull(setPinned);

        _isPinned = isPinned;
        _setPinned = setPinned;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsPinned(PinItemType itemType, string itemId, string? context)
    {
        ArgumentNullException.ThrowIfNull(itemId);
        return _isPinned(itemType, itemId, context);
    }

    /// <inheritdoc />
    public async Task SetPinnedAsync(PinItemType itemType, string itemId, string? context, bool pinned)
    {
        ArgumentNullException.ThrowIfNull(itemId);

        // Faults propagate to the caller untouched (web request() rejection → onError); Changed is raised only
        // after the write resolves successfully (web onSuccess → invalidateAndBroadcast).
        await _setPinned(itemType, itemId, context, pinned).ConfigureAwait(false);
        NotifyChanged();
    }

    /// <summary>Raise <see cref="Changed"/> in response to an external pin-set update (web cross-surface invalidation).</summary>
    public void NotifyChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
