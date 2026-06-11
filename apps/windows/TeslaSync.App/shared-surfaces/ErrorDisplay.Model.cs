using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The four status-driven failure modes the <c>ErrorDisplay</c> surface branches into — the native analogue of
/// the web <c>ErrorDisplay</c> status ladder (web/src/components/feedback/ErrorDisplay.tsx L49-164): a 404
/// (<see cref="NotFound"/>), a 401/403 (<see cref="Unauthorized"/>), a 5xx (<see cref="ServerError"/>) and the
/// catch-all network / offline / unknown branch (<see cref="Network"/>). The offline-versus-unreachable split the
/// web makes inside its network branch is carried as a flag on the projection, not a separate kind.
/// </summary>
public enum ErrorDisplayKind
{
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
/// The call-to-action the <c>ErrorDisplay</c> renders for the resolved branch — the native analogue of the web
/// <c>ErrorState</c> <c>action</c> prop (web/src/components/feedback/ErrorDisplay.tsx). Exactly one applies per
/// projection; <see cref="None"/> is the web <c>action={undefined}</c> case (no button rendered).
/// </summary>
public enum ErrorDisplayActionKind
{
    /// <summary>No action button (web <c>action</c> is undefined).</summary>
    None,

    /// <summary>"Back to list" — navigates to the resource's list view (web 404 <c>navigate(listHref)</c>).</summary>
    BackToList,

    /// <summary>"Sign in" — sends the user to the login route (web 401/403 <c>window.location.href = '/login'</c>).</summary>
    SignIn,

    /// <summary>"Retry" — re-runs the failed operation (web <c>onRetry</c>).</summary>
    Retry,

    /// <summary>"Retry when online" — the disabled offline retry affordance (web offline <c>disabled</c> button).</summary>
    RetryWhenOnline,
}

/// <summary>
/// One immutable description of the error the <c>ErrorDisplay</c> is asked to render — the native analogue of the
/// web component's props (web/src/components/feedback/ErrorDisplay.tsx L9-24): the resolved API
/// <see cref="Status"/> (the web <c>isApiError(error) ? error.status : undefined</c>; null for a non-API error),
/// whether there is an error at all (<see cref="HasError"/> — the web <c>if (!error) return null</c> gate),
/// whether a retry handler was supplied (<see cref="CanRetry"/> — the web <c>onRetry</c> presence), the
/// <see cref="Compact"/> variant, and the optional <see cref="ResourceName"/> / <see cref="ListHref"/> the 404
/// branch reads. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The resolved API status code, or null for a non-API / unknown error (web <c>status</c>).</param>
/// <param name="HasError">Whether an error is present at all (web truthiness of <c>error</c>).</param>
/// <param name="CanRetry">Whether a retry handler was supplied (web <c>onRetry != null</c>).</param>
/// <param name="Compact">Tighter padding for inline mutation errors (web <c>compact</c>).</param>
/// <param name="ResourceName">Singular human-readable resource name used in 404 titles (web <c>resourceName</c>).</param>
/// <param name="ListHref">Route to the corresponding list view, enabling the 404 CTA (web <c>listHref</c>).</param>
public sealed record ErrorDisplayRequest(
    int? Status,
    bool HasError,
    bool CanRetry,
    bool Compact,
    string? ResourceName,
    string? ListHref)
{
    /// <summary>The "no error" request — nothing is rendered (web <c>error</c> is falsy).</summary>
    public static ErrorDisplayRequest None { get; } =
        new(Status: null, HasError: false, CanRetry: false, Compact: false, ResourceName: null, ListHref: null);

    /// <summary>
    /// Build a request for a present error (web <c>error</c> is truthy). <paramref name="status"/> is the resolved
    /// API status (null for a non-API error → the network branch).
    /// </summary>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="canRetry">Whether a retry handler was supplied (web <c>onRetry != null</c>).</param>
    /// <param name="compact">Tighter padding for inline mutation errors (web <c>compact</c>).</param>
    /// <param name="resourceName">Singular resource name used in 404 titles (web <c>resourceName</c>).</param>
    /// <param name="listHref">Route to the list view, enabling the 404 CTA (web <c>listHref</c>).</param>
    public static ErrorDisplayRequest ForStatus(
        int? status,
        bool canRetry = false,
        bool compact = false,
        string? resourceName = null,
        string? listHref = null) =>
        new(status, HasError: true, canRetry, compact, resourceName, listHref);
}

/// <summary>
/// Canonical metadata for the ErrorDisplay surface — the native analogue of the literals, status ladder and
/// per-branch icons in web/src/components/feedback/ErrorDisplay.tsx and its <c>_ErrorState</c> chrome
/// (web/src/components/feedback/_ErrorState.tsx). Carries the diagnostics slug, the card / action automation ids,
/// the ARIA role + live settings, the i18n keys (each with the English fallback the web renders — these are the
/// real <c>t()</c> keys the web uses, present verbatim in the generated WinUI catalogue), the Segoe Fluent glyphs
/// standing in for the web Lucide icons, the rose danger tint recipe the <c>_ErrorState</c> card is painted with,
/// the login route the "Sign in" CTA targets, and the pure status-&gt;kind / offline classification. UI-free so it
/// is asserted in tests.
/// </summary>
public static class ErrorDisplayRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ErrorDisplay";

