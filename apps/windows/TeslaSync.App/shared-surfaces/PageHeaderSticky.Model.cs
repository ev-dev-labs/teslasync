using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>PageHeaderSticky</c> shared surface — the native analogue of the literals in
/// <c>web/src/components/layout/PageHeaderSticky.tsx</c>. The web component is an <c>IntersectionObserver</c>-driven
/// sticky bar: it watches a page-level hero element by <c>targetId</c> and renders a compact bar ONLY once that hero
/// has scrolled above the viewport top (<c>setVisible(!entry.isIntersecting &amp;&amp; entry.boundingClientRect.top &lt; 0)</c>,
/// L64-77); the bar hosts a caller-supplied compressed summary (the web <c>children</c>) and, when
/// <c>scrollToTop</c> is enabled (its default), turns the whole row into a scroll-to-top affordance with a trailing
/// up-arrow whose activation smooth-scrolls the page content back to the top (web <c>handleScrollTop</c>, L79-91).
/// This holder pins the diagnostics slug, the automation ids the region + scroll-to-top control expose, the Segoe
/// Fluent glyph standing in for the web Lucide <c>ArrowUp</c>, and the i18n keys + their verbatim English fallbacks
/// for the default region accessible name and the "scroll to top" suffix the web appends to the caller's
/// <c>ariaLabel</c> (web <c>aria-label={`${ariaLabel} — scroll to top`}</c>, L127). The per-page region label itself
/// is supplied by the host exactly like the web required <c>ariaLabel</c> prop; the registration only provides the
/// localized default for when no host label is given. UI-free so the mapping is asserted headlessly without a XAML
/// runtime.
/// </summary>
public static class PageHeaderStickyRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PageHeaderSticky";

    /// <summary>The automation id the surface (the web <c>role="region"</c> bar) exposes.</summary>
    public const string RegionAutomationId = "page-header-sticky";

    /// <summary>The automation id the scroll-to-top control exposes (web <c>onClick={handleScrollTop}</c> button).</summary>
    public const string ScrollToTopAutomationId = "page-header-sticky-scroll-top";

    /// <summary>Segoe Fluent "Up" glyph — the native stand-in for the web Lucide <c>ArrowUp</c> (matches the W2 atomic).</summary>
    public const string ArrowUpGlyph = "\uE74A";

    /// <summary>
    /// The separator joining the caller's region label and the localized "scroll to top" suffix — the em-dash in
    /// the web <c>aria-label={`${ariaLabel} — scroll to top`}</c> (L127), surrounded by single spaces.
    /// </summary>
    public const string ScrollToTopSeparator = " \u2014 ";

    /// <summary>i18n key for the default region accessible name used when the host supplies no label (web <c>ariaLabel</c> prop).</summary>
    public const string RegionLabelKey = "translation.layout.pageHeaderSticky.region";

    /// <summary>English fallback for <see cref="RegionLabelKey"/> — the generic localized default region name.</summary>
    public const string RegionLabelFallback = "Page summary";

    /// <summary>i18n key for the "scroll to top" suffix appended to the region label on the scroll control (web L127).</summary>
    public const string ScrollToTopSuffixKey = "translation.layout.pageHeaderSticky.scrollToTop";

    /// <summary>English fallback for <see cref="ScrollToTopSuffixKey"/> — the web suffix, verbatim.</summary>
    public const string ScrollToTopSuffixFallback = "scroll to top";

    /// <summary>
    /// Resolve the region accessible name (web <c>ariaLabel</c> prop). The host supplies the per-page label exactly
    /// like the web required prop; when it is null / blank the localized <see cref="RegionLabelFallback"/> default is
    /// used so the region is never anonymous to Narrator.
    /// </summary>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="hostLabel">The host-supplied per-page region label (web <c>ariaLabel</c>); null / blank uses the default.</param>
    public static string ResolveRegionLabel(ILocalizer localizer, string? hostLabel)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrWhiteSpace(hostLabel)
            ? localizer.GetString(RegionLabelKey, RegionLabelFallback)
            : hostLabel.Trim();
    }

    /// <summary>Resolve the localized "scroll to top" suffix (web <c>— scroll to top</c>, L127).</summary>
    /// <param name="localizer">The i18n facade the suffix resolves through.</param>
    public static string ResolveScrollToTopSuffix(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ScrollToTopSuffixKey, ScrollToTopSuffixFallback);
    }

    /// <summary>
    /// Compose the scroll-to-top control's accessible name — the region label, the separator and the localized
    /// suffix (web <c>aria-label={`${ariaLabel} — scroll to top`}</c>, L127).
    /// </summary>
    /// <param name="regionName">The resolved region label (web <c>ariaLabel</c>).</param>
    /// <param name="suffix">The resolved "scroll to top" suffix.</param>
    public static string ComposeScrollToTopName(string regionName, string suffix) =>
        $"{regionName}{ScrollToTopSeparator}{suffix}";
}

