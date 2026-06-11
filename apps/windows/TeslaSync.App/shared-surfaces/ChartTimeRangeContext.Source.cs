namespace TeslaSync.App.SharedSurfaces.ChartTimeRangeContextSurface;

/// <summary>
/// The multi-chart cursor-sync store seam (P1/S8 state-holder layer) — the native port of the web
/// <c>cursorSync.ts</c> module's public surface (web/src/components/charts/cursorSync.ts):
/// <c>setCursorSyncPosition</c>, <c>getCursorSyncPosition</c>, <c>clearCursorSync</c>, the
/// <c>useCursorSyncPosition</c> subscription and the <c>_resetCursorSyncStore</c> test helper. It is the
/// single shared external store that lets every synced chart draw a persistent vertical reference line at
/// the last hovered X value, keyed by <c>syncId</c> so cross-page leakage is impossible by construction.
/// The canonical implementation is <see cref="CursorSyncStore"/>; <see cref="NoOpCursorSyncStore"/> stands
/// in for isolated hosts. Views never touch this seam directly — they bind through
/// <see cref="ChartTimeRangeProviderViewModel"/>.
/// </summary>
public interface ICursorSyncStore
{
    /// <summary>Read the current cursor X value for <paramref name="syncId"/> (web <c>getCursorSyncPosition</c>).</summary>
    CursorSyncValue GetPosition(string syncId);

    /// <summary>
    /// Set the active cursor X value for <paramref name="syncId"/> (web <c>setCursorSyncPosition</c>). A
    /// <see cref="CursorSyncValue.None"/> value clears the entry; an unchanged value is a no-op (no fan-out),
    /// mirroring the web <c>current === value</c> guard so subscribers do not churn on every mouse tick.
    /// </summary>
    void SetPosition(string syncId, CursorSyncValue value);

    /// <summary>Drop the entry for <paramref name="syncId"/> (web <c>clearCursorSync</c>); a no-op when absent.</summary>
    void Clear(string syncId);

    /// <summary>
    /// Subscribe to store changes (web <c>subscribe</c> behind <c>useSyncExternalStore</c>). The listener
    /// fires on any change; subscribers re-read their own keyed snapshot. Dispose the handle to unsubscribe.
    /// </summary>
    IDisposable Subscribe(Action listener);

    /// <summary>Fully reset the store (web <c>_resetCursorSyncStore</c>): drop all positions and listeners.</summary>
    void Reset();
}

/// <summary>
/// The canonical cursor-sync store — the native port of the web module-level store in
/// web/src/components/charts/cursorSync.ts. Like the web <c>store.positions</c> map it keeps one X value per
/// <c>syncId</c> and, like the web <c>store.listeners</c> set, fans every change out to all subscribers
/// (each re-reads its own keyed snapshot). It applies the same no-op-when-unchanged guard and the same
/// null-clears-the-entry rule. Unlike the single-threaded web module, a chart pointer callback can in
/// principle run off the UI thread, so the positions map and listener set are guarded by a lock; listeners
/// are invoked outside the lock so a listener may subscribe or unsubscribe without deadlocking.
/// </summary>
public sealed class CursorSyncStore : ICursorSyncStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, CursorSyncValue> _positions = new(StringComparer.Ordinal);
    private readonly HashSet<Action> _listeners = new();

    /// <summary>
    /// The process-wide store — the native analogue of the web module-level singleton, so every page that
    /// mounts a <see cref="ChartTimeRangeProviderViewModel"/> shares one keyed cursor space.
    /// </summary>
    public static CursorSyncStore Shared { get; } = new();

    /// <summary>The live subscriber count (parity with the web store's listener set; used by tests).</summary>
    public int ListenerCount
    {
        get
        {
            lock (_gate)
            {
                return _listeners.Count;
            }
        }
    }

    /// <inheritdoc />
    public CursorSyncValue GetPosition(string syncId)
    {
        ArgumentException.ThrowIfNullOrEmpty(syncId);
        lock (_gate)
        {
            return _positions.TryGetValue(syncId, out CursorSyncValue value) ? value : CursorSyncValue.None;
        }
    }

    /// <inheritdoc />
    public void SetPosition(string syncId, CursorSyncValue value)
    {
        ArgumentException.ThrowIfNullOrEmpty(syncId);
        lock (_gate)
        {
            CursorSyncValue current = _positions.TryGetValue(syncId, out CursorSyncValue existing)
                ? existing
                : CursorSyncValue.None;

            // web: if (current === value) return; — never fan out on an unchanged tick.
            if (current.Equals(value))
            {
                return;
            }

            // web: if (value == null) delete; else set.
            if (value.IsNone)
            {
                _positions.Remove(syncId);
            }
            else
            {
                _positions[syncId] = value;
            }
        }

        Emit();
    }

    /// <inheritdoc />
    public void Clear(string syncId)
    {
        ArgumentException.ThrowIfNullOrEmpty(syncId);
        lock (_gate)
        {
            // web: if (!store.positions.has(syncId)) return;
            if (!_positions.Remove(syncId))
            {
                return;
            }
        }

        Emit();
    }

    /// <inheritdoc />
    public IDisposable Subscribe(Action listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        lock (_gate)
        {
            _listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    /// <inheritdoc />
    public void Reset()
    {
        lock (_gate)
        {
            _positions.Clear();
            _listeners.Clear();
        }
    }

    private void Emit()
    {
        Action[] snapshot;
        lock (_gate)
        {
            if (_listeners.Count == 0)
            {
                return;
            }

            snapshot = new Action[_listeners.Count];
            _listeners.CopyTo(snapshot);
        }

        foreach (Action listener in snapshot)
        {
            listener();
        }
    }

    private void Unsubscribe(Action listener)
    {
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    private sealed class Subscription(CursorSyncStore owner, Action listener) : IDisposable
    {
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            owner.Unsubscribe(listener);
        }
    }
}

/// <summary>
/// The inert cursor-sync store used by isolated hosts — the native analogue of the web
/// <c>useCursorSyncPosition(undefined)</c> path, which always returns <c>null</c> without touching the
/// store. <see cref="GetPosition"/> always returns <see cref="CursorSyncValue.None"/>,
/// <see cref="SetPosition"/> and <see cref="Clear"/> do nothing, and <see cref="Subscribe"/> returns an
/// already-inert handle, so a component bound to this store degrades gracefully instead of throwing.
/// </summary>
public sealed class NoOpCursorSyncStore : ICursorSyncStore
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpCursorSyncStore Instance { get; } = new();

    private NoOpCursorSyncStore()
    {
    }

    /// <inheritdoc />
    public CursorSyncValue GetPosition(string syncId) => CursorSyncValue.None;

    /// <inheritdoc />
    public void SetPosition(string syncId, CursorSyncValue value)
    {
        // Inert store — the web undefined-syncId path never writes.
    }

    /// <inheritdoc />
    public void Clear(string syncId)
    {
        // Inert store — nothing to drop.
    }

    /// <inheritdoc />
    public IDisposable Subscribe(Action listener) => NoOpSubscription.Instance;

    /// <inheritdoc />
    public void Reset()
    {
        // Inert store — nothing to reset.
    }

    private sealed class NoOpSubscription : IDisposable
    {
        public static NoOpSubscription Instance { get; } = new();

        private NoOpSubscription()
        {
        }

        public void Dispose()
        {
            // Nothing was subscribed.
        }
    }
}
