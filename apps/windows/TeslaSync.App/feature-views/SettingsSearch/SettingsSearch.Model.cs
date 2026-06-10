using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One user-discoverable setting in the find-as-you-type index — the native analogue of the web
/// <c>SettingsEntry</c> (web/src/features/settings/searchIndex.ts). Maps a stable <see cref="Id"/> to a
/// target <see cref="Href"/> (usually a hash anchor on <c>/settings</c> such as <c>/settings#appearance</c>,
/// but sometimes a full path on another page when a setting was promoted out of <c>/settings</c>, e.g.
/// <c>/integrations/helix</c>), plus the translated <see cref="Title"/> / <see cref="Description"/> shown in
/// the dropdown and the optional <see cref="Keywords"/> synonyms used for matching. Pure data — no WinUI
/// types — so the index and matcher are unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable slug; the de-dup key and analytics id (web <c>id</c>).</param>
/// <param name="Href">Target URL — a <c>/settings</c> hash anchor or a full cross-page path (web <c>href</c>).</param>
/// <param name="Section">Section id this entry belongs to, for grouping (web <c>section</c>).</param>
/// <param name="Title">Translated title shown on the first line of the dropdown row (web <c>title</c>).</param>
/// <param name="Description">Translated description shown on the second line and fuzzy-matched (web <c>description</c>).</param>
/// <param name="Keywords">Optional synonyms / abbreviations matched but not shown (web <c>keywords</c>).</param>
public sealed record SettingsEntry(
    string Id,
    string Href,
    string Section,
    string Title,
    string Description,
    IReadOnlyList<string> Keywords)
{
    /// <summary>The parsed deep-link destination for this entry (web <c>navigate(entry.href)</c> + section scroll).</summary>
    public SettingsNavigationTarget Target => SettingsNavigationTarget.FromHref(Href);
}

/// <summary>
/// The resolved deep-link destination a chosen <see cref="SettingsEntry"/> navigates to — the native
/// analogue of the web component's <c>commit</c> step, which calls <c>navigate(entry.href)</c> and then
/// scrolls the <c>entry.href.split('#')[1]</c> section into view. <see cref="Path"/> is the route portion
/// (e.g. <c>/settings</c> or <c>/tesla-account</c>) and <see cref="Section"/> is the optional same-page
/// anchor (e.g. <c>appearance</c>), null for a cross-page entry. Pure data so the parse is unit-tested
/// headlessly.
/// </summary>
/// <param name="Href">The original target URL (web <c>entry.href</c>).</param>
/// <param name="Path">The route portion before any <c>#</c> fragment (web <c>navigate</c> target).</param>
/// <param name="Section">The same-page anchor after <c>#</c>, or null when the href has none.</param>
public sealed record SettingsNavigationTarget(string Href, string Path, string? Section)
{
    /// <summary>True when the href carries a same-page <c>#section</c> anchor to scroll into view.</summary>
    public bool HasSection => !string.IsNullOrEmpty(Section);

    /// <summary>
    /// Split an <paramref name="href"/> into its route <see cref="Path"/> and optional <see cref="Section"/>
    /// anchor — the native port of the web <c>commit</c>'s <c>entry.href.split('#')[1]</c>. An href with no
    /// <c>#</c> (or an empty fragment) yields a null section.
    /// </summary>
    public static SettingsNavigationTarget FromHref(string href)
    {
        ArgumentNullException.ThrowIfNull(href);

        int hash = href.IndexOf('#', StringComparison.Ordinal);
        if (hash < 0)
        {
            return new SettingsNavigationTarget(href, href, null);
        }

        string path = href[..hash];
        string section = href[(hash + 1)..];
        return new SettingsNavigationTarget(href, path, section.Length == 0 ? null : section);
    }
}

/// <summary>
/// The mutually-exclusive surface state of <c>SettingsSearch</c>. The web component performs a
/// <b>synchronous</b> client-side search over a static, i18n-built index (no network read), so — exactly
/// like the sibling <see cref="LegacyAlertsRedirectState"/> redirect surface — there is deliberately
/// <b>no</b> loading / error / stale / offline branch: there is nothing to fetch, fail, go stale or fall
/// offline. The web's only render branches are the closed field, the populated dropdown, and the
/// "No matching settings." note; each maps to a state below and every one is rendered explicitly so no
/// surface is ever hidden (engineering rule #6).
/// </summary>
public enum SettingsSearchState
{
    /// <summary>Resting: the query is empty, so the dropdown is closed (web <c>showDropdown = query.length &gt; 0</c>).</summary>
    Idle,

