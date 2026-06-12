using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One render-ready navigation link — the native analogue of the web <c>renderNavLink</c> output
/// (web/src/components/layout/Layout.tsx L982-L1043). Every string is already resolved through the i18n facade and the
/// badge already reduced to a display count, so the WinUI view binds it directly. <see cref="AutomationName"/> is the
/// Narrator name (label plus, when present, the badge count). Pure scalar data — value equality holds.
/// </summary>
/// <param name="RouteName">Stable route name the link opens.</param>
/// <param name="Path">Normalized route path (the recent/pinned key).</param>
/// <param name="Glyph">Segoe Fluent glyph for the tinted icon.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the icon tint.</param>
/// <param name="Label">Localized label.</param>
/// <param name="IsActive">Whether this link is the active route (web <c>aria-current="page"</c>).</param>
/// <param name="Badge">Which live count the link surfaces.</param>
/// <param name="BadgeCount">The raw count for the badge (0 when none / hidden).</param>
/// <param name="ShowBadge">Whether the trailing badge renders (count &gt; 0).</param>
/// <param name="BadgeText">The clamped badge caption (web <c>&gt; 9 ? '9+' : n</c>); empty when hidden.</param>
/// <param name="IsPinned">Whether this destination is pinned.</param>
/// <param name="AutomationName">Narrator name for the whole link.</param>
public sealed record LayoutNavLinkView(
    string RouteName,
    string Path,
    string Glyph,
    string AccentBrushKey,
    string Label,
    bool IsActive,
    LayoutNavBadge Badge,
    int BadgeCount,
    bool ShowBadge,
    string BadgeText,
    bool IsPinned,
    string AutomationName);

/// <summary>
/// One render-ready sidebar section — the native analogue of a rendered web <c>navSections</c> group
/// (web/src/components/layout/Layout.tsx L1289-L1381): the localized header, the collapse state, whether it is the
/// active section, and its links. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Group">The route group this section renders.</param>
/// <param name="Title">Localized section header.</param>
/// <param name="Glyph">Segoe Fluent glyph for the section header.</param>
/// <param name="AccentBrushKey">Semantic accent token key for the section tint.</param>
/// <param name="ItemCount">The section's item count (web header badge).</param>
/// <param name="IsExpanded">Whether the section is expanded.</param>
/// <param name="IsActive">Whether the active route lives in this section.</param>
/// <param name="Links">The section's render-ready links.</param>
public sealed record LayoutSectionView(
    RouteGroup Group,
    string Title,
    string Glyph,
    string AccentBrushKey,
    int ItemCount,
    bool IsExpanded,
    bool IsActive,
    IReadOnlyList<LayoutNavLinkView> Links);

/// <summary>
/// The active-route "current section" card — the native analogue of the web active-section panel
/// (web/src/components/layout/Layout.tsx L1179-L1214): the active page label, its section, and the pin toggle's
/// pressed state / accessible name / caption. Pure scalar data — value equality holds.
/// </summary>
/// <param name="Path">Active route path.</param>
/// <param name="Label">Localized active-page label.</param>
/// <param name="SectionTitle">Localized owning-section header.</param>
/// <param name="TooltipTitle">Composed "{label} — {section}" hover/Narrator title.</param>
/// <param name="IsPinned">Whether the active page is pinned (web <c>activeIsPinned</c>).</param>
/// <param name="PinToggleLabel">Pin-toggle accessible name (pin vs unpin).</param>
/// <param name="PinToggleCaption">Pin-toggle visible caption (Pin vs Pinned).</param>
public sealed record LayoutCurrentEntryView(
    string Path,
    string Label,
    string SectionTitle,
    string TooltipTitle,
    bool IsPinned,
    string PinToggleLabel,
    string PinToggleCaption);

