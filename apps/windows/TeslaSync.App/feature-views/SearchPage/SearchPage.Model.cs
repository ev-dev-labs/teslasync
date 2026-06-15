using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The nine entity kinds the unified search backend can return, in the web's canonical display order
/// (web/src/features/system/pages/SearchPage.tsx <c>ALL_TYPES</c>). The order is preserved so the facet
/// chip rail and the grouped result sections render predictably. Pure data — no WinUI types.
/// </summary>
public enum SearchHitType
{
    /// <summary>A linked vehicle (web <c>vehicle</c>).</summary>
    Vehicle,

    /// <summary>A recorded drive (web <c>drive</c>).</summary>
    Drive,

    /// <summary>A charging session (web <c>charging</c>).</summary>
    Charging,

    /// <summary>An alert rule / fired alert (web <c>alert</c>).</summary>
    Alert,

    /// <summary>A delivered notification (web <c>notification</c>).</summary>
    Notification,

    /// <summary>A geofence (web <c>geofence</c>).</summary>
    Geofence,

    /// <summary>An automation (web <c>automation</c>).</summary>
    Automation,

    /// <summary>A saved / visited location (web <c>location</c>).</summary>
    Location,

    /// <summary>A multi-drive trip (web <c>trip</c>).</summary>
    Trip,
}

/// <summary>
/// The canonical type registry — the display-ordered set, the snake_case wire identifiers and the
/// Segoe Fluent glyph each type renders with (the native stand-in for the web Lucide icons). The glyphs
/// reuse the shell <c>RouteTable</c>'s per-domain nav glyphs verbatim so a search row and its nav entry
/// share an icon (Warning for alerts, which have no nav route). Vendor-agnostic, allocation-light.
/// </summary>
public static class SearchTypes
{
    /// <summary>Every type in the web's canonical display order (web <c>ALL_TYPES</c>).</summary>
    public static IReadOnlyList<SearchHitType> All { get; } =
    [
        SearchHitType.Vehicle,
        SearchHitType.Drive,
        SearchHitType.Charging,
        SearchHitType.Alert,
        SearchHitType.Notification,
        SearchHitType.Geofence,
        SearchHitType.Automation,
        SearchHitType.Location,
        SearchHitType.Trip,
    ];

    /// <summary>The snake_case wire identifier the backend emits / the request filter expects.</summary>
    public static string Wire(SearchHitType type) => type switch
    {
        SearchHitType.Vehicle => "vehicle",
        SearchHitType.Drive => "drive",
        SearchHitType.Charging => "charging",
        SearchHitType.Alert => "alert",
        SearchHitType.Notification => "notification",
        SearchHitType.Geofence => "geofence",
        SearchHitType.Automation => "automation",
        SearchHitType.Location => "location",
        SearchHitType.Trip => "trip",
        _ => "results",
    };

    /// <summary>Parse a wire identifier into a known type, or null when it is not one of the nine.</summary>
    public static SearchHitType? Parse(string? wire) => wire switch
    {
        "vehicle" => SearchHitType.Vehicle,
        "drive" => SearchHitType.Drive,
        "charging" => SearchHitType.Charging,
        "alert" => SearchHitType.Alert,
        "notification" => SearchHitType.Notification,
        "geofence" => SearchHitType.Geofence,
        "automation" => SearchHitType.Automation,
        "location" => SearchHitType.Location,
        "trip" => SearchHitType.Trip,
        _ => null,
    };

    /// <summary>The Segoe Fluent glyph for a type (web Lucide icon → shell nav glyph).</summary>
    public static string Glyph(SearchHitType type) => type switch
    {
        SearchHitType.Vehicle => "\uE804",       // Car (RouteTable Vehicles)
        SearchHitType.Drive => "\uE7C0",         // Drives
        SearchHitType.Charging => "\uE945",      // Lightning (RouteTable Charging)
        SearchHitType.Alert => "\uE7BA",         // Warning (web BellRing — alerts have no nav route)
        SearchHitType.Notification => "\uE7E7",  // Notification (RouteTable Notifications)
        SearchHitType.Geofence => "\uE909",      // MapPinned (RouteTable Geofences)
        SearchHitType.Automation => "\uE945",    // Workflow (RouteTable Automations)
        SearchHitType.Location => "\uE81D",      // MapPin (RouteTable Locations)
        SearchHitType.Trip => "\uE7C0",          // Compass (RouteTable Trips)
        _ => "\uE721",                           // Search
    };
}

