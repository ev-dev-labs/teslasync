using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The resolved ForwardAuth deployment mode — the native analogue of the web <c>useSessionMonitor().mode</c>
/// (<c>'open' | 'session' | 'unknown'</c>). <see cref="Open"/> means there is no auth provider, so a session
/// timeout cannot apply and the surface renders nothing; <see cref="Session"/> means the proxy enforces a
/// session whose expiry the monitor tracks; <see cref="Unknown"/> is the pre-first-poll state (treated like a
/// live session — the hard block stays closed).
/// </summary>
public enum SessionMode
{
    /// <summary>Mode not yet resolved (web <c>'unknown'</c>) — the hard block stays closed.</summary>
    Unknown,

    /// <summary>No auth provider (web <c>'open'</c>) — the surface is suppressed entirely.</summary>
    Open,

    /// <summary>The proxy enforces a session (web <c>'session'</c>) whose expiry is monitored.</summary>
    Session,
}

/// <summary>
/// The session-liveness state holder the modal binds to (P1/S8 state-holder seam) — the native analogue of the
/// web <c>useSessionMonitor()</c> hook (web/src/hooks/useSessionMonitor.ts). A shell adapter polls
/// <c>/auth/session</c>, projects the resolved <see cref="Mode"/> and <see cref="HasExpired"/>, and raises
/// <see cref="Changed"/> whenever either flips (the native analogue of the hook re-rendering its consumers); a
/// test fake supplies fixed values and raises <see cref="Changed"/> on demand. The view never polls or reads
/// HTTP — it binds to this seam.
/// </summary>
public interface ISessionMonitor
{
    /// <summary>The resolved deployment mode (web <c>useSessionMonitor().mode</c>).</summary>
    SessionMode Mode { get; }

    /// <summary>True once the monitored session has expired (web <c>hasExpired</c>).</summary>
    bool HasExpired { get; }

    /// <summary>Raised when <see cref="Mode"/> or <see cref="HasExpired"/> changes (web hook re-render).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The hard-expiry broadcast the modal binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>teslasync:session-expired</c> document event that <c>resilientFetch</c> dispatches whenever any API call
/// returns 401 (the "sat idle long enough that the proxy invalidated us between polls" path). A shell adapter
/// bridges the resilient HTTP client's 401 signal to <see cref="Triggered"/>; a test fake raises it directly.
/// Once raised the modal latches open, mirroring the web component's <c>eventTriggered</c> state that is set
/// true and never reset (recovery is the explicit re-auth handoff, which navigates away).
/// </summary>
public interface ISessionExpiryBroadcast
{
    /// <summary>Raised when a 401 hard-expiry has been observed (web <c>teslasync:session-expired</c>).</summary>
    event EventHandler? Triggered;
}

/// <summary>
/// The IdP re-auth handoff the modal binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>navigateToReauth()</c> helper from <c>web/src/lib/resilience</c>. A shell adapter performs the
/// platform's documented re-auth entry (launching the configured IdP start URL); a test fake records the call.
/// The view never performs the handoff itself — it invokes the seam through the view-model command.
/// </summary>
public interface IReauthHandoff
{
    /// <summary>Hand off to the IdP's re-auth entry point (web <c>navigateToReauth()</c>).</summary>
    void NavigateToReauth();
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SessionExpiredModal"/> view — the native port of
/// the web component (web/src/components/feedback/SessionExpiredModal.tsx). The web component derives its
/// <c>open</c> state from <c>useSessionMonitor()</c> and the <c>teslasync:session-expired</c> document event,
/// suppresses itself entirely in open mode, and offers a single non-dismissible "Sign in again" recovery
/// action that hands off to the IdP. This holder reproduces that: it binds to <see cref="ISessionMonitor"/> +
/// <see cref="ISessionExpiryBroadcast"/>, latches the 401 signal, projects the localized
/// <see cref="Display"/> through <see cref="SessionExpiredModalProjection"/>, resolves the mutually-exclusive
/// <see cref="State"/> (and the derived <see cref="IsOpen"/> / <see cref="IsSuppressed"/>), emits the
/// <c>view.opened</c> diagnostic when the hard block opens, and exposes the <see cref="RequestReauth"/> command
/// that raises the bound handoff. There is no fetch here (the only asynchronous read lives upstream in the
/// monitor seam), so there is no loading / error / stale / offline branch to model. The view never performs
/// HTTP. Drive it from one confinement (the UI thread); it is not internally synchronised. Dispose it to
/// detach from the bound seams.
/// </summary>
public sealed class SessionExpiredModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ISessionMonitor _monitor;
    private readonly ISessionExpiryBroadcast _broadcast;
    private readonly IReauthHandoff _reauth;
    private readonly SessionExpiredModalDiagnostics _diagnostics;