/// <summary>
/// Every resolved static chrome label the shell renders — computed once per locale so the WinUI view binds Narrator
/// names and headers without calling the i18n facade itself (views render, view-models resolve). Pure scalar data.
/// </summary>
/// <param name="PrimaryNav">Sidebar navigation landmark accessible name.</param>
/// <param name="PrimaryHeader">Mobile header landmark accessible name.</param>
/// <param name="OpenSidebar">Open-drawer button accessible name.</param>
/// <param name="CloseSidebar">Close-drawer button accessible name.</param>
/// <param name="ThemeOpenPicker">Theme quick-switcher accessible name.</param>
/// <param name="ThemeCustomize">Theme "Customize…" link.</param>
/// <param name="Sections">Sections group header.</param>
/// <param name="Pinned">Pinned group header.</param>
/// <param name="RecentlyUsed">Recently-used group header.</param>
/// <param name="ExpandAll">Expand-all button accessible name.</param>
/// <param name="CollapseAll">Collapse-all button accessible name.</param>
/// <param name="QuickSearchHint">Breadcrumb quick-search hint.</param>
/// <param name="CurrentSection">Active-section card accessible name.</param>
public sealed record LayoutChromeLabels(
    string PrimaryNav,
    string PrimaryHeader,
    string OpenSidebar,
    string CloseSidebar,
    string ThemeOpenPicker,
    string ThemeCustomize,
    string Sections,
    string Pinned,
    string RecentlyUsed,
    string ExpandAll,
    string CollapseAll,
    string QuickSearchHint,
    string CurrentSection);

/// <summary>
/// The fully projected, render-ready shell — the native analogue of the web <c>Layout</c> render output: the resolved
/// sidebar style + status-bar reservation, the badge-status state and its message, the sections, the pinned / recent
/// links, the active-section card, and the section expand/collapse availability. Pure data so the whole projection is
/// unit-tested in one call without a UI host. The chrome always renders; <see cref="State"/> only classifies the
/// badge-status region.
/// </summary>
public sealed record LayoutChrome(
    LayoutShellState State,
    string StateMessage,
    bool ShowStateChip,
    SidebarStyleChoice SidebarStyle,
    bool StatusBarEnabled,
    bool RecentlyUsedEnabled,
    LayoutBadgeCounts Counts,
    LayoutChromeLabels Labels,
    IReadOnlyList<LayoutSectionView> Sections,
    IReadOnlyList<LayoutNavLinkView> PinnedLinks,
    IReadOnlyList<LayoutNavLinkView> RecentLinks,
    LayoutCurrentEntryView? CurrentEntry,
    int VisibleSectionCount,
    int ExpandedSectionCount)
{
    /// <summary>Whether every visible section is expanded (the expand-all button is disabled).</summary>
    public bool AllExpanded => VisibleSectionCount > 0 && ExpandedSectionCount >= VisibleSectionCount;

    /// <summary>Whether no section is expanded (the collapse-all button is disabled).</summary>
    public bool NoneExpanded => ExpandedSectionCount == 0;

    /// <summary>Whether the shell resolved at least one navigable destination.</summary>
    public bool HasDestinations => VisibleSectionCount > 0;
}

/// <summary>
/// The pure shell projector — the native port of the web <c>Layout</c> render computations
/// (web/src/components/layout/Layout.tsx): visible-section gating, pinned/recent resolution, active-entry lookup,
/// per-link badge reduction and label resolution. Stateless and WinUI-free so every branch is unit-tested without a
/// UI host; the <see cref="LayoutViewModel"/> owns the mutable state and calls <see cref="Project"/> on each change.
/// </summary>
public static class LayoutProjection
{
    /// <summary>The "Recently Used" sidebar surface, disabled per the web UX review (web <c>SHOW_RECENTLY_USED_NAV</c>).</summary>
    public const bool ShowRecentlyUsed = false;

    /// <summary>Resolve every static chrome label through <paramref name="localizer"/>.</summary>
    public static LayoutChromeLabels ResolveLabels(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new LayoutChromeLabels(
            LayoutI18n.PrimaryNav.Resolve(localizer),
            LayoutI18n.PrimaryHeader.Resolve(localizer),
            LayoutI18n.OpenSidebar.Resolve(localizer),
            LayoutI18n.CloseSidebar.Resolve(localizer),
            LayoutI18n.ThemeOpenPicker.Resolve(localizer),
            LayoutI18n.ThemeCustomize.Resolve(localizer),
            LayoutI18n.Sections.Resolve(localizer),
            LayoutI18n.Pinned.Resolve(localizer),
            LayoutI18n.RecentlyUsed.Resolve(localizer),
            LayoutI18n.ExpandAll.Resolve(localizer),
            LayoutI18n.CollapseAll.Resolve(localizer),
            LayoutI18n.QuickSearchHint.Resolve(localizer),
            LayoutI18n.CurrentSection.Resolve(localizer));
    }

