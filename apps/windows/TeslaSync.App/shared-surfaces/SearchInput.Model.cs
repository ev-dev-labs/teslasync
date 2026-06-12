using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the search-input surface — the native mirror of the web
/// <c>SearchInput</c> (web/src/components/forms/SearchInput.tsx). The web component is the shared debounced
/// search field: a leading magnifier icon, a controlled text box that buffers typing and emits the committed
/// value after a debounce window, a trailing clear (×) button while text is present, and — when a
/// <c>historyScope</c> is supplied — a "recent searches" dropdown of per-scope history entries (each with a
/// remove affordance) plus a "Clear history" footer. This metadata carries the diagnostics slug the surface
/// registers under and every render-contract i18n key/fallback the web source passes to <c>t()</c>, so the
/// native surface reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix
/// the WinUI resource bridge expects (the keys already exist in <c>Strings/en/Resources.resw</c>) and resolves
/// against the English fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class SearchInputRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SearchInput";

    /// <summary>Default debounce window in milliseconds before the committed value is emitted (web <c>debounceMs = 250</c>).</summary>
    public const int DefaultDebounceMs = 250;

    /// <summary>Default number of history entries shown in the dropdown (web <c>maxHistory = 8</c>).</summary>
    public const int DefaultMaxHistory = 8;

    /// <summary>Maximum entries kept per scope; oldest entries are evicted (web searchHistory <c>CAP = 12</c>).</summary>
    public const int Cap = 12;

    /// <summary>Minimum length (after trimming) for a query to be recorded in history (web <c>MIN_QUERY_LEN = 2</c>).</summary>
    public const int MinQueryLen = 2;

    /// <summary>i18n key for the clear (×) button accessible name (web <c>common.clear</c>).</summary>
    public const string ClearKey = "translation.common.clear";

    /// <summary>English fallback for <see cref="ClearKey"/> (web second arg, verbatim).</summary>
    public const string ClearFallback = "Clear";

    /// <summary>i18n key for the recent-searches dropdown title + listbox accessible name (web <c>search.history.title</c>).</summary>
    public const string HistoryTitleKey = "translation.search.history.title";

    /// <summary>English fallback for <see cref="HistoryTitleKey"/> (web second arg, verbatim).</summary>
    public const string HistoryTitleFallback = "Recent searches";

    /// <summary>i18n key for a history row's remove-button accessible name (web <c>search.history.removeAria</c>).</summary>
    public const string RemoveAriaKey = "translation.search.history.removeAria";

    /// <summary>
    /// English fallback for <see cref="RemoveAriaKey"/> (web second arg, verbatim — the <c>{{query}}</c> token is
    /// interpolated by <see cref="FormatRemoveAria"/>). The shipped resw catalog value uses the native
    /// <c>{0}</c> token instead, so the interpolation substitutes both.
    /// </summary>
    public const string RemoveAriaFallback = "Remove \"{{query}}\" from search history";

    /// <summary>i18n key for the "Clear history" footer button (web <c>search.history.clear</c>).</summary>
    public const string ClearHistoryKey = "translation.search.history.clear";

    /// <summary>English fallback for <see cref="ClearHistoryKey"/> (web second arg, verbatim).</summary>
    public const string ClearHistoryFallback = "Clear history";

    /// <summary>
    /// Interpolate a history entry into the localized remove-button accessible name. Substitutes the web
    /// i18next token (<c>{{query}}</c>) and the native positional token (<c>{0}</c>, used by the resw catalog
    /// value) so the same projection works whether the string came from the catalog or the English fallback.
    /// Uses a literal replace (never <see cref="string.Format(IFormatProvider, string, object?)"/>) so a
    /// localized value carrying a stray brace can never throw a <see cref="System.FormatException"/>.
    /// </summary>
    public static string FormatRemoveAria(string template, string query)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(query);
        return template
            .Replace("{{query}}", query, StringComparison.Ordinal)
            .Replace("{0}", query, StringComparison.Ordinal);
    }
}

/// <summary>
/// One recorded history entry — the native port of the web searchHistory <c>HistoryEntry</c>
/// (web/src/lib/searchHistory.ts L34-L39: <c>{ q; ts }</c>). <see cref="Query"/> is the original-cased text the
/// user submitted and <see cref="TimestampMs"/> is the wall-clock millisecond of the most recent submission.
/// </summary>
public sealed record SearchHistoryEntry(string Query, long TimestampMs);

