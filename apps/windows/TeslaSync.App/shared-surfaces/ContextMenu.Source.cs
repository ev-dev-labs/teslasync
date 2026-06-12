using System.Collections.Generic;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The module-level context-menu store the whole app shares — the native port of the web
/// <c>ContextMenu</c> module store (web/src/components/ui/ContextMenu.tsx L86-L143: the process-global
/// <c>state</c> / <c>listeners</c> set / <c>nonceCounter</c> driven by <c>openContextMenu</c> /
/// <c>closeContextMenu</c> and read by <c>useSyncExternalStore</c>). It is the surface's P1/S8 state-holder
/// seam: any call site anywhere in the app opens the one menu without prop-drilling (the web design intent),
/// the single mounted <see cref="ContextMenuRoot"/> subscribes, and the view never mutates the store except
/// through <see cref="Close"/>. <see cref="Subscribe"/> + <see cref="Current"/> are the
/// <c>useSyncExternalStore</c> <c>subscribe</c> + <c>getSnapshot</c> pair.
/// </summary>
public interface IContextMenuController
{
    /// <summary>
    /// The open menu, or <see langword="null"/> when closed (web <c>getSnapshot()</c>). Reading it gives the
    /// current snapshot the way <c>useSyncExternalStore</c> reads the module <c>state</c>.
    /// </summary>
    ContextMenuSnapshot? Current { get; }

    /// <summary>
    /// Subscribe to open/close changes (web <c>subscribe</c>). The listener is invoked with the new snapshot on
    /// open and with <see langword="null"/> on close. Dispose the returned token to unsubscribe (the native
    /// analogue of the web unsubscribe closure). Used by the mounted surface; call sites use <see cref="Open"/>
    /// / <see cref="Close"/> instead of subscribing directly.
    /// </summary>
    IDisposable Subscribe(Action<ContextMenuSnapshot?> listener);

    /// <summary>
    /// Open the menu at viewport coordinates (web <c>openContextMenu(items, x, y, restoreFocusEl)</c>). An
    /// empty or <see langword="null"/> item list is skipped (web <c>if (!items || items.length === 0) return;</c>);
    /// otherwise the open counter advances, a fresh <see cref="ContextMenuSnapshot"/> is published and every
    /// subscriber is notified. Re-opening with an identical (items, x, y) still produces a distinct snapshot so
    /// the menu re-shows (web <c>nonceCounter</c>).
    /// </summary>
    /// <param name="items">The actions to present; empty / null is a no-op.</param>
    /// <param name="x">Viewport x to anchor at (web <c>x</c>).</param>
    /// <param name="y">Viewport y to anchor at (web <c>y</c>).</param>
    /// <param name="restoreTarget">Element that owns focus now; restored on close (web <c>restoreFocusEl</c>).</param>
    void Open(IReadOnlyList<ContextMenuItem> items, double x, double y, object? restoreTarget = null);

    /// <summary>Close the menu (web <c>closeContextMenu()</c>); a no-op when already closed.</summary>
    void Close();
}

/// <summary>
/// The canonical <see cref="IContextMenuController"/> — the native port of the web <c>ContextMenu</c> module
/// store's shared <c>listeners</c> set, <c>state</c> and <c>nonceCounter</c>
/// (web/src/components/ui/ContextMenu.tsx L90-L136). The web module keeps a process-global listener
/// <c>Set</c>, the current <c>state</c> and a monotonic <c>nonceCounter</c>; this mirrors them with a
/// lock-guarded <see cref="HashSet{T}"/>, field and counter, and exposes the same process-wide instance
/// through <see cref="Shared"/> so every call site and the one mounted surface share a single source of truth
/// (the web design where any anchor opens the same menu). Unlike the single-threaded web module the store may
/// be driven from any thread, so the listener set + state are lock-guarded and listeners are snapshotted
/// before fan-out to avoid invoking under the lock.
/// </summary>
public sealed class ContextMenuController : IContextMenuController
{
    private readonly object _gate = new();
    private readonly HashSet<Action<ContextMenuSnapshot?>> _listeners = [];
    private ContextMenuSnapshot? _current;

