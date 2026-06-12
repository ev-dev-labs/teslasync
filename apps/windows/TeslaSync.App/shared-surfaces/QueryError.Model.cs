using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The five failure modes the <c>QueryError</c> surface branches into — the native analogue of the web
/// <c>QueryError</c> ladder (web/src/components/feedback/QueryError.tsx L75-199). It adds the calm
/// transient-waiting mode (<see cref="Waiting"/>) ahead of the four <c>ErrorDisplay</c> branches: the 404
/// (<see cref="NotFound"/>), the 401/403 (<see cref="Unauthorized"/>), the 5xx (<see cref="ServerError"/>) and the
/// catch-all network / offline / unknown branch (<see cref="Network"/>). The offline-versus-unreachable split the
/// web makes inside its network branch is carried as a flag on the projection, not a separate kind.
/// </summary>
public enum QueryErrorKind
{
    /// <summary>
    /// A recoverable wait — a rate-limited (429) or upstream-breaker-open (503) error the web classifies through
    /// <c>isTransientWaiting()</c> (web/src/lib/errorClassification.ts). Checked first so the calm waiting card is
    /// shown instead of a loud failure while the global rate-limit banner owns the countdown.
    /// </summary>
    Waiting,

    /// <summary>A 404 — the record was deleted or the URL is wrong (web <c>status === 404</c>).</summary>
    NotFound,

    /// <summary>A 401 / 403 — the session expired or RBAC mismatch (web <c>status === 401 || status === 403</c>).</summary>
    Unauthorized,

    /// <summary>A 5xx — a backend failure (web <c>status &gt;= 500</c>).</summary>
    ServerError,

    /// <summary>Network / offline / unknown — the web fall-through branch (no API status, status 0, or 4xx other than 404/401/403).</summary>
    Network,
}

/// <summary>
/// The call-to-action the <c>QueryError</c> renders for the resolved branch — the native analogue of the web
/// <c>ErrorState</c> <c>action</c> prop (web/src/components/feedback/QueryError.tsx). Exactly one applies per
/// projection; <see cref="None"/> is the web <c>action={undefined}</c> case (no button rendered, e.g. the waiting
/// card whose Retry is owned by the global banner).
/// </summary>
public enum QueryErrorActionKind
{
    /// <summary>No action button (web <c>action</c> is undefined).</summary>
    None,

    /// <summary>"Back to list" — navigates to the resource's list view (web 404 <c>navigate(listHref)</c>).</summary>
    BackToList,

    /// <summary>"Sign in" — sends the user to the login route (web 401/403 <c>window.location.href = '/login'</c>).</summary>
    SignIn,

    /// <summary>"Retry" — re-runs the failed query (web <c>onRetry</c>).</summary>
    Retry,

    /// <summary>"Retry when online" — the disabled offline retry affordance (web offline <c>disabled</c> button).</summary>
    RetryWhenOnline,
}

