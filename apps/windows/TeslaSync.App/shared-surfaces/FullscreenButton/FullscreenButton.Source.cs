namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The fullscreen seam the <c>FullscreenButton</c> surface drives (P1/S8 state-holder layer) — the native port of
/// the browser Fullscreen API the web component wraps (web/src/components/ui/FullscreenButton.tsx:
/// <c>document.fullscreenEnabled</c>, <c>element.requestFullscreen()</c>, <c>document.exitFullscreen()</c> and the
/// <c>fullscreenchange</c> event). On the web the component owns a <c>targetRef</c> element and toggles the
/// document's fullscreen state on it; WinUI has no document, so the host binds the window (or any presenter
/// target) it wants maximised through this seam. Implementations encapsulate ALL platform fullscreen I/O:
/// <see cref="IsSupported"/> mirrors <c>document.fullscreenEnabled</c> (the surface hides itself when false),
/// <see cref="IsFullscreen"/> mirrors <c>document.fullscreenElement === target</c>, <see cref="RequestFullscreen"/> /
/// <see cref="ExitFullscreen"/> mirror <c>requestFullscreen</c> / <c>exitFullscreen</c>, and <see cref="FullscreenChanged"/>
/// is raised whenever the platform's fullscreen state changes — INCLUDING changes the surface did not initiate
/// (the user pressing Esc, the OS revoking fullscreen, a sibling toggling the same target), exactly as the web
/// source syncs its state from the <c>fullscreenchange</c> event rather than from the click handler. The
/// production binding is the WinUI <c>AppWindow</c> controller (it needs a Windows runtime and lives with the
/// view); <see cref="InMemoryFullscreenController"/> is the WinUI-free implementation used by galleries and tests
/// (supported + interactive, or unsupported to drive the hidden state).
/// </summary>
public interface IFullscreenController
{
    /// <summary>
    /// Whether element-level fullscreen is available (web <c>document.fullscreenEnabled</c>). The surface renders
    /// nothing when this is <see langword="false"/>, reproducing the web <c>if (!supported) return null;</c>.
    /// </summary>
    bool IsSupported { get; }

    /// <summary>
    /// Whether the bound target is currently fullscreen (web <c>document.fullscreenElement === target</c> /
    /// <c>target.contains(document.fullscreenElement)</c>). Read at render time and kept in sync via
    /// <see cref="FullscreenChanged"/>.
    /// </summary>
    bool IsFullscreen { get; }

    /// <summary>
    /// Raised whenever the platform fullscreen state changes (web <c>fullscreenchange</c>) — both for changes the
    /// surface initiated and for external ones (Esc, OS revoke, a sibling toggling the same target).
    /// </summary>
    event EventHandler? FullscreenChanged;

    /// <summary>
    /// Make the bound target fullscreen (web <c>target.requestFullscreen()</c>). A no-op when fullscreen is
    /// unsupported or the target is already fullscreen.
    /// </summary>
    void RequestFullscreen();

    /// <summary>Leave fullscreen (web <c>document.exitFullscreen()</c>). A no-op when not currently fullscreen.</summary>
    void ExitFullscreen();
}

/// <summary>
/// An in-memory <see cref="IFullscreenController"/> — the WinUI-free implementation used by the headless gallery
/// default and by unit tests. It models a platform whose fullscreen state flips between windowed and fullscreen,
/// raising <see cref="FullscreenChanged"/> on every real transition exactly as the browser fires
/// <c>fullscreenchange</c>. Constructed with <c>isSupported: false</c> it models a platform with no fullscreen
/// support (web <c>document.fullscreenEnabled === false</c>), driving the surface's hidden state. Calling
/// <see cref="RequestFullscreen"/> / <see cref="ExitFullscreen"/> directly (rather than through the surface) reproduces an external
/// trigger — the user pressing Esc, the OS revoking fullscreen, or a sibling toggling the same target — so the
/// surface's event-sourced state sync is verified without a window.
/// </summary>
public sealed class InMemoryFullscreenController : IFullscreenController
{
    private bool _isFullscreen;

    /// <summary>Creates the controller.</summary>
    /// <param name="isSupported">Whether fullscreen is available (web <c>document.fullscreenEnabled</c>); default <see langword="true"/>.</param>
    /// <param name="initiallyFullscreen">Whether the target starts fullscreen; default <see langword="false"/> (ignored when unsupported).</param>
    public InMemoryFullscreenController(bool isSupported = true, bool initiallyFullscreen = false)
    {
        IsSupported = isSupported;
        _isFullscreen = isSupported && initiallyFullscreen;
    }

    /// <inheritdoc />
    public bool IsSupported { get; }

    /// <inheritdoc />
    public bool IsFullscreen => _isFullscreen;

    /// <inheritdoc />
    public event EventHandler? FullscreenChanged;

    /// <inheritdoc />
    public void RequestFullscreen()
    {
        if (!IsSupported || _isFullscreen)
        {
            return;
        }

        _isFullscreen = true;
        FullscreenChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void ExitFullscreen()
    {
        if (!_isFullscreen)
        {
            return;
        }

        _isFullscreen = false;
        FullscreenChanged?.Invoke(this, EventArgs.Empty);
    }
}