    /// <summary>Clamp a badge count to its display caption (web <c>n &gt; 9 ? '9+' : n</c>); empty when not shown.</summary>
    public static string BadgeText(int count) => count <= 0
        ? string.Empty
        : count > 9 ? "9+" : count.ToString(CultureInfo.CurrentCulture);

    /// <summary>
    /// Project the full render-ready shell from the current state — the single computation the view binds to.
    /// </summary>
    /// <param name="currentPath">The current route path (web <c>location.pathname</c>).</param>
    /// <param name="pinnedPaths">The pinned route paths, newest-first.</param>
    /// <param name="recentPaths">The recently-used route paths, newest-first.</param>
    /// <param name="expandedGroups">The expanded section groups.</param>
    /// <param name="status">The badge data snapshot.</param>
    /// <param name="isForwardAuth">Whether the deployment runs behind ForwardAuth.</param>
    /// <param name="sidebarStyle">The resolved sidebar layout.</param>
    /// <param name="statusBarEnabled">Whether the footer status bar reserves space.</param>
    /// <param name="localizer">The i18n facade.</param>
    public static LayoutChrome Project(
        string currentPath,
        IReadOnlyList<string> pinnedPaths,
        IReadOnlyList<string> recentPaths,
        IReadOnlyCollection<RouteGroup> expandedGroups,
        LayoutStatusSnapshot status,
        bool isForwardAuth,
        SidebarStyleChoice sidebarStyle,
        bool statusBarEnabled,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(currentPath);
        ArgumentNullException.ThrowIfNull(pinnedPaths);
        ArgumentNullException.ThrowIfNull(recentPaths);
        ArgumentNullException.ThrowIfNull(expandedGroups);
        ArgumentNullException.ThrowIfNull(status);
        ArgumentNullException.ThrowIfNull(localizer);

        var counts = status.Counts;
        int vehicleCount = counts.VehicleCount;
        var expanded = expandedGroups as IReadOnlySet<RouteGroup> ?? new HashSet<RouteGroup>(expandedGroups);
        var pinnedSet = new HashSet<string>(pinnedPaths.Select(LayoutNavCatalog.Normalize), StringComparer.Ordinal);

        var activeLocation = LayoutNavCatalog.FindByPath(currentPath);
        RouteGroup? activeGroup = activeLocation?.Section.Group;

        var sections = new List<LayoutSectionView>(LayoutNavCatalog.Sections.Count);
        foreach (var section in LayoutNavCatalog.Sections)
        {
            var visibleItems = section.Items
                .Where(item => LayoutNavCatalog.IsVisible(item, vehicleCount, isForwardAuth))
                .ToArray();
            if (visibleItems.Length == 0)
            {
                continue;
            }

            bool isActiveSection = activeGroup == section.Group;
            var links = new List<LayoutNavLinkView>(visibleItems.Length);
            foreach (var item in visibleItems)
            {
                links.Add(ProjectLink(item, section, currentPath, counts, pinnedSet, localizer));
            }

            sections.Add(new LayoutSectionView(
                section.Group,
                localizer.GetString(section.TitleKey, section.TitleFallback),
                section.Glyph,
                section.AccentBrushKey,
                visibleItems.Length,
                expanded.Contains(section.Group) || isActiveSection,
                isActiveSection,
                links));
        }

        var pinnedLinks = ResolvePathList(pinnedPaths, currentPath, counts, pinnedSet, vehicleCount, isForwardAuth, localizer, excludeActive: false);
        var recentLinks = ResolvePathList(recentPaths, currentPath, counts, pinnedSet, vehicleCount, isForwardAuth, localizer, excludeActive: true);
        var currentEntry = ProjectCurrentEntry(activeLocation, pinnedSet, localizer);

        int visibleSectionCount = sections.Count;
        int expandedSectionCount = sections.Count(s => s.IsExpanded);
        var state = status.ResolveState();
        if (state == LayoutShellState.Ready && visibleSectionCount == 0)
        {
            state = LayoutShellState.Empty;
        }

        return new LayoutChrome(
            state,
            StateMessage(state, localizer),
            ShowStateChip(state),
            sidebarStyle,
            statusBarEnabled,
            ShowRecentlyUsed,
            counts,
            ResolveLabels(localizer),
            sections,
            pinnedLinks,
            recentLinks,
            currentEntry,
            visibleSectionCount,
            expandedSectionCount);
    }

