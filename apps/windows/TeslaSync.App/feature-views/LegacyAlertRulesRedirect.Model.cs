using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Canonical metadata for the <c>LegacyAlertRulesRedirect</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx</c>. The web source is a
/// four-line, query-preserving redirect (<c>const { search } = useLocation(); return &lt;Navigate
/// to={`/notifications/rules${search}`} replace /&gt;</c>): the legacy <c>/alert-rules</c> path forwards to the new
/// <c>/notifications/rules</c> route, carrying the verbatim query string so deep links / saved dashboards keep
/// their filter state. This holder pins the diagnostics slug, the legacy source path, the canonical native target
/// route path, the web-style target href prefix and the i18n keys for the visible "redirecting" copy. UI-free so
/// the metadata is asserted headlessly.
/// </summary>
public static class LegacyAlertRulesRedirectRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LegacyAlertRulesRedirect";

    /// <summary>The legacy route this surface is mounted on (web <c>&lt;Route path="alert-rules"&gt;</c>).</summary>
    public const string SourcePath = "alert-rules";

    /// <summary>The canonical native target route path (no leading slash — matches the route table's
    /// <c>NotificationsRules</c> entry and <c>RouteRegistry.Normalize</c>).</summary>
    public const string TargetRoutePath = "notifications/rules";

    /// <summary>The web-style absolute target prefix the redirect href is built from (web
    /// <c>`/notifications/rules${search}`</c>).</summary>
    public const string TargetHrefPrefix = "/notifications/rules";

    /// <summary>i18n key for the redirect-in-progress title.</summary>
    public const string TitleKey = "notifications.legacyRedirect.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Redirecting\u2026";

    /// <summary>i18n key for the destination-naming redirect message.</summary>
    public const string MessageKey = "notifications.alertRules.redirect.message";

    /// <summary>English fallback for <see cref="MessageKey"/> (names the new destination, web "Alert Rules").</summary>
    public const string MessageFallback = "Taking you to Alert Rules";

    /// <summary>Segoe Fluent "Forward" glyph decorating the redirect surface.</summary>
    public const string RedirectGlyph = "\uE72A";
}

/// <summary>
/// The resolved redirect intent — the native analogue of the web <c>to</c> + <c>replace</c> props of the
/// <c>&lt;Navigate&gt;</c> the legacy redirect renders
/// (web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx). Holds both the canonical native
/// <see cref="RoutePath"/> the shell navigator resolves (no leading slash) and the preserved
/// <see cref="Search"/> query string, plus the web-parity absolute <see cref="Href"/>
/// (<c>/notifications/rules${search}</c>) for display / deep-link parity assertions. <see cref="Replace"/> is
/// always true — the redirect replaces the legacy entry so Back never returns to <c>/alert-rules</c>. Pure data,
/// asserted headlessly.
/// </summary>
/// <param name="RoutePath">The native target route path with no leading slash (web target minus the leading "/").</param>
/// <param name="Search">The preserved query string, normalized to a single leading "?" or empty.</param>
/// <param name="Href">The web-parity absolute target (<c>/notifications/rules</c> + <see cref="Search"/>).</param>
/// <param name="Replace">Whether the navigation replaces the current history entry (always true — web <c>replace</c>).</param>
public sealed record RedirectTarget(string RoutePath, string Search, string Href, bool Replace)
{
    /// <summary>Whether a query string survived the redirect (web <c>search</c> non-empty).</summary>
    public bool HasSearch => Search.Length > 0;
}

/// <summary>
/// The render-ready view of the redirect surface — everything the WinUI view needs to draw a non-blank Fluent
/// "redirecting" indicator while the navigation is requested. Holds the resolved <see cref="Target"/>, the
/// localized <see cref="Title"/> (the in-progress label) and <see cref="Message"/> (names the destination), and
/// the composed <see cref="AutomationName"/> the surface announces to Narrator. Pure data so every field is
/// asserted without a UI host.
/// </summary>
/// <param name="Target">The resolved redirect intent.</param>
/// <param name="Title">The localized redirect-in-progress title.</param>
/// <param name="Message">The localized destination-naming message.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record LegacyAlertRulesRedirectDisplay(
    RedirectTarget Target,
    string Title,
    string Message,
    string AutomationName);

