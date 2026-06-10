using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The data port the <see cref="FeatureTogglesViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// two operations the web component composes — the cache-then-network read of the Tesla feature config (web
/// <c>useTeslaFeatureConfig</c> → <c>GET /tesla/user/feature-config</c>) and the refresh mutation (web
/// <c>useRefreshTeslaFeatureConfig</c> → <c>POST /tesla/user/feature-config/refresh</c>). The view never
/// performs HTTP itself; the concrete <see cref="FeatureTogglesSource"/> (or a test fake) drives this.
/// </summary>
public interface IFeatureTogglesSource
{
    /// <summary>Stream the cache-then-network feature-config snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> StreamConfigAsync(
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Run the refresh mutation, asking the backend to re-pull the feature config from Tesla. Never throws for
    /// an API failure — it maps the fault to a classified <see cref="FeatureConfigRefreshOutcome"/> (the web
    /// mutation's <c>onError</c> path) — but propagates <see cref="OperationCanceledException"/> so a
    /// superseding run can cancel.
    /// </summary>
    Task<FeatureConfigRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFeatureTogglesSource"/> — the native data adapter for the feature-toggles
/// surface. The read runs one cache-then-network pass through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case envelope round-trips losslessly, then maps each emission to a typed
/// <see cref="FeatureConfigSnapshot"/> via <see cref="FeatureTogglesResultMapper"/> (generated operation
/// <c>get_api_v1_tesla_user_feature_config</c>). The refresh sends the write operation
/// <c>post_api_v1_tesla_user_feature_config_refresh</c> through the same <see cref="IApiClient"/> pipeline
/// (auth + resilience), classifying any fault through <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class FeatureTogglesSource : IFeatureTogglesSource
{
    /// <summary>The generated OpenAPI operation id for the feature-config read.</summary>
    public const string ConfigOperation = "get_api_v1_tesla_user_feature_config";

    /// <summary>The generated OpenAPI operation id for the feature-config refresh mutation.</summary>
    public const string RefreshOperation = "post_api_v1_tesla_user_feature_config_refresh";

    private const string CacheKey = "tesla:user:feature-config";

    private static readonly ApiRequest ConfigRequest = new(ConfigOperation);
    private static readonly ApiRequest RefreshRequest = new(RefreshOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FeatureTogglesSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> StreamConfigAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(ConfigRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return FeatureTogglesResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<FeatureConfigRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.SendAsync<JsonElement>(RefreshRequest, cancellationToken).ConfigureAwait(false);
            return FeatureConfigRefreshOutcome.Success();
        }
        catch (OperationCanceledException)
        {
            // A superseding run (or disposal) cancelled this one — let the caller drop it silently.
            throw;
        }
        catch (Exception ex)
        {
            return FeatureConfigRefreshOutcome.Failure(ApiErrorMapper.Map(ex));
        }
    }

    // A null / non-object body carries no usable envelope (web parity: the query has no data → empty state
    // with no header timestamp). A valid envelope with an empty data object is NOT treated as empty here: the
    // engine keeps the payload so the header's "Synced {when}" survives, and the body's empty state is derived
    // from the zero entry count downstream (web: featureEntries.length === 0 → empty body).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