/// <summary>
/// One parsed search hit — the native mirror of a web <c>SearchHit</c>
/// (web/src/api/types.ts). <see cref="When"/> is the optional ISO-8601 timestamp the backend emits
/// (<c>when</c>); <see cref="Url"/> is the in-app route the row navigates to. Pure data — no WinUI types.
/// </summary>
public sealed record SearchHit(
    SearchHitType Type,
    long Id,
    string Title,
    string? Subtitle,
    string Url,
    double Score,
    string? When);

/// <summary>
/// The single-source snapshot the page binds to (web <c>useGlobalSearch</c> over <c>GET /search</c>):
/// the ranked hits and the echoed query. Pure data.
/// </summary>
public sealed record SearchSnapshot(IReadOnlyList<SearchHit> Hits, string Query)
{
    /// <summary>The empty snapshot — no hits.</summary>
    public static SearchSnapshot Empty { get; } = new(Array.Empty<SearchHit>(), string.Empty);

    /// <summary>True when there is at least one hit to render.</summary>
    public bool HasData => Hits.Count > 0;

    /// <summary>Parse a <c>GET /search</c> response body (<c>{hits:[…], query}</c>), tolerant of partial shapes.</summary>
    public static SearchSnapshot ParseResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        string query = SearchJson.String(element, "query") ?? string.Empty;
        if (!element.TryGetProperty("hits", out var hitsElement) || hitsElement.ValueKind != JsonValueKind.Array)
        {
            return new SearchSnapshot(Array.Empty<SearchHit>(), query);
        }

        var hits = new List<SearchHit>(hitsElement.GetArrayLength());
        foreach (var item in hitsElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            // Skip hits whose type is not one of the nine — the page only groups known types
            // (web: `if (!groups.has(hit.type)) continue`).
            if (SearchTypes.Parse(SearchJson.String(item, "type")) is not { } type)
            {
                continue;
            }

            hits.Add(new SearchHit(
                Type: type,
                Id: SearchJson.Long(item, "id") ?? 0,
                Title: SearchJson.String(item, "title") ?? string.Empty,
                Subtitle: SearchJson.String(item, "subtitle"),
                Url: SearchJson.String(item, "url") ?? string.Empty,
                Score: SearchJson.Double(item, "score") ?? 0,
                When: SearchJson.String(item, "when")));
        }

