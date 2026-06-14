using System.Globalization;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Explore;

/// <summary>
/// The top-level data state the <c>ExplorePage</c> renders — the native union of the two web data states the page
/// surfaces (web/src/features/explore/pages/ExplorePage.tsx): the populated, categorised feature-card catalogue
/// (<see cref="Success"/>) and the "no features match" empty result (<see cref="Empty"/>). The catalogue is built
/// synchronously from the shared navigation registry, so — exactly like the web page — there is no separate loading
/// or error surface for the catalogue itself; the <c>useVehicles</c> / <c>useIsForwardAuth</c> reads only gate which
/// entries are visible (a failed read degrades to the unauthenticated / no-vehicle view, never an error banner).
/// </summary>
public enum ExploreState
{
    /// <summary>The filtered catalogue is non-empty — render the categorised section bands of feature cards.</summary>
    Success,

    /// <summary>The active filter matches nothing (web <c>grouped.length === 0</c>) — render the empty result.</summary>
    Empty,
}

/// <summary>
/// One decorated catalogue destination — the native analogue of a web <c>FeatureCatalogEntry</c>
/// (web/src/features/explore/featureCatalog.ts): a shared <see cref="LayoutNavItem"/> projected from the canonical
/// route table and enriched with a one-line <see cref="Description"/>. <see cref="AccentBrushKey"/> is the semantic
/// design token tinting the card icon (the web per-section Tailwind accent); <see cref="Glyph"/> is the Segoe Fluent
/// code point standing in for the web Lucide icon.
/// </summary>
/// <param name="Path">Route path without a leading slash (web <c>to</c>); the navigation + recent key.</param>
/// <param name="RouteName">Stable route name (web <c>SafeRoute name</c>).</param>
/// <param name="Label">Authored destination label (web <c>label</c>).</param>
/// <param name="Description">One-line catalogue blurb (web <c>description</c>).</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="SectionTitle">The owning section's localized header (web <c>section</c>).</param>
/// <param name="AccentBrushKey">Semantic accent token tinting the card icon (web Tailwind accent).</param>
public sealed record ExploreCatalogEntry(
    string Path,
    string RouteName,
    string Label,
    string Description,
    string Glyph,
    string SectionTitle,
    string AccentBrushKey);

/// <summary>
/// One categorised band of feature cards — the native analogue of a web <c>groupFeatureCatalog</c> group rendered by
/// <c>SectionBand</c> (web/src/features/explore/pages/ExplorePage.tsx). Carries the localized section header, the
/// slug the "jump to section" anchor brings into view, the accent token and the ordered entries.
/// </summary>
/// <param name="Title">Localized section header (web section title).</param>
/// <param name="Slug">Stable slug for anchor scroll-into-view (web <c>slugify(section)</c>).</param>
/// <param name="AccentBrushKey">Semantic accent token for the section.</param>
/// <param name="Entries">The section's ordered feature cards.</param>
public sealed record ExploreSection(
    string Title,
    string Slug,
    string AccentBrushKey,
    IReadOnlyList<ExploreCatalogEntry> Entries)
{
    /// <summary>The number of cards in the band (web section count chip).</summary>
    public int Count => Entries.Count;
}

/// <summary>
/// One "jump to section" anchor chip — the native analogue of the web <c>SectionAnchorStrip</c> entry
/// ("Driving · 12"). Carries the localized section title, the match count, the pre-interpolated count aria label and
/// the target section slug.
/// </summary>
/// <param name="SectionTitle">Localized section title shown on the chip.</param>
/// <param name="Slug">Target section slug the chip brings into view.</param>
/// <param name="Count">Match count shown on the chip.</param>
/// <param name="CountAria">Pre-interpolated accessible count label (web <c>explore.anchorCountAria</c>).</param>
public sealed record ExploreAnchor(string SectionTitle, string Slug, int Count, string CountAria);

