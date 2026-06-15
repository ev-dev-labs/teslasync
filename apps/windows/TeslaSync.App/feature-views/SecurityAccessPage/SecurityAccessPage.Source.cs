using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The data port the <see cref="SecurityAccessPageViewModel"/> reads the security state through — the native parity
/// of the web hooks the page binds (web/src/features/admin/pages/SecurityAccessPage.tsx): the polled
/// <c>GET /security/latest</c>, <c>useSecurityEvents → GET /security</c> and <c>useVehicles → GET /vehicles</c>. The
/// view never performs HTTP itself; the default <see cref="EmptySecurityAccessFeed"/> resolves to the empty state and
/// the generated-client-backed <see cref="SecurityAccessClientFeed"/> binds to the contract endpoints (ADR-004). A
/// failing read throws (carrying the HTTP status via <c>ApiException</c>) so the view-model can surface the error
/// banner exactly as the web <c>anyError</c> branch does.
/// </summary>
public interface ISecurityAccessFeed
{
    /// <summary>Resolve the fleet for the scope picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the polled latest snapshot (web <c>GET /security/latest?vehicle_id=…</c>).</summary>
    Task<SecurityEvent?> FetchLatestAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Resolve the security history feed (web <c>useSecurityEvents → GET /security?vehicle_id=…</c>).</summary>
    Task<IReadOnlyList<SecurityEvent>> FetchSecurityEventsAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no fleet, no latest and no history (the empty data state).</summary>
public sealed class EmptySecurityAccessFeed : ISecurityAccessFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySecurityAccessFeed Instance { get; } = new();

    private EmptySecurityAccessFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleOption>>(Array.Empty<VehicleOption>());
    }

    /// <inheritdoc />
    public Task<SecurityEvent?> FetchLatestAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<SecurityEvent?>(null);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<SecurityEvent>> FetchSecurityEventsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<SecurityEvent>>(Array.Empty<SecurityEvent>());
    }
}

/// <summary>
/// The generated-client-backed <see cref="ISecurityAccessFeed"/> — the native data adapter for the admin
/// security-access surface. It binds to the generated OpenAPI contract client (ADR-004) and composes the reads the
/// web page issues: <c>GET /vehicles</c>, <c>GET /security/latest?vehicle_id=…</c> and <c>GET /security?vehicle_id=…</c>,
/// passing the snake_case <c>vehicle_id</c> query parameter exactly as the web hooks do (never camelCase). Each
/// response round-trips through the tolerant model parsers so the snake_case wire shape (and bool|string|number
/// signal unions) is preserved losslessly. No HTTP touches the view.
/// </summary>
public sealed class SecurityAccessClientFeed : ISecurityAccessFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SecurityAccessClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SecurityAccessRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task<SecurityEvent?> FetchLatestAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SecurityAccessRegistration.LatestOperation, Query: VehicleQuery(vehicleId));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SecurityEvent.ParseLatest(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<SecurityEvent>> FetchSecurityEventsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SecurityAccessRegistration.HistoryOperation, Query: VehicleQuery(vehicleId));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SecurityEvent.ParseHistory(json);
    }

    private static Dictionary<string, object?> VehicleQuery(long vehicleId) => new(StringComparer.Ordinal)
    {
        ["vehicle_id"] = vehicleId.ToString(CultureInfo.InvariantCulture),
    };

    // web useVehicles select: a bare array, or { vehicles | data | items: [...] }. Map id + display_name + vin + model
    // into the picker-facing VehicleOption (the rest of the vehicle shape is unused by this page).
    private static List<VehicleOption> ParseVehicles(JsonElement element)
    {
        var rows = SecurityAccessJson.Array(element, "vehicles", "data", "items");
        var list = new List<VehicleOption>(rows.Count);
        foreach (var item in rows)
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = SecurityAccessJson.Long(item, "id", "Id") ?? 0;
            if (id <= 0)
            {
                continue;
            }

            list.Add(new VehicleOption(
                Id: id,
                DisplayName: SecurityAccessJson.Str(item, "display_name", "displayName"),
                Vin: SecurityAccessJson.Str(item, "vin", "Vin"),
                Model: SecurityAccessJson.Str(item, "model", "Model")));
        }

        return list;
    }
}
