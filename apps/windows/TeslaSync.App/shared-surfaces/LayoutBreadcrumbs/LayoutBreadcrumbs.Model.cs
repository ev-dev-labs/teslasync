using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>LayoutBreadcrumbs</c> shared surface — the native mirror of the literals and
/// behaviour in <c>web/src/components/layout/LayoutBreadcrumbs.tsx</c> together with the two data sources it
/// composes (<c>web/src/hooks/useBreadcrumbs.ts</c> + <c>web/src/components/layout/BreadcrumbOverridesContext.tsx</c>)
/// and the <c>Breadcrumbs</c> renderer (<c>web/src/components/layout/Breadcrumbs.tsx</c>). The web surface is the
/// single canonical breadcrumb row mounted in the global layout chrome: it reads per-page label overrides from the
/// overrides context, resolves the full parent chain for the current route via <c>useBreadcrumbs</c>, and renders a
/// leading Home icon link plus a chevron-separated trail through <c>Breadcrumbs</c>, which self-suppresses when the
/// chain has one or zero items so top-level pages render an empty slot. This holder pins the diagnostics slug, the
/// two accessibility i18n keys (<c>a11y.breadcrumb</c>, <c>a11y.breadcrumbHome</c>) with their verbatim English
/// fallbacks, the Segoe Fluent glyphs for the Home and chevron affordances, the leaf-truncation width, the compact
/// (mobile-collapse) breakpoint and the automation ids. UI-free so the metadata is asserted headlessly.
/// </summary>
public static class LayoutBreadcrumbsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "LayoutBreadcrumbs";

    /// <summary>i18n key for the nav landmark label (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c> at Breadcrumbs.tsx L39).</summary>
    public const string NavLabelKey = "translation.a11y.breadcrumb";

    /// <summary>English fallback for <see cref="NavLabelKey"/> — the web default value, verbatim.</summary>
    public const string NavLabelFallback = "Breadcrumb";

    /// <summary>i18n key for the Home link's accessible name (web <c>t('a11y.breadcrumbHome', 'Dashboard')</c> at Breadcrumbs.tsx L45).</summary>
    public const string HomeLabelKey = "translation.a11y.breadcrumbHome";

    /// <summary>English fallback for <see cref="HomeLabelKey"/> — the web default value, verbatim.</summary>
    public const string HomeLabelFallback = "Dashboard";

    /// <summary>Destination of the leading Home link (web <c>homeHref = '/'</c> at Breadcrumbs.tsx L31).</summary>
    public const string HomeHref = "/";

    /// <summary>Segoe Fluent Icons glyph for the leading Home affordance (web <c>&lt;Home /&gt;</c>); mirrors the Dashboard route glyph.</summary>
    public const string HomeGlyph = "\uE80F";

    /// <summary>Segoe Fluent Icons glyph for the crumb separator (web <c>&lt;ChevronRight /&gt;</c>).</summary>
    public const string SeparatorGlyph = "\uE76C";

    /// <summary>The collapsed-middle indicator shown on a narrow row (web <c>…</c> at Breadcrumbs.tsx L80).</summary>
    public const string CollapseIndicator = "\u2026";

    /// <summary>Maximum rendered width of a crumb label before it truncates (web <c>max-w-[200px]</c>).</summary>
    public const double MaxLabelWidth = 200.0;

    /// <summary>
    /// Row width below which middle crumbs collapse to the <see cref="CollapseIndicator"/> (web Tailwind <c>sm</c>
    /// breakpoint, 640px — middles carry <c>hidden sm:inline</c> and the indicator carries <c>sm:hidden</c>).
    /// </summary>
    public const double CompactThreshold = 640.0;

    /// <summary>Automation id exposed by the nav landmark (the web breadcrumb <c>&lt;nav&gt;</c>).</summary>
    public const string NavAutomationId = "breadcrumb";

    /// <summary>Automation id exposed by the leading Home link.</summary>
    public const string HomeAutomationId = "breadcrumb-home";

    /// <summary>Resolve the localized nav landmark label (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveNavLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NavLabelKey, NavLabelFallback);
    }

    /// <summary>Resolve the Home link's accessible name (web <c>t('a11y.breadcrumbHome', 'Dashboard')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveHomeLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(HomeLabelKey, HomeLabelFallback);
    }
}

