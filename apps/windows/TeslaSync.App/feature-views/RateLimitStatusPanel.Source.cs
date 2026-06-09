using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="RateLimitStatusViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the single cache-then-network read the web component composes — the rate-limit budget snapshot (web
/// <c>useRateLimitStatus</c> → <c>GET /system/rate-limits</c>). The view never performs HTTP itself; the
/// concrete <see cref="RateLimitStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IRateLimitStatusSource
{
    /// <summary>Stream the cache-then-network rate-limit snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<RateLimitStatusSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IRateLimitStatusSource"/> — the native data adapter for the rate-limit
/// status surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a
/// typed <see cref="RateLimitStatusSnapshot"/> via <see cref="RateLimitStatusResultMapper"/>:
/// <c>GET /system/rate-limits</c> (generated operation <c>get_api_v1_system_rate_limits</c>). No HTTP touches
/// the view.
/// </summary>
public sealed class RateLimitStatusSource : IRateLimitStatusSource
{
    /// <summary>The generated OpenAPI operation id for the rate-limit status feed.</summary>
    public const string StatusOperation = "get_api_v1_system_rate_limits";

    private const string CacheKey = "system:rate-limits";

    private static readonly ApiRequest StatusRequest = new(StatusOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public RateLimitStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<RateLimitStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(StatusRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return RateLimitStatusResultMapper.Map(emission);
        }
    }

    // A null / non-object body carries no usable envelope (web parity: the query has no data → empty
    // state with no header timestamp). A valid object with an empty scopes array is NOT treated as empty
    // here: the engine keeps the payload so the header's "Updated {when}" survives, and the body's empty
    // state is derived from the zero row count downstream (web: scopes.length === 0 → empty body).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
