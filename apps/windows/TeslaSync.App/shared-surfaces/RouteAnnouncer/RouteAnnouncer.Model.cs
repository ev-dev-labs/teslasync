namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>RouteAnnouncer</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/a11y/RouteAnnouncer.tsx</c>. The web source mounts once near the top of the app,
/// subscribes to react-router's <c>useLocation()</c> and, on every pathname change AFTER the first render,
/// schedules a short read of <c>document.title</c> and pushes it into a <c>VisuallyHidden</c> POLITE
/// <c>aria-live</c> region so screen-reader users hear which page they landed on after a client-side navigation
/// (WCAG 2.4.2). The surface is anonymous: it renders no visible chrome and no static copy, so there are no i18n
/// keys to resolve and no interactive elements — the spoken content is the already-localized page title supplied
/// by the title seam. This holder pins the diagnostics slug, the live-region politeness, the de-duplication cycle
/// length and the default deferred-read delay. UI-free so the metadata is asserted headlessly.
/// </summary>
public static class RouteAnnouncerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RouteAnnouncer";

    /// <summary>The live region's politeness (web <c>priority="polite"</c> → WinUI polite live setting).</summary>
    public const string Priority = "polite";

    /// <summary>The zero-width space rotated onto repeated announcements so AT re-reads them (web <c>\u200B</c>).</summary>
    public const char ZeroWidthSpace = '\u200B';

    /// <summary>The padding cycle length (web <c>(counter + 1) % 4</c>): 0..3 trailing zero-width spaces.</summary>
    public const int PaddingCycle = 4;

    /// <summary>
    /// Default delay before the page title is read after a route change (web
    /// <c>DEFAULT_ANNOUNCE_DELAY_MS = 100</c>). The deferred read lets the lazily-loaded destination page commit
    /// and write its title before the announcer reads it.
    /// </summary>
    public static TimeSpan DefaultAnnounceDelay { get; } = TimeSpan.FromMilliseconds(100);
}

/// <summary>
/// The current-location port the announcer binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useLocation()</c> hook the component reads <c>pathname</c> from. The view never touches the router directly:
/// a shell adapter (or a test fake) supplies the current path and raises <see cref="Changed"/> on every navigation
/// (mirroring react-router re-rendering on a <c>pathname</c> change), so the announcer logic is asserted
/// headlessly.
/// </summary>
public interface IRouteLocationSource
{
    /// <summary>The current location path (web <c>location.pathname</c>).</summary>
    string Path { get; }

