using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the LinearSidebar surface — the native mirror of the web
/// <c>LinearSidebar</c> (web/src/components/layout/sidebar/LinearSidebar.tsx), the Linear / Notion-inspired
/// navigation tree that replaces the default sidebar's <c>&lt;nav&gt;</c> block. The web source is
/// presentational: its nav tree (<c>sections</c>) and favorites (<c>pinnedItems</c>) arrive as props and its
/// only hooks are <c>useLocation</c> (the active-path fallback) and <c>useTranslation</c> (i18n), so there is
/// no data fetch — and therefore no loading / error / stale / offline chrome — to reproduce. This metadata
/// carries the diagnostics slug the surface registers under, the three hard-coded trailing-badge route
/// literals the web <c>trailingFor()</c> matches, and every render-contract i18n key/fallback the web source
/// passes to <c>t()</c>, so the native surface reproduces the web copy verbatim. Each key carries the
/// <c>translation.</c> catalog prefix the WinUI resource bridge expects and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class LinearSidebarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "LinearSidebar";

    /// <summary>i18n key for the navigation landmark accessible name (web <c>t('nav.sidebar', 'Sidebar navigation')</c>).</summary>
    public const string SidebarKey = "translation.nav.sidebar";

    /// <summary>English fallback for <see cref="SidebarKey"/> (web second arg, verbatim).</summary>
    public const string SidebarFallback = "Sidebar navigation";

    /// <summary>i18n key for the favorites group header (web <c>t('nav.favorites', 'Favorites')</c>).</summary>
    public const string FavoritesKey = "translation.nav.favorites";

    /// <summary>English fallback for <see cref="FavoritesKey"/> (web second arg, verbatim).</summary>
    public const string FavoritesFallback = "Favorites";

    /// <summary>i18n key for the empty-filter message (web <c>t('nav.filterNoMatch', 'No matches.')</c>).</summary>
    public const string FilterNoMatchKey = "translation.nav.filterNoMatch";

    /// <summary>English fallback for <see cref="FilterNoMatchKey"/> (web second arg, verbatim).</summary>
    public const string FilterNoMatchFallback = "No matches.";

    /// <summary>i18n key for the clear-filter button (web <c>t('nav.filterClear', 'Clear filter')</c>).</summary>
    public const string FilterClearKey = "translation.nav.filterClear";

    /// <summary>English fallback for <see cref="FilterClearKey"/> (web second arg, verbatim).</summary>
    public const string FilterClearFallback = "Clear filter";

    /// <summary>i18n key for the vehicles count chip accessible name (web <c>t('nav.vehicleCount', { count })</c>).</summary>
    public const string VehicleCountKey = "translation.nav.vehicleCount";

    /// <summary>
    /// English fallback for <see cref="VehicleCountKey"/> (web second arg, verbatim — the <c>{{count}}</c> token
    /// is interpolated by <see cref="FormatCount"/>). The shipped resw catalog value uses the native <c>{0}</c>
    /// token instead, so the interpolation substitutes both.
    /// </summary>
    public const string VehicleCountFallback = "{{count}} vehicles";

    /// <summary>i18n key for the stale-rows count chip accessible name (web <c>t('nav.staleCount', { count })</c>).</summary>
    public const string StaleCountKey = "translation.nav.staleCount";

    /// <summary>English fallback for <see cref="StaleCountKey"/> (web second arg, verbatim; <c>{{count}}</c> interpolated).</summary>
    public const string StaleCountFallback = "{{count}} stale rows";

    /// <summary>i18n key for a section row's pin-to-favorites button (web <c>t('nav.pinPage', { page })</c>).</summary>
    public const string PinPageKey = "translation.nav.pinPage";

    /// <summary>English fallback for <see cref="PinPageKey"/> (web second arg, verbatim; <c>{{page}}</c> interpolated).</summary>
    public const string PinPageFallback = "Pin {{page}} to favorites";

    /// <summary>i18n key for a favorites row's unpin button (web <c>t('nav.unpinPage', { page })</c>).</summary>
    public const string UnpinPageKey = "translation.nav.unpinPage";

    /// <summary>English fallback for <see cref="UnpinPageKey"/> (web second arg, verbatim; <c>{{page}}</c> interpolated).</summary>
    public const string UnpinPageFallback = "Unpin {{page}}";

    /// <summary>Route whose row shows the unread notification dot (web <c>to === '/notifications/alerts'</c>).</summary>
    public const string AlertsRoute = "/notifications/alerts";

    /// <summary>Route whose row shows the vehicles count chip (web <c>to === '/vehicles'</c>).</summary>
    public const string VehiclesRoute = "/vehicles";

    /// <summary>Route whose row shows the stale-rows count chip (web <c>to === '/data-repair'</c>).</summary>
    public const string DataRepairRoute = "/data-repair";

    /// <summary>The count above which the chip shows "99+" (web <c>value &gt; 99 ? '99+' : value</c>).</summary>
    public const int CountChipCeiling = 99;

    /// <summary>
    /// Interpolate a count into a localized chip label. Substitutes the web i18next token (<c>{{count}}</c>)
    /// and the native positional token (<c>{0}</c>, used by the resw catalog value) so the same projection
    /// works whether the string came from the catalog or the English fallback. Uses literal replaces (never
    /// <see cref="string.Format(IFormatProvider, string, object?)"/>) so a localized value carrying a stray
    /// brace can never throw a <see cref="System.FormatException"/>. The number is rendered invariantly so the
    /// chip text and its accessible name agree regardless of the test host culture.
    /// </summary>
    public static string FormatCount(string template, int count)
    {
        ArgumentNullException.ThrowIfNull(template);
        string number = count.ToString(CultureInfo.InvariantCulture);
        return template
            .Replace("{{count}}", number, StringComparison.Ordinal)
            .Replace("{0}", number, StringComparison.Ordinal);
    }

    /// <summary>
    /// Interpolate a page label into a localized pin / unpin button name. Substitutes the web i18next token
    /// (<c>{{page}}</c>) and the native positional token (<c>{0}</c>); literal replaces only, so a stray brace
    /// in a localized value can never throw.
    /// </summary>
    public static string FormatPage(string template, string page)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(page);
        return template
            .Replace("{{page}}", page, StringComparison.Ordinal)
            .Replace("{0}", page, StringComparison.Ordinal);
    }

    /// <summary>The text shown inside a count chip — the web <c>value &gt; 99 ? '99+' : value</c>.</summary>
    public static string CountChipText(int value) =>
        value > CountChipCeiling
            ? string.Create(CultureInfo.InvariantCulture, $"{CountChipCeiling}+")
            : value.ToString(CultureInfo.InvariantCulture);
}

