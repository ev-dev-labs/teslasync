using System.Globalization;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// Canonical metadata for the <c>NotFoundPage</c> feature surface — the native mirror of the web catch-all page
/// at <c>web/src/features/system/pages/NotFoundPage.tsx</c> (route <c>/*</c>, nav name <c>NotFound</c>). The web
/// page is rendered for any unmatched URL: it logs the unmatched path, projects the closest matching routes via
/// Levenshtein distance, and offers three escape hatches (back, dashboard, command palette) inside a single
/// <c>GlassPanel</c> inside a <c>PageContainer</c>. This holder pins the diagnostics slug, the seven i18n keys +
/// English fallbacks for every visible literal, the dashboard route name the "Go to dashboard" action opens, the
/// Segoe Fluent glyphs standing in for the web Lucide icons, and the suggestion cap. UI-free so the metadata is
/// asserted headlessly.
/// </summary>
public static class NotFoundRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>notfound.*</c> events (P1/S11).</summary>
    public const string Slug = "NotFoundPage";

    /// <summary>i18n key for the page title (web <c>t('notFound.title', 'Page not found')</c>).</summary>
    public const string TitleKey = "translation.notFound.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web default).</summary>
    public const string TitleFallback = "Page not found";

    /// <summary>i18n key for the heading (web <c>t('notFound.heading', "We couldn't find that page")</c>).</summary>
    public const string HeadingKey = "translation.notFound.heading";

    /// <summary>English fallback for <see cref="HeadingKey"/> (web default).</summary>
    public const string HeadingFallback = "We couldn't find that page";

    /// <summary>
    /// i18n key for the body (web <c>t('notFound.body', "{{path}} doesn't match any route.")</c>). The resolved
    /// value carries a single <c>{0}</c> format slot filled with the unmatched path at the display boundary.
    /// </summary>
    public const string BodyKey = "translation.notFound.body";

    /// <summary>English fallback for <see cref="BodyKey"/> (web default, carrying the native <c>{0}</c> format slot).</summary>
    public const string BodyFallback = "{0} doesn't match any route.";

    /// <summary>i18n key for the suggestions label (web <c>t('notFound.didYouMean', 'Did you mean:')</c>).</summary>
    public const string DidYouMeanKey = "translation.notFound.didYouMean";

    /// <summary>English fallback for <see cref="DidYouMeanKey"/> (web default).</summary>
    public const string DidYouMeanFallback = "Did you mean:";

    /// <summary>i18n key for the back affordance (web <c>t('notFound.goBack', 'Go back')</c>).</summary>
    public const string GoBackKey = "translation.notFound.goBack";

    /// <summary>English fallback for <see cref="GoBackKey"/> (web default).</summary>
    public const string GoBackFallback = "Go back";

    /// <summary>i18n key for the dashboard affordance (web <c>t('notFound.goHome', 'Go to dashboard')</c>).</summary>
    public const string GoHomeKey = "translation.notFound.goHome";

    /// <summary>English fallback for <see cref="GoHomeKey"/> (web default).</summary>
    public const string GoHomeFallback = "Go to dashboard";

    /// <summary>i18n key for the palette affordance (web <c>t('notFound.openSearch', 'Open command palette')</c>).</summary>
    public const string OpenSearchKey = "translation.notFound.openSearch";

    /// <summary>English fallback for <see cref="OpenSearchKey"/> (web default).</summary>
    public const string OpenSearchFallback = "Open command palette";

    /// <summary>The native shell route name the "Go to dashboard" action opens (web <c>navigate('/')</c>).</summary>
    public const string DashboardRouteName = "Dashboard";

    /// <summary>The dashboard display path the "Go to dashboard" action navigates to (web <c>'/'</c>).</summary>
    public const string DashboardPath = "/";

    /// <summary>Segoe Fluent glyph decorating the surface (web Lucide <c>Compass</c> — MapDirections).</summary>
    public const string CompassGlyph = "\uE81E";

    /// <summary>Segoe Fluent "Back" glyph on the go-back affordance (web Lucide <c>ArrowLeft</c>).</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary>Segoe Fluent "Home" glyph on the dashboard affordance (web Lucide <c>Home</c>).</summary>
    public const string HomeGlyph = "\uE80F";

    /// <summary>Segoe Fluent "Search" glyph on the palette affordance (web Lucide <c>Search</c>).</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>The maximum number of suggestions surfaced (web <c>closestRoutes(…, 5)</c>).</summary>
    public const int MaxSuggestions = 5;

    /// <summary>The inclusive edit-distance ceiling a candidate must beat to be surfaced (web <c>distance &lt;= 6</c>).</summary>
    public const int MaxDistance = 6;
}

