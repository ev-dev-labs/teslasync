using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SpeedTrendChartViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed charging-session lists for the supplied vehicle — the native
/// analogue of the web Charging-Curve page's <c>useChargingSessionsPaginated(vehicleId, …)</c> read whose
/// <c>sessions</c> it passes into <c>SpeedTrendChart</c>
/// (web/src/features/charging/pages/ChargingCurvePage.tsx + components/charging-curve/SpeedTrendChart.tsx).
/// The view never performs HTTP itself; the concrete <see cref="SpeedTrendChartSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ISpeedTrendChartSource
{
    /// <summary>Stream the cache-then-network charging-session snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedTrendSession>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISpeedTrendChartSource"/> — the native data adapter for the Charging
/// Speed Trend surface. It runs one cache-then-network read of the charging-sessions list (generated
/// operation <c>get_api_v1_charging_sessions</c>, scoped by <c>vehicle_id</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/> for the selected vehicle — the native analogue of the web page's
/// <c>useSelectedVehicle()</c>-scoped <c>useChargingSessionsPaginated</c> read — caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and parses each emission into <see cref="SpeedTrendSession"/>
/// rows via <see cref="SpeedTrendChartResultMapper"/>. The whole history is fetched and bucketed by month at
/// projection time (the monthly trend wants every session, not a recent window). When no vehicle is supplied
/// the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class SpeedTrendChartSource : ISpeedTrendChartSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and vehicle.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">The vehicle to scope the sessions to; when null the read streams empty.</param>
    public SpeedTrendChartSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SpeedTrendSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (_vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the charging query is disabled and `sessions` is undefined.
            yield return RepositoryResult<IReadOnlyList<SpeedTrendSession>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:speed-trend");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
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
            yield return SpeedTrendChartResultMapper.Map(emission);
        }
    }

    // The charging-sessions endpoint returns an array; a null body or an empty array carries nothing to chart.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