    /// <summary>The automation id Narrator and UI-automation resolve the error card by.</summary>
    public const string CardAutomationId = "error-display";

    /// <summary>The automation id Narrator and UI-automation resolve the action button by.</summary>
    public const string ActionAutomationId = "error-display-action";

    /// <summary>ARIA role for a blocking failure — an assertive alert region (web <c>role="alert"</c>).</summary>
    public const string RoleAlert = "alert";

    /// <summary>ARIA role for the non-blocking offline state — a polite status region (web <c>role="status"</c>).</summary>
    public const string RoleStatus = "status";

    /// <summary>ARIA live urgency for an alert — interrupts the screen reader (web <c>aria-live="assertive"</c>).</summary>
    public const string LiveAssertive = "assertive";

    /// <summary>ARIA live urgency for a status — waits for a pause (web <c>aria-live="polite"</c>).</summary>
    public const string LivePolite = "polite";

    /// <summary>The route the "Sign in" CTA navigates to (web <c>window.location.href = '/login'</c>).</summary>
    public const string LoginRoute = "/login";

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
    /// Classify an API status into a failure branch — the native port of the web status ladder
    /// (web/src/components/feedback/ErrorDisplay.tsx L49-128): 404 → not-found, 401/403 → unauthorized, 5xx →
    /// server error, everything else (no status, status 0, other 4xx) → the network branch.
    /// </summary>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    public static ErrorDisplayKind ClassifyKind(int? status) => status switch
    {
        404 => ErrorDisplayKind.NotFound,
        401 or 403 => ErrorDisplayKind.Unauthorized,
        >= 500 => ErrorDisplayKind.ServerError,
        _ => ErrorDisplayKind.Network,
    };

    /// <summary>
    /// Whether the network branch is in its offline state — the native port of the web
    /// <c>const isOffline = !online || status === 0</c> (web/src/components/feedback/ErrorDisplay.tsx L128): the
    /// device reports offline, or the fetch never reached the network (status 0).
    /// </summary>
    /// <param name="status">The resolved API status code, or null for a non-API / unknown error.</param>
    /// <param name="isOnline">Whether the device currently reports a connection (web <c>online</c>).</param>
    public static bool IsOffline(int? status, bool isOnline) => !isOnline || status == 0;

