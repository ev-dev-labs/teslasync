namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A single subscribed live region's fan-out callback — the native analogue of the web
/// <c>AnnouncerListener</c> (web/src/hooks/useAnnouncer.ts L42-L45). Invoked once per announcement with the
/// already-padded <paramref name="message"/> (see <see cref="AnnouncerText.Pad"/>) and its
/// <paramref name="priority"/>; the mounted surface routes the message to its polite or assertive region.
/// </summary>
public delegate void AnnouncerListener(string message, AnnouncerPriority priority);

/// <summary>
/// The shared screen-reader announcer bus — the native port of the web <c>useAnnouncer</c> module
/// (web/src/hooks/useAnnouncer.ts). It is the single live-region API for firing imperative announcements from
/// anywhere in the app (bulk action completed, filter applied, saved view applied, …) without each call site
/// having to own its own live region. The mounted <c>AnnouncerRegion</c> surface subscribes; call sites fire
/// <see cref="Announce"/>. This is the surface's P1/S8 state-holder seam — the view never fans out directly.
/// </summary>
public interface IAnnouncerBus
{
    /// <summary>
    /// Fire a screen-reader announcement (web <c>announce(message, priority='polite')</c>). An empty or
    /// <see langword="null"/> message is skipped (web <c>if (!message) return;</c>). The message is padded
    /// with a rotating zero-width-space suffix so the screen reader re-reads duplicates, then fanned out to
    /// every subscribed region. Safe to call before any region is mounted — with no subscribers it no-ops,
    /// mirroring the web module's drop-when-no-listeners behaviour.
    /// </summary>
    /// <param name="message">The text to announce; empty / <see langword="null"/> is skipped.</param>
    /// <param name="priority">
    /// <see cref="AnnouncerPriority.Polite"/> (default) waits for the screen reader to finish;
    /// <see cref="AnnouncerPriority.Assertive"/> interrupts. Reserve assertive for genuine errors.
    /// </param>
    void Announce(string message, AnnouncerPriority priority = AnnouncerPriority.Polite);

    /// <summary>
    /// Subscribe a live region to the bus (web <c>subscribeAnnouncer</c>). Used by the mounted surface; call
    /// sites should fire <see cref="Announce"/> instead of subscribing directly. Dispose the returned token
    /// to unsubscribe (the native analogue of the web unsubscribe closure).
    /// </summary>
    IDisposable Subscribe(AnnouncerListener listener);
}

/// <summary>
/// The canonical <see cref="IAnnouncerBus"/> — the native port of the web <c>useAnnouncer</c> module's
/// shared listener set and rotating announcement counter (web/src/hooks/useAnnouncer.ts L47-L84). The web
/// module keeps a process-global <c>Set&lt;AnnouncerListener&gt;</c> and an <c>announceCounter</c>; this
/// mirrors them with a guarded <see cref="HashSet{T}"/> and counter, and exposes the same process-wide
/// instance through <see cref="Shared"/> so every call site and the mounted surface share one source of
/// truth. Unlike the single-threaded web module the bus may be driven from background threads (an MQTT/live
/// callback firing an announcement), so the listener set and counter are lock-guarded and listeners are
/// snapshotted before fan-out to avoid invoking under the lock.
/// </summary>
public sealed class AnnouncerBus : IAnnouncerBus
{
    private readonly object _gate = new();
    private readonly HashSet<AnnouncerListener> _listeners = [];

    // The rotating announcement ordinal — web `announceCounter`. Shared across every call site so the
    // zero-width-space suffix progression (counter % 4) is global, exactly like the web module-level counter.
    private int _announceCounter;

    /// <summary>
    /// The process-wide shared bus — the native analogue of the web module's global listener set, so an
    /// announcement fired from anywhere reaches the one mounted surface. Mirrors the way every web call site
    /// imports the same <c>announce</c> from the shared module.
    /// </summary>
    public static AnnouncerBus Shared { get; } = new();

    /// <summary>
    /// The number of currently-subscribed live regions — the native analogue of the web test helper
    /// <c>__getAnnouncerListenerCountForTests()</c>, used to assert mount / unmount behaviour.
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
    public void Announce(string message, AnnouncerPriority priority = AnnouncerPriority.Polite)
    {
        // web: `if (!message) return;` — empty announcements are skipped (a live region can't voice nothing).
        if (string.IsNullOrEmpty(message))
        {
            return;
        }

        AnnouncerListener[] snapshot;
        string padded;
        lock (_gate)
        {
            // web: `announceCounter += 1;` then `'\u200B'.repeat(announceCounter % 4)`.
            _announceCounter++;
            padded = AnnouncerText.Pad(message, _announceCounter);

            // Snapshot under the lock, fan out below it: a listener must never run while the gate is held
            // (it may re-enter Subscribe/Dispose or fire another announcement) and the set must not mutate
            // mid-iteration if a region unmounts during fan-out.
            snapshot = [.. _listeners];
        }

        foreach (var listener in snapshot)
        {
            listener(padded, priority);
        }
    }

    /// <inheritdoc />
    public IDisposable Subscribe(AnnouncerListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);

        lock (_gate)
        {
            _listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    /// <summary>
    /// Clear every subscriber and reset the announcement counter — the native analogue of the web test
    /// helper <c>__resetAnnouncerForTests()</c>, so a test driving the <see cref="Shared"/> bus starts from a
    /// clean slate. Intended for tests only.
    /// </summary>
    public void ResetForTests()
    {
        lock (_gate)
        {
            _listeners.Clear();
            _announceCounter = 0;
        }
    }

    private void Unsubscribe(AnnouncerListener listener)
    {
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    /// <summary>
    /// The unsubscribe token returned by <see cref="Subscribe"/> — the native analogue of the web
    /// unsubscribe closure (<c>() =&gt; { listeners.delete(listener); }</c>). Idempotent: disposing more than
    /// once removes the listener at most once.
    /// </summary>
    private sealed class Subscription(AnnouncerBus bus, AnnouncerListener listener) : IDisposable
    {
        private AnnouncerBus? _bus = bus;

        public void Dispose()
        {
            var owner = Interlocked.Exchange(ref _bus, null);
            owner?.Unsubscribe(listener);
        }
    }
}
