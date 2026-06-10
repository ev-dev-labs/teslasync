using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AiUsageDetailViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined <see cref="AiUsageOverview"/> snapshots — today's rollup plus the
/// per-feature and recent breakdowns the operator card needs. The native analogue of the web card's three
/// reads (<c>useAiUsageToday</c> / <c>useAiUsageByFeature</c> / <c>useAiUsageRecent</c>), folded into one
/// stream so the cache-then-network engine can serve them stale / offline as a unit. The view never performs
/// HTTP itself; the concrete <see cref="AiUsageDetailSource"/> (or a test fake) drives this.
/// </summary>
public interface IAiUsageDetailSource
{
    /// <summary>Stream the cache-then-network usage overviews, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AiUsageOverview>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IAiUsageDetailSource"/> — the native data adapter for the operator Helix
/// usage card. One cache-then-network read composes three generated endpoints: <c>GET /ai/usage/today</c>
/// (<see cref="UsageTodayOperation"/>, the primary read that drives the card state),
/// <c>GET /ai/usage/by-feature</c> (<see cref="UsageByFeatureOperation"/>) and
/// <c>GET /ai/usage/recent?limit=10</c> (<see cref="UsageRecentOperation"/>). The two breakdown reads are
/// best-effort — a transient failure folds them to empty lists rather than failing the card, mirroring the
/// web's <c>data?.rows ?? []</c> guard; only a today failure surfaces as an error / offline state. The
/// combined overview is cached so it round-trips losslessly and can be served stale. No HTTP touches the
/// view.
/// </summary>
public sealed class AiUsageDetailSource : IAiUsageDetailSource
{
    /// <summary>
    /// The generated usage-today endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_ai_usage_today → GET /ai/usage/today</c>). The client adds the /api/v1 prefix once.
    /// </summary>
    public const string UsageTodayOperation = "get_api_v1_ai_usage_today";

    /// <summary>The generated usage-by-feature endpoint id (<c>GET /ai/usage/by-feature</c>).</summary>
    public const string UsageByFeatureOperation = "get_api_v1_ai_usage_by_feature";

    /// <summary>The generated usage-recent endpoint id (<c>GET /ai/usage/recent</c>).</summary>
    public const string UsageRecentOperation = "get_api_v1_ai_usage_recent";

    /// <summary>The stable cache key for the user-scoped combined usage overview.</summary>
    public const string CacheKey = "ai:usage:overview";

    /// <summary>The recent-call fetch limit (web <c>useAiUsageRecent(10)</c>); the card shows the top five.</summary>
    public const int RecentLimit = 10;

    private static readonly ApiRequest TodayRequest = new(UsageTodayOperation);
    private static readonly ApiRequest ByFeatureRequest = new(UsageByFeatureOperation);
    private static readonly ApiRequest RecentRequest = ApiRequest.WithQuery(UsageRecentOperation, "limit", RecentLimit);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public AiUsageDetailSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<AiUsageOverview>> StreamAsync(
        CancellationToken cancellationToken = default) =>
        _engine.StreamAsync(
            CacheKey,
            FetchOverviewAsync,
            static overview => !overview.HasUsage,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private async Task<AiUsageOverview> FetchOverviewAsync(CancellationToken cancellationToken)
    {
        // Today is the primary read: its failure must surface as an error / offline state, so it is awaited
        // directly and any fault propagates to the engine.
        var todayElement = await _api.SendAsync<JsonElement>(TodayRequest, cancellationToken).ConfigureAwait(false);
        AiUsageTodayStats? today = AiUsageTodayStats.FromResponse(todayElement);

        // The breakdowns are supplementary (web: data?.rows ?? []) — a transient failure folds to empty
        // rather than failing the whole card.
        var features = await TryFetchAsync(
            ByFeatureRequest, AiUsageFeatureStat.ListFromResponse, cancellationToken).ConfigureAwait(false);
        var recent = await TryFetchAsync(
            RecentRequest, AiUsageRecentCall.ListFromResponse, cancellationToken).ConfigureAwait(false);

        return new AiUsageOverview(today, features, recent);
    }

    private async Task<IReadOnlyList<T>> TryFetchAsync<T>(
        ApiRequest request,
        Func<JsonElement, IReadOnlyList<T>> parse,
        CancellationToken cancellationToken)
    {
        try
        {
            var element = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return parse(element);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort breakdown — drop the failure and render the card without this top-list.
            return Array.Empty<T>();
        }
    }
}