/// <summary>
/// One scored route suggestion — the native port of the web <c>RouteSuggestion</c>
/// (web/src/lib/closestRoute.ts). Carries the display <see cref="Path"/> (web <c>r.path</c>, e.g. <c>/vehicles</c>),
/// the stable route <see cref="RouteName"/>, the localizable label (<see cref="LabelKey"/> + its English
/// <see cref="LabelFallback"/>, web <c>r.i18nKey</c> / <c>r.label</c>) and the computed <see cref="Distance"/>.
/// Pure data so the ranking is asserted without a UI host.
/// </summary>
/// <param name="Path">The display path the suggestion links to (web <c>r.path</c>).</param>
/// <param name="RouteName">The stable native route name (web <c>r.name</c>).</param>
/// <param name="LabelKey">The i18n key for the route label (web <c>r.i18nKey</c>).</param>
/// <param name="LabelFallback">The English label fallback (web <c>r.label</c>).</param>
/// <param name="Distance">The minimum edit distance to the query (web <c>r.distance</c>).</param>
public sealed record NotFoundSuggestion(
    string Path,
    string RouteName,
    string LabelKey,
    string LabelFallback,
    int Distance);

/// <summary>
/// Closest-route suggestion engine for the native 404 surface — a faithful port of
/// <c>web/src/lib/closestRoute.ts</c>. Given the unmatched path and the route table, it ranks navigable routes by
/// the minimum Levenshtein distance to BOTH the route path and the route label (lower-cased, separators stripped),
/// keeps only candidates within <see cref="NotFoundRegistration.MaxDistance"/>, and returns up to a caller-supplied
/// limit ordered by distance then path. Parameterized routes (the native analogue of the web registry's
/// <c>hidden</c> entries), redirects and the catch-all are excluded because they are not concrete navigable
/// destinations. UI-free and allocation-light so it is unit-tested without a live router.
/// </summary>
public static class RouteSuggestionEngine
{
    /// <summary>
    /// Rank the navigable routes nearest to <paramref name="query"/>. Mirrors the web
    /// <c>closestRoutes(query, ROUTE_REGISTRY, limit)</c>: an empty (separator-only) query yields no suggestions;
    /// otherwise candidates within the distance ceiling are returned ordered by ascending distance then ordinal
    /// path. Each route name contributes once (its first, canonical occurrence in declaration order).
    /// </summary>
    /// <param name="query">The unmatched path (web <c>location.pathname</c>).</param>
    /// <param name="routes">The route table to search (defaults to <see cref="RouteTable.All"/> at the call site).</param>
    /// <param name="limit">The maximum number of suggestions to return (web <c>limit</c>, default 5).</param>
    public static IReadOnlyList<NotFoundSuggestion> Closest(
        string query,
        IReadOnlyList<RouteDefinition> routes,
        int limit = NotFoundRegistration.MaxSuggestions)
    {
        ArgumentNullException.ThrowIfNull(routes);

        string q = Normalize(query);
        if (q.Length == 0)
        {
            return Array.Empty<NotFoundSuggestion>();
        }

        var scored = new List<NotFoundSuggestion>();
        var seenNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var route in routes)
        {
            // Web: hidden (parameterized) entries are skipped because they cannot be navigated to without a param;
            // the catch-all and unlabeled redirects are not concrete destinations either.
            if (route.IsCatchAll || route.IsParameterized || route.IsRedirect || string.IsNullOrEmpty(route.DefaultTitle))
            {
                continue;
            }

            // Keep one entry per route name (its canonical, first-declared path) so aliases never double-list.
            if (!seenNames.Add(route.Name))
            {
                continue;
            }

            string path = DisplayPath(route.PathPattern);
            int pathDistance = Levenshtein(q, Normalize(path));
            int labelDistance = Levenshtein(q, Normalize(route.DefaultTitle));
            int distance = Math.Min(pathDistance, labelDistance);
            if (distance <= NotFoundRegistration.MaxDistance)
            {
                scored.Add(new NotFoundSuggestion(path, route.Name, route.TitleKey ?? string.Empty, route.DefaultTitle, distance));
            }
        }

