using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The generated-client-backed <see cref="ILocationsFeed"/> — the native data adapter for the Locations page
/// (ADR-004). It binds the generated OpenAPI contract client to the one read the web page performs, scoped to
/// the active vehicle by the snake_case <c>vehicle_id</c> query parameter and paged by <c>limit</c> / <c>offset</c>
/// (web <c>useQuery(['visited-locations', vehicleId, page, pageSize])</c> over <c>GET /locations</c>). The raw
/// JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP
/// touches the view. A failed read propagates as the client's <see cref="ApiException"/> so the view-model
/// renders the retriable error surface.
/// </summary>
public sealed class LocationsClientFeed : ILocationsFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const string OffsetQueryParam = "offset";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public LocationsClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<LocationsSnapshot> FetchAsync(int offset, int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = _vehicleId,
            [LimitQueryParam] = limit,
            [OffsetQueryParam] = Math.Max(offset, 0),
        };

        var request = new ApiRequest(LocationsRegistration.ListOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return new LocationsSnapshot(LocationsSnapshot.ParseLocations(json));
    }
}
