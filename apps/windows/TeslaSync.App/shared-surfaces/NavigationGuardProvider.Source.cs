using System.Collections.Generic;
using System.Linq;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The guard-registry seam the <see cref="NavigationGuardProviderViewModel"/> owns (P1/S8) — the native
/// analogue of the web provider's <c>guards.current: Map&lt;string, NavigationGuardEntry&gt;</c>
/// (web/src/components/feedback/NavigationGuardProvider.tsx L82, L98-L110). A dirty-form consumer registers an
/// entry through the context (web <c>register</c>) and drops it by disposing the returned token (web's returned
/// unregister function); the provider scans for the first dirty guard with <see cref="FindDirty"/> (web
/// <c>findDirty</c>). The canonical implementation is <see cref="NavigationGuardRegistry"/>;
/// <see cref="NoOpNavigationGuardRegistry"/> stands in outside a provider. The view never scans the registry
/// directly — it binds through the view-model holder.
/// </summary>
public interface INavigationGuardRegistry
{
    /// <summary>
    /// Register (or replace) a dirty-state guard (web <c>register(entry)</c>): keyed by
    /// <see cref="NavigationGuardEntry.Id"/>, so re-registering the same id refreshes the entry in place.
    /// Returns a token whose <see cref="IDisposable.Dispose"/> unregisters it (the web returned unregister
    /// function, called from an effect cleanup).
    /// </summary>
    /// <param name="entry">The guard entry to register.</param>
    IDisposable Register(NavigationGuardEntry entry);

    /// <summary>
    /// Return the first registered guard reporting dirty, in registration order, or <c>null</c> when none is
    /// dirty (web <c>findDirty()</c>: <c>for (const e of guards.values()) if (e.isDirty()) return e</c>).
    /// </summary>
    NavigationGuardEntry? FindDirty();
}

/// <summary>
/// The canonical in-process navigation-guard registry — the native port of the single
/// <c>NavigationGuardProvider</c> the web app mounts once under its router in <c>main.tsx</c>. Like that single
/// provider it owns one live guard map; <see cref="Shared"/> exposes the process-wide instance so a form deep in
/// the tree and the one mounted provider coordinate through it. Guards are scanned in registration order (the
/// web <c>Map</c> insertion order), with re-registering the same id keeping its position (the web
/// <c>Map.set</c> on an existing key). Thread-safe because consumers register and unregister from effects that
/// may run off the UI thread, and the dirty scan snapshots before invoking any consumer callback so a callback
/// that re-enters the registry cannot deadlock.
/// </summary>
public sealed class NavigationGuardRegistry : INavigationGuardRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Registered> _guards = new(StringComparer.Ordinal);
    private long _sequence;

    /// <summary>
    /// The process-wide registry — the native analogue of the single router-level
    /// <c>NavigationGuardProvider</c>, so a dirty form and the mounted provider read one shared guard map.
    /// </summary>
    public static NavigationGuardRegistry Shared { get; } = new();

    /// <inheritdoc />
    public IDisposable Register(NavigationGuardEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        lock (_gate)
        {
            // web Map.set: a new id appends (fresh sequence); an existing id keeps its position (same sequence).
            long sequence = _guards.TryGetValue(entry.Id, out Registered existing)
                ? existing.Sequence
                : ++_sequence;
            _guards[entry.Id] = new Registered(sequence, entry);
        }

        return new GuardRegistrationToken(this, entry.Id);
    }

    /// <inheritdoc />
    public NavigationGuardEntry? FindDirty()
    {
        Registered[] snapshot;
        lock (_gate)
        {
            // Snapshot in registration order so a consumer's isDirty() callback runs OUTSIDE the lock (it may
            // re-enter the registry) yet the "first dirty" choice stays deterministic.
            snapshot = _guards.Values.OrderBy(static r => r.Sequence).ToArray();
        }

        foreach (Registered registered in snapshot)
        {
            if (registered.Entry.IsDirty())
            {
                return registered.Entry;
            }
        }

        return null;
    }

    private void Unregister(string id)
    {
        lock (_gate)
        {
            _guards.Remove(id);
        }
    }

    private readonly struct Registered(long sequence, NavigationGuardEntry entry)
    {
        public long Sequence { get; } = sequence;

        public NavigationGuardEntry Entry { get; } = entry;
    }

    private sealed class GuardRegistrationToken(NavigationGuardRegistry owner, string id) : IDisposable
    {
        private NavigationGuardRegistry? _owner = owner;

        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.Unregister(id);
    }
}

