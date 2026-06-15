using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// The generated-client-backed <see cref="IAnomaliesFeed"/> — the native data adapter for the Anomaly-Dashboard
/// page (ADR-004) and the C# port of the web <c>useAnomalies</c> hook (web/src/api/hooks/useAnomalies.ts). It
/// performs the single read the web page performs, scoped to the active vehicle by the snake_case
/// <c>vehicle_id</c> query parameter and bounded by the <c>days</c> lookback window (web default 7):
/// <c>GET /analytics/anomalies</c> (generated operation
/// <see cref="AnomalyDashboardRegistration.AnomaliesOperation"/>). The raw JSON round-trips through the tolerant
/// <see cref="AnomalySnapshot.FromJson"/> parser so the snake_case wire shape is preserved losslessly; no HTTP
/// touches the view. A failed read propagates as the client's <see cref="ApiException"/> so the view-model
/// renders the retriable error surface (web parity: the page's <c>error</c> prop).
/// </summary>
public sealed class AnomaliesClientFeed : IAnomaliesFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string DaysQueryParam = "days";

    /// <summary>The web hook's default lookback window (<c>useAnomalies(vehicleId, days = 7)</c>).</summary>
    public const int DefaultDays = 7;

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly int _days;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and a lookback window.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="days">The lookback window in days (web <c>days</c>; defaults to 7).</param>
    public AnomaliesClientFeed(IApiClient api, long vehicleId, int days = DefaultDays)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _days = days > 0 ? days : DefaultDays;
    }

    /// <inheritdoc />
    public async Task<AnomalySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AnomalyDashboardRegistration.AnomaliesOperation, Query: BuildQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AnomalySnapshot.FromJson(json);
    }

    private Dictionary<string, object?> BuildQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
        [DaysQueryParam] = _days,
    };
}
