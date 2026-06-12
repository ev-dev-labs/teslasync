using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The repository-backed <see cref="IQuickStatsSource"/> — the native data adapter for the Quick Stats page.
/// One logical read assembles the web page's three hooks into a single snapshot:
/// <list type="number">
///   <item>the vehicle roster from <c>GET /vehicles</c> (web <c>useVehicles</c>), selecting <c>vehicles[0]</c>;</item>
///   <item>that vehicle's live state from <c>GET /vehicles/{vehicleID}/state</c> (web <c>useVehicleState</c>),
///         skipped when no vehicle resolves;</item>
///   <item>the fleet rollup from <c>GET /analytics/fleet?days=30</c> (web <c>useAnalyticsSummary(30)</c>).</item>
/// </list>
/// The assembled <see cref="QuickStatsSnapshot"/> is cached as JSON so the snapshot round-trips losslessly and
/// the whole read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP
/// touches the view.
/// </summary>
public sealed class QuickStatsSource : IQuickStatsSource
{
    private const string VehiclePathParam = "vehicleID";

    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = QuickStatsRegistration.AnalyticsDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    public QuickStatsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<QuickStatsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<QuickStatsSnapshot>(
            QuickStatsRegistration.CacheKey,
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

    private async Task<QuickStatsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. Vehicle roster → the page's primary vehicle (web useVehicles, vehicles?.[0]).
        var vehiclesJson = await _api.SendAsync<JsonElement>(VehiclesRequest, cancellationToken).ConfigureAwait(false);
        var vehicle = QuickStatsVehicle.FromVehiclesArray(vehiclesJson);

        // 2. That vehicle's live state (web useVehicleState(vehicle?.id ?? 0)) — only when a vehicle resolved.
        QuickStatsLiveState? state = null;
        if (vehicle is { } v && v.Id > 0)
        {
            var stateJson = await _api.SendAsync<JsonElement>(StateRequest(v.Id), cancellationToken).ConfigureAwait(false);
            state = QuickStatsLiveState.FromResponse(stateJson);
        }

        // 3. Fleet analytics rollup (web useAnalyticsSummary(30)).
        var analyticsJson = await _api.SendAsync<JsonElement>(FleetRequest, cancellationToken).ConfigureAwait(false);
        var analytics = QuickStatsAnalytics.FromJson(analyticsJson);

        return new QuickStatsSnapshot(vehicle, state, analytics);
    }

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });
}