/// <summary>
/// One nav entry — the native port of a web nav item
/// (<c>{ to, icon, label, color?, dataTour?, minVehicles? }</c> in LinearSidebar.tsx). The web component is
/// handed items that are already visibility-filtered (vehicle count, forward-auth), so the native surface
/// renders every item it is given; <see cref="MinVehicles"/> is reproduced for shape fidelity (no scope
/// narrowing) but the surface does not filter on it — the caller pre-filters exactly as Layout does on the web.
/// </summary>
/// <param name="To">The route path the row navigates to (web <c>to</c>); also the pin/active identity key.</param>
/// <param name="Label">The nav label resolved through the <c>navLabel</c> seam (web <c>navLabel(item.label)</c>).</param>
/// <param name="Glyph">The Segoe Fluent Icons glyph shown as the page-marker icon (web <c>icon</c>).</param>
/// <param name="DataTour">Optional product-tour anchor id carried onto the row (web <c>dataTour</c>).</param>
/// <param name="MinVehicles">Optional visibility threshold metadata (web <c>minVehicles</c>); reproduced, not enforced.</param>
public sealed record LinearNavItem(
    string To,
    string Label,
    string Glyph,
    string? DataTour = null,
    int? MinVehicles = null);

/// <summary>
/// One nav section — the native port of the web <c>LinearSidebarSectionInput</c>
/// (<c>{ title; items[] }</c> in LinearSidebar.tsx). <see cref="Title"/> is an already-localized display
/// string supplied by the caller (web section titles come pre-localized from Layout's canonical
/// <c>navSections</c>); the surface uses it as both the collapsible header label and the row group's
/// accessible name.
/// </summary>
/// <param name="Title">The section header label (web <c>section.title</c>).</param>
/// <param name="Items">The section's nav items, in declaration order (web <c>section.items</c>).</param>
public sealed record LinearNavSection(string Title, IReadOnlyList<LinearNavItem> Items);

