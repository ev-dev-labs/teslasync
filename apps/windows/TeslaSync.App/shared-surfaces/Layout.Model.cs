using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical identity for the application-shell surface — the native analogue of the module-level identity of the web
/// <c>Layout</c> component (web/src/components/layout/Layout.tsx). The web shell is anonymous chrome (it renders the
/// sidebar, header, banner stack and routed content host but carries no page title of its own), so the only registered
/// identity is the diagnostics slug emitted with the <c>view.opened</c> event (P1/S11).
/// </summary>
public static class LayoutRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "Layout";
}

/// <summary>
/// One localizable label the shell renders — the native analogue of a single web <c>t(key, fallback)</c> call site in
/// <c>Layout.tsx</c>. <see cref="Key"/> is the i18n resource key and <see cref="Fallback"/> the authored English copy
/// the web passes as the default. <see cref="Resolve"/> flows the label through the P1/S10 i18n facade so the catalog
/// keys are asserted in tests and resolved for real in the app.
/// </summary>
/// <param name="Key">The i18n resource key (web <c>t()</c> first argument).</param>
/// <param name="Fallback">The authored English fallback (web <c>t()</c> default value).</param>
public sealed record LayoutLabel(string Key, string Fallback)
{
    /// <summary>Resolve the label through the i18n facade, returning the fallback when the key is unresolved.</summary>
    /// <param name="localizer">The P1/S10 i18n facade.</param>
    public string Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(Key, Fallback);
    }
}

/// <summary>
/// Every i18n key/fallback the shell renders, extracted verbatim from <c>Layout.tsx</c> (and the in-file
/// <c>ThemeQuickSwitcher</c>). Each label resolves through the P1/S10 facade; <see cref="All"/> lets a test assert the
/// full key set is present and that no English literal leaks into the native control layer.
/// </summary>
public static class LayoutI18n
{
    /// <summary>Theme quick-switcher trigger + dialog accessible name (web <c>theme.openPicker</c>).</summary>
    public static LayoutLabel ThemeOpenPicker { get; } = new("theme.openPicker", "Open theme picker");

    /// <summary>Theme quick-switcher "build a custom theme" link (web <c>theme.customize</c>).</summary>
    public static LayoutLabel ThemeCustomize { get; } = new("theme.customize", "Customize\u2026");

    /// <summary>Default title for an SSE alert toast lacking its own title (web <c>alerts.toast.title</c>).</summary>
    public static LayoutLabel AlertToastTitle { get; } = new("alerts.toast.title", "Alert");

    /// <summary>SSE alert toast drill-through action label (web <c>alerts.toast.view</c>).</summary>
    public static LayoutLabel AlertToastView { get; } = new("alerts.toast.view", "View");

    /// <summary>Sidebar navigation landmark accessible name (web <c>a11y.primaryNav</c>).</summary>
    public static LayoutLabel PrimaryNav { get; } = new("a11y.primaryNav", "Primary");

    /// <summary>Mobile header landmark accessible name (web <c>a11y.primaryHeader</c>).</summary>
    public static LayoutLabel PrimaryHeader { get; } = new("a11y.primaryHeader", "Site header");

    /// <summary>Mobile-drawer close-button accessible name (web <c>nav.closeSidebar</c>).</summary>
    public static LayoutLabel CloseSidebar { get; } = new("nav.closeSidebar", "Close sidebar");

    /// <summary>Mobile-header open-drawer button accessible name (web <c>nav.openSidebar</c>).</summary>
    public static LayoutLabel OpenSidebar { get; } = new("nav.openSidebar", "Open sidebar");

    /// <summary>Active-section card accessible name (web <c>nav.currentSection</c>).</summary>
    public static LayoutLabel CurrentSection { get; } = new("nav.currentSection", "Current");

    /// <summary>Unpin-current-page button accessible name (web <c>nav.unpinCurrent</c>).</summary>
    public static LayoutLabel UnpinCurrent { get; } = new("nav.unpinCurrent", "Remove current page from pinned");

