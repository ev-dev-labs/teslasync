using TeslaSync.App.Core.Navigation;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The current-location seam the shell binds through (P1/S8) — the native analogue of the web
/// <c>useLocation()</c> hook the <c>Layout</c> reads (web/src/components/layout/Layout.tsx L661). It exposes the
/// current route path (in canonical <see cref="RouteTable"/> form, no leading slash, <see cref="string.Empty"/> for
/// the dashboard root) and raises <see cref="Changed"/> on every navigation so the shell re-resolves the active
/// section/item, expands the active section and tracks the recent-page list. The view never reads navigation state
/// directly; the composition root binds this to the shared <see cref="NavigationHistory"/> and a test uses
/// <see cref="StaticLayoutLocation"/>.
/// </summary>
public interface ILayoutLocation
{
    /// <summary>The current route path, normalized (web <c>location.pathname</c> without the leading slash).</summary>
    string CurrentPath { get; }

    /// <summary>Raised whenever <see cref="CurrentPath"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ILayoutLocation"/> with an explicit, caller-set path — the headless / unit-test default and the safe
/// default an unbound shell binds to. The composition root's navigation state holder (or a test) calls
/// <see cref="Set"/> as the route changes, which raises <see cref="Changed"/> so the shell reprojects.
/// </summary>
public sealed class StaticLayoutLocation : ILayoutLocation
{
    private string _currentPath;

    /// <summary>Creates a location starting at the dashboard root (<see cref="string.Empty"/>).</summary>
    public StaticLayoutLocation()
        : this(string.Empty)
    {
    }