/// <summary>
/// One resolved "recently visited" chip — the native analogue of a web <c>recentResolved</c> entry
/// (web/src/features/explore/pages/ExplorePage.tsx). It is a recent route path resolved against the visible
/// catalogue, so a recent destination the deployment now hides never surfaces.
/// </summary>
/// <param name="Path">Route path the chip navigates to (web <c>entry.to</c>).</param>
/// <param name="Label">Destination label (web <c>entry.label</c>).</param>
/// <param name="Glyph">Segoe Fluent glyph for the chip icon.</param>
/// <param name="AccentBrushKey">Semantic accent token tinting the chip icon.</param>
public sealed record ExploreRecentEntry(string Path, string Label, string Glyph, string AccentBrushKey);

/// <summary>
/// One "did you mean" suggestion — the native analogue of a web empty-state suggestion
/// (<c>closestRoutes</c> in web/src/features/explore/pages/ExplorePage.tsx). Carries the destination label and the
/// route path shown beside it.
/// </summary>
/// <param name="Path">Route path the suggestion navigates to.</param>
/// <param name="Label">Destination label.</param>
public sealed record ExploreSuggestion(string Path, string Label);

/// <summary>
/// The pure input the <see cref="ExploreProjection"/> renders — the native analogue of the web page's reactive state
/// (web/src/features/explore/pages/ExplorePage.tsx): the linked-vehicle count and forward-auth flag that gate the
/// catalogue (web <c>useVehicles</c> + <c>useIsForwardAuth</c>), the active URL-driven <see cref="Query"/>
/// (web <c>?q=</c>) and the recently-visited route paths (web <c>getRecentPages</c>). UI-free and immutable.
/// </summary>
/// <param name="VehicleCount">Linked-vehicle count gating <c>minVehicles</c> entries (web <c>vehicles.length</c>).</param>
/// <param name="IsForwardAuth">Whether the deployment runs behind ForwardAuth (web <c>useIsForwardAuth</c>).</param>
/// <param name="Query">The active filter (web <c>?q=</c>).</param>
/// <param name="RecentPaths">Recently-visited route paths, newest-first (web <c>getRecentPages</c>).</param>
public sealed record ExploreModel(
    int VehicleCount,
    bool IsForwardAuth,
    string Query,
    IReadOnlyList<string> RecentPaths);

/// <summary>
/// The render-ready projection of the <c>ExplorePage</c> — the single immutable value the WinUI view binds to, so the
/// view is a thin renderer and every branch / label / count is decided here. Mirrors every region of the web page
/// (web/src/features/explore/pages/ExplorePage.tsx): the header (title + subtitle), the recently-visited strip, the
/// sticky search panel (GlassPanel1: the filter field + the section anchor strip), the categorised section bands and
/// the empty result panel (GlassPanel2: the "did you mean" suggestions + clear affordance).
/// </summary>
public sealed record ExploreDisplay(
    ExploreState State,
    string WindowTitle,
    string Title,
    string Subtitle,
    string Query,
    string SearchLabel,
    string SearchHint,
    bool ShowRecent,
    string RecentHeading,
    IReadOnlyList<ExploreRecentEntry> RecentEntries,
    string SectionsAriaLabel,
    IReadOnlyList<ExploreAnchor> Anchors,
    bool ShowSections,
    IReadOnlyList<ExploreSection> Sections,
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyBody,
    string EmptyDidYouMean,
    string EmptyClear,
    bool ShowSuggestions,
    IReadOnlyList<ExploreSuggestion> Suggestions,
    int TotalFeatures,
    int MatchCount,
    string AutomationName);

/// <summary>
/// The UI-free projector turning an <see cref="ExploreModel"/> into an <see cref="ExploreDisplay"/> — the native port
/// of the web page's render body (web/src/features/explore/pages/ExplorePage.tsx). It builds the gated catalogue from
/// the shared navigation registry, filters it by the active query, groups it into section bands + anchor chips,
/// resolves the recently-visited strip against the visible catalogue and — when the filter matches nothing — computes
/// the "did you mean" suggestions. Every visible literal is resolved once, up-front, through the injected
/// <see cref="ILocalizer"/> so the keys are asserted and localized for real.
/// </summary>
public static class ExploreProjection
{
    /// <summary>Maximum recently-visited chips (web <c>RECENT_LIMIT</c>).</summary>
    public const int RecentLimit = 6;

    /// <summary>Maximum "did you mean" suggestions (web <c>closestRoutes(query, …, 5)</c>).</summary>
    public const int MaxSuggestions = 5;

