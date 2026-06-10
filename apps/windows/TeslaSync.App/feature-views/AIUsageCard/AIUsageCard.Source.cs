using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="AiUsageCardViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed usage snapshots from <c>GET /ai/usage/today</c> — the native
/// analogue of the web card's <c>useAiUsageToday</c> read (TanStack Query polled at
/// <c>INTERVALS.STANDARD</c>). The view never performs HTTP itself; the concrete
/// <see cref="AiUsageTodaySource"/> (or a test fake) drives this.
/// </summary>
public interface IAiUsageTodaySource
{
    /// <summary>Stream the cache-then-network usage snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AiUsageToday>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IAiUsageTodaySource"/> — the native data adapter for the Helix usage card.
/// It runs one cache-then-network read of <c>GET /ai/usage/today</c> (generated operation
/// <see cref="UsageTodayOperation"/>) for the calling user — the native analogue of the web
/// <c>useAiUsageToday</c> hook, whose <c>__usage__</c> meta-feature guard makes it safe to call even when no AI
/// feature is enabled (the response is all-zeros until something is audited). The raw JSON is cached so the
/// snake_case wire shape round-trips losslessly, and each emission is parsed into an <see cref="AiUsageToday"/>
/// via <see cref="AiUsageResultMapper"/>. No path or query parameters are sent — the endpoint is user-scoped
/// server-side. No HTTP touches the view.
/// </summary>
public sealed class AiUsageTodaySource : IAiUsageTodaySource
{
    /// <summary>
    /// The generated usage-today endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_ai_usage_today → GET /ai/usage/today</c>). The request() client auto-adds the /api/v1
    /// prefix.
    /// </summary>
    public const string UsageTodayOperation = "get_api_v1_ai_usage_today";

    /// <summary>The stable cache key for the user-scoped usage-today read.</summary>
    public const string CacheKey = "ai:usage:today";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public AiUsageTodaySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AiUsageToday>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(UsageTodayOperation);

        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AiUsageResultMapper.Map(emission);
        }
    }

    // Web parity: a non-object body (data falsy) collapses to the empty surface.
    private static bool IsEmptyResponse(JsonElement element) => AiUsageToday.FromResponse(element) is null;
}