/// <summary>
/// The mutually-exclusive content the surface renders — the native projection of the web source's render
/// branches (web/src/components/forms/SearchInput.tsx). The web field always renders the input; on top of that
/// it shows exactly one of: nothing extra while the field is empty and unfocused / history-less
/// (<see cref="Empty"/>), the trailing clear button while text is present (<see cref="Typing"/>), or the
/// recent-searches dropdown while focused with an empty value and a non-empty history (<see cref="History"/>,
/// web <c>dropdownVisible</c>).
///
/// <para>
/// The web source reads its history synchronously from a local store and performs no data fetch, so it has no
/// loading / error / stale / offline chrome to reproduce: there is no in-flight request (no loading), no
/// network round-trip (no offline / error — the store treats malformed data as an empty history rather than
/// surfacing an error) and no query-freshness concept (no stale chip). The three states below are therefore
/// the complete set the source renders.
/// </para>
/// </summary>
public enum SearchInputContentState
{
    /// <summary>The field is empty with no dropdown — the idle / prompt state (web empty value, no recent-searches popup).</summary>
    Empty,

    /// <summary>The field has text — the clear (×) button is shown and the dropdown is suppressed (web <c>local !== ''</c>).</summary>
    Typing,

    /// <summary>The recent-searches dropdown is shown (web <c>dropdownVisible</c>): focused, empty value, history-enabled, entries present.</summary>
    History,
}

/// <summary>
/// Per-scope recent-search history — the native port of the web searchHistory store
/// (web/src/lib/searchHistory.ts). Scopes are independent (<c>"drives"</c> does not bleed into
/// <c>"charging"</c>); within a scope entries are kept newest-first, capped at
/// <see cref="SearchInputRegistration.Cap"/> and de-duplicated case-insensitively (the most recent submission
/// wins, keeping its original casing). Trimming + minimum-length filtering happen in <see cref="Record"/> so
/// callers can fire on every blur / Enter without polluting the list. <see cref="Parse"/> survives malformed
/// JSON, non-object payloads and non-array scope values — anything weird becomes an empty history rather than
/// throwing — mirroring the web store's resilience contract. UI-free and deterministic (the recording clock is
/// injected), so the adapter is asserted without a XAML host.
/// </summary>
public sealed class SearchHistoryEnvelope
{
    private const string ScopesProperty = "scopes";
    private const string QueryProperty = "q";
    private const string TimestampProperty = "ts";

    private readonly Dictionary<string, List<SearchHistoryEntry>> _scopes;

    /// <summary>Creates an empty history (web <c>emptyEnvelope()</c>).</summary>
    public SearchHistoryEnvelope() => _scopes = new Dictionary<string, List<SearchHistoryEntry>>(StringComparer.Ordinal);

    private SearchHistoryEnvelope(Dictionary<string, List<SearchHistoryEntry>> scopes) => _scopes = scopes;

    /// <summary>The number of scopes currently holding at least one entry (exposed for tests / hosting).</summary>
    public int ScopeCount => _scopes.Count;

    /// <summary>
    /// Record <paramref name="query"/> in <paramref name="scope"/> at <paramref name="nowMs"/> — the web
    /// <c>recordSearch</c>. Trims whitespace and ignores empty / shorter-than-<see cref="SearchInputRegistration.MinQueryLen"/>
    /// queries. If an entry with the same casefolded text already exists in the scope it is removed and the new
    /// submission (with its current casing + timestamp) takes the top slot; the list is capped at
    /// <see cref="SearchInputRegistration.Cap"/>. Returns whether the query was recorded.
    /// </summary>
    public bool Record(string scope, string query, long nowMs)
    {
        if (string.IsNullOrEmpty(scope))
        {
            return false;
        }

        string trimmed = (query ?? string.Empty).Trim();
        if (trimmed.Length < SearchInputRegistration.MinQueryLen)
        {
            return false;
        }

        List<SearchHistoryEntry> existing = _scopes.TryGetValue(scope, out List<SearchHistoryEntry>? current)
            ? current
            : new List<SearchHistoryEntry>();

        var next = new List<SearchHistoryEntry>(SearchInputRegistration.Cap) { new(trimmed, nowMs) };
        foreach (SearchHistoryEntry entry in existing)
        {
            if (next.Count >= SearchInputRegistration.Cap)
            {
                break;
            }

            // web: drop the prior entry whose casefolded text matches the new submission (dedup), keep the rest.
            if (!string.Equals(entry.Query, trimmed, StringComparison.OrdinalIgnoreCase))
            {
                next.Add(entry);
            }
        }

        _scopes[scope] = next;
        return true;
    }

    /// <summary>
    /// Return up to <paramref name="max"/> recent search strings for <paramref name="scope"/>, newest-first —
    /// the web <c>getRecentSearches</c>. The cap is clamped to [0, <see cref="SearchInputRegistration.Cap"/>];
    /// an unknown / empty scope returns an empty list.
    /// </summary>
    public IReadOnlyList<string> GetRecent(string scope, int max)
    {
        if (string.IsNullOrEmpty(scope) || !_scopes.TryGetValue(scope, out List<SearchHistoryEntry>? entries))
        {
            return Array.Empty<string>();
        }

        int limit = Math.Max(0, Math.Min(max, SearchInputRegistration.Cap));
        if (limit == 0)
        {
            return Array.Empty<string>();
        }

        return entries.Take(limit).Select(e => e.Query).ToList();
    }