    /// <summary>Pin-current-page button accessible name (web <c>nav.pinCurrent</c>).</summary>
    public static LayoutLabel PinCurrent { get; } = new("nav.pinCurrent", "Pin current page");

    /// <summary>Pin-toggle pressed-state caption (web <c>nav.pinnedAction</c>).</summary>
    public static LayoutLabel PinnedAction { get; } = new("nav.pinnedAction", "Pinned");

    /// <summary>Pin-toggle default-state caption (web <c>nav.pinAction</c>).</summary>
    public static LayoutLabel PinAction { get; } = new("nav.pinAction", "Pin");

    /// <summary>Pinned-group header (web <c>nav.pinned</c>).</summary>
    public static LayoutLabel Pinned { get; } = new("nav.pinned", "Pinned");

    /// <summary>Per-item unpin button accessible name with a <c>{0}</c> page-name token (web <c>nav.unpinPage</c>).</summary>
    public static LayoutLabel UnpinPage { get; } = new("nav.unpinPage", "Unpin {0}");

    /// <summary>Recently-used group header (web <c>nav.recentlyUsed</c>).</summary>
    public static LayoutLabel RecentlyUsed { get; } = new("nav.recentlyUsed", "Recently Used");

    /// <summary>Sections group header (web <c>nav.sections</c>).</summary>
    public static LayoutLabel Sections { get; } = new("nav.sections", "Sections");

    /// <summary>Expand-all-sections button accessible name (web <c>nav.expandAll</c>).</summary>
    public static LayoutLabel ExpandAll { get; } = new("nav.expandAll", "Expand all sections");

    /// <summary>Collapse-all-sections button accessible name (web <c>nav.collapseAll</c>).</summary>
    public static LayoutLabel CollapseAll { get; } = new("nav.collapseAll", "Collapse all sections");

    /// <summary>Breadcrumb quick-search hint (web <c>nav.quickSearchHint</c>).</summary>
    public static LayoutLabel QuickSearchHint { get; } = new("nav.quickSearchHint", "Ctrl+K to jump");

    /// <summary>Empty-shell message shown when no navigable destinations resolve (defensive empty state).</summary>
    public static LayoutLabel EmptyNav { get; } = new("nav.empty", "No destinations available");

    /// <summary>Error-state message shown when the sidebar badge data fails to load (web <c>QueryError</c> analogue).</summary>
    public static LayoutLabel LoadError { get; } = new("nav.loadError", "Couldn't load navigation status");

    /// <summary>Stale-data chip caption shown when the badge counts are past their freshness window.</summary>
    public static LayoutLabel StaleData { get; } = new("nav.stale", "Updated a while ago");

    /// <summary>Offline chip caption shown when the badge counts are served from cache while offline.</summary>
    public static LayoutLabel OfflineData { get; } = new("nav.offline", "Offline \u2014 showing cached counts");

    /// <summary>Every shell label, for catalog-presence tests.</summary>
    public static IReadOnlyList<LayoutLabel> All { get; } = new[]
    {
        ThemeOpenPicker, ThemeCustomize, AlertToastTitle, AlertToastView, PrimaryNav, PrimaryHeader,
        CloseSidebar, OpenSidebar, CurrentSection, UnpinCurrent, PinCurrent, PinnedAction, PinAction,
        Pinned, UnpinPage, RecentlyUsed, Sections, ExpandAll, CollapseAll, QuickSearchHint,
        EmptyNav, LoadError, StaleData, OfflineData,
    };
}

/// <summary>
/// The mutually-exclusive render state of the shell — the union of the per-state branches the web shell exposes
/// (loading skeleton chrome, resolved content, defensive empty, failed badge fetch, stale cache, offline cache). The
/// chrome (sidebar + header + content host) always renders; this state only drives the sidebar's badge-status region
/// (the web <c>useQuery</c> lifecycle of the alerts/vehicles/stale sidebar reads), never hides the navigation.
/// </summary>
public enum LayoutShellState
{
    /// <summary>Initial badge fetch in flight with no cache — skeleton status chips.</summary>
    Loading,

