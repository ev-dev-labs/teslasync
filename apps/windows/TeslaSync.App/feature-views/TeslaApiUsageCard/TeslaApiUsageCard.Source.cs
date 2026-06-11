using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="TeslaApiUsageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined <see cref="TeslaApiUsageOverview"/> snapshots — the
/// <c>/system/api-usage</c> spend snapshot plus the supplementary <c>/api-logs/stats</c> rollup. The native
/// analogue of the web card's two reads (the page-level <c>getAPIUsage</c> query passed in as a prop and the
/// <c>useApiLogStats</c> hook), folded into one stream so the cache-then-network engine can serve them
/// stale / offline as a unit. The view never performs HTTP itself; the concrete
/// <see cref="TeslaApiUsageSource"/> (or a test fake) drives this.
/// </summary>
public interface ITeslaApiUsageSource
{
    /// <summary>Stream the cache-then-network usage overviews, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<TeslaApiUsageOverview>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITeslaApiUsageSource"/> — the native data adapter for the Tesla Fleet API
/// usage card. One cache-then-network read composes two generated endpoints: <c>GET /system/api-usage</c>
/// (<see cref="ApiUsageOperation"/>, the primary read that drives the card state) and
/// <c>GET /api-logs/stats</c> (<see cref="ApiLogStatsOperation"/>). The api-usage read is awaited directly so
/// its failure surfaces as an error / offline state; the call-log stats read is best-effort — a transient
/// failure folds it to null rather than failing the card, mirroring the web's optional <c>useApiLogStats</c>
/// query (every <c>logStats?.</c> access degrades to an em-dash). The combined overview is cached so it
/// round-trips losslessly and can be served stale. No HTTP touches the view.
/// </summary>
public sealed class TeslaApiUsageSource : ITeslaApiUsageSource
{
    /// <summary>
    /// The generated api-usage endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_system_api_usage → GET /system/api-usage</c>). The client adds the /api/v1 prefix once.
    /// </summary>
    public const string ApiUsageOperation = "get_api_v1_system_api_usage";

    /// <summary>The generated api-logs-stats endpoint id (<c>GET /api-logs/stats</c>).</summary>
    public const string ApiLogStatsOperation = "get_api_v1_api_logs_stats";

    /// <summary>The stable cache key for the combined usage overview.</summary>
    public const string CacheKey = "system:api-usage:overview";

    private static readonly ApiRequest ApiUsageRequest = new(ApiUsageOperation);
    private static readonly ApiRequest ApiLogStatsRequest = new(ApiLogStatsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public TeslaApiUsageSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<TeslaApiUsageOverview>> StreamAsync(
        CancellationToken cancellationToken = default) =>
        _engine.StreamAsync(
            CacheKey,
            FetchOverviewAsync,
            static overview => !overview.HasUsage,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private async Task<TeslaApiUsageOverview> FetchOverviewAsync(CancellationToken cancellationToken)
    {
        // The spend snapshot is the primary read: its failure must surface as an error / offline state, so it
        // is awaited directly and any fault propagates to the engine.
        var usageElement = await _api.SendAsync<JsonElement>(ApiUsageRequest, cancellationToken).ConfigureAwait(false);
        ApiUsageSnapshot? snapshot = ApiUsageSnapshot.FromResponse(usageElement);

        // The call-log stats are supplementary (web: every logStats?. access is optional) — a transient
        // failure folds to null rather than failing the whole card.
        ApiLogStats? stats = await TryFetchStatsAsync(cancellationToken).ConfigureAwait(false);

        return new TeslaApiUsageOverview(snapshot, stats);
    }

    private async Task<ApiLogStats?> TryFetchStatsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var element = await _api.SendAsync<JsonElement>(ApiLogStatsRequest, cancellationToken).ConfigureAwait(false);
            return ApiLogStats.FromResponse(element);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort breakdown — drop the failure and render the card without the call-log layer.
            return null;
        }
    }
}
