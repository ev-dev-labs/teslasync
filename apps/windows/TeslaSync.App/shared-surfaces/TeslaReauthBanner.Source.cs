namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The Tesla-auth-recovery seam the <c>TeslaReauthBanner</c> binds through (P1/S8) — the native analogue of the
/// document-level events the web banner subscribes to (<c>teslasync:tesla-auth-expired</c> /
/// <c>teslasync:tesla-auth-recovered</c>, web/src/components/feedback/TeslaReauthBanner.tsx L41-55) plus the
/// best-effort mutation replay queue it drains on recovery (web/src/lib/teslaAuthRecovery.ts). A Tesla refresh
/// token has a hard 8-week TTL; when it expires every Tesla-backed call starts returning 401 with
/// <c>TESLA_TOKEN_EXPIRED</c> and the resilient transport raises <see cref="Expired"/>, and when the user
/// re-authorizes the Tesla-account UI raises <see cref="Recovered"/>. The view never listens to the transport
/// itself — it binds to this seam, shows the banner on <see cref="Expired"/>, and on <see cref="Recovered"/> hides
/// the banner and replays any commands queued during the disconnected window via
/// <see cref="DrainQueuedMutationsAsync"/>. <see cref="IsExpired"/> lets a banner mounted after an expiry already
/// happened still surface (the durable native analogue of a missed DOM event). The production binding is
/// <see cref="TeslaAuthRecoveryHub"/>, which the composition root drives from the transport's 401 handler and the
/// re-auth success path.
/// </summary>
public interface ITeslaAuthRecoverySource
{
    /// <summary>True while the Tesla refresh token is known to be expired (the banner's current render gate).</summary>
    bool IsExpired { get; }

    /// <summary>Raised when the Tesla token expires (web <c>teslasync:tesla-auth-expired</c>); may fire from a background thread.</summary>
    event EventHandler? Expired;

    /// <summary>Raised when the user re-authorizes (web <c>teslasync:tesla-auth-recovered</c>); may fire from a background thread.</summary>
    event EventHandler? Recovered;

    /// <summary>
    /// Replay the mutations queued during the disconnected window, in FIFO order (web
    /// <c>drainQueuedTeslaMutations()</c>, teslaAuthRecovery.ts L61-73). Best-effort and idempotent: replay
    /// failures are swallowed (each mutation surfaces its own failure through its normal error path) and draining
    /// an empty queue is a no-op.
    /// </summary>
    /// <param name="cancellationToken">Cancels the in-flight replay.</param>
    ValueTask DrainQueuedMutationsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A bounded, best-effort FIFO replay queue for Tesla-bound mutations that failed because the user's third-party
/// Tesla refresh token expired — the faithful native port of web/src/lib/teslaAuthRecovery.ts. When a Tesla-bound
/// command fails with a token-expired error, the calling code <see cref="Queue"/>s a closure that re-issues the
/// original request; after the user reconnects, the banner calls <see cref="DrainAsync"/>, which replays each queued
/// closure still inside the TTL window. The constraints are intentional and match the web module exactly: a
/// <see cref="EntryTtl"/> of five minutes (older entries are dropped silently so a late reconnect does not fire
/// stale commands), a cap of <see cref="MaxEntries"/> (further attempts during the disconnected window are dropped
/// at queue-time), process-lifetime only (it lives in memory; a relaunch clears it), and swallowed replay errors
/// (the underlying command's own error path surfaces them again). Thread-safe and UI-free so it is unit-tested
/// without a UI host; the clock is injectable so the TTL is exercised deterministically.
/// </summary>
public sealed class TeslaAuthMutationBuffer
{
    /// <summary>Maximum number of pending mutations held during the disconnected window (web <c>TESLA_AUTH_QUEUE_MAX</c>).</summary>
    public const int MaxEntries = 10;

    /// <summary>Mutations older than this are dropped silently when the queue drains (web <c>TESLA_AUTH_QUEUE_TTL_MS</c>).</summary>
    public static readonly TimeSpan EntryTtl = TimeSpan.FromMinutes(5);

    private readonly object _gate = new();
    private readonly List<Entry> _entries = [];
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the queue over an optional clock (defaults to the system UTC clock; overridable for tests).</summary>
    /// <param name="clock">The "now" source used to enforce <see cref="EntryTtl"/>.</param>
    public TeslaAuthMutationBuffer(Func<DateTimeOffset>? clock = null) =>
        _clock = clock ?? (static () => DateTimeOffset.UtcNow);

