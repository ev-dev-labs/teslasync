using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AddressInputViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// single cache-then-network geocode read the web component composes through its hook
/// (web <c>useGeocodeSearch(debouncedQuery)</c>). The view never performs HTTP itself; the concrete
/// <see cref="AddressGeocodeSource"/> (or a test fake) drives this.
/// </summary>
public interface IAddressGeocodeSource
{
    /// <summary>
    /// Stream the cache-then-network geocode suggestions for <paramref name="query"/>, capped at
    /// <paramref name="limit"/> rows, cached first. The caller is responsible for the minimum-length gate
    /// (web <c>enabled: query.length &gt;= 3</c>); this is only invoked once a query is searchable.
    /// </summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> StreamAsync(
        string query,
        int limit,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IAddressGeocodeSource"/> — the native data adapter for the address
/// autocomplete. It runs a cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to the
/// typed suggestion list via <see cref="AddressGeocodeResultMapper"/>:
/// <c>GET /geocode/search?q=&amp;limit=</c> (generated operation <c>get_api_v1_geocode_search</c>, web
/// <c>request('/geocode/search?q=${encodeURIComponent(query)}&amp;limit=5')</c>). The endpoint declares no typed
/// query params, so the client appends <c>q</c> / <c>limit</c> verbatim (URL-encoded). No HTTP touches the view.
/// </summary>
public sealed class AddressGeocodeSource : IAddressGeocodeSource
{
    private const string GeocodeSearchOperation = "get_api_v1_geocode_search";
    private const string CacheKeyPrefix = "geocode:search";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AddressGeocodeSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> StreamAsync(
        string query,
        int limit,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string trimmed = (query ?? string.Empty).Trim();
        string cacheKey = string.Create(
            CultureInfo.InvariantCulture, $"{CacheKeyPrefix}:{trimmed.ToLowerInvariant()}:{limit}");

        // web: useGeocodeSearch appends ?q=<encoded>&limit=5 (snake_case single-word params). The endpoint
        // declares no typed query params, so the client appends them verbatim (each URL-encoded).
        var request = new ApiRequest(
            GeocodeSearchOperation,
            Query: new Dictionary<string, object?>
            {
                ["q"] = trimmed,
                ["limit"] = limit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            GeocodeSuggestions.IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AddressGeocodeResultMapper.Map(emission);
        }
    }
}