    /// <summary>Project <paramref name="model"/> into the render-ready display.</summary>
    /// <param name="model">The pure input state.</param>
    /// <param name="localizer">The i18n facade every visible label resolves through.</param>
    public static ExploreDisplay Project(ExploreModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Strings — resolved once, unconditionally, so every required key flows through the seam each pass. ──
        string windowTitle = localizer.GetString("explore.pageTitle", "Explore features");
        string title = localizer.GetString("explore.title", "Explore features");
        string searchLabel = localizer.GetString("explore.searchLabel", "Filter features");
        string searchHint = localizer.GetString(
            "explore.searchPlaceholder", // parity:allow i18n key ported verbatim from the web explore.searchPlaceholder key
            "Filter features by name, section, or description (press / to focus)");
        string recentHeading = localizer.GetString("explore.recent.heading", "Recently visited");
        string sectionsAria = localizer.GetString("explore.sectionsAriaLabel", "Jump to section");
        string anchorCountTemplate = localizer.GetString("explore.anchorCountAria", "{{count}} features");
        string didYouMean = localizer.GetString("explore.empty.didYouMean", "Did you mean");
        string clearLabel = localizer.GetString("explore.empty.clear", "Clear filter");
        string emptyBody = localizer.GetString(
            "explore.empty.body",
            "Try a different word, or open the command palette (Ctrl+K) to search across pages, settings, and actions.");

        string query = model.Query?.Trim() ?? string.Empty;
        bool hasQuery = query.Length > 0;

        // ── Catalogue (web buildFeatureCatalog → gate → filter → group). ──
        var visible = ExploreCatalog.BuildVisible(model.VehicleCount, model.IsForwardAuth, localizer);
        var filtered = ExploreCatalog.Filter(visible, query);
        var sections = ExploreCatalog.Group(filtered);

        int totalFeatures = visible.Count;
        int matchCount = filtered.Count;

        // web: subtitle.filtered when a query is active, else subtitle.all. Both resolved each pass for key coverage.
        string subtitleAll = Interpolate(
            localizer.GetString("explore.subtitle.all", "Every feature in TeslaSync \u2014 {{total}} in total."),
            ("total", totalFeatures.ToString(CultureInfo.CurrentCulture)));
        string subtitleFiltered = Interpolate(
            localizer.GetString(
                "explore.subtitle.filtered",
                "{{matches}} of {{total}} features match \"{{query}}\""),
            ("matches", matchCount.ToString(CultureInfo.CurrentCulture)),
            ("total", totalFeatures.ToString(CultureInfo.CurrentCulture)),
            ("query", query));
        string subtitle = hasQuery ? subtitleFiltered : subtitleAll;

        // web empty.title resolved each pass (interpolated with the query) for key coverage.
        string emptyTitle = Interpolate(
            localizer.GetString("explore.empty.title", "No features match \"{{query}}\""),
            ("query", query));

        // ── Anchor chips (web SectionAnchorStrip). ──
        var anchors = new List<ExploreAnchor>(sections.Count);
        foreach (var section in sections)
        {
            string countAria = Interpolate(
                anchorCountTemplate,
                ("count", section.Count.ToString(CultureInfo.CurrentCulture)));
            anchors.Add(new ExploreAnchor(section.Title, section.Slug, section.Count, countAria));
        }

        // ── Recently visited (web recentResolved) — only when not filtering, resolved against the visible catalogue. ──
        var recent = hasQuery
            ? Array.Empty<ExploreRecentEntry>()
            : ExploreCatalog.ResolveRecent(model.RecentPaths, visible, RecentLimit);

        // ── Empty result (web EmptyResult): suggestions only when the filter matches nothing. ──
        bool isEmpty = sections.Count == 0;
        var suggestions = isEmpty
            ? ExploreCatalog.ClosestEntries(query, visible, MaxSuggestions)
            : Array.Empty<ExploreSuggestion>();

        return new ExploreDisplay(
            State: isEmpty ? ExploreState.Empty : ExploreState.Success,
            WindowTitle: windowTitle,
            Title: title,
            Subtitle: subtitle,
            Query: query,
            SearchLabel: searchLabel,
            SearchHint: searchHint,
            ShowRecent: recent.Count > 0,
            RecentHeading: recentHeading,
            RecentEntries: recent,
            SectionsAriaLabel: sectionsAria,
            Anchors: anchors,
            ShowSections: !isEmpty,
            Sections: sections,
            ShowEmpty: isEmpty,
            EmptyTitle: emptyTitle,
            EmptyBody: emptyBody,
            EmptyDidYouMean: didYouMean,
            EmptyClear: clearLabel,
            ShowSuggestions: suggestions.Count > 0,
            Suggestions: suggestions,
            TotalFeatures: totalFeatures,
            MatchCount: matchCount,
            AutomationName: title);
    }

