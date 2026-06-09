using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="ChargingDetailViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed charging-analytics snapshots for <c>GET /analytics/fleet</c> — the
/// native analogue of the fleet-analytics query the web analytics page feeds into the Charging-detail
/// section (web <c>useFleetAnalytics</c>). The view never performs HTTP itself; the concrete
/// <see cref="ChargingDetailSource"/> (or a test fake) drives this.
/// </summary>
public interface IChargingDetailSource
{
    /// <summary>Stream the cache-then-network charging-analytics snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargingDetailAnalytics>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IChargingDetailSource"/> — the native data adapter for the
/// Charging-detail surface. It runs one cache-then-network read of <c>GET /analytics/fleet</c> (generated
/// operation <c>get_api_v1_analytics_fleet</c>) with the same trailing
/// <c>days=30</c> window the dashboard fleet-analytics widgets request
/// (<see cref="ChargingDetailRegistration.DefaultDays"/>), caching the raw JSON so the snake_case wire shape
/// round-trips losslessly, and parses each emission's <c>charging_analytics</c> child into a
/// <see cref="ChargingDetailAnalytics"/> via <see cref="ChargingDetailResultMapper"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class ChargingDetailSource : IChargingDetailSource
{
    private const string CacheKey = "analytics:fleet:charging-detail";

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = ChargingDetailRegistration.DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ChargingDetailSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargingDetailAnalytics>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(FleetRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargingDetailResultMapper.Map(emission);
        }
    }

    // The fleet endpoint returns a populated object; a null/non-object body or an empty object carries no
    // charging analytics to show.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
