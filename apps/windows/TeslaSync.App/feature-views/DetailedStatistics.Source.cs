using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="DetailedStatisticsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of reduced charging-statistics snapshots for <c>GET /charging-sessions</c> —
/// the native analogue of the charging-sessions query the web Charging-History page reduces into the
/// <c>stats</c> + <c>enhanced</c> the Detailed-Statistics panel renders (web <c>useChargingSessions</c> +
/// <c>computeStats</c> / <c>computeEnhancedStats</c>). The view never performs HTTP itself; the concrete
/// <see cref="DetailedStatisticsSource"/> (or a test fake) drives this.
/// </summary>
public interface IDetailedStatisticsSource
{
    /// <summary>Stream the cache-then-network detailed-statistics snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargingDetailedStats>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDetailedStatisticsSource"/> — the native data adapter for the
/// Detailed-Statistics surface. It runs one cache-then-network read of <c>GET /charging-sessions</c> (generated
/// operation <c>get_api_v1_charging_sessions</c>), optionally scoped to a single vehicle the same way the web
/// page scopes its charging query, caching the raw JSON so the snake_case wire shape round-trips losslessly,
/// and reduces each emission's session array into a <see cref="ChargingDetailedStats"/> via
/// <see cref="DetailedStatsResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class DetailedStatisticsSource : IDetailedStatisticsSource
{
    private const string CacheKeyPrefix = "charging:sessions:detailed-statistics";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="vehicleId">Optional vehicle filter (web <c>vehicle_id</c>); null streams every vehicle's sessions.</param>
    public DetailedStatisticsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;

        _request = vehicleId is { } id
            ? new ApiRequest(
                Operations.Charging.Sessions,
                Query: new Dictionary<string, object?> { ["vehicle_id"] = id })
            : new ApiRequest(Operations.Charging.Sessions);

        _cacheKey = vehicleId is { } v
            ? string.Format(CultureInfo.InvariantCulture, "{0}:{1}", CacheKeyPrefix, v)
            : CacheKeyPrefix;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargingDetailedStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            _cacheKey,
            ct => _api.SendAsync<JsonElement>(_request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return DetailedStatsResultMapper.Map(emission);
        }
    }

    // The sessions endpoint returns a JSON array; a null/non-array body or an empty array carries no sessions
    // to summarize (web parity: the page's stats memo returns null for an empty list).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => !element.EnumerateArray().MoveNext(),
        _ => false,
    };
}
