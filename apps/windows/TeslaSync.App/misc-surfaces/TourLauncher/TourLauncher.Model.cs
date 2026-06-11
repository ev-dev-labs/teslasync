using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// Canonical metadata for the <c>TourLauncher</c> misc surface — the native mirror of the web component at
/// <c>web/src/features/onboarding/TourLauncher.tsx</c>. The web source is a controlled modal that lists every
/// tour in the static registry: each row shows the tour title + one-line description, marks completed tours
/// with a check, highlights the tour matching the current route as "recommended for this page", and offers a
/// Start / Replay action; a footer resets all tours and a Close dismisses the modal. This holder pins the
/// diagnostics slug, the decorative Segoe Fluent glyphs and every visible string's i18n key + English fallback
/// (the fallbacks mirror Strings/en/Resources.resw so the headless projection asserts the rendered copy).
/// UI-free so the metadata is asserted without a XAML host.
/// </summary>
public static class TourLauncherRegistration
{
    /// <summary>Diagnostics surface slug emitted with the operational events.</summary>
    public const string Slug = "TourLauncher";

    /// <summary>Segoe Fluent "CheckMark" glyph marking a completed tour (web Lucide <c>Check</c>).</summary>
    public const string CompletedGlyph = "\uE73E";

    /// <summary>Segoe Fluent "Play" glyph marking a not-yet-started tour (web Lucide <c>PlayCircle</c>).</summary>
    public const string AvailableGlyph = "\uE768";

    /// <summary>Segoe Fluent "FavoriteStar" glyph decorating the recommended chip (web Lucide <c>Sparkles</c>).</summary>
    public const string RecommendedGlyph = "\uE734";

    /// <summary>Segoe Fluent "Refresh" glyph decorating the reset-all action (web Lucide <c>RotateCcw</c>).</summary>
    public const string ResetGlyph = "\uE72C";

    /// <summary>i18n key for the modal title (web <c>tour.launcher.title</c>).</summary>
    public const string TitleKey = "tour.launcher.title";

    /// <summary>English fallback for <see cref="TitleKey"/>.</summary>
    public const string TitleFallback = "Take a tour";

    /// <summary>i18n key for the modal subtitle (web <c>tour.launcher.subtitle</c>).</summary>
    public const string SubtitleKey = "tour.launcher.subtitle";

    /// <summary>English fallback for <see cref="SubtitleKey"/>.</summary>
    public const string SubtitleFallback = "Guided walkthroughs for every major feature.";

    /// <summary>i18n key for the "recommended for this page" chip (web <c>tour.launcher.recommendedHere</c>).</summary>
    public const string RecommendedKey = "tour.launcher.recommendedHere";

    /// <summary>English fallback for <see cref="RecommendedKey"/>.</summary>
    public const string RecommendedFallback = "Recommended for this page";

    /// <summary>i18n key for the "completed" chip (web <c>tour.launcher.completed</c>).</summary>
    public const string CompletedKey = "tour.launcher.completed";

    /// <summary>English fallback for <see cref="CompletedKey"/>.</summary>
    public const string CompletedFallback = "Completed";

    /// <summary>i18n key for the Replay action label (web <c>tour.launcher.replay</c>).</summary>
    public const string ReplayKey = "tour.launcher.replay";

    /// <summary>English fallback for <see cref="ReplayKey"/>.</summary>
    public const string ReplayFallback = "Replay";

    /// <summary>i18n key for the Start action label (web <c>tour.launcher.start</c>).</summary>
    public const string StartKey = "tour.launcher.start";

    /// <summary>English fallback for <see cref="StartKey"/>.</summary>
    public const string StartFallback = "Start";

    /// <summary>i18n key for the Replay action Narrator name (web <c>tour.launcher.replayAria</c>, <c>{0}</c> = title).</summary>
    public const string ReplayAriaKey = "tour.launcher.replayAria";

    /// <summary>English fallback for <see cref="ReplayAriaKey"/> (<c>{0}</c> = tour title).</summary>
    public const string ReplayAriaFallback = "Replay {0} tour";

    /// <summary>i18n key for the Start action Narrator name (web <c>tour.launcher.startAria</c>, <c>{0}</c> = title).</summary>
    public const string StartAriaKey = "tour.launcher.startAria";

    /// <summary>English fallback for <see cref="StartAriaKey"/> (<c>{0}</c> = tour title).</summary>
    public const string StartAriaFallback = "Start {0} tour";

    /// <summary>i18n key for the reset-all action (web <c>tour.launcher.resetAll</c>).</summary>
    public const string ResetAllKey = "tour.launcher.resetAll";

    /// <summary>English fallback for <see cref="ResetAllKey"/>.</summary>
    public const string ResetAllFallback = "Reset all tours";