        return new SearchSnapshot(hits, query);
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ISearchFeed
{
    /// <summary>
    /// Run the unified search for <paramref name="query"/> restricted to <paramref name="types"/> (empty = all),
    /// returning at most <paramref name="limit"/> hits per type (web <c>useGlobalSearch</c> over <c>GET /search</c>).
    /// </summary>
    /// <param name="query">The trimmed query (always ≥ the minimum length when called).</param>
    /// <param name="types">The active type filter (empty restores all types).</param>
    /// <param name="limit">The per-type limit (web <c>25</c>).</param>
    /// <param name="cancellationToken">Cancels a superseded search.</param>
    Task<SearchSnapshot> FetchAsync(string query, IReadOnlyList<SearchHitType> types, int limit, CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface (no HTTP).</summary>
public sealed class EmptySearchFeed : ISearchFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySearchFeed Instance { get; } = new();

    private EmptySearchFeed()
    {
    }

    /// <inheritdoc />
    public Task<SearchSnapshot> FetchAsync(string query, IReadOnlyList<SearchHitType> types, int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(SearchSnapshot.Empty);
    }
}

/// <summary>The mutually-exclusive top-level state the result region renders (web's six branches).</summary>
public enum SearchState
{
    /// <summary>A non-empty query shorter than the minimum length — the "type at least 2 characters" surface.</summary>
    TooShort,

    /// <summary>No query yet — the "start typing to search" prompt (the manifest <c>empty</c> data state).</summary>
    Empty,

    /// <summary>The search request failed — the friendly error surface.</summary>
    Error,

    /// <summary>A query is in flight with no prior results — the loading skeleton.</summary>
    Loading,

    /// <summary>The query resolved with zero hits — the "no results" surface.</summary>
    NoResults,

    /// <summary>Hits resolved — the grouped result sections (the manifest <c>success</c> data state).</summary>
    Results,
}

/// <summary>One projected facet chip (web type filter button): the type, its glyph, label and toggle state.</summary>
public sealed record SearchFacetDisplay(SearchHitType Type, string Glyph, string Label, bool Active, string AutomationName);

/// <summary>One projected result row (web grouped <c>&lt;li&gt;</c> button): glyph, title, subtitle, relative time, route.</summary>
public sealed record SearchRowDisplay(
    SearchHitType Type,
    string Glyph,
    string Title,
    string Subtitle,
    bool HasSubtitle,
    string WhenText,
    bool HasWhen,
    string Url,
    string AutomationName);

/// <summary>One projected result group (web grouped <c>GlassPanel</c> section): the section label, count and its rows.</summary>
public sealed record SearchGroupDisplay(
    SearchHitType Type,
    string Glyph,
    string Label,
    int Count,
    string CountText,
    IReadOnlyList<SearchRowDisplay> Rows);

/// <summary>
/// The render-ready projection the view binds to — every web region of SearchPage.tsx as pre-formatted,
/// WinUI-free data: the seven GlassPanel regions (the search/filter panel, the five mutually-exclusive
/// state panels, and the repeated result-group panel), the facet rail, and the grouped rows. Every label
/// is resolved; every panel carries its own copy so a region never renders blank.
/// </summary>
public sealed record SearchDisplay(
    SearchState State,
    string Title,
    string AutomationName,
    // GlassPanel1 — search + facet rail.
    string Query,
    string SearchHint,
    string SearchLabel,
    IReadOnlyList<SearchFacetDisplay> Facets,
    bool ShowClearFilters,
    string ClearFiltersLabel,
    // GlassPanel2 — too-short.
    bool ShowTooShort,
    string TooShortTitle,
    string TooShortMessage,
    // GlassPanel3 — empty prompt.
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    // GlassPanel4 — error.
    bool ShowError,
    string ErrorTitle,
    string ErrorMessage,
    // GlassPanel5 — loading skeleton.
    bool ShowLoading,
    // GlassPanel6 — no results.
    bool ShowNoResults,
    string NoResultsTitle,
    string NoResultsMessage,
    // GlassPanel7 — repeated result groups.
    bool ShowResults,
    IReadOnlyList<SearchGroupDisplay> Groups);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page
/// lifecycle (<see cref="Loading"/> / <see cref="ErrorDetail"/>) and the two view controls the page owns:
/// the <see cref="Query"/> text and the <see cref="ActiveTypes"/> facet filter. The view-model fills this
/// in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record SearchModel(
    SearchSnapshot Snapshot,
    bool Loading,
    string? ErrorDetail,
    string Query,
    IReadOnlyList<SearchHitType> ActiveTypes);

/// <summary>
/// The resolved i18n strings for the Search page — the 22 manifest keys (web key names verbatim). Resolving
/// every key eagerly in <see cref="Resolve"/> means the full key set is exercised in every data state
/// (loading included), matching the web which mounts all translated literals.
/// </summary>
public readonly record struct SearchStrings(
    string Title,
    string Prompt,
    string InputLabel,
    string FiltersClear,
    string TooShortTitle,
    string TooShortMessage,
    string EmptyTitle,
    string EmptyMessage,
    string ErrorTitle,
    string ErrorMessage,
    string NoResultsTitle,
    string NoResultsMessage,
    string SectionVehicle,
    string SectionDrive,
    string SectionCharging,
    string SectionAlert,
    string SectionNotification,
    string SectionGeofence,
    string SectionAutomation,
    string SectionLocation,
    string SectionTrip,
    string SectionResults)
{
    /// <summary>Resolve every Search label through the localizer (web key names + English defaults verbatim).</summary>
    public static SearchStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new SearchStrings(
            Title: localizer.GetString("search.title", "Search"),
            Prompt: localizer.GetString("search.placeholder", "Search vehicles, drives, charging\u2026"), // parity:allow web i18n key search.placeholder ported verbatim
            InputLabel: localizer.GetString("search.input.label", "Search query"),
            FiltersClear: localizer.GetString("search.filters.clear", "Clear filters"),
            TooShortTitle: localizer.GetString("search.tooShort.title", "Type at least 2 characters"),
            TooShortMessage: localizer.GetString("search.tooShort.message", "Search across vehicles, drives, charging sessions, alerts, geofences, automations and more."),
            EmptyTitle: localizer.GetString("search.empty.title", "Start typing to search"),
            EmptyMessage: localizer.GetString("search.empty.message", "Search across vehicles, drives, charging sessions, alerts, geofences, automations and more."),
            ErrorTitle: localizer.GetString("search.error.title", "Search failed"),
            ErrorMessage: localizer.GetString("search.error.message", "The search service did not respond. Try again or refine your query."),
            NoResultsTitle: localizer.GetString("search.noResults.title", "No results"),
            NoResultsMessage: localizer.GetString("search.noResults.message", "No matches for \"{0}\". Try fewer characters or open the command palette."),
            SectionVehicle: localizer.GetString("search.section.vehicle", "Vehicles"),
            SectionDrive: localizer.GetString("search.section.drive", "Drives"),
            SectionCharging: localizer.GetString("search.section.charging", "Charging"),
            SectionAlert: localizer.GetString("search.section.alert", "Alerts"),
            SectionNotification: localizer.GetString("search.section.notification", "Notifications"),
            SectionGeofence: localizer.GetString("search.section.geofence", "Geofences"),
            SectionAutomation: localizer.GetString("search.section.automation", "Automations"),
            SectionLocation: localizer.GetString("search.section.location", "Locations"),
            SectionTrip: localizer.GetString("search.section.trip", "Trips"),
            SectionResults: localizer.GetString("search.section.results", "Results"));
    }