/// <summary>
/// The trailing affordance a row carries — the native union of the web <c>trailingFor()</c> branches: nothing,
/// a single unread <c>NotificationDot</c>, or a monochrome <c>CountChip</c>. The dot is decorative
/// (web <c>aria-hidden</c>); the chip carries an accessible name.
/// </summary>
public enum LinearTrailingKind
{
    /// <summary>No trailing affordance (web <c>trailingFor</c> returns <c>null</c>).</summary>
    None,

    /// <summary>A 6px unread dot, decorative (web <c>&lt;NotificationDot /&gt;</c> for <c>/notifications/alerts</c>).</summary>
    NotificationDot,

    /// <summary>A monochrome count chip with an accessible name (web <c>&lt;CountChip /&gt;</c> for vehicles / stale rows).</summary>
    CountChip,
}

/// <summary>
/// The two mutually-exclusive render shapes of the tree body — the native projection of the web source's
/// outermost branch. <see cref="Tree"/> renders the favorites group (when present) and every section that has
/// at least one matching item; <see cref="EmptyFilter"/> is the web <c>filterTokens.length &gt; 0 &amp;&amp;
/// expandedSections.length === 0</c> branch ("No matches." + "Clear filter"). The web source has no
/// loading / error / stale / offline state (it performs no fetch — its only hooks are <c>useLocation</c> and
/// <c>useTranslation</c>), so these are the complete set the surface renders.
/// </summary>
public enum LinearSidebarContentState
{
    /// <summary>The favorites group (when any pinned) plus the matching, collapsible sections.</summary>
    Tree,

    /// <summary>The empty-filter message with a clear-filter affordance (no section matched the active filter).</summary>
    EmptyFilter,
}

/// <summary>
/// The render-ready view of one nav row — the native projection of a web <c>LinearNavLink</c>. Carries the
/// resolved label, the active flag (the 2px accent bar + medium weight), the glyph, the trailing affordance and
/// its accessible name, and the pin / unpin hover-action visibility + localized names. Pure data (no WinUI
/// types) so it is asserted headlessly.
/// </summary>
/// <param name="To">The route the row navigates to (web <c>to</c>).</param>
/// <param name="Label">The resolved, displayed label (web <c>navLabel(item.label)</c>).</param>
/// <param name="Glyph">The Segoe Fluent page-marker glyph (web <c>icon</c>).</param>
/// <param name="IsActive">Whether the row is the active page (web <c>isActiveLinearPath</c>).</param>
/// <param name="DataTour">Optional product-tour anchor id (web <c>dataTour</c>).</param>
/// <param name="Trailing">The trailing affordance kind (web <c>trailingFor</c>).</param>
/// <param name="TrailingValue">The chip count when <see cref="Trailing"/> is <see cref="LinearTrailingKind.CountChip"/>.</param>
/// <param name="TrailingLabel">The chip's accessible name, e.g. "3 vehicles" (web <c>CountChip label</c>); empty otherwise.</param>
/// <param name="ShowPin">Whether the pin-to-favorites hover action is shown (web section rows where <c>!pinnedSet.has(to)</c>).</param>
/// <param name="PinLabel">The pin button's accessible name (web <c>t('nav.pinPage', { page })</c>).</param>
/// <param name="ShowUnpin">Whether the unpin hover action is shown (web favorites rows).</param>
/// <param name="UnpinLabel">The unpin button's accessible name (web <c>t('nav.unpinPage', { page })</c>).</param>
/// <param name="AutomationName">The row's Narrator name (the resolved label).</param>
public sealed record LinearNavLinkDisplay(
    string To,
    string Label,
    string Glyph,
    bool IsActive,
    string? DataTour,
    LinearTrailingKind Trailing,
    int TrailingValue,
    string TrailingLabel,
    bool ShowPin,
    string PinLabel,
    bool ShowUnpin,
    string UnpinLabel,
    string AutomationName);

