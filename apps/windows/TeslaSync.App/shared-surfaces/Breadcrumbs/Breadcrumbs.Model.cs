using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>Breadcrumbs</c> shared surface — the native mirror of
/// web/src/components/layout/Breadcrumbs.tsx. The web component is the layout-chrome breadcrumb trail: a
/// <c>&lt;nav aria-label="Breadcrumb"&gt;</c> with a leading Home icon link followed by chevron-separated
/// crumbs, where the trailing crumb is the non-interactive current page and any earlier crumb with an
/// <c>href</c> is a link. It self-suppresses (<c>if (items.length &lt;= 1) return null</c>) so top-level pages
/// render nothing, and on a narrow viewport it hides the middle crumbs (Tailwind <c>hidden sm:inline</c>) and
/// shows a per-crumb <c>…</c> indicator instead. It resolves two i18n keys —
/// <c>t('a11y.breadcrumb', 'Breadcrumb')</c> for the landmark name and
/// <c>t('a11y.breadcrumbHome', 'Dashboard')</c> for the Home link — and has no data fetch, so there is no
/// loading / error / stale / offline chrome. This holder pins the diagnostics slug, the two i18n keys with
/// their verbatim English fallbacks, the default home destination, the collapse threshold (the <c>sm</c>
/// breakpoint), the label truncation width, and the icon glyphs / metrics the view draws with. UI-free so the
/// metadata is asserted headlessly.
/// </summary>
public static class BreadcrumbsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Breadcrumbs";

    /// <summary>i18n key for the landmark name (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c> at Breadcrumbs.tsx L39).</summary>
    public const string NavLabelKey = "translation.a11y.breadcrumb";

    /// <summary>English fallback for <see cref="NavLabelKey"/> — the web default value, verbatim.</summary>
    public const string NavLabelFallback = "Breadcrumb";

    /// <summary>i18n key for the Home link label (web <c>t('a11y.breadcrumbHome', 'Dashboard')</c> at Breadcrumbs.tsx L45).</summary>
    public const string HomeLabelKey = "translation.a11y.breadcrumbHome";

    /// <summary>English fallback for <see cref="HomeLabelKey"/> — the web default value, verbatim.</summary>
    public const string HomeLabelFallback = "Dashboard";

    /// <summary>Default destination of the leading Home link (web <c>homeHref = '/'</c>).</summary>
    public const string DefaultHomeHref = "/";

    /// <summary>The trail must have at least this many crumbs to render (web <c>items.length &lt;= 1</c> → null).</summary>
    public const int MinimumTrailLength = 2;

    /// <summary>Below this width the middle crumbs collapse (web Tailwind <c>sm</c> breakpoint, 640px).</summary>
    public const double CollapseWidthThreshold = 640.0;

    /// <summary>Maximum crumb-label width before it truncates (web <c>max-w-[200px]</c>).</summary>
    public const double MaxLabelWidth = 200.0;

    /// <summary>Horizontal gap between trail elements (web <c>gap-1</c>, 4px).</summary>
    public const double RowSpacing = 4.0;

    /// <summary>Crumb label font size (web <c>text-sm</c>, 14px).</summary>
    public const double LabelFontSize = 14.0;

    /// <summary>Home icon size (web <c>h-3.5 w-3.5</c>, 14px).</summary>
    public const double HomeIconSize = 14.0;

    /// <summary>Chevron separator size (web <c>h-3 w-3</c>, 12px).</summary>
    public const double SeparatorIconSize = 12.0;

    /// <summary>Crumb-label weight for the current page (web <c>font-medium</c>, 500).</summary>
    public const ushort CurrentLabelWeight = 500;

    /// <summary>Segoe Fluent "Home" glyph backing the leading Home link (web lucide <c>Home</c>).</summary>
    public const string HomeGlyph = "\uE80F";

    /// <summary>Segoe Fluent "ChevronRight" glyph backing the crumb separator (web lucide <c>ChevronRight</c>).</summary>
    public const string SeparatorGlyph = "\uE76C";

    /// <summary>Horizontal-ellipsis shown for a collapsed middle crumb on a narrow viewport (web <c>…</c>).</summary>
    public const string CollapsedIndicator = "\u2026";

    /// <summary>Resolve the localized landmark name (web <c>t('a11y.breadcrumb', 'Breadcrumb')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveNavLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NavLabelKey, NavLabelFallback);
    }

    /// <summary>Resolve the localized Home link label (web <c>t('a11y.breadcrumbHome', 'Dashboard')</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ResolveHomeLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(HomeLabelKey, HomeLabelFallback);
    }
}

