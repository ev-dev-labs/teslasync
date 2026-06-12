namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>ScrollRestoration</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/layout/ScrollRestoration.tsx</c>. The web source mounts once near the router root and
/// reproduces a classic-router scroll-restoration behaviour for the single scrollable region
/// (<c>&lt;main id="main-content"&gt;</c>): it records the vertical offset per location key (pathname + search) in
/// <c>sessionStorage</c>, restores the saved offset synchronously before paint on a back/forward (POP) navigation,
/// and scrolls to the top on a fresh PUSH / REPLACE navigation. The surface renders <c>null</c> — it is an
/// invisible behavioural coordinator with no visible chrome, no static copy and no interactive elements, so there
/// are no i18n keys to resolve. This holder pins the diagnostics slug and the <c>sessionStorage</c> key shape so
/// both are asserted headlessly without a UI host.
/// </summary>
public static class ScrollRestorationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ScrollRestoration";

    /// <summary>
    /// The per-location key prefix (web <c>STORAGE_PREFIX = 'teslasync.scroll:'</c>). The full key is the prefix
    /// followed by the location's path and search, exactly like the web source.
    /// </summary>
    public const string StoragePrefix = "teslasync.scroll:";

    /// <summary>
    /// True because the surface renders no visible or interactive content (web <c>return null</c>). The view keeps
    /// itself out of the Narrator tree and out of the tab order accordingly; the a11y contract is the deliberate
    /// ABSENCE of any node that would need a label, mirroring the web component contributing nothing to the DOM.
    /// </summary>
    public const bool RendersVisibleContent = false;

    /// <summary>
    /// Compute the per-location storage key (web <c>keyFor(pathname, search) =&gt;
    /// `${STORAGE_PREFIX}${pathname}${search}`</c>). The path and search together identify a scroll position, so two
    /// query strings on the same path restore independently, exactly like the web source.
    /// </summary>
    /// <param name="path">The current location path (web <c>location.pathname</c>).</param>
    /// <param name="search">The current location query string (web <c>location.search</c>); empty when none.</param>
    public static string KeyFor(string path, string search)
    {
        ArgumentNullException.ThrowIfNull(path);
        ArgumentNullException.ThrowIfNull(search);
        return string.Concat(StoragePrefix, path, search);
    }
}

/// <summary>
/// The kind of the navigation that produced the current location — the native analogue of react-router's
/// <c>useNavigationType()</c> value the web component reads (<c>'POP' | 'PUSH' | 'REPLACE'</c>). Only
/// <see cref="Pop"/> restores a saved offset; <see cref="Push"/> and <see cref="Replace"/> are fresh navigations
/// that start at the top.
/// </summary>
public enum ScrollNavigationKind
{
    /// <summary>A fresh forward navigation (web <c>'PUSH'</c>) — start at the top.</summary>
    Push,

    /// <summary>A back/forward navigation (web <c>'POP'</c>) — restore the saved offset, or the top when none.</summary>
    Pop,

    /// <summary>An in-place navigation that does not grow history (web <c>'REPLACE'</c>) — start at the top.</summary>
    Replace,
}

/// <summary>
/// The current-location port the surface binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useLocation()</c> + <c>useNavigationType()</c> pair the component reads. The view never touches the router
/// directly: a shell adapter (or a test fake) supplies the current <see cref="Path"/> / <see cref="Search"/> and
/// the <see cref="NavigationKind"/> that produced it, and raises <see cref="Changed"/> on every navigation
/// (mirroring react-router re-rendering on a location change), so the restoration logic is asserted headlessly.
/// </summary>
public interface IScrollRestorationLocationSource
{
    /// <summary>The current location path (web <c>location.pathname</c>).</summary>
    string Path { get; }

    /// <summary>The current location query string (web <c>location.search</c>); empty when none.</summary>
    string Search { get; }

    /// <summary>The kind of the navigation that produced the current location (web <c>useNavigationType()</c>).</summary>
    ScrollNavigationKind NavigationKind { get; }

    /// <summary>Raised on every navigation (web effect re-run on a location / navigation-type change).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The per-location offset persistence port (P1/S8 state-holder seam) — the native analogue of the web
/// <c>sessionStorage</c> read/write helpers (<c>readSaved</c> / <c>writeSaved</c>). It survives a navigation but
/// not a process restart, exactly like a session store. The default binding is
/// <see cref="InMemoryScrollOffsetStore"/>; a shell adapter may bridge it to a longer-lived store. Writes of a
/// non-finite offset are ignored and missing keys read back as <see langword="null"/>, mirroring the web helpers'
/// "never fatal" try/catch and <c>Number.isFinite</c> guard.
/// </summary>
public interface IScrollOffsetStore
{
    /// <summary>
    /// Read the saved offset for <paramref name="key"/> (web <c>readSaved</c>): the previously-written value, or
    /// <see langword="null"/> when the key was never written or held a non-finite value.
    /// </summary>
    /// <param name="key">The per-location key (see <see cref="ScrollRestorationRegistration.KeyFor"/>).</param>
    double? Read(string key);

