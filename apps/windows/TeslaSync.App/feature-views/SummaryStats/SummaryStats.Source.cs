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
/// The data port the <see cref="SummaryStatsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed motor-history samples for the supplied (or primary) vehicle — the
/// native analogue of the web Driving-Dynamics page's <c>useMotorHistory(vehicleId, 200)</c> read whose result
/// the page reduces with <c>computeMotorStats</c> before passing into
/// <c>&lt;SummaryStats motorStats={…} /&gt;</c>
/// (web/src/features/driving/pages/DrivingDynamicsPage.tsx + components/driving-dynamics/SummaryStats.tsx). The
/// view never performs HTTP itself; the concrete <see cref="MotorSummarySource"/> (or a test fake) drives this.
/// </summary>
public interface IMotorSummarySource
{
    /// <summary>Stream the cache-then-network motor-history snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorStatsSample>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMotorSummarySource"/> — the native data adapter for the Driving-Dynamics
/// summary surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web page's selected vehicle), then runs one cache-then-network read of the
/// motor-history list (<c>GET /motor?vehicle_id={id}&amp;limit={limit}</c>, generated operation
/// <c>get_api_v1_motor</c>, the web <c>useMotorHistory</c> query) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into <see cref="MotorStatsSample"/> rows via
/// <see cref="MotorSummaryResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class MotorSummarySource : IMotorSummarySource
{
    // The web's useMotorHistory reads /motor; the generated endpoint table exposes this id but Operations.cs
    // carries no Motor group, so it is referenced verbatim here (scoped to this surface), exactly as the sibling
    // TorqueHistoryChartSource does. It resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string MotorHistoryOperation = "get_api_v1_motor";
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    /// <summary>The default history window the web page requests (<c>useMotorHistory(vehicleId, 200)</c>).</summary>
    public const int DefaultLimit = 200;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly int _limit;

    /// <summary>Creates the source over the vehicle source, contract client, engine, JSON settings and window.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="limit">The history window (web <c>limit</c>); defaults to <see cref="DefaultLimit"/>.</param>
    public MotorSummarySource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        int limit = DefaultLimit)
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
        _limit = limit > 0 ? limit : DefaultLimit;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorStatsSample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useMotorHistory query is disabled and `motorHistory` is undefined.
            yield return RepositoryResult<IReadOnlyList<MotorStatsSample>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:motor-summary:{_limit}");
        var request = new ApiRequest(
            MotorHistoryOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                [LimitQueryParam] = _limit,
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
            yield return MotorSummaryResultMapper.Map(emission);
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

    // The motor-history endpoint returns an array; a null body or an empty array carries no samples to aggregate.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