    /// <summary>The query matched at least one setting — the dropdown lists the ranked results.</summary>
    Results,

    /// <summary>The (non-empty) query matched nothing — the dropdown shows the "No matching settings." note.</summary>
    Empty,
}

/// <summary>
/// One presentation row offered in the dropdown — either a real <see cref="SettingsEntry"/> match
/// (<see cref="ForEntry"/>) or the single non-actionable "No matching settings." note
/// (<see cref="NoResults"/>). The web renders the first as a two-line <c>&lt;button role="option"&gt;</c>
/// (title + description) and the second as a disabled <c>&lt;li&gt;</c>; this row carries the projected
/// text for both so the WinUI <c>AutoSuggestBox</c> item template stays declarative. Pure data — no WinUI
/// types — so the projection is unit-tested headlessly.
/// </summary>
public sealed record SettingsSearchRow
{
    private SettingsSearchRow(SettingsEntry? entry, bool isNoResults, string primaryText, string? secondaryText)
    {
        Entry = entry;
        IsNoResults = isNoResults;
        PrimaryText = primaryText;
        SecondaryText = secondaryText;
    }

    /// <summary>The matched entry, or null for the "no results" note.</summary>
    public SettingsEntry? Entry { get; }

    /// <summary>True for the non-actionable "No matching settings." row (web disabled option).</summary>
    public bool IsNoResults { get; }

    /// <summary>The first-line text — the entry title, or the "no results" message (web <c>TextMemberPath</c>).</summary>
    public string PrimaryText { get; }

    /// <summary>The second-line description (web <c>entry.description</c>), or null for the "no results" row.</summary>
    public string? SecondaryText { get; }

    /// <summary>Project a matched entry into an actionable two-line row.</summary>
    public static SettingsSearchRow ForEntry(SettingsEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return new SettingsSearchRow(entry, isNoResults: false, entry.Title, entry.Description);
    }

    /// <summary>Build the single non-actionable "No matching settings." row.</summary>
    public static SettingsSearchRow NoResults(string message) =>
        new(entry: null, isNoResults: true, message ?? string.Empty, secondaryText: null);
}

/// <summary>
/// The find-as-you-type matcher — a verbatim native port of <c>searchSettings</c> / <c>fuzzyMatch</c>
/// (web/src/features/settings/searchIndex.ts). Substring matches on title / keywords / description outrank
/// fuzzy subsequence matches, and title hits beat description hits within each tier; results come back
/// pre-sorted by descending score with ties broken by original index order (the web relies on V8's stable
/// sort). Pure — unit-tested without a UI host.
/// </summary>
public static class SettingsSearchMatcher
{
    /// <summary>
    /// Case-insensitive subsequence match — web <c>fuzzyMatch</c>. Returns true when every character of
    /// <paramref name="needle"/> appears in <paramref name="haystack"/> in order (e.g. "lng" → "Language").
    /// An empty needle never matches; an empty haystack only matches the empty needle.
    /// </summary>
    public static bool FuzzyMatch(string needle, string haystack)
    {
        ArgumentNullException.ThrowIfNull(needle);
        ArgumentNullException.ThrowIfNull(haystack);

        if (needle.Length == 0)
        {
            return false;
        }

        string n = needle.ToLowerInvariant();
        string h = haystack.ToLowerInvariant();
        int i = 0;
        foreach (char ch in n)
        {
            int found = h.IndexOf(ch, i);
            if (found == -1)
            {
                return false;
            }

            i = found + 1;
        }

        return true;
    }

    /// <summary>
    /// Score and filter <paramref name="index"/> against <paramref name="query"/> — web <c>searchSettings</c>.
    /// Returns every entry with a positive score, ordered by descending score then original index (stable).
    /// Callers cap the list (web <c>.slice(0, MAX_RESULTS)</c>); an empty / whitespace query yields no rows.
    /// </summary>
    public static IReadOnlyList<SettingsEntry> Search(IReadOnlyList<SettingsEntry> index, string? query)
    {
        ArgumentNullException.ThrowIfNull(index);

        string q = (query ?? string.Empty).Trim().ToLowerInvariant();
        if (q.Length == 0)
        {
            return Array.Empty<SettingsEntry>();
        }

        var scored = new List<(SettingsEntry Entry, int Score, int Order)>(index.Count);
        for (int i = 0; i < index.Count; i++)
        {
            SettingsEntry entry = index[i];
            int score = Score(entry, q);
            if (score > 0)
            {
                scored.Add((entry, score, i));
            }
        }

        return scored
            .OrderByDescending(s => s.Score)
            .ThenBy(s => s.Order)
            .Select(s => s.Entry)
            .ToList();
    }

