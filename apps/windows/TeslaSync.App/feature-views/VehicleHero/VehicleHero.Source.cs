using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="VehicleHeroViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of resolved <see cref="VehicleHeroData"/> snapshots — the native analogue of the
/// props the dashboard <c>VehicleHeroWidget</c> assembles from <c>useVehicles</c> + <c>useVehicleState</c>
/// before handing them to <c>&lt;VehicleHero /&gt;</c> (web/src/features/dashboard/widgets/VehicleHeroWidget.tsx).
/// The view never performs HTTP itself; the concrete <see cref="VehicleHeroSource"/> (or a test fake) drives
/// this.
/// </summary>
public interface IVehicleHeroSource
{
    /// <summary>Stream the cache-then-network hero snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<VehicleHeroData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVehicleHeroSource"/> — the native data adapter for the Vehicle Hero
/// surface. One logical read resolves the primary (or explicit) vehicle from <c>GET /vehicles</c> (web
/// <c>useVehicles</c>, selecting <c>vehicleId ? find ?? [0] : [0]</c>), then reads that vehicle's live state
/// from <c>GET /vehicles/{vehicleID}/state</c> (web <c>useVehicleState</c>). The assembled
/// <see cref="VehicleHeroData"/> is cached as JSON so the snapshot round-trips losslessly and the whole read
/// replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. When no vehicle resolves
/// the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's
/// <c>{vehicle ? … : null}</c> gate. No HTTP touches the view.
/// </summary>
public sealed class VehicleHeroSource : IVehicleHeroSource
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
    public VehicleHeroSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
        _cacheKey = vehicleId is { } id
            ? string.Create(CultureInfo.InvariantCulture, $"dashboard:vehicle-hero:{id}")
            : "dashboard:vehicle-hero:primary";
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleHeroData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<VehicleHeroData>(
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

    private async Task<VehicleHeroData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The vehicle roster resolves the hero's vehicle (web vehicles.find(...) ?? vehicles[0]).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        var vehicle = VehicleHeroVehicle.FromVehiclesArray(vehicles, _vehicleId);
        if (vehicle is null)
        {
            // Web parity: with no vehicle the widget renders nothing — the native surface shows its empty state.
            return VehicleHeroData.Empty;
        }

        // 2. That vehicle's live state drives the gauges / stats / charging panel (web useVehicleState). A
        //    stateless body parses to null telemetry — the asleep panel — rather than failing the read.
        var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vehicle.Id), cancellationToken)
            .ConfigureAwait(false);
        var telemetry = VehicleHeroTelemetry.FromResponse(stateJson);
        return new VehicleHeroData(vehicle, telemetry);
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });
}
