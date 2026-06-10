using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="OptimizerSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed optimizer reports for the primary (or explicit) vehicle — the
/// native analogue of the web charging-list section's <c>useChargingOptimizer(vehicleId)</c> hook whose
/// result feeds the <c>&lt;OptimizerSection optimizer={…} /&gt;</c> composition
/// (web/src/features/charging/components/charging-list/OptimizerSection.tsx). The view never performs HTTP
/// itself; the concrete <see cref="OptimizerSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IOptimizerSectionSource
{
    /// <summary>Stream the cache-then-network optimizer snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<OptimizerSectionReport>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IOptimizerSectionSource"/> — the native data adapter for the Optimizer
/// section. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web hook's <c>vehicleId</c> scope), then runs one cache-then-network read of
/// <c>GET /analytics/charging-optimizer?vehicle_id={id}</c> (generated operation
/// <c>get_api_v1_analytics_charging_optimizer</c>) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into an
/// <see cref="OptimizerSectionReport"/> via <see cref="OptimizerSectionResultMapper"/>. It shares the
/// <c>analytics:charging-optimizer:{id}</c> cache key with the sibling optimizer surfaces so the read is
/// de-duplicated. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class OptimizerSectionSource : IOptimizerSectionSource
{
    /// <summary>Generated operation id for <c>GET /analytics/charging-optimizer</c>.</summary>
    public const string OperationId = "get_api_v1_analytics_charging_optimizer";

    private const string VehicleQueryParam = "vehicle_id";

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
    public OptimizerSectionSource(
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
    public async IAsyncEnumerable<RepositoryResult<OptimizerSectionReport>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the optimizer query is disabled and `data` is undefined.
            yield return RepositoryResult<OptimizerSectionReport>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:charging-optimizer:{vid}");
        var request = new ApiRequest(
            OperationId,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
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
            yield return OptimizerSectionResultMapper.Map(emission);
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
        JsonValueKind.Array => element.GetArrayLength() == 0,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
