using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="IEfficiencyFeed"/> — the native data adapter for the Efficiency page
/// (ADR-004). It binds the generated OpenAPI contract client to the two reads the web page performs, both
/// scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /drives/stats</c> (generated <see cref="EfficiencyRegistration.StatsOperation"/>, web
/// <c>useDrivingStats</c>) is the primary read whose failure surfaces the page error, and <c>GET /drives</c>
/// (<see cref="EfficiencyRegistration.DrivesOperation"/>, web <c>useDrives</c>) is the supplementary read that
/// powers the trend / distribution / scatter charts and the temperature table. The raw JSON round-trips through
/// the tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP touches the view. A failed
/// stats read propagates as the client's <see cref="ApiException"/> so the view-model renders the error surface,
/// while a failed drives read degrades gracefully to an empty list (mirroring the web's two independent queries).
/// </summary>
public sealed class EfficiencyClientFeed : IEfficiencyFeed
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public EfficiencyClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<EfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var statsRequest = new ApiRequest(EfficiencyRegistration.StatsOperation, Query: VehicleQuery());
        var statsJson = await _api.SendAsync<JsonElement>(statsRequest, cancellationToken).ConfigureAwait(false);
        EfficiencyStats? stats = EfficiencyStats.FromJson(statsJson);

        IReadOnlyList<EfficiencyDrive> drives = await FetchDrivesAsync(cancellationToken).ConfigureAwait(false);
        return new EfficiencySnapshot(stats, drives);
    }

    private async Task<IReadOnlyList<EfficiencyDrive>> FetchDrivesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(EfficiencyRegistration.DrivesOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return EfficiencySnapshot.ParseDrives(json);
        }
        catch (ApiException)
        {
            // The drive list is the web's separate, best-effort query — a transport failure here must never
            // sink the whole page, so the chart / table sections fall back to their own empty surfaces.
            return Array.Empty<EfficiencyDrive>();
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
