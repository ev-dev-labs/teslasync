using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The generated-client-backed <see cref="IMaintenanceFeed"/> — the native data adapter for the maintenance surface.
/// It binds to the generated OpenAPI contract client (ADR-004): <c>GET /maintenance/</c> for the maintenance items
/// (web <c>request&lt;MaintenanceItem[]&gt;('/maintenance')</c>) and <c>GET /maintenance/records</c> for the service
/// history (web <c>request&lt;ServiceRecord[]&gt;('/maintenance/records')</c>), neither of which takes a parameter or
/// body. No HTTP touches the view; each response JSON round-trips through the tolerant
/// <see cref="MaintenanceSnapshot"/> parsers so the snake_case wire shape (and a platform <c>{data:…}</c> envelope) is
/// preserved losslessly. A non-success response surfaces as the client's <see cref="ApiException"/> (carrying the HTTP
/// status) so the view-model surfaces the failure banner exactly as the web <c>anyError</c> path does.
/// </summary>
public sealed class MaintenanceClientFeed : IMaintenanceFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public MaintenanceClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<MaintenanceSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var itemsJson = await _api
            .SendAsync<JsonElement>(new ApiRequest(MaintenanceRegistration.ItemsOperation), cancellationToken)
            .ConfigureAwait(false);

        var recordsJson = await _api
            .SendAsync<JsonElement>(new ApiRequest(MaintenanceRegistration.RecordsOperation), cancellationToken)
            .ConfigureAwait(false);

        return new MaintenanceSnapshot(
            HasData: true,
            Items: MaintenanceSnapshot.ItemsFromJson(itemsJson),
            Records: MaintenanceSnapshot.RecordsFromJson(recordsJson));
    }
}