    /// <summary>Replace each <c>{{name}}</c> token in <paramref name="template"/> with its value (web i18next interpolation).</summary>
    internal static string Interpolate(string template, params (string Key, string Value)[] values)
    {
        string result = template;
        foreach (var (key, value) in values)
        {
            result = result.Replace("{{" + key + "}}", value, StringComparison.Ordinal);
        }

        return result;
    }
}

/// <summary>
/// The UI-free catalogue engine behind the <c>ExplorePage</c> — the native port of
/// web/src/features/explore/featureCatalog.ts. It reuses the shared <see cref="LayoutNavCatalog"/> (itself projected
/// from the canonical <see cref="RouteTable"/>) verbatim, decorates each destination with a one-line description,
/// honours the per-item visibility gates and reproduces the page's filter / group / recent / suggestion helpers. Pure
/// and deterministic so it is unit-tested without a UI host.
/// </summary>
public static class ExploreCatalog
{
    /// <summary>
    /// Build the gated, decorated catalogue (web <c>buildFeatureCatalog</c> + the page's visibility filter). Iterates
    /// the shared sidebar sections, keeps the entries the deployment would surface
    /// (<see cref="LayoutNavCatalog.IsVisible"/>) and enriches each with its one-line blurb.
    /// </summary>
    /// <param name="vehicleCount">Linked-vehicle count (web <c>vehicleCount</c>).</param>
    /// <param name="isForwardAuth">Whether the deployment runs behind ForwardAuth (web <c>isForwardAuth</c>).</param>
    /// <param name="localizer">The i18n facade section headers resolve through.</param>
    public static IReadOnlyList<ExploreCatalogEntry> BuildVisible(
        int vehicleCount,
        bool isForwardAuth,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var entries = new List<ExploreCatalogEntry>();
        foreach (var section in LayoutNavCatalog.Sections)
        {
            string sectionTitle = localizer.GetString(section.TitleKey, section.TitleFallback);
            foreach (var item in section.Items)
            {
                if (!LayoutNavCatalog.IsVisible(item, vehicleCount, isForwardAuth))
                {
                    continue;
                }

                entries.Add(new ExploreCatalogEntry(
                    Path: item.Path,
                    RouteName: item.RouteName,
                    Label: item.TitleFallback,
                    Description: DescriptionFor(item.Path, item.TitleFallback),
                    Glyph: item.Glyph,
                    SectionTitle: sectionTitle,
                    AccentBrushKey: section.AccentBrushKey));
            }
        }

        return entries;
    }

    /// <summary>
    /// Filter the catalogue by a case-insensitive AND-token match across label, section, description and path
    /// (web <c>filterFeatureCatalog</c>). An empty query returns the catalogue unchanged.
    /// </summary>
    /// <param name="entries">The catalogue to filter.</param>
    /// <param name="query">The raw filter text.</param>
    public static IReadOnlyList<ExploreCatalogEntry> Filter(IReadOnlyList<ExploreCatalogEntry> entries, string query)
    {
        ArgumentNullException.ThrowIfNull(entries);
        string q = (query ?? string.Empty).Trim().ToLowerInvariant();
        if (q.Length == 0)
        {
            return entries;
        }

        string[] tokens = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var result = new List<ExploreCatalogEntry>(entries.Count);
        foreach (var entry in entries)
        {
            string haystack =
                $"{entry.Label} {entry.SectionTitle} {entry.Description} {entry.Path}".ToLowerInvariant();
            bool matchesAll = true;
            foreach (var token in tokens)
            {
                if (!haystack.Contains(token, StringComparison.Ordinal))
                {
                    matchesAll = false;
                    break;
                }
            }

            if (matchesAll)
            {
                result.Add(entry);
            }
        }

        return result;
    }

