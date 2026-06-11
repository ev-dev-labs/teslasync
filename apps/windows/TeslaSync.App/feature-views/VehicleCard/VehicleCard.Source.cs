using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="VehicleCardViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="VehicleCardData"/> snapshots — the native analogue of
/// the <c>vehicle</c> prop the web vehicles list assembles from <c>useVehicles</c> plus the per-vehicle
/// <c>useVehicleState</c> read the web <c>VehicleCard</c> performs internally
/// (web/src/features/vehicles/components/VehicleCard.tsx). The view never performs HTTP itself; the concrete
/// <see cref="VehicleCardSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleCardSource
{
    /// <summary>Stream the cache-then-network card snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<VehicleCardData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVehicleCardSource"/> — the native data adapter for the Vehicle Card
/// surface. One logical read resolves the requested (or primary) vehicle from <c>GET /vehicles</c> (web
/// <c>useVehicles</c>), then reads that vehicle's live state from <c>GET /vehicles/{vehicleID}/state</c> (web
/// <c>useVehicleState</c>, normalising both the live <c>{ state }</c> and the cached <c>{ vehicle, position }</c>
/// shapes). The assembled <see cref="VehicleCardData"/> is cached as JSON so the snapshot round-trips
/// losslessly and the whole read replays cache-then-network through the shared
/// <see cref="CacheThenNetworkEngine"/>. When no vehicle resolves the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web list rendering nothing for that card. No HTTP
/// touches the view.
/// </summary>
public sealed class VehicleCardSource : IVehicleCardSource
{
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary (first roster) vehicle is used.</param>
    public VehicleCardSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
        _cacheKey = vehicleId is { } id
            ? string.Create(CultureInfo.InvariantCulture, $"vehicles:vehicle-card:{id}")
            : "vehicles:vehicle-card:primary";
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleCardData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<VehicleCardData>(
            _cacheKey,
            FetchAsync,
            static data => !data.HasVehicle,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<VehicleCardData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The vehicle roster resolves the card's vehicle (web vehicles.find(...) ?? vehicles[0]).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        var vehicle = VehicleCardVehicle.FromVehiclesArray(vehicles, _vehicleId);
        if (vehicle is null)
        {
            // Web parity: with no vehicle the list renders nothing — the native surface shows its empty state.
            return VehicleCardData.Empty;
        }

        // 2. That vehicle's live state drives the stats row (web useVehicleState). A stateless body parses to
        //    null telemetry — the asleep card without a stats row — rather than failing the read.
        var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vehicle.Id), cancellationToken)
            .ConfigureAwait(false);
        var telemetry = VehicleCardTelemetry.FromResponse(stateJson);
        return new VehicleCardData(vehicle, telemetry);
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });
}