    /// <summary>i18n key for the close action (web <c>tour.launcher.close</c>).</summary>
    public const string CloseKey = "tour.launcher.close";

    /// <summary>English fallback for <see cref="CloseKey"/>.</summary>
    public const string CloseFallback = "Close";

    /// <summary>i18n key for the defensive empty surface (no tours in the registry).</summary>
    public const string EmptyKey = "common.noData";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No data available";
}

/// <summary>
/// A route-match hint for a tour — the native analogue of the web <c>TourDefinition.routeMatch</c>
/// (<c>string | RegExp</c>). The launcher uses it to highlight the tour as "recommended for this page". A string
/// matcher reproduces the web <c>isRecommendedForRoute</c> string branch (the special-cased root <c>"/"</c>
/// matches only the root, otherwise an exact or path-segment-prefix match); a pattern matcher reproduces the
/// RegExp branch (<c>routeMatch.test(pathname)</c>). UI-free so it is asserted headlessly.
/// </summary>
public sealed class TourRouteMatcher
{
    private readonly string? _route;
    private readonly Regex? _regex;

    private TourRouteMatcher(string? route, Regex? regex)
    {
        _route = route;
        _regex = regex;
    }

    /// <summary>A string route matcher (web <c>routeMatch: string</c>).</summary>
    /// <param name="route">The route to match (the special root <c>"/"</c> matches only the root path).</param>
    public static TourRouteMatcher ForRoute(string route)
    {
        ArgumentNullException.ThrowIfNull(route);
        return new TourRouteMatcher(route, null);
    }

    /// <summary>A regular-expression route matcher (web <c>routeMatch: RegExp</c>).</summary>
    /// <param name="pattern">The .NET-equivalent of the web RegExp source (e.g. <c>^/vehicles</c>).</param>
    public static TourRouteMatcher ForPattern(string pattern)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        return new TourRouteMatcher(null, new Regex(pattern, RegexOptions.CultureInvariant));
    }

    /// <summary>True when <paramref name="path"/> matches — the web <c>isRecommendedForRoute</c> for one tour.</summary>
    /// <param name="path">The current location path (web <c>location.pathname</c>).</param>
    public bool Matches(string? path)
    {
        string p = path ?? string.Empty;
        if (_regex is not null)
        {
            return _regex.IsMatch(p);
        }

        string route = _route!;
        if (route == "/")
        {
            return p == "/";
        }

        return string.Equals(p, route, StringComparison.Ordinal)
            || p.StartsWith(route + "/", StringComparison.Ordinal);
    }
}

/// <summary>
/// One tour's launcher-relevant definition — the native projection of a web <c>TourDefinition</c>
/// (web/src/lib/tourRegistry.ts) reduced to what the launcher reads. Holds the stable <see cref="Id"/> (storage
/// key / start dispatch / telemetry), the <see cref="RouteMatch"/> hint for "recommended for this page", the
/// title / description i18n keys + English fallbacks, and the completion <see cref="Version"/> (bumping it
/// re-offers the tour, mirroring the web versioned completion flag). Pure data, asserted headlessly.
/// </summary>
/// <param name="Id">The stable tour identifier (web <c>TourDefinition.id</c>).</param>
/// <param name="RouteMatch">The route-match hint for "recommended for this page".</param>
/// <param name="TitleKey">i18n key for the tour title.</param>
/// <param name="TitleFallback">English fallback for <paramref name="TitleKey"/>.</param>
/// <param name="DescriptionKey">i18n key for the one-line description.</param>
/// <param name="DescriptionFallback">English fallback for <paramref name="DescriptionKey"/>.</param>
/// <param name="Version">The completion version (web <c>TourDefinition.version</c>).</param>
public sealed record TourLauncherEntry(
    string Id,
    TourRouteMatcher RouteMatch,
    string TitleKey,
    string TitleFallback,
    string DescriptionKey,
    string DescriptionFallback,
    int Version);

/// <summary>The mutually-exclusive surface state. The web source has no asynchronous read, so there is no
/// loading / error / stale / offline branch (the same shape as the sibling <c>WidgetPicker</c> /
/// <c>KioskOverlay</c> / <c>LegacyAlertRulesRedirect</c> surfaces); the only states are the populated tour list
/// and the defensive empty surface (no tours in the registry — never a blank box).</summary>
public enum TourLauncherState
{
    /// <summary>At least one tour is listed (the web modal body).</summary>
    Ready,

    /// <summary>No tours in the registry — the friendly empty surface.</summary>
    Empty,
}

