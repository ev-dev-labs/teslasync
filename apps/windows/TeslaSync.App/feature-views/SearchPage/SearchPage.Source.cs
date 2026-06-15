using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The generated-client-backed <see cref="ISearchFeed"/> — the native data adapter for the Search page
/// (ADR-004). It binds the generated OpenAPI contract client to the one read the web page performs
/// (web <c>useGlobalSearch</c> over <c>GET /search</c>), shaping the request with the snake_case query
/// parameters the Go API expects: <c>q</c> (the trimmed query), the optional comma-joined <c>types</c>
/// filter (omitted when no facet is active, restoring all types) and the per-type <c>limit</c>. The raw
/// JSON round-trips through <see cref="SearchSnapshot.ParseResponse"/> so the snake_case <c>{hits, query}</c>
/// envelope is preserved losslessly; no HTTP touches the view. A failed read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the retriable error surface.
/// </summary>
public sealed class SearchClientFeed : ISearchFeed
{
    private const string QueryParam = "q";
    private const string TypesParam = "types";
    private const string LimitParam = "limit";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SearchClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SearchSnapshot> FetchAsync(string query, IReadOnlyList<SearchHitType> types, int limit, CancellationToken cancellationToken)
    {
        var queryParams = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [QueryParam] = query ?? string.Empty,
            [LimitParam] = limit,
        };

        // Only send the types filter when at least one facet is active (web omits it otherwise so the
        // backend restores its full canonical set). Joined in the canonical display order, snake_case.
        if (types is { Count: > 0 })
        {
            queryParams[TypesParam] = string.Join(',', types.Select(SearchTypes.Wire));
        }

        var request = new ApiRequest(SearchRegistration.SearchOperation, Query: queryParams);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SearchSnapshot.ParseResponse(json);
    }
}
