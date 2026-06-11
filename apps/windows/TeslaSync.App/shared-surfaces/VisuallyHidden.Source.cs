namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A live-region listener — one per mounted announcer region (the native analogue of the web
/// <c>AnnouncerListener</c> callback in web/src/hooks/useAnnouncer.ts). Invoked with the already-padded
/// message and its urgency every time <see cref="IAnnouncer.Announce"/> fires.
/// </summary>
public delegate void VisuallyHiddenAnnouncerListener(string message, VisuallyHiddenAnnouncerPriority priority);

/// <summary>
/// The global screen-reader announcer seam (P1/S8 state-holder layer) — the native port of the web
/// <c>useAnnouncer</c> module's public surface (web/src/hooks/useAnnouncer.ts): <c>announce</c>,
/// <c>subscribeAnnouncer</c> and the <c>useAnnouncer()</c> hook's stable object. It is the single shared
/// live-region channel any feature fires imperative announcements on (bulk action completed, filter
/// applied, saved view applied, ...); the mounted <see cref="VisuallyHiddenAnnouncerViewModel"/> subscribes to
/// voice them. The canonical implementation is <see cref="Announcer"/>; <see cref="NoOpAnnouncer"/> stands
/// in when no region is mounted (the web call-before-mount drop). The view never touches this seam
/// directly — it binds through the view-model.
/// </summary>
public interface IAnnouncer
{
    /// <summary>Fire an announcement (web <c>announce</c>); empty messages are skipped.</summary>
    void Announce(string message, VisuallyHiddenAnnouncerPriority priority = VisuallyHiddenAnnouncerPriority.Polite);

    /// <summary>
    /// Subscribe a live region to the channel (web <c>subscribeAnnouncer</c>). Dispose the returned handle
    /// to unsubscribe (the web returned unsubscribe function / effect cleanup).
    /// </summary>
    IDisposable Subscribe(VisuallyHiddenAnnouncerListener listener);
}

/// <summary>
/// The canonical global announcer — the native port of the web <c>useAnnouncer</c> module
/// (web/src/hooks/useAnnouncer.ts). Like the web module-level <c>listeners</c> set it broadcasts every
/// announcement to all subscribed live regions; like the web <c>announce</c> it skips empty messages and
/// appends the rotating zero-width-space suffix (via <see cref="AnnouncerMessage.Pad"/>) so screen readers
/// re-voice identical consecutive messages. It is safe to call before any region is mounted — the
/// announcement is simply dropped, exactly as a web announcement made with no live region cannot be
/// voiced. Unlike the single-threaded web module, Narrator-facing announcements can originate off the UI
/// thread, so the listener set and rotation counter are guarded by a lock; listeners are invoked outside
/// the lock so a listener may subscribe or unsubscribe without deadlocking.
/// </summary>
public sealed class Announcer : IAnnouncer
{
    private readonly object _gate = new();
    private readonly HashSet<VisuallyHiddenAnnouncerListener> _listeners = new();
    private int _counter;

    /// <summary>
    /// The process-wide announcer — the native analogue of the web module-level shared listener set, so
    /// the de-duplication suffix progresses across every call-site that uses the global channel.
    /// </summary>
    public static Announcer Shared { get; } = new();

    /// <summary>The live subscriber count (web <c>__getAnnouncerListenerCountForTests</c>).</summary>
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
    public IDisposable Subscribe(VisuallyHiddenAnnouncerListener listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        lock (_gate)
        {
            _listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    /// <inheritdoc />
    public void Announce(string message, VisuallyHiddenAnnouncerPriority priority = VisuallyHiddenAnnouncerPriority.Polite)
    {
        // web announce: `if (!message) return;` — empty strings never announce.
        if (string.IsNullOrEmpty(message))
        {
            return;
        }

        VisuallyHiddenAnnouncerListener[] snapshot;
        string padded;
        lock (_gate)
        {
            // web: announceCounter += 1; padded = message + '\u200B'.repeat(counter % 4).
            // The counter advances even when no region is listening, matching the web module's shared
            // progression, so the next mounted region still gets a fresh string.
            _counter += 1;
            padded = AnnouncerMessage.Pad(message, _counter);
            snapshot = _listeners.Count == 0
                ? Array.Empty<VisuallyHiddenAnnouncerListener>()
                : new VisuallyHiddenAnnouncerListener[_listeners.Count];
            if (snapshot.Length > 0)
            {
                _listeners.CopyTo(snapshot);
            }
        }

        foreach (VisuallyHiddenAnnouncerListener listener in snapshot)
        {
            listener(padded, priority);
        }
    }

    private void Unsubscribe(VisuallyHiddenAnnouncerListener listener)
    {
        lock (_gate)
        {
            _listeners.Remove(listener);
        }
    }

    private sealed class Subscription(Announcer owner, VisuallyHiddenAnnouncerListener listener) : IDisposable
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
/// The inert announcer used when no region is mounted — the native analogue of the web announcer's
/// behaviour when <c>useAnnouncer().announce</c> is called with no <c>AnnouncerRegion</c> listening: the
/// message is silently dropped. <see cref="Announce"/> does nothing and <see cref="Subscribe"/> returns an
/// already-inert handle, so an isolated host that binds the channel degrades gracefully instead of
/// throwing.
/// </summary>
public sealed class NoOpAnnouncer : IAnnouncer
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpAnnouncer Instance { get; } = new();

    private NoOpAnnouncer()
    {
    }

    /// <inheritdoc />
    public void Announce(string message, VisuallyHiddenAnnouncerPriority priority = VisuallyHiddenAnnouncerPriority.Polite)
    {
        // No region mounted — the web announcer drops messages that have no live region to voice them.
    }

    /// <inheritdoc />
    public IDisposable Subscribe(VisuallyHiddenAnnouncerListener listener) => NoOpSubscription.Instance;

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
