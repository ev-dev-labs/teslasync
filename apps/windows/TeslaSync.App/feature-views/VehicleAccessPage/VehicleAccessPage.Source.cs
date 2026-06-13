using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The data port the <see cref="VehicleAccessPageViewModel"/> reads the drivers + invitations through and writes
/// the access mutations back through — the native parity of the web hooks the page binds
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx): <c>useVehicle</c>, <c>useVehicleDrivers</c>,
/// <c>useVehicleInvitations</c>, <c>useRefreshVehicleDrivers</c>, <c>useRefreshVehicleInvitations</c>,
/// <c>useRemoveVehicleDriver</c>, <c>useCreateVehicleInvitation</c> and <c>useRevokeVehicleInvitation</c>. The
/// view never performs HTTP itself; the default <see cref="EmptyVehicleAccessFeed"/> resolves to the empty state
/// and the generated-client-backed <see cref="VehicleAccessClientFeed"/> binds to the
/// <c>/vehicles/{vehicleID}/…</c> endpoints (ADR-004). The feed is constructed per vehicle, so the methods carry
/// no vehicle id.
/// </summary>
public interface IVehicleAccessFeed
{
    /// <summary>Resolve the vehicle's display name for the header (web <c>useVehicle → GET /vehicles/{id}</c>); null when unavailable.</summary>
    Task<string?> FetchVehicleNameAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the authorized drivers (web <c>useVehicleDrivers → GET /vehicles/{vehicleID}/drivers</c>).</summary>
    Task<IReadOnlyList<VehicleDriver>> FetchDriversAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the share invitations (web <c>useVehicleInvitations → GET /vehicles/{vehicleID}/invitations</c>).</summary>
    Task<IReadOnlyList<VehicleInvitation>> FetchInvitationsAsync(CancellationToken cancellationToken);

    /// <summary>Re-sync drivers from Tesla (web <c>useRefreshVehicleDrivers → POST /vehicles/{vehicleID}/drivers/refresh</c>).</summary>
    Task RefreshDriversAsync(CancellationToken cancellationToken);

    /// <summary>Re-sync invitations from Tesla (web <c>useRefreshVehicleInvitations → POST /vehicles/{vehicleID}/invitations/refresh</c>).</summary>
    Task RefreshInvitationsAsync(CancellationToken cancellationToken);

    /// <summary>Remove a driver's access (web <c>useRemoveVehicleDriver → DELETE /vehicles/{vehicleID}/drivers</c> with <c>{ share_user_id }</c>).</summary>
    Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken);

    /// <summary>Create a new share invitation (web <c>useCreateVehicleInvitation → POST /vehicles/{vehicleID}/invitations</c>).</summary>
    Task CreateInvitationAsync(CancellationToken cancellationToken);

    /// <summary>Revoke a pending invitation (web <c>useRevokeVehicleInvitation → POST /vehicles/{vehicleID}/invitations/{invitationID}/revoke</c>).</summary>
    Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no vehicle name, no drivers, no invitations and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyVehicleAccessFeed : IVehicleAccessFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyVehicleAccessFeed Instance { get; } = new();

    private EmptyVehicleAccessFeed()
    {
    }

    /// <inheritdoc />
    public Task<string?> FetchVehicleNameAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<string?>(null);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleDriver>> FetchDriversAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleDriver>>(Array.Empty<VehicleDriver>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<VehicleInvitation>> FetchInvitationsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<VehicleInvitation>>(Array.Empty<VehicleInvitation>());
    }

    /// <inheritdoc />
    public Task RefreshDriversAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task RefreshInvitationsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task CreateInvitationAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IVehicleAccessFeed"/> — the native data adapter for the vehicle-access
/// surface. It binds to the generated OpenAPI contract client (ADR-004), filling the <c>vehicleID</c> path slot
/// from the route id the feed is constructed with: <c>GET /vehicles/{vehicleID}/</c> for the header name (web
/// <c>useVehicle</c>), <c>GET /vehicles/{vehicleID}/drivers</c> + <c>/invitations</c> for the two lists (web
/// <c>useVehicleDrivers</c> / <c>useVehicleInvitations</c>), <c>POST …/drivers/refresh</c> +
/// <c>…/invitations/refresh</c> for the re-syncs, <c>DELETE …/drivers</c> with the snake_case
/// <c>{ share_user_id }</c> body for the remove (web <c>useRemoveVehicleDriver</c>), <c>POST …/invitations</c>
/// for the create (web <c>useCreateVehicleInvitation</c>) and <c>POST …/invitations/{invitationID}/revoke</c>
/// for the revoke (web <c>useRevokeVehicleInvitation</c>). No HTTP touches the view; the list response JSON
/// round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly.
/// </summary>
public sealed class VehicleAccessClientFeed : IVehicleAccessFeed
{
    private const string VehicleOperation = "get_api_v1_vehicles_vehicleID";
    private const string DriversOperation = "get_api_v1_vehicles_vehicleID_drivers";
    private const string InvitationsOperation = "get_api_v1_vehicles_vehicleID_invitations";
    private const string RefreshDriversOperation = "post_api_v1_vehicles_vehicleID_drivers_refresh";
    private const string RefreshInvitationsOperation = "post_api_v1_vehicles_vehicleID_invitations_refresh";
    private const string RemoveDriverOperation = "delete_api_v1_vehicles_vehicleID_drivers";
    private const string CreateInvitationOperation = "post_api_v1_vehicles_vehicleID_invitations";
    private const string RevokeInvitationOperation = "post_api_v1_vehicles_vehicleID_invitations_invitationID_revoke";

    private readonly IApiClient _api;
    private readonly string _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the route vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The vehicle id filling the <c>vehicleID</c> path slot.</param>
    public VehicleAccessClientFeed(IApiClient api, string vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(vehicleId);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<string?> FetchVehicleNameAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(VehicleOperation, PathParams: VehiclePath());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return json.ValueKind == JsonValueKind.Object
            ? VehicleAccessJson.ReadString(json, "display_name")
            : null;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleDriver>> FetchDriversAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DriversOperation, PathParams: VehiclePath());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehicleDriver.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<VehicleInvitation>> FetchInvitationsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(InvitationsOperation, PathParams: VehiclePath());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehicleInvitation.ParseList(json);
    }

    /// <inheritdoc />
    public async Task RefreshDriversAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RefreshDriversOperation, PathParams: VehiclePath());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RefreshInvitationsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RefreshInvitationsOperation, PathParams: VehiclePath());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            RemoveDriverOperation,
            PathParams: VehiclePath(),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["share_user_id"] = shareUserId,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task CreateInvitationAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(CreateInvitationOperation, PathParams: VehiclePath());
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invitationId);

        var request = new ApiRequest(
            RevokeInvitationOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["vehicleID"] = _vehicleId,
                ["invitationID"] = invitationId,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private Dictionary<string, string> VehiclePath() => new(StringComparer.Ordinal)
    {
        ["vehicleID"] = _vehicleId,
    };
}
