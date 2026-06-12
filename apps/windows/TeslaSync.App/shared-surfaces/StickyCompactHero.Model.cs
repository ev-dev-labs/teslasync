using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>StickyCompactHero</c> shared surface — the native analogue of the module-level
/// literals in <c>web/src/components/status/StickyCompactHero.tsx</c>. The web component is a collapsed-on-scroll
/// status bar: an <c>IntersectionObserver</c> watches the full <c>StatusHero</c> (by <c>targetId</c>) and the
/// compact bar is rendered only once that hero has scrolled out of view (<c>visible = !entry.isIntersecting</c>,
/// L64-70); tapping the bar smooth-scrolls back to the top (<c>window.scrollTo</c>, L72-74). It reads the shared
/// <c>HeroStatus</c> union and paints a per-status icon + accent colour + <c>SHORT_HEADLINE</c> (L14-36), an
/// optional last-checked label and an optional refresh button (L104-119). This holder pins the diagnostics slug,
/// the automation ids, the Segoe Fluent glyphs standing in for the web Lucide <c>ArrowUp</c> / <c>RefreshCw</c>,
/// the i18n keys + their verbatim English fallbacks for the region label / scroll-to-top label / refresh label,
/// and the per-status headline keys whose fallback is the shared
/// <see cref="StatusPresentation.ShortHeadline(HealthStatus)"/> (so the native short headline can never drift from
/// the web <c>SHORT_HEADLINE</c> map). The status icon, accent and headline themselves are resolved from the shared
/// <see cref="StatusPresentation"/> + <see cref="HealthStatus"/> that the sibling StatusHero / HealthRow surfaces
/// also use. UI-free so the mapping is asserted headlessly without a XAML runtime.
/// </summary>
public static class StickyCompactHeroRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "StickyCompactHero";

    /// <summary>The automation id the surface (the web <c>role="region"</c> bar) exposes.</summary>
    public const string RegionAutomationId = "sticky-compact-hero";

    /// <summary>The automation id the scroll-to-top control exposes (web <c>onClick={handleScrollTop}</c> button).</summary>
    public const string ScrollToTopAutomationId = "sticky-compact-hero-scroll-top";

    /// <summary>The automation id the refresh control exposes (web <c>onClick={onRefresh}</c> button).</summary>
    public const string RefreshAutomationId = "sticky-compact-hero-refresh";

    /// <summary>Segoe Fluent "Up" glyph — the native stand-in for the web Lucide <c>ArrowUp</c> (matches the W2 atomic).</summary>
    public const string ArrowUpGlyph = "\uE74A";

    /// <summary>Segoe Fluent "Refresh" glyph — the native stand-in for the web Lucide <c>RefreshCw</c> (matches the W2 atomic).</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>The separator the last-checked label is prefixed with (web <c>· {lastCheckedLabel}</c> at L99).</summary>
    public const string LastCheckedPrefix = "\u00B7 ";

    /// <summary>i18n key for the bar's region accessible name (web <c>aria-label="Status summary"</c> at L87).</summary>
    public const string RegionLabelKey = "translation.status.compactHero.region";

    /// <summary>English fallback for <see cref="RegionLabelKey"/> — the web <c>aria-label</c>, verbatim.</summary>
    public const string RegionLabelFallback = "Status summary";

    /// <summary>i18n key for the scroll-to-top control's accessible name (web <c>aria-label="Scroll to top of page"</c> at L94).</summary>
    public const string ScrollToTopKey = "translation.status.compactHero.scrollToTop";

    /// <summary>English fallback for <see cref="ScrollToTopKey"/> — the web <c>aria-label</c>, verbatim.</summary>
    public const string ScrollToTopFallback = "Scroll to top of page";

    /// <summary>i18n key for the refresh control's accessible name (web <c>aria-label="Refresh status"</c> at L109).</summary>
    public const string RefreshKey = "translation.status.compactHero.refresh";

    /// <summary>English fallback for <see cref="RefreshKey"/> — the web <c>aria-label</c>, verbatim.</summary>
    public const string RefreshFallback = "Refresh status";

    /// <summary>The lowercase status token used to scope a per-status i18n key (mirrors the web <c>HeroStatus</c> union members).</summary>
    /// <param name="status">The health status.</param>
    public static string StatusToken(HealthStatus status) => status switch
    {
        HealthStatus.Healthy => "healthy",
        HealthStatus.Degraded => "degraded",
        HealthStatus.Unhealthy => "unhealthy",
        HealthStatus.Maintenance => "maintenance",
        _ => "unknown",
    };

    /// <summary>i18n key for a status's compact headline (web <c>SHORT_HEADLINE[status]</c> at L30-36).</summary>
    /// <param name="status">The health status.</param>
    public static string HeadlineKey(HealthStatus status) =>
        "translation.status.compactHero.headline." + StatusToken(status);

    /// <summary>
    /// English fallback for a status's compact headline — the shared
    /// <see cref="StatusPresentation.ShortHeadline(HealthStatus)"/>, so the native fallback is byte-for-byte the
    /// web <c>SHORT_HEADLINE</c> value and cannot drift from the sibling status surfaces.
    /// </summary>
    /// <param name="status">The health status.</param>
    public static string HeadlineFallback(HealthStatus status) => StatusPresentation.ShortHeadline(status);

    /// <summary>Resolve the localized compact headline (web <c>SHORT_HEADLINE[status]</c>).</summary>
    /// <param name="localizer">The i18n facade the headline resolves through.</param>
    /// <param name="status">The health status.</param>
    public static string ResolveHeadline(ILocalizer localizer, HealthStatus status)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(HeadlineKey(status), HeadlineFallback(status));
    }

    /// <summary>Resolve the localized region accessible name (web <c>aria-label="Status summary"</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveRegionLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RegionLabelKey, RegionLabelFallback);
    }

    /// <summary>Resolve the localized scroll-to-top accessible name (web <c>aria-label="Scroll to top of page"</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveScrollToTopLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ScrollToTopKey, ScrollToTopFallback);
    }

    /// <summary>Resolve the localized refresh accessible name (web <c>aria-label="Refresh status"</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveRefreshLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RefreshKey, RefreshFallback);
    }
}

