using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The data port the <see cref="VehicleDetailPageViewModel"/> reads through — the native parity of the web page's
/// per-vehicle settings hook (web/src/api/hooks/useVehicleSettings.ts): <c>useVehicleSettings</c> (the
/// <c>GET /vehicles/{id}/settings</c> read whose nickname override feeds the page title) plus the wake mutation
/// (<c>POST /vehicles/{id}/wake</c>) the header wake affordance invokes. The view never performs HTTP itself; the
/// default <see cref="EmptyVehicleDetailPageFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="VehicleDetailPageClientFeed"/> binds the OpenAPI contract client (ADR-004). A failing settings read
/// throws so the view-model can surface the never-blank error branch.
/// </summary>
public interface IVehicleDetailPageFeed
{
    /// <summary>Resolve the per-vehicle settings snapshot for a vehicle id (web <c>useVehicleSettings</c>).</summary>
    Task<VehicleDetailSnapshot> FetchAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Send the wake command for a vehicle id (web wake mutation); throws on a transport / API failure.</summary>
    Task WakeAsync(long vehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/empty state the shell shows by default).</summary>
public sealed class EmptyVehicleDetailPageFeed : IVehicleDetailPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyVehicleDetailPageFeed Instance { get; } = new();

    private EmptyVehicleDetailPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<VehicleDetailSnapshot> FetchAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(VehicleDetailSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task WakeAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IVehicleDetailPageFeed"/> — the native data adapter for the
/// Vehicle-detail page (ADR-004). It binds to the generated OpenAPI contract client for the per-vehicle settings
/// read (<see cref="VehicleDetailPageRegistration.SettingsOperation"/>) the page is built around and the wake
/// command (<see cref="VehicleDetailPageRegistration.WakeOperation"/>) the header invokes. The settings response
/// round-trips through the tolerant <see cref="VehicleSettingsData"/> parser so the snake_case wire shape is
/// preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class VehicleDetailPageClientFeed : IVehicleDetailPageFeed
{
    private const string VehicleIdParam = "vehicleID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public VehicleDetailPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<VehicleDetailSnapshot> FetchAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            VehicleDetailPageRegistration.SettingsOperation,
            VehicleIdParam,
            vehicleId.ToString(CultureInfo.InvariantCulture));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return new VehicleDetailSnapshot(VehicleSettingsData.FromJson(json));
    }

    /// <inheritdoc />
    public async Task WakeAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(
            VehicleDetailPageRegistration.WakeOperation,
            VehicleIdParam,
            vehicleId.ToString(CultureInfo.InvariantCulture));
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
