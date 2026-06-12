using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="ISlowQueriesFeed"/> — the native data adapter for the admin slow-queries
/// surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /admin/observability/slow-queries</c>
/// for the page query (web <c>useSlowQueries</c>, with the snake_case <c>order_by</c>/<c>limit</c> params exactly as
/// the web <c>request()</c> URL builds them). No HTTP touches the view; the response JSON round-trips through the
/// tolerant <see cref="SlowQueriesSnapshot"/> parser, which unwraps the platform <c>{ data: … }</c> envelope (web
/// <c>fetchEnvelope</c>). A <c>503</c> / <c>SUBSYSTEM_NOT_CONFIGURED</c> failure is mapped to the not-configured
/// snapshot (web <c>error.status === 503</c>) so the page renders the warning banner rather than an error surface;
/// every other failure propagates to the error state.
/// </summary>
public sealed class SlowQueriesClientFeed : ISlowQueriesFeed
{
    private const string ListOperation = "get_api_v1_admin_observability_slow_queries";
    private const string SubsystemNotConfiguredCode = "SUBSYSTEM_NOT_CONFIGURED";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SlowQueriesClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SlowQueriesSnapshot> FetchAsync(SlowQueriesQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var parameters = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["order_by"] = query.OrderBy,
            ["limit"] = query.Limit,
        };

        var request = new ApiRequest(ListOperation, Query: parameters);

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return SlowQueriesSnapshot.FromJson(json);
        }
        catch (ApiException ex) when (ex.StatusCode == 503 || string.Equals(ex.ErrorCode, SubsystemNotConfiguredCode, StringComparison.Ordinal))
        {
            // web: isApiError(error) && error.status === 503 → render the "not configured" warning, not an error.
            return SlowQueriesSnapshot.NotConfigured;
        }
    }
}