    private static LayoutNavLinkView ProjectLink(
        LayoutNavItem item,
        LayoutNavSection section,
        string currentPath,
        LayoutBadgeCounts counts,
        HashSet<string> pinnedSet,
        ILocalizer localizer)
    {
        string label = localizer.GetString(item.TitleKey, item.TitleFallback);
        int badgeCount = counts.For(item.Badge);
        bool showBadge = item.Badge != LayoutNavBadge.None && badgeCount > 0;
        string badgeText = showBadge ? BadgeText(badgeCount) : string.Empty;
        string automation = showBadge
            ? string.Create(CultureInfo.CurrentCulture, $"{label}, {badgeCount}")
            : label;

        return new LayoutNavLinkView(
            item.RouteName,
            item.Path,
            item.Glyph,
            section.AccentBrushKey,
            label,
            LayoutNavCatalog.IsActive(currentPath, item.Path),
            item.Badge,
            badgeCount,
            showBadge,
            badgeText,
            pinnedSet.Contains(item.Path),
            automation);
    }

    private static List<LayoutNavLinkView> ResolvePathList(
        IReadOnlyList<string> paths,
        string currentPath,
        LayoutBadgeCounts counts,
        HashSet<string> pinnedSet,
        int vehicleCount,
        bool isForwardAuth,
        ILocalizer localizer,
        bool excludeActive)
    {
        var links = new List<LayoutNavLinkView>(paths.Count);
        foreach (string path in paths)
        {
            var location = LayoutNavCatalog.FindByExactPath(path);
            if (location is null)
            {
                continue;
            }

            if (!LayoutNavCatalog.IsVisible(location.Item, vehicleCount, isForwardAuth))
            {
                continue;
            }

            // "Recently Used" never echoes the current page — it is already highlighted in its canonical
            // section (web/src/components/layout/Layout.tsx L867-871).
            if (excludeActive && LayoutNavCatalog.IsActive(currentPath, location.Item.Path))
            {
                continue;
            }

            links.Add(ProjectLink(location.Item, location.Section, currentPath, counts, pinnedSet, localizer));
        }

        return links;
    }

    private static LayoutCurrentEntryView? ProjectCurrentEntry(
        LayoutNavLocation? activeLocation,
        HashSet<string> pinnedSet,
        ILocalizer localizer)
    {
        if (activeLocation is null)
        {
            return null;
        }

        var item = activeLocation.Item;
        string label = localizer.GetString(item.TitleKey, item.TitleFallback);
        string sectionTitle = localizer.GetString(activeLocation.Section.TitleKey, activeLocation.Section.TitleFallback);
        bool isPinned = pinnedSet.Contains(item.Path);

        return new LayoutCurrentEntryView(
            item.Path,
            label,
            sectionTitle,
            string.Create(CultureInfo.CurrentCulture, $"{label} \u2014 {sectionTitle}"),
            isPinned,
            (isPinned ? LayoutI18n.UnpinCurrent : LayoutI18n.PinCurrent).Resolve(localizer),
            (isPinned ? LayoutI18n.PinnedAction : LayoutI18n.PinAction).Resolve(localizer));
    }

    private static bool ShowStateChip(LayoutShellState state) => state
        is LayoutShellState.Empty
        or LayoutShellState.Failed
        or LayoutShellState.Stale
        or LayoutShellState.Offline;

    private static string StateMessage(LayoutShellState state, ILocalizer localizer) => state switch
    {
        LayoutShellState.Empty => LayoutI18n.EmptyNav.Resolve(localizer),
        LayoutShellState.Failed => LayoutI18n.LoadError.Resolve(localizer),
        LayoutShellState.Stale => LayoutI18n.StaleData.Resolve(localizer),
        LayoutShellState.Offline => LayoutI18n.OfflineData.Resolve(localizer),
        _ => string.Empty,
    };
}