    /// <summary>Raised on every navigation (web effect re-run on a <c>pathname</c> change).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The page-title port the announcer reads at announce time (P1/S8 state-holder seam) — the native analogue of the
/// web global <c>document.title</c> that the destination page's <c>usePageTitle</c> effect writes. Read lazily
/// inside the deferred callback (never at schedule time) so the freshly-mounted page has had a chance to set its
/// title first, exactly like the web source.
/// </summary>
public interface IPageTitleSource
{
    /// <summary>The current page title (web <c>document.title</c>); empty when no page has set one.</summary>
    string Title { get; }
}

/// <summary>
/// The deferred-callback port the announcer schedules through (P1/S8 state-holder seam) — the native analogue of
/// the web <c>window.setTimeout</c> / <c>clearTimeout</c> pair. <see cref="Schedule"/> arranges for
/// <paramref name="callback"/> to run once after <paramref name="delay"/>; disposing the returned handle cancels
/// a not-yet-fired callback (web effect cleanup). The production adapter is a UI-thread dispatcher timer; a test
/// fake drives time deterministically.
/// </summary>
public interface IAnnounceScheduler
{
    /// <summary>Schedule <paramref name="callback"/> to run once after <paramref name="delay"/>; dispose to cancel.</summary>
    /// <param name="delay">The deferred-read delay.</param>
    /// <param name="callback">The callback to run when the delay elapses.</param>
    IDisposable Schedule(TimeSpan delay, Action callback);
}

/// <summary>
/// The result of computing the next announcement string — the spoken <see cref="Message"/> and the advanced
/// padding <see cref="Counter"/>. An empty <see cref="Message"/> means the region is cleared (no title to speak);
/// in that case the counter is carried through unchanged, exactly like the web source which returns before
/// incrementing its counter. Pure value so the rotation is asserted without a UI host.
/// </summary>
/// <param name="Message">The live-region text: the title plus 0..3 trailing zero-width spaces, or empty.</param>
/// <param name="Counter">The padding counter after this step (0..<see cref="RouteAnnouncerRegistration.PaddingCycle"/>-1).</param>
public readonly record struct AnnouncementStep(string Message, int Counter)
{
    /// <summary>True when there is nothing to speak and the region is cleared (web empty-title branch).</summary>
    public bool IsCleared => Message.Length == 0;
}

/// <summary>
/// Pure projection of a page title + the previous padding counter into the next announcement — the native port of
/// the web announcer's timeout body (web/src/components/a11y/RouteAnnouncer.tsx). When the title is empty the
/// region is cleared and the counter is left untouched (web returns before incrementing). Otherwise the counter is
/// rotated <c>(prev + 1) % 4</c> and that many zero-width spaces are appended so two consecutive routes that
/// resolve to the SAME title still produce distinct region text and are both re-read by the screen reader. No
/// WinUI types — unit-tested without a UI host.
/// </summary>
public static class RouteAnnouncerProjection
{
    /// <summary>
    /// Compute the next announcement for <paramref name="title"/> given the <paramref name="previousCounter"/>.
    /// </summary>
    /// <param name="title">The current page title (web <c>document.title</c>); null/empty clears the region.</param>
    /// <param name="previousCounter">The padding counter from the previous announcement.</param>
    public static AnnouncementStep Next(string? title, int previousCounter)
    {
        string resolved = title ?? string.Empty;
        if (resolved.Length == 0)
        {
            // Nothing meaningful to announce — clear the region (and do NOT advance the counter), so a later
            // real title is never suppressed as a duplicate of a stale value.
            return new AnnouncementStep(string.Empty, previousCounter);
        }

        int cycle = RouteAnnouncerRegistration.PaddingCycle;
        int normalized = ((previousCounter % cycle) + cycle) % cycle;
        int counter = (normalized + 1) % cycle;
        string padding = new(RouteAnnouncerRegistration.ZeroWidthSpace, counter);
        return new AnnouncementStep(resolved + padding, counter);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>RouteAnnouncer</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the page title or the route path, either of which can carry
/// fleet identifiers (a VIN-bearing title, a <c>/charging/{id}</c> path) — so a diagnostics line can never leak
/// where a user navigates or what page they are on. Thread-safe.
/// </summary>
public sealed class RouteAnnouncerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _announced;
    private long _cleared;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no title or path is ever passed).</param>
    public RouteAnnouncerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the announcer has been mounted/opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of non-empty announcements made (count only, never the title).</summary>
    public long Announced => Interlocked.Read(ref _announced);

    /// <summary>Number of times the region was cleared because the new page had no title.</summary>
    public long Cleared => Interlocked.Read(ref _cleared);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RouteAnnouncer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RouteAnnouncerRegistration.Slug}");
    }

    /// <summary>Record a route announcement, emitting <c>route.announced slug=RouteAnnouncer</c> (no title).</summary>
    public void RecordAnnounced()
    {
        Interlocked.Increment(ref _announced);
        _sink?.Invoke($"route.announced slug={RouteAnnouncerRegistration.Slug}");
    }

    /// <summary>Record a region clear, emitting <c>route.cleared slug=RouteAnnouncer</c>.</summary>
    public void RecordCleared()
    {
        Interlocked.Increment(ref _cleared);
        _sink?.Invoke($"route.cleared slug={RouteAnnouncerRegistration.Slug}");
    }
}