    /// <summary>
    /// Group a flat catalogue into section bands, preserving the shared sidebar order (web <c>groupFeatureCatalog</c>).
    /// </summary>
    /// <param name="entries">The (already filtered) catalogue.</param>
    public static IReadOnlyList<ExploreSection> Group(IReadOnlyList<ExploreCatalogEntry> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);

        var buckets = new Dictionary<string, List<ExploreCatalogEntry>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var entry in entries)
        {
            if (!buckets.TryGetValue(entry.SectionTitle, out var bucket))
            {
                bucket = new List<ExploreCatalogEntry>();
                buckets[entry.SectionTitle] = bucket;
                order.Add(entry.SectionTitle);
            }

            bucket.Add(entry);
        }

        var sections = new List<ExploreSection>(order.Count);
        foreach (var sectionTitle in order)
        {
            var bucket = buckets[sectionTitle];
            sections.Add(new ExploreSection(
                Title: sectionTitle,
                Slug: Slugify(sectionTitle),
                AccentBrushKey: bucket[0].AccentBrushKey,
                Entries: bucket));
        }

        return sections;
    }

    /// <summary>
    /// Resolve the recently-visited route paths against the visible catalogue (web <c>recentResolved</c>): each path
    /// is mapped to its catalogue entry (so a now-hidden destination drops out), de-duplicated and capped.
    /// </summary>
    /// <param name="recentPaths">Recently-visited route paths, newest-first.</param>
    /// <param name="visible">The visible catalogue.</param>
    /// <param name="limit">Maximum chips to return.</param>
    public static IReadOnlyList<ExploreRecentEntry> ResolveRecent(
        IReadOnlyList<string> recentPaths,
        IReadOnlyList<ExploreCatalogEntry> visible,
        int limit)
    {
        ArgumentNullException.ThrowIfNull(visible);
        if (recentPaths is null || recentPaths.Count == 0 || limit <= 0)
        {
            return Array.Empty<ExploreRecentEntry>();
        }

        var byPath = new Dictionary<string, ExploreCatalogEntry>(StringComparer.Ordinal);
        foreach (var entry in visible)
        {
            byPath[entry.Path] = entry;
        }

        var result = new List<ExploreRecentEntry>(Math.Min(limit, recentPaths.Count));
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in recentPaths)
        {
            string path = LayoutNavCatalog.Normalize(raw ?? string.Empty);
            if (!seen.Add(path) || !byPath.TryGetValue(path, out var entry))
            {
                continue;
            }

            result.Add(new ExploreRecentEntry(entry.Path, entry.Label, entry.Glyph, entry.AccentBrushKey));
            if (result.Count >= limit)
            {
                break;
            }
        }

        return result;
    }

    /// <summary>
    /// Compute the closest visible destinations to <paramref name="query"/> (web <c>closestRoutes</c>): rank every
    /// visible entry by the minimum Levenshtein distance of the query to its label and path, de-duplicate by path and
    /// take the nearest <paramref name="max"/>. Used by the empty result's "did you mean" suggestions.
    /// </summary>
    /// <param name="query">The unmatched filter text.</param>
    /// <param name="visible">The visible catalogue.</param>
    /// <param name="max">Maximum suggestions to return.</param>
    public static IReadOnlyList<ExploreSuggestion> ClosestEntries(
        string query,
        IReadOnlyList<ExploreCatalogEntry> visible,
        int max)
    {
        ArgumentNullException.ThrowIfNull(visible);
        string q = (query ?? string.Empty).Trim().ToLowerInvariant();
        if (q.Length == 0 || visible.Count == 0 || max <= 0)
        {
            return Array.Empty<ExploreSuggestion>();
        }

        var ranked = new List<(ExploreCatalogEntry Entry, int Distance)>(visible.Count);
        foreach (var entry in visible)
        {
            int labelDistance = Levenshtein(q, entry.Label.Replace(" ", string.Empty, StringComparison.Ordinal).ToLowerInvariant());
            int pathDistance = Levenshtein(q, entry.Path.ToLowerInvariant());
            ranked.Add((entry, Math.Min(labelDistance, pathDistance)));
        }

        ranked.Sort((a, b) => a.Distance.CompareTo(b.Distance));

        var result = new List<ExploreSuggestion>(max);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (entry, _) in ranked)
        {
            if (!seen.Add(entry.Path))
            {
                continue;
            }

            result.Add(new ExploreSuggestion(entry.Path, entry.Label));
            if (result.Count >= max)
            {
                break;
            }
        }

        return result;
    }

    /// <summary>Slugify a section title for an anchor target (web <c>slugify</c>).</summary>
    /// <param name="value">The section title.</param>
    public static string Slugify(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var builder = new System.Text.StringBuilder(value.Length);
        bool lastDash = false;
        foreach (char c in value.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c))
            {
                builder.Append(c);
                lastDash = false;
            }
            else if (!lastDash)
            {
                builder.Append('-');
                lastDash = true;
            }
        }

        return builder.ToString().Trim('-');
    }

    private static string DescriptionFor(string path, string label)
    {
        string key = "/" + LayoutNavCatalog.Normalize(path ?? string.Empty);
        return ExploreDescriptions.ByPath.TryGetValue(key, out var description)
            ? description
            : string.Create(CultureInfo.CurrentCulture, $"Open {label}.");
    }

    private static int Levenshtein(string a, string b)
    {
        if (a.Length == 0)
        {
            return b.Length;
        }

        if (b.Length == 0)
        {
            return a.Length;
        }

        var previous = new int[b.Length + 1];
        var current = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++)
        {
            previous[j] = j;
        }

        for (int i = 1; i <= a.Length; i++)
        {
            current[0] = i;
            for (int j = 1; j <= b.Length; j++)
            {
                int cost = a[i - 1] == b[j - 1] ? 0 : 1;
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }

            (previous, current) = (current, previous);
        }

        return previous[b.Length];
    }
}