/// <summary>
/// One immutable description of the error the <c>QueryError</c> is asked to render — the native analogue of the
/// web component's props plus the locally derived classification (web/src/components/feedback/QueryError.tsx
/// L11-51): whether the error is a recoverable wait (<see cref="TransientWaiting"/> — the web
/// <c>isTransientWaiting(error)</c>), the resolved API <see cref="Status"/> (the web
/// <c>isApiError(error) ? error.status : undefined</c>; null for a non-API error), whether there is an error at
/// all (<see cref="HasError"/> — the web <c>if (!error) return null</c> gate), whether a retry handler was
/// supplied (<see cref="CanRetry"/> — the web <c>onRetry</c> presence), and the optional
/// <see cref="ResourceName"/> / <see cref="ListHref"/> the 404 branch reads. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="TransientWaiting">Whether the error is a rate-limit / breaker-open wait (web <c>isTransientWaiting(error)</c>).</param>
/// <param name="Status">The resolved API status code, or null for a non-API / unknown error (web <c>status</c>).</param>
/// <param name="HasError">Whether an error is present at all (web truthiness of <c>error</c>).</param>
/// <param name="CanRetry">Whether a retry handler was supplied (web <c>onRetry != null</c>).</param>
/// <param name="ResourceName">Singular human-readable resource name used in 404 titles (web <c>resourceName</c>).</param>
/// <param name="ListHref">Route to the corresponding list view, enabling the 404 CTA (web <c>listHref</c>).</param>
public sealed record QueryErrorRequest(
    bool TransientWaiting,
    int? Status,
    bool HasError,
    bool CanRetry,
    string? ResourceName,
    string? ListHref)
{
    /// <summary>The "no error" request — nothing is rendered (web <c>error</c> is falsy).</summary>
    public static QueryErrorRequest None { get; } =
        new(TransientWaiting: false, Status: null, HasError: false, CanRetry: false, ResourceName: null, ListHref: null);

    /// <summary>
    /// Build a request for a present error (web <c>error</c> is truthy). <paramref name="transientWaiting"/> is the
    /// web <c>isTransientWaiting(error)</c> verdict and <paramref name="status"/> is the resolved API status (null
    /// for a non-API error → the network branch).
    /// </summary>
    /// <param name="transientWaiting">Whether the error is a rate-limit / breaker-open wait (web <c>isTransientWaiting(error)</c>).</param>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="canRetry">Whether a retry handler was supplied (web <c>onRetry != null</c>).</param>
    /// <param name="resourceName">Singular resource name used in 404 titles (web <c>resourceName</c>).</param>
    /// <param name="listHref">Route to the list view, enabling the 404 CTA (web <c>listHref</c>).</param>
    public static QueryErrorRequest ForError(
        bool transientWaiting,
        int? status,
        bool canRetry = false,
        string? resourceName = null,
        string? listHref = null) =>
        new(transientWaiting, status, HasError: true, canRetry, resourceName, listHref);
}

