using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.BatteryComparison;

/// <summary>
/// The data port the <see cref="BatteryComparisonViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of assembled <see cref="BatteryComparisonData"/> snapshots — the native
/// analogue of the web component's <c>useQuery(['fleet-battery-states', …])</c> that maps each vehicle to a
/// <c>fetchVehicleState</c> read (web/src/features/vehicles/components/BatteryComparison.tsx). The view never
/// performs HTTP itself; the concrete <see cref="BatteryComparisonSource"/> (or a test fake) drives this.
/// </summary>
public interface IBatteryComparisonSource
{
    /// <summary>Stream the cache-then-network fleet-battery snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BatteryComparisonData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBatteryComparisonSource"/> — the native data adapter for the fleet
/// battery comparison. One logical read fans out, through the shared generated contract client, to the same
/// endpoints the web component reads: <c>GET /vehicles</c> for the roster (the web <c>vehicles</c> prop, here
/// fetched so the surface is self-contained), then one <c>GET /vehicles/{id}/state</c> per vehicle — run
/// concurrently exactly as the web <c>Promise.all(vehicles.map(fetchVehicleState))</c> does. A per-vehicle
/// read that fails leaves that vehicle out (web's <c>catch</c> returns a null state that is filtered). The
/// assembled <see cref="BatteryComparisonData"/> is cached as JSON so the snapshot round-trips losslessly and
/// the whole read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP
/// touches the view.
/// </summary>
public sealed class BatteryComparisonSource : IBatteryComparisonSource
{
    private const string CacheKey = "vehicles:battery-comparison";
    private const string VehiclePathParam = "vehicleID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public BatteryComparisonSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BatteryComparisonData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<BatteryComparisonData>(
            CacheKey,
            FetchAsync,
            static data => !data.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<BatteryComparisonData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The roster gives every vehicle the battery bars are drawn for (web: the vehicles prop).
        var vehiclesJson = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        var refs = BatteryComparisonData.ParseVehicles(vehiclesJson);
        if (refs.Count == 0)
        {
            return BatteryComparisonData.Empty;
        }

        // 2. One state read per vehicle, run concurrently (web: Promise.all over vehicles.map(fetchVehicleState)).
        var tasks = new Task<BatteryComparisonRow?>[refs.Count];
        for (int i = 0; i < refs.Count; i++)
        {
            tasks[i] = StateRowAsync(refs[i], cancellationToken);
        }

        var resolved = await Task.WhenAll(tasks).ConfigureAwait(false);

        // 3. Keep the resolved rows in roster order, dropping the vehicles whose state read failed or was empty.
        var rows = new List<BatteryComparisonRow>(resolved.Length);
        foreach (var row in resolved)
        {
            if (row is not null)
            {
                rows.Add(row);
            }
        }

        return new BatteryComparisonData(rows);
    }

    private async Task<BatteryComparisonRow?> StateRowAsync(VehicleRef vehicle, CancellationToken cancellationToken)
    {
        try
        {
            var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vehicle.Id), cancellationToken)
                .ConfigureAwait(false);
            return BatteryComparisonData.ParseStateRow(vehicle, stateJson);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web parity: a failed per-vehicle state read leaves that vehicle out of the comparison rather than
            // failing the whole surface (the web fetchVehicleState catch returns a null state, then filtered).
            return null;
        }
    }

    private static ApiRequest StateRequest(long vehicleId) => ApiRequest.WithPath(
        Operations.Vehicles.State,
        VehiclePathParam,
        vehicleId.ToString(CultureInfo.InvariantCulture));
}
