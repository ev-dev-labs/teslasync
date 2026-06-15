using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IVampireDrainFeed"/> — the native data adapter for the Vampire-Drain
/// page (ADR-004). It binds to the generated OpenAPI contract client for the single read the web page performs,
/// scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /vampire-drain/stats</c> (generated <see cref="VampireDrainRegistration.StatsOperation"/>, web
/// <c>request('/vampire-drain/stats?vehicle_id=…')</c>). The raw JSON round-trips through the tolerant
/// <see cref="VampireDrainStats"/> parser so the snake_case wire shape is preserved losslessly; no HTTP touches
/// the view. A transport failure propagates as the client's <see cref="ApiException"/> so the view-model
/// renders the retriable error surface (web <c>error</c>), while a non-object body composes to the empty
/// snapshot (web <c>data</c> undefined → the page empty surface). These backend routes are derived rollups that
/// may 404 in production; the surface then degrades gracefully to its empty / error state exactly as the web
/// page does.
/// </summary>
public sealed class VampireDrainClientFeed : IVampireDrainFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public VampireDrainClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<VampireDrainSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(VampireDrainRegistration.StatsOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        VampireDrainStats? stats = VampireDrainStats.FromJson(json);
        return VampireDrainSnapshot.Compose(stats);
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