/// <summary>
/// The scroll-to-top action seam the <c>PageHeaderSticky</c> surface routes through (P1/S8 state-holder seam) — the
/// native analogue of the web <c>handleScrollTop</c> closure (PageHeaderSticky.tsx L79-91). The web detects the real
/// scroll container (<c>document.getElementById('main-content')</c>, the app's primary scroll element) and smooth-
/// scrolls it to the top, falling back to <c>window</c>. The native view owns no scroll viewport, so activating the
/// bar delegates to a host-supplied scroller; <see cref="NullPageScroller"/> stands in for headless hosts, previews
/// and tests (a safe no-op). The production binding wraps the shell's page <c>ScrollViewer</c>.
/// </summary>
public interface IPageScroller
{
    /// <summary>Smooth-scroll the host content back to the top (web <c>scrollEl.scrollTo({ top: 0, behavior: 'smooth' })</c>).</summary>
    void ScrollToTop();
}

/// <summary>
/// The inert scroller used when no host scroll viewport is wired — the native analogue of the web component being
/// rendered outside the standard layout where the real scroll element is absent: the activation is a safe no-op that
/// never throws. Used by the designer / headless / test constructors.
/// </summary>
public sealed class NullPageScroller : IPageScroller
{
    /// <summary>The shared inert instance.</summary>
    public static NullPageScroller Instance { get; } = new();

    private NullPageScroller()
    {
    }

    /// <inheritdoc />
    public void ScrollToTop()
    {
        // No host scroll viewport wired — nothing to scroll (the web window fallback is a no-op in this context).
    }
}

/// <summary>
/// Pure visibility decision for the sticky bar — the native port of the web <c>IntersectionObserver</c> callback
/// (PageHeaderSticky.tsx L64-72): <c>setVisible(!entry.isIntersecting &amp;&amp; entry.boundingClientRect.top &lt; 0)</c>.
/// The bar is visible exactly when the watched hero is NOT intersecting the viewport AND has scrolled ABOVE the
/// viewport top (so it does not flash while the hero is still below the viewport on first paint of a long page — the
/// web false-positive guard at L66-70). No WinUI types — unit-tested without a UI host.
/// </summary>
public static class PageHeaderStickyVisibility
{
    /// <summary>Decide whether the sticky bar is shown, given the watched hero's intersection state.</summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    /// <param name="targetAboveViewport">Whether the hero has scrolled above the viewport top (web <c>entry.boundingClientRect.top &lt; 0</c>).</param>
    /// <returns>True when the bar should be shown (web <c>visible</c>).</returns>
    public static bool Decide(bool targetIntersecting, bool targetAboveViewport) =>
        !targetIntersecting && targetAboveViewport;
}