/// <summary>
/// The render-ready view of the favorites group — the native projection of the web favorites block. The header
/// is shown whenever there is at least one pinned item (web <c>pinnedItems.length &gt; 0</c>), even if the
/// active filter hides every row, so <see cref="Items"/> may be empty while the group is present. Pure data.
/// </summary>
/// <param name="Label">The localized "Favorites" header (web <c>t('nav.favorites', 'Favorites')</c>).</param>
/// <param name="Items">The filtered pinned rows, in pin order (web <c>pinnedItems.filter(matchesFilter)</c>).</param>
public sealed record LinearFavoritesDisplay(string Label, IReadOnlyList<LinearNavLinkDisplay> Items);

/// <summary>
/// The render-ready view of one collapsible section — the native projection of a web section block. Carries the
/// header title, the filtered row count shown in the header, the effective expanded state and the projected
/// rows. Pure data — no WinUI types.
/// </summary>
/// <param name="Title">The section header title (web <c>section.title</c>).</param>
/// <param name="Count">The number of matching rows shown in the header (web <c>section.items.length</c> after filter).</param>
/// <param name="IsExpanded">Whether the section is expanded (web <c>isExpanded(title)</c>).</param>
/// <param name="Items">The projected rows in declaration order (only present visually when expanded).</param>
public sealed record LinearSectionDisplay(
    string Title,
    int Count,
    bool IsExpanded,
    IReadOnlyList<LinearNavLinkDisplay> Items);

/// <summary>
/// The fully projected, render-ready view of the whole sidebar — the native analogue of the web
/// <c>LinearSidebar</c> render output. Carries the navigation landmark name, the optional favorites group, the
/// ordered sections that survived the filter, and the mutually-exclusive empty-filter branch. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="NavAutomationName">The navigation landmark accessible name (web <c>nav aria-label</c>).</param>
/// <param name="Favorites">The favorites group, or null when nothing is pinned.</param>
/// <param name="Sections">The ordered sections with at least one matching row (web <c>expandedSections</c>).</param>
/// <param name="IsFilterActive">Whether a tree filter is applied (web <c>filterTokens.length &gt; 0</c>).</param>
/// <param name="IsEmptyFilter">Whether the filter matched no section (web empty-filter branch condition).</param>
/// <param name="EmptyFilterMessage">The localized "No matches." message (web <c>t('nav.filterNoMatch')</c>).</param>
/// <param name="ClearFilterLabel">The localized "Clear filter" button label (web <c>t('nav.filterClear')</c>).</param>
/// <param name="ContentState">Which body shape renders (web outermost branch).</param>
public sealed record LinearSidebarDisplay(
    string NavAutomationName,
    LinearFavoritesDisplay? Favorites,
    IReadOnlyList<LinearSectionDisplay> Sections,
    bool IsFilterActive,
    bool IsEmptyFilter,
    string EmptyFilterMessage,
    string ClearFilterLabel,
    LinearSidebarContentState ContentState);