    /// <summary>
    /// Save the scroll <paramref name="offset"/> for <paramref name="key"/> (web <c>writeSaved</c>). A non-finite
    /// offset (NaN / infinity) is ignored rather than persisted, so a bad reading never corrupts the store.
    /// </summary>
    /// <param name="key">The per-location key (see <see cref="ScrollRestorationRegistration.KeyFor"/>).</param>
    /// <param name="offset">The vertical scroll offset to persist.</param>
    void Write(string key, double offset);
}

/// <summary>
/// The scrollable viewport port the surface drives (P1/S8 state-holder seam) — the native analogue of the web
/// <c>&lt;main id="main-content"&gt;</c> scroll container the component reads <c>scrollTop</c> from and writes
/// <c>scrollTop</c> to. The view supplies a WinUI adapter over the shell's content <c>ScrollViewer</c>; a test fake
/// drives <see cref="Offset"/> and raises <see cref="Scrolled"/> deterministically. The view never reaches into
/// the visual tree itself — it binds to this seam, exactly as the web source operates on a single resolved element.
/// </summary>
public interface IScrollSurface
{
    /// <summary>The current vertical scroll offset (web <c>getScrollTop</c>).</summary>
    double Offset { get; }

    /// <summary>Scroll the viewport to <paramref name="offset"/> (web <c>setScrollTop</c>).</summary>
    /// <param name="offset">The target vertical offset; the top is <c>0</c>.</param>
    void ScrollTo(double offset);

    /// <summary>Raised when the user scrolls the viewport (web <c>'scroll'</c> event).</summary>
    event EventHandler? Scrolled;
}

/// <summary>
/// The per-frame coalescing port the surface schedules capture writes through (P1/S8 state-holder seam) — the
/// native analogue of the web <c>requestAnimationFrame</c> / <c>cancelAnimationFrame</c> throttle that limits the
/// scroll-position write to at most once per paint regardless of scroll velocity. <see cref="RequestFrame"/>
/// arranges for <paramref name="callback"/> to run once on the next frame; disposing the returned handle cancels a
/// not-yet-fired frame. The production adapter is a composition-render one-shot; a test fake fires frames on demand.
/// </summary>
public interface IFrameScheduler
{
    /// <summary>Schedule <paramref name="callback"/> to run once on the next frame; dispose the handle to cancel.</summary>
    /// <param name="callback">The capture callback to run when the frame ticks.</param>
    IDisposable RequestFrame(Action callback);
}

/// <summary>
/// Pure projection of a navigation kind + the previously-saved offset into the offset to apply — the native port of
/// the web restore branch (web/src/components/layout/ScrollRestoration.tsx <c>useLayoutEffect</c>): on a POP
/// navigation restore the saved offset (or the top when none, web <c>saved ?? 0</c>); on a fresh PUSH / REPLACE
/// navigation always start at the top (web <c>setScrollTop(target, 0)</c>). No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class ScrollRestorationProjection
{
    /// <summary>
    /// Resolve the offset to apply for a navigation of <paramref name="navigationKind"/> given the
    /// <paramref name="saved"/> offset (or <see langword="null"/> when nothing is stored for the destination).
    /// </summary>
    /// <param name="navigationKind">The kind of navigation that produced the destination.</param>
    /// <param name="saved">The saved offset for the destination, or <see langword="null"/> when none.</param>
    public static double Resolve(ScrollNavigationKind navigationKind, double? saved)
    {
        if (navigationKind == ScrollNavigationKind.Pop)
        {
            // web: setScrollTop(target, saved ?? 0) — restore the back/forward position, or the top when unseen.
            return saved ?? 0d;
        }

        // web PUSH / REPLACE: a fresh navigation always starts at the top.
        return 0d;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ScrollRestoration</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the location path, search or storage key, any of which can
/// carry fleet identifiers (a <c>/charging/{id}</c> path, a <c>?vin=</c> query) — so a diagnostics line can never
/// leak where a user navigates. The high-frequency per-frame capture is intentionally NOT emitted as a line (it
/// would flood the sink); only the discrete navigation outcomes (restore / reset) and the mount are surfaced.
/// Thread-safe.
/// </summary>
public sealed class ScrollRestorationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _restored;
    private long _reset;
    private long _captured;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no path, search or key is ever passed).</param>
    public ScrollRestorationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been mounted/opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of POP navigations whose saved offset (or the top) was restored.</summary>
    public long Restored => Interlocked.Read(ref _restored);

    /// <summary>Number of PUSH / REPLACE navigations reset to the top.</summary>
    public long Reset => Interlocked.Read(ref _reset);

    /// <summary>Number of per-frame scroll-position captures persisted (counter only — never emitted as a line).</summary>
    public long Captured => Interlocked.Read(ref _captured);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ScrollRestoration</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ScrollRestorationRegistration.Slug}");
    }

    /// <summary>Record a POP restore, emitting <c>scroll.restored slug=ScrollRestoration</c> (no key).</summary>
    public void RecordRestored()
    {
        Interlocked.Increment(ref _restored);
        _sink?.Invoke($"scroll.restored slug={ScrollRestorationRegistration.Slug}");
    }

    /// <summary>Record a PUSH / REPLACE reset, emitting <c>scroll.reset slug=ScrollRestoration</c> (no key).</summary>
    public void RecordReset()
    {
        Interlocked.Increment(ref _reset);
        _sink?.Invoke($"scroll.reset slug={ScrollRestorationRegistration.Slug}");
    }

    /// <summary>Count a per-frame capture (counter only; deliberately not emitted to avoid flooding the sink).</summary>
    public void RecordCaptured() => Interlocked.Increment(ref _captured);
}