    /// <summary>Badge data resolved and rendered.</summary>
    Ready,

    /// <summary>Badge data resolved but every count is zero / no navigable destinations — friendly empty status.</summary>
    Empty,

    /// <summary>Badge fetch failed with no cache — error status with retry affordance.</summary>
    Failed,

    /// <summary>Showing cached badge counts past the freshness window — stale chip + auto-refresh.</summary>
    Stale,

    /// <summary>Offline — cached badge counts with an offline chip.</summary>
    Offline,
}

/// <summary>
/// Which live count a navigation item surfaces as a trailing badge — the native analogue of the three conditional
/// badges the web <c>renderNavLink</c> attaches (web/src/components/layout/Layout.tsx L1024-L1038): the unread-alert
/// count on <c>/notifications/alerts</c>, the vehicle count on <c>/vehicles</c>, and the stale-session count on
/// <c>/data-repair</c>.
/// </summary>
public enum LayoutNavBadge
{
    /// <summary>No trailing badge.</summary>
    None = 0,

    /// <summary>Unread-alert count (web <c>unreadAlerts</c> on <c>/notifications/alerts</c>).</summary>
    Alerts,

    /// <summary>Linked-vehicle count (web <c>vehicles.length</c> on <c>/vehicles</c>).</summary>
    Vehicles,

    /// <summary>Stale-session count (web <c>staleCount</c> on <c>/data-repair</c>).</summary>
    Stale,
}

/// <summary>
/// One canonical navigation destination — the native analogue of a web <c>navSections[].items[]</c> entry
/// (web/src/components/layout/Layout.tsx L240-L440), projected from the shared <see cref="RouteTable"/> (the P2 nav
/// core) rather than a hand-maintained parallel list. <see cref="Glyph"/> is the Segoe Fluent code point standing in
/// for the web Lucide icon (it is the same destination's nav glyph in <see cref="RouteTable"/>); the web per-item
/// gating flags (<c>minVehicles</c>, <c>requiresAuth</c>) are reproduced by <see cref="MinVehicles"/> and
/// <see cref="RequiresForwardAuth"/>, layered onto the canonical route by path.
/// </summary>
/// <param name="RouteName">Stable route name (web <c>SafeRoute name</c>); the recent/pinned key is <see cref="Path"/>.</param>
/// <param name="Path">Route path without a leading slash, <see cref="string.Empty"/> for the dashboard root.</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="TitleKey">i18n key for the label (route <c>route.{name}</c> key).</param>
/// <param name="TitleFallback">Authored English label (web <c>label</c>).</param>
/// <param name="Group">The owning left-pane group / section.</param>
/// <param name="MinVehicles">Hide the item until at least this many vehicles are linked (web <c>minVehicles</c>).</param>
/// <param name="RequiresForwardAuth">Hide the item unless the deployment runs behind ForwardAuth (web <c>requiresAuth</c>).</param>
/// <param name="Badge">Which live count the item surfaces as a trailing badge.</param>
public sealed record LayoutNavItem(
    string RouteName,
    string Path,
    string Glyph,
    string TitleKey,
    string TitleFallback,
    RouteGroup Group,
    int MinVehicles,
    bool RequiresForwardAuth,
    LayoutNavBadge Badge);

/// <summary>
/// One sidebar section — the native analogue of a web <c>navSections[]</c> group
/// (web/src/components/layout/Layout.tsx). Built from a <see cref="RouteGroup"/> via the shared
/// <see cref="RouteGroups"/> catalogue (header label + glyph) and the routes that belong to it.
/// <see cref="AccentBrushKey"/> is the semantic design token standing in for the web per-section Tailwind accent
/// (no ad-hoc hex in the control layer).
/// </summary>
/// <param name="Group">The route group this section renders.</param>
/// <param name="TitleKey">i18n key for the section header (web section <c>title</c>).</param>
/// <param name="TitleFallback">Authored English section header.</param>
/// <param name="Glyph">Segoe Fluent glyph for the section header.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the section tint (web Tailwind accent).</param>
/// <param name="Items">The section's ordered navigation items.</param>
public sealed record LayoutNavSection(
    RouteGroup Group,
    string TitleKey,
    string TitleFallback,
    string Glyph,
    string AccentBrushKey,
    IReadOnlyList<LayoutNavItem> Items);