/// <summary>
/// A single breadcrumb input entry — the native analogue of the web <c>BreadcrumbItem</c>
/// (<c>{ label: string; href?: string }</c>) the component receives as a prop. A null/empty
/// <see cref="Href"/> marks a non-link crumb (the web <c>href</c> being <c>undefined</c> = current page);
/// the trailing crumb is always rendered as text regardless of its <see cref="Href"/>.
/// </summary>
/// <param name="Label">Display label (already localized by the caller, exactly like the web prop).</param>
/// <param name="Href">Route the crumb links to, or null/empty for a non-link crumb (web <c>href?</c>).</param>
public readonly record struct BreadcrumbItem(string Label, string? Href = null);

/// <summary>
/// A projected breadcrumb crumb — an input <see cref="BreadcrumbItem"/> enriched with the position flags the
/// web component computes inside its <c>items.map((item, i) =&gt; …)</c>: whether it is the trailing current
/// page (<see cref="IsLast"/>), a collapsible middle crumb (<see cref="IsMiddle"/>), and whether it renders as
/// a link or as text (<see cref="IsLink"/>). Pure value so the projection is asserted without a UI host.
/// </summary>
/// <param name="Label">The crumb label.</param>
/// <param name="Href">The crumb's route, or null/empty when it is not a link.</param>
/// <param name="Index">The crumb's zero-based position in the trail.</param>
/// <param name="IsLast">True for the trailing, current-page crumb (web <c>i === items.length - 1</c>).</param>
/// <param name="IsMiddle">True for a crumb that is neither first nor last (web <c>i &gt; 0 &amp;&amp; !isLast</c>); these collapse on a narrow viewport.</param>
/// <param name="IsLink">True when the crumb renders as a link (web <c>!(isLast || !item.href)</c>).</param>
public readonly record struct BreadcrumbCrumb(
    string Label,
    string? Href,
    int Index,
    bool IsLast,
    bool IsMiddle,
    bool IsLink);

/// <summary>
/// The projected breadcrumb trail — whether the surface renders at all (<see cref="Visible"/>, the web
/// <c>items.length &gt; 1</c> guard) and the ordered <see cref="Crumbs"/> the view lays out after the leading
/// Home link. When <see cref="Visible"/> is false the web component returns <c>null</c> and the native surface
/// collapses; <see cref="Crumbs"/> still reflects the input so the projection is fully testable.
/// </summary>
/// <param name="Visible">True when the trail has more than one crumb and should render (web <c>!(items.length &lt;= 1)</c>).</param>
/// <param name="Crumbs">The projected crumbs in order.</param>
public readonly record struct BreadcrumbTrailView(bool Visible, IReadOnlyList<BreadcrumbCrumb> Crumbs);

/// <summary>
/// Pure projection of breadcrumb input items into a <see cref="BreadcrumbTrailView"/> — the native port of the
/// web component's render body (web/src/components/layout/Breadcrumbs.tsx): the <c>items.length &lt;= 1</c>
/// self-suppression and the per-item <c>isLast</c> / <c>isMiddle</c> / link-vs-text decision. No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class BreadcrumbProjection
{
    /// <summary>Project <paramref name="items"/> into the trail view, computing each crumb's position flags.</summary>
    /// <param name="items">The breadcrumb input items (web <c>items</c> prop).</param>
    public static BreadcrumbTrailView Build(IReadOnlyList<BreadcrumbItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        int count = items.Count;
        bool visible = count >= BreadcrumbsRegistration.MinimumTrailLength;

        var crumbs = new List<BreadcrumbCrumb>(count);
        for (int i = 0; i < count; i++)
        {
            bool isLast = i == count - 1;
            bool isMiddle = i > 0 && !isLast;

            // web: `isLast || !item.href` renders text; otherwise a link.
            bool isLink = !isLast && !string.IsNullOrEmpty(items[i].Href);

            crumbs.Add(new BreadcrumbCrumb(items[i].Label, items[i].Href, i, isLast, isMiddle, isLink));
        }

        return new BreadcrumbTrailView(visible, crumbs);
    }
}

