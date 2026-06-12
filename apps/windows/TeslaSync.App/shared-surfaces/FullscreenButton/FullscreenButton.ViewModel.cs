using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FullscreenButton"/> view — the native port of the web
/// component body (web/src/components/ui/FullscreenButton.tsx). It mirrors the web source's behaviour exactly: the
/// support gate (web <c>const [supported] = useState(probeSupport())</c>; <c>if (!supported) return null;</c>)
/// surfaced as <see cref="IsVisible"/>; the <see cref="IsFullscreen"/> flag (web <c>isFs</c>) that is sourced from
/// the platform's <see cref="IFullscreenController.FullscreenChanged"/> event (web <c>fullscreenchange</c>) and
/// NOT from the click, so the button stays in sync when the user presses Esc, when the OS revokes fullscreen, or
/// when a sibling toggles the same target; the icon + label toggle (<see cref="ShowExitIcon"/> / <see cref="Label"/>
/// — web <c>isFs ? &lt;Minimize/&gt; : &lt;Maximize/&gt;</c> and <c>isFs ? exitLabel : enterLabel</c>); the
/// optional caller label overrides (web <c>ariaLabelEnter</c> / <c>ariaLabelExit</c> props); the constant coupling
/// of accessible name + tooltip + pressed state to the visible label (web <c>aria-label</c> === <c>title</c> and
/// <c>aria-pressed={isFs}</c>); and the <see cref="StateAttribute"/> (web <c>data-fullscreen-state</c>). The
/// <see cref="Toggle"/> action reproduces the web <c>toggle()</c>: it asks the controller to exit when the target
/// already holds fullscreen, otherwise to enter — it never sets <see cref="IsFullscreen"/> directly, leaving the
/// state to flow from the controller's change event. Every label resolves through the i18n facade (web
/// <c>useTranslation()</c>). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FullscreenButtonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFullscreenController _controller;
    private readonly ILocalizer _localizer;
    private readonly string? _enterLabelOverride;
    private readonly string? _exitLabelOverride;

    private bool _isFullscreen;
    private bool _disposed;

    /// <summary>Creates the holder over its fullscreen seam (P1/S8), the i18n facade and the optional label overrides.</summary>
    /// <param name="controller">The fullscreen seam (web Fullscreen API bound to the <c>targetRef</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation()</c>).</param>
    /// <param name="enterLabelOverride">Optional override for the enter label (web <c>ariaLabelEnter</c> prop); null uses the localized default.</param>
    /// <param name="exitLabelOverride">Optional override for the exit label (web <c>ariaLabelExit</c> prop); null uses the localized default.</param>
    public FullscreenButtonViewModel(
        IFullscreenController controller,
        ILocalizer localizer,
        string? enterLabelOverride = null,
        string? exitLabelOverride = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _controller = controller;
        _localizer = localizer;
        _enterLabelOverride = enterLabelOverride;
        _exitLabelOverride = exitLabelOverride;

        _isFullscreen = controller.IsSupported && controller.IsFullscreen;
        _controller.FullscreenChanged += OnFullscreenChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>FullscreenButton</c>).</summary>
    public static string Slug => FullscreenButtonRegistration.Slug;

    /// <summary>Whether the platform supports element-level fullscreen (web <c>supported</c>).</summary>
    public bool IsSupported => _controller.IsSupported;

    /// <summary>
    /// Whether the surface renders at all — false hides it entirely (web <c>if (!supported) return null;</c>).
    /// Determined by the controller at construction and stable for the surface's lifetime.
    /// </summary>
    public bool IsVisible => _controller.IsSupported;

    /// <summary>
    /// Whether the bound target is currently fullscreen (web <c>isFs</c>). Sourced from the controller's change
    /// event, never set by <see cref="Toggle"/>.
    /// </summary>
    public bool IsFullscreen => _isFullscreen;

    /// <summary>
    /// The "enter fullscreen" label — the caller override when supplied, otherwise the localized default (web
    /// <c>ariaLabelEnter ?? t('common.fullscreen.enter', 'Enter fullscreen')</c>).
    /// </summary>
    public string EnterLabel =>
        _enterLabelOverride
        ?? _localizer.GetString(FullscreenButtonRegistration.EnterKey, FullscreenButtonRegistration.EnterFallback);

    /// <summary>
    /// The "exit fullscreen" label — the caller override when supplied, otherwise the localized default (web
    /// <c>ariaLabelExit ?? t('common.fullscreen.exit', 'Exit fullscreen')</c>).
    /// </summary>
    public string ExitLabel =>
        _exitLabelOverride
        ?? _localizer.GetString(FullscreenButtonRegistration.ExitKey, FullscreenButtonRegistration.ExitFallback);

    /// <summary>
    /// The active label — the exit label while fullscreen, otherwise the enter label (web
    /// <c>label = isFs ? exitLabel : enterLabel</c>).
    /// </summary>
    public string Label => _isFullscreen ? ExitLabel : EnterLabel;

    /// <summary>
    /// The accessible name + tooltip text — equal to <see cref="Label"/> because the web source binds
    /// <c>aria-label</c> and <c>title</c> to the same value, both flipping with the fullscreen state.
    /// </summary>
    public string AccessibleLabel => Label;

    /// <summary>Whether the control reports itself as pressed (web <c>aria-pressed={isFs}</c>).</summary>
    public bool IsPressed => _isFullscreen;

    /// <summary>
    /// Whether to show the exit (minimise) icon rather than the enter (maximise) icon — true exactly while
    /// fullscreen (web <c>icon={isFs ? &lt;Minimize/&gt; : &lt;Maximize/&gt;}</c>).
    /// </summary>
    public bool ShowExitIcon => _isFullscreen;

    /// <summary>
    /// The <c>data-fullscreen-state</c> value — <c>"on"</c> while fullscreen, otherwise <c>"off"</c> (web
    /// <c>data-fullscreen-state={isFs ? 'on' : 'off'}</c>).
    /// </summary>
    public string StateAttribute =>
        _isFullscreen ? FullscreenButtonRegistration.StateOn : FullscreenButtonRegistration.StateOff;

    /// <summary>
    /// Toggle fullscreen (web <c>toggle()</c>): exit when the target already holds fullscreen, otherwise request
    /// it. The controller raises <see cref="IFullscreenController.FullscreenChanged"/>, which drives
    /// <see cref="IsFullscreen"/> — state is sourced from the event, never set here. A no-op (beyond the
    /// controller's own guard) when the platform is unsupported.
    /// </summary>
    public void Toggle()
    {
        if (_controller.IsFullscreen)
        {
            _controller.ExitFullscreen();
        }
        else
        {
            _controller.RequestFullscreen();
        }
    }

    /// <summary>Detach from the controller's change event (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _controller.FullscreenChanged -= OnFullscreenChanged;
        GC.SuppressFinalize(this);
    }

    private void OnFullscreenChanged(object? sender, EventArgs e)
    {
        bool next = _controller.IsSupported && _controller.IsFullscreen;
        if (_isFullscreen == next)
        {
            return;
        }

        _isFullscreen = next;
        Raise(nameof(IsFullscreen));
        Raise(nameof(Label));
        Raise(nameof(AccessibleLabel));
        Raise(nameof(IsPressed));
        Raise(nameof(ShowExitIcon));
        Raise(nameof(StateAttribute));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