    /// <summary>The section label for a type (web <c>searchSectionLabel</c>); unknown → <see cref="SectionResults"/>.</summary>
    public string Section(SearchHitType type) => type switch
    {
        SearchHitType.Vehicle => SectionVehicle,
        SearchHitType.Drive => SectionDrive,
        SearchHitType.Charging => SectionCharging,
        SearchHitType.Alert => SectionAlert,
        SearchHitType.Notification => SectionNotification,
        SearchHitType.Geofence => SectionGeofence,
        SearchHitType.Automation => SectionAutomation,
        SearchHitType.Location => SectionLocation,
        SearchHitType.Trip => SectionTrip,
        _ => SectionResults,
    };
}

/// <summary>
/// The pure render projection (web SearchPage.tsx body). Given the parsed snapshot, the query, the facet
/// filter and the localized strings, it derives the mutually-exclusive <see cref="SearchState"/>, the facet
/// rail toggle states, and the grouped rows (known types only, in display order, empty groups dropped —
/// web <c>groupedHits</c>). It formats the per-row relative timestamps at the display boundary. No WinUI
/// types, no I/O — deterministic given an injected <c>now</c>.
/// </summary>
public static class SearchProjection
{
    /// <summary>The minimum query length the backend enforces (web <c>SEARCH_MIN_QUERY_LENGTH</c>).</summary>
    public const int MinQueryLength = 2;

    /// <summary>Project the model into the render-ready <see cref="SearchDisplay"/>.</summary>
    /// <param name="model">The parsed snapshot + lifecycle + view controls.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injected clock for deterministic relative-time formatting.</param>
    public static SearchDisplay Project(SearchModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var strings = SearchStrings.Resolve(localizer);
        string trimmed = (model.Query ?? string.Empty).Trim();
        var activeTypes = model.ActiveTypes ?? Array.Empty<SearchHitType>();

        var facets = BuildFacets(activeTypes, strings);
        bool showClear = activeTypes.Count > 0;

        var groups = BuildGroups(model.Snapshot.Hits, strings, now);

        var state = ResolveState(trimmed, model.ErrorDetail, model.Loading, groups.Count);

        string noResultsMessage = strings.NoResultsMessage.Replace("{0}", trimmed, StringComparison.Ordinal);

        return new SearchDisplay(
            State: state,
            Title: strings.Title,
            AutomationName: strings.Title,
            Query: model.Query ?? string.Empty,
            SearchHint: strings.Prompt,
            SearchLabel: strings.InputLabel,
            Facets: facets,
            ShowClearFilters: showClear,
            ClearFiltersLabel: strings.FiltersClear,
            ShowTooShort: state == SearchState.TooShort,
            TooShortTitle: strings.TooShortTitle,
            TooShortMessage: strings.TooShortMessage,
            ShowEmpty: state == SearchState.Empty,
            EmptyTitle: strings.EmptyTitle,
            EmptyMessage: strings.EmptyMessage,
            ShowError: state == SearchState.Error,
            ErrorTitle: strings.ErrorTitle,
            ErrorMessage: strings.ErrorMessage,
            ShowLoading: state == SearchState.Loading,
            ShowNoResults: state == SearchState.NoResults,
            NoResultsTitle: strings.NoResultsTitle,
            NoResultsMessage: noResultsMessage,
            ShowResults: state == SearchState.Results,
            Groups: groups);
    }

    /// <summary>
    /// Derive the mutually-exclusive top-level state, faithful to the web branch order: too-short → empty
    /// prompt → error → loading (no prior results) → no-results → results.
    /// </summary>
    public static SearchState ResolveState(string trimmed, string? errorDetail, bool loading, int groupCount)
    {
        if (trimmed.Length > 0 && trimmed.Length < MinQueryLength)
        {
            return SearchState.TooShort;
        }

        if (trimmed.Length == 0)
        {
            return SearchState.Empty;
        }

        if (errorDetail is not null)
        {
            return SearchState.Error;
        }

        if (loading && groupCount == 0)
        {
            return SearchState.Loading;
        }

        if (groupCount == 0)
        {
            return SearchState.NoResults;
        }

        return SearchState.Results;
    }

