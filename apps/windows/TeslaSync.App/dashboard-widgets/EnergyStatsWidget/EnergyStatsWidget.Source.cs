using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="EnergyStatsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed energy summaries for the primary (or explicit) vehicle — the native
/// analogue of the web <c>useVehicles</c> + <c>useEnergyStats</c> hook composition
/// (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="EnergyStatsSource"/> (or a test fake) drives this.
/// </summary>
public interface IEnergyStatsSource
{
    /// <summary>Stream the cache-then-network energy-summary snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<EnergyStatsData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IEnergyStatsSource"/> — the native data adapter for the Energy Stats
/// surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one
/// cache-then-network read of <c>GET /vehicles/{vehicleID}/energy?days=30</c> (generated operation
/// <c>get_api_v1_vehicles_vehicleID_energy</c>, scoped by the <c>vehicleID</c> path parameter and the
/// <c>days</c> query the web hook defaults to) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into an
/// <see cref="EnergyStatsData"/> via <see cref="EnergyStatsResultMapper"/>. When no vehicle is available the
/// read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class EnergyStatsSource : IEnergyStatsSource
{
    // Generated operation id (TeslaSync.App.Core.Data.Net.Operations.Vehicles.Energy); asserted by the source tests.
    private const string Operation = "get_api_v1_vehicles_vehicleID_energy";
    private const string VehiclePathParam = "vehicleID";
    private const string DaysQueryParam = "days";

    /// <summary>The trailing window in days the web <c>useEnergyStats</c> hook defaults to.</summary>
    public const int DaysWindow = 30;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public EnergyStatsSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergyStatsData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useEnergyStats query is disabled and `data` is undefined.
            yield return RepositoryResult<EnergyStatsData>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:energy-stats:{DaysWindow}");
        var request = new ApiRequest(
            Operation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [DaysQueryParam] = DaysWindow,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergyStatsResultMapper.Map(emission);
        }
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    // Web parity: an absent/non-object body collapses to the empty surface (web `!data`).
    private static bool IsEmptyResponse(JsonElement element) => EnergyStatsData.FromResponse(element) is null;
}