    /// <summary>The Segoe Fluent glyph for a resolved branch (web Lucide icon table); <paramref name="offline"/> only affects the network branch.</summary>
    /// <param name="kind">The resolved failure branch.</param>
    /// <param name="offline">Whether the network branch is offline.</param>
    public static string GlyphFor(ErrorDisplayKind kind, bool offline) => kind switch
    {
        ErrorDisplayKind.NotFound => NotFoundGlyph,
        ErrorDisplayKind.Unauthorized => UnauthorizedGlyph,
        ErrorDisplayKind.ServerError => ServerErrorGlyph,
        _ => offline ? NetworkOfflineGlyph : NetworkErrorGlyph,
    };
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="ErrorDisplayRequest"/> + connectivity — everything the
/// web <c>ErrorDisplay</c> derives before returning its <c>_ErrorState</c> JSX
/// (web/src/components/feedback/ErrorDisplay.tsx L44-164): whether anything is shown (<see cref="IsVisible"/> —
/// the web <c>if (!error) return null</c> gate), the resolved <see cref="Kind"/> and its offline sub-state, the
/// Segoe Fluent <see cref="IconGlyph"/>, the localized <see cref="Title"/> / <see cref="Message"/>, the
/// <see cref="ActionKind"/> + localized <see cref="ActionLabel"/> + whether the action is
/// <see cref="ActionEnabled"/> (the web offline <c>disabled</c> retry) + its <see cref="NavigationTarget"/>, the
/// ARIA <see cref="Role"/> / <see cref="LiveSetting"/>, the <see cref="Compact"/> variant and the composed
/// <see cref="AccessibleName"/> a screen reader announces. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct ErrorDisplayProjection
{
    private ErrorDisplayProjection(
        bool isVisible,
        ErrorDisplayKind kind,
        bool isOffline,
        string iconGlyph,
        string title,
        string message,
        ErrorDisplayActionKind actionKind,
        string actionLabel,
        bool actionEnabled,
        string navigationTarget,
        string role,
        string liveSetting,
        bool compact,
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
        Compact = compact;
        AccessibleName = accessibleName;
    }

    /// <summary>The hidden projection — nothing is rendered (web <c>if (!error) return null</c>).</summary>
    public static ErrorDisplayProjection None { get; } = new(
        isVisible: false,
        kind: ErrorDisplayKind.Network,
        isOffline: false,
        iconGlyph: string.Empty,
        title: string.Empty,
        message: string.Empty,
        actionKind: ErrorDisplayActionKind.None,
        actionLabel: string.Empty,
        actionEnabled: false,
        navigationTarget: string.Empty,
        role: ErrorDisplayRegistration.RoleAlert,
        liveSetting: ErrorDisplayRegistration.LiveAssertive,
        compact: false,
        accessibleName: string.Empty);

    /// <summary>Whether the surface is shown (web <c>error</c> is truthy).</summary>
    public bool IsVisible { get; }

    /// <summary>The resolved failure branch (web status ladder).</summary>
    public ErrorDisplayKind Kind { get; }

    /// <summary>Whether the network branch is offline (web <c>isOffline</c>); false for the other branches.</summary>
    public bool IsOffline { get; }

    /// <summary>The Segoe Fluent glyph the card shows (web Lucide icon).</summary>
    public string IconGlyph { get; }

    /// <summary>The localized title (web <c>title</c>).</summary>
    public string Title { get; }

    /// <summary>The localized message (web <c>message</c>).</summary>
    public string Message { get; }

    /// <summary>The CTA kind (web <c>action</c>; <see cref="ErrorDisplayActionKind.None"/> when no button).</summary>
    public ErrorDisplayActionKind ActionKind { get; }

    /// <summary>The localized action label (empty when there is no action).</summary>
    public string ActionLabel { get; }

    /// <summary>Whether the action is enabled (web offline retry is <c>disabled</c>).</summary>
    public bool ActionEnabled { get; }

    /// <summary>The navigation target for <see cref="ErrorDisplayActionKind.BackToList"/> (web <c>listHref</c>); empty otherwise.</summary>
    public string NavigationTarget { get; }

    /// <summary>The ARIA role the card declares (web <c>role</c>).</summary>
    public string Role { get; }

    /// <summary>The ARIA live urgency the card declares (web <c>aria-live</c>).</summary>
    public string LiveSetting { get; }

    /// <summary>Whether the compact (inline) variant is used (web <c>compact</c>).</summary>
    public bool Compact { get; }

    /// <summary>The accessible name a screen reader announces — the title and message together.</summary>
    public string AccessibleName { get; }

    /// <summary>Whether an action button is rendered (web <c>action</c> is defined).</summary>
    public bool HasAction => ActionKind != ErrorDisplayActionKind.None;

    /// <summary>
    /// Project a request + connectivity into a render-ready value, reproducing the web component
    /// (web/src/components/feedback/ErrorDisplay.tsx L44-164): a falsy error renders nothing; otherwise the status
    /// ladder selects the icon, copy, CTA, role and live urgency, with the network branch flipping between its
    /// offline and unreachable forms from <paramref name="isOnline"/>.
    /// </summary>
    /// <param name="request">The error description (web props + resolved status).</param>
    /// <param name="isOnline">Whether the device currently reports a connection (web <c>online</c>).</param>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    public static ErrorDisplayProjection Project(ErrorDisplayRequest request, bool isOnline, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!request.HasError)
        {
            return None;
        }

        return ErrorDisplayRegistration.ClassifyKind(request.Status) switch
        {
            ErrorDisplayKind.NotFound => ProjectNotFound(request, localizer),
            ErrorDisplayKind.Unauthorized => ProjectUnauthorized(request, localizer),
            ErrorDisplayKind.ServerError => ProjectServerError(request, localizer),
            _ => ProjectNetwork(request, isOnline, localizer),
        };
    }

