using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IBatteryDegradationFeed"/> — the native data adapter for the
/// Battery Degradation page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the
/// web page performs, both scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/battery-health</c> (generated <see cref="BatteryDegradationRegistration.HealthOperation"/>,
/// web <c>useBatteryHealthAnalytics</c>) is the primary read whose failure surfaces the page error, and
/// <c>GET /analytics/battery-degradation</c> (<see cref="BatteryDegradationRegistration.DegradationOperation"/>,
/// web <c>useBatteryDegradation</c>) is the best-effort supplementary read that powers the prediction / risk /
/// projection sections. The raw JSON round-trips through the tolerant report parsers so the snake_case wire
/// shape is preserved losslessly; no HTTP touches the view. A failed health read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the error surface, while a failed degradation read
/// degrades gracefully to the empty supplementary report (mirroring the web's two independent queries).
/// </summary>
public sealed class BatteryDegradationClientFeed : IBatteryDegradationFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public BatteryDegradationClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<BatteryDegradationSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var healthRequest = new ApiRequest(BatteryDegradationRegistration.HealthOperation, Query: VehicleQuery());
        var healthJson = await _api.SendAsync<JsonElement>(healthRequest, cancellationToken).ConfigureAwait(false);
        BatteryHealthReport? health = BatteryHealthReport.FromJson(healthJson);

        BatteryDegradationReport degradation = await FetchDegradationAsync(cancellationToken).ConfigureAwait(false);
        return BatteryDegradationSnapshot.Compose(health, degradation);
    }

    private async Task<BatteryDegradationReport> FetchDegradationAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(BatteryDegradationRegistration.DegradationOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return BatteryDegradationReport.FromJson(json);
        }
        catch (ApiException)
        {
            // The degradation read is the web's separate, best-effort query — a transport failure here must
            // never sink the whole page, so the prediction / risk / projection sections fall back to empty.
            return BatteryDegradationReport.Empty;
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