/// <summary>
/// The pure projection from the sidebar inputs (the section catalogue, the ordered pinned keys, the active path,
/// the label resolver, the per-section collapse set, the tree filter and the badge counts) to the render-ready
/// <see cref="LinearSidebarDisplay"/> — the native port of the web <c>LinearSidebar</c> body (the
/// <c>filteredSections</c> / <c>expandedSections</c> memos and the favorites / section / empty-filter render) in
/// web/src/components/layout/sidebar/LinearSidebar.tsx. The active-path test, the whitespace tokenizer, the
/// every-token substring match, the auto-expand-on-filter rule and the trailing-badge routing mirror the web
/// branch-for-branch. Every surface-owned string resolves through the i18n facade using the web's exact keys.
/// No SI conversion applies — the surface carries no measurements.
/// </summary>
public static class LinearSidebarProjection
{
    private static readonly LinearNavLinkDisplay[] NoRows = Array.Empty<LinearNavLinkDisplay>();

    /// <summary>
    /// Whether <paramref name="to"/> is the active path for <paramref name="pathname"/> — the web
    /// <c>isActiveLinearPath</c>: the root matches only itself; any other route matches an exact path or a
    /// descendant (<c>pathname === to || pathname.startsWith(to + '/')</c>).
    /// </summary>
    public static bool IsActivePath(string pathname, string to)
    {
        ArgumentNullException.ThrowIfNull(pathname);
        ArgumentNullException.ThrowIfNull(to);
        if (string.Equals(to, "/", StringComparison.Ordinal))
        {
            return string.Equals(pathname, "/", StringComparison.Ordinal);
        }

        return string.Equals(pathname, to, StringComparison.Ordinal)
            || pathname.StartsWith(to + "/", StringComparison.Ordinal);
    }

    /// <summary>
    /// Split a raw filter into lower-cased tokens — the web
    /// <c>filter.trim().toLowerCase().split(/\s+/).filter(Boolean)</c>. A null / blank filter yields no tokens.
    /// </summary>
    public static IReadOnlyList<string> Tokenize(string? filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return Array.Empty<string>();
        }