    /// <summary>Creates a location starting at <paramref name="currentPath"/> (normalized).</summary>
    public StaticLayoutLocation(string currentPath)
    {
        ArgumentNullException.ThrowIfNull(currentPath);
        _currentPath = LayoutNavCatalog.Normalize(currentPath);
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string CurrentPath => _currentPath;

    /// <summary>Move to <paramref name="path"/> (normalized) and raise <see cref="Changed"/> when it differs.</summary>
    public void Set(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        string next = LayoutNavCatalog.Normalize(path);
        if (string.Equals(next, _currentPath, StringComparison.Ordinal))
        {
            return;
        }

        _currentPath = next;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The per-device, client-only shell preferences seam (P1/S8) — the native analogue of the web localStorage hooks the
/// <c>Layout</c> reads: <c>useSidebarStyle()</c>, <c>useStatusBarPrefs()</c> and the pinned / recent / expanded
/// section state persisted under the <c>teslasync-*-nav-*</c> keys (web/src/components/layout/Layout.tsx
/// L632-L660, L912-L943). <see cref="SidebarStyle"/> and <see cref="StatusBarEnabled"/> are owned by the Appearance
/// settings surface and read-only here; the pinned / recent / expanded collections are owned by the shell and written
/// back through the <c>Set*</c> methods. <see cref="Changed"/> fires on any change (including an external
/// sidebar-style change made in Settings) so the shell reprojects. The app wires a durable
/// <c>ApplicationData.LocalSettings</c>-backed implementation in the view file; tests use
/// <see cref="InMemoryLayoutPreferences"/>.
/// </summary>
public interface ILayoutPreferences
{
    /// <summary>The sidebar layout (web <c>useSidebarStyle()</c>; default <see cref="SidebarStyleChoice.Linear"/>).</summary>
    SidebarStyleChoice SidebarStyle { get; }

    /// <summary>Whether the footer status bar is shown (web <c>useStatusBarPrefs().enabled</c>; default true).</summary>
    bool StatusBarEnabled { get; }

    /// <summary>The pinned route paths, newest-first (web <c>pinnedNavPaths</c>).</summary>
    IReadOnlyList<string> PinnedPaths { get; }

    /// <summary>The recently-used route paths, newest-first (web <c>recentNavPaths</c>).</summary>
    IReadOnlyList<string> RecentPaths { get; }

    /// <summary>The expanded section groups (web <c>expandedSections</c>).</summary>
    IReadOnlyList<RouteGroup> ExpandedGroups { get; }

    /// <summary>Raised whenever any preference changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Persist the pinned route paths (web <c>setPinnedNavPaths</c> + localStorage write).</summary>
    void SetPinnedPaths(IReadOnlyList<string> paths);

    /// <summary>Persist the recently-used route paths (web <c>setRecentNavPaths</c> + localStorage write).</summary>
    void SetRecentPaths(IReadOnlyList<string> paths);

    /// <summary>Persist the expanded section groups (web <c>setExpandedSections</c> + localStorage write).</summary>
    void SetExpandedGroups(IReadOnlyList<RouteGroup> groups);
}

/// <summary>
/// An in-memory <see cref="ILayoutPreferences"/> for unit tests (and the headless fallback). It is non-durable; the
/// real app binds the LocalSettings-backed store. It seeds the web first-run defaults
/// (<see cref="LayoutNavCatalog.DefaultPinnedPaths"/>, <see cref="LayoutNavCatalog.DefaultExpandedGroups"/>, a Linear
/// sidebar and a shown status bar), copies every collection defensively on read and write, and raises
/// <see cref="Changed"/> on each mutation.
/// </summary>
public sealed class InMemoryLayoutPreferences : ILayoutPreferences
{
    private readonly object _gate = new();
    private SidebarStyleChoice _sidebarStyle;
    private bool _statusBarEnabled;
    private string[] _pinned;
    private string[] _recent;
    private RouteGroup[] _expanded;

    /// <summary>Creates the store seeded with the web first-run defaults.</summary>
    public InMemoryLayoutPreferences()
        : this(SidebarStyleChoice.Linear, statusBarEnabled: true, pinned: null, recent: null, expanded: null)
    {
    }

    /// <summary>Creates the store with explicit seed values (any <see langword="null"/> collection uses the default).</summary>
    public InMemoryLayoutPreferences(
        SidebarStyleChoice sidebarStyle,
        bool statusBarEnabled,
        IReadOnlyList<string>? pinned,
        IReadOnlyList<string>? recent,
        IReadOnlyList<RouteGroup>? expanded)
    {
        _sidebarStyle = sidebarStyle;
        _statusBarEnabled = statusBarEnabled;
        _pinned = (pinned ?? LayoutNavCatalog.DefaultPinnedPaths).ToArray();
        _recent = (recent ?? Array.Empty<string>()).ToArray();
        _expanded = (expanded ?? LayoutNavCatalog.DefaultExpandedGroups).ToArray();
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>Number of times any <c>Set*</c> mutator has run (for persistence assertions).</summary>
    public int SaveCount { get; private set; }

    /// <inheritdoc />
    public SidebarStyleChoice SidebarStyle
    {
        get
        {
            lock (_gate)
            {
                return _sidebarStyle;
            }
        }
    }

    /// <inheritdoc />
    public bool StatusBarEnabled
    {
        get
        {
            lock (_gate)
            {
                return _statusBarEnabled;
            }
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> PinnedPaths
    {
        get
        {
            lock (_gate)
            {
                return (string[])_pinned.Clone();
            }
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> RecentPaths
    {
        get
        {
            lock (_gate)
            {
                return (string[])_recent.Clone();
            }
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<RouteGroup> ExpandedGroups
    {
        get
        {
            lock (_gate)
            {
                return (RouteGroup[])_expanded.Clone();
            }
        }
    }

    /// <inheritdoc />
    public void SetPinnedPaths(IReadOnlyList<string> paths)
    {
        ArgumentNullException.ThrowIfNull(paths);
        lock (_gate)
        {
            _pinned = paths.ToArray();
            SaveCount++;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void SetRecentPaths(IReadOnlyList<string> paths)
    {
        ArgumentNullException.ThrowIfNull(paths);
        lock (_gate)
        {
            _recent = paths.ToArray();
            SaveCount++;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void SetExpandedGroups(IReadOnlyList<RouteGroup> groups)
    {
        ArgumentNullException.ThrowIfNull(groups);
        lock (_gate)
        {
            _expanded = groups.ToArray();
            SaveCount++;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Apply an external sidebar-style / status-bar change (the Appearance surface writing through), raising <see cref="Changed"/>.</summary>
    public void ApplyAppearance(SidebarStyleChoice sidebarStyle, bool statusBarEnabled)
    {
        lock (_gate)
        {
            if (_sidebarStyle == sidebarStyle && _statusBarEnabled == statusBarEnabled)
            {
                return;
            }

            _sidebarStyle = sidebarStyle;
            _statusBarEnabled = statusBarEnabled;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The sidebar badge data seam the shell binds through (P1/S8) — the native analogue of the three web sidebar
/// <c>useQuery</c> reads the <c>Layout</c> issues (<c>/alerts</c>, <c>/vehicles</c>, <c>/data-repair/stale-sessions</c>;
/// web/src/components/layout/Layout.tsx L810-L834). It exposes the current <see cref="LayoutStatusSnapshot"/> and
/// raises <see cref="Changed"/> whenever it moves; <see cref="Refresh"/> forwards the poll tick (the web
/// <c>refetchInterval</c>). The view never issues HTTP — the composition root binds this to the alert / vehicle /
/// data-repair repositories and a test uses <see cref="StaticLayoutStatusSource"/>.
/// </summary>
public interface ILayoutStatusSource
{
    /// <summary>The current badge-data snapshot (lifecycle + counts + staleness + error).</summary>
    LayoutStatusSnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>Forward the poll tick to the data source (web <c>refetchInterval</c> / <c>query.refetch()</c>).</summary>
    void Refresh();
}

/// <summary>
/// An <see cref="ILayoutStatusSource"/> with an explicit, caller-set snapshot — the headless / unit-test default and
/// the safe default an unbound shell binds to. It starts <see cref="LayoutStatusSnapshot.Loading"/> (the web initial
/// query state); the composition root's badge state holder (or a test) calls <see cref="Set"/> as the queries settle,
/// raising <see cref="Changed"/> so the shell reprojects. <see cref="Refresh"/> records the request count for tests.
/// </summary>
public sealed class StaticLayoutStatusSource : ILayoutStatusSource
{
    private LayoutStatusSnapshot _current;

    /// <summary>Creates a source starting in the loading state.</summary>
    public StaticLayoutStatusSource()
        : this(LayoutStatusSnapshot.Loading)
    {
    }

    /// <summary>Creates a source over an initial snapshot.</summary>
    public StaticLayoutStatusSource(LayoutStatusSnapshot current)
    {
        ArgumentNullException.ThrowIfNull(current);
        _current = current;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>Number of times <see cref="Refresh"/> has been invoked (for poll-tick assertions).</summary>
    public int RefreshCount { get; private set; }

    /// <inheritdoc />
    public LayoutStatusSnapshot Current => _current;

    /// <summary>Move the snapshot and raise <see cref="Changed"/>. Idempotent for an equal snapshot.</summary>
    public void Set(LayoutStatusSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot == _current)
        {
            return;
        }

        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Refresh() => RefreshCount++;
}