/// <summary>
/// The render-time data model the <c>PageHeaderSticky</c> view binds to — the native analogue of the web
/// <c>PageHeaderStickyProps</c> already resolved to render inputs (PageHeaderSticky.tsx L5-30). The web component is
/// purely presentational: its parent owns all content and feeds the already-resolved summary (<c>children</c>),
/// region label (<c>ariaLabel</c>), scroll-to-top flag and top offset, so — exactly like React re-rendering the
/// element with resolved props — there is no fetch-driven loading / error / stale / offline branch to reproduce
/// here. The only branches are the visibility gate (<see cref="TargetIntersecting"/> / <see cref="TargetAboveViewport"/>,
/// the web observer result), whether the bar is the scroll-to-top affordance (<see cref="ScrollToTop"/>) and the top
/// offset placement (<see cref="TopOffset"/>). Pure data — no WinUI types — so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record PageHeaderStickyModel
{
    private PageHeaderStickyModel(
        bool targetIntersecting,
        bool targetAboveViewport,
        bool scrollToTop,
        double topOffset,
        string? regionLabel)
    {
        TargetIntersecting = targetIntersecting;
        TargetAboveViewport = targetAboveViewport;
        ScrollToTop = scrollToTop;
        TopOffset = topOffset;
        RegionLabel = regionLabel;
    }

    /// <summary>
    /// Whether the watched hero is currently on screen (web <c>entry.isIntersecting</c>). When true the bar is hidden
    /// (web <c>if (!visible) return null</c>).
    /// </summary>
    public bool TargetIntersecting { get; }

    /// <summary>
    /// Whether the watched hero has scrolled above the viewport top (web <c>entry.boundingClientRect.top &lt; 0</c>).
    /// The bar shows only when this is true AND the hero is not intersecting (the web false-positive guard).
    /// </summary>
    public bool TargetAboveViewport { get; }

    /// <summary>Whether the whole bar is the scroll-to-top affordance with a trailing arrow (web <c>scrollToTop</c>, default true).</summary>
    public bool ScrollToTop { get; }

    /// <summary>The pixel offset from the top of the viewport when the bar is docked (web <c>topOffset</c>, default 0).</summary>
    public double TopOffset { get; }

    /// <summary>The host-supplied per-page region label (web required <c>ariaLabel</c> prop); null / blank uses the localized default.</summary>
    public string? RegionLabel { get; }

    /// <summary>The default model — hero on screen (bar hidden), scroll-to-top enabled, no offset, no host label.</summary>
    public static PageHeaderStickyModel Default { get; } =
        new(targetIntersecting: true, targetAboveViewport: false, scrollToTop: true, topOffset: 0, regionLabel: null);

    /// <summary>Build a render model.</summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    /// <param name="targetAboveViewport">Whether the hero has scrolled above the viewport top (web <c>entry.boundingClientRect.top &lt; 0</c>).</param>
    /// <param name="scrollToTop">Whether the bar is the scroll-to-top affordance (web <c>scrollToTop</c>).</param>
    /// <param name="topOffset">The top offset in pixels (web <c>topOffset</c>).</param>
    /// <param name="regionLabel">The host-supplied region label (web <c>ariaLabel</c>).</param>
    public static PageHeaderStickyModel Create(
        bool targetIntersecting = true,
        bool targetAboveViewport = false,
        bool scrollToTop = true,
        double topOffset = 0,
        string? regionLabel = null) =>
        new(targetIntersecting, targetAboveViewport, scrollToTop, topOffset, regionLabel);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="PageHeaderStickyModel"/> — everything the web component
/// derives before returning JSX (PageHeaderSticky.tsx L93-135): whether the bar is shown (<see cref="IsVisible"/>,
/// the web <c>visible</c> gate / <c>if (!visible) return null</c>), whether it is the interactive scroll-to-top
/// affordance (<see cref="ScrollToTopEnabled"/>, the web <c>scrollToTop ? &lt;button&gt; : &lt;div&gt;</c>), whether the
/// trailing arrow is shown (<see cref="ShowArrow"/>, the web <c>{scrollToTop &amp;&amp; &lt;ArrowUp /&gt;}</c>), the decorative
/// <see cref="ArrowGlyph"/> (web Lucide <c>ArrowUp</c>), the docked <see cref="TopOffset"/> (web <c>style={{ top: topOffset }}</c>),
/// the localized region accessible name (<see cref="RegionName"/>, the web <c>aria-label={ariaLabel}</c>) and the
/// composed scroll-to-top accessible name (<see cref="ScrollToTopName"/>, the web <c>aria-label={`${ariaLabel} — scroll to top`}</c>).
/// Pure value type so every field is asserted headlessly.
/// </summary>
public sealed record PageHeaderStickyDisplay
{
    internal PageHeaderStickyDisplay(
        bool isVisible,
        bool scrollToTopEnabled,
        bool showArrow,
        string arrowGlyph,
        double topOffset,
        string regionName,
        string scrollToTopName)
    {
        IsVisible = isVisible;
        ScrollToTopEnabled = scrollToTopEnabled;
        ShowArrow = showArrow;
        ArrowGlyph = arrowGlyph;
        TopOffset = topOffset;
        RegionName = regionName;
        ScrollToTopName = scrollToTopName;
    }

    /// <summary>Whether the sticky bar is shown (web <c>visible</c>; <c>if (!visible) return null</c>).</summary>
    public bool IsVisible { get; }

    /// <summary>Whether the whole bar is the interactive scroll-to-top control (web <c>scrollToTop ? button : div</c>).</summary>
    public bool ScrollToTopEnabled { get; }

    /// <summary>Whether the trailing up-arrow is rendered (web <c>{scrollToTop &amp;&amp; &lt;ArrowUp /&gt;}</c>).</summary>
    public bool ShowArrow { get; }

    /// <summary>The decorative trailing up-arrow glyph (web Lucide <c>ArrowUp</c>).</summary>
    public string ArrowGlyph { get; }

    /// <summary>The docked top offset in pixels (web <c>style={{ top: topOffset }}</c>).</summary>
    public double TopOffset { get; }

    /// <summary>The localized region accessible name (web <c>aria-label={ariaLabel}</c>).</summary>
    public string RegionName { get; }

    /// <summary>
    /// The localized scroll-to-top accessible name — the region label plus the localized suffix (web
    /// <c>aria-label={`${ariaLabel} — scroll to top`}</c>). Equal to <see cref="RegionName"/>'s composition even when
    /// the scroll affordance is disabled, so the host can name a programmatic scroll trigger consistently.
    /// </summary>
    public string ScrollToTopName { get; }
}

/// <summary>
/// Pure projection from a <see cref="PageHeaderStickyModel"/> to its <see cref="PageHeaderStickyDisplay"/> — the
/// native port of <c>web/src/components/layout/PageHeaderSticky.tsx</c>. Reproduces the web derivations exactly: the
/// visibility gate is <see cref="PageHeaderStickyVisibility.Decide"/> (web <c>!entry.isIntersecting &amp;&amp; top &lt; 0</c>);
/// the bar is the interactive scroll-to-top control and shows the trailing arrow only when <c>scrollToTop</c> is set
/// (web <c>scrollToTop ? button : div</c> + <c>{scrollToTop &amp;&amp; &lt;ArrowUp /&gt;}</c>); the region accessible name is the
/// host label (web <c>ariaLabel</c>) or the localized default; and the scroll-to-top name appends the localized
/// suffix (web <c>`${ariaLabel} — scroll to top`</c>). No WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
public static class PageHeaderStickyProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the accessible names resolve through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static PageHeaderStickyDisplay Project(PageHeaderStickyModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isVisible = PageHeaderStickyVisibility.Decide(model.TargetIntersecting, model.TargetAboveViewport);

        string regionName = PageHeaderStickyRegistration.ResolveRegionLabel(localizer, model.RegionLabel);
        string suffix = PageHeaderStickyRegistration.ResolveScrollToTopSuffix(localizer);
        string scrollToTopName = PageHeaderStickyRegistration.ComposeScrollToTopName(regionName, suffix);

        return new PageHeaderStickyDisplay(
            isVisible: isVisible,
            scrollToTopEnabled: model.ScrollToTop,
            showArrow: model.ScrollToTop,
            arrowGlyph: PageHeaderStickyRegistration.ArrowUpGlyph,
            topOffset: model.TopOffset,
            regionName: regionName,
            scrollToTopName: scrollToTopName);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PageHeaderSticky</c> surface (P1/S11 diagnostics contract). The surface carries
/// only host-supplied summary content and a single scroll-to-top action, so the collector records ONLY operational
/// counters with the surface slug: the <c>view.opened</c> event the prompt requires, plus the scroll-to-top
/// invocations. No region label or summary content is ever passed. Thread-safe; mirrors the peer surfaces'
/// diagnostics collectors.
/// </summary>
public sealed class PageHeaderStickyDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _scrollToTops;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public PageHeaderStickyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of scroll-to-top activations.</summary>
    public long ScrollToTops => Interlocked.Read(ref _scrollToTops);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PageHeaderSticky</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PageHeaderStickyRegistration.Slug}");
    }

    /// <summary>Record a scroll-to-top activation, emitting <c>pageHeaderSticky.scrollToTop slug=PageHeaderSticky</c>.</summary>
    public void RecordScrollToTop()
    {
        Interlocked.Increment(ref _scrollToTops);
        _sink?.Invoke($"pageHeaderSticky.scrollToTop slug={PageHeaderStickyRegistration.Slug}");
    }
}