/// <summary>
/// The breadcrumb-specific parent chain — the native port of <c>PARENT_OVERRIDES</c> in
/// <c>web/src/lib/routeMeta.ts</c>. The web breadcrumb hierarchy is NOT pure URL nesting: detail and nested routes
/// opt into a parent pattern here, and everything else is treated as a top-level page (a single-item chain that the
/// renderer suppresses). Keys and values are native route patterns (the leading slash of the web pattern is dropped
/// and the web root <c>'/'</c> maps to the empty index pattern), so they line up with
/// <see cref="TeslaSync.App.Core.Navigation.RouteDefinition.PathPattern"/>. Every key and value is a real entry in
/// <see cref="TeslaSync.App.Core.Navigation.RouteTable.All"/>.
/// </summary>
public static class BreadcrumbParentChain
{
    /// <summary>
    /// Pattern → parent pattern, the native equivalent of the web <c>PARENT_OVERRIDES</c> record. A pattern absent
    /// from this map has no parent, so it resolves to a single-item chain (suppressed by the renderer).
    /// </summary>
    public static IReadOnlyDictionary<string, string> Patterns { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["drives/:id"] = "drives",
            ["drives/:id/replay"] = "drives/:id",
            ["charging/:id"] = "charging",
            ["vehicles/:id"] = "vehicles",
            ["vehicles/:id/access"] = "vehicles/:id",
            ["trips/:id"] = "trips",
            ["automations/new"] = "automations",
            ["automations/:id/edit"] = "automations",
            ["notifications/studio"] = "notifications/inbox",
            ["notifications/archived"] = "notifications/inbox",
            ["year-review/:year"] = "analytics",
            ["me/activity"] = string.Empty,
        };
}

/// <summary>
/// A single resolved breadcrumb entry — the native analogue of the web <c>LayoutBreadcrumbItem</c>
/// (<c>web/src/components/layout/Breadcrumbs.tsx</c> L7-10). <see cref="Href"/> is <see langword="null"/> for the
/// trailing, current-page crumb (the web <c>href?: string</c> being undefined), which renders as non-interactive
/// medium-weight text; non-null for ancestor crumbs, which render as links. Pure value so the resolved trail is
/// asserted without a UI host.
/// </summary>
/// <param name="Label">The already-localized, parameter-substituted display label.</param>
/// <param name="Href">The activation path for an ancestor crumb, or <see langword="null"/> for the current crumb.</param>
/// <param name="IsCurrent">True for the trailing crumb (the current page; never a link).</param>
public readonly record struct LayoutBreadcrumbItem(string Label, string? Href, bool IsCurrent)
{
    /// <summary>True when this crumb is an interactive link (an ancestor with a non-empty <see cref="Href"/>).</summary>
    public bool IsLink => !IsCurrent && !string.IsNullOrEmpty(Href);
}

/// <summary>
/// One route's breadcrumb metadata — the native analogue of a single <c>ROUTE_META</c> entry in
/// <c>web/src/lib/routeMeta.ts</c> (<c>{ i18nKey, defaultLabel, parent? }</c>). <see cref="Pattern"/> is the route's
/// native path pattern (the lookup key); <see cref="ParentPattern"/> is the next pattern the resolver walks toward
/// the root, or <see langword="null"/> for a top-level route.
/// </summary>
/// <param name="Pattern">The route path pattern this metadata describes (the lookup key).</param>
/// <param name="TitleKey">i18n key for the crumb label (web <c>meta.i18nKey</c>).</param>
/// <param name="DefaultTitle">English fallback label (web <c>meta.defaultLabel</c>).</param>
/// <param name="ParentPattern">The parent route pattern to walk toward, or <see langword="null"/> at the root.</param>
public readonly record struct BreadcrumbRouteMeta(
    string Pattern,
    string TitleKey,
    string DefaultTitle,
    string? ParentPattern);

