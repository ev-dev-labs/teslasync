using System.Collections.Generic;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The search-input's recent-search history seam (P1/S8 state-holder layer) — the native unification of the
/// web searchHistory module the field calls into (web/src/components/forms/SearchInput.tsx imports
/// <c>recordSearch</c> / <c>getRecentSearches</c> / <c>removeSearch</c> / <c>clearScope</c> from
/// web/src/lib/searchHistory.ts). The view never touches storage directly; it asks this seam to record, read,
/// remove and clear per-scope history and renders the result. Implementations own their own persistence; the
/// shipped <see cref="JsonSearchHistoryStore"/> serializes the web store's blob shape over an injected
/// <see cref="ISearchHistoryBlobStore"/> so production can back it with durable storage while galleries / tests
/// back it in memory.
/// </summary>
public interface ISearchHistoryStore
{
    /// <summary>
    /// Record <paramref name="query"/> in <paramref name="scope"/> (web <c>recordSearch</c>). Trimming +
    /// minimum-length filtering and case-insensitive de-duplication are the store's responsibility, so callers
    /// may fire this on every blur / Enter without polluting the list.
    /// </summary>
    void Record(string scope, string query);

    /// <summary>
    /// Return up to <paramref name="max"/> recent search strings for <paramref name="scope"/>, newest-first
    /// (web <c>getRecentSearches</c>); an unknown scope yields an empty list.
    /// </summary>
    IReadOnlyList<string> GetRecent(string scope, int max);

    /// <summary>Remove a single entry (matched case-insensitively) from <paramref name="scope"/> (web <c>removeSearch</c>).</summary>
    void Remove(string scope, string query);

    /// <summary>Wipe every entry for <paramref name="scope"/> only, leaving other scopes intact (web <c>clearScope</c>).</summary>
    void ClearScope(string scope);
}

/// <summary>
/// The raw persistence seam behind <see cref="JsonSearchHistoryStore"/> — the native analogue of the browser
/// <c>localStorage</c> slot the web store reads and writes (web/src/lib/searchHistory.ts <c>load()</c> /
/// <c>save()</c> over the <c>teslasync:search-history:v1</c> key). It moves a single opaque blob; the store
/// owns the JSON shape on top of it. <see cref="Write"/> is best-effort: an implementation backed by a quota-
/// limited or unavailable store drops the write silently (history is purely additive UX), mirroring the web
/// <c>save()</c> try/catch.
/// </summary>
public interface ISearchHistoryBlobStore
{
    /// <summary>Read the stored blob, or <see langword="null"/> when nothing has been written yet (web <c>localStorage.getItem</c>).</summary>
    string? Read();

    /// <summary>Persist the blob, dropping the write silently on failure (web <c>localStorage.setItem</c> in a try/catch).</summary>
    void Write(string blob);
}

/// <summary>
/// An in-process <see cref="ISearchHistoryBlobStore"/> holding the blob in memory — the default backing for
/// galleries, headless construction and tests, and a safe fallback when no durable store is wired. A write can
/// never fail in memory, so it always succeeds. Production hosts inject a durable implementation (e.g. backed
/// by the app's local settings) without changing the view-model or view.
/// </summary>
public sealed class InMemorySearchHistoryBlobStore : ISearchHistoryBlobStore
{
    private string? _blob;

    /// <inheritdoc />
    public string? Read() => _blob;

    /// <inheritdoc />
    public void Write(string blob) => _blob = blob;
}

/// <summary>
/// The shipped <see cref="ISearchHistoryStore"/> — the native port of the web searchHistory store
/// (web/src/lib/searchHistory.ts). Each operation loads the blob from its <see cref="ISearchHistoryBlobStore"/>,
/// parses it through the resilient <see cref="SearchHistoryEnvelope.Parse"/> (malformed / non-object / non-array
/// data degrades to an empty history), applies the mutation through the pure <see cref="SearchHistoryEnvelope"/>
/// adapter, and writes the serialized blob back only when something changed — mirroring the web
/// <c>load()</c>/<c>save()</c> round-trip per call. The recording clock is injected so history timestamps are
/// deterministic under test. Construct it over an <see cref="InMemorySearchHistoryBlobStore"/> for galleries /
/// tests, or over a durable blob store in production.
/// </summary>
public sealed class JsonSearchHistoryStore : ISearchHistoryStore
{
    private readonly ISearchHistoryBlobStore _blobs;
    private readonly Func<long> _clock;

    /// <summary>Creates the store over a blob persistence seam and an optional millisecond clock.</summary>
    /// <param name="blobs">The raw blob persistence seam (web <c>localStorage</c>); defaults to an in-memory store.</param>
    /// <param name="clock">The wall-clock millisecond source for recorded timestamps; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public JsonSearchHistoryStore(ISearchHistoryBlobStore? blobs = null, Func<long>? clock = null)
    {
        _blobs = blobs ?? new InMemorySearchHistoryBlobStore();
        _clock = clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    /// <inheritdoc />
    public void Record(string scope, string query)
    {
        SearchHistoryEnvelope envelope = Load();
        if (envelope.Record(scope, query, _clock()))
        {
            _blobs.Write(envelope.ToJson());
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<string> GetRecent(string scope, int max) => Load().GetRecent(scope, max);

    /// <inheritdoc />
    public void Remove(string scope, string query)
    {
        SearchHistoryEnvelope envelope = Load();
        if (envelope.Remove(scope, query))
        {
            _blobs.Write(envelope.ToJson());
        }
    }

    /// <inheritdoc />
    public void ClearScope(string scope)
    {
        SearchHistoryEnvelope envelope = Load();
        if (envelope.ClearScope(scope))
        {
            _blobs.Write(envelope.ToJson());
        }
    }

    private SearchHistoryEnvelope Load() => SearchHistoryEnvelope.Parse(_blobs.Read());
}
