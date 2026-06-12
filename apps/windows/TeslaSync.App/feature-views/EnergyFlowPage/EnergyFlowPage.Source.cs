using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IEnergyFlowFeed"/> — the native data adapter for the battery
/// energy-flow surface. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles/{vehicleID}/energy</c> for the historical rollup (web stats query, with the trailing
/// snake_case <c>days</c> query parameter exactly as the web hook appends it) and
/// <c>GET /vehicles/{vehicleID}/energy/flow</c> for the real-time reading (web <c>useEnergyFlow</c>). No HTTP
/// touches the view; both responses round-trip through the tolerant <see cref="EnergyStatsReading"/> /
/// <see cref="EnergyFlowReading"/> parsers so the snake_case wire shape (SI units) and the platform
/// <c>{data:…}</c> envelope are preserved losslessly. A non-success response surfaces as the client's
/// <see cref="ApiException"/> so the view-model can surface the retryable error branch.
/// </summary>
public sealed class EnergyFlowClientFeed : IEnergyFlowFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public EnergyFlowClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(vehicleId);

        var request = new ApiRequest(
            EnergyFlowRegistration.OperationStats,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal) { ["vehicleID"] = vehicleId },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { ["days"] = days.ToString(CultureInfo.InvariantCulture) });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return EnergyStatsReading.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(vehicleId);

        var request = new ApiRequest(
            EnergyFlowRegistration.OperationFlow,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal) { ["vehicleID"] = vehicleId });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return EnergyFlowReading.FromJson(json);
    }
}
