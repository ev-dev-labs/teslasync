using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="DrivingTemperatureStatsViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed temperature snapshots for <c>GET /analytics/fleet</c> —
/// the native analogue of the fleet-analytics query (web <c>useFleetAnalytics</c>) whose result the web
/// <c>DrivingTemperatureStats</c> receives as its <c>data</c> prop. The view never performs HTTP itself; the
/// concrete <see cref="DrivingTemperatureStatsSource"/> (or a test fake) drives this.
/// </summary>
public interface IDrivingTemperatureStatsSource
{
    /// <summary>Stream the cache-then-network temperature snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<DrivingTemperatureSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDrivingTemperatureStatsSource"/> — the native data adapter for the
/// Driving Temperature Stats surface. It runs one cache-then-network read of <c>GET /analytics/fleet</c>
/// (generated operation via <see cref="Operations.Analytics.Fleet"/>) with the same trailing
/// <c>days=30</c> window the web fleet-analytics query requests, caching the raw JSON so the snake_case wire
/// shape round-trips losslessly, and parses each emission into a <see cref="DrivingTemperatureSnapshot"/>
/// via <see cref="DrivingTemperatureStatsResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class DrivingTemperatureStatsSource : IDrivingTemperatureStatsSource
{
    /// <summary>The trailing window the surface requests (web fleet-analytics <c>days = 30</c> default).</summary>
    public const int DefaultDays = 30;

    private const string CacheKey = "analytics:fleet:driving-temperature";

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network engine.</param>
    /// <param name="options">The API client options (provides JSON settings).</param>
    public DrivingTemperatureStatsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DrivingTemperatureSnapshot>> StreamAsync(
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
            yield return DrivingTemperatureStatsResultMapper.Map(emission);
        }
    }

    // A null / non-object body carries no envelope; a populated object that simply lacks a temperature block
    // is NOT empty here (it is parsed and the empty state is derived downstream from the snapshot's HasData,
    // exactly like the web component's insideTemp || outsideTemp gate).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
