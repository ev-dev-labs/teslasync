using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IApiUsageSource"/> — the native data adapter for the API Usage
/// surface. It runs one cache-then-network read of <c>GET /api-logs/stats</c> (generated operation
/// <c>get_api_v1_api_logs_stats</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the
/// raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into an
/// <see cref="ApiUsageStats"/> via <see cref="ApiUsageResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ApiUsageSource : IApiUsageSource
{
    private const string CacheKey = "admin:api-logs:stats";
    private static readonly ApiRequest StatsRequest = new("get_api_v1_api_logs_stats");

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ApiUsageSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ApiUsageStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(StatsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ApiUsageResultMapper.Map(emission);
        }
    }

    // Web parity: the web component gates the empty state on `!data` (an absent body) only. The backend
    // always returns a populated stats object — even an all-zero `{}`-equivalent renders as zeros, not as
    // empty — so only a null/absent payload counts as empty here.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };
}
