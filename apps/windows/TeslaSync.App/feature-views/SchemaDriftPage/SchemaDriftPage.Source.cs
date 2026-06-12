using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="ISchemaDriftFeed"/> — the native data adapter for the admin schema-drift
/// surface. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /admin/observability/schema-drift</c> for the drift query (web <c>useSchemaDrift</c>), which takes no
/// parameters. No HTTP touches the view; the response JSON round-trips through the tolerant
/// <see cref="SchemaDriftSnapshot"/> parser so the snake_case wire shape is preserved losslessly. A non-success
/// response surfaces as the client's <see cref="ApiException"/> (carrying the HTTP status) so the view-model can
/// distinguish the HTTP 503 "subsystem not configured" branch (web <c>subsystemMissing</c>) from a generic failure.
/// </summary>
public sealed class SchemaDriftClientFeed : ISchemaDriftFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SchemaDriftClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SchemaDriftRegistration.Operation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SchemaDriftSnapshot.FromJson(json);
    }
}