/// <summary>
/// The three live counts the sidebar badges read — the native analogue of the web sidebar's derived
/// <c>unreadAlerts</c> / <c>vehicleCount</c> / <c>staleCount</c> (web/src/components/layout/Layout.tsx L812-L834).
/// </summary>
/// <param name="UnreadAlerts">Unread-alert count (web <c>alerts.filter(!is_read).length</c>).</param>
/// <param name="VehicleCount">Linked-vehicle count (web <c>vehicles.length</c>).</param>
/// <param name="StaleSessions">Stale-session count (web <c>stale_charging + stale_drives</c>).</param>
public readonly record struct LayoutBadgeCounts(int UnreadAlerts, int VehicleCount, int StaleSessions)
{
    /// <summary>All counts zero — the empty badge matrix.</summary>
    public static LayoutBadgeCounts Zero => default;

    /// <summary>True when no count carries a value to show.</summary>
    public bool IsEmpty => UnreadAlerts <= 0 && VehicleCount <= 0 && StaleSessions <= 0;

    /// <summary>The count for a given badge kind (0 for <see cref="LayoutNavBadge.None"/>).</summary>
    public int For(LayoutNavBadge badge) => badge switch
    {
        LayoutNavBadge.Alerts => UnreadAlerts,
        LayoutNavBadge.Vehicles => VehicleCount,
        LayoutNavBadge.Stale => StaleSessions,
        _ => 0,
    };
}

/// <summary>
/// The canonical shell navigation model — the native port of the module-level <c>navSections</c>, the gating helpers
/// (<c>isVisibleNavItem</c> / <c>isActiveNavPath</c> / <c>findNavItemByPath</c> / <c>findNavItemByExactPath</c>) and
/// the pinned/recent/expanded constants from web/src/components/layout/Layout.tsx. The section/item data is projected
/// from the shared <see cref="RouteTable"/> + <see cref="RouteGroups"/> (the P2 nav core) so the shell never maintains
/// a parallel route list; the web's per-item gating and badge flags are layered on by path. All members are pure /
/// WinUI-free so the navigation logic is unit-tested without a UI host.
/// </summary>
public static class LayoutNavCatalog
{
    /// <summary>Maximum pinned items the sidebar keeps (web <c>MAX_PINNED_NAV_ITEMS</c>).</summary>
    public const int MaxPinnedItems = 8;

    /// <summary>Maximum recently-used items the sidebar keeps (web <c>MAX_RECENT_NAV_ITEMS</c>).</summary>
    public const int MaxRecentItems = 3;

    /// <summary>Persistence key for the expanded-section set (web <c>EXPANDED_NAV_STORAGE_KEY</c>).</summary>
    public const string ExpandedStorageKey = "teslasync-expanded-nav-sections";

    /// <summary>Persistence key for the recent-paths list (web <c>RECENT_NAV_STORAGE_KEY</c>).</summary>
    public const string RecentStorageKey = "teslasync-recent-nav-paths";

    /// <summary>Persistence key for the pinned-paths list (web <c>PINNED_NAV_STORAGE_KEY</c>).</summary>
    public const string PinnedStorageKey = "teslasync-pinned-nav-paths";

    /// <summary>
    /// Default pinned destinations on first run (web <c>DEFAULT_PINNED_NAV_PATHS</c>, expressed as
    /// <see cref="RouteTable"/> paths: the dashboard root, digital twin, vehicles, charging and the live map).
    /// </summary>
    public static IReadOnlyList<string> DefaultPinnedPaths { get; } =
        new[] { string.Empty, "digital-twin", "vehicles", "charging", "live" };

