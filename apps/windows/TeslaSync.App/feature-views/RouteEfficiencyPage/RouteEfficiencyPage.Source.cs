using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="IRouteEfficiencyFeed"/> — the native data adapter for the
/// Route-Efficiency page (ADR-004) and the C# port of the web <c>useRouteEfficiency</c> hook
/// (web/src/api/hooks/useDriving.ts). It performs the single read the web page performs, scoped to the active
/// vehicle by the snake_case <c>vehicle_id</c> query parameter and optionally bounded by the
/// <c>start</c> / <c>end</c> range: <c>GET /analytics/route-efficiency</c> (generated operation
/// <see cref="RouteEfficiencyRegistration.RouteOperation"/>). The raw JSON round-trips through the tolerant
/// <see cref="RouteEfficiencySnapshot.FromJson"/> parser so the snake_case wire shape is preserved losslessly;
/// no HTTP touches the view. A failed read propagates as the client's <see cref="ApiException"/> so the
/// view-model renders the retriable error surface (web parity: the page's <c>error</c> prop).
/// </summary>
public sealed class RouteEfficiencyClientFeed : IRouteEfficiencyFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string StartQueryParam = "start";
    private const string EndQueryParam = "end";

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly string? _start;
    private readonly string? _end;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and an optional range.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="start">Optional inclusive range start (web <c>from</c> URL state); null = all.</param>
    /// <param name="end">Optional inclusive range end (web <c>to</c> URL state); null = all.</param>
    public RouteEfficiencyClientFeed(IApiClient api, long vehicleId, string? start = null, string? end = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _start = start;
        _end = end;
    }

    /// <inheritdoc />
    public async Task<RouteEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RouteEfficiencyRegistration.RouteOperation, Query: BuildQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RouteEfficiencySnapshot.FromJson(json);
    }

    private Dictionary<string, object?> BuildQuery()
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = _vehicleId,
        };

        if (!string.IsNullOrWhiteSpace(_start))
        {
            query[StartQueryParam] = _start;
        }

        if (!string.IsNullOrWhiteSpace(_end))
        {
            query[EndQueryParam] = _end;
        }

        return query;
    }
}
