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
/// The data port the <see cref="BatteryDegradationTrendViewModel"/> binds to (P1/S8 state-holder seam).
/// It yields the cache-then-network sequence of parsed degradation trends for
/// <c>GET /analytics/battery-degradation</c> — the native analogue of the web
/// <c>useVehicles</c> + <c>useBatteryDegradation</c> hook composition (vehicle resolution included). The
/// view never performs HTTP itself; the concrete <see cref="BatteryDegradationTrendSource"/> (or a test
/// fake) drives this.
/// </summary>
public interface IBatteryDegradationTrendSource
{
    /// <summary>Stream the cache-then-network degradation-trend snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BatteryDegradationTrend>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBatteryDegradationTrendSource"/> — the native data adapter for the
/// Battery Degradation Trend surface. It first resolves the primary vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one cache-then-network read of
/// <c>GET /analytics/battery-degradation?vehicle_id={id}</c> (generated operation
/// <c>get_api_v1_analytics_battery_degradation</c>) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="BatteryDegradationTrend"/> via <see cref="BatteryDegradationTrendResultMapper"/>. The cache
/// key matches the Battery Forecast surface's because both web hooks share the same TanStack query key
/// (<c>['battery-degradation', vehicleId]</c>) and the same endpoint body. When no vehicle is available the
/// read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class BatteryDegradationTrendSource : IBatteryDegradationTrendSource
{
    private const string Operation = "get_api_v1_analytics_battery_degradation";

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
    public BatteryDegradationTrendSource(
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
    public async IAsyncEnumerable<RepositoryResult<BatteryDegradationTrend>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useBatteryDegradation query is disabled and `data` is undefined.
            yield return RepositoryResult<BatteryDegradationTrend>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:battery-degradation:{vid}");
        var request = new ApiRequest(
            Operation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle_id"] = vid,
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
            yield return BatteryDegradationTrendResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