    /// <summary>
    /// The section expanded by default on first run — the dashboard/explore group, the native analogue of the web
    /// default expanded set <c>{ 'Home' }</c>.
    /// </summary>
    public static IReadOnlyList<RouteGroup> DefaultExpandedGroups { get; } =
        new[] { RouteGroup.DashboardExplore };

    /// <summary>
    /// Routes that require a ForwardAuth identity to be useful — the native analogue of the web nav items flagged
    /// <c>requiresAuth: true</c> (Two-Factor Auth, Active Sessions, My Activity). Hidden in open mode because the
    /// underlying per-user endpoints 503 without a configured identity provider.
    /// </summary>
    public static IReadOnlySet<string> ForwardAuthOnlyPaths { get; } =
        new HashSet<string>(StringComparer.Ordinal) { "account/2fa", "account/sessions", "me/activity" };

    private static readonly Dictionary<string, int> MinVehiclesByPath =
        new Dictionary<string, int>(StringComparer.Ordinal) { ["vehicle-comparison"] = 2 };

    private static readonly Dictionary<string, LayoutNavBadge> BadgeByPath =
        new Dictionary<string, LayoutNavBadge>(StringComparer.Ordinal)
        {
            ["notifications/alerts"] = LayoutNavBadge.Alerts,
            ["vehicles"] = LayoutNavBadge.Vehicles,
            ["data-repair"] = LayoutNavBadge.Stale,
        };

    private static readonly Dictionary<RouteGroup, string> AccentByGroup =
        new Dictionary<RouteGroup, string>
        {
            [RouteGroup.DashboardExplore] = "TsColorInfoBrush",
            [RouteGroup.Vehicles] = "TsColorInfoBrush",
            [RouteGroup.Charging] = "TsColorSuccessBrush",
            [RouteGroup.TripsDriving] = "TsChartPowerBrush",
            [RouteGroup.BatteryEnergy] = "TsColorWarningBrush",
            [RouteGroup.Analytics] = "TsColorSuccessBrush",
            [RouteGroup.MapsLocation] = "TsColorInfoBrush",
            [RouteGroup.VehicleSystems] = "TsColorDangerBrush",
            [RouteGroup.Automations] = "TsChartPowerBrush",
            [RouteGroup.Notifications] = "TsColorWarningBrush",
            [RouteGroup.TelemetrySignals] = "TsColorInfoBrush",
            [RouteGroup.Diagnostics] = "TsColorInfoBrush",
            [RouteGroup.AdminDevTools] = "TsChartPowerBrush",
            [RouteGroup.PowerUser] = "TsChartPowerBrush",
            [RouteGroup.SystemOps] = "TsColorSuccessBrush",
            [RouteGroup.SettingsAccountIntegrations] = "TsColorAccentBrush",
            [RouteGroup.Sharing] = "TsColorInfoBrush",
            [RouteGroup.Onboarding] = "TsColorAccentBrush",
            [RouteGroup.Standalone] = "TsColorAccentBrush",
        };

    /// <summary>The semantic accent token used when a group has no explicit mapping.</summary>
    public const string DefaultAccentBrushKey = "TsColorAccentBrush";

    /// <summary>
    /// Every sidebar section, in left-pane order, built once from the shared route table. Only routes that surface in
    /// the nav (<see cref="RouteDefinition.ShowInNav"/>), render inside the main shell, and are neither redirects nor
    /// the catch-all are included; groups with no such route are dropped.
    /// </summary>
    public static IReadOnlyList<LayoutNavSection> Sections { get; } = BuildSections();

    /// <summary>Every navigation item across all sections, in section order (web flattened <c>navSections</c>).</summary>
    public static IReadOnlyList<LayoutNavItem> AllItems { get; } =
        Sections.SelectMany(s => s.Items).ToArray();