/// <summary>
/// The shell's UI-thread-free state holder — the native port of the <c>Layout</c> component body
/// (web/src/components/layout/Layout.tsx L629-L1044). It binds the location, preferences, badge-status and auth-mode
/// seams (P1/S8), reproduces the web side-effects (auto-expanding the active section, tracking the recent-page list,
/// capping pinned / recent), exposes the pin / expand / collapse commands, and recomputes the pure
/// <see cref="LayoutChrome"/> projection whenever any source moves — raising <see cref="PropertyChanged"/> so the view
/// re-renders. <see cref="Dispose"/> unsubscribes from every seam (the web effect cleanups). The view performs no I/O
/// and reads no navigation/preference state directly; marshalling source callbacks onto the UI thread is the view's
/// responsibility.
/// </summary>
public sealed class LayoutViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ILayoutLocation _location;
    private readonly ILayoutPreferences _preferences;
    private readonly ILayoutStatusSource _status;
    private readonly IAuthModeSource _authMode;
    private readonly object _gate = new();
    private LayoutChrome _chrome;
    private bool _suppressReproject;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the four P1/S8 seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="location">The current-location seam (web <c>useLocation</c>).</param>
    /// <param name="preferences">The client-only preferences seam (web localStorage hooks).</param>
    /// <param name="status">The sidebar badge-data seam (web sidebar <c>useQuery</c> reads).</param>
    /// <param name="authMode">The auth-mode seam (web <c>useIsForwardAuth</c>).</param>
    public LayoutViewModel(
        ILocalizer localizer,
        ILayoutLocation location,
        ILayoutPreferences preferences,
        ILayoutStatusSource status,
        IAuthModeSource authMode)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(preferences);
        ArgumentNullException.ThrowIfNull(status);
        ArgumentNullException.ThrowIfNull(authMode);

        _localizer = localizer;
        _location = location;
        _preferences = preferences;
        _status = status;
        _authMode = authMode;

        ApplyLocationSideEffects();
        _chrome = Compute();

        _location.Changed += OnLocationChanged;
        _preferences.Changed += OnSourceChanged;
        _status.Changed += OnSourceChanged;
        _authMode.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Layout</c>).</summary>
    public static string Slug => LayoutRegistration.Slug;

    /// <summary>The current render-ready shell projection (the single property the view binds to).</summary>
    public LayoutChrome Chrome => _chrome;

    /// <summary>The current badge-status state (loading / ready / empty / failed / stale / offline).</summary>
    public LayoutShellState State => _chrome.State;

    /// <summary>Whether the deployment runs behind ForwardAuth (web <c>useIsForwardAuth</c>).</summary>
    public bool IsForwardAuth => ResolveForwardAuth();

    /// <summary>Toggle a section's expansion (web <c>toggleSection</c>): the active section can never be collapsed.</summary>
    public void ToggleSection(RouteGroup group)
    {
        if (_disposed)
        {
            return;
        }

        var activeGroup = LayoutNavCatalog.FindByPath(_location.CurrentPath)?.Section.Group;
        var expanded = new HashSet<RouteGroup>(_preferences.ExpandedGroups);
        if (expanded.Contains(group) && group != activeGroup)
        {
            expanded.Remove(group);
        }
        else
        {
            expanded.Add(group);
        }

        _preferences.SetExpandedGroups(expanded.ToArray());
    }

    /// <summary>Expand every visible section (web <c>expandAllSections</c>).</summary>
    public void ExpandAllSections()
    {
        if (_disposed)
        {
            return;
        }

        var visible = _chrome.Sections.Select(s => s.Group).ToArray();
        _preferences.SetExpandedGroups(visible);
    }

    /// <summary>Collapse every section (web <c>collapseAllSections</c>).</summary>
    public void CollapseAllSections()
    {
        if (_disposed)
        {
            return;
        }

        _preferences.SetExpandedGroups(Array.Empty<RouteGroup>());
    }

    /// <summary>Pin a destination (web <c>pinNavPath</c>): prepend, cap to the max, and drop it from recent.</summary>
    public void Pin(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        if (_disposed)
        {
            return;
        }

        string target = LayoutNavCatalog.Normalize(path);
        var pinned = _preferences.PinnedPaths;
        if (pinned.Any(p => string.Equals(LayoutNavCatalog.Normalize(p), target, StringComparison.Ordinal)))
        {
            return;
        }

        var nextPinned = Prepend(target, pinned, LayoutNavCatalog.MaxPinnedItems);
        var nextRecent = _preferences.RecentPaths
            .Where(p => !string.Equals(LayoutNavCatalog.Normalize(p), target, StringComparison.Ordinal))
            .ToArray();

        RunBatched(() =>
        {
            _preferences.SetPinnedPaths(nextPinned);
            _preferences.SetRecentPaths(nextRecent);
        });
    }

    /// <summary>Unpin a destination (web <c>unpinNavPath</c>).</summary>
    public void Unpin(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        if (_disposed)
        {
            return;
        }

        string target = LayoutNavCatalog.Normalize(path);
        var pinned = _preferences.PinnedPaths;
        var next = pinned
            .Where(p => !string.Equals(LayoutNavCatalog.Normalize(p), target, StringComparison.Ordinal))
            .ToArray();
        if (next.Length == pinned.Count)
        {
            return;
        }

        _preferences.SetPinnedPaths(next);
    }

    /// <summary>Pin or unpin the active page (the active-section card's toggle).</summary>
    public void TogglePinCurrent()
    {
        if (_disposed)
        {
            return;
        }

        var entry = _chrome.CurrentEntry;
        if (entry is null)
        {
            return;
        }

        if (entry.IsPinned)
        {
            Unpin(entry.Path);
        }
        else
        {
            Pin(entry.Path);
        }
    }

    /// <summary>Forward the sidebar poll tick to the badge data source (web <c>refetchInterval</c>).</summary>
    public void RequestRefresh()
    {
        if (_disposed)
        {
            return;
        }

        _status.Refresh();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _location.Changed -= OnLocationChanged;
        _preferences.Changed -= OnSourceChanged;
        _status.Changed -= OnSourceChanged;
        _authMode.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnLocationChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // The active section auto-expands and the recent-page list updates on navigation
        // (web/src/components/layout/Layout.tsx L875-883, L920-927); both persist through the preferences seam,
        // whose Changed then drives the single reproject.
        bool wrote = ApplyLocationSideEffects();
        if (!wrote)
        {
            Reproject();
        }
    }

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private bool ApplyLocationSideEffects()
    {
        string current = _location.CurrentPath;
        var active = LayoutNavCatalog.FindByPath(current);
        bool wrote = false;

        if (active is not null)
        {
            var expanded = _preferences.ExpandedGroups;
            if (!expanded.Contains(active.Section.Group))
            {
                var next = new List<RouteGroup>(expanded) { active.Section.Group };
                _preferences.SetExpandedGroups(next);
                wrote = true;
            }

            string activePath = active.Item.Path;
            bool isPinned = _preferences.PinnedPaths
                .Any(p => string.Equals(LayoutNavCatalog.Normalize(p), activePath, StringComparison.Ordinal));
            if (activePath.Length > 0 && !isPinned)
            {
                var nextRecent = Prepend(activePath, _preferences.RecentPaths, LayoutNavCatalog.MaxRecentItems);
                if (!nextRecent.SequenceEqual(_preferences.RecentPaths, StringComparer.Ordinal))
                {
                    _preferences.SetRecentPaths(nextRecent);
                    wrote = true;
                }
            }
        }

        return wrote;
    }

    private void RunBatched(Action mutate)
    {
        // Coalesce a multi-write command into a single reproject: suppress the per-write Changed reprojects,
        // then reproject once.
        lock (_gate)
        {
            _suppressReproject = true;
        }

        try
        {
            mutate();
        }
        finally
        {
            lock (_gate)
            {
                _suppressReproject = false;
            }

            Reproject();
        }
    }

    private void Reproject()
    {
        LayoutChrome next;
        lock (_gate)
        {
            if (_disposed || _suppressReproject)
            {
                return;
            }

            next = Compute();
            _chrome = next;
        }

        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Chrome)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(State)));
    }

    private LayoutChrome Compute() => LayoutProjection.Project(
        _location.CurrentPath,
        _preferences.PinnedPaths,
        _preferences.RecentPaths,
        _preferences.ExpandedGroups,
        _status.Current,
        ResolveForwardAuth(),
        _preferences.SidebarStyle,
        _preferences.StatusBarEnabled,
        _localizer);

    private bool ResolveForwardAuth()
    {
        var snapshot = _authMode.Current;
        return snapshot.Resolved && snapshot.Mode == RequiresAuthMode.ForwardAuth;
    }

    private static string[] Prepend(string value, IReadOnlyList<string> existing, int cap)
    {
        var result = new List<string>(existing.Count + 1) { value };
        foreach (string path in existing)
        {
            if (!string.Equals(LayoutNavCatalog.Normalize(path), value, StringComparison.Ordinal))
            {
                result.Add(path);
            }
        }

        if (result.Count > cap)
        {
            result.RemoveRange(cap, result.Count - cap);
        }

        return result.ToArray();
    }
}
