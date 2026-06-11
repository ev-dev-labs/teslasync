using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="VehicleHeaderViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// two operations the web header composes through its hooks: a cache-then-network read of the resolved vehicle
/// plus its live state (web <c>useVehicles</c> + the page's <c>useVehicleState</c>, fed to the header as
/// <c>{ vehicle, state }</c> props), and the fire-once wake mutation (web <c>useWakeVehicle</c> →
/// <c>POST /vehicles/{id}/wake</c>). The view never performs HTTP itself; the concrete
/// <see cref="VehicleHeaderSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleHeaderSource
{
    /// <summary>Stream the cache-then-network header snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<VehicleHeaderData>> StreamAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Send the wake command for <paramref name="vehicleId"/> (the wake mutation). Returns a classified
    /// outcome on success or failure — it never throws for an HTTP fault (web parity: the mutation resolves to
    /// a toast, not an unhandled rejection).
    /// </summary>
    /// <param name="vehicleId">The vehicle's database id (web <c>vehicle.id</c>).</param>
    /// <param name="cancellationToken">Cancels the in-flight wake command.</param>
    /// <returns>The wake outcome.</returns>
    Task<VehicleHeaderWakeOutcome> WakeAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVehicleHeaderSource"/> — the native data adapter for the vehicle header.
/// One logical read resolves the primary (or explicit) vehicle from <c>GET /vehicles</c> (web
/// <c>useVehicles</c>, selecting <c>vehicleId ? find ?? [0] : [0]</c>), then reads that vehicle's live state
/// from <c>GET /vehicles/{vehicleID}/state</c> (the page's <c>useVehicleState</c>). The assembled
/// <see cref="VehicleHeaderData"/> is cached as JSON so the snapshot round-trips losslessly and the whole read
/// replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. When no vehicle resolves
/// the read short-circuits to the empty snapshot, mirroring the web's <c>{vehicle ? … : null}</c> gate. The
/// wake mutation posts to the generated <c>post_api_v1_vehicles_vehicleID_wake</c> operation and classifies any
/// fault through the shared <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class VehicleHeaderSource : IVehicleHeaderSource
{
    /// <summary>The generated OpenAPI operation id for the wake mutation (<c>POST /vehicles/{vehicleID}/wake</c>).</summary>
    public const string WakeOperation = "post_api_v1_vehicles_vehicleID_wake";

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
    public VehicleHeaderSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
        _cacheKey = vehicleId is { } id
            ? string.Create(CultureInfo.InvariantCulture, $"vehicles:vehicle-header:{id}")
            : "vehicles:vehicle-header:primary";
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VehicleHeaderData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<VehicleHeaderData>(
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

    /// <inheritdoc />
    public async Task<VehicleHeaderWakeOutcome> WakeAsync(long vehicleId, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            WakeOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        try
        {
            await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return VehicleHeaderWakeOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return VehicleHeaderWakeOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return VehicleHeaderWakeOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    private async Task<VehicleHeaderData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The vehicle roster resolves the header's vehicle (web vehicles.find(...) ?? vehicles[0]).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        var vehicle = VehicleHeaderVehicle.FromVehiclesArray(vehicles, _vehicleId);
        if (vehicle is null)
        {
            // Web parity: with no vehicle the page renders nothing — the native surface shows its empty state.
            return VehicleHeaderData.Empty;
        }

        // 2. That vehicle's live state drives the status badge (web useVehicleState). A stateless body parses
        //    to null telemetry — the derivation resolves it to offline — rather than failing the read.
        var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vehicle.Id), cancellationToken)
            .ConfigureAwait(false);
        var telemetry = VehicleHeaderTelemetry.FromResponse(stateJson);
        return new VehicleHeaderData(vehicle, telemetry);
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });
}
