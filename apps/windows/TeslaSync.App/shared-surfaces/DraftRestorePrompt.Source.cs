using System.Collections.Generic;
using System.Linq;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The draft-index seam the <see cref="DraftRestorePromptViewModel"/> binds through (P1/S8) — the native
/// analogue of the web <c>lib/draftIndex</c> functions the component composes
/// (web/src/components/feedback/DraftRestorePrompt.tsx imports <c>getDrafts</c>, <c>discardDraftEnvelope</c>,
/// <c>subscribeDraftIndex</c>). It exposes the recoverable drafts newest-first (web <c>getDrafts()</c>), a
/// discard mutation that removes both the envelope and the index entry (web <c>discardDraftEnvelope</c>), and a
/// change signal so an open review modal prunes live when a sibling window discards a draft (web
/// <c>subscribeDraftIndex</c>). The view never reads the store directly; the canonical
/// <see cref="InMemoryDraftStore"/> (or a test fake) drives this.
/// </summary>
public interface IDraftStore
{
    /// <summary>Raised whenever the draft index changes (the web <c>subscribeDraftIndex</c> signal); may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>The recoverable drafts, newest-first (the web <c>getDrafts()</c> snapshot, sorted most-recent first).</summary>
    IReadOnlyList<DraftEntry> GetDrafts();

    /// <summary>
    /// Remove both the underlying envelope and the index entry for <paramref name="storageKey"/> (web
    /// <c>discardDraftEnvelope</c>) and raise <see cref="Changed"/>. A no-op when the key is unknown.
    /// </summary>
    void DiscardDraft(string storageKey);
}