    /// <summary>The number of mutations currently queued (does not drain).</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _entries.Count;
            }
        }
    }

    /// <summary>
    /// Add a replay closure to the queue (web <c>queueTeslaMutation</c>, teslaAuthRecovery.ts L48-51). The closure
    /// should re-invoke the original mutation with the user's original arguments. Drops the entry silently when the
    /// queue is already at <see cref="MaxEntries"/> — the user has already seen visible error feedback for the
    /// original failure, so a "queue full" notice on top would be noise.
    /// </summary>
    /// <param name="replay">The closure that re-issues the failed mutation.</param>
    public void Add(Func<CancellationToken, Task> replay)
    {
        ArgumentNullException.ThrowIfNull(replay);

        lock (_gate)
        {
            if (_entries.Count >= MaxEntries)
            {
                return;
            }

            _entries.Add(new Entry(_clock(), replay));
        }
    }

    /// <summary>
    /// Replay every queued mutation that is still within <see cref="EntryTtl"/>, in FIFO order (web
    /// <c>drainQueuedTeslaMutations</c>, teslaAuthRecovery.ts L61-73). The queue is snapshotted and cleared up front
    /// (so <see cref="Count"/> drops to zero immediately, exactly like the web <c>splice</c>), expired entries are
    /// discarded, and each replay's failure is swallowed because the underlying mutation surfaces it through its own
    /// error path. Idempotent — draining an empty queue is a no-op.
    /// </summary>
    /// <param name="cancellationToken">Passed to each replay closure; a cancelled replay is treated as a swallowed failure.</param>
    public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
    {
        Entry[] live;
        lock (_gate)
        {
            if (_entries.Count == 0)
            {
                return;
            }

            var now = _clock();
            var drained = _entries.ToArray();
            _entries.Clear();
            live = Array.FindAll(drained, entry => now - entry.EnqueuedAt <= EntryTtl);
        }

        foreach (var entry in live)
        {
            try
            {
                await entry.Replay(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Best-effort: the failed mutation surfaces through its own normal error path; the queue never
                // throws so a single bad replay cannot abort the rest of the drain.
            }
        }
    }

    /// <summary>Discard every queued mutation without replaying (used when the disconnected window is abandoned).</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _entries.Clear();
        }
    }

    private readonly record struct Entry(DateTimeOffset EnqueuedAt, Func<CancellationToken, Task> Replay);
}

/// <summary>
/// The in-process <see cref="ITeslaAuthRecoverySource"/> — the native analogue of the web <c>document</c> event
/// target plus the <c>teslaAuthRecovery</c> module (web/src/lib/teslaAuthRecovery.ts). It is both the production
/// binding the composition root drives (the resilient transport calls <see cref="NotifyExpired"/> when a Tesla call
/// returns 401 <c>TESLA_TOKEN_EXPIRED</c>; the Tesla-account UI calls <see cref="NotifyRecovered"/> when an auth
/// poll flips to authenticated or a manual refresh succeeds) and the headless / unit-test default. It tracks the
/// current <see cref="IsExpired"/> state, raises <see cref="Expired"/> / <see cref="Recovered"/> on every signal
/// (so a repeated 401 re-shows a dismissed banner, matching the web's per-event <c>setVisible(true)</c>), and owns
/// a <see cref="TeslaAuthMutationBuffer"/> that <see cref="QueueMutation"/> fills and
/// <see cref="DrainQueuedMutationsAsync"/> replays. Thread-safe.
/// </summary>
public sealed class TeslaAuthRecoveryHub : ITeslaAuthRecoverySource
{
    private readonly TeslaAuthMutationBuffer _buffer;
    private readonly object _gate = new();
    private bool _expired;

    /// <summary>Creates the hub over an optional replay queue (defaults to a fresh process-lifetime queue).</summary>
    /// <param name="queue">The mutation replay queue the recovery drain replays from.</param>
    public TeslaAuthRecoveryHub(TeslaAuthMutationBuffer? buffer = null) =>
        _buffer = buffer ?? new TeslaAuthMutationBuffer();

    /// <inheritdoc />
    public event EventHandler? Expired;

