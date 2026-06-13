using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// The repository-backed <see cref="ICommandsSource"/> — the native data adapter for the Commands page. One
/// logical read assembles the web page's hook composition into a single snapshot:
/// <list type="number">
///   <item>the vehicle roster from <c>GET /vehicles</c> (web <c>useVehicles</c>);</item>
///   <item>each vehicle's live state from <c>GET /vehicles/{vehicleID}/state</c> (web per-vehicle
///         <c>useQuery</c> over <c>['command-vehicle-states', …]</c>), with a per-vehicle <c>try/catch</c>
///         that resolves a failing read to <c>null</c> exactly as the web entry does (<c>catch → null</c>),
///         and — only when the state endpoint is systemically down (every roster vehicle's state read
///         failed) — a single <see cref="CommandsSnapshot.StatesError"/> message backing the web
///         <c>statesError</c> banner.</item>
/// </list>
/// The assembled <see cref="CommandsSnapshot"/> is cached as JSON so the snapshot round-trips losslessly and
/// the whole read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP
/// touches the view.
/// </summary>
public sealed class CommandsSource : ICommandsSource
{
    private const string VehiclePathParam = "vehicleID";

    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    public CommandsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<CommandsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<CommandsSnapshot>(
            CommandsRegistration.CacheKey,
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

    private async Task<CommandsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. Vehicle roster (web useVehicles). A roster failure propagates to the engine (web has no error
        //    boundary over useVehicles — the view-model maps it to the empty affordance).
        var vehiclesJson = await _api.SendAsync<JsonElement>(VehiclesRequest, cancellationToken).ConfigureAwait(false);
        var vehicles = CommandsVehicle.FromArray(vehiclesJson);
        if (vehicles.Count == 0)
        {
            return CommandsSnapshot.Empty;
        }

        // 2. Per-vehicle live state (web ['command-vehicle-states'] query). Each read is independently
        //    caught → null, exactly like the web per-vehicle try/catch.
        var states = new List<CommandsVehicleState>(vehicles.Count);
        int failures = 0;
        string? lastError = null;
        foreach (var vehicle in vehicles)
        {
            try
            {
                var stateJson = await _api.SendAsync<JsonElement>(StateRequest(vehicle.Id), cancellationToken)
                    .ConfigureAwait(false);
                states.Add(new CommandsVehicleState(vehicle.Id, CommandsLiveState.FromResponse(stateJson)));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failures++;
                lastError = ex.Message;
                states.Add(new CommandsVehicleState(vehicle.Id, null));
            }
        }

        // The web statesError banner surfaces only when the live-state read fails as a whole; a single
        // vehicle's failure is absorbed as null. Treat a total state-endpoint outage as that systemic failure.
        string? statesError = failures > 0 && failures == vehicles.Count ? lastError ?? string.Empty : null;
        return new CommandsSnapshot(vehicles, states, statesError);
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });
}