/// <summary>
/// Canonical metadata for the QueryError surface — the native analogue of the literals, status ladder and
/// per-branch icons in web/src/components/feedback/QueryError.tsx and its <c>_ErrorState</c> chrome
/// (web/src/components/feedback/_ErrorState.tsx). Carries the diagnostics slug, the card / action automation ids,
/// the ARIA role + live settings, the i18n keys (each with the English fallback the web renders — the real
/// <c>t()</c> keys, present verbatim in the generated WinUI catalogue), the Segoe Fluent glyphs standing in for
/// the web Lucide icons, the rose danger tint recipe the <c>_ErrorState</c> card is painted with, the login route
/// the "Sign in" CTA targets, and the pure transient-waiting/status-&gt;kind and offline classification. UI-free
/// so it is asserted in tests.
/// </summary>
public static class QueryErrorRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "QueryError";

    /// <summary>The automation id Narrator and UI-automation resolve the error card by.</summary>
    public const string CardAutomationId = "query-error";

    /// <summary>The automation id Narrator and UI-automation resolve the action button by.</summary>
    public const string ActionAutomationId = "query-error-action";

    /// <summary>ARIA role for a blocking failure — an assertive alert region (web <c>role="alert"</c>).</summary>
    public const string RoleAlert = "alert";

    /// <summary>ARIA role for the non-blocking waiting / offline state — a polite status region (web <c>role="status"</c>).</summary>
    public const string RoleStatus = "status";

    /// <summary>ARIA live urgency for an alert — interrupts the screen reader (web <c>aria-live="assertive"</c>).</summary>
    public const string LiveAssertive = "assertive";

    /// <summary>ARIA live urgency for a status — waits for a pause (web <c>aria-live="polite"</c>).</summary>
    public const string LivePolite = "polite";

    /// <summary>The route the "Sign in" CTA navigates to (web <c>window.location.href = '/login'</c>).</summary>
    public const string LoginRoute = "/login";

    /// <summary>Segoe Fluent "Clock" glyph — the native stand-in for the web Lucide <c>Clock</c> (waiting) icon.</summary>
    public const string WaitingGlyph = "\uE121";

    /// <summary>Segoe Fluent "Help" glyph — the native stand-in for the web Lucide <c>FileQuestion</c> (404) icon.</summary>
    public const string NotFoundGlyph = "\uE897";

    /// <summary>Segoe Fluent "Lock" glyph — the native stand-in for the web Lucide <c>Lock</c> (401/403) icon.</summary>
    public const string UnauthorizedGlyph = "\uE72E";

    /// <summary>Segoe Fluent "Server" glyph — the native stand-in for the web Lucide <c>Server</c> (5xx) icon.</summary>
    public const string ServerErrorGlyph = "\uE968";

    /// <summary>Segoe Fluent "Error" glyph — the native stand-in for the web Lucide <c>AlertCircle</c> (unreachable) icon.</summary>
    public const string NetworkErrorGlyph = "\uE783";

    /// <summary>Segoe Fluent "WifiOff" glyph — the native stand-in for the web Lucide <c>WifiOff</c> (offline) icon.</summary>
    public const string NetworkOfflineGlyph = "\uEB5E";

    /// <summary>Card background alpha over the danger colour (web <c>bg-rose-500/5</c>).</summary>
    public const double CardBackgroundOpacity = 0.05;

    /// <summary>Card border alpha over the danger colour (web <c>border-rose-500/20</c>).</summary>
    public const double CardBorderOpacity = 0.20;

    /// <summary>Icon-chip background alpha over the danger colour (web <c>bg-rose-500/10</c>).</summary>
    public const double IconChipOpacity = 0.10;

    /// <summary>Message-text alpha over the danger foreground (web <c>text-rose-300/70</c>).</summary>
    public const double MessageForegroundOpacity = 0.70;

    /// <summary>Generated design-token colour key the card tints are derived from (web rose-500).</summary>
    public const string DangerColorKey = "TsColorDangerColor";

    /// <summary>Generated design-token brush key for the danger foreground (web rose-300).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>i18n key for the waiting title (web <c>error.waiting.title</c>).</summary>
    public const string WaitingTitleKey = "translation.error.waiting.title";

    /// <summary>English fallback for <see cref="WaitingTitleKey"/> — the web literal, verbatim.</summary>
    public const string WaitingTitleFallback = "Waiting for upstream";

    /// <summary>i18n key for the waiting message (web <c>error.waiting.message</c>).</summary>
    public const string WaitingMessageKey = "translation.error.waiting.message";

    /// <summary>English fallback for <see cref="WaitingMessageKey"/> — the web literal, verbatim.</summary>
    public const string WaitingMessageFallback = "We're pausing requests briefly. Data will refresh automatically.";

    /// <summary>i18n key for the 404 title (web <c>error.notFound.title</c>); <c>{0}</c> = the resource name.</summary>
    public const string NotFoundTitleKey = "translation.error.notFound.title";

    /// <summary>English fallback for <see cref="NotFoundTitleKey"/> — the web literal with a positional argument.</summary>
    public const string NotFoundTitleFallback = "{0} not found";

    /// <summary>i18n key for the 404 message (web <c>error.notFound.message</c>).</summary>
    public const string NotFoundMessageKey = "translation.error.notFound.message";

    /// <summary>English fallback for <see cref="NotFoundMessageKey"/> — the web literal, verbatim.</summary>
    public const string NotFoundMessageFallback = "It may have been deleted or the link is wrong.";

    /// <summary>i18n key for the default 404 resource noun (web <c>error.notFound.thingDefault</c>).</summary>
    public const string NotFoundThingDefaultKey = "translation.error.notFound.thingDefault";

    /// <summary>English fallback for <see cref="NotFoundThingDefaultKey"/> — the web literal, verbatim.</summary>
    public const string NotFoundThingDefaultFallback = "Resource";

    /// <summary>i18n key for the 404 CTA (web <c>error.notFound.cta</c>).</summary>
    public const string NotFoundCtaKey = "translation.error.notFound.cta";

    /// <summary>English fallback for <see cref="NotFoundCtaKey"/> — the web literal, verbatim.</summary>
    public const string NotFoundCtaFallback = "Back to list";

    /// <summary>i18n key for the 401/403 title (web <c>error.unauthorized.title</c>).</summary>
    public const string UnauthorizedTitleKey = "translation.error.unauthorized.title";

    /// <summary>English fallback for <see cref="UnauthorizedTitleKey"/> — the web literal, verbatim.</summary>
    public const string UnauthorizedTitleFallback = "Sign in required";

    /// <summary>i18n key for the 401/403 message (web <c>error.unauthorized.message</c>).</summary>
    public const string UnauthorizedMessageKey = "translation.error.unauthorized.message";

    /// <summary>English fallback for <see cref="UnauthorizedMessageKey"/> — the web literal, verbatim.</summary>
    public const string UnauthorizedMessageFallback = "Your session has expired. Please sign in again.";

    /// <summary>i18n key for the 401/403 CTA (web <c>error.unauthorized.cta</c>).</summary>
    public const string UnauthorizedCtaKey = "translation.error.unauthorized.cta";

    /// <summary>English fallback for <see cref="UnauthorizedCtaKey"/> — the web literal, verbatim.</summary>
    public const string UnauthorizedCtaFallback = "Sign in";

    /// <summary>i18n key for the 5xx title (web <c>error.serverError.title</c>).</summary>
    public const string ServerErrorTitleKey = "translation.error.serverError.title";

    /// <summary>English fallback for <see cref="ServerErrorTitleKey"/> — the web literal, verbatim.</summary>
    public const string ServerErrorTitleFallback = "Server error";

    /// <summary>i18n key for the 5xx message (web <c>error.serverError.message</c>).</summary>
    public const string ServerErrorMessageKey = "translation.error.serverError.message";

    /// <summary>English fallback for <see cref="ServerErrorMessageKey"/> — the web literal, verbatim.</summary>
    public const string ServerErrorMessageFallback = "Something went wrong on our end. Please try again.";

    /// <summary>i18n key for the offline title (web <c>error.network.offlineTitle</c>).</summary>
    public const string NetworkOfflineTitleKey = "translation.error.network.offlineTitle";

    /// <summary>English fallback for <see cref="NetworkOfflineTitleKey"/> — the web literal, verbatim.</summary>
    public const string NetworkOfflineTitleFallback = "You're offline";

    /// <summary>i18n key for the unreachable title (web <c>error.network.title</c>).</summary>
    public const string NetworkTitleKey = "translation.error.network.title";

    /// <summary>English fallback for <see cref="NetworkTitleKey"/> — the web literal, verbatim.</summary>
    public const string NetworkTitleFallback = "Can't reach server";

    /// <summary>i18n key for the offline detail (web <c>error.network.offlineDetail</c>).</summary>
    public const string NetworkOfflineDetailKey = "translation.error.network.offlineDetail";

    /// <summary>English fallback for <see cref="NetworkOfflineDetailKey"/> — the web literal, verbatim.</summary>
    public const string NetworkOfflineDetailFallback = "We'll retry automatically when your connection returns.";

    /// <summary>i18n key for the unreachable message (web <c>error.network.message</c>).</summary>
    public const string NetworkMessageKey = "translation.error.network.message";

    /// <summary>English fallback for <see cref="NetworkMessageKey"/> — the web literal, verbatim.</summary>
    public const string NetworkMessageFallback = "Check your internet connection and try again.";

    /// <summary>i18n key for the offline retry label (web <c>error.network.retryWhenOnline</c>).</summary>
    public const string NetworkRetryWhenOnlineKey = "translation.error.network.retryWhenOnline";

    /// <summary>English fallback for <see cref="NetworkRetryWhenOnlineKey"/> — the web literal, verbatim.</summary>
    public const string NetworkRetryWhenOnlineFallback = "Retry when online";

    /// <summary>i18n key for the generic retry label (web <c>error.retry</c>).</summary>
    public const string RetryKey = "translation.error.retry";

    /// <summary>English fallback for <see cref="RetryKey"/> — the web literal, verbatim.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>
    /// Classify a transient-waiting verdict + API status into a failure branch — the native port of the web ladder
    /// (web/src/components/feedback/QueryError.tsx L75-165): a transient wait wins outright, then 404 → not-found,
    /// 401/403 → unauthorized, 5xx → server error, everything else (no status, status 0, other 4xx) → the network
    /// branch.
    /// </summary>
    /// <param name="transientWaiting">Whether the error is a rate-limit / breaker-open wait (web <c>isTransientWaiting(error)</c>).</param>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    public static QueryErrorKind ClassifyKind(bool transientWaiting, int? status)
    {
        if (transientWaiting)
        {
            return QueryErrorKind.Waiting;
        }

        return status switch
        {
            404 => QueryErrorKind.NotFound,
            401 or 403 => QueryErrorKind.Unauthorized,
            >= 500 => QueryErrorKind.ServerError,
            _ => QueryErrorKind.Network,
        };
    }

    /// <summary>
    /// Whether the network branch is in its offline state — the native port of the web
    /// <c>const isOffline = !online || status === 0</c> (web/src/components/feedback/QueryError.tsx L165): the
    /// device reports offline, or the fetch never reached the network (status 0).
    /// </summary>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="isOnline">Whether the device currently reports a connection (web <c>online</c>).</param>
    public static bool IsOffline(int? status, bool isOnline) => !isOnline || status == 0;

    /// <summary>The Segoe Fluent glyph for a resolved branch (web Lucide icon table); <paramref name="offline"/> only affects the network branch.</summary>
    /// <param name="kind">The resolved failure branch.</param>
    /// <param name="offline">Whether the network branch is offline.</param>
    public static string GlyphFor(QueryErrorKind kind, bool offline) => kind switch
    {
        QueryErrorKind.Waiting => WaitingGlyph,
        QueryErrorKind.NotFound => NotFoundGlyph,
        QueryErrorKind.Unauthorized => UnauthorizedGlyph,
        QueryErrorKind.ServerError => ServerErrorGlyph,
        _ => offline ? NetworkOfflineGlyph : NetworkErrorGlyph,
    };
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="QueryErrorRequest"/> + connectivity — everything the
/// web <c>QueryError</c> derives before returning its <c>_ErrorState</c> JSX
/// (web/src/components/feedback/QueryError.tsx L68-199): whether anything is shown (<see cref="IsVisible"/> — the
/// web <c>if (!error) return null</c> gate), the resolved <see cref="Kind"/> and its offline sub-state, the Segoe
/// Fluent <see cref="IconGlyph"/>, the localized <see cref="Title"/> / <see cref="Message"/>, the
/// <see cref="ActionKind"/> + localized <see cref="ActionLabel"/> + whether the action is
/// <see cref="ActionEnabled"/> (the web offline <c>disabled</c> retry) + its <see cref="NavigationTarget"/>, the
/// ARIA <see cref="Role"/> / <see cref="LiveSetting"/>, whether the connection-restored auto-retry is armed
/// (<see cref="AutoRetryEligible"/> — the web reconnect effect) and the composed <see cref="AccessibleName"/> a
/// screen reader announces. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct QueryErrorProjection
{
    private QueryErrorProjection(
        bool isVisible,
        QueryErrorKind kind,
        bool isOffline,
        string iconGlyph,
        string title,
        string message,
        QueryErrorActionKind actionKind,
        string actionLabel,
        bool actionEnabled,
        string navigationTarget,
        string role,
        string liveSetting,
        bool autoRetryEligible,
        string accessibleName)
    {
        IsVisible = isVisible;
        Kind = kind;
        IsOffline = isOffline;
        IconGlyph = iconGlyph;
        Title = title;
        Message = message;
        ActionKind = actionKind;
        ActionLabel = actionLabel;
        ActionEnabled = actionEnabled;
        NavigationTarget = navigationTarget;
        Role = role;
        LiveSetting = liveSetting;
        AutoRetryEligible = autoRetryEligible;
        AccessibleName = accessibleName;
    }

    /// <summary>The hidden projection — nothing is rendered (web <c>if (!error) return null</c>).</summary>
    public static QueryErrorProjection None { get; } = new(
        isVisible: false,
        kind: QueryErrorKind.Network,
        isOffline: false,
        iconGlyph: string.Empty,
        title: string.Empty,
        message: string.Empty,
        actionKind: QueryErrorActionKind.None,
        actionLabel: string.Empty,
        actionEnabled: false,
        navigationTarget: string.Empty,
        role: QueryErrorRegistration.RoleAlert,
        liveSetting: QueryErrorRegistration.LiveAssertive,
        autoRetryEligible: false,
        accessibleName: string.Empty);

    /// <summary>Whether the surface is shown (web <c>error</c> is truthy).</summary>
    public bool IsVisible { get; }

    /// <summary>The resolved failure branch (web waiting/status ladder).</summary>
    public QueryErrorKind Kind { get; }

    /// <summary>Whether the network branch is offline (web <c>isOffline</c>); false for the other branches.</summary>
    public bool IsOffline { get; }

    /// <summary>The Segoe Fluent glyph the card shows (web Lucide icon).</summary>
    public string IconGlyph { get; }

    /// <summary>The localized title (web <c>title</c>).</summary>
    public string Title { get; }

    /// <summary>The localized message (web <c>message</c>).</summary>
    public string Message { get; }

    /// <summary>The CTA kind (web <c>action</c>; <see cref="QueryErrorActionKind.None"/> when no button).</summary>
    public QueryErrorActionKind ActionKind { get; }

    /// <summary>The localized action label (empty when there is no action).</summary>
    public string ActionLabel { get; }

    /// <summary>Whether the action is enabled (web offline retry is <c>disabled</c>).</summary>
    public bool ActionEnabled { get; }

    /// <summary>The navigation target for <see cref="QueryErrorActionKind.BackToList"/> (web <c>listHref</c>); empty otherwise.</summary>
    public string NavigationTarget { get; }

    /// <summary>The ARIA role the card declares (web <c>role</c>).</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the card declares (web <c>aria-live</c>).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Whether the connection-restored auto-retry is armed — the native port of the web reconnect effect's guard
    /// (web/src/components/feedback/QueryError.tsx L53-66): a present non-API error (status undefined) with a retry
    /// handler while the device is offline. When this is set, the state holder fires the retry once the connection
    /// returns so the user does not have to click. The 4xx/5xx and transient-waiting branches never arm it because
    /// they carry a defined status.
    /// </summary>
    public bool AutoRetryEligible { get; }

    /// <summary>The accessible name a screen reader announces — the title and message together.</summary>
    public string AccessibleName { get; }

    /// <summary>Whether an action button is rendered (web <c>action</c> is defined).</summary>
    public bool HasAction => ActionKind != QueryErrorActionKind.None;

    /// <summary>
    /// Project a request + connectivity into a render-ready value, reproducing the web component
    /// (web/src/components/feedback/QueryError.tsx L68-199): a falsy error renders nothing; a transient wait wins
    /// outright; otherwise the status ladder selects the icon, copy, CTA, role and live urgency, with the network
    /// branch flipping between its offline and unreachable forms from <paramref name="isOnline"/>. The reconnect
    /// auto-retry is armed whenever a present non-API error (status null) carries a retry handler while offline.
    /// </summary>
    /// <param name="request">The error description (web props + resolved verdict + status).</param>
    /// <param name="isOnline">Whether the device currently reports a connection (web <c>online</c>).</param>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    public static QueryErrorProjection Project(QueryErrorRequest request, bool isOnline, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!request.HasError)
        {
            return None;
        }

        // web reconnect effect (L53-66): arm only for a present non-API error (status undefined) with onRetry
        // while offline — 4xx/5xx don't recover from a network event, so they never auto-retry.
        var autoRetry = request.Status is null && request.CanRetry && !isOnline;

        return QueryErrorRegistration.ClassifyKind(request.TransientWaiting, request.Status) switch
        {
            QueryErrorKind.Waiting => ProjectWaiting(localizer, autoRetry),
            QueryErrorKind.NotFound => ProjectNotFound(request, localizer, autoRetry),
            QueryErrorKind.Unauthorized => ProjectUnauthorized(localizer, autoRetry),
            QueryErrorKind.ServerError => ProjectServerError(request, localizer, autoRetry),
            _ => ProjectNetwork(request, isOnline, localizer, autoRetry),
        };
    }

    private static QueryErrorProjection ProjectWaiting(ILocalizer localizer, bool autoRetry) =>
        Build(
            kind: QueryErrorKind.Waiting,
            isOffline: false,
            title: localizer.GetString(QueryErrorRegistration.WaitingTitleKey, QueryErrorRegistration.WaitingTitleFallback),
            message: localizer.GetString(QueryErrorRegistration.WaitingMessageKey, QueryErrorRegistration.WaitingMessageFallback),
            actionKind: QueryErrorActionKind.None,
            actionLabel: string.Empty,
            actionEnabled: false,
            navigationTarget: string.Empty,
            role: QueryErrorRegistration.RoleStatus,
            liveSetting: QueryErrorRegistration.LivePolite,
            autoRetryEligible: autoRetry);

    private static QueryErrorProjection ProjectNotFound(QueryErrorRequest request, ILocalizer localizer, bool autoRetry)
    {
        var thing = string.IsNullOrEmpty(request.ResourceName)
            ? localizer.GetString(
                QueryErrorRegistration.NotFoundThingDefaultKey,
                QueryErrorRegistration.NotFoundThingDefaultFallback)
            : request.ResourceName!;

        var title = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(QueryErrorRegistration.NotFoundTitleKey, QueryErrorRegistration.NotFoundTitleFallback),
            thing);
        var message = localizer.GetString(
            QueryErrorRegistration.NotFoundMessageKey,
            QueryErrorRegistration.NotFoundMessageFallback);

        var hasList = !string.IsNullOrEmpty(request.ListHref);

        return Build(
            kind: QueryErrorKind.NotFound,
            isOffline: false,
            title: title,
            message: message,
            actionKind: hasList ? QueryErrorActionKind.BackToList : QueryErrorActionKind.None,
            actionLabel: hasList
                ? localizer.GetString(QueryErrorRegistration.NotFoundCtaKey, QueryErrorRegistration.NotFoundCtaFallback)
                : string.Empty,
            actionEnabled: hasList,
            navigationTarget: hasList ? request.ListHref! : string.Empty,
            role: QueryErrorRegistration.RoleAlert,
            liveSetting: QueryErrorRegistration.LiveAssertive,
            autoRetryEligible: autoRetry);
    }

    private static QueryErrorProjection ProjectUnauthorized(ILocalizer localizer, bool autoRetry) =>
        Build(
            kind: QueryErrorKind.Unauthorized,
            isOffline: false,
            title: localizer.GetString(
                QueryErrorRegistration.UnauthorizedTitleKey,
                QueryErrorRegistration.UnauthorizedTitleFallback),
            message: localizer.GetString(
                QueryErrorRegistration.UnauthorizedMessageKey,
                QueryErrorRegistration.UnauthorizedMessageFallback),
            actionKind: QueryErrorActionKind.SignIn,
            actionLabel: localizer.GetString(
                QueryErrorRegistration.UnauthorizedCtaKey,
                QueryErrorRegistration.UnauthorizedCtaFallback),
            actionEnabled: true,
            navigationTarget: QueryErrorRegistration.LoginRoute,
            role: QueryErrorRegistration.RoleAlert,
            liveSetting: QueryErrorRegistration.LiveAssertive,
            autoRetryEligible: autoRetry);

    private static QueryErrorProjection ProjectServerError(QueryErrorRequest request, ILocalizer localizer, bool autoRetry) =>
        Build(
            kind: QueryErrorKind.ServerError,
            isOffline: false,
            title: localizer.GetString(
                QueryErrorRegistration.ServerErrorTitleKey,
                QueryErrorRegistration.ServerErrorTitleFallback),
            message: localizer.GetString(
                QueryErrorRegistration.ServerErrorMessageKey,
                QueryErrorRegistration.ServerErrorMessageFallback),
            actionKind: request.CanRetry ? QueryErrorActionKind.Retry : QueryErrorActionKind.None,
            actionLabel: request.CanRetry
                ? localizer.GetString(QueryErrorRegistration.RetryKey, QueryErrorRegistration.RetryFallback)
                : string.Empty,
            actionEnabled: request.CanRetry,
            navigationTarget: string.Empty,
            role: QueryErrorRegistration.RoleAlert,
            liveSetting: QueryErrorRegistration.LiveAssertive,
            autoRetryEligible: autoRetry);

    private static QueryErrorProjection ProjectNetwork(QueryErrorRequest request, bool isOnline, ILocalizer localizer, bool autoRetry)
    {
        var offline = QueryErrorRegistration.IsOffline(request.Status, isOnline);

        var title = offline
            ? localizer.GetString(QueryErrorRegistration.NetworkOfflineTitleKey, QueryErrorRegistration.NetworkOfflineTitleFallback)
            : localizer.GetString(QueryErrorRegistration.NetworkTitleKey, QueryErrorRegistration.NetworkTitleFallback);
        var message = offline
            ? localizer.GetString(QueryErrorRegistration.NetworkOfflineDetailKey, QueryErrorRegistration.NetworkOfflineDetailFallback)
            : localizer.GetString(QueryErrorRegistration.NetworkMessageKey, QueryErrorRegistration.NetworkMessageFallback);

        var actionKind = QueryErrorActionKind.None;
        var actionLabel = string.Empty;
        if (request.CanRetry)
        {
            actionKind = offline ? QueryErrorActionKind.RetryWhenOnline : QueryErrorActionKind.Retry;
            actionLabel = offline
                ? localizer.GetString(QueryErrorRegistration.NetworkRetryWhenOnlineKey, QueryErrorRegistration.NetworkRetryWhenOnlineFallback)
                : localizer.GetString(QueryErrorRegistration.RetryKey, QueryErrorRegistration.RetryFallback);
        }

        return Build(
            kind: QueryErrorKind.Network,
            isOffline: offline,
            title: title,
            message: message,
            actionKind: actionKind,
            actionLabel: actionLabel,
            actionEnabled: request.CanRetry && !offline,
            navigationTarget: string.Empty,
            role: offline ? QueryErrorRegistration.RoleStatus : QueryErrorRegistration.RoleAlert,
            liveSetting: offline ? QueryErrorRegistration.LivePolite : QueryErrorRegistration.LiveAssertive,
            autoRetryEligible: autoRetry);
    }

    private static QueryErrorProjection Build(
        QueryErrorKind kind,
        bool isOffline,
        string title,
        string message,
        QueryErrorActionKind actionKind,
        string actionLabel,
        bool actionEnabled,
        string navigationTarget,
        string role,
        string liveSetting,
        bool autoRetryEligible) =>
        new(
            isVisible: true,
            kind: kind,
            isOffline: isOffline,
            iconGlyph: QueryErrorRegistration.GlyphFor(kind, isOffline),
            title: title,
            message: message,
            actionKind: actionKind,
            actionLabel: actionLabel,
            actionEnabled: actionEnabled,
            navigationTarget: navigationTarget,
            role: role,
            liveSetting: liveSetting,
            autoRetryEligible: autoRetryEligible,
            accessibleName: ComposeAccessibleName(title, message));

    private static string ComposeAccessibleName(string title, string message) =>
        string.IsNullOrEmpty(message) ? title : $"{title} {message}";
}

/// <summary>
/// PII-safe diagnostics for the QueryError surface (P1/S11 diagnostics contract). The card carries an opaque
/// failure category and localized copy only — never the underlying error, status detail, resource name or list
/// route — so the collector records ONLY the operational <c>view.opened</c> event with the surface slug.
/// Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class QueryErrorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public QueryErrorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QueryError</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QueryErrorRegistration.Slug}");
    }
}