/// <summary>
/// The inert registry used outside a provider — the native analogue of the web hook resolving the no-op context
/// (<c>NOOP_CTX.register</c> returning an empty unregister function;
/// web/src/components/feedback/NavigationGuardProvider.tsx L58-L61). <see cref="Register"/> stores nothing and
/// returns an inert token, and <see cref="FindDirty"/> is always <c>null</c>, so a consumer that binds the seam
/// with no provider in scope degrades gracefully (navigation is never blocked) instead of throwing.
/// </summary>
public sealed class NoOpNavigationGuardRegistry : INavigationGuardRegistry
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpNavigationGuardRegistry Instance { get; } = new();

    private NoOpNavigationGuardRegistry()
    {
    }

    /// <inheritdoc />
    public IDisposable Register(NavigationGuardEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return NoOpDisposable.Instance;
    }

    /// <inheritdoc />
    public NavigationGuardEntry? FindDirty() => null;
}

/// <summary>
/// The "don't prompt again" persistence seam the surface confirms through (P1/S8) — the native analogue of the
/// web <c>lib/confirmSilence</c> module (<c>isSilenced</c> / <c>silence</c>;
/// web/src/components/ui/ConfirmDialog.tsx L6, L108, L142) the rendered <c>ConfirmDialog</c> reads and writes
/// for its <c>silenceKey="unsaved-navigation"</c>. <see cref="IsSilenced"/> short-circuits the confirm (it
/// auto-resolves to discard); <see cref="Silence"/> records the user's "Don't ask again" choice. The canonical
/// implementation is <see cref="InMemoryConfirmSilenceStore"/>.
/// </summary>
public interface IConfirmSilenceStore
{
    /// <summary>True when the user previously silenced <paramref name="key"/> (web <c>isSilenced(key)</c>).</summary>
    /// <param name="key">The silence action id (web <c>silenceKey</c>).</param>
    bool IsSilenced(string key);

    /// <summary>Record that the user silenced <paramref name="key"/> (web <c>silence(key)</c>).</summary>
    /// <param name="key">The silence action id (web <c>silenceKey</c>).</param>
    void Silence(string key);
}

/// <summary>
/// An in-memory <see cref="IConfirmSilenceStore"/> — a process-lifetime latch standing in for the web
/// per-browser <c>localStorage</c> silence set (a desktop app process is one "browser"). <see cref="Shared"/>
/// is the canonical instance the host uses so a "Don't ask again" choice holds for the rest of the app session;
/// a production host may layer a persisted settings store on top to carry the choice across launches. Tests
/// construct fresh instances. Thread-safe. This mirrors the shipped <c>DraftRestorePrompt</c> session guard,
/// which likewise stands in for a browser storage flag.
/// </summary>
public sealed class InMemoryConfirmSilenceStore : IConfirmSilenceStore
{
    private readonly object _gate = new();
    private readonly HashSet<string> _silenced = new(StringComparer.Ordinal);

    /// <summary>The process-wide silence store the host uses so a "Don't ask again" choice holds for the session.</summary>
    public static InMemoryConfirmSilenceStore Shared { get; } = new();

    /// <inheritdoc />
    public bool IsSilenced(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        lock (_gate)
        {
            return _silenced.Contains(key);
        }
    }

    /// <inheritdoc />
    public void Silence(string key)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        lock (_gate)
        {
            _silenced.Add(key);
        }
    }

    /// <summary>Clear every recorded silence (test / sign-out reset).</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _silenced.Clear();
        }
    }
}