/// <summary>
/// The scroll-to-top action seam the <c>StickyCompactHero</c> surface routes through (P1/S8 state-holder seam) —
/// the native analogue of the web <c>handleScrollTop</c> closure
/// (<c>window.scrollTo({ top: 0, behavior: 'smooth' })</c>, StickyCompactHero.tsx L72-74). The view owns no scroll
/// viewport, so activating the bar delegates to a host-supplied scroller; <see cref="NullStickyHeroScroller"/>
/// stands in for headless hosts, previews and tests (a safe no-op). The production binding wraps the shell's
/// page <c>ScrollViewer</c>.
/// </summary>
public interface IStickyHeroScroller
{
    /// <summary>Smooth-scroll the host content back to the top (web <c>window.scrollTo({ top: 0, behavior: 'smooth' })</c>).</summary>
    void ScrollToTop();
}

/// <summary>
/// The inert scroller used when no host scroll viewport is wired — the native analogue of the web component being
/// rendered in a context where <c>window.scrollTo</c> is unavailable: the activation is a safe no-op that never
/// throws. Used by the designer / headless / test constructors.
/// </summary>
public sealed class NullStickyHeroScroller : IStickyHeroScroller
{
    /// <summary>The shared inert instance.</summary>
    public static NullStickyHeroScroller Instance { get; } = new();

    private NullStickyHeroScroller()
    {
    }

    /// <inheritdoc />
    public void ScrollToTop()
    {
        // No host scroll viewport wired — nothing to scroll.
    }
}

/// <summary>
/// The optional refresh action seam the <c>StickyCompactHero</c> surface routes through (P1/S8 state-holder seam) —
/// the native analogue of the web <c>onRefresh?</c> callback prop (StickyCompactHero.tsx L44, L104-119). The web
/// renders the refresh affordance ONLY when <c>onRefresh</c> is supplied, so a null refresher means the surface
/// shows no refresh button at all (the web <c>{onRefresh &amp;&amp; ...}</c> guard). The host owns the refresh
/// behaviour (re-probe, refetch); the surface only invokes it.
/// </summary>
public interface IStickyHeroRefresher
{
    /// <summary>Request a status refresh (web <c>onRefresh()</c>).</summary>
    void Refresh();
}

