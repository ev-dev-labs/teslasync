namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The edit-lease seam the <c>EditConflictBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>useEditLease(resourceKey)</c> result (web/src/hooks/useEditLease.ts L65-83, consumed at
/// web/src/components/feedback/EditConflictBanner.tsx L47). It exposes the current
/// <see cref="EditLeaseSnapshot"/>, raises <see cref="Changed"/> whenever ownership moves, and offers
/// <see cref="Claim"/> (the web <c>claim()</c> the "Take over editing" affordance calls). The view never speaks
/// the cross-tab protocol itself — it binds to this seam. The production binding is the
/// <see cref="EditLeaseCoordinator"/> over an <see cref="IEditLeaseBus"/>; <see cref="StaticEditLeaseSource"/>
/// stands in for headless hosts and unit tests.
/// </summary>
public interface IEditLeaseSource
{
    /// <summary>The current lease snapshot (web <c>{ isOwner, otherTab }</c>).</summary>
    EditLeaseSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Forcibly take over the edit lease (web <c>claim()</c>): become the owner and yield the peer.</summary>
    void Claim();
}

/// <summary>
/// An <see cref="IEditLeaseSource"/> with an explicit, caller-set snapshot — the headless / unit-test default.
/// <see cref="Set"/> moves the snapshot and raises <see cref="Changed"/> so the banner projection and view-model
/// can be exercised in the owner, no-peer and conflict states without a cross-tab transport; <see cref="Claim"/>
/// applies the same owner-takes-over transition the coordinator performs and is counted for assertions.
/// </summary>
public sealed class StaticEditLeaseSource : IEditLeaseSource
{
    private readonly Func<long> _clock;
    private EditLeaseSnapshot _current;

    /// <summary>Creates a source over an initial snapshot (defaults to <see cref="EditLeaseSnapshot.None"/>).</summary>
    /// <param name="current">The initial lease snapshot.</param>
    /// <param name="clock">Optional Unix-ms clock used to stamp <see cref="Claim"/>; defaults to wall-clock.</param>
    public StaticEditLeaseSource(EditLeaseSnapshot? current = null, Func<long>? clock = null)
    {
        _current = current ?? EditLeaseSnapshot.None;
        _clock = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public EditLeaseSnapshot Current => _current;

    /// <summary>The number of times <see cref="Claim"/> has been invoked (for take-over forwarding assertions).</summary>
    public int ClaimCount { get; private set; }

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (a peer announcing / releasing the lease).</summary>
    /// <param name="snapshot">The new lease snapshot.</param>
    public void Set(EditLeaseSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Claim()
    {
        ClaimCount++;
        _current = EditLeaseSnapshot.Owner;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>The three message kinds the cross-tab edit-lease protocol exchanges (web message union, useEditLease.ts L142-165).</summary>
public enum EditLeaseMessageKind
{
    /// <summary>Ask any active owner to re-announce (web <c>lease.request</c>).</summary>
    Request,

    /// <summary>Announce ownership of the lease with the claim instant (web <c>lease.granted</c>).</summary>
    Granted,

    /// <summary>Announce that the sender released the lease (web <c>lease.released</c>).</summary>
    Released,
}

/// <summary>
/// One immutable cross-tab edit-lease message — the native analogue of the web <c>BroadcastMessage</c> the hook
/// posts/receives (web/src/hooks/useEditLease.ts L142-165). Carries the message <see cref="Kind"/>, the
/// <see cref="ResourceKey"/> it concerns, the sender's <see cref="TabId"/>, and (for <see cref="EditLeaseMessageKind.Granted"/>)
/// the <see cref="ClaimedAt"/> instant the deterministic tiebreaker compares.
/// </summary>
/// <param name="Kind">The message kind.</param>
/// <param name="ResourceKey">The resource the message concerns (web <c>resourceKey</c>).</param>
/// <param name="TabId">The sending tab/window id (web <c>tabId</c>).</param>
/// <param name="ClaimedAt">The claim instant (Unix ms) for a grant; 0 for request/released.</param>
public sealed record EditLeaseMessage(EditLeaseMessageKind Kind, string ResourceKey, string TabId, long ClaimedAt);

/// <summary>
/// The same-origin message bus the edit-lease protocol rides — the native analogue of the web BroadcastChannel
/// bus (<c>broadcast</c> / <c>subscribe</c> / <c>TAB_ID</c>, web/src/lib/broadcast.ts via useEditLease.ts). It
/// carries a stable <see cref="LocalTabId"/> for this tab/window, <see cref="Publish"/>es a message to every
/// OTHER endpoint, and raises <see cref="Received"/> for messages posted by peers (never the sender's own — the
/// web <c>subscribe()</c> filters self-broadcasts by tab id). The production binding is
/// <see cref="InMemoryEditLeaseBus"/> (cross-window within one process); a future build can swap an
/// inter-process transport without touching the coordinator.
/// </summary>
public interface IEditLeaseBus
{
    /// <summary>The stable per-tab/window identifier of this endpoint (web <c>TAB_ID</c>).</summary>
    string LocalTabId { get; }

    /// <summary>Post <paramref name="message"/> to every other endpoint on the bus (web <c>broadcast</c>).</summary>
    /// <param name="message">The message to publish.</param>
    void Publish(EditLeaseMessage message);

    /// <summary>Raised for every message posted by a peer endpoint (web <c>subscribe</c>; never self).</summary>
    event Action<EditLeaseMessage>? Received;
}

/// <summary>
/// The deferred-callback port the election timer schedules through — the native analogue of the web
/// <c>window.setTimeout</c> / <c>clearTimeout</c> pair (useEditLease.ts L176-184). <see cref="Schedule"/> arranges
/// for <paramref name="callback"/> to run once after <paramref name="delay"/>; disposing the returned handle
/// cancels a not-yet-fired callback. The production adapter is <see cref="SystemEditLeaseScheduler"/>; a test fake
/// drives time deterministically.
/// </summary>
public interface IEditLeaseScheduler
{
    /// <summary>Schedule <paramref name="callback"/> to run once after <paramref name="delay"/>; dispose to cancel.</summary>
    /// <param name="delay">The election delay.</param>
    /// <param name="callback">The callback to run when the delay elapses.</param>
    IDisposable Schedule(TimeSpan delay, Action callback);
}

/// <summary>
/// The production <see cref="IEditLeaseScheduler"/> — a one-shot <see cref="Timer"/> (the native analogue of the
/// web <c>setTimeout</c>). Disposing the returned handle stops a not-yet-fired timer (web <c>clearTimeout</c>);
/// the callback runs at most once. Thread-safe and UI-free so the coordinator is unit-tested without a UI host.
/// </summary>
public sealed class SystemEditLeaseScheduler : IEditLeaseScheduler
{
    /// <summary>The shared singleton instance.</summary>
    public static SystemEditLeaseScheduler Instance { get; } = new();

    private SystemEditLeaseScheduler()
    {
    }

    /// <inheritdoc />
    public IDisposable Schedule(TimeSpan delay, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        return new OneShotTimer(delay, callback);
    }

    private sealed class OneShotTimer : IDisposable
    {
        private readonly Timer _timer;
        private readonly object _gate = new();
        private Action? _callback;

        public OneShotTimer(TimeSpan delay, Action callback)
        {
            _callback = callback;
            _timer = new Timer(Fire, null, delay, Timeout.InfiniteTimeSpan);
        }

        private void Fire(object? state)
        {
            Action? callback;
            lock (_gate)
            {
                callback = _callback;
                _callback = null;
            }

            if (callback is null)
            {
                return;
            }

            _timer.Dispose();
            callback();
        }

        public void Dispose()
        {
            lock (_gate)
            {
                _callback = null;
            }

            _timer.Dispose();
        }
    }
}

/// <summary>
/// A process-local <see cref="IEditLeaseBus"/> hub — the native analogue of the same-origin BroadcastChannel that
/// connects every browser tab (here: every window/view of one app process). <see cref="Connect"/> hands each
/// participant an endpoint with a stable tab id; a publish from one endpoint is delivered to every OTHER connected
/// endpoint (never the sender), exactly like the web bus that filters self-broadcasts. Thread-safe; endpoints
/// detach on <see cref="IDisposable.Dispose"/>.
/// </summary>
public sealed class EditLeaseBusHub
{
    private readonly object _gate = new();
    private readonly List<Endpoint> _endpoints = new();

    /// <summary>Connect a new endpoint with an optional explicit tab id (defaults to a fresh GUID).</summary>
    /// <param name="tabId">The stable per-window tab id; defaults to a new GUID.</param>
    public IEditLeaseBus Connect(string? tabId = null)
    {
        var endpoint = new Endpoint(this, string.IsNullOrEmpty(tabId) ? Guid.NewGuid().ToString("N") : tabId);
        lock (_gate)
        {
            _endpoints.Add(endpoint);
        }

        return endpoint;
    }

    private void Publish(Endpoint sender, EditLeaseMessage message)
    {
        Endpoint[] targets;
        lock (_gate)
        {
            targets = _endpoints.Where(e => !ReferenceEquals(e, sender)).ToArray();
        }

        foreach (var target in targets)
        {
            target.Deliver(message);
        }
    }

    private void Disconnect(Endpoint endpoint)
    {
        lock (_gate)
        {
            _endpoints.Remove(endpoint);
        }
    }

    private sealed class Endpoint : IEditLeaseBus, IDisposable
    {
        private readonly EditLeaseBusHub _hub;
        private bool _disposed;

        public Endpoint(EditLeaseBusHub hub, string tabId)
        {
            _hub = hub;
            LocalTabId = tabId;
        }

        public event Action<EditLeaseMessage>? Received;

        public string LocalTabId { get; }

        public void Publish(EditLeaseMessage message)
        {
            ArgumentNullException.ThrowIfNull(message);
            if (_disposed)
            {
                return;
            }

            _hub.Publish(this, message);
        }

        public void Deliver(EditLeaseMessage message)
        {
            if (_disposed)
            {
                return;
            }

            Received?.Invoke(message);
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _hub.Disconnect(this);
        }
    }
}

/// <summary>
/// The production <see cref="IEditLeaseSource"/> — a faithful port of the web edit-lease election protocol
/// (web/src/hooks/useEditLease.ts). One coordinator represents this tab/window's lease for a single
/// <c>resourceKey</c> over an <see cref="IEditLeaseBus"/>:
/// <list type="number">
/// <item><description>on construction it posts <see cref="EditLeaseMessageKind.Request"/> and starts the election
/// timer (web mount → <c>startElection</c>);</description></item>
/// <item><description>any peer that already owns the lease replies with <see cref="EditLeaseMessageKind.Granted"/>
/// carrying its tab id + claim instant, so this coordinator surfaces the conflict;</description></item>
/// <item><description>if no peer responds before <see cref="EditConflictBannerRegistration.ElectionTimeout"/>
/// elapses, this coordinator self-grants and becomes the owner (web election timeout);</description></item>
/// <item><description>simultaneous claims are resolved by the deterministic tiebreaker — newer claim wins, equal
/// claim falls back to the lower tab id (web L213-215 / L227-229);</description></item>
/// <item><description><see cref="Claim"/> forcibly takes over by stamping the claim instant one millisecond ahead
/// (web <c>performClaim</c>), and <see cref="Dispose"/> posts <see cref="EditLeaseMessageKind.Released"/> so a
/// watching peer re-elects (web unmount / <c>beforeunload</c>).</description></item>
/// </list>
/// State mutations are serialized under a lock and notifications/broadcasts are raised outside it, so the
/// coordinator is safe to drive from the bus, timer and UI threads. WinUI-free so the whole protocol is
/// unit-tested headlessly against an in-memory bus and a manual scheduler.
/// </summary>
public sealed class EditLeaseCoordinator : IEditLeaseSource, IDisposable
{
    private readonly string _resourceKey;
    private readonly IEditLeaseBus _bus;
    private readonly IEditLeaseScheduler _scheduler;
    private readonly Func<long> _clock;
    private readonly TimeSpan _electionTimeout;
    private readonly object _gate = new();

    private long _claimedAt;
    private bool _isOwner;
    private EditLeasePeer? _otherTab;
    private IDisposable? _election;
    private bool _disposed;

    /// <summary>Creates a coordinator for <paramref name="resourceKey"/> and immediately begins the election.</summary>
    /// <param name="resourceKey">The resource this lease coordinates (web <c>resourceKey</c>).</param>
    /// <param name="bus">The same-origin message bus (web BroadcastChannel seam).</param>
    /// <param name="scheduler">The election-timer seam; defaults to <see cref="SystemEditLeaseScheduler"/>.</param>
    /// <param name="clock">Optional Unix-ms clock (web <c>Date.now()</c>); defaults to wall-clock.</param>
    /// <param name="electionTimeout">Optional election window; defaults to <see cref="EditConflictBannerRegistration.ElectionTimeout"/>.</param>
    public EditLeaseCoordinator(
        string resourceKey,
        IEditLeaseBus bus,
        IEditLeaseScheduler? scheduler = null,
        Func<long>? clock = null,
        TimeSpan? electionTimeout = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(resourceKey);
        ArgumentNullException.ThrowIfNull(bus);

        _resourceKey = resourceKey;
        _bus = bus;
        _scheduler = scheduler ?? SystemEditLeaseScheduler.Instance;
        _clock = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _electionTimeout = electionTimeout ?? EditConflictBannerRegistration.ElectionTimeout;

        _bus.Received += OnMessage;
        StartElection();
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public EditLeaseSnapshot Current
    {
        get
        {
            lock (_gate)
            {
                return new EditLeaseSnapshot(_isOwner, _otherTab);
            }
        }
    }

    /// <summary>The stable tab id this coordinator publishes under (web <c>TAB_ID</c>).</summary>
    public string LocalTabId => _bus.LocalTabId;

    /// <inheritdoc />
    public void Claim()
    {
        EditLeaseMessage grant;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            // +1ms guarantees we beat the previous owner's claim even within the same millisecond (web performClaim).
            _claimedAt = _clock() + 1;
            _isOwner = true;
            _otherTab = null;
            grant = new EditLeaseMessage(EditLeaseMessageKind.Granted, _resourceKey, _bus.LocalTabId, _claimedAt);
        }

        _bus.Publish(grant);
        Raise();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        IDisposable? timer;
        EditLeaseMessage released;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            timer = _election;
            _election = null;
            released = new EditLeaseMessage(EditLeaseMessageKind.Released, _resourceKey, _bus.LocalTabId, 0);
        }

        timer?.Dispose();
        _bus.Received -= OnMessage;
        _bus.Publish(released);
        GC.SuppressFinalize(this);
    }

    private void StartElection()
    {
        IDisposable? previous;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            previous = _election;
            _election = null;
        }

        previous?.Dispose();
        _bus.Publish(new EditLeaseMessage(EditLeaseMessageKind.Request, _resourceKey, _bus.LocalTabId, 0));

        var handle = _scheduler.Schedule(_electionTimeout, OnElectionElapsed);

        bool keep;
        lock (_gate)
        {
            keep = !_disposed;
            if (keep)
            {
                _election = handle;
            }
        }

        if (!keep)
        {
            handle.Dispose();
        }
    }

    private void OnElectionElapsed()
    {
        EditLeaseMessage? grant = null;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _election = null;

            // No peer responded to our request — promote ourselves (web election-timeout self-grant).
            if (!_isOwner && _otherTab is null)
            {
                _claimedAt = _clock();
                _isOwner = true;
                grant = new EditLeaseMessage(EditLeaseMessageKind.Granted, _resourceKey, _bus.LocalTabId, _claimedAt);
            }
        }

        if (grant is not null)
        {
            _bus.Publish(grant);
            Raise();
        }
    }

    private void OnMessage(EditLeaseMessage message)
    {
        if (message.ResourceKey != _resourceKey || message.TabId == _bus.LocalTabId)
        {
            return;
        }

        switch (message.Kind)
        {
            case EditLeaseMessageKind.Request:
                HandleRequest();
                break;
            case EditLeaseMessageKind.Granted:
                HandleGranted(new EditLeasePeer(message.TabId, message.ClaimedAt));
                break;
            case EditLeaseMessageKind.Released:
                HandleReleased(message.TabId);
                break;
            default:
                break;
        }
    }

    private void HandleRequest()
    {
        EditLeaseMessage? grant = null;
        lock (_gate)
        {
            if (!_disposed && _isOwner)
            {
                grant = new EditLeaseMessage(EditLeaseMessageKind.Granted, _resourceKey, _bus.LocalTabId, _claimedAt);
            }
        }

        if (grant is not null)
        {
            _bus.Publish(grant);
        }
    }

    private void HandleGranted(EditLeasePeer peer)
    {
        EditLeaseMessage? reassert = null;
        var notify = false;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            if (_isOwner)
            {
                // Tiebreaker: newer claim wins; equal claim falls back to the lower tab id (web L213-215).
                var peerWins = peer.ClaimedAt > _claimedAt
                    || (peer.ClaimedAt == _claimedAt && string.CompareOrdinal(peer.TabId, _bus.LocalTabId) < 0);
                if (peerWins)
                {
                    _isOwner = false;
                    _otherTab = peer;
                    notify = true;
                }
                else
                {
                    reassert = new EditLeaseMessage(EditLeaseMessageKind.Granted, _resourceKey, _bus.LocalTabId, _claimedAt);
                }
            }
            else
            {
                var current = _otherTab;
                var replace = current is null
                    || peer.ClaimedAt > current.ClaimedAt
                    || (peer.ClaimedAt == current.ClaimedAt && string.CompareOrdinal(peer.TabId, current.TabId) < 0);
                if (replace)
                {
                    _otherTab = peer;
                    notify = true;
                }
            }
        }

        if (reassert is not null)
        {
            _bus.Publish(reassert);
        }

        if (notify)
        {
            Raise();
        }
    }

    private void HandleReleased(string tabId)
    {
        var notify = false;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            if (_otherTab is { } current && current.TabId == tabId)
            {
                _otherTab = null;
                notify = true;
            }
        }

        if (notify)
        {
            // The tab we were watching is gone — re-elect so we smoothly promote ourselves (web released branch).
            Raise();
            StartElection();
        }
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}
