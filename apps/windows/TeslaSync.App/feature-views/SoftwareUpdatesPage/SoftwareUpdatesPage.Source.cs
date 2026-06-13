using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The data port the <see cref="SoftwareUpdatesPageViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of resolved <see cref="SoftwareUpdatesSnapshot"/> readings — the native
/// analogue of the web page's <c>useSelectedVehicle</c> + <c>useSoftwareUpdates</c> composition
/// (web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SoftwareUpdatesSource"/> (or a test fake) drives this.
/// </summary>
public interface ISoftwareUpdatesSource
{
    /// <summary>Stream the cache-then-network software-update snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<SoftwareUpdatesSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISoftwareUpdatesSource"/> — the native data adapter for the Software
/// Updates page. One logical read assembles the web page's two hooks into a single snapshot:
/// <list type="number">
///   <item>the vehicle roster from <c>GET /vehicles</c> (web <c>useSelectedVehicle().vehicles</c>), selecting
///         <c>vehicles[0]</c> as the page's selected vehicle;</item>
///   <item>that vehicle's update list from <c>GET /software-updates?vehicle_id={id}&amp;limit=50&amp;offset=0</c>
///         (web <c>useSoftwareUpdates</c>, whose query is <c>enabled: vehicleId !== null</c>).</item>
/// </list>
/// When no vehicle resolves the read short-circuits to the empty snapshot (the web's disabled query). The
/// assembled <see cref="SoftwareUpdatesSnapshot"/> is cached as JSON so the snake_case wire shape round-trips
/// losslessly and the whole read replays cache-then-network through the shared
/// <see cref="CacheThenNetworkEngine"/>. No HTTP touches the view.
/// </summary>
public sealed class SoftwareUpdatesSource : ISoftwareUpdatesSource
{
    private const string SoftwareUpdatesOperation = "get_api_v1_software_updates";
    private const string VehicleIdQuery = "vehicle_id";
    private const string LimitQuery = "limit";
    private const string OffsetQuery = "offset";

    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    public SoftwareUpdatesSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SoftwareUpdatesSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<SoftwareUpdatesSnapshot>(
            SoftwareUpdatesRegistration.CacheKeyPrefix,
            FetchAsync,
            static snapshot => !snapshot.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<SoftwareUpdatesSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. Vehicle roster → the page's selected vehicle (web useSelectedVehicle, vehicles[0]).
        var vehiclesJson = await _api.SendAsync<JsonElement>(VehiclesRequest, cancellationToken).ConfigureAwait(false);
        var roster = SoftwareUpdateVehicle.ParseRoster(vehiclesJson);
        if (roster.Count == 0)
        {
            // Web parity: with no vehicle the useSoftwareUpdates query is disabled and `data` is undefined.
            return SoftwareUpdatesSnapshot.Empty;
        }

        // 2. The selected vehicle's update history (web useSoftwareUpdates, scoped to vehicle_id).
        long selectedVehicleId = roster[0].Id;
        var updatesJson = await _api.SendAsync<JsonElement>(UpdatesRequest(selectedVehicleId), cancellationToken).ConfigureAwait(false);
        var updates = SoftwareUpdateEntry.ParseList(updatesJson);

        return new SoftwareUpdatesSnapshot(updates, roster);
    }

    private static ApiRequest UpdatesRequest(long vehicleId) => new(
        SoftwareUpdatesOperation,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleIdQuery] = vehicleId,
            [LimitQuery] = SoftwareUpdatesRegistration.PageSize,
            [OffsetQuery] = 0,
        });
}

/// <summary>
/// The default <see cref="ISoftwareUpdatesSource"/> — resolves every read to the empty snapshot (the empty data
/// state). The shell uses this until a host wires the generated-client-backed
/// <see cref="SoftwareUpdatesSource"/>.
/// </summary>
public sealed class EmptySoftwareUpdatesSource : ISoftwareUpdatesSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySoftwareUpdatesSource Instance { get; } = new();

    private EmptySoftwareUpdatesSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SoftwareUpdatesSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<SoftwareUpdatesSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
