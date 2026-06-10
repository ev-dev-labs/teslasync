using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The data port the <see cref="RegionSettingsViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// two operations the web component composes through its hooks: a cache-then-network read of the Tesla region
/// (web <c>useTeslaUserRegion</c> → <c>GET /tesla/user/region</c>) and the "Refresh from Tesla" mutation (web
/// <c>useRefreshTeslaRegion</c> → <c>POST /tesla/user/region/refresh</c>). The view never performs HTTP itself;
/// the concrete <see cref="RegionSettingsSource"/> (or a test fake) drives this.
/// </summary>
public interface IRegionSettingsSource
{
    /// <summary>Stream the cache-then-network region snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<RegionConfig>> StreamRegionAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Ask the server to re-pull the region from Tesla (web POST <c>/tesla/user/region/refresh</c>). Returns a
    /// classified <see cref="RegionRefreshOutcome"/> — it never throws for an HTTP fault (web parity: the
    /// mutation resolves to a toast). The caller re-reads the region afterwards to reflect the authoritative
    /// state (web <c>invalidateQueries</c> → refetch).
    /// </summary>
    Task<RegionRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IRegionSettingsSource"/> — the native data adapter for the region-settings
/// surface. The region read runs one cache-then-network stream through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case envelope shape round-trips
/// losslessly, then maps each emission to a typed <see cref="RegionConfig"/> result via
/// <see cref="RegionResultMapper"/> (generated operation <c>get_api_v1_tesla_user_region</c>). The refresh
/// mutation posts the generated refresh operation (<c>post_api_v1_tesla_user_region_refresh</c>) and classifies
/// any fault through the shared <see cref="ApiErrorMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class RegionSettingsSource : IRegionSettingsSource
{
    /// <summary>The generated OpenAPI operation id for the region read.</summary>
    public const string RegionOperation = "get_api_v1_tesla_user_region";

    /// <summary>The generated OpenAPI operation id for the region refresh mutation.</summary>
    public const string RefreshOperation = "post_api_v1_tesla_user_region_refresh";

    private const string CacheKey = "tesla:user:region";

    private static readonly ApiRequest RegionRequest = new(RegionOperation);
    private static readonly ApiRequest RefreshRequest = new(RefreshOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public RegionSettingsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<RegionConfig>> StreamRegionAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(RegionRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return RegionResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task<RegionRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await _api.SendAsync<JsonElement>(RefreshRequest, cancellationToken).ConfigureAwait(false);
            return RegionRefreshOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return RegionRefreshOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return RegionRefreshOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }

    // The envelope always carries a `data` object + `fetched_at`; it is "empty" (web parity: the else branch
    // renders the EmptyState) when no region code is present. A non-object body is empty too.
    private static bool IsEmptyResponse(JsonElement element) => !RegionConfig.FromJson(element).HasRegion;
}