/// <summary>
/// Pure decision for the responsive middle-crumb collapse — the native port of the web Tailwind
/// <c>hidden sm:inline</c> / <c>sm:hidden</c> pairing: below the <c>sm</c> breakpoint the middle crumbs are
/// hidden and a <c>…</c> indicator is shown instead. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BreadcrumbResponsive
{
    /// <summary>
    /// True when <paramref name="width"/> is a measured width below <paramref name="threshold"/> (web
    /// viewport narrower than <c>sm</c>). A non-positive width (not yet laid out) is treated as wide so the
    /// trail never starts collapsed before its first measurement.
    /// </summary>
    /// <param name="width">The surface's available width.</param>
    /// <param name="threshold">The collapse threshold (web <c>sm</c> breakpoint).</param>
    public static bool IsNarrow(double width, double threshold) => width > 0 && width < threshold;
}

/// <summary>
/// The navigation seam the breadcrumb links route through (P1/S8 state-holder seam) — the native analogue of
/// the web <c>PrefetchLink</c> the component composes (a react-router <c>&lt;Link&gt;</c> that prefetches its
/// target query on hover/focus). The view never touches the router or the query cache directly: a shell
/// adapter (or a test fake) performs the navigation (<see cref="Navigate"/>, web link activation) and the
/// prefetch (<see cref="Prefetch"/>, web hover/focus prefetch), so the breadcrumb's routing is asserted
/// headlessly. <see cref="NullBreadcrumbNavigator"/> stands in when no host is wired (design-time / tests).
/// </summary>
public interface IBreadcrumbNavigator
{
    /// <summary>Navigate to <paramref name="href"/> (web <c>&lt;Link to={href}&gt;</c> activation).</summary>
    /// <param name="href">The destination route.</param>
    void Navigate(string href);

    /// <summary>Prefetch <paramref name="href"/> (web <c>PrefetchLink</c> hover/focus prefetch).</summary>
    /// <param name="href">The route to prefetch.</param>
    void Prefetch(string href);
}

/// <summary>
/// The inert navigation seam used when no host router is wired — the safe design-time / unit-test default.
/// Both operations are no-ops that never throw, mirroring a <c>PrefetchLink</c> rendered outside a router.
/// </summary>
public sealed class NullBreadcrumbNavigator : IBreadcrumbNavigator
{
    /// <summary>The shared inert instance.</summary>
    public static NullBreadcrumbNavigator Instance { get; } = new();

    private NullBreadcrumbNavigator()
    {
    }

    /// <inheritdoc />
    public void Navigate(string href)
    {
        // No router wired — navigation is a safe no-op.
    }

    /// <inheritdoc />
    public void Prefetch(string href)
    {
        // No query cache wired — prefetch is a safe no-op.
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Breadcrumbs</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never a crumb label or an <c>href</c>, either of which can
/// carry fleet identifiers (a VIN-bearing label, a <c>/charging/{id}</c> route) — so a diagnostics line can
/// never leak where a user is or where they navigate. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class BreadcrumbsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _navigations;
    private long _prefetches;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no label or href is ever passed).</param>
    public BreadcrumbsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of crumb activations that triggered a navigation (count only, never the href).</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Number of crumb prefetches triggered on hover/focus (count only, never the href).</summary>
    public long Prefetches => Interlocked.Read(ref _prefetches);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Breadcrumbs</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BreadcrumbsRegistration.Slug}");
    }

    /// <summary>Record a crumb navigation, emitting <c>breadcrumb.navigated slug=Breadcrumbs</c> (no href).</summary>
    public void RecordNavigated()
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke($"breadcrumb.navigated slug={BreadcrumbsRegistration.Slug}");
    }

    /// <summary>Record a crumb prefetch, emitting <c>breadcrumb.prefetched slug=Breadcrumbs</c> (no href).</summary>
    public void RecordPrefetched()
    {
        Interlocked.Increment(ref _prefetches);
        _sink?.Invoke($"breadcrumb.prefetched slug={BreadcrumbsRegistration.Slug}");
    }
}