/// <summary>
/// One render-ready tour row — everything the WinUI view draws for a registry entry projected against the
/// current completion state and route. Holds the resolved <see cref="Title"/> / <see cref="Description"/>, the
/// <see cref="IsCompleted"/> / <see cref="IsRecommended"/> flags, the status <see cref="StatusGlyph"/>, the
/// localized action <see cref="ActionLabel"/> (Start / Replay) and its composed Narrator
/// <see cref="ActionAutomationName"/>, the optional recommended / completed chip captions, and the row's
/// composed Narrator <see cref="AutomationName"/>. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="Id">The tour id this row starts.</param>
/// <param name="Title">The localized tour title.</param>
/// <param name="Description">The localized one-line description.</param>
/// <param name="IsCompleted">Whether the tour is completed at its current version (web <c>isTourCompleted</c>).</param>
/// <param name="IsRecommended">Whether the tour matches the current route (web <c>isRecommendedForRoute</c>).</param>
/// <param name="StatusGlyph">The Segoe Fluent glyph for the row's status icon.</param>
/// <param name="ActionLabel">The localized action label (Replay when completed, else Start).</param>
/// <param name="ActionAutomationName">The composed Narrator name for the action button.</param>
/// <param name="RecommendedBadge">The recommended chip caption, or null when not recommended.</param>
/// <param name="CompletedBadge">The completed chip caption, or null when not completed.</param>
/// <param name="AutomationName">The composed Narrator name for the whole row.</param>
public sealed record TourRowView(
    string Id,
    string Title,
    string Description,
    bool IsCompleted,
    bool IsRecommended,
    string StatusGlyph,
    string ActionLabel,
    string ActionAutomationName,
    string? RecommendedBadge,
    string? CompletedBadge,
    string AutomationName);

/// <summary>
/// The render-ready view of the whole launcher — the localized modal title / subtitle, the projected tour
/// <see cref="Rows"/>, the reset-all / close action labels, the defensive empty message and the composed
/// Narrator <see cref="AutomationName"/>. <see cref="State"/> is <see cref="TourLauncherState.Empty"/> only when
/// the registry is empty. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state.</param>
/// <param name="Title">The localized modal title.</param>
/// <param name="Subtitle">The localized modal subtitle.</param>
/// <param name="Rows">The projected tour rows, in registry order.</param>
/// <param name="ResetAllLabel">The localized reset-all action label.</param>
/// <param name="CloseLabel">The localized close action label.</param>
/// <param name="EmptyMessage">The localized empty-surface message.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record TourLauncherDisplay(
    TourLauncherState State,
    string Title,
    string Subtitle,
    IReadOnlyList<TourRowView> Rows,
    string ResetAllLabel,
    string CloseLabel,
    string EmptyMessage,
    string AutomationName)
{
    /// <summary>True when at least one tour is listed (web <c>tours.length &gt; 0</c>).</summary>
    public bool HasTours => Rows.Count > 0;

    /// <summary>The number of completed tours among <see cref="Rows"/>.</summary>
    public int CompletedCount => Rows.Count(static r => r.IsCompleted);

    /// <summary>The number of tours recommended for the current route among <see cref="Rows"/>.</summary>
    public int RecommendedCount => Rows.Count(static r => r.IsRecommended);
}

