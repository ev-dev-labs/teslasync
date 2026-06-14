using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IBatteryCellsFeed"/> — the native data adapter for the Battery
/// Cells page (ADR-004). It binds to the generated OpenAPI contract client for the single read the web page
/// performs, scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/battery-cells</c> (generated <see cref="BatteryCellsRegistration.CellsOperation"/>, web
/// <c>useQuery(['battery-cells', …])</c>). The raw JSON round-trips through the tolerant
/// <see cref="BatteryCellsReport"/> parser so the snake_case wire shape is preserved losslessly; no HTTP
/// touches the view. A transport failure propagates as the client's <see cref="ApiException"/> so the
/// view-model renders the retriable error surface (web <c>error</c>), while a non-object body composes to the
/// empty snapshot (web <c>data</c> undefined → the page empty surface).
/// </summary>
public sealed class BatteryCellsClientFeed : IBatteryCellsFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public BatteryCellsClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<BatteryCellsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(BatteryCellsRegistration.CellsOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        BatteryCellsReport? report = BatteryCellsReport.FromJson(json);
        return BatteryCellsSnapshot.Compose(report);
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
