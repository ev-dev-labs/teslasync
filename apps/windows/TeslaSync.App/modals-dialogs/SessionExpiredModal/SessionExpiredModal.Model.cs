using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Canonical metadata for the <c>SessionExpiredModal</c> overlay surface — the native mirror of the web
/// component at <c>web/src/components/feedback/SessionExpiredModal.tsx</c>. The web source hard-blocks the UI
/// when the upstream ForwardAuth session has fully expired: a centred lock glyph, a "Session expired" title, a
/// one-line security body, and a single primary "Sign in again" recovery action that hands off to the IdP
/// (<c>navigateToReauth</c>); the dialog is non-dismissible (Esc + backdrop are absorbed) so the only way out
/// is the explicit sign-in action, and it renders nothing at all in open (no-auth) mode. This holder pins the
/// diagnostics slug, the decorative Segoe Fluent lock glyph and every visible string's i18n key + English
/// fallback (the fallbacks mirror <c>Strings/en/Resources.resw</c> so the headless projection asserts the
/// rendered copy). UI-free so the metadata is asserted without a XAML host.
/// </summary>
public static class SessionExpiredModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the operational events.</summary>
    public const string Slug = "SessionExpiredModal";

    /// <summary>Segoe Fluent "Lock" glyph for the status badge (web Lucide <c>Lock</c>).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>i18n key for the modal title (web <c>session.expired.title</c>).</summary>
    public const string TitleKey = "session.expired.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Session expired";

    /// <summary>i18n key for the modal body (web <c>session.expired.body</c>).</summary>
    public const string BodyKey = "session.expired.body";

    /// <summary>English fallback for <see cref="BodyKey"/>.</summary>
    public const string BodyFallback =
        "For your security, your session has timed out. Sign in again to pick up where you left off.";

    /// <summary>i18n key for the primary recovery action (web <c>session.expired.signIn</c>).</summary>
    public const string SignInKey = "session.expired.signIn";

    /// <summary>English fallback for <see cref="SignInKey"/>.</summary>
    public const string SignInFallback = "Sign in again";
}

/// <summary>
/// The mutually-exclusive surface states the <see cref="SessionExpiredModalViewModel"/> resolves from the bound
/// session seams — the native modelling of the web component's render branches. The web source returns
/// <c>null</c> in open mode, keeps the modal closed while the session is live, and opens the hard block once
/// <c>hasExpired</c> or the <c>teslasync:session-expired</c> event fires. There is deliberately no
/// loading / error / stale / offline branch: the only asynchronous read lives upstream in
/// <c>useSessionMonitor</c>; this surface is a derived-boolean hard block over the monitor's resolved state
/// (the same shape as the sibling <c>TourLauncher</c> controller, which renders nothing until opened).
/// </summary>
public enum SessionExpiredModalState
{
    /// <summary>Open (no-auth) deployment — there is no session to expire, so the surface renders nothing
    /// (web <c>mode === 'open'</c> short-circuit returning <c>null</c>).</summary>
    Suppressed,

    /// <summary>Session mode and the session is still live — the modal is closed (web <c>open === false</c>).</summary>
    Dormant,

    /// <summary>The session has expired (or a 401 fired) — the non-dismissible hard block is shown
    /// (web <c>open === true</c>).</summary>
    Active,
}

/// <summary>
/// The render-ready view of the modal — the localized title, body, recovery action label, the decorative lock
/// glyph and the composed Narrator <see cref="AutomationName"/>. The copy is constant across every state (the
/// surface only ever shows this content when <see cref="SessionExpiredModalState.Active"/>); the live
/// open/suppressed decision lives on the view-model. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="Title">The localized modal title (web <c>session.expired.title</c>).</param>
/// <param name="Body">The localized security body copy (web <c>session.expired.body</c>).</param>
/// <param name="SignInLabel">The localized primary recovery action label (web <c>session.expired.signIn</c>).</param>
/// <param name="IconGlyph">The decorative Segoe Fluent lock glyph.</param>
/// <param name="AutomationName">The composed Narrator name for the dialog (title + body).</param>
public sealed record SessionExpiredModalDisplay(
    string Title,
    string Body,
    string SignInLabel,
    string IconGlyph,
    string AutomationName);

/// <summary>
/// Pure projection from the i18n facade + the resolved session inputs to the render-ready
/// <see cref="SessionExpiredModalDisplay"/> and the <see cref="SessionExpiredModalState"/> — the native port of
/// the web <c>SessionExpiredModal</c> render (web/src/components/feedback/SessionExpiredModal.tsx). It resolves
/// every label through the i18n facade and reproduces the web open-decision exactly (<c>mode === 'open'</c>
/// suppresses everything, otherwise <c>hasExpired || eventTriggered</c> opens the hard block). No WinUI types —
/// unit tested without a UI host.
/// </summary>
public static class SessionExpiredModalProjection
{
    /// <summary>
    /// Resolve the surface state from the session inputs — the native analogue of the web component's
    /// <c>if (mode === 'open') return null</c> guard followed by <c>open = hasExpired || eventTriggered</c>.
    /// Open mode suppresses the surface even when a hard-expiry signal has latched, mirroring the web
    /// short-circuit that runs before the event is consulted.
    /// </summary>
    /// <param name="mode">The resolved deployment mode (web <c>useSessionMonitor().mode</c>).</param>
    /// <param name="hasExpired">Whether the monitored session has expired (web <c>hasExpired</c>).</param>
    /// <param name="hardExpirySignaled">Whether a 401 hard-expiry event has latched (web <c>eventTriggered</c>).</param>
    public static SessionExpiredModalState Evaluate(SessionMode mode, bool hasExpired, bool hardExpirySignaled)
    {
        if (mode == SessionMode.Open)
        {
            return SessionExpiredModalState.Suppressed;
        }

        return hasExpired || hardExpirySignaled
            ? SessionExpiredModalState.Active
            : SessionExpiredModalState.Dormant;
    }

    /// <summary>
    /// Project the localized, render-ready display, resolving every label through <paramref name="localizer"/>
    /// and composing the Narrator name from the title and body.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    public static SessionExpiredModalDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(
            SessionExpiredModalRegistration.TitleKey, SessionExpiredModalRegistration.TitleFallback);
        string body = localizer.GetString(
            SessionExpiredModalRegistration.BodyKey, SessionExpiredModalRegistration.BodyFallback);
        string signIn = localizer.GetString(
            SessionExpiredModalRegistration.SignInKey, SessionExpiredModalRegistration.SignInFallback);

        string automationName = string.Create(CultureInfo.CurrentCulture, $"{title}. {body}");

        return new SessionExpiredModalDisplay(
            title, body, signIn, SessionExpiredModalRegistration.LockGlyph, automationName);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SessionExpiredModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never a session token, expiry timestamp or redirect target —
/// so a diagnostics line can never leak session data. Thread-safe.
/// </summary>
public sealed class SessionExpiredModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _reauthRequests;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public SessionExpiredModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the hard block has opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the re-auth recovery action was invoked.</summary>
    public long ReauthRequests => Interlocked.Read(ref _reauthRequests);

    /// <summary>Record that the hard block opened, emitting <c>view.opened slug=SessionExpiredModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SessionExpiredModalRegistration.Slug}");
    }

    /// <summary>Record that re-auth was requested, emitting <c>reauth.requested slug=SessionExpiredModal</c>.</summary>
    public void RecordReauthRequested()
    {
        Interlocked.Increment(ref _reauthRequests);
        _sink?.Invoke($"reauth.requested slug={SessionExpiredModalRegistration.Slug}");
    }
}