/// <summary>
/// An observable in-memory <see cref="IDraftStore"/> — the headless / unit-test default and the canonical
/// process-wide store the WinUI host registers recoverable drafts into. It models the web <c>localStorage</c>
/// draft index: entries keyed by <see cref="DraftEntry.StorageKey"/>, returned newest-first by
/// <see cref="DraftEntry.SavedAt"/> (web <c>getDrafts()</c> sort), with <see cref="Register"/> /
/// <see cref="DiscardDraft"/> raising <see cref="Changed"/> so every bound surface refreshes (the web same-tab
/// change event). Thread-safe for the register/discard/read mutations.
/// </summary>
public sealed class InMemoryDraftStore : IDraftStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, DraftEntry> _drafts = new(StringComparer.Ordinal);

    /// <summary>
    /// The process-wide draft store the host registers recoverable work into, so the global recovery prompt and
    /// any other consumer observe one shared, live index (the native analogue of the web module-level
    /// <c>localStorage</c> index).
    /// </summary>
    public static InMemoryDraftStore Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<DraftEntry> GetDrafts()
    {
        lock (_gate)
        {
            // web getDrafts(): Object.values(...).sort((a, b) => b.savedAt - a.savedAt) — most-recent first.
            return _drafts.Values
                .OrderByDescending(d => d.SavedAt)
                .ThenBy(d => d.StorageKey, StringComparer.Ordinal)
                .ToArray();
        }
    }

    /// <summary>
    /// Register (or refresh) a recoverable draft (web <c>registerDraft</c>): keyed by
    /// <see cref="DraftEntry.StorageKey"/>, so re-registering simply refreshes the entry. Raises
    /// <see cref="Changed"/>.
    /// </summary>
    public void Register(DraftEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        lock (_gate)
        {
            _drafts[entry.StorageKey] = entry;
        }

        RaiseChanged();
    }

    /// <inheritdoc />
    public void DiscardDraft(string storageKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(storageKey);
        bool removed;
        lock (_gate)
        {
            removed = _drafts.Remove(storageKey);
        }

        if (removed)
        {
            RaiseChanged();
        }
    }

    /// <summary>Remove every draft (test / sign-out reset) and raise <see cref="Changed"/> when anything was cleared.</summary>
    public void Clear()
    {
        bool any;
        lock (_gate)
        {
            any = _drafts.Count > 0;
            _drafts.Clear();
        }

        if (any)
        {
            RaiseChanged();
        }
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// Whether a cross-window draft-presence event announces a peer <b>acquiring</b> a draft (it is being edited
/// elsewhere right now) or <b>releasing</b> it — the native port of the web <c>formDraft.acquired</c> vs
/// <c>formDraft.released</c> / <c>formDraft.committed</c> broadcast messages
/// (web/src/lib/broadcast.ts L74-L76) the prompt collects during its grace period.
/// </summary>
public enum DraftPresenceKind
{
    /// <summary>A peer window announced it is actively editing the draft now (web <c>formDraft.acquired</c>).</summary>
    Acquired,

    /// <summary>A peer window released / committed the draft (web <c>formDraft.released</c> / <c>formDraft.committed</c>).</summary>
    Released,
}

/// <summary>Carries a single cross-window draft-presence change (web broadcast message) for <see cref="IDraftPresenceSource.PresenceChanged"/>.</summary>
public sealed class DraftPresenceEventArgs(string storageKey, DraftPresenceKind kind) : EventArgs
{
    /// <summary>The affected draft's storage key (web <c>draftKey</c>).</summary>
    public string StorageKey { get; } = storageKey;

    /// <summary>Whether the peer acquired or released the draft (web <c>formDraft.acquired</c> vs <c>released</c>).</summary>
    public DraftPresenceKind Kind { get; } = kind;
}

/// <summary>
/// The cross-window draft-presence seam the prompt binds through (P1/S8) — the native analogue of the web
/// broadcast subscription the component opens during its grace period
/// (web/src/components/feedback/DraftRestorePrompt.tsx L94-L102 over <c>lib/broadcast.subscribe</c>). It
/// delivers only peer-window events (the web bus filters self-messages by <c>TAB_ID</c> before they reach the
/// prompt), letting the view-model suppress drafts that are being actively edited in another window right now.
/// The production binding bridges the platform's cross-window channel; <see cref="NullDraftPresenceSource"/> (a
/// single-window host with no peers) and <see cref="InMemoryDraftPresenceSource"/> (tests) stand in headlessly.
/// </summary>
public interface IDraftPresenceSource
{
    /// <summary>Raised when a peer window acquires or releases a draft (web peer <c>formDraft.*</c> broadcast); may be raised from a background thread.</summary>
    event EventHandler<DraftPresenceEventArgs>? PresenceChanged;
}

/// <summary>
/// An <see cref="IDraftPresenceSource"/> that never raises — the headless default for a single-window host with
/// no peers (the common desktop case), where every surfaced draft is owned by this process. Mirrors the web
/// path where no sibling tab is open, so the prompt surfaces every recoverable draft.
/// </summary>
public sealed class NullDraftPresenceSource : IDraftPresenceSource
{
    /// <summary>The shared inert instance.</summary>
    public static NullDraftPresenceSource Instance { get; } = new();

    private NullDraftPresenceSource()
    {
    }

    /// <inheritdoc />
    public event EventHandler<DraftPresenceEventArgs>? PresenceChanged
    {
        add { /* no peers — never raised */ }
        remove { /* no peers — never raised */ }
    }
}

/// <summary>
/// An <see cref="IDraftPresenceSource"/> driven explicitly by <see cref="Acquire"/> / <see cref="Release"/> — the
/// headless / unit-test default that simulates a peer window editing (or releasing) a draft, so the prompt's
/// grace-period suppression logic is exercised without a real cross-window channel (the native analogue of the
/// web test's <c>broadcastFromSiblingTab</c>).
/// </summary>
public sealed class InMemoryDraftPresenceSource : IDraftPresenceSource
{
    /// <inheritdoc />
    public event EventHandler<DraftPresenceEventArgs>? PresenceChanged;

    /// <summary>Announce that a peer window is editing <paramref name="storageKey"/> now (web peer <c>formDraft.acquired</c>).</summary>
    public void Acquire(string storageKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(storageKey);
        PresenceChanged?.Invoke(this, new DraftPresenceEventArgs(storageKey, DraftPresenceKind.Acquired));
    }

    /// <summary>Announce that a peer window released <paramref name="storageKey"/> (web peer <c>formDraft.released</c> / <c>formDraft.committed</c>).</summary>
    public void Release(string storageKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(storageKey);
        PresenceChanged?.Invoke(this, new DraftPresenceEventArgs(storageKey, DraftPresenceKind.Released));
    }
}

/// <summary>
/// The one-shot session guard the prompt binds through (P1/S8) — the native analogue of the web
/// <c>sessionStorage</c> flag (<c>teslasync:draft-prompt-shown:v1</c>) that suppresses re-prompting for the rest
/// of a session (web/src/components/feedback/DraftRestorePrompt.tsx L40-L58). A hard relaunch (new session)
/// re-prompts. The production binding persists for the app session; <see cref="InMemoryDraftPromptSessionGuard"/>
/// stands in headlessly.
/// </summary>
public interface IDraftPromptSessionGuard
{
    /// <summary>True once the prompt has been dismissed this session (web <c>readDismissed()</c>).</summary>
    bool IsDismissed { get; }

    /// <summary>Mark the prompt dismissed for the rest of the session (web <c>writeDismissed()</c>).</summary>
    void MarkDismissed();
}

/// <summary>
/// An in-memory <see cref="IDraftPromptSessionGuard"/> — a process-lifetime latch standing in for the web
/// per-session <c>sessionStorage</c> flag (a desktop app process is one "session"). <see cref="Shared"/> is the
/// canonical instance the host uses so the prompt is one-shot per launch; tests construct fresh instances (and
/// the view-model also offers a skip seam for the production test seam the web exposes via
/// <c>skipSessionGuard</c>).
/// </summary>
public sealed class InMemoryDraftPromptSessionGuard : IDraftPromptSessionGuard
{
    private int _dismissed;

    /// <summary>The process-wide one-shot guard (one prompt per app session).</summary>
    public static InMemoryDraftPromptSessionGuard Shared { get; } = new();

    /// <inheritdoc />
    public bool IsDismissed => Volatile.Read(ref _dismissed) != 0;

    /// <inheritdoc />
    public void MarkDismissed() => Volatile.Write(ref _dismissed, 1);
}

/// <summary>
/// The navigation seam the prompt's Resume action dispatches through (P1/S8) — the native analogue of the web
/// <c>useNavigate()</c> the component calls with <c>entry.route</c>
/// (web/src/components/feedback/DraftRestorePrompt.tsx L152-L169). The view never navigates the shell itself; it
/// supplies a navigator that raises its <c>NavigationRequested</c> event, the host performs the navigation, and
/// tests record the requested route through <see cref="DelegateDraftRestoreNavigator"/>.
/// </summary>
public interface IDraftRestoreNavigator
{
    /// <summary>Navigate to the draft's in-app <paramref name="route"/> (web <c>navigate(entry.route)</c>).</summary>
    void Navigate(string route);
}

/// <summary>
/// An <see cref="IDraftRestoreNavigator"/> that forwards to a delegate — used by the WinUI view to bridge Resume
/// into its <c>NavigationRequested</c> event, and by headless tests to record the requested route.
/// </summary>
public sealed class DelegateDraftRestoreNavigator : IDraftRestoreNavigator
{
    private readonly Action<string> _navigate;

    /// <summary>Creates the navigator over the route sink the host (or test) supplies.</summary>
    public DelegateDraftRestoreNavigator(Action<string> navigate)
    {
        ArgumentNullException.ThrowIfNull(navigate);
        _navigate = navigate;
    }

    /// <inheritdoc />
    public void Navigate(string route)
    {
        ArgumentException.ThrowIfNullOrEmpty(route);
        _navigate(route);
    }
}
