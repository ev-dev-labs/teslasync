using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The repository-backed <see cref="IEnergyProductsSource"/> — the native data adapter for the energy-sites
/// list and the C# port of the web <c>useTeslaEnergySites</c> + <c>useRefreshTeslaEnergySites</c> hooks
/// (web/src/api/hooks/useEnergy.ts). <see cref="StreamAsync"/> runs one cache-then-network read of
/// <c>GET /tesla/energy-sites</c> (generated operation <c>get_api_v1_tesla_energy_sites</c>) through the
/// shared <see cref="CacheThenNetworkEngine"/>; <see cref="RefreshAsync"/> drives the same engine with the
/// <c>POST /tesla/energy-sites/refresh</c> mutation (<c>post_api_v1_tesla_energy_sites_refresh</c>) so the
/// refreshed payload is cached and surfaced exactly like the GET. The raw JSON is cached so the snake_case
/// wire shape round-trips losslessly; each emission is parsed via <see cref="EnergyProductsResultMapper"/>.
/// No HTTP touches the view.
/// </summary>
public sealed class EnergyProductsSource : IEnergyProductsSource
{
    internal const string SitesGetOperation = "get_api_v1_tesla_energy_sites";
    internal const string SitesRefreshOperation = "post_api_v1_tesla_energy_sites_refresh";
    private const string CacheKey = "tesla:energy-sites";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, the cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public EnergyProductsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> StreamAsync(CancellationToken cancellationToken = default) =>
        MapStream(new ApiRequest(SitesGetOperation), cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> RefreshAsync(CancellationToken cancellationToken = default) =>
        MapStream(new ApiRequest(SitesRefreshOperation), cancellationToken);

    private async IAsyncEnumerable<RepositoryResult<EnergyProductsSnapshot>> MapStream(
        ApiRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergyProductsResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => true,
    };
}

/// <summary>
/// The repository-backed <see cref="IEnergySiteInfoSource"/> — the native data adapter for a site's detailed
/// configuration and the C# port of the web <c>useTeslaEnergySiteInfo</c> + <c>useRefreshTeslaEnergySiteInfo</c>
/// hooks. <see cref="StreamAsync"/> runs one cache-then-network read of
/// <c>GET /tesla/energy-sites/{siteID}/site-info</c>
/// (<c>get_api_v1_tesla_energy_sites_siteID_site_info</c>); <see cref="RefreshAsync"/> drives the same engine
/// with the <c>POST …/site-info/refresh</c> mutation. The cache key is scoped per site so each card caches
/// independently; each emission is parsed via <see cref="EnergySiteInfoResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class EnergySiteInfoSource : IEnergySiteInfoSource
{
    internal const string SiteInfoGetOperation = "get_api_v1_tesla_energy_sites_siteID_site_info";
    internal const string SiteInfoRefreshOperation = "post_api_v1_tesla_energy_sites_siteID_site_info_refresh";
    private const string PathParam = "siteID";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, the cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public EnergySiteInfoSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> StreamAsync(long siteId, CancellationToken cancellationToken = default) =>
        MapStream(siteId, ApiRequest.WithPath(SiteInfoGetOperation, PathParam, Key(siteId)), cancellationToken);

    /// <inheritdoc />
    public IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> RefreshAsync(long siteId, CancellationToken cancellationToken = default) =>
        MapStream(siteId, ApiRequest.WithPath(SiteInfoRefreshOperation, PathParam, Key(siteId)), cancellationToken);

    private async IAsyncEnumerable<RepositoryResult<EnergySiteInfo>> MapStream(
        long siteId,
        ApiRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"tesla:site-info:{siteId}");
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return EnergySiteInfoResultMapper.Map(emission);
        }
    }

    private static string Key(long siteId) => siteId.ToString(CultureInfo.InvariantCulture);

    private static bool IsEmptyResponse(JsonElement element) => !EnergySiteInfo.HasData(element);
}