/// <summary>
/// Pure projection of a matched route + its parameters + the active override map into the ordered breadcrumb trail —
/// the native port of <c>useBreadcrumbs</c> (<c>web/src/hooks/useBreadcrumbs.ts</c>). It reproduces that hook
/// exactly: walk the parent chain from the matched pattern toward the root (cycle-safe), resolve each label as
/// <c>override ?? t(i18nKey, defaultLabel)</c>, substitute <c>{{param}}</c> tokens, compose each ancestor's
/// href by substituting <c>:param</c> values (the leaf/current crumb gets no href), and return the trail in
/// root-to-current order. An unmatched route (or a matched pattern with no metadata) yields an empty trail, which the
/// renderer suppresses. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BreadcrumbResolver
{
    /// <summary>
    /// Resolve the breadcrumb trail for <paramref name="matchedPattern"/>. Returns an empty list when the pattern is
    /// <see langword="null"/> or absent from <paramref name="routeMeta"/> (web returns <c>[]</c> for unknown routes).
    /// </summary>
    /// <param name="matchedPattern">The matched route's path pattern (web matched <c>ROUTE_META</c> key), or null.</param>
    /// <param name="parameters">Extracted <c>:param</c> values (web <c>useParams</c>).</param>
    /// <param name="overrides">Per-route label overrides keyed by pattern (web <c>useBreadcrumbOverrides</c>).</param>
    /// <param name="routeMeta">Pattern → metadata lookup (web <c>ROUTE_META</c>).</param>
    /// <param name="localizer">The i18n facade labels resolve through (web <c>useTranslation</c>).</param>
    public static IReadOnlyList<LayoutBreadcrumbItem> Resolve(
        string? matchedPattern,
        IReadOnlyDictionary<string, string> parameters,
        IReadOnlyDictionary<string, string> overrides,
        IReadOnlyDictionary<string, BreadcrumbRouteMeta> routeMeta,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(parameters);
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(routeMeta);
        ArgumentNullException.ThrowIfNull(localizer);

        if (matchedPattern is null)
        {
            return [];
        }

        var trail = new List<LayoutBreadcrumbItem>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = matchedPattern;

        while (current is not null)
        {
            // Defensive cycle break (the web hook keeps an identical `visited` guard).
            if (!visited.Add(current))
            {
                break;
            }

            if (!routeMeta.TryGetValue(current, out BreadcrumbRouteMeta meta))
            {
                break;
            }

            // Label precedence: page-supplied override > i18n key > default label (web L59-60).
            string label = overrides.TryGetValue(current, out string? overrideLabel) && !string.IsNullOrEmpty(overrideLabel)
                ? overrideLabel
                : localizer.GetString(meta.TitleKey, meta.DefaultTitle);

            label = SubstituteLabelParameters(label, parameters);

            // The trailing (current) crumb is plain text — no link (web L76).
            bool isCurrent = string.Equals(current, matchedPattern, StringComparison.Ordinal);
            string? href = isCurrent ? null : BuildHref(current, parameters);

            // unshift — keep root-to-current order (web L73 items.unshift).
            trail.Insert(0, new LayoutBreadcrumbItem(label, href, isCurrent));

            current = meta.ParentPattern;
        }

        return trail;
    }

    /// <summary>
    /// Substitute <c>{{param}}</c> tokens in a label with their concrete values — the web hook's
    /// <c>label.replace("{{key}}", value)</c> loop (useBreadcrumbs.ts L63-65). Labels without tokens are
    /// returned unchanged.
    /// </summary>
    /// <param name="label">The raw label, possibly containing <c>{{param}}</c> tokens.</param>
    /// <param name="parameters">The extracted route parameter values.</param>
    public static string SubstituteLabelParameters(string label, IReadOnlyDictionary<string, string> parameters)
    {
        ArgumentNullException.ThrowIfNull(label);
        ArgumentNullException.ThrowIfNull(parameters);

        if (parameters.Count == 0 || !label.Contains("{{", StringComparison.Ordinal))
        {
            return label;
        }

        string resolved = label;
        foreach (KeyValuePair<string, string> parameter in parameters)
        {
            if (!string.IsNullOrEmpty(parameter.Value))
            {
                resolved = resolved.Replace($"{{{{{parameter.Key}}}}}", parameter.Value, StringComparison.Ordinal);
            }
        }

        return resolved;
    }

    /// <summary>
    /// Compose a crumb's activation path from its pattern by substituting <c>:param</c> values — the web hook's
    /// <c>href.replace(":key", value)</c> loop (useBreadcrumbs.ts L68-71), then prefixing the application-root slash
    /// so the empty index pattern becomes <c>"/"</c>. Parameters not present in the map are left as-is (web parity).
    /// </summary>
    /// <param name="pattern">The route path pattern (no leading slash; the empty string is the index route).</param>
    /// <param name="parameters">The extracted route parameter values.</param>
    public static string BuildHref(string pattern, IReadOnlyDictionary<string, string> parameters)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        ArgumentNullException.ThrowIfNull(parameters);

        string built = pattern;
        foreach (KeyValuePair<string, string> parameter in parameters)
        {
            if (!string.IsNullOrEmpty(parameter.Value))
            {
                built = built.Replace($":{parameter.Key}", parameter.Value, StringComparison.Ordinal);
            }
        }

        return "/" + built;
    }
}

/// <summary>
/// The matched-route port the breadcrumb holder binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useLocation()</c> + <c>useParams()</c> + route match that <c>useBreadcrumbs</c> reads. The view never touches
/// the router directly: a shell adapter (or a test fake) exposes the matched route's path pattern and its extracted
/// parameters, raising <see cref="Changed"/> on every navigation (mirroring react-router re-rendering on a pathname
/// change), so the trail derivation is asserted headlessly. <see cref="MatchedPattern"/> is <see langword="null"/>
/// only when nothing is matched.
/// </summary>
public interface IBreadcrumbRouteContext
{
    /// <summary>The matched route's native path pattern (the resolver's start key), or null when unmatched.</summary>
    string? MatchedPattern { get; }