    private static List<SearchFacetDisplay> BuildFacets(IReadOnlyList<SearchHitType> activeTypes, SearchStrings strings)
    {
        var facets = new List<SearchFacetDisplay>(SearchTypes.All.Count);
        foreach (var type in SearchTypes.All)
        {
            string label = strings.Section(type);
            facets.Add(new SearchFacetDisplay(type, SearchTypes.Glyph(type), label, activeTypes.Contains(type), label));
        }

        return facets;
    }

    private static List<SearchGroupDisplay> BuildGroups(IReadOnlyList<SearchHit> hits, SearchStrings strings, DateTimeOffset now)
    {
        var byType = new Dictionary<SearchHitType, List<SearchHit>>();
        foreach (var hit in hits)
        {
            if (!byType.TryGetValue(hit.Type, out var bucket))
            {
                bucket = [];
                byType[hit.Type] = bucket;
            }

            bucket.Add(hit);
        }

        var groups = new List<SearchGroupDisplay>(SearchTypes.All.Count);
        foreach (var type in SearchTypes.All)
        {
            if (!byType.TryGetValue(type, out var bucket) || bucket.Count == 0)
            {
                continue;
            }

            var rows = new List<SearchRowDisplay>(bucket.Count);
            foreach (var hit in bucket)
            {
                rows.Add(BuildRow(hit, strings, now));
            }

            groups.Add(new SearchGroupDisplay(
                Type: type,
                Glyph: SearchTypes.Glyph(type),
                Label: strings.Section(type),
                Count: bucket.Count,
                CountText: bucket.Count.ToString(CultureInfo.CurrentCulture),
                Rows: rows));
        }

        return groups;
    }

    private static SearchRowDisplay BuildRow(SearchHit hit, SearchStrings strings, DateTimeOffset now)
    {
        string title = string.IsNullOrEmpty(hit.Title) ? "\u2014" : hit.Title;
        string subtitle = hit.Subtitle ?? string.Empty;
        bool hasSubtitle = !string.IsNullOrEmpty(subtitle);

        string whenText = FormatWhen(hit.When, now);
        bool hasWhen = whenText.Length > 0;

        string automation = string.Concat(strings.Section(hit.Type), ": ", title);
        return new SearchRowDisplay(
            Type: hit.Type,
            Glyph: SearchTypes.Glyph(hit.Type),
            Title: title,
            Subtitle: subtitle,
            HasSubtitle: hasSubtitle,
            WhenText: whenText,
            HasWhen: hasWhen,
            Url: hit.Url,
            AutomationName: automation);
    }

    private static string FormatWhen(string? iso, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(iso) ||
            !DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed))
        {
            return string.Empty;
        }

        return DateTimeFormatting.Format(parsed, DateTimeVariant.Relative, now);
    }
}

/// <summary>
/// Stable identity + binding constants for the Search surface — the diagnostics slug, the shell route name
/// (matches <c>RouteTable.Hidden("Search","search",SystemOps,"Search")</c>), the generated operation id and
/// the per-type limit. The page registers itself in <c>ShellWindow</c> under <see cref="RouteName"/>.
/// </summary>
public static class SearchRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SearchPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "Search";

    /// <summary>The generated operation id for the unified search read (web <c>GET /search</c>).</summary>
    public const string SearchOperation = "get_api_v1_search";

    /// <summary>The per-type result limit the page requests (web <c>limit: 25</c>).</summary>
    public const int DefaultLimit = 25;

    /// <summary>The Segoe Fluent glyph the leading search affordance / state surfaces render (web Lucide <c>Search</c>).</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>The localized page title (web <c>t('search.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("search.title", "Search");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SearchPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a query string or a hit title/URL —
/// so a diagnostics line can never leak what a user searched for. Thread-safe.
/// </summary>
public sealed class SearchDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SearchDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SearchPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SearchRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case search JSON wire shape (no camelCaseKeys transform on native):
/// numbers (or numeric strings), 64-bit ids and strings. Kept internal so the page's parsers stay
/// self-contained and never throw on a partial body.
/// </summary>
internal static class SearchJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a 64-bit integer (or integer-string) property, or null when absent / non-integer.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}