    /// <inheritdoc />
    public event EventHandler? Recovered;

    /// <inheritdoc />
    public bool IsExpired
    {
        get
        {
            lock (_gate)
            {
                return _expired;
            }
        }
    }

    /// <summary>The replay queue the recovery drain feeds from (exposed for hosting and tests).</summary>
    public TeslaAuthMutationBuffer Buffer => _buffer;

    /// <summary>
    /// Signal that the Tesla token has expired (web <c>document.dispatchEvent('teslasync:tesla-auth-expired')</c>
    /// from the resilient transport's 401 handler): flags <see cref="IsExpired"/> and raises <see cref="Expired"/>
    /// unconditionally, so a repeated 401 re-surfaces a banner the user previously dismissed.
    /// </summary>
    public void NotifyExpired()
    {
        lock (_gate)
        {
            _expired = true;
        }

        Expired?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Signal that the user has re-authorized (web <c>notifyTeslaAuthRecovered()</c>, teslaAuthRecovery.ts L83-86):
    /// clears <see cref="IsExpired"/> and raises <see cref="Recovered"/> so the banner hides and the queued
    /// mutations are replayed.
    /// </summary>
    public void NotifyRecovered()
    {
        lock (_gate)
        {
            _expired = false;
        }

        Recovered?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Queue a mutation replay for the disconnected window (web <c>queueTeslaMutation</c>).</summary>
    /// <param name="replay">The closure that re-issues the failed mutation.</param>
    public void QueueMutation(Func<CancellationToken, Task> replay) => _buffer.Add(replay);

    /// <inheritdoc />
    public ValueTask DrainQueuedMutationsAsync(CancellationToken cancellationToken = default) =>
        _buffer.DrainAsync(cancellationToken);
}

/// <summary>
/// The navigation seam the <c>TeslaReauthBanner</c> "Reconnect" CTA invokes (P1/S8) — the native analogue of the
/// web <c>useNavigate()</c> hook and the <c>navigate('/tesla-account')</c> deep link
/// (web/src/components/feedback/TeslaReauthBanner.tsx L38, L59-61). The production binding is
/// <see cref="DelegateTeslaReauthNavigator"/> over the shell's navigation; <see cref="RecordingTeslaReauthNavigator"/>
/// stands in for headless hosts and unit tests. The view never navigates itself.
/// </summary>
public interface ITeslaReauthNavigator
{
    /// <summary>Deep-link to the Tesla-account page so the user can re-authorize (web <c>navigate('/tesla-account')</c>).</summary>
    void NavigateToTeslaAccount();
}

/// <summary>
/// The production <see cref="ITeslaReauthNavigator"/> — forwards the "Reconnect" CTA to a shell-supplied delegate
/// (the functional-options binding the composition root wires to the navigation frame). Keeps the seam WinUI-free
/// so it is unit-tested without a navigation host.
/// </summary>
public sealed class DelegateTeslaReauthNavigator : ITeslaReauthNavigator
{
    private readonly Action _navigateToTeslaAccount;

    /// <summary>Creates the navigator over the shell's Tesla-account navigation delegate.</summary>
    /// <param name="navigateToTeslaAccount">Invoked to deep-link to the Tesla-account page (web <c>navigate('/tesla-account')</c>).</param>
    public DelegateTeslaReauthNavigator(Action navigateToTeslaAccount)
    {
        ArgumentNullException.ThrowIfNull(navigateToTeslaAccount);
        _navigateToTeslaAccount = navigateToTeslaAccount;
    }

    /// <inheritdoc />
    public void NavigateToTeslaAccount() => _navigateToTeslaAccount();
}

/// <summary>
/// An <see cref="ITeslaReauthNavigator"/> that records each request instead of navigating — the headless /
/// unit-test default. It lets the view-model's CTA dispatch be asserted (how many times "Reconnect" was invoked)
/// without a navigation host, and is the safe no-op default when the designer / parameterless host has no
/// navigation wired.
/// </summary>
public sealed class RecordingTeslaReauthNavigator : ITeslaReauthNavigator
{
    /// <summary>The number of times "Reconnect" was invoked (web <c>navigate('/tesla-account')</c> calls).</summary>
    public int NavigateCount { get; private set; }

    /// <inheritdoc />
    public void NavigateToTeslaAccount() => NavigateCount++;
}