/// <summary>
/// The back-navigation replay seam the provider dispatches through (P1/S8) — the native analogue of the web
/// provider's <c>navigate(-1)</c> (web/src/components/feedback/NavigationGuardProvider.tsx L167). When the user
/// confirms Discard for a back-navigation the provider intercepted, it asks the host to actually perform the
/// back navigation. The view never navigates the shell itself; it supplies a navigator, the host performs the
/// navigation, and tests record the call through a delegate.
/// </summary>
public interface INavigationGuardNavigator
{
    /// <summary>Perform the deferred back navigation (web <c>navigate(-1)</c>).</summary>
    void GoBack();
}

/// <summary>An <see cref="INavigationGuardNavigator"/> that does nothing — the default when no host back navigator is wired.</summary>
public sealed class NullNavigationGuardNavigator : INavigationGuardNavigator
{
    /// <summary>The shared inert instance.</summary>
    public static NullNavigationGuardNavigator Instance { get; } = new();

    private NullNavigationGuardNavigator()
    {
    }

    /// <inheritdoc />
    public void GoBack()
    {
        // No host navigator wired (e.g. a headless host or a window with no back stack); nothing to replay.
    }
}

/// <summary>
/// An <see cref="INavigationGuardNavigator"/> that forwards to a delegate — used by the WinUI view to bridge the
/// deferred back navigation into the shell's navigation service, and by headless tests to record the call.
/// </summary>
public sealed class DelegateNavigationGuardNavigator : INavigationGuardNavigator
{
    private readonly Action _goBack;

    /// <summary>Creates the navigator over the back-navigation action the host (or test) supplies.</summary>
    /// <param name="goBack">The action invoked to perform the deferred back navigation.</param>
    public DelegateNavigationGuardNavigator(Action goBack)
    {
        ArgumentNullException.ThrowIfNull(goBack);
        _goBack = goBack;
    }

    /// <inheritdoc />
    public void GoBack() => _goBack();
}

/// <summary>
/// Carries a single intercepted back-navigation request (the native analogue of a web <c>popstate</c> event;
/// web/src/components/feedback/NavigationGuardProvider.tsx L142-L178). Unlike the web <c>popstate</c>, which
/// fires <em>after</em> the browser has already navigated (forcing the web source to roll the URL back with
/// <c>history.pushState</c>), the native back request is raised <em>before</em> the shell navigates, so the
/// provider cancels it by setting <see cref="Handled"/> — the same user-visible result (the user stays on the
/// current page) reached without a rollback.
/// </summary>
public sealed class NavigationBackRequestedEventArgs : EventArgs
{
    /// <summary>
    /// Set to <c>true</c> by the provider to cancel the pending back navigation while it confirms (the native
    /// analogue of the web <c>history.pushState</c> rollback). Left <c>false</c> when no guard is dirty, so the
    /// back navigation proceeds.
    /// </summary>
    public bool Handled { get; set; }
}

/// <summary>
/// The back-navigation source the provider intercepts (P1/S8) — the native analogue of the web
/// <c>window.addEventListener('popstate', ...)</c> the provider subscribes
/// (web/src/components/feedback/NavigationGuardProvider.tsx L176). The production binding bridges the shell's
/// back affordance (title-bar back button, <c>Alt+Left</c>, mouse back); <see cref="NullNavigationBackSource"/>
/// (a host with no back affordance) and <see cref="InMemoryNavigationBackSource"/> (tests) stand in headlessly.
/// </summary>
public interface INavigationBackSource
{
    /// <summary>Raised when the user requests a back navigation (web <c>popstate</c>); the provider may cancel it via <see cref="NavigationBackRequestedEventArgs.Handled"/>.</summary>
    event EventHandler<NavigationBackRequestedEventArgs>? BackRequested;
}

/// <summary>An <see cref="INavigationBackSource"/> that never raises — the headless default for a host with no back affordance.</summary>
public sealed class NullNavigationBackSource : INavigationBackSource
{
    /// <summary>The shared inert instance.</summary>
    public static NullNavigationBackSource Instance { get; } = new();

    private NullNavigationBackSource()
    {
    }

    /// <inheritdoc />
    public event EventHandler<NavigationBackRequestedEventArgs>? BackRequested
    {
        add { /* no back affordance — never raised */ }
        remove { /* no back affordance — never raised */ }
    }
}