/// <summary>
/// Pure projection from the current location's query string to the redirect intent + its render-ready display —
/// the native port of web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx. The web component
/// concatenates <c>useLocation().search</c> (which already carries its leading "?" or is empty) onto
/// <c>/notifications/rules</c>; <see cref="Resolve"/> reproduces that, additionally normalizing the search so a
/// caller that passes a bare query (no leading "?") or a lone "?" still yields a well-formed target. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class LegacyAlertRulesRedirectProjection
{
    /// <summary>
    /// Resolve the current location <paramref name="search"/> into the redirect intent. Mirrors the web
    /// <c>`/notifications/rules${search}`</c> with <c>replace</c>.
    /// </summary>
    /// <param name="search">The current location's query string (react-router <c>location.search</c>).</param>
    public static RedirectTarget Resolve(string? search)
    {
        string normalized = NormalizeSearch(search);
        return new RedirectTarget(
            RoutePath: LegacyAlertRulesRedirectRegistration.TargetRoutePath,
            Search: normalized,
            Href: LegacyAlertRulesRedirectRegistration.TargetHrefPrefix + normalized,
            Replace: true);
    }

    /// <summary>
    /// Project the current location <paramref name="search"/> into the render-ready display, resolving the visible
    /// copy through the i18n facade.
    /// </summary>
    /// <param name="search">The current location's query string (react-router <c>location.search</c>).</param>
    /// <param name="localizer">The i18n facade the title / message resolve through.</param>
    public static LegacyAlertRulesRedirectDisplay ProjectDisplay(string? search, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        RedirectTarget target = Resolve(search);
        string title = localizer.GetString(
            LegacyAlertRulesRedirectRegistration.TitleKey, LegacyAlertRulesRedirectRegistration.TitleFallback);
        string message = localizer.GetString(
            LegacyAlertRulesRedirectRegistration.MessageKey, LegacyAlertRulesRedirectRegistration.MessageFallback);

        return new LegacyAlertRulesRedirectDisplay(
            Target: target,
            Title: title,
            Message: message,
            AutomationName: string.Create(CultureInfo.CurrentCulture, $"{title}. {message}"));
    }

    /// <summary>
    /// Normalize a raw query string to a single leading "?" form (or empty). A null / blank / lone-"?" search
    /// carries no query; otherwise exactly one leading "?" is guaranteed so the target href is always well-formed.
    /// </summary>
    /// <param name="search">The raw query string (with or without a leading "?").</param>
    public static string NormalizeSearch(string? search)
    {
        if (string.IsNullOrWhiteSpace(search))
        {
            return string.Empty;
        }

        string trimmed = search.Trim();
        if (trimmed.StartsWith('?'))
        {
            trimmed = trimmed[1..].Trim();
        }

        return trimmed.Length == 0 ? string.Empty : "?" + trimmed;
    }
}

/// <summary>
/// The current-location port the redirect surface binds to (P1/S8 state-holder seam) — the native analogue of the
/// web <c>useLocation()</c> hook the component reads <c>search</c> from. The view never touches the router
/// directly: a shell adapter (or a test fake) supplies the current query string through this seam.
/// </summary>
public interface ILegacyAlertRulesRedirectLocation
{
    /// <summary>The current location's query string (react-router <c>location.search</c>): a leading-"?" form or empty.</summary>
    string Search { get; }
}

/// <summary>
/// The navigation port the redirect surface drives (the native analogue of the rendered web <c>&lt;Navigate&gt;</c>
/// side effect). A shell adapter performs the actual replace-navigation to <see cref="RedirectTarget.RoutePath"/>
/// (carrying <see cref="RedirectTarget.Search"/>); a test fake records the requested target. Keeping navigation
/// behind this seam keeps the view free of any router dependency and lets the redirect logic be asserted
/// headlessly.
/// </summary>
public interface ILegacyAlertRulesRedirectNavigator
{
    /// <summary>Perform the redirect to <paramref name="target"/> (replace semantics when <see cref="RedirectTarget.Replace"/>).</summary>
    void Redirect(RedirectTarget target);
}

/// <summary>
/// PII-safe diagnostics for the <c>LegacyAlertRulesRedirect</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never the query string, which can carry fleet
/// identifiers (<c>vehicle_id</c>, <c>rule_id</c>, …) — so a diagnostics line can never leak deep-link data.
/// Thread-safe.
/// </summary>
public sealed class LegacyAlertRulesRedirectDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public LegacyAlertRulesRedirectDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LegacyAlertRulesRedirect</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LegacyAlertRulesRedirectRegistration.Slug}");
    }
}
