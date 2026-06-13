using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The generated-client-backed <see cref="ITemperatureImpactFeed"/> — the native data adapter for the
/// Temperature-Impact page (ADR-004). It binds to the generated OpenAPI contract client for the single read the
/// web page performs, scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/temperature-impact</c> (generated
/// <see cref="TemperatureImpactRegistration.TemperatureImpactOperation"/>, web
/// <c>['temperature-impact', vehicleId]</c> query). The response body is an object whose <c>points</c> array is
/// projected through the tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP touches
/// the view. A failed read propagates as the client's <see cref="ApiException"/> so the view-model renders the
/// error surface.
/// </summary>
public sealed class TemperatureImpactClientFeed : ITemperatureImpactFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public TemperatureImpactClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<TempImpactSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            TemperatureImpactRegistration.TemperatureImpactOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = _vehicleId });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TempImpactSnapshot.Compose(ParsePoints(json));
    }

    /// <summary>
    /// Parse the <c>GET /analytics/temperature-impact</c> body into the tolerant sample list (web
    /// <c>res.points ?? []</c>): read the <c>points</c> array of objects, skipping anything that is not an
    /// object. A body that is not an object, or that has no <c>points</c> array, yields no samples.
    /// </summary>
    public static IReadOnlyList<TempEfficiencyPoint> ParsePoints(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("points", out var points))
        {
            return Array.Empty<TempEfficiencyPoint>();
        }

        if (points.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TempEfficiencyPoint>();
        }

        var parsed = new List<TempEfficiencyPoint>(points.GetArrayLength());
        foreach (var item in points.EnumerateArray())
        {
            if (TempEfficiencyPoint.FromJson(item) is { } point)
            {
                parsed.Add(point);
            }
        }

        return parsed;
    }
}
