namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ScrollRestoration"/> view — the native port of the web
/// component (web/src/components/layout/ScrollRestoration.tsx). The web component runs two effects keyed on the
/// location: a capture <c>useEffect</c> that records the scroll offset per location key while the user scrolls
/// (rAF-throttled) and flushes the final position on cleanup, and a restore <c>useLayoutEffect</c> that, on a POP
/// navigation, restores the saved offset (or the top when none) and, on a PUSH / REPLACE navigation, scrolls to the
/// top. This holder reproduces that exactly:
/// <list type="bullet">
/// <item><description>
/// on <see cref="Start"/> (mount) it establishes the current location key (web capture-effect
/// <c>lastKey.current</c>), subscribes to the scroll seam and applies the initial position (web layout effect runs
/// on mount);
/// </description></item>
/// <item><description>
/// while scrolling, each scroll event coalesces to at most one persisted write per frame via the
/// <see cref="IFrameScheduler"/> seam (web <c>requestAnimationFrame</c> throttle);
/// </description></item>
/// <item><description>
/// on every navigation it flushes the outgoing position under the OLD key, cancels any pending capture, moves the
/// key and applies the restore (POP) or reset (PUSH / REPLACE) decision from
/// <see cref="ScrollRestorationProjection.Resolve"/>;
/// </description></item>
/// <item><description>
/// on <see cref="Dispose"/> (unmount) it flushes the final position and detaches from both seams (web effect
/// cleanup).
/// </description></item>
/// </list>
/// Because the surface has no data fetch, there is no loading / error / stale / offline branch to model (the web
/// source has none); the behavioural states are mount, continuous capture, POP restore and PUSH / REPLACE reset.
/// The outgoing flush runs BEFORE the restore (the order the rest of the native shell uses), so a back/forward
/// return lands where the user left rather than at a clobbered top. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class ScrollRestorationViewModel : IDisposable
{
    private readonly IScrollRestorationLocationSource _location;
    private readonly IScrollOffsetStore _store;
    private readonly IScrollSurface _surface;
    private readonly IFrameScheduler _frames;
    private readonly ScrollRestorationDiagnostics _diagnostics;

    private string? _currentKey;
    private IDisposable? _pendingFrame;
    private bool _frameScheduled;
    private bool _started;
    private bool _disposed;

    /// <summary>Creates the holder over the location + store + surface + frame seams, with optional diagnostics.</summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> + <c>useNavigationType</c> seam).</param>
    /// <param name="store">The per-location offset persistence port (web <c>sessionStorage</c> seam).</param>
    /// <param name="surface">The scrollable viewport port (web <c>#main-content</c> seam).</param>
    /// <param name="frames">The per-frame coalescing port (web <c>requestAnimationFrame</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public ScrollRestorationViewModel(
        IScrollRestorationLocationSource location,
        IScrollOffsetStore store,
        IScrollSurface surface,
        IFrameScheduler frames,
        ScrollRestorationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(surface);
        ArgumentNullException.ThrowIfNull(frames);

        _location = location;
        _store = store;
        _surface = surface;
        _frames = frames;
        _diagnostics = diagnostics ?? new ScrollRestorationDiagnostics();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ScrollRestoration</c>).</summary>
    public static string Slug => ScrollRestorationRegistration.Slug;

    /// <summary>The current per-location key (web capture-effect <c>lastKey.current</c>); null before <see cref="Start"/>.</summary>
    public string? CurrentKey => _currentKey;

    /// <summary>True while a per-frame capture is scheduled but has not yet fired (web rAF in flight).</summary>
    public bool HasPendingCapture => _frameScheduled;

    /// <summary>
    /// Begin restoring scroll positions (web component mount): emit the <c>view.opened</c> diagnostic, subscribe to
    /// the location and scroll seams, record the current key and apply the initial position. Idempotent — a second
    /// call is a no-op.
    /// </summary>
    public void Start()
    {
        if (_started || _disposed)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _location.Changed += OnLocationChanged;
        _surface.Scrolled += OnScrolled;

        // web capture effect (mount): lastKey.current = keyFor(pathname, search).
        _currentKey = ScrollRestorationRegistration.KeyFor(_location.Path, _location.Search);

        // web layout effect (mount): apply the initial position for the current navigation kind. The mount is
        // setup, not a navigation, so it does not count as a restore / reset in diagnostics.
        ApplyPosition();
    }

    private void OnLocationChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web capture-effect cleanup: flush the outgoing position under the OLD key so a back/forward return lands
        // where the user left. Done before the restore (the order the native shell uses) to avoid clobbering it.
        FlushCurrent();

        // web effect cleanup: cancel the outgoing location's not-yet-fired capture.
        CancelPendingFrame();

        // web capture effect: lastKey.current = keyFor(pathname, search) for the new location.
        _currentKey = ScrollRestorationRegistration.KeyFor(_location.Path, _location.Search);

        // web layout effect: restore (POP) or reset (PUSH / REPLACE), recording the navigation outcome.
        ApplyPosition();
        if (_location.NavigationKind == ScrollNavigationKind.Pop)
        {
            _diagnostics.RecordRestored();
        }
        else
        {
            _diagnostics.RecordReset();
        }
    }

    private void OnScrolled(object? sender, EventArgs e)
    {
        if (_disposed || _frameScheduled)
        {
            return;
        }

        // web onScroll: throttle to at most one write per frame (the `scheduled` guard + requestAnimationFrame).
        _frameScheduled = true;
        _pendingFrame = _frames.RequestFrame(OnFrame);
    }

    private void OnFrame()
    {
        _frameScheduled = false;
        _pendingFrame = null;

        if (_disposed)
        {
            return;
        }

        // web rAF body: writeSaved(lastKey.current, getScrollTop(target)).
        FlushCurrent();
        _diagnostics.RecordCaptured();
    }

    private void ApplyPosition()
    {
        ScrollNavigationKind kind = _location.NavigationKind;

        // web reads the saved offset only on POP; a fresh PUSH / REPLACE never touches the store.
        double? saved = kind == ScrollNavigationKind.Pop && _currentKey is not null
            ? _store.Read(_currentKey)
            : null;

        double target = ScrollRestorationProjection.Resolve(kind, saved);
        _surface.ScrollTo(target);
    }

    private void FlushCurrent()
    {
        if (_currentKey is not null)
        {
            _store.Write(_currentKey, _surface.Offset);
        }
    }

    private void CancelPendingFrame()
    {
        _pendingFrame?.Dispose();
        _pendingFrame = null;
        _frameScheduled = false;
    }

    /// <summary>Stop restoring, flush the final position and detach from the location + scroll seams (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _location.Changed -= OnLocationChanged;
        _surface.Scrolled -= OnScrolled;

        // web unmount cleanup: final flush of the current position.
        FlushCurrent();
        CancelPendingFrame();
        GC.SuppressFinalize(this);
    }
}
