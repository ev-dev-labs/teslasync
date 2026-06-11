using System.Threading;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The keyboard-shortcut registry — the native port of the web external store in
/// web/src/hooks/useShortcutRegistry.ts (<c>registerShortcut</c> / <c>unregisterShortcut</c> /
/// <c>useAllShortcuts</c>). Any view can declare its hotkeys here and have them appear in the cheatsheet
/// automatically; the cheatsheet reads the union via <see cref="Snapshot"/> and re-projects on
/// <see cref="Changed"/>. This is the P1/S8 state-holder seam for the surface — the view binds to it and never
/// reaches for a global itself.
/// </summary>
public interface IShortcutRegistry
{
    /// <summary>Raised after any register / unregister / reset mutates the snapshot (web store <c>emit</c>).</summary>
    event EventHandler? Changed;

    /// <summary>
    /// The current registered entries in registration order, last-writer-wins by id (web <c>getSnapshot</c>,
    /// <c>useAllShortcuts</c>). Referentially stable between mutations.
    /// </summary>
    IReadOnlyList<ShortcutDefinition> Snapshot { get; }

    /// <summary>Register (or replace by id) a definition (web <c>registerShortcut</c>).</summary>
    void Register(ShortcutDefinition definition);

    /// <summary>Remove a definition by id; returns whether it existed (web <c>unregisterShortcut</c>).</summary>
    bool Unregister(string id);

    /// <summary>Wipe every entry (web <c>_resetShortcutRegistry</c>). Test/seed helper.</summary>
    void Reset();
}

/// <summary>
/// Thread-safe, insertion-ordered <see cref="IShortcutRegistry"/>. Mirrors the web store's <c>Map</c> semantics:
/// registering an existing id replaces its value but keeps its original position, so the cached snapshot reads in
/// a stable registration order. Mutations rebuild the snapshot under a lock; <see cref="Changed"/> is raised
/// outside the lock so handlers can re-read <see cref="Snapshot"/> without re-entrancy risk.
/// </summary>
public sealed class ShortcutRegistry : IShortcutRegistry
{
    private readonly object _gate = new();
    private readonly Dictionary<string, ShortcutDefinition> _entries = new(StringComparer.Ordinal);
    private readonly List<string> _order = new();
    private IReadOnlyList<ShortcutDefinition> _snapshot = Array.Empty<ShortcutDefinition>();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<ShortcutDefinition> Snapshot => Volatile.Read(ref _snapshot);

    /// <inheritdoc />
    public void Register(ShortcutDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        if (string.IsNullOrEmpty(definition.Id))
        {
            throw new ArgumentException("Shortcut definition requires a non-empty id.", nameof(definition));
        }

        lock (_gate)
        {
            if (!_entries.ContainsKey(definition.Id))
            {
                _order.Add(definition.Id);
            }

            _entries[definition.Id] = definition;
            RebuildSnapshot();
        }

        RaiseChanged();
    }

    /// <inheritdoc />
    public bool Unregister(string id)
    {
        if (string.IsNullOrEmpty(id))
        {
            return false;
        }

        bool removed;
        lock (_gate)
        {
            removed = _entries.Remove(id);
            if (removed)
            {
                _order.Remove(id);
                RebuildSnapshot();
            }
        }

        if (removed)
        {
            RaiseChanged();
        }

        return removed;
    }

    /// <inheritdoc />
    public void Reset()
    {
        lock (_gate)
        {
            if (_entries.Count == 0)
            {
                return;
            }

            _entries.Clear();
            _order.Clear();
            _snapshot = Array.Empty<ShortcutDefinition>();
        }

        RaiseChanged();
    }