    // The monotonic open ordinal — web `nonceCounter`. Bumped on every open so a re-open with an identical
    // (items, x, y) still publishes a distinct snapshot and re-shows the menu.
    private long _nonceCounter;

    /// <summary>
    /// The process-wide shared store — the native analogue of the web module's global state, so a menu opened
    /// from anywhere reaches the one mounted <see cref="ContextMenuRoot"/>. Mirrors the way every web call site
    /// imports the same <c>openContextMenu</c> / <c>closeContextMenu</c> from the shared module.
    /// </summary>
    public static ContextMenuController Shared { get; } = new();

    /// <inheritdoc />
    public ContextMenuSnapshot? Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <summary>
    /// The number of currently-subscribed listeners — the native analogue of the web test helper that reads
    /// the module listener-set size, used to assert mount / unmount behaviour.
    /// </summary>
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
    public void Open(IReadOnlyList<ContextMenuItem> items, double x, double y, object? restoreTarget = null)
    {
        // web: `if (!items || items.length === 0) return;` — an empty menu is never opened.
        if (items is null || items.Count == 0)
        {
            return;
        }

        // Defensively copy so a later mutation of the caller's list can't change an already-published snapshot.
        var snapshotItems = new List<ContextMenuItem>(items);

        Action<ContextMenuSnapshot?>[] listeners;
        ContextMenuSnapshot published;
        lock (_gate)
        {
            // web: `nonceCounter += 1;` then `state = { items, x, y, restoreFocusEl, nonce: nonceCounter };`
            _nonceCounter++;
            published = new ContextMenuSnapshot(snapshotItems, x, y, _nonceCounter, restoreTarget);
            _current = published;

            // Snapshot subscribers under the lock, fan out below it: a listener must never run while the gate
            // is held (it may re-enter Subscribe / Dispose or re-open the menu).
            listeners = [.. _listeners];
        }

        foreach (var listener in listeners)
        {
            listener(published);
        }
    }

    /// <inheritdoc />
    public void Close()
    {
        Action<ContextMenuSnapshot?>[] listeners;
        lock (_gate)
        {
            // web: `if (state === null) return;` — closing an already-closed menu is a no-op (no fan-out).
            if (_current is null)
            {
                return;
            }

            _current = null;
            listeners = [.. _listeners];
        }

        foreach (var listener in listeners)
        {
            listener(null);
        }
    }

    /// <inheritdoc />
    public IDisposable Subscribe(Action<ContextMenuSnapshot?> listener)
    {
        ArgumentNullException.ThrowIfNull(listener);

        lock (_gate)
        {
            _listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    /// <summary>
    /// Clear every subscriber and reset the store — the native analogue of the web test helper
    /// <c>__resetContextMenuForTests()</c> (web L138-L143), so a test driving the <see cref="Shared"/> store
    /// starts from a clean slate. Intended for tests only.
    /// </summary>
    public void ResetForTests()
    {
        lock (_gate)
        {
            _current = null;
            _nonceCounter = 0;
            _listeners.Clear();
        }
    }

    private void Unsubscribe(Action<ContextMenuSnapshot?> listener)
    {
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    /// <summary>
    /// The unsubscribe token returned by <see cref="Subscribe"/> — the native analogue of the web unsubscribe
    /// closure (<c>() =&gt; { listeners.delete(fn); }</c>). Idempotent: disposing more than once removes the
    /// listener at most once.
    /// </summary>
    private sealed class Subscription(ContextMenuController owner, Action<ContextMenuSnapshot?> listener) : IDisposable
    {
        private ContextMenuController? _owner = owner;

        public void Dispose()
        {
            var owner = Interlocked.Exchange(ref _owner, null);
            owner?.Unsubscribe(listener);
        }
    }
}
