using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IFleetTelemetryCoverageFeed"/> — the native data adapter for the admin Fleet
/// Telemetry coverage surface. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /tesla/fleet-telemetry/coverage</c> for the routing-snapshot query (web <c>useFleetTelemetryCoverage</c>),
/// which takes no parameters. No HTTP touches the view; the response JSON round-trips through the tolerant
/// <see cref="FleetTelemetryCoverageSnapshot"/> parser so the snake_case wire shape is preserved losslessly and the
/// web <c>?? []</c> / <c>?? {}</c> coalescing is reproduced. A non-success response surfaces as the client's
/// <see cref="ApiException"/> so the view-model can render the generic failure branch (web <c>error</c>).
/// </summary>
public sealed class FleetTelemetryCoverageClientFeed : IFleetTelemetryCoverageFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public FleetTelemetryCoverageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FleetTelemetryCoverageSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(FleetTelemetryCoverageRegistration.Operation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return FleetTelemetryCoverageSnapshot.FromJson(json);
    }
}