    /// <summary>The semantic accent token for a group (falls back to <see cref="DefaultAccentBrushKey"/>).</summary>
    public static string AccentFor(RouteGroup group) =>
        AccentByGroup.TryGetValue(group, out var key) ? key : DefaultAccentBrushKey;

    /// <summary>
    /// Whether an item is visible given the current fleet size and auth mode — the native port of the web
    /// <c>isVisibleNavItem</c> (web/src/components/layout/Layout.tsx L445-L452): hidden below its
    /// <see cref="LayoutNavItem.MinVehicles"/> threshold, and hidden when it
    /// <see cref="LayoutNavItem.RequiresForwardAuth"/> but the deployment is not running behind ForwardAuth.
    /// </summary>
    public static bool IsVisible(LayoutNavItem item, int vehicleCount, bool isForwardAuth)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (item.MinVehicles > 0 && vehicleCount < item.MinVehicles)
        {
            return false;
        }

        if (item.RequiresForwardAuth && !isForwardAuth)
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// Whether a route path is the active one for the current location — the native port of the web
    /// <c>isActiveNavPath</c> (web/src/components/layout/Layout.tsx L454-L458): the dashboard root matches only an
    /// exact empty path, every other route matches an exact path or a path one or more segments beneath it.
    /// </summary>
    public static bool IsActive(string currentPath, string itemPath)
    {
        ArgumentNullException.ThrowIfNull(currentPath);
        ArgumentNullException.ThrowIfNull(itemPath);

        string current = Normalize(currentPath);
        string target = Normalize(itemPath);

        if (target.Length == 0)
        {
            return current.Length == 0;
        }

        return string.Equals(current, target, StringComparison.Ordinal)
            || current.StartsWith(target + "/", StringComparison.Ordinal);
    }

    /// <summary>
    /// The first section + item whose route is active for <paramref name="currentPath"/> — the native port of the web
    /// <c>findNavItemByPath</c> (web/src/components/layout/Layout.tsx L460-L466).
    /// </summary>
    public static LayoutNavLocation? FindByPath(string currentPath)
    {
        ArgumentNullException.ThrowIfNull(currentPath);
        foreach (var section in Sections)
        {
            foreach (var item in section.Items)
            {
                if (IsActive(currentPath, item.Path))
                {
                    return new LayoutNavLocation(section, item);
                }
            }
        }

        return null;
    }

    /// <summary>
    /// The section + item whose route path exactly matches <paramref name="path"/> — the native port of the web
    /// <c>findNavItemByExactPath</c> (web/src/components/layout/Layout.tsx L468-L474).
    /// </summary>
    public static LayoutNavLocation? FindByExactPath(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        string target = Normalize(path);
        foreach (var section in Sections)
        {
            foreach (var item in section.Items)
            {
                if (string.Equals(item.Path, target, StringComparison.Ordinal))
                {
                    return new LayoutNavLocation(section, item);
                }
            }
        }

        return null;
    }

    /// <summary>Trim a path to its canonical <see cref="RouteTable"/> form (no leading/trailing slash).</summary>
    public static string Normalize(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        return path.Trim('/');
    }

    private static List<LayoutNavSection> BuildSections()
    {
        var byGroup = RouteTable.All
            .Where(static r => r is { ShowInNav: true, IsCatchAll: false, ShellMode: ShellMode.Main }
                && !r.IsRedirect
                && r.Group != RouteGroup.None)
            .GroupBy(static r => r.Group)
            .ToDictionary(static g => g.Key, static g => g.ToArray());

        var sections = new List<LayoutNavSection>(RouteGroups.Ordered.Count);
        foreach (var groupInfo in RouteGroups.Ordered)
        {
            if (!byGroup.TryGetValue(groupInfo.Group, out var routes) || routes.Length == 0)
            {
                continue;
            }

            var items = new List<LayoutNavItem>(routes.Length);
            foreach (var route in routes)
            {
                string path = Normalize(route.PathPattern);
                items.Add(new LayoutNavItem(
                    route.Name,
                    path,
                    route.Glyph,
                    route.TitleKey ?? $"route.{route.Name}",
                    route.DefaultTitle,
                    route.Group,
                    MinVehiclesByPath.TryGetValue(path, out int min) ? min : 0,
                    ForwardAuthOnlyPaths.Contains(path),
                    BadgeByPath.TryGetValue(path, out var badge) ? badge : LayoutNavBadge.None));
            }

            sections.Add(new LayoutNavSection(
                groupInfo.Group,
                groupInfo.TitleKey,
                groupInfo.DefaultTitle,
                groupInfo.Glyph,
                AccentFor(groupInfo.Group),
                items));
        }

        return sections;
    }
}