    /// <summary>The extracted <c>:param</c> values for the current match (web <c>useParams</c>); empty for static routes.</summary>
    IReadOnlyDictionary<string, string> Parameters { get; }

    /// <summary>Raised on every navigation (web effect re-run on a pathname change).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The per-page override port the breadcrumb holder binds to (P1/S8 state-holder seam) — the native analogue of the
/// web <c>useBreadcrumbOverrides()</c> context value (<c>BreadcrumbOverridesContext.tsx</c>). Pages push dynamic
/// labels (for example <c>"Drive #4421" → "Trip to office"</c>) up to the single global breadcrumb keyed by route
/// pattern; this seam yields the merged map and raises <see cref="Changed"/> whenever a registration is added or
/// removed.
/// </summary>
public interface IBreadcrumbOverrideSource
{
    /// <summary>The merged per-route label overrides keyed by route pattern (web merged context map).</summary>
    IReadOnlyDictionary<string, string> OverrideLabels { get; }

    /// <summary>Raised whenever the merged override map changes (a page registers or unregisters labels).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The navigation port a breadcrumb link activates (P1/S8 state-holder seam) — the native analogue of the web
/// <c>PrefetchLink</c> <c>to</c> navigation. The view never drives the router itself: it asks this seam to navigate
/// to a crumb's href (or the Home href), so activation is asserted headlessly. The production adapter routes through
/// the shell navigation service; <see cref="NullLayoutBreadcrumbNavigator"/> stands in when no navigator is supplied.
/// </summary>
public interface ILayoutBreadcrumbNavigator
{
    /// <summary>Navigate to <paramref name="href"/> (web breadcrumb link / Home link click).</summary>
    /// <param name="href">The destination path (an ancestor crumb's href, or the Home href).</param>
    void Navigate(string href);
}

/// <summary>
/// The inert navigation seam used when no navigator is supplied — the native analogue of mounting the breadcrumb
/// without a live router: activation is a safe no-op that never throws. Used by the design-time / headless entry
/// points; the composition root supplies a real <see cref="ILayoutBreadcrumbNavigator"/>.
/// </summary>
public sealed class NullLayoutBreadcrumbNavigator : ILayoutBreadcrumbNavigator
{
    /// <summary>The shared inert instance.</summary>
    public static NullLayoutBreadcrumbNavigator Instance { get; } = new();

    private NullLayoutBreadcrumbNavigator()
    {
    }

    /// <inheritdoc />
    public void Navigate(string href)
    {
        // No router mounted — the activation does nothing (never throws).
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LayoutBreadcrumbs</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never a crumb label or an href, either of which can carry fleet
/// identifiers (a <c>/charging/{id}</c> path, a friendly label naming a place) — so a diagnostics line can never leak
/// where a user is. Emits the <c>view.opened</c> event the prompt requires plus the resolved / suppressed / navigated
/// outcomes. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class LayoutBreadcrumbsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _resolved;
    private long _suppressed;
    private long _navigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no label or href is ever passed).</param>
    public LayoutBreadcrumbsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times a multi-crumb trail was resolved and rendered.</summary>
    public long Resolved => Interlocked.Read(ref _resolved);

    /// <summary>Number of times the trail was suppressed (one or zero crumbs — a top-level page).</summary>
    public long Suppressed => Interlocked.Read(ref _suppressed);

    /// <summary>Number of crumb / Home activations routed to the navigator.</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LayoutBreadcrumbs</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LayoutBreadcrumbsRegistration.Slug}");
    }

    /// <summary>Record a rendered multi-crumb trail, emitting <c>breadcrumb.resolved slug=LayoutBreadcrumbs</c> (no labels).</summary>
    public void RecordResolved()
    {
        Interlocked.Increment(ref _resolved);
        _sink?.Invoke($"breadcrumb.resolved slug={LayoutBreadcrumbsRegistration.Slug}");
    }

    /// <summary>Record a suppressed (top-level) trail, emitting <c>breadcrumb.suppressed slug=LayoutBreadcrumbs</c>.</summary>
    public void RecordSuppressed()
    {
        Interlocked.Increment(ref _suppressed);
        _sink?.Invoke($"breadcrumb.suppressed slug={LayoutBreadcrumbsRegistration.Slug}");
    }

    /// <summary>Record a crumb / Home activation, emitting <c>breadcrumb.navigated slug=LayoutBreadcrumbs</c> (no href).</summary>
    public void RecordNavigated()
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke($"breadcrumb.navigated slug={LayoutBreadcrumbsRegistration.Slug}");
    }
}