    private SessionExpiredModalDisplay _display;
    private SessionExpiredModalState _state;
    private bool _hardExpirySignaled;
    private bool _disposed;

    /// <summary>Creates the holder over the i18n facade, the session seams, the re-auth handoff and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="monitor">The session-liveness seam (web <c>useSessionMonitor</c>).</param>
    /// <param name="broadcast">The 401 hard-expiry broadcast (web <c>teslasync:session-expired</c> event).</param>
    /// <param name="reauth">The IdP re-auth handoff (web <c>navigateToReauth</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public SessionExpiredModalViewModel(
        ILocalizer localizer,
        ISessionMonitor monitor,
        ISessionExpiryBroadcast broadcast,
        IReauthHandoff reauth,
        SessionExpiredModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(monitor);
        ArgumentNullException.ThrowIfNull(broadcast);
        ArgumentNullException.ThrowIfNull(reauth);

        _localizer = localizer;
        _monitor = monitor;
        _broadcast = broadcast;
        _reauth = reauth;
        _diagnostics = diagnostics ?? new SessionExpiredModalDiagnostics();

        _display = SessionExpiredModalProjection.Project(_localizer);
        _state = SessionExpiredModalProjection.Evaluate(_monitor.Mode, _monitor.HasExpired, _hardExpirySignaled);

        // The session may already be expired before this holder was constructed (the page mounted into a
        // dead session); count that initial hard block exactly as a later transition would.
        if (_state == SessionExpiredModalState.Active)
        {
            _diagnostics.RecordViewOpened();
        }

        _monitor.Changed += OnSessionChanged;
        _broadcast.Triggered += OnHardExpirySignaled;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, localized, render-ready display (constant across states; re-resolved on <see cref="Reload"/>).</summary>
    public SessionExpiredModalDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The resolved, mutually-exclusive surface state.</summary>
    public SessionExpiredModalState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            bool opening = _state != SessionExpiredModalState.Active && value == SessionExpiredModalState.Active;
            _state = value;
            Raise(nameof(State));
            Raise(nameof(IsOpen));
            Raise(nameof(IsSuppressed));

            if (opening)
            {
                _diagnostics.RecordViewOpened();
            }
        }
    }

    /// <summary>True while the non-dismissible hard block is shown (web <c>open === true</c>).</summary>
    public bool IsOpen => _state == SessionExpiredModalState.Active;

    /// <summary>True in open (no-auth) mode, where the surface renders nothing (web <c>mode === 'open'</c>).</summary>
    public bool IsSuppressed => _state == SessionExpiredModalState.Suppressed;

    /// <summary>
    /// Invoke the re-auth recovery action (web <c>handleSignIn</c> -> <c>navigateToReauth()</c>): record the
    /// request and hand off to the IdP. The hard block intentionally stays open — recovery completes when the
    /// monitor reports a live session again (or the handoff navigates the app away), mirroring the web
    /// component, which never lowers <c>open</c> on click.
    /// </summary>
    public void RequestReauth()
    {
        _diagnostics.RecordReauthRequested();
        _reauth.NavigateToReauth();
    }

    /// <summary>
    /// Re-resolve every label and re-project the display — the native analogue of react-i18next re-rendering
    /// after the active language changes. The resolved <see cref="State"/> is unaffected.
    /// </summary>
    public void Reload() => Display = SessionExpiredModalProjection.Project(_localizer);

    private void OnSessionChanged(object? sender, EventArgs e) => Reevaluate();

    private void OnHardExpirySignaled(object? sender, EventArgs e)
    {
        // web setEventTriggered(true) — latched and never reset; recovery is the explicit re-auth handoff.
        _hardExpirySignaled = true;
        Reevaluate();
    }

    private void Reevaluate() =>
        State = SessionExpiredModalProjection.Evaluate(_monitor.Mode, _monitor.HasExpired, _hardExpirySignaled);

    /// <summary>Detach from the bound session seams and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _monitor.Changed -= OnSessionChanged;
        _broadcast.Triggered -= OnHardExpirySignaled;
        GC.SuppressFinalize(this);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