/// <summary>
/// Pure projection from the tour catalogue + completion state + current route to the render-ready
/// <see cref="TourLauncherDisplay"/> — the native port of the web <c>TourLauncher</c> render
/// (web/src/features/onboarding/TourLauncher.tsx). It resolves every label through the i18n facade, marks each
/// completed tour, flags the route-recommended tour, and composes the Narrator names. No WinUI types — unit
/// tested without a UI host.
/// </summary>
public static class TourLauncherProjection
{
    /// <summary>True when the tour is recommended for <paramref name="path"/> (web <c>isRecommendedForRoute</c>).</summary>
    /// <param name="entry">The tour definition.</param>
    /// <param name="path">The current location path (web <c>location.pathname</c>).</param>
    public static bool IsRecommendedForRoute(TourLauncherEntry entry, string? path)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return entry.RouteMatch.Matches(path);
    }

    /// <summary>
    /// Project the catalogue into the render-ready display, resolving completion through
    /// <paramref name="completion"/>, the route-recommendation against <paramref name="path"/>, and every label
    /// through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="tours">The tour catalogue, in launcher order.</param>
    /// <param name="completion">The completion store (web <c>isTourCompleted</c> seam).</param>
    /// <param name="path">The current location path (web <c>useLocation().pathname</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TourLauncherDisplay Project(
        IReadOnlyList<TourLauncherEntry> tours,
        ITourCompletionStore completion,
        string? path,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(tours);
        ArgumentNullException.ThrowIfNull(completion);
        ArgumentNullException.ThrowIfNull(localizer);

        var rows = new List<TourRowView>(tours.Count);
        foreach (TourLauncherEntry entry in tours)
        {
            rows.Add(ProjectRow(entry, completion, path, localizer));
        }

        string title = localizer.GetString(TourLauncherRegistration.TitleKey, TourLauncherRegistration.TitleFallback);
        string subtitle = localizer.GetString(TourLauncherRegistration.SubtitleKey, TourLauncherRegistration.SubtitleFallback);
        string resetAll = localizer.GetString(TourLauncherRegistration.ResetAllKey, TourLauncherRegistration.ResetAllFallback);
        string close = localizer.GetString(TourLauncherRegistration.CloseKey, TourLauncherRegistration.CloseFallback);
        string empty = localizer.GetString(TourLauncherRegistration.EmptyKey, TourLauncherRegistration.EmptyFallback);

        TourLauncherState state = rows.Count == 0 ? TourLauncherState.Empty : TourLauncherState.Ready;
        string automationName = rows.Count == 0
            ? string.Create(CultureInfo.CurrentCulture, $"{title}. {empty}")
            : string.Create(CultureInfo.CurrentCulture, $"{title}. {subtitle}");

        return new TourLauncherDisplay(state, title, subtitle, rows, resetAll, close, empty, automationName);
    }

    private static TourRowView ProjectRow(
        TourLauncherEntry entry,
        ITourCompletionStore completion,
        string? path,
        ILocalizer localizer)
    {
        bool completed = completion.IsCompleted(entry.Id, entry.Version);
        bool recommended = entry.RouteMatch.Matches(path);

        string tourTitle = localizer.GetString(entry.TitleKey, entry.TitleFallback);
        string description = localizer.GetString(entry.DescriptionKey, entry.DescriptionFallback);

        string actionLabel = completed
            ? localizer.GetString(TourLauncherRegistration.ReplayKey, TourLauncherRegistration.ReplayFallback)
            : localizer.GetString(TourLauncherRegistration.StartKey, TourLauncherRegistration.StartFallback);

        string actionTemplate = completed
            ? localizer.GetString(TourLauncherRegistration.ReplayAriaKey, TourLauncherRegistration.ReplayAriaFallback)
            : localizer.GetString(TourLauncherRegistration.StartAriaKey, TourLauncherRegistration.StartAriaFallback);
        string actionAutomationName = string.Format(CultureInfo.CurrentCulture, actionTemplate, tourTitle);

        string? recommendedBadge = recommended
            ? localizer.GetString(TourLauncherRegistration.RecommendedKey, TourLauncherRegistration.RecommendedFallback)
            : null;
        string? completedBadge = completed
            ? localizer.GetString(TourLauncherRegistration.CompletedKey, TourLauncherRegistration.CompletedFallback)
            : null;

        string statusGlyph = completed
            ? TourLauncherRegistration.CompletedGlyph
            : TourLauncherRegistration.AvailableGlyph;

        string automationName = ComposeRowName(tourTitle, description, recommendedBadge, completedBadge);

        return new TourRowView(
            entry.Id,
            tourTitle,
            description,
            completed,
            recommended,
            statusGlyph,
            actionLabel,
            actionAutomationName,
            recommendedBadge,
            completedBadge,
            automationName);
    }

    private static string ComposeRowName(string title, string description, string? recommendedBadge, string? completedBadge)
    {
        var builder = new StringBuilder(title);
        if (recommendedBadge is not null)
        {
            builder.Append(". ").Append(recommendedBadge);
        }

        if (completedBadge is not null)
        {
            builder.Append(". ").Append(completedBadge);
        }

        builder.Append(". ").Append(description);
        return builder.ToString();
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TourLauncher</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never a tour id — so a diagnostics line can never leak which
/// tours a user browses, starts or resets. Thread-safe.
/// </summary>
public sealed class TourLauncherDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _toursStarted;
    private long _toursReset;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public TourLauncherDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the launcher has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of tours started through the launcher (count only, never which tour).</summary>
    public long ToursStarted => Interlocked.Read(ref _toursStarted);

    /// <summary>Number of times all tours were reset through the launcher.</summary>
    public long ToursReset => Interlocked.Read(ref _toursReset);

    /// <summary>Record that the launcher was opened, emitting <c>view.opened slug=TourLauncher</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TourLauncherRegistration.Slug}");
    }

    /// <summary>Record that a tour was started, emitting <c>tour.started slug=TourLauncher</c> (no id).</summary>
    public void RecordTourStarted()
    {
        Interlocked.Increment(ref _toursStarted);
        _sink?.Invoke($"tour.started slug={TourLauncherRegistration.Slug}");
    }

    /// <summary>Record that all tours were reset, emitting <c>tour.reset slug=TourLauncher</c>.</summary>
    public void RecordToursReset()
    {
        Interlocked.Increment(ref _toursReset);
        _sink?.Invoke($"tour.reset slug={TourLauncherRegistration.Slug}");
    }
}
