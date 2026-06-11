using System.Text.RegularExpressions;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Visibility scope of a registered shortcut — the native port of the web
/// <c>ShortcutScope</c> union (<c>'global' | 'route' | 'page'</c>, see
/// web/src/hooks/useShortcutRegistry.ts). <see cref="Global"/> entries are always visible; <see cref="Route"/>
/// and <see cref="Page"/> entries are visible only when the current pathname matches their route. <c>Page</c> is
/// semantic shorthand for "this single component" and behaves identically to <c>Route</c>.
/// </summary>
public enum ShortcutScope
{
    /// <summary>Always visible in the cheatsheet, regardless of route.</summary>
    Global,

    /// <summary>Visible only when the current pathname matches the route.</summary>
    Route,

    /// <summary>Same as <see cref="Route"/>; shorthand for "this single component".</summary>
    Page,
}

/// <summary>
/// The cheatsheet filter mode — the native port of the web <c>FilterMode</c> union
/// (<c>'all' | 'global' | 'page'</c>). The selection persists across the tab/app session via
/// <c>IShortcutFilterStore</c> (web <c>sessionStorage</c>), with <see cref="All"/> the long-term default.
/// </summary>
public enum ShortcutFilterMode
{
    /// <summary>Every shortcut visible for the current route (web <c>'all'</c>).</summary>
    All,

    /// <summary>Only global shortcuts (web <c>'global'</c>).</summary>
    Global,

    /// <summary>Only route/page shortcuts for the current route (web <c>'page'</c>).</summary>
    Page,
}

/// <summary>
/// A single declared keyboard shortcut — the native port of the web <c>ShortcutDefinition</c>. The cheatsheet
/// surface reads the display fields (<see cref="Id"/>, <see cref="Keys"/>, <see cref="Description"/>,
/// <see cref="Group"/>) and the visibility fields (<see cref="Scope"/>, <see cref="RoutePrefix"/> /
/// <see cref="RoutePattern"/>); the web component itself never touches the live-dispatch <c>match</c>/
/// <c>handler</c> members, so this display-facing port intentionally omits them. <see cref="Description"/> and
/// <see cref="Group"/> are already-localized strings supplied by the registrant.
/// </summary>
public sealed record ShortcutDefinition
{
    /// <summary>Stable id — the cheatsheet key and the registry dedupe key (web <c>id</c>).</summary>
    public required string Id { get; init; }

    /// <summary>
    /// Key combination as display tokens, e.g. <c>["?"]</c>, <c>["Ctrl", "K"]</c>, <c>["g", "d"]</c>. Each token
    /// renders as its own <c>kbd</c> chip (web <c>keys</c>).
    /// </summary>
    public required IReadOnlyList<string> Keys { get; init; }

    /// <summary>Already-translated description shown in the cheatsheet (web <c>description</c>).</summary>
    public required string Description { get; init; }

    /// <summary>Already-translated group label the shortcut renders under (web <c>group</c>).</summary>
    public required string Group { get; init; }

    /// <summary>Visibility scope (web <c>scope</c>). Defaults to <see cref="ShortcutScope.Global"/>.</summary>
    public ShortcutScope Scope { get; init; } = ShortcutScope.Global;

    /// <summary>
    /// Pathname-prefix route match for non-global scopes (the web <c>routeMatch: string</c> branch). Ignored
    /// when <see cref="RoutePattern"/> is supplied.
    /// </summary>
    public string? RoutePrefix { get; init; }

    /// <summary>Regex route match for non-global scopes (the web <c>routeMatch: RegExp</c> branch).</summary>
    public Regex? RoutePattern { get; init; }

    /// <summary>
    /// Priority for resolving multiple matching definitions in the same scope (web <c>priority</c>). Higher
    /// wins. Display-only here; retained for parity with the registry contract.
    /// </summary>
    public int Priority { get; init; }

    /// <summary>
    /// When true the live registry would fire even with focus inside a text input (web <c>allowInInput</c>).
    /// Display-only here; retained for parity with the registry contract.
    /// </summary>
    public bool AllowInInput { get; init; }

    /// <summary>True when a non-global scope has a usable route match configured (web <c>!!routeMatch</c>).</summary>
    public bool HasRoute => RoutePattern is not null || !string.IsNullOrEmpty(RoutePrefix);

    /// <summary>
    /// Narrator label for the cheatsheet row — <c>"&lt;description&gt;: &lt;key&gt; + &lt;key&gt;"</c>, or just the
    /// description when the entry has no key tokens. Built here (WinUI-free) so the view is a thin renderer and the
    /// accessible name is verified headlessly.
    /// </summary>
    public string AccessibleName =>
        Keys.Count == 0 ? Description : $"{Description}: {string.Join(" + ", Keys)}";

