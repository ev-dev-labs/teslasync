using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="BackendStatusViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// three independent cache-then-network reads the web component composes — the extended health snapshot
/// (web <c>useQuery(getExtendedHealth)</c> → <c>GET /system/health</c>), the database connection-pool
/// snapshot (web <c>useConnectionPool</c> → <c>GET /dev-tools/runtime-info</c>) and the runtime version
/// snapshot (web <c>useQuery(getVersionInfo)</c> → <c>GET /system/version</c>). The view never performs HTTP
/// itself; the concrete <see cref="BackendStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IBackendStatusSource
{
    /// <summary>Stream the cache-then-network extended-health snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<BackendHealthSnapshot>> StreamHealthAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network database connection-pool snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<ConnectionPoolSnapshot>> StreamPoolAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network runtime-version snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<VersionSnapshot>> StreamVersionAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBackendStatusSource"/> — the native data adapter for the backend-status
/// surface. It runs three independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to a typed snapshot via <see cref="BackendStatusResultMapper"/>:
/// <c>GET /system/health</c> (generated operation <c>get_api_v1_system_health</c>),
/// <c>GET /dev-tools/runtime-info</c> (<c>get_api_v1_dev_tools_runtime_info</c>) and
/// <c>GET /system/version</c> (<c>get_api_v1_system_version</c>). No HTTP touches the view.
/// </summary>
public sealed class BackendStatusSource : IBackendStatusSource
{
    /// <summary>The generated OpenAPI operation id for the extended health feed.</summary>
    public const string HealthOperation = "get_api_v1_system_health";

    /// <summary>The generated OpenAPI operation id for the database connection-pool feed.</summary>
    public const string PoolOperation = "get_api_v1_dev_tools_runtime_info";

    /// <summary>The generated OpenAPI operation id for the runtime version feed.</summary>
    public const string VersionOperation = "get_api_v1_system_version";

    private const string HealthCacheKey = "system:health";
    private const string PoolCacheKey = "dev-tools:runtime-info";
    private const string VersionCacheKey = "system:version";

    private static readonly ApiRequest HealthRequest = new(HealthOperation);
    private static readonly ApiRequest PoolRequest = new(PoolOperation);
    private static readonly ApiRequest VersionRequest = new(VersionOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public BackendStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<BackendHealthSnapshot>> StreamHealthAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            HealthCacheKey,
            ct => _api.SendAsync<JsonElement>(HealthRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return BackendStatusResultMapper.MapHealth(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ConnectionPoolSnapshot>> StreamPoolAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            PoolCacheKey,
            ct => _api.SendAsync<JsonElement>(PoolRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return BackendStatusResultMapper.MapPool(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<VersionSnapshot>> StreamVersionAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            VersionCacheKey,
            ct => _api.SendAsync<JsonElement>(VersionRequest, ct),
            IsNonObject,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return BackendStatusResultMapper.MapVersion(emission);
        }
    }

    // All three endpoints return a JSON object envelope; a null / non-object body carries no usable data
    // (web parity: the query resolves with undefined → the section/sub-section renders its empty surface).
    private static bool IsNonObject(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