/// <summary>
/// The render-time data model the <c>StickyCompactHero</c> view binds to — the native analogue of the web
/// <c>StickyCompactHeroProps</c> already resolved to render inputs (StickyCompactHero.tsx L38-48). The web component
/// is purely presentational: its parent (the SystemStatusPage) owns all data fetching and feeds an already-resolved
/// status, last-checked label and refreshing flag, so — exactly like React re-rendering the element with resolved
/// props — there is no fetch-driven loading / error / stale / offline branch to reproduce here. The only branches
/// are the visibility gate (<see cref="TargetIntersecting"/>, the web <c>IntersectionObserver</c> result), the five
/// status variants, the optional last-checked label, the optional refresh affordance and its busy state. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record StickyCompactHeroModel
{
    private StickyCompactHeroModel(
        HealthStatus status,
        string? lastCheckedLabel,
        bool hasRefresh,
        bool refreshing,
        bool targetIntersecting)
    {
        Status = status;
        LastCheckedLabel = lastCheckedLabel;
        HasRefresh = hasRefresh;
        Refreshing = refreshing;
        TargetIntersecting = targetIntersecting;
    }

    /// <summary>The current health status driving the icon, accent and headline (web <c>status</c>).</summary>
    public HealthStatus Status { get; }

    /// <summary>The relative last-checked label, e.g. "12s ago" (web <c>lastCheckedLabel</c>); null / empty renders none.</summary>
    public string? LastCheckedLabel { get; }

    /// <summary>Whether the refresh affordance is offered (web <c>onRefresh != null</c>).</summary>
    public bool HasRefresh { get; }

    /// <summary>Whether a refresh is in flight — the button shows a spinner and is disabled (web <c>refreshing</c>).</summary>
    public bool Refreshing { get; }

    /// <summary>
    /// Whether the watched full hero is currently on screen (web <c>entry.isIntersecting</c>). When true the compact
    /// bar is hidden (web <c>if (!visible) return null</c>); when false the bar is shown.
    /// </summary>
    public bool TargetIntersecting { get; }

    /// <summary>The default model — unknown status, hero on screen (bar hidden), no last-checked, no refresh.</summary>
    public static StickyCompactHeroModel Default { get; } =
        new(HealthStatus.Unknown, lastCheckedLabel: null, hasRefresh: false, refreshing: false, targetIntersecting: true);

    /// <summary>Build a render model.</summary>
    /// <param name="status">The health status (web <c>status</c>).</param>
    /// <param name="lastCheckedLabel">The relative last-checked label (web <c>lastCheckedLabel</c>).</param>
    /// <param name="hasRefresh">Whether the refresh affordance is offered (web <c>onRefresh != null</c>).</param>
    /// <param name="refreshing">Whether a refresh is in flight (web <c>refreshing</c>).</param>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    public static StickyCompactHeroModel Create(
        HealthStatus status,
        string? lastCheckedLabel = null,
        bool hasRefresh = false,
        bool refreshing = false,
        bool targetIntersecting = true) =>
        new(status, lastCheckedLabel, hasRefresh, refreshing, targetIntersecting);
}