    /// <summary>
    /// Whether this definition is visible on <paramref name="pathname"/> — the native port of the web
    /// <c>matchesScope</c> route test: a regex match when <see cref="RoutePattern"/> is set, otherwise a
    /// pathname prefix match. Returns <c>false</c> when no route is configured.
    /// </summary>
    public bool MatchesRoute(string pathname)
    {
        string path = pathname ?? string.Empty;
        if (RoutePattern is not null)
        {
            return RoutePattern.IsMatch(path);
        }

        return !string.IsNullOrEmpty(RoutePrefix) && path.StartsWith(RoutePrefix, StringComparison.Ordinal);
    }
}

/// <summary>
/// A rendered cheatsheet group — a translated <see cref="Title"/> and its ordered <see cref="Shortcuts"/>
/// (web <c>ShortcutGroup</c>).
/// </summary>
public sealed record ShortcutGroup(string Title, IReadOnlyList<ShortcutDefinition> Shortcuts);

/// <summary>
/// The lifecycle states the cheatsheet body renders. The web source's data source is a synchronous in-process
/// registry (<c>useSyncExternalStore</c> over <c>useShortcutRegistry</c>) composed with <c>useLocation</c> — it
/// runs no fetch, query, cache or connectivity check, so the only branches the web source has are "no rows" and
/// "rows". This port adds an explicit <see cref="Loading"/> tick for the external store's initial
/// pre-subscription snapshot. There is deliberately no error / stale / offline state: those would be fabricated
/// behavior the web source does not have (it composes no network read).
/// </summary>
public enum KeyboardShortcutsState
{
    /// <summary>Initial tick before the first registry snapshot is observed (external-store empty snapshot).</summary>
    Loading,

    /// <summary>At least one group matches the active filter + search.</summary>
    Loaded,

    /// <summary>The registry resolved but nothing matches the active filter + search (web empty copy).</summary>
    Empty,
}

/// <summary>
/// Pure projection from the flat registry snapshot to the ordered, grouped cheatsheet — the native port of the
/// web <c>filteredGroups</c> <c>useMemo</c> (scope filter → search filter → group-by → per-group id sort →
/// group rank/title sort). No WinUI types; unit-tested headless.
/// </summary>
public static class ShortcutProjection
{
    // web GROUP_PRIORITY — higher renders first so the sheet reads navigation → actions → table → page groups.
    private static readonly Dictionary<string, int> GroupPriority = new(StringComparer.Ordinal)
    {
        ["navigation"] = 100,
        ["actions"] = 90,
        ["global"] = 90,
        ["commands"] = 80,
        ["table"] = 70,
        ["bulk"] = 60,
        ["form"] = 50,
        ["chart"] = 40,
        ["dashboard"] = 30,
        ["replay"] = 20,
    };

    /// <summary>
    /// Rank a group by its label's first token (web <c>label.toLowerCase().split(/\s|[(]/)[0]</c>): anything not
    /// in the priority map ranks 0 and alpha-sorts to the bottom.
    /// </summary>
    public static int GroupRank(string label)
    {
        if (string.IsNullOrEmpty(label))
        {
            return 0;
        }

        string lower = label.ToLowerInvariant();
        string key = lower;
        for (int i = 0; i < lower.Length; i++)
        {
            char ch = lower[i];
            if (char.IsWhiteSpace(ch) || ch == '(')
            {
                key = lower[..i];
                break;
            }
        }

        return GroupPriority.TryGetValue(key, out int rank) ? rank : 0;
    }