/// <summary>
/// Diagnostics surface registration + i18n + operation ids for the <c>ExplorePage</c> (route <c>explore</c>, web nav
/// name <c>Explore</c>). Mirrors the sibling feature-view registrations: stable route name + slug, the generated
/// operation ids for the two gating reads (web <c>useVehicles</c> + <c>useIsForwardAuth</c>) and the localized
/// page-title helper.
/// </summary>
public static class ExploreRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ExplorePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Explore</c>).</summary>
    public const string RouteName = "Explore";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c> gating read).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/system/auth-mode</c> (web <c>useIsForwardAuth</c> read).</summary>
    public const string AuthModeOperation = "get_api_v1_system_auth_mode";

    /// <summary>The localized window/document title (web <c>usePageTitle(t('explore.pageTitle'))</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string WindowTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("explore.pageTitle", "Explore features");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ExplorePage</c> surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a route, query or recent path — so a diagnostics line can
/// never leak navigation history. Thread-safe.
/// </summary>
public sealed class ExploreDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics line sink, or null.</param>
    public ExploreDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ExplorePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ExploreRegistration.Slug}"));
    }
}

/// <summary>
/// The one-line catalogue blurbs keyed by route path — the native port of the web <c>DESCRIPTIONS</c> map
/// (web/src/features/explore/featureCatalog.ts). Keys carry the leading slash exactly as the web map does (the
/// canonical-route lookup normalises a destination path to <c>"/" + path</c>); a destination without a blurb falls
/// back to <c>"Open {label}."</c>, mirroring the web fallback so the page never blanks out.
/// </summary>
internal static class ExploreDescriptions
{
    /// <summary>The description map, keyed by leading-slash route path (web <c>DESCRIPTIONS</c>).</summary>
    public static IReadOnlyDictionary<string, string> ByPath { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            // Home
            ["/"] = "Your daily summary \u2014 battery, last drive, charging, and alerts at a glance.",
            ["/explore"] = "Browse and search every feature in TeslaSync with a 1-line description for each.",
            ["/live"] = "Real-time map of where your vehicle is right now.",
            ["/timeline"] = "Hour-by-hour history of drives, charges, and events.",
            ["/weekly-digest"] = "A printable weekly recap of usage, range, and cost.",

            // Vehicles
            ["/vehicles"] = "Manage every Tesla on your account \u2014 VIN, options, status.",
            ["/digital-twin"] = "A live 3D model of your car mirroring doors, lights, and motion.",
            ["/vehicle-comparison"] = "Side-by-side stats for two or more of your vehicles.",
            ["/locations"] = "Frequent destinations \u2014 home, work, favorite Superchargers.",

            // Driving
            ["/drives"] = "Every drive with route, energy used, and efficiency.",
            ["/trips"] = "Multi-leg trips grouped into a single journey.",
            ["/trip-planner"] = "Plan a route with charging stops and ETA before you leave.",
            ["/navigation"] = "Send a destination to the car or save it for later.",
            ["/geofences"] = "Trigger automations when the car enters or leaves a zone.",
            ["/mileage"] = "Odometer log with monthly and yearly totals.",
            ["/lifetime-stats"] = "Every drive ever \u2014 distance, energy, and time totals.",
            ["/drive-score"] = "Smoothness rating per drive (acceleration, braking, cornering).",
            ["/speed-profile"] = "Speed-vs-time chart for any drive.",
            ["/driving-dynamics"] = "G-forces, lateral and longitudinal acceleration analysis.",
            ["/regen-efficiency"] = "How much energy regenerative braking recaptures.",
            ["/route-efficiency"] = "Compare actual vs predicted Wh/mile for a route.",

            // Charging
            ["/charging"] = "All charging sessions \u2014 Supercharger, home, third-party.",
            ["/tesla-charging-history"] = "Tesla-provided charging history pulled from your account.",
            ["/charging-curve"] = "Power vs SOC curve for any charging session.",
            ["/charging-heatmap"] = "When and where you charge, visualised as a heatmap.",
            ["/smart-charge"] = "Schedule charging for off-peak or solar-surplus windows.",
            ["/powershare"] = "Use your vehicle as a backup home battery (V2H).",

            // Battery
            ["/battery"] = "Pack health: SoH, full-charge capacity, and degradation curve.",
            ["/battery-cells"] = "Per-cell voltage and temperature spread.",
            ["/battery-degradation"] = "Capacity loss over time vs fleet average.",
            ["/projected-range"] = "Range forecast adjusted for weather, terrain, and driving style.",
            ["/vampire-drain"] = "Standby energy loss while parked and asleep.",
            ["/sleep-efficiency"] = "How quickly the car drops into low-power sleep when parked.",

            // Energy
            ["/energy"] = "Daily kWh in and out of the pack.",
            ["/energy-flow"] = "Animated flow diagram showing where the energy is going right now.",
            ["/power-flow"] = "Live power draw and regen at the wheels.",
            ["/energy-products"] = "Solar production and Powerwall stats from your Tesla account.",

            // Service
            ["/tire-pressure"] = "Current and historical pressure per tire.",
            ["/drivetrain-health"] = "Motor temperatures, inverter status, and fault codes.",
            ["/software-updates"] = "Available firmware updates and changelog.",
            ["/maintenance"] = "Tire rotations, brake fluid, cabin filter \u2014 overdue items first.",

            // Cabin
            ["/climate-control"] = "Pre-heat, pre-cool, or run Dog Mode remotely.",
            ["/media-player"] = "See what is playing and control playback.",

            // Reports
            ["/statistics"] = "Bar and pie charts across every metric in the system.",
            ["/analytics"] = "Long-range trends and correlations you can drill into.",
            ["/period-compare"] = "Pick two date ranges and see what changed.",
            ["/efficiency"] = "Wh/mile broken down by speed, climate, and elevation.",
            ["/temperature-impact"] = "How outside temperature affects range and efficiency.",
            ["/cost-analysis"] = "Electricity cost per drive and per mile.",
            ["/tco"] = "Total cost of ownership \u2014 energy, insurance, service, depreciation.",

            // Commands
            ["/commands"] = "Send a remote command (wake, lock, climate, port, \u2026).",
            ["/command-history"] = "Audit log of every command sent and its result.",

            // Automation
            ["/automations"] = "Trigger actions on geofence, time, or vehicle state.",
            ["/notifications/studio"] = "Build a custom alert rule with conditions and channels.",
            ["/notifications/rules"] = "Manage existing alert rules.",

            // Notifications
            ["/notifications/inbox"] = "Recent alerts and system messages.",
            ["/notifications/alerts"] = "Active and acknowledged alerts grouped by severity.",
            ["/notifications/channels"] = "Where alerts are sent \u2014 email, SMS, push, webhook.",
            ["/notifications/webhooks"] = "POST alerts to your own URL for downstream automation.",
            ["/notifications/browser"] = "Enable browser push notifications for this device.",
            ["/notifications/quiet-hours"] = "Mute non-critical alerts during set times.",

            // Security
            ["/security-access"] = "Manage who can drive, charge, and unlock your vehicle.",
            ["/safety-settings"] = "Speed limit, valet mode, and safety-related preferences.",
            ["/guard-mode"] = "Sentry Mode, dashcam, and event-recording settings.",

            // Account
            ["/tesla-account"] = "Linked Tesla account, refresh-token status, and re-auth.",
            ["/tesla-orders"] = "Active orders on your Tesla account.",
            ["/fleet-api"] = "Fleet API rate-limit usage and registration details.",
            ["/tesla-region"] = "Switch Fleet API region (NA, EU, China).",
            ["/tesla-features"] = "Tesla feature-flag previews exposed by your firmware version.",
            ["/account/2fa"] = "Enroll or disable two-factor authentication on your account.",
            ["/account/sessions"] = "Browser and device sessions \u2014 revoke any of them.",
            ["/account/privacy"] = "Recently viewed pages, cookies, and analytics consent.",
            ["/me/activity"] = "Your recent page views and actions in this app.",

            // Settings
            ["/settings"] = "Units, theme, locale, density, and every app preference.",
            ["/chatbot"] = "Ask Helix anything about your car or this app.",
            ["/dev-tools"] = "In-app developer surface \u2014 flags, debuggers, and inspectors.",

            // Integrations
            ["/api-keys"] = "Issue and revoke API keys for external integrations.",
            ["/gas-price"] = "Compare your $/mile against gasoline at current prices.",

            // Data
            ["/data-export"] = "Export drives, charging sessions, and signals to CSV.",
            ["/backup"] = "Take a full backup of the database or restore from one.",
            ["/data-repair"] = "Re-derive trips, sessions, and analytics from raw signals.",

            // Diagnostics
            ["/system-status"] = "Health of every dependent service \u2014 MQTT, Redis, DB, Tesla API.",
            ["/db-health"] = "Database size, query latency, and replication lag.",
            ["/anomaly-detection"] = "Auto-detected outliers in charging, range, and drives.",
            ["/signals"] = "Live values for every telemetry signal the car publishes.",
            ["/admin/live-signals"] = "Inspect a single signal in real time with history.",
            ["/admin/ingest-xray"] = "See every payload as it lands from Fleet Telemetry.",
            ["/admin/dlq"] = "Dead-letter queue \u2014 messages that failed to ingest.",
            ["/admin/flags"] = "Runtime feature flags \u2014 toggle without redeploy.",
            ["/admin/schema-drift"] = "Detect divergence between code models and the live DB schema.",
            ["/admin/slow-queries"] = "Top slow SQL queries with explain plans.",
            ["/admin/vehicle-cost"] = "Per-vehicle infrastructure cost attribution.",
            ["/admin/disk-forecast"] = "When will the database run out of disk?",
            ["/admin/secret-rotation"] = "Track and rotate secrets, tokens, and credentials.",
            ["/admin/audit-log"] = "Every privileged action with actor, target, and timestamp.",
            ["/admin/gdpr-exports"] = "Generate and download a complete user-data export.",
            ["/state-debugger"] = "Inspect the per-vehicle finite-state machine in real time.",
            ["/mqtt-inspector"] = "Subscribe to any MQTT topic and watch messages flow.",
            ["/redis-signals"] = "Dump the Redis live-signal cache for a vehicle.",
            ["/admin/telemetry/coverage"] = "Which Fleet Telemetry fields are wired vs missing.",
            ["/api-logs"] = "Recent HTTP requests with status, duration, and payload size.",
            ["/api-playground"] = "Try any API endpoint with parameter forms.",

            // About
            ["/roadmap"] = "Upcoming features grouped by quarter.",
        };
}