    private static ErrorDisplayProjection ProjectNotFound(ErrorDisplayRequest request, ILocalizer localizer)
    {
        var thing = string.IsNullOrEmpty(request.ResourceName)
            ? localizer.GetString(
                ErrorDisplayRegistration.NotFoundThingDefaultKey,
                ErrorDisplayRegistration.NotFoundThingDefaultFallback)
            : request.ResourceName!;

        var title = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(ErrorDisplayRegistration.NotFoundTitleKey, ErrorDisplayRegistration.NotFoundTitleFallback),
            thing);
        var message = localizer.GetString(
            ErrorDisplayRegistration.NotFoundMessageKey,
            ErrorDisplayRegistration.NotFoundMessageFallback);

        var hasList = !string.IsNullOrEmpty(request.ListHref);

        return Build(
            kind: ErrorDisplayKind.NotFound,
            isOffline: false,
            title: title,
            message: message,
            actionKind: hasList ? ErrorDisplayActionKind.BackToList : ErrorDisplayActionKind.None,
            actionLabel: hasList
                ? localizer.GetString(ErrorDisplayRegistration.NotFoundCtaKey, ErrorDisplayRegistration.NotFoundCtaFallback)
                : string.Empty,
            actionEnabled: hasList,
            navigationTarget: hasList ? request.ListHref! : string.Empty,
            role: ErrorDisplayRegistration.RoleAlert,
            liveSetting: ErrorDisplayRegistration.LiveAssertive,
            compact: request.Compact);
    }

    private static ErrorDisplayProjection ProjectUnauthorized(ErrorDisplayRequest request, ILocalizer localizer) =>
        Build(
            kind: ErrorDisplayKind.Unauthorized,
            isOffline: false,
            title: localizer.GetString(
                ErrorDisplayRegistration.UnauthorizedTitleKey,
                ErrorDisplayRegistration.UnauthorizedTitleFallback),
            message: localizer.GetString(
                ErrorDisplayRegistration.UnauthorizedMessageKey,
                ErrorDisplayRegistration.UnauthorizedMessageFallback),
            actionKind: ErrorDisplayActionKind.SignIn,
            actionLabel: localizer.GetString(
                ErrorDisplayRegistration.UnauthorizedCtaKey,
                ErrorDisplayRegistration.UnauthorizedCtaFallback),
            actionEnabled: true,
            navigationTarget: ErrorDisplayRegistration.LoginRoute,
            role: ErrorDisplayRegistration.RoleAlert,
            liveSetting: ErrorDisplayRegistration.LiveAssertive,
            compact: request.Compact);

    private static ErrorDisplayProjection ProjectServerError(ErrorDisplayRequest request, ILocalizer localizer) =>
        Build(
            kind: ErrorDisplayKind.ServerError,
            isOffline: false,
            title: localizer.GetString(
                ErrorDisplayRegistration.ServerErrorTitleKey,
                ErrorDisplayRegistration.ServerErrorTitleFallback),
            message: localizer.GetString(
                ErrorDisplayRegistration.ServerErrorMessageKey,
                ErrorDisplayRegistration.ServerErrorMessageFallback),
            actionKind: request.CanRetry ? ErrorDisplayActionKind.Retry : ErrorDisplayActionKind.None,
            actionLabel: request.CanRetry
                ? localizer.GetString(ErrorDisplayRegistration.RetryKey, ErrorDisplayRegistration.RetryFallback)
                : string.Empty,
            actionEnabled: request.CanRetry,
            navigationTarget: string.Empty,
            role: ErrorDisplayRegistration.RoleAlert,
            liveSetting: ErrorDisplayRegistration.LiveAssertive,
            compact: request.Compact);

    private static ErrorDisplayProjection ProjectNetwork(ErrorDisplayRequest request, bool isOnline, ILocalizer localizer)
    {
        var offline = ErrorDisplayRegistration.IsOffline(request.Status, isOnline);

        var title = offline
            ? localizer.GetString(ErrorDisplayRegistration.NetworkOfflineTitleKey, ErrorDisplayRegistration.NetworkOfflineTitleFallback)
            : localizer.GetString(ErrorDisplayRegistration.NetworkTitleKey, ErrorDisplayRegistration.NetworkTitleFallback);
        var message = offline
            ? localizer.GetString(ErrorDisplayRegistration.NetworkOfflineDetailKey, ErrorDisplayRegistration.NetworkOfflineDetailFallback)
            : localizer.GetString(ErrorDisplayRegistration.NetworkMessageKey, ErrorDisplayRegistration.NetworkMessageFallback);

        var actionKind = ErrorDisplayActionKind.None;
        var actionLabel = string.Empty;
        if (request.CanRetry)
        {
            actionKind = offline ? ErrorDisplayActionKind.RetryWhenOnline : ErrorDisplayActionKind.Retry;
            actionLabel = offline
                ? localizer.GetString(ErrorDisplayRegistration.NetworkRetryWhenOnlineKey, ErrorDisplayRegistration.NetworkRetryWhenOnlineFallback)
                : localizer.GetString(ErrorDisplayRegistration.RetryKey, ErrorDisplayRegistration.RetryFallback);
        }

        return Build(
            kind: ErrorDisplayKind.Network,
            isOffline: offline,
            title: title,
            message: message,
            actionKind: actionKind,
            actionLabel: actionLabel,
            actionEnabled: request.CanRetry && !offline,
            navigationTarget: string.Empty,
            role: offline ? ErrorDisplayRegistration.RoleStatus : ErrorDisplayRegistration.RoleAlert,
            liveSetting: offline ? ErrorDisplayRegistration.LivePolite : ErrorDisplayRegistration.LiveAssertive,
            compact: request.Compact);
    }

    private static ErrorDisplayProjection Build(
        ErrorDisplayKind kind,
        bool isOffline,
        string title,
        string message,
        ErrorDisplayActionKind actionKind,
        string actionLabel,
        bool actionEnabled,
        string navigationTarget,
        string role,
        string liveSetting,
        bool compact) =>
        new(
            isVisible: true,
            kind: kind,
            isOffline: isOffline,
            iconGlyph: ErrorDisplayRegistration.GlyphFor(kind, isOffline),
            title: title,
            message: message,
            actionKind: actionKind,
            actionLabel: actionLabel,
            actionEnabled: actionEnabled,
            navigationTarget: navigationTarget,
            role: role,
            liveSetting: liveSetting,
            compact: compact,
            accessibleName: ComposeAccessibleName(title, message));

    private static string ComposeAccessibleName(string title, string message) =>
        string.IsNullOrEmpty(message) ? title : $"{title} {message}";
}

/// <summary>
/// PII-safe diagnostics for the ErrorDisplay surface (P1/S11 diagnostics contract). The card carries an opaque
/// failure category and localized copy only — never the underlying error, status detail, resource name or list
/// route — so the collector records ONLY the operational <c>view.opened</c> event with the surface slug.
/// Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ErrorDisplayDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ErrorDisplayDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ErrorDisplay</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ErrorDisplayRegistration.Slug}");
    }
}