    /// <summary>
    /// Project the registry snapshot to the filtered, grouped, sorted cheatsheet for the given filter mode,
    /// current pathname and search needle. Mirrors the web filter exactly: global entries are always candidates;
    /// non-global entries are always route-gated (hidden when their route does not match the current pathname);
    /// the mode narrows to global-only or non-global-only; the search filters by description substring.
    /// </summary>
    public static IReadOnlyList<ShortcutGroup> Project(
        IEnumerable<ShortcutDefinition> all,
        ShortcutFilterMode mode,
        string pathname,
        string search)
    {
        ArgumentNullException.ThrowIfNull(all);
        string needle = (search ?? string.Empty).Trim().ToLowerInvariant();
        string path = pathname ?? string.Empty;

        var byGroup = new Dictionary<string, List<ShortcutDefinition>>(StringComparer.Ordinal);
        var order = new List<string>();

        foreach (ShortcutDefinition def in all)
        {
            if (def is null)
            {
                continue;
            }

            bool isGlobal = def.Scope == ShortcutScope.Global;
            if (mode == ShortcutFilterMode.Global && !isGlobal)
            {
                continue;
            }

            if (mode == ShortcutFilterMode.Page && isGlobal)
            {
                continue;
            }

            if (!isGlobal)
            {
                if (!def.HasRoute || !def.MatchesRoute(path))
                {
                    continue;
                }
            }

            if (needle.Length > 0 &&
                !def.Description.ToLowerInvariant().Contains(needle, StringComparison.Ordinal))
            {
                continue;
            }

            if (!byGroup.TryGetValue(def.Group, out List<ShortcutDefinition>? list))
            {
                list = new List<ShortcutDefinition>();
                byGroup[def.Group] = list;
                order.Add(def.Group);
            }

            list.Add(def);
        }

        var groups = new List<ShortcutGroup>(order.Count);
        foreach (string title in order)
        {
            List<ShortcutDefinition> shortcuts = byGroup[title];
            shortcuts.Sort(static (a, b) => string.CompareOrdinal(a.Id, b.Id));
            groups.Add(new ShortcutGroup(title, shortcuts));
        }

        groups.Sort(static (a, b) =>
        {
            int ra = GroupRank(a.Title);
            int rb = GroupRank(b.Title);
            return ra != rb ? rb - ra : string.CompareOrdinal(a.Title, b.Title);
        });

        return groups;
    }
}

/// <summary>
/// Static metadata + localized-copy resolution for the cheatsheet surface (web <c>t(...)</c> keys). Centralizing
/// the resource keys here lets the headless tests assert that every key the web source references resolves
/// through the P1/S10 i18n facade, and gives the WinUI view a single keyed call site per label.
/// </summary>
public static class KeyboardShortcutsModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "KeyboardShortcutsModal";

    /// <summary>i18n key for the modal title (web <c>shortcuts.title</c>).</summary>
    public const string TitleKey = "translation.shortcuts.title";

    /// <summary>i18n key for the "All" filter (web <c>shortcuts.filter.all</c>).</summary>
    public const string FilterAllKey = "translation.shortcuts.filter.all";

    /// <summary>i18n key for the "Global" filter (web <c>shortcuts.filter.global</c>).</summary>
    public const string FilterGlobalKey = "translation.shortcuts.filter.global";

    /// <summary>i18n key for the "This page" filter (web <c>shortcuts.filter.page</c>).</summary>
    public const string FilterPageKey = "translation.shortcuts.filter.page";

    /// <summary>i18n key for the search prompt (web <c>shortcuts.search</c>).</summary>
    public const string SearchKey = "translation.shortcuts.search";

    /// <summary>i18n key for the empty-state message (web <c>shortcuts.empty</c>).</summary>
    public const string EmptyKey = "translation.shortcuts.empty";

    /// <summary>Modal title (web <c>t('shortcuts.title', 'Keyboard Shortcuts')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString(TitleKey, "Keyboard Shortcuts");

    /// <summary>"All" filter label (web <c>t('shortcuts.filter.all', 'All')</c>).</summary>
    public static string FilterAll(ILocalizer localizer) =>
        Require(localizer).GetString(FilterAllKey, "All");

    /// <summary>"Global" filter label (web <c>t('shortcuts.filter.global', 'Global')</c>).</summary>
    public static string FilterGlobal(ILocalizer localizer) =>
        Require(localizer).GetString(FilterGlobalKey, "Global");

    /// <summary>"This page" filter label (web <c>t('shortcuts.filter.page', 'This page')</c>).</summary>
    public static string FilterPage(ILocalizer localizer) =>
        Require(localizer).GetString(FilterPageKey, "This page");

    /// <summary>Search prompt (web <c>t('shortcuts.search', 'Search shortcuts…')</c>).</summary>
    public static string SearchPrompt(ILocalizer localizer) =>
        Require(localizer).GetString(SearchKey, "Search shortcuts\u2026");

    /// <summary>Empty-state message (web <c>t('shortcuts.empty', 'No shortcuts match your search.')</c>).</summary>
    public static string Empty(ILocalizer localizer) =>
        Require(localizer).GetString(EmptyKey, "No shortcuts match your search.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the cheatsheet surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a shortcut id, route or fleet datum — so a diagnostics
/// line can never leak user data. Thread-safe.
/// </summary>
public sealed class KeyboardShortcutsModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public KeyboardShortcutsModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=KeyboardShortcutsModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={KeyboardShortcutsModalRegistration.Slug}");
    }
}