    /// <summary>
    /// Remove a single entry (matched case-insensitively) from <paramref name="scope"/> — the web
    /// <c>removeSearch</c>. The scope is dropped entirely once its last entry is removed. Returns whether
    /// anything changed.
    /// </summary>
    public bool Remove(string scope, string query)
    {
        if (string.IsNullOrEmpty(scope))
        {
            return false;
        }

        string lower = (query ?? string.Empty).Trim();
        if (lower.Length == 0 || !_scopes.TryGetValue(scope, out List<SearchHistoryEntry>? existing))
        {
            return false;
        }

        var next = existing
            .Where(e => !string.Equals(e.Query, lower, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (next.Count == existing.Count)
        {
            return false;
        }

        if (next.Count == 0)
        {
            _scopes.Remove(scope);
        }
        else
        {
            _scopes[scope] = next;
        }

        return true;
    }

    /// <summary>Wipe all entries for <paramref name="scope"/> only (web <c>clearScope</c>). Returns whether the scope existed.</summary>
    public bool ClearScope(string scope) => !string.IsNullOrEmpty(scope) && _scopes.Remove(scope);

    /// <summary>
    /// Parse a stored history blob — the web <c>load()</c>. Returns an empty history on null / blank input,
    /// malformed JSON, a non-object payload, a missing or non-object <c>scopes</c> map, a non-array scope value
    /// or entries that are not <c>{ q: non-empty string, ts: finite number }</c>. Each scope is capped at
    /// <see cref="SearchInputRegistration.Cap"/> and empty scopes are dropped.
    /// </summary>
    public static SearchHistoryEnvelope Parse(string? blob)
    {
        if (string.IsNullOrWhiteSpace(blob))
        {
            return new SearchHistoryEnvelope();
        }

        JsonNode? root;
        try
        {
            root = JsonNode.Parse(blob);
        }
        catch (JsonException)
        {
            return new SearchHistoryEnvelope();
        }

        if (root is not JsonObject envelope || envelope[ScopesProperty] is not JsonObject scopesIn)
        {
            return new SearchHistoryEnvelope();
        }

        var scopes = new Dictionary<string, List<SearchHistoryEntry>>(StringComparer.Ordinal);
        foreach (KeyValuePair<string, JsonNode?> scope in scopesIn)
        {
            if (scope.Value is not JsonArray rawEntries)
            {
                continue;
            }

            var cleaned = new List<SearchHistoryEntry>(SearchInputRegistration.Cap);
            foreach (JsonNode? node in rawEntries)
            {
                if (cleaned.Count >= SearchInputRegistration.Cap)
                {
                    break;
                }

                if (TryReadEntry(node, out SearchHistoryEntry entry))
                {
                    cleaned.Add(entry);
                }
            }

            if (cleaned.Count > 0)
            {
                scopes[scope.Key] = cleaned;
            }
        }

        return new SearchHistoryEnvelope(scopes);
    }

    /// <summary>Serialize the history to the web store's blob shape (web <c>save()</c>): <c>{ scopes: { scope: [{ q, ts }] } }</c>.</summary>
    public string ToJson()
    {
        var scopes = new JsonObject();
        foreach (KeyValuePair<string, List<SearchHistoryEntry>> scope in _scopes)
        {
            var array = new JsonArray();
            foreach (SearchHistoryEntry entry in scope.Value)
            {
                array.Add(new JsonObject
                {
                    [QueryProperty] = entry.Query,
                    [TimestampProperty] = entry.TimestampMs,
                });
            }

            scopes[scope.Key] = array;
        }

        var envelope = new JsonObject { [ScopesProperty] = scopes };
        return envelope.ToJsonString();
    }

    private static bool TryReadEntry(JsonNode? node, out SearchHistoryEntry entry)
    {
        entry = default!;
        if (node is not JsonObject obj)
        {
            return false;
        }

        if (obj[QueryProperty] is not JsonValue queryValue || !queryValue.TryGetValue(out string? query) ||
            string.IsNullOrEmpty(query))
        {
            return false;
        }

        if (obj[TimestampProperty] is not JsonValue tsValue || !tsValue.TryGetValue(out double ts) ||
            double.IsNaN(ts) || double.IsInfinity(ts))
        {
            return false;
        }

        entry = new SearchHistoryEntry(query, (long)ts);
        return true;
    }
}

/// <summary>
/// PII-safe diagnostics for the search-input surface (P1/S11 diagnostics contract). A search field's query
/// text and recorded history can carry arbitrary user-facing content (vehicle names, addresses, free text), so
/// the collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug —
/// never the query or any history entry. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class SearchInputDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SearchInputDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SearchInput</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={SearchInputRegistration.Slug}"));
    }
}