/// <summary>
/// An <see cref="INavigationBackSource"/> driven explicitly by <see cref="RequestBack"/> — the headless /
/// unit-test default that simulates the user pressing the shell's back affordance (the native analogue of the
/// web test dispatching a <c>popstate</c> event), returning whether the provider cancelled it.
/// </summary>
public sealed class InMemoryNavigationBackSource : INavigationBackSource
{
    /// <inheritdoc />
    public event EventHandler<NavigationBackRequestedEventArgs>? BackRequested;

    /// <summary>
    /// Raise a back-navigation request (web dispatch of <c>popstate</c>) and return <c>true</c> when a
    /// subscriber cancelled it (set <see cref="NavigationBackRequestedEventArgs.Handled"/>), <c>false</c> when
    /// the back navigation is allowed to proceed.
    /// </summary>
    public bool RequestBack()
    {
        var args = new NavigationBackRequestedEventArgs();
        BackRequested?.Invoke(this, args);
        return args.Handled;
    }
}

/// <summary>
/// The navigation-guard context value a consumer resolves from the nearest provider (P1/S8) — the native port of
/// the web <c>NavigationGuardContextValue</c> (web/src/components/feedback/NavigationGuardProvider.tsx L31-L47)
/// that <c>useNavigationGuardContext()</c> returns. It is the channel between a dirty form and the mounted
/// provider: the form registers a guard with <see cref="RegisterGuard"/> (web <c>register</c>) and a navigation
/// initiator awaits <see cref="ConfirmIfDirtyAsync"/> (web <c>confirmIfDirty</c>) before navigating. The
/// view-model implements this; <see cref="NoOpNavigationGuardController"/> is the fallback returned when no
/// provider is mounted (web <c>NOOP_CTX</c>).
/// </summary>
public interface INavigationGuardController
{
    /// <summary>
    /// Register a dirty-state guard and return a token whose <see cref="IDisposable.Dispose"/> unregisters it
    /// (web <c>register(entry)</c>, returning the unregister function).
    /// </summary>
    /// <param name="entry">The guard entry to register.</param>
    IDisposable RegisterGuard(NavigationGuardEntry entry);

    /// <summary>
    /// Resolve immediately to <c>true</c> when no guard is dirty (or the action was previously silenced);
    /// otherwise show the confirm dialog and resolve to the user's choice — <c>true</c> for Discard /navigate,
    /// <c>false</c> for Keep editing /cancel (web <c>confirmIfDirty(): Promise&lt;boolean&gt;</c>). A confirm
    /// already in flight is reused, so a racing caller awaits the same dialog instead of stacking a second one.
    /// </summary>
    Task<bool> ConfirmIfDirtyAsync();
}

/// <summary>
/// The inert controller returned when no <c>NavigationGuardProvider</c> is in scope — the native port of the web
/// <c>NOOP_CTX</c> (web/src/components/feedback/NavigationGuardProvider.tsx L58-L61), which lets a
/// guard-registering consumer render in isolation (a component test, a detached host) without forcing the whole
/// provider tree. <see cref="RegisterGuard"/> returns an inert token and <see cref="ConfirmIfDirtyAsync"/>
/// always allows navigation, so navigation is never blocked without a provider.
/// </summary>
public sealed class NoOpNavigationGuardController : INavigationGuardController
{
    /// <summary>The shared inert instance (web <c>NOOP_CTX</c>).</summary>
    public static NoOpNavigationGuardController Instance { get; } = new();

    private NoOpNavigationGuardController()
    {
    }

    /// <inheritdoc />
    public IDisposable RegisterGuard(NavigationGuardEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return NoOpDisposable.Instance;
    }

    /// <inheritdoc />
    public Task<bool> ConfirmIfDirtyAsync() => Task.FromResult(true);
}

/// <summary>A shared no-op <see cref="IDisposable"/> — the inert unregister token returned by the no-op seams (web <c>() =&gt; {}</c>).</summary>
internal sealed class NoOpDisposable : IDisposable
{
    public static NoOpDisposable Instance { get; } = new();

    private NoOpDisposable()
    {
    }

    public void Dispose()
    {
        // Intentionally inert — the no-op seams hand this back as the unregister token.
    }
}