/// <summary>
/// Pure visibility decision for the compact bar — the native port of the web <c>IntersectionObserver</c> callback
/// (StickyCompactHero.tsx L64-70): <c>setVisible(!entry.isIntersecting)</c>. The bar is visible exactly when the
/// watched full hero is NOT intersecting the viewport (i.e. has scrolled out of view). No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class StickyCompactHeroVisibility
{
    /// <summary>Decide whether the compact bar is shown, given whether the watched hero is on screen.</summary>
    /// <param name="targetIntersecting">Whether the watched hero is on screen (web <c>entry.isIntersecting</c>).</param>
    /// <returns>True when the bar should be shown (web <c>visible</c>).</returns>
    public static bool Decide(bool targetIntersecting) => !targetIntersecting;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="StickyCompactHeroModel"/> — everything the web component
/// derives before returning JSX (StickyCompactHero.tsx L76-122): whether the bar is shown
/// (<see cref="IsVisible"/>, the web <c>visible</c> gate), the status <see cref="Glyph"/> + <see cref="AccentHex"/>
/// (web <c>ICON_FOR_STATUS</c> / <c>TEXT_FOR_STATUS</c>), the localized <see cref="Headline"/>
/// (web <c>SHORT_HEADLINE</c>), the optional last-checked label (<see cref="HasLastChecked"/> /
/// <see cref="LastCheckedLabel"/> / <see cref="LastCheckedText"/>, the web <c>· {lastCheckedLabel}</c>), the refresh
/// affordance flags (<see cref="ShowRefresh"/> / <see cref="Refreshing"/> / <see cref="CanRefresh"/>, the web
/// <c>{onRefresh &amp;&amp; ...}</c> + <c>disabled={refreshing}</c>), the decorative glyphs
/// (<see cref="ArrowUpGlyph"/> / <see cref="RefreshGlyph"/>), the localized accessible names
/// (<see cref="RegionName"/> / <see cref="ScrollToTopName"/> / <see cref="RefreshName"/>, the web <c>aria-label</c>s)
/// and the composed <see cref="AutomationName"/> Narrator reads for the region. Pure value type so every field is
/// asserted headlessly.
/// </summary>
public sealed record StickyCompactHeroDisplay
{
    internal StickyCompactHeroDisplay(
        bool isVisible,
        HealthStatus status,
        string glyph,
        string accentHex,
        string headline,
        bool hasLastChecked,
        string lastCheckedLabel,
        string lastCheckedText,
        bool showRefresh,
        bool refreshing,
        bool canRefresh,
        string arrowUpGlyph,
        string refreshGlyph,
        string regionName,
        string scrollToTopName,
        string refreshName,
        string automationName)
    {
        IsVisible = isVisible;
        Status = status;
        Glyph = glyph;
        AccentHex = accentHex;
        Headline = headline;
        HasLastChecked = hasLastChecked;
        LastCheckedLabel = lastCheckedLabel;
        LastCheckedText = lastCheckedText;
        ShowRefresh = showRefresh;
        Refreshing = refreshing;
        CanRefresh = canRefresh;
        ArrowUpGlyph = arrowUpGlyph;
        RefreshGlyph = refreshGlyph;
        RegionName = regionName;
        ScrollToTopName = scrollToTopName;
        RefreshName = refreshName;
        AutomationName = automationName;
    }

    /// <summary>Whether the compact bar is shown (web <c>visible</c>; <c>if (!visible) return null</c>).</summary>
    public bool IsVisible { get; }

    /// <summary>The health status (web <c>status</c>).</summary>
    public HealthStatus Status { get; }

    /// <summary>The Segoe Fluent status glyph (web <c>ICON_FOR_STATUS[status]</c>).</summary>
    public string Glyph { get; }

    /// <summary>The semantic accent hex for the icon + headline (web <c>TEXT_FOR_STATUS[status]</c>).</summary>
    public string AccentHex { get; }

    /// <summary>The localized compact headline (web <c>SHORT_HEADLINE[status]</c>).</summary>
    public string Headline { get; }

    /// <summary>Whether the last-checked label is rendered (web <c>lastCheckedLabel &amp;&amp; ...</c>).</summary>
    public bool HasLastChecked { get; }

    /// <summary>The raw last-checked label, e.g. "12s ago" (web <c>lastCheckedLabel</c>); empty when absent.</summary>
    public string LastCheckedLabel { get; }

    /// <summary>The displayed last-checked text with the leading separator, "· 12s ago" (web <c>· {lastCheckedLabel}</c>); empty when absent.</summary>
    public string LastCheckedText { get; }

    /// <summary>Whether the refresh button is rendered (web <c>onRefresh &amp;&amp; ...</c>).</summary>
    public bool ShowRefresh { get; }

    /// <summary>Whether a refresh is in flight — spinner + disabled (web <c>refreshing</c>).</summary>
    public bool Refreshing { get; }

    /// <summary>Whether the refresh button is interactive (shown AND not already refreshing — web <c>disabled={refreshing}</c>).</summary>
    public bool CanRefresh { get; }

    /// <summary>The decorative trailing up-arrow glyph (web Lucide <c>ArrowUp</c>).</summary>
    public string ArrowUpGlyph { get; }

    /// <summary>The refresh button glyph (web Lucide <c>RefreshCw</c>).</summary>
    public string RefreshGlyph { get; }

    /// <summary>The localized region accessible name (web <c>aria-label="Status summary"</c>).</summary>
    public string RegionName { get; }

    /// <summary>The localized scroll-to-top accessible name (web <c>aria-label="Scroll to top of page"</c>).</summary>
    public string ScrollToTopName { get; }

    /// <summary>The localized refresh accessible name (web <c>aria-label="Refresh status"</c>).</summary>
    public string RefreshName { get; }

    /// <summary>
    /// The composed accessible name Narrator reads for the region — the localized region label, the current status
    /// headline and (when present) the last-checked label, so the status is announced even though the web region
    /// <c>aria-label</c> alone is just "Status summary". Reads e.g. "Status summary: All operational · 12s ago".
    /// </summary>
    public string AutomationName { get; }
}

/// <summary>
/// Pure projection from a <see cref="StickyCompactHeroModel"/> to its <see cref="StickyCompactHeroDisplay"/> — the
/// native port of <c>web/src/components/status/StickyCompactHero.tsx</c>. Reproduces the web derivations exactly:
/// the visibility gate is <see cref="StickyCompactHeroVisibility.Decide"/> (web <c>!entry.isIntersecting</c>); the
/// status icon, accent and headline come from the shared <see cref="StatusPresentation"/> (web
/// <c>ICON_FOR_STATUS</c> / <c>TEXT_FOR_STATUS</c> / <c>SHORT_HEADLINE</c>); the last-checked text gets the web
/// <c>· </c> separator; the refresh affordance shows only when offered and is interactive only when not already
/// refreshing (web <c>{onRefresh &amp;&amp; ...}</c> + <c>disabled={refreshing}</c>); and the accessible names
/// resolve through the i18n facade. No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class StickyCompactHeroProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade the headline + accessible names resolve through (P1/S10).</param>
    /// <returns>The render-ready display model.</returns>
    public static StickyCompactHeroDisplay Project(StickyCompactHeroModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isVisible = StickyCompactHeroVisibility.Decide(model.TargetIntersecting);

        string headline = StickyCompactHeroRegistration.ResolveHeadline(localizer, model.Status);
        string regionName = StickyCompactHeroRegistration.ResolveRegionLabel(localizer);
        string scrollToTopName = StickyCompactHeroRegistration.ResolveScrollToTopLabel(localizer);
        string refreshName = StickyCompactHeroRegistration.ResolveRefreshLabel(localizer);

        bool hasLastChecked = !string.IsNullOrWhiteSpace(model.LastCheckedLabel);
        string lastCheckedLabel = hasLastChecked ? model.LastCheckedLabel!.Trim() : string.Empty;
        string lastCheckedText = hasLastChecked
            ? StickyCompactHeroRegistration.LastCheckedPrefix + lastCheckedLabel
            : string.Empty;

        bool showRefresh = model.HasRefresh;
        bool canRefresh = showRefresh && !model.Refreshing;

        return new StickyCompactHeroDisplay(
            isVisible: isVisible,
            status: model.Status,
            glyph: StatusPresentation.Glyph(model.Status),
            accentHex: StatusPresentation.AccentHex(model.Status),
            headline: headline,
            hasLastChecked: hasLastChecked,
            lastCheckedLabel: lastCheckedLabel,
            lastCheckedText: lastCheckedText,
            showRefresh: showRefresh,
            refreshing: model.Refreshing,
            canRefresh: canRefresh,
            arrowUpGlyph: StickyCompactHeroRegistration.ArrowUpGlyph,
            refreshGlyph: StickyCompactHeroRegistration.RefreshGlyph,
            regionName: regionName,
            scrollToTopName: scrollToTopName,
            refreshName: refreshName,
            automationName: ComposeName(regionName, headline, lastCheckedText, hasLastChecked));
    }

    // The region's accessible name is the localized region label, the status headline and (when present) the
    // last-checked text — so Narrator announces the actual status, not just the generic "Status summary".
    private static string ComposeName(string regionName, string headline, string lastCheckedText, bool hasLastChecked)
    {
        string name = $"{regionName}: {headline}";
        return hasLastChecked ? $"{name} {lastCheckedText}" : name;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>StickyCompactHero</c> surface (P1/S11 diagnostics contract). The surface carries
/// only the localized, static status headline and two host-owned actions, so the collector records ONLY operational
/// counters with the surface slug: the <c>view.opened</c> event the prompt requires, plus the scroll-to-top and
/// refresh invocations. No headline, last-checked label or status value is ever passed. Thread-safe; mirrors the
/// peer surfaces' diagnostics collectors.
/// </summary>
public sealed class StickyCompactHeroDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _scrollToTops;
    private long _refreshes;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the operational lines are written to, or null.</param>
    public StickyCompactHeroDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of scroll-to-top activations.</summary>
    public long ScrollToTops => Interlocked.Read(ref _scrollToTops);

    /// <summary>Number of refresh activations.</summary>
    public long Refreshes => Interlocked.Read(ref _refreshes);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StickyCompactHero</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StickyCompactHeroRegistration.Slug}");
    }

    /// <summary>Record a scroll-to-top activation, emitting <c>stickyHero.scrollToTop slug=StickyCompactHero</c>.</summary>
    public void RecordScrollToTop()
    {
        Interlocked.Increment(ref _scrollToTops);
        _sink?.Invoke($"stickyHero.scrollToTop slug={StickyCompactHeroRegistration.Slug}");
    }

    /// <summary>Record a refresh activation, emitting <c>stickyHero.refresh slug=StickyCompactHero</c>.</summary>
    public void RecordRefresh()
    {
        Interlocked.Increment(ref _refreshes);
        _sink?.Invoke($"stickyHero.refresh slug={StickyCompactHeroRegistration.Slug}");
    }
}