        return filter.Trim().ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    }

    /// <summary>
    /// Whether <paramref name="label"/> matches every token — the web <c>matchesFilter</c>
    /// (<c>filterTokens.every(token =&gt; haystack.includes(token))</c>). An empty token set matches everything.
    /// </summary>
    public static bool Matches(string label, IReadOnlyList<string> tokens)
    {
        ArgumentNullException.ThrowIfNull(tokens);
        if (tokens.Count == 0)
        {
            return true;
        }

        string haystack = (label ?? string.Empty).ToLowerInvariant();
        foreach (string token in tokens)
        {
            if (!haystack.Contains(token, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Resolve the ordered pinned keys into nav items by first occurrence across the sections — the native
    /// analogue of Layout deriving <c>pinnedItems</c> from the pin state and the canonical nav tree. A pinned
    /// key with no matching section item is skipped (defensive; Layout only ever pins real nav items).
    /// </summary>
    public static IReadOnlyList<LinearNavItem> ResolvePinned(
        IReadOnlyList<LinearNavSection> sections,
        IReadOnlyList<string> pinnedKeys)
    {
        ArgumentNullException.ThrowIfNull(sections);
        ArgumentNullException.ThrowIfNull(pinnedKeys);

        var byTo = new Dictionary<string, LinearNavItem>(StringComparer.Ordinal);
        foreach (LinearNavSection section in sections)
        {
            foreach (LinearNavItem item in section.Items)
            {
                byTo.TryAdd(item.To, item);
            }
        }

        var resolved = new List<LinearNavItem>(pinnedKeys.Count);
        foreach (string key in pinnedKeys)
        {
            if (byTo.TryGetValue(key, out LinearNavItem? item))
            {
                resolved.Add(item);
            }
        }

        return resolved;
    }

    /// <summary>
    /// Project the full render-ready sidebar view from the current inputs.
    /// </summary>
    /// <param name="sections">The section catalogue (web <c>sections</c> prop).</param>
    /// <param name="pinnedKeys">The ordered pinned route keys (web <c>pinnedItems</c> source, P1/S8).</param>
    /// <param name="pathname">The active path (web <c>effectivePath</c>: the <c>pathname</c> prop or live location).</param>
    /// <param name="navLabel">The label resolver (web <c>navLabel</c> prop); null is treated as identity.</param>
    /// <param name="collapsed">The set of collapsed section titles (web <c>collapsed</c> state).</param>
    /// <param name="filter">The raw tree filter (web <c>filter</c> state).</param>
    /// <param name="alertCount">The unread alert count (web <c>alertCount</c> prop).</param>
    /// <param name="vehicleCount">The vehicle count (web <c>vehicleCount</c> prop).</param>
    /// <param name="staleCount">The stale-rows count (web <c>staleCount</c> prop).</param>
    /// <param name="localizer">The i18n facade every surface-owned string resolves through (P1/S10).</param>
    public static LinearSidebarDisplay Project(
        IReadOnlyList<LinearNavSection> sections,
        IReadOnlyList<string> pinnedKeys,
        string pathname,
        Func<string, string>? navLabel,
        IReadOnlySet<string> collapsed,
        string? filter,
        int alertCount,
        int vehicleCount,
        int staleCount,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(sections);
        ArgumentNullException.ThrowIfNull(pinnedKeys);
        ArgumentNullException.ThrowIfNull(pathname);
        ArgumentNullException.ThrowIfNull(collapsed);
        ArgumentNullException.ThrowIfNull(localizer);

        Func<string, string> label = navLabel ?? (static s => s);
        IReadOnlyList<string> tokens = Tokenize(filter);
        bool filterActive = tokens.Count > 0;

        string pinTemplate = localizer.GetString(LinearSidebarRegistration.PinPageKey, LinearSidebarRegistration.PinPageFallback);
        string unpinTemplate = localizer.GetString(LinearSidebarRegistration.UnpinPageKey, LinearSidebarRegistration.UnpinPageFallback);
        var pinnedSet = new HashSet<string>(pinnedKeys, StringComparer.Ordinal);

        // Favorites — the header shows whenever anything is pinned, even if the filter hides every row.
        IReadOnlyList<LinearNavItem> pinnedItems = ResolvePinned(sections, pinnedKeys);
        LinearFavoritesDisplay? favorites = null;
        if (pinnedItems.Count > 0)
        {
            var rows = new List<LinearNavLinkDisplay>(pinnedItems.Count);
            foreach (LinearNavItem item in pinnedItems)
            {
                string resolved = label(item.Label);
                if (!Matches(resolved, tokens))
                {
                    continue;
                }

                rows.Add(BuildRow(
                    item, resolved, pathname, alertCount, vehicleCount, staleCount,
                    showPin: false, showUnpin: true, pinTemplate, unpinTemplate, localizer));
            }

            favorites = new LinearFavoritesDisplay(
                localizer.GetString(LinearSidebarRegistration.FavoritesKey, LinearSidebarRegistration.FavoritesFallback),
                rows);
        }

        // Sections — keep only those with at least one matching row (web expandedSections filter).
        var sectionDisplays = new List<LinearSectionDisplay>(sections.Count);
        foreach (LinearNavSection section in sections)
        {
            var rows = new List<LinearNavLinkDisplay>(section.Items.Count);
            foreach (LinearNavItem item in section.Items)
            {
                string resolved = label(item.Label);
                if (!Matches(resolved, tokens))
                {
                    continue;
                }

                rows.Add(BuildRow(
                    item, resolved, pathname, alertCount, vehicleCount, staleCount,
                    showPin: !pinnedSet.Contains(item.To), showUnpin: false, pinTemplate, unpinTemplate, localizer));
            }

            if (rows.Count == 0)
            {
                continue;
            }

            bool expanded = filterActive || !collapsed.Contains(section.Title);
            sectionDisplays.Add(new LinearSectionDisplay(section.Title, rows.Count, expanded, rows));
        }

        bool emptyFilter = filterActive && sectionDisplays.Count == 0;

        return new LinearSidebarDisplay(
            NavAutomationName: localizer.GetString(LinearSidebarRegistration.SidebarKey, LinearSidebarRegistration.SidebarFallback),
            Favorites: favorites,
            Sections: sectionDisplays,
            IsFilterActive: filterActive,
            IsEmptyFilter: emptyFilter,
            EmptyFilterMessage: localizer.GetString(LinearSidebarRegistration.FilterNoMatchKey, LinearSidebarRegistration.FilterNoMatchFallback),
            ClearFilterLabel: localizer.GetString(LinearSidebarRegistration.FilterClearKey, LinearSidebarRegistration.FilterClearFallback),
            ContentState: emptyFilter ? LinearSidebarContentState.EmptyFilter : LinearSidebarContentState.Tree);
    }

    private static LinearNavLinkDisplay BuildRow(
        LinearNavItem item,
        string resolvedLabel,
        string pathname,
        int alertCount,
        int vehicleCount,
        int staleCount,
        bool showPin,
        bool showUnpin,
        string pinTemplate,
        string unpinTemplate,
        ILocalizer localizer)
    {
        (LinearTrailingKind kind, int value, string trailingLabel) =
            TrailingFor(item.To, alertCount, vehicleCount, staleCount, localizer);

        return new LinearNavLinkDisplay(
            To: item.To,
            Label: resolvedLabel,
            Glyph: item.Glyph,
            IsActive: IsActivePath(pathname, item.To),
            DataTour: item.DataTour,
            Trailing: kind,
            TrailingValue: value,
            TrailingLabel: trailingLabel,
            ShowPin: showPin,
            PinLabel: LinearSidebarRegistration.FormatPage(pinTemplate, resolvedLabel),
            ShowUnpin: showUnpin,
            UnpinLabel: LinearSidebarRegistration.FormatPage(unpinTemplate, resolvedLabel),
            AutomationName: resolvedLabel);
    }

    /// <summary>
    /// The trailing affordance for a route — the web <c>trailingFor()</c>: an unread dot for the alerts route,
    /// a vehicles chip for the vehicles route, a stale-rows chip for the data-repair route (each only when its
    /// count is positive), or none. The chip's accessible name is localized + interpolated.
    /// </summary>
    public static (LinearTrailingKind Kind, int Value, string Label) TrailingFor(
        string to,
        int alertCount,
        int vehicleCount,
        int staleCount,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(to);
        ArgumentNullException.ThrowIfNull(localizer);

        if (string.Equals(to, LinearSidebarRegistration.AlertsRoute, StringComparison.Ordinal) && alertCount > 0)
        {
            return (LinearTrailingKind.NotificationDot, 0, string.Empty);
        }

        if (string.Equals(to, LinearSidebarRegistration.VehiclesRoute, StringComparison.Ordinal) && vehicleCount > 0)
        {
            string template = localizer.GetString(
                LinearSidebarRegistration.VehicleCountKey, LinearSidebarRegistration.VehicleCountFallback);
            return (LinearTrailingKind.CountChip, vehicleCount, LinearSidebarRegistration.FormatCount(template, vehicleCount));
        }

        if (string.Equals(to, LinearSidebarRegistration.DataRepairRoute, StringComparison.Ordinal) && staleCount > 0)
        {
            string template = localizer.GetString(
                LinearSidebarRegistration.StaleCountKey, LinearSidebarRegistration.StaleCountFallback);
            return (LinearTrailingKind.CountChip, staleCount, LinearSidebarRegistration.FormatCount(template, staleCount));
        }

        return (LinearTrailingKind.None, 0, string.Empty);
    }
}

/// <summary>
/// PII-safe diagnostics for the LinearSidebar surface (P1/S11 diagnostics contract). A sidebar's rows carry
/// route paths and nav labels that can hint at a user's feature usage, so the collector records ONLY the
/// operational <see cref="RecordViewOpened"/> signal with the surface slug — never a route, a label or a pin.
/// Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class LinearSidebarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LinearSidebarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LinearSidebar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={LinearSidebarRegistration.Slug}"));
    }
}