        scored.Sort(static (a, b) =>
            a.Distance != b.Distance ? a.Distance.CompareTo(b.Distance) : string.CompareOrdinal(a.Path, b.Path));

        if (limit < 0)
        {
            limit = 0;
        }

        return scored.Count <= limit ? scored : scored.GetRange(0, limit);
    }

    /// <summary>The display path for a pattern: a leading slash plus the trimmed pattern (web <c>r.path</c>; the empty index pattern becomes <c>/</c>).</summary>
    public static string DisplayPath(string? pathPattern) => "/" + (pathPattern ?? string.Empty).Trim('/');

    /// <summary>
    /// Normalize for comparison exactly as the web does: lower-case, then drop every space, hyphen, underscore and
    /// slash (web <c>s.toLowerCase().replace(/[\s\-_/]+/g, '')</c>).
    /// </summary>
    public static string Normalize(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var builder = new System.Text.StringBuilder(value.Length);
        foreach (char c in value)
        {
            if (char.IsWhiteSpace(c) || c is '-' or '_' or '/')
            {
                continue;
            }

            builder.Append(char.ToLowerInvariant(c));
        }

        return builder.ToString();
    }

    /// <summary>
    /// Iterative two-row Levenshtein edit distance — the textbook O(m·n) time / O(min(m,n)) space implementation
    /// ported verbatim from the web (web/src/lib/closestRoute.ts).
    /// </summary>
    public static int Levenshtein(string a, string b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);

        if (string.Equals(a, b, StringComparison.Ordinal))
        {
            return 0;
        }

        if (a.Length == 0)
        {
            return b.Length;
        }

        if (b.Length == 0)
        {
            return a.Length;
        }

        // Iterate the shorter string in the inner loop for cache locality (mirrors the web swap).
        if (a.Length > b.Length)
        {
            (a, b) = (b, a);
        }

        int m = a.Length;
        int n = b.Length;
        var prev = new int[m + 1];
        var curr = new int[m + 1];
        for (int i = 0; i <= m; i++)
        {
            prev[i] = i;
        }

        for (int j = 1; j <= n; j++)
        {
            curr[0] = j;
            for (int i = 1; i <= m; i++)
            {
                int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                curr[i] = Math.Min(Math.Min(curr[i - 1] + 1, prev[i] + 1), prev[i - 1] + cost);
            }

            (prev, curr) = (curr, prev);
        }

        return prev[m];
    }
}

/// <summary>
/// The render-ready, localized view of a single suggestion — the resolved <see cref="Label"/> (web
/// <c>t(s.i18nKey, s.label)</c>), the display + navigable <see cref="Path"/> shown beside it and opened on
/// activation, and the composed <see cref="AutomationName"/> the link announces.
/// </summary>
/// <param name="Path">The display + navigable path (web <c>s.path</c>).</param>
/// <param name="RouteName">The stable native route name (for diagnostics / selection).</param>
/// <param name="Label">The localized route label (web <c>t(s.i18nKey, s.label)</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the link (label + path).</param>
public sealed record NotFoundSuggestionDisplay(
    string Path,
    string RouteName,
    string Label,
    string AutomationName);

