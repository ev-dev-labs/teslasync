using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IVehicleCostFeed"/> — the native data adapter for the admin vehicle-cost
/// surface. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /admin/observability/vehicle-cost</c> for the cost query (web <c>useVehicleCost</c>), passing the
/// snake_case <c>limit</c> and <c>since</c> query parameters exactly as the web hook does (the <c>since</c> instant is
/// serialised as an RFC 3339 / ISO-8601 UTC string, matching <c>Date.toISOString()</c>). No HTTP touches the view;
/// the response JSON round-trips through the tolerant <see cref="VehicleCostSnapshot"/> parser so the snake_case wire
/// shape (and the platform <c>{data:…}</c> envelope) is preserved losslessly. A non-success response surfaces as the
/// client's <see cref="ApiException"/> (carrying the HTTP status) so the view-model can distinguish the HTTP 503
/// "subsystem not configured" branch (web <c>subsystemMissing</c>) from a generic failure.
/// </summary>
public sealed class VehicleCostClientFeed : IVehicleCostFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public VehicleCostClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<VehicleCostSnapshot> FetchAsync(DateTimeOffset since, int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["limit"] = limit,
            ["since"] = since.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture),
        };

        var request = new ApiRequest(VehicleCostRegistration.Operation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehicleCostSnapshot.FromJson(json);
    }
}
