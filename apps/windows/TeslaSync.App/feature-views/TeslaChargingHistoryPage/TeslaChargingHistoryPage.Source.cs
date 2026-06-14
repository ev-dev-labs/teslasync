using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The generated-client-backed <see cref="ITeslaChargingHistoryFeed"/> — the native data adapter for the Tesla
/// charging-history page. It binds to the generated OpenAPI contract client (ADR-004) and reproduces the web page's
/// three data hooks verbatim: <c>GET /tesla/charging/history/</c> (operation
/// <see cref="TeslaChargingHistoryRegistration.HistoryOperation"/>, web <c>useTeslaChargingHistory</c>),
/// <c>GET /vehicles/</c> (operation <see cref="TeslaChargingHistoryRegistration.VehiclesOperation"/>, web
/// <c>useVehicles</c>) and <c>POST /tesla/charging/history/refresh</c> (operation
/// <see cref="TeslaChargingHistoryRegistration.RefreshOperation"/>, web <c>useRefreshTeslaChargingHistory</c>), each
/// passing the snake_case <c>vin</c> query parameter exactly as the web hooks do (omitted when no vehicle is selected).
/// No HTTP touches the view; every response round-trips through the tolerant snapshot / vehicle parsers so the
/// snake_case wire shape (and the platform <c>{data:…}</c> envelope) is preserved losslessly. A non-success response
/// surfaces as the client's <see cref="ApiException"/> (carrying the HTTP status) so the view-model can present the
/// page-level failure surface.
/// </summary>
public sealed class TeslaChargingHistoryClientFeed : ITeslaChargingHistoryFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public TeslaChargingHistoryClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TeslaChargingHistorySnapshot> FetchHistoryAsync(string? vin, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TeslaChargingHistoryRegistration.HistoryOperation, Query: VinQuery(vin));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TeslaChargingHistorySnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TeslaChargingHistoryRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TeslaChargingVehicle.ListFromJson(json);
    }

    /// <inheritdoc />
    public async Task<TeslaChargingHistorySnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TeslaChargingHistoryRegistration.RefreshOperation, Query: VinQuery(vin));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TeslaChargingHistorySnapshot.FromJson(json);
    }

    // The web hooks only append `vin` when a vehicle is selected; the query is omitted entirely for "All Vehicles".
    private static Dictionary<string, object?>? VinQuery(string? vin) =>
        string.IsNullOrEmpty(vin)
            ? null
            : new Dictionary<string, object?>(StringComparer.Ordinal) { ["vin"] = vin };
}