/// <summary>
/// The render-ready view of the not-found surface — everything the WinUI view needs to draw the page without ever
/// flashing a blank box. Holds the <see cref="PageTitle"/> forwarded to the scaffold (web <c>PageContainer
/// title</c>), the <see cref="Heading"/> and the path-filled <see cref="Body"/>, the <see cref="DidYouMeanLabel"/>
/// plus the ranked <see cref="Suggestions"/> (and a <see cref="HasSuggestions"/> flag mirroring the web
/// <c>suggestions.length &gt; 0</c> guard), the three action labels, the <see cref="UnmatchedPath"/> the body
/// reports, and the composed <see cref="AutomationName"/>. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="PageTitle">The localized page title (web <c>t('notFound.title')</c>).</param>
/// <param name="Heading">The localized heading (web <c>t('notFound.heading')</c>).</param>
/// <param name="Body">The localized body with the unmatched path substituted (web <c>t('notFound.body', {path})</c>).</param>
/// <param name="DidYouMeanLabel">The localized suggestions label (web <c>t('notFound.didYouMean')</c>).</param>
/// <param name="HasSuggestions">Whether any suggestion was found (web <c>suggestions.length &gt; 0</c>).</param>
/// <param name="Suggestions">The ranked, localized suggestions (web <c>closestRoutes(...)</c>).</param>
/// <param name="GoBackLabel">The localized back label (web <c>t('notFound.goBack')</c>).</param>
/// <param name="GoHomeLabel">The localized dashboard label (web <c>t('notFound.goHome')</c>).</param>
/// <param name="OpenSearchLabel">The localized palette label (web <c>t('notFound.openSearch')</c>).</param>
/// <param name="UnmatchedPath">The display form of the unmatched path (web <c>location.pathname</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the surface (heading + body).</param>
public sealed record NotFoundDisplay(
    string PageTitle,
    string Heading,
    string Body,
    string DidYouMeanLabel,
    bool HasSuggestions,
    IReadOnlyList<NotFoundSuggestionDisplay> Suggestions,
    string GoBackLabel,
    string GoHomeLabel,
    string OpenSearchLabel,
    string UnmatchedPath,
    string AutomationName);

/// <summary>
/// Pure projection from the unmatched path + route table to the render-ready <see cref="NotFoundDisplay"/> — the
/// native port of <c>web/src/features/system/pages/NotFoundPage.tsx</c>'s render body. It resolves every visible
/// literal through the i18n facade (filling the body's <c>{0}</c> with the display path exactly as the web fills
/// <c>{{path}}</c>), ranks the closest routes through <see cref="RouteSuggestionEngine"/> and localizes each
/// suggestion's label, and composes the surface's accessible name. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class NotFoundProjection
{
    /// <summary>
    /// Project the unmatched path and route table into the render-ready display, resolving all copy through the
    /// i18n facade. Mirrors the web component's render output.
    /// </summary>
    /// <param name="unmatchedPath">The unmatched path (web <c>location.pathname</c>); null is treated as empty.</param>
    /// <param name="routes">The route table searched for suggestions.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static NotFoundDisplay Project(
        string? unmatchedPath,
        IReadOnlyList<RouteDefinition> routes,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(routes);
        ArgumentNullException.ThrowIfNull(localizer);

        string normalizedPath = (unmatchedPath ?? string.Empty).Trim();
        string displayPath = RouteSuggestionEngine.DisplayPath(normalizedPath);

        string pageTitle = localizer.GetString(NotFoundRegistration.TitleKey, NotFoundRegistration.TitleFallback);
        string heading = localizer.GetString(NotFoundRegistration.HeadingKey, NotFoundRegistration.HeadingFallback);
        string bodyTemplate = localizer.GetString(NotFoundRegistration.BodyKey, NotFoundRegistration.BodyFallback);
        string body = FormatBody(bodyTemplate, displayPath);
        string didYouMean = localizer.GetString(NotFoundRegistration.DidYouMeanKey, NotFoundRegistration.DidYouMeanFallback);
        string goBack = localizer.GetString(NotFoundRegistration.GoBackKey, NotFoundRegistration.GoBackFallback);
        string goHome = localizer.GetString(NotFoundRegistration.GoHomeKey, NotFoundRegistration.GoHomeFallback);
        string openSearch = localizer.GetString(NotFoundRegistration.OpenSearchKey, NotFoundRegistration.OpenSearchFallback);

        var suggestions = new List<NotFoundSuggestionDisplay>();
        foreach (var suggestion in RouteSuggestionEngine.Closest(normalizedPath, routes))
        {
            string label = localizer.GetString(suggestion.LabelKey, suggestion.LabelFallback);
            string automation = string.Create(CultureInfo.CurrentCulture, $"{label} {suggestion.Path}");
            suggestions.Add(new NotFoundSuggestionDisplay(suggestion.Path, suggestion.RouteName, label, automation));
        }

        string automationName = string.Create(CultureInfo.CurrentCulture, $"{heading}. {body}");

        return new NotFoundDisplay(
            pageTitle,
            heading,
            body,
            didYouMean,
            suggestions.Count > 0,
            suggestions,
            goBack,
            goHome,
            openSearch,
            displayPath,
            automationName);
    }

    private static string FormatBody(string template, string path)
    {
        try
        {
            return string.Format(CultureInfo.CurrentCulture, template, path);
        }
        catch (FormatException)
        {
            // A malformed catalog value must never crash the 404 surface — fall back to the raw template.
            return template;
        }
    }
}

