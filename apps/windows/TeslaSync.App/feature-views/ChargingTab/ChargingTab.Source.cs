using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="ChargingTabViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// single cache-then-network read the web analytics page composes for the fleet aggregates — the fleet
/// analytics snapshot (web <c>useFleetAnalytics()</c> on the parent <c>AnalyticsPage</c>, whose
/// <c>charging_analytics</c> slice drives this tab). The view never performs HTTP itself; the concrete
/// <see cref="ChargingTabSource"/> (or a test fake) drives this.
/// </summary>
public interface IChargingTabSource
{
    /// <summary>Stream the cache-then-network charging-analytics snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<ChargingTabData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IChargingTabSource"/> — the native data adapter for the charging analytics
/// surface. It runs a cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a typed
/// <see cref="ChargingTabData"/> via <see cref="ChargingTabResultMapper"/>:
/// <c>GET /analytics/fleet</c> (generated operation <c>get_api_v1_analytics_fleet</c>). No HTTP touches the
/// view.
/// </summary>
public sealed class ChargingTabSource : IChargingTabSource
{
    private const string FleetAnalyticsOperation = "get_api_v1_analytics_fleet";
    private const string CacheKey = "analytics:fleet:charging";

    private static readonly ApiRequest FleetAnalyticsRequest = new(FleetAnalyticsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ChargingTabSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargingTabData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(FleetAnalyticsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargingTabResultMapper.Map(emission);
        }
    }

    // The fleet-analytics endpoint returns a populated object even when every charging list is empty; only a
    // null / non-object body carries no data at all (the per-section "no data" treatment is the projection's
    // job, decided from the parsed lists).
    private static bool IsEmptyResponse(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
}