    private void RebuildSnapshot()
    {
        var next = new ShortcutDefinition[_order.Count];
        for (int i = 0; i < _order.Count; i++)
        {
            next[i] = _entries[_order[i]];
        }

        Volatile.Write(ref _snapshot, next);
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// The current navigation route the cheatsheet filters against — the native port of the web <c>useLocation</c>
/// pathname. <see cref="Changed"/> fires when the route changes so the "This page" filter re-projects live.
/// </summary>
public interface IRouteContext
{
    /// <summary>Raised when <see cref="CurrentPath"/> changes (web location change).</summary>
    event EventHandler? Changed;

    /// <summary>The current route pathname (e.g. <c>/charging</c>); never null.</summary>
    string CurrentPath { get; }
}

/// <summary>
/// A mutable <see cref="IRouteContext"/> the navigation shell drives (and tests set directly). Defaults to
/// <c>"/"</c>. Setting an unchanged path is a no-op; a real change raises <see cref="IRouteContext.Changed"/>.
/// </summary>
public sealed class StaticRouteContext : IRouteContext
{
    private string _currentPath;

    /// <summary>Creates the context at <paramref name="initialPath"/> (default <c>"/"</c>).</summary>
    public StaticRouteContext(string initialPath = "/") =>
        _currentPath = string.IsNullOrEmpty(initialPath) ? "/" : initialPath;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string CurrentPath => _currentPath;

    /// <summary>Update the current route, raising <see cref="Changed"/> when it actually changes.</summary>
    public void Navigate(string path)
    {
        string next = string.IsNullOrEmpty(path) ? "/" : path;
        if (string.Equals(next, _currentPath, StringComparison.Ordinal))
        {
            return;
        }

        _currentPath = next;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// Persisted cheatsheet filter selection — the native port of the web <c>sessionStorage</c> read/write
/// (<c>readStoredFilter</c> / <c>writeStoredFilter</c>). The web deliberately uses session (not local) storage so
/// <see cref="ShortcutFilterMode.All"/> stays the long-term default; a concrete app store should be session/tab
/// scoped to match.
/// </summary>
public interface IShortcutFilterStore
{
    /// <summary>Read the persisted mode, defaulting to <see cref="ShortcutFilterMode.All"/>.</summary>
    ShortcutFilterMode Read();

    /// <summary>Persist <paramref name="mode"/> for the session.</summary>
    void Write(ShortcutFilterMode mode);
}

/// <summary>
/// In-memory <see cref="IShortcutFilterStore"/> — the headless/test default (and a safe fallback when no
/// session-scoped store is supplied). Starts at <see cref="ShortcutFilterMode.All"/>.
/// </summary>
public sealed class InMemoryShortcutFilterStore : IShortcutFilterStore
{
    private ShortcutFilterMode _mode = ShortcutFilterMode.All;

    /// <inheritdoc />
    public ShortcutFilterMode Read() => _mode;

    /// <inheritdoc />
    public void Write(ShortcutFilterMode mode) => _mode = mode;
}

/// <summary>
/// Token helpers bridging <see cref="ShortcutFilterMode"/> and the web string tokens (<c>"all"</c> /
/// <c>"global"</c> / <c>"page"</c>) used both as the filter-pill values and the persisted form.
/// </summary>
public static class ShortcutFilterModes
{
    /// <summary>The web <c>FILTER_STORAGE_KEY</c> — kept verbatim for cross-platform session parity.</summary>
    public const string SessionStorageKey = "teslasync:shortcuts:filter:v1";

    /// <summary>The stable token for <paramref name="mode"/> (web <c>'all' | 'global' | 'page'</c>).</summary>
    public static string Token(ShortcutFilterMode mode) => mode switch
    {
        ShortcutFilterMode.Global => "global",
        ShortcutFilterMode.Page => "page",
        _ => "all",
    };

    /// <summary>Parse a persisted/selected token back to a mode, defaulting to <see cref="ShortcutFilterMode.All"/>.</summary>
    public static ShortcutFilterMode Parse(string? token) => token switch
    {
        "global" => ShortcutFilterMode.Global,
        "page" => ShortcutFilterMode.Page,
        _ => ShortcutFilterMode.All,
    };
}