/// <summary>
/// A resolved (section, item) pair — the native analogue of the web <c>{ section, item }</c> tuple returned by
/// <c>findNavItemByPath</c> / <c>findNavItemByExactPath</c> (web/src/components/layout/Layout.tsx).
/// </summary>
/// <param name="Section">The owning sidebar section.</param>
/// <param name="Item">The navigation item.</param>
public sealed record LayoutNavLocation(LayoutNavSection Section, LayoutNavItem Item);

/// <summary>
/// An immutable snapshot of the sidebar badge data source — the native analogue of the resolved web sidebar
/// <c>useQuery</c> reads (alerts / vehicles / stale sessions) at one instant. It carries the lifecycle
/// <see cref="Status"/> (the shared <see cref="LoadStatus"/> vocabulary), the derived <see cref="Counts"/>, the
/// staleness flag and the failure detail so the shell can reproduce every web load branch without the view issuing
/// any I/O. WinUI-free so it is unit-tested headlessly.
/// </summary>
/// <param name="Status">The data lifecycle status.</param>
/// <param name="Counts">The resolved badge counts (zero while loading / failed).</param>
/// <param name="IsStale">Whether a cached value is past its freshness window.</param>
/// <param name="Error">The failure detail when <see cref="Status"/> is <see cref="LoadStatus.Error"/> or offline.</param>
/// <param name="FetchedAt">When the counts were last fetched, if ever.</param>
public sealed record LayoutStatusSnapshot(
    LoadStatus Status,
    LayoutBadgeCounts Counts,
    bool IsStale,
    RepositoryError? Error,
    DateTimeOffset? FetchedAt)
{
    /// <summary>The pre-resolution snapshot: loading, no counts (the web initial query state).</summary>
    public static LayoutStatusSnapshot Loading { get; } =
        new(LoadStatus.Loading, LayoutBadgeCounts.Zero, IsStale: false, Error: null, FetchedAt: null);

    /// <summary>A freshly-loaded snapshot carrying <paramref name="counts"/>.</summary>
    public static LayoutStatusSnapshot Loaded(LayoutBadgeCounts counts, DateTimeOffset fetchedAt) =>
        new(LoadStatus.Loaded, counts, IsStale: false, Error: null, fetchedAt);

    /// <summary>
    /// The shell state this snapshot resolves to (the web load-branch selector). Always renders the chrome; this only
    /// classifies the sidebar badge-status region.
    /// </summary>
    public LayoutShellState ResolveState() => Status switch
    {
        LoadStatus.Loading => LayoutShellState.Loading,
        LoadStatus.Error => LayoutShellState.Failed,
        LoadStatus.Offline => LayoutShellState.Offline,
        LoadStatus.Empty => LayoutShellState.Empty,
        LoadStatus.Cached or LoadStatus.Refreshing when IsStale => LayoutShellState.Stale,
        _ => Counts.IsEmpty ? LayoutShellState.Empty : LayoutShellState.Ready,
    };
}

/// <summary>
/// PII-safe diagnostics for the shell surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a route, label, count or any user data. Thread-safe; mirrors
/// every other surface's diagnostics collector.
/// </summary>
public sealed class LayoutDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LayoutDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the shell has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Layout</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={LayoutRegistration.Slug}"));
    }
}