    // web searchSettings tier table: exact title (1000) > title prefix (800) > title substring (600)
    // > keyword substring (400) > description substring (300) > fuzzy title (200) > fuzzy description (100).
    private static int Score(SettingsEntry entry, string q)
    {
        string title = entry.Title.ToLowerInvariant();
        string desc = entry.Description.ToLowerInvariant();
        bool keywordHit = entry.Keywords.Any(
            k => k.ToLowerInvariant().Contains(q, StringComparison.Ordinal));

        if (title.Equals(q, StringComparison.Ordinal))
        {
            return 1000;
        }

        if (title.StartsWith(q, StringComparison.Ordinal))
        {
            return 800;
        }

        if (title.Contains(q, StringComparison.Ordinal))
        {
            return 600;
        }

        if (keywordHit)
        {
            return 400;
        }

        if (desc.Contains(q, StringComparison.Ordinal))
        {
            return 300;
        }

        if (FuzzyMatch(q, entry.Title))
        {
            return 200;
        }

        if (FuzzyMatch(q, entry.Description))
        {
            return 100;
        }

        return 0;
    }
}

/// <summary>
/// Canonical registry metadata for the <c>SettingsSearch</c> surface — the native mirror of the web
/// component (web/src/features/settings/components/SettingsSearch.tsx). Centralises the stable id, the
/// diagnostics slug, the result cap (web <c>MAX_RESULTS = 8</c>), the Segoe Fluent search glyph standing in
/// for the web Lucide <c>Search</c> icon, and the three component-level i18n keys. The keys are resolved
/// through the P1/S10 facade verbatim from the web source (the field-prompt, label, and no-results keys all
/// exist in the en catalog); the English fallback doubles as the headless / unit-test value. UI-free so the
/// metadata is asserted in tests.
/// </summary>
public static class SettingsSearchRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "settings-search";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SettingsSearch";

    /// <summary>Maximum dropdown rows shown (web <c>MAX_RESULTS = 8</c>).</summary>
    public const int MaxResults = 8;

    /// <summary>Segoe Fluent "Search" glyph — the native stand-in for the web Lucide <c>Search</c> icon.</summary>
    public const string SearchGlyph = "\uE721";

    /// <summary>i18n key for the field prompt text (web's empty-field prompt prop).</summary>
    public const string PromptKey = "settings.search.placeholder"; // parity:allow web i18n key literally named placeholder

    /// <summary>English fallback for the field prompt — verbatim from the web source.</summary>
    public const string PromptFallback = "Search settings\u2026";

    /// <summary>i18n key for the accessible field label (web <c>t('settings.search.label', 'Search settings')</c>).</summary>
    public const string LabelKey = "settings.search.label";

    /// <summary>English fallback for the field label — verbatim from the web source.</summary>
    public const string LabelFallback = "Search settings";

    /// <summary>i18n key for the empty-result note (web <c>t('settings.search.noResults', 'No matching settings.')</c>).</summary>
    public const string NoResultsKey = "settings.search.noResults";

    /// <summary>English fallback for the empty-result note — verbatim from the web source.</summary>
    public const string NoResultsFallback = "No matching settings.";

    /// <summary>The field prompt text shown while empty (web's empty-field prompt).</summary>
    public static string PromptText(ILocalizer localizer) =>
        Require(localizer).GetString(PromptKey, PromptFallback);

    /// <summary>The accessible field label (web <c>aria-label</c>).</summary>
    public static string AriaLabel(ILocalizer localizer) =>
        Require(localizer).GetString(LabelKey, LabelFallback);

    /// <summary>The "No matching settings." empty-result note (web no-results option).</summary>
    public static string NoResultsText(ILocalizer localizer) =>
        Require(localizer).GetString(NoResultsKey, NoResultsFallback);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SettingsSearch</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the typed query or the chosen setting —
/// so a diagnostics line can never leak what a user searched for. Thread-safe.
/// </summary>
public sealed class SettingsSearchDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public SettingsSearchDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SettingsSearch</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SettingsSearchRegistration.Slug}");
    }
}
