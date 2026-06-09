using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="DrivingPerformanceCardsViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed drive-analytics snapshots from <c>GET /analytics/fleet</c>
/// — the native analogue of the web analytics page's <c>useFleetAnalytics</c> read whose
/// <c>data.drive_analytics</c> the web <c>DrivingPerformanceCards</c> consumes as a prop. The view never
/// performs HTTP itself; the concrete <see cref="DrivingPerformanceCardsSource"/> (or a test fake) drives this.
/// </summary>
public interface IDrivingPerformanceCardsSource
{
    /// <summary>Stream the cache-then-network drive-analytics snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DrivingPerformanceSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDrivingPerformanceCardsSource"/> — the native data adapter for the
/// Driving Performance Cards surface. It runs one cache-then-network read of <c>GET /analytics/fleet</c>
/// (generated operation <c>get_api_v1_analytics_fleet</c>) with the same trailing
/// <c>days=30</c> window the web analytics page requests
/// (<see cref="DrivingPerformanceCardsRegistration.DefaultDays"/>), caching the raw JSON so the snake_case
/// wire shape round-trips losslessly, and parses each emission into a
/// <see cref="DrivingPerformanceSnapshot"/> via <see cref="DrivingPerformanceResultMapper"/>. No HTTP touches
/// the view.
/// </summary>
public sealed class DrivingPerformanceCardsSource : IDrivingPerformanceCardsSource
{
    private const string CacheKey = "analytics:fleet:driving";

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = DrivingPerformanceCardsRegistration.DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public DrivingPerformanceCardsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DrivingPerformanceSnapshot>> StreamAsync(
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
            yield return DrivingPerformanceResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
