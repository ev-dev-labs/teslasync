using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The generated-client-backed <see cref="ILifetimeStatsFeed"/> — the native data adapter for the Lifetime-Stats
/// page (ADR-004). It binds the generated OpenAPI contract client to the single read the web page performs,
/// scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/lifetime</c> (generated <see cref="LifetimeStatsRegistration.LifetimeOperation"/>, web
/// <c>useLifetimeStats</c>). The raw JSON round-trips through the tolerant parsers so the snake_case wire shape is
/// preserved losslessly; no HTTP touches the view. A failed read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the error surface.
/// </summary>
public sealed class LifetimeStatsClientFeed : ILifetimeStatsFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public LifetimeStatsClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<LifetimeStatsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(LifetimeStatsRegistration.LifetimeOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return new LifetimeStatsSnapshot(LifetimeStats.FromJson(json));
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
