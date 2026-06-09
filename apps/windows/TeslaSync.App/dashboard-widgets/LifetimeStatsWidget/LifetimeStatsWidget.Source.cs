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
/// The repository-backed <see cref="ILifetimeStatsSource"/> — the native data adapter for the Lifetime
/// Stats surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one
/// cache-then-network read of <c>GET /analytics/lifetime</c> (generated operation
/// <c>get_api_v1_analytics_lifetime</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="LifetimeStats"/> via <see cref="LifetimeStatsResultMapper"/>.
/// <para>
/// Unlike the vehicle-disabled widgets, the web <c>useLifetimeStats</c> hook has no <c>enabled</c> gate —
/// the request always runs, with the <c>vehicle_id</c> query appended only when a vehicle is available
/// (otherwise the endpoint returns the fleet-wide rollup). This source reproduces that exactly: the
/// <c>vehicle_id</c> parameter is added when (and only when) a vehicle resolves; the read is never
/// short-circuited. No HTTP touches the view.
/// </para>
/// </summary>
public sealed class LifetimeStatsSource : ILifetimeStatsSource
{
    private const string Operation = "get_api_v1_analytics_lifetime";

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
    public LifetimeStatsSource(
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
    public async IAsyncEnumerable<RepositoryResult<LifetimeStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        var query = new Dictionary<string, object?>(StringComparer.Ordinal);
        string cacheKey;
        if (vehicleId is { } vid)
        {
            query["vehicle_id"] = vid;
            cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:lifetime:{vid}");
        }
        else
        {
            // Web parity: with no vehicle the query still runs, returning the fleet-wide lifetime rollup.
            cacheKey = "analytics:lifetime:all";
        }

        var request = new ApiRequest(Operation, Query: query);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return LifetimeStatsResultMapper.Map(emission);
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