/// <summary>
/// The navigation port the <c>NotFoundPage</c> escape hatches drive — the native analogue of the web seams
/// (web/src/features/system/pages/NotFoundPage.tsx): <c>window.history.back()</c>, <c>navigate('/')</c>, the
/// <c>toggle-command-palette</c> window event, and the suggestion <c>&lt;Link to={s.path}&gt;</c>. The view never
/// touches the shell directly; a shell adapter resolves these to real navigation while a test double records them.
/// </summary>
public interface INotFoundNavigator
{
    /// <summary>Navigate back one entry (web <c>window.history.back()</c>).</summary>
    void GoBack();

    /// <summary>Navigate to the dashboard index (web <c>navigate('/')</c>).</summary>
    void GoToDashboard();

    /// <summary>Open the command palette / search (web <c>dispatchEvent('toggle-command-palette')</c>).</summary>
    void OpenCommandPalette();

    /// <summary>Navigate to a suggested route path (web <c>&lt;Link to={s.path}&gt;</c>).</summary>
    /// <param name="path">The suggestion's display path (e.g. <c>/vehicles</c>); the shell normalizes the leading slash.</param>
    void NavigateTo(string path);
}

/// <summary>
/// PII-safe diagnostics for the <c>NotFoundPage</c> surface (P1/S11 diagnostics contract). Records the operational
/// 404 event with the unmatched path (the native analogue of the web <c>console.warn('[404]', path)</c> that
/// surfaces 404 storms in dev — the path is the operational signal, never user data) and each data-free escape-hatch
/// activation by target. Thread-safe.
/// </summary>
public sealed class NotFoundDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsShown;
    private long _navigations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public NotFoundDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been shown for an unmatched route.</summary>
    public long ViewsShown => Interlocked.Read(ref _viewsShown);

    /// <summary>Number of escape-hatch / suggestion navigations dispatched.</summary>
    public long Navigations => Interlocked.Read(ref _navigations);

    /// <summary>Record that the 404 surface was shown, emitting <c>notfound.shown slug=NotFoundPage path=…</c>.</summary>
    /// <param name="unmatchedPath">The unmatched display path (web <c>console.warn('[404]', path)</c>).</param>
    public void RecordShown(string unmatchedPath)
    {
        Interlocked.Increment(ref _viewsShown);
        _sink?.Invoke($"notfound.shown slug={NotFoundRegistration.Slug} path={unmatchedPath}");
    }

    /// <summary>Record an escape-hatch / suggestion navigation, emitting <c>notfound.navigate slug=NotFoundPage target=…</c>.</summary>
    /// <param name="target">The navigation target (<c>back</c>, <c>dashboard</c>, <c>command-palette</c>, or a route path).</param>
    public void RecordNavigation(string target)
    {
        Interlocked.Increment(ref _navigations);
        _sink?.Invoke($"notfound.navigate slug={NotFoundRegistration.Slug} target={target}");
    }
}
