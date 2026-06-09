using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The repository-backed <see cref="IHeroGaugesSource"/> — the native data adapter for the charging Hero
/// Gauges surface. It runs one cache-then-network read of <c>GET /charging-sessions</c> (generated operation
/// <c>get_api_v1_charging_sessions</c>), optionally scoped to a single vehicle the same way the web
/// charging-list page scopes its <c>useChargingSessionsPaginated</c> query, caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and reduces each emission's session array into a
/// <see cref="ChargingStats"/> via <see cref="HeroGaugesResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class HeroGaugesSource : IHeroGaugesSource
{
    private const string CacheKeyPrefix = "charging:sessions:hero-gauges";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">Optional vehicle filter (web <c>vehicle_id</c>); null streams every vehicle's sessions.</param>
    public HeroGaugesSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long? vehicleId = null)
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
    public async IAsyncEnumerable<RepositoryResult<ChargingStats>> StreamAsync(
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
            yield return HeroGaugesResultMapper.Map(emission);
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
