using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The generated-client-backed <see cref="IMapOverviewFeed"/> — the native data adapter for the Map Overview
/// page (ADR-004). It binds the generated OpenAPI contract client to the four reads the web page performs
/// (web/src/features/maps/pages/MapOverviewPage.tsx): the fleet (<c>useVehicles</c> → <c>GET /vehicles</c>), the
/// latest position (<c>GET /vehicles/{vehicleID}/positions?limit=1</c>), the recent history
/// (<c>?limit=50</c>) and the latest location snapshot (<c>GET /location-snapshots/latest?vehicle_id=…</c>).
/// The per-vehicle reads carry the <c>vehicleID</c> path slot and the snake_case <c>limit</c> / <c>vehicle_id</c>
/// query parameters (never camelCase). The raw JSON round-trips through the tolerant parsers so the snake_case
/// wire shape is preserved losslessly; no HTTP touches the view. A failed read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the retriable error surface.
/// </summary>
public sealed class MapOverviewClientFeed : IMapOverviewFeed
{
    private const string VehicleIdPathParam = "vehicleID";
    private const string VehicleIdQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public MapOverviewClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<MapVehicleRef>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(MapOverviewRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return MapOverviewSnapshot.ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task<PositionRecord?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var positions = await FetchPositionsAsync(vehicleId, MapOverviewRegistration.LatestLimit, cancellationToken)
            .ConfigureAwait(false);
        return positions.Count > 0 ? positions[0] : null;
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PositionRecord>> FetchPositionHistoryAsync(long vehicleId, CancellationToken cancellationToken) =>
        FetchPositionsAsync(vehicleId, MapOverviewRegistration.HistoryLimit, cancellationToken);

    /// <inheritdoc />
    public async Task<LocationSnapshot?> FetchLocationSnapshotAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleIdQueryParam] = vehicleId };
        var request = new ApiRequest(MapOverviewRegistration.LocationSnapshotOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return MapOverviewSnapshot.ParseLocation(json);
    }

    private async Task<IReadOnlyList<PositionRecord>> FetchPositionsAsync(long vehicleId, int limit, CancellationToken cancellationToken)
    {
        var pathParams = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehicleIdPathParam] = vehicleId.ToString(System.Globalization.CultureInfo.InvariantCulture),
        };
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { [LimitQueryParam] = limit };
        var request = new ApiRequest(MapOverviewRegistration.PositionsOperation, pathParams, query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return MapOverviewSnapshot.ParsePositions(json);
    }
}
